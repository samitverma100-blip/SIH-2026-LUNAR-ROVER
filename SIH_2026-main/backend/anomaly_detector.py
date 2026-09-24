"""
Anomaly detection for rover telemetry.

Approach: Isolation Forest trained on synthetic "normal operation" telemetry
(no faults injected). At inference time, each live reading gets a feature
vector (raw sensor values + rate-of-change from the previous reading) and
the model scores how "isolated" (unusual) it is compared to normal patterns.

Why Isolation Forest over an autoencoder for this hackathon:
- Trains in under a second, no GPU, no tuning headaches
- Works well on small tabular feature vectors like this
- decision_function gives a continuous anomaly score, not just binary,
  which is useful for the alert feed and (later) the AI agent's reasoning

An autoencoder is a reasonable stretch upgrade if your ML person wants to
swap it in later (see the note at the bottom of this file) - the interface
(`detect()` taking a feature dict, returning a score) would stay the same,
so nothing else in the backend needs to change.
"""

import os
import json
import random
import hashlib
import numpy as np
import joblib
import sklearn
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from telemetry import RoverTelemetry
import telemetry as _telemetry_module

FEATURE_NAMES = [
    "battery_pct", "motor_fl", "motor_fr", "motor_rl", "motor_rr",
    "tilt_deg", "comms_signal",
    "d_battery", "d_motor_fl", "d_motor_fr", "d_motor_rl", "d_motor_rr",
    "d_tilt", "d_comms",
]

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "anomaly_model.joblib")
SCALER_PATH = os.path.join(MODEL_DIR, "anomaly_scaler.joblib")
META_PATH = os.path.join(MODEL_DIR, "anomaly_meta.json")

# Bump when the feature engineering below changes in a way the fingerprint
# (which hashes the simulator source) wouldn't notice on its own.
MODEL_SCHEMA_VERSION = 2


def _model_fingerprint(contamination: float) -> str:
    """Identifies everything a cached model depends on. If the simulator that
    defines 'normal', the feature list, or the scikit-learn version changes,
    the cached model is stale and must be retrained rather than trusted."""
    with open(_telemetry_module.__file__, "rb") as f:
        sim_src = f.read()
    blob = b"|".join([
        sim_src,
        ",".join(FEATURE_NAMES).encode(),
        f"{contamination}".encode(),
        sklearn.__version__.encode(),
        str(MODEL_SCHEMA_VERSION).encode(),
    ])
    return hashlib.sha256(blob).hexdigest()[:16]


def _reading_to_raw_features(reading: dict) -> list:
    m = reading["motor_temp"]
    # Tilt is judged relative to the slope the terrain says we should be on, so a
    # rover climbing a crater wall isn't flagged for tilting exactly as expected.
    tilt_residual = reading["tilt_deg"] - reading.get("expected_tilt", 0.0)
    return [
        reading["battery_pct"],
        m["front_left"], m["front_right"], m["rear_left"], m["rear_right"],
        tilt_residual,
        reading["comms_signal"],
    ]


def generate_training_dataset(n_ticks: int = 3000, seed: int = 42) -> np.ndarray:
    """Runs the telemetry simulator with NO faults injected to build a
    'what does normal look like' dataset. This stands in for what would,
    in a real mission, be historical telemetry logs."""
    # The simulator draws from Python's `random`, so that is what must be seeded
    # for the training set (and therefore the model) to be reproducible.
    rng_state = random.getstate()
    random.seed(seed)

    sim = RoverTelemetry()
    rows = []
    prev_raw = None

    for _ in range(n_ticks):
        reading = sim.next_reading()
        raw = _reading_to_raw_features(reading)

        if prev_raw is None:
            deltas = [0.0] * len(raw)
        else:
            deltas = [raw[i] - prev_raw[i] for i in range(len(raw))]

        rows.append(raw + deltas)
        prev_raw = raw

    random.setstate(rng_state)
    return np.array(rows)


class AnomalyDetector:
    # contamination is the share of *healthy* training data the forest is allowed
    # to call anomalous, i.e. the built-in false-alarm rate. The old 2% meant a
    # false alarm roughly every 50 ticks; 0.2% plus the persistence check below
    # makes a spurious alert very rare while real faults (large, sustained
    # jumps) are still caught within a tick or two.
    def __init__(self, contamination: float = 0.002, force_retrain: bool = False,
                 persistence: int = 2):
        self.contamination = contamination
        self.persistence = persistence   # consecutive flagged ticks required
        self.model: IsolationForest = None
        self.scaler: StandardScaler = None
        self._prev_raw = None  # previous reading's raw features, for delta calc
        self._streak = 0       # consecutive raw-flagged ticks so far

        os.makedirs(MODEL_DIR, exist_ok=True)
        fingerprint = _model_fingerprint(contamination)

        if not force_retrain and self._cache_is_current(fingerprint):
            self.model = joblib.load(MODEL_PATH)
            self.scaler = joblib.load(SCALER_PATH)
            print("[anomaly_detector] Loaded cached model (up to date)")
        else:
            self._train(fingerprint)

    @staticmethod
    def _cache_is_current(fingerprint: str) -> bool:
        if not (os.path.exists(MODEL_PATH) and os.path.exists(SCALER_PATH) and os.path.exists(META_PATH)):
            return False
        try:
            with open(META_PATH) as f:
                return json.load(f).get("fingerprint") == fingerprint
        except (OSError, ValueError):
            return False

    def _train(self, fingerprint: str):
        print("[anomaly_detector] Cached model missing or stale - retraining on current simulator...")
        X = generate_training_dataset()

        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)

        self.model = IsolationForest(
            n_estimators=150,
            contamination=self.contamination,
            random_state=42,
        )
        self.model.fit(X_scaled)

        joblib.dump(self.model, MODEL_PATH)
        joblib.dump(self.scaler, SCALER_PATH)
        with open(META_PATH, "w") as f:
            json.dump({"fingerprint": fingerprint, "sklearn": sklearn.__version__,
                       "samples": int(len(X))}, f)
        print(f"[anomaly_detector] Trained on {len(X)} samples, saved to {MODEL_DIR}")

    def detect(self, reading: dict, z_threshold: float = 4.0) -> dict:
        """Takes a raw telemetry reading (same dict shape as RoverTelemetry.next_reading()),
        returns anomaly info: is_anomaly, score, and the feature(s) that most
        contributed (for explainability - used by the AI agent in Week 4).

        Detection combines two signals:
          1. Isolation Forest's decision_function (holistic pattern anomaly)
          2. A per-feature z-score check against the training distribution

        Why both: with ~14 features where most stay near-constant under normal
        operation, Isolation Forest's random per-split feature selection can
        dilute a single wildly-off sensor (e.g. one motor at 130C) across many
        splits on unrelated, boring features - so a single extreme sensor
        reading can score as 'normal' by decision_function alone even though
        it's 100+ standard deviations from baseline. The z-score check catches
        exactly this case and is cheap and easy to explain to a judge.
        """
        raw = _reading_to_raw_features(reading)

        if self._prev_raw is None:
            deltas = [0.0] * len(raw)
        else:
            deltas = [raw[i] - self._prev_raw[i] for i in range(len(raw))]
        self._prev_raw = raw

        feature_vec = np.array(raw + deltas).reshape(1, -1)
        feature_vec_scaled = self.scaler.transform(feature_vec)

        # decision_function: higher = more normal, lower/negative = more anomalous
        raw_score = float(self.model.decision_function(feature_vec_scaled)[0])
        forest_flags_anomaly = bool(self.model.predict(feature_vec_scaled)[0] == -1)

        z_scores = feature_vec_scaled[0]
        max_abs_z = float(np.max(np.abs(z_scores)))
        zscore_flags_anomaly = max_abs_z > z_threshold

        raw_flag = forest_flags_anomaly or zscore_flags_anomaly

        # Persistence: a real fault is sustained; a lone noisy sample isn't. Only
        # raise the alarm once `persistence` consecutive ticks were flagged.
        self._streak = self._streak + 1 if raw_flag else 0
        is_anomaly = self._streak >= self.persistence

        top_features = []
        if is_anomaly:
            top_idx = np.argsort(np.abs(z_scores))[::-1][:3]
            top_features = [
                {"feature": FEATURE_NAMES[i], "z_score": round(float(z_scores[i]), 2)}
                for i in top_idx
            ]

        return {
            "is_anomaly": is_anomaly,
            "anomaly_score": round(raw_score, 4),
            "max_z_score": round(max_abs_z, 2),
            "detected_by": "z_score" if (zscore_flags_anomaly and not forest_flags_anomaly)
                           else ("isolation_forest" if forest_flags_anomaly else "none"),
            "top_contributing_features": top_features,
        }


# --- Stretch upgrade note for the ML lead ---
# To swap in an autoencoder instead of Isolation Forest:
#   1. Train a small dense autoencoder (e.g. 14 -> 8 -> 4 -> 8 -> 14) on the
#      same generate_training_dataset() output, using reconstruction MSE
#      as the anomaly score instead of decision_function.
#   2. Keep the same detect() method signature (dict in, dict out) so
#      main.py and the frontend don't need any changes.
#   3. Isolation Forest's "top_contributing_features" trick (z-score per
#      feature) works fine as-is for explainability either way.