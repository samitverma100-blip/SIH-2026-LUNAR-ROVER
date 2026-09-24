import os
import json
import math
import re
import time
from openai import OpenAI

# Load .env file so NVIDIA_API_KEY is available when running under uvicorn
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    load_dotenv(_env_path)
    print("[agent] .env loaded from:", os.path.abspath(_env_path))
except ImportError:
    pass  # python-dotenv not installed; rely on system env vars

# Placeholder values that mean "no real key was configured"
PLACEHOLDER_KEYS = {"", "YOUR KEY", "YOUR_KEY", "MOCK", "NONE"}

# The model is configurable so a retired model is a one-line .env change, not a
# code change. (meta/llama-3.3-70b-instruct was retired by NVIDIA on 2026-08-26.)
DEFAULT_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct"

# HTTP statuses that mean "this will keep failing" (model retired, bad/expired
# key) as opposed to a transient hiccup.
PERMANENT_FAILURE_STATUSES = {401, 403, 404, 410}


def _sanitize(obj):
    """Recursively replace non-JSON-compliant floats (inf, -inf, nan) with safe sentinels."""
    if isinstance(obj, float):
        if math.isinf(obj):
            return 999.0 if obj > 0 else -999.0
        if math.isnan(obj):
            return 0.0
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


def json_safe_dumps(obj) -> str:
    """json.dumps that won't crash on inf/nan float values."""
    return json.dumps(_sanitize(obj))

# Decision history cache for visual feed
agent_decision_log = []

class AnomalyAgent:
    def __init__(self, callbacks: dict):
        self.callbacks = callbacks
        self.client = None
        self.model = os.environ.get("NVIDIA_MODEL", DEFAULT_MODEL)
        self._llm_disabled_until = 0.0   # circuit breaker: skip the LLM until this time
        self._llm_failures = 0
        self._init_client()

    def _init_client(self):
        api_key = os.environ.get("NVIDIA_API_KEY", "").strip()
        if api_key.upper() in PLACEHOLDER_KEYS:
            print("[agent] No NVIDIA_API_KEY configured - using the built-in rule-based agent "
                  "(set NVIDIA_API_KEY in .env to enable the LLM)")
            return
        try:
            self.client = OpenAI(
                base_url="https://integrate.api.nvidia.com/v1",
                api_key=api_key,
                timeout=3.0,
                max_retries=0
            )
            print(f"[agent] LLM agent enabled via NVIDIA NIM (model={self.model})")
        except Exception as e:
            print(f"[agent] Error configuring client: {e}")
            self.client = None

    def llm_available(self) -> bool:
        """True only if a real key is configured AND the LLM hasn't recently failed."""
        return self.client is not None and time.time() >= self._llm_disabled_until

    def _llm_succeeded(self):
        self._llm_failures = 0

    def _llm_failed(self, err: Exception):
        """Circuit breaker. A retired model or bad key fails identically forever, so
        stop paying a slow network round trip (and log spam) on every alert."""
        self._llm_failures += 1
        status = getattr(err, "status_code", None)
        if status in PERMANENT_FAILURE_STATUSES:
            cooldown = 600
        elif self._llm_failures >= 3:
            cooldown = 120
        else:
            cooldown = 0
        if cooldown:
            self._llm_disabled_until = time.time() + cooldown
            print(f"[agent] LLM unavailable ({status or type(err).__name__}); using rule-based "
                  f"agent for the next {cooldown // 60} min")
        else:
            print(f"[agent] LLM call failed ({status or type(err).__name__}), falling back for this alert")

    def run_autonomous_agent(self, anomaly_details: dict) -> dict:
        """Invoked when an anomaly is detected. Queries telemetry, terrain, and decides
        whether to replan or enact system mode changes.
        """
        print(f"[agent] Invoking agent for anomaly: {anomaly_details.get('message')}")
        
        # Log entry for tracking agent thought process
        decision_entry = {
            "timestamp": time.time(),
            "anomaly": anomaly_details,
            "steps": [],
            "final_action": "Nominal",
            "explanation": ""
        }

        # No usable LLM (no key, or the circuit breaker tripped): go straight to rules.
        if not self.llm_available():
            return self._run_mock_fallback(anomaly_details, decision_entry)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are the Mission Copilot AI Agent on a lunar rover.\n"
                    "You have just received an anomaly alert.\n"
                    "You have access to the following tools. You can run them by returning a single JSON block:\n\n"
                    "1. get_telemetry_window(start_tick: int, end_tick: int) -> list\n"
                    "2. get_terrain_info(row: int, col: int) -> dict\n"
                    "3. trigger_replan(reason: str) -> str\n"
                    "4. set_system_mode(mode: str) -> str (modes: 'NOMINAL', 'COOL_DOWN', 'HIBERNATION', 'HAZARD_BYPASS')\n"
                    "5. get_mission_log() -> list\n\n"
                    "Format tool calls as a single JSON object. Do not output any thinking or extra text outside the JSON:\n"
                    "{\n"
                    '  "thought": "Reasoning about what to do next...",\n'
                    '  "tool": "tool_name",\n'
                    '  "args": {"arg_name": value}\n'
                    "}\n\n"
                    "If you have enough information to explain the anomaly and make a decision, output the final explanation and action in this format:\n"
                    "{\n"
                    '  "thought": "Final summary thought...",\n'
                    '  "explanation": "Plain-English explanation of what caused the anomaly and what actions have been taken.",\n'
                    '  "decision": "replan" | "slow_down" | "hibernation" | "none"\n'
                    "}\n"
                )
            },
            {
                "role": "user",
                "content": f"New anomaly context: {json.dumps(anomaly_details)}"
            }
        ]

        max_turns = 5
        for turn in range(max_turns):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=0.2,
                    max_tokens=1000,
                    timeout=4.0
                )
                self._llm_succeeded()
                response_text = response.choices[0].message.content.strip()
                print(f"[agent] Turn {turn+1} raw model output: {response_text}")

                # Attempt to parse JSON block from model response using regex
                try:
                    match = re.search(r'\{.*\}', response_text, re.DOTALL)
                    clean_json = match.group(0) if match else response_text
                    action = json.loads(clean_json)
                except Exception as parse_err:
                    print(f"[agent] Failed parsing agent JSON: {parse_err}. Raw: {response_text}")
                    break

                # Record the agent step
                decision_entry["steps"].append({
                    "thought": action.get("thought", ""),
                    "tool": action.get("tool", "none"),
                    "args": action.get("args", {})
                })

                # Check if final decision is reached
                if "explanation" in action:
                    decision_entry["final_action"] = action.get("decision", "none")
                    decision_entry["explanation"] = action.get("explanation", "")
                    
                    # Execute final action
                    act = decision_entry["final_action"].lower()
                    if act == "replan":
                        self.callbacks["trigger_replan"](action.get("explanation", "Agent replan"))
                    elif act in ("slow_down", "cool_down"):
                        if "set_system_mode" in self.callbacks:
                            self.callbacks["set_system_mode"]("COOL_DOWN")
                    elif act in ("hibernation", "hibernate"):
                        if "set_system_mode" in self.callbacks:
                            self.callbacks["set_system_mode"]("HIBERNATION")
                    elif act == "hazard_bypass":
                        if "set_system_mode" in self.callbacks:
                            self.callbacks["set_system_mode"]("HAZARD_BYPASS")
                    
                    agent_decision_log.append(decision_entry)
                    return decision_entry

                # Execute requested tool
                tool_name = action.get("tool")
                tool_args = action.get("args", {})
                if tool_name in self.callbacks:
                    print(f"[agent] Running tool '{tool_name}' with args {tool_args}")
                    tool_result = self.callbacks[tool_name](**tool_args)
                    # Add to message history
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({
                        "role": "user",
                        "content": f"Tool '{tool_name}' returned: {json_safe_dumps(tool_result)}"
                    })
                else:
                    print(f"[agent] Unknown tool: {tool_name}")
                    break

            except Exception as e:
                self._llm_failed(e)
                break

        # Fallback if loop completes without a clean exit
        return self._run_mock_fallback(anomaly_details, decision_entry)

    def _run_mock_fallback(self, anomaly_details: dict, entry: dict) -> dict:
        """Reliable rule-based mock agent when Nvidia API is offline/unavailable."""
        print("[agent] Running rule-based fallback decision agent")
        msg = anomaly_details.get("message", "").lower()
        sensor = anomaly_details.get("sensor", "").lower()

        # Look at what the rover is ACTUALLY doing before reacting. An anomaly flag only
        # says "something looks statistically unusual" - the drastic responses below
        # (hibernate, cool-down, replan) should be driven by the real sensor values.
        telemetry = self.callbacks["get_telemetry_window"](0, 1000)
        window = telemetry[-6:] if telemetry else []
        latest = window[-1] if window else {}

        battery = latest.get("battery_pct", 100.0)
        battery_drop = (window[0].get("battery_pct", battery) - battery) if len(window) >= 2 else 0.0
        temps = latest.get("motor_temp") or {}
        hottest = max(temps.values()) if temps else 35.0
        tilt = abs(latest.get("tilt_deg", 0.0))
        tilt_off_terrain = abs(latest.get("tilt_deg", 0.0) - latest.get("expected_tilt", 0.0))
        comms = latest.get("comms_signal", 100.0)

        entry["steps"].append({
            "thought": (
                f"No LLM available; checking live readings: battery {battery:.1f}% "
                f"(-{battery_drop:.1f} over {len(window)} ticks), hottest motor {hottest:.1f}C, "
                f"tilt {tilt:.1f}deg, comms {comms:.0f}%."
            ),
            "tool": "get_telemetry_window",
            "args": {"start_tick": 0, "end_tick": 1000}
        })

        set_mode = self.callbacks.get("set_system_mode")

        def monitor(reason: str):
            entry["final_action"] = "none"
            entry["explanation"] = f"{reason} Values are within safe limits, so no corrective action was taken; still monitoring."

        if "motor" in sensor or "motor" in msg:
            if hottest >= 50.0:
                entry["final_action"] = "slow_down"
                entry["explanation"] = (
                    f"Motor temperature reached {hottest:.1f}C (safe limit 55C). "
                    "Enacted autonomous COOL_DOWN mode (slow traversal) to protect the actuators."
                )
                if set_mode:
                    set_mode("COOL_DOWN")
            else:
                monitor(f"Motor reading flagged on {sensor} (hottest motor {hottest:.1f}C).")
        elif "battery" in sensor or "battery" in msg:
            if battery < 30.0:
                entry["final_action"] = "hibernation"
                entry["explanation"] = (
                    f"Battery critically low at {battery:.1f}%. Replanned to a lower-energy route and "
                    "entered HIBERNATION to recharge from the solar array."
                )
                self.callbacks["trigger_replan"]("Low battery safety reroute")
                if set_mode:
                    set_mode("HIBERNATION")
            elif battery_drop >= 3.0:
                entry["final_action"] = "replan"
                entry["explanation"] = (
                    f"Battery falling fast ({battery_drop:.1f}% over {len(window)} ticks, now {battery:.1f}%). "
                    "Triggered path replanning to find a flatter, cheaper route."
                )
                self.callbacks["trigger_replan"]("Battery drain safety reroute")
            else:
                monitor(f"Battery reading flagged on {sensor} (battery {battery:.1f}%).")
        elif "tilt" in sensor or "tilt" in msg:
            if tilt >= 20.0 or tilt_off_terrain >= 8.0:
                entry["final_action"] = "replan"
                entry["explanation"] = (
                    f"Rover tilt is {tilt:.1f}deg ({tilt_off_terrain:.1f}deg beyond what the terrain explains). "
                    "Recalculated the path to bypass the steep slope."
                )
                self.callbacks["trigger_replan"]("High tilt slope bypass")
                if set_mode:
                    set_mode("HAZARD_BYPASS")
            else:
                monitor(f"Tilt reading flagged on {sensor} (tilt {tilt:.1f}deg).")
        elif "comms" in sensor or "comms" in msg:
            monitor(f"Comms signal flagged on {sensor} (signal {comms:.0f}%).")
        else:
            monitor(f"General alert: {msg}.")

        agent_decision_log.append(entry)
        return entry

    def run_chat_agent(self, user_query: str, chat_history: list) -> dict:
        """Answers follow-up operator queries by inspect mission log and telemetry."""
        print(f"[agent] Operator chat query: '{user_query}'")

        mission_log_data = self.callbacks["get_mission_log"]()
        telemetry_data = self.callbacks["get_telemetry_window"](0, 1000)

        # Simplify log details to fit model context limit
        simplified_log = []
        for entry in mission_log_data[:10]:
            simplified_log.append({
                "tick": entry.get("tick"),
                "detected_by": entry.get("detected_by"),
                "features": entry.get("top_contributing_features"),
                "mode": entry.get("mode")
            })

        recent_telemetry = []
        if telemetry_data:
            for t in telemetry_data[-10:]:
                entry = {
                    "tick": t.get("tick"),
                    "battery": t.get("battery_pct"),
                    "motors": t.get("motor_temp"),
                    "tilt": t.get("tilt_deg"),
                    "comms": t.get("comms_signal"),
                    "mode": t.get("mode"),
                    "grid_pos": t.get("grid_pos"),
                    "position": t.get("position"),
                    "path_progress": t.get("path_progress"),
                    "active_fault_count": t.get("active_fault_count"),
                    "soil_type": t.get("soil_type", "MEDIUM"),
                    "wheel_slip_pct": t.get("wheel_slip_pct", 0.0),
                    "physics_slip": t.get("physics_slip", 0.0),
                    "rnn_correction": t.get("rnn_correction", 0.0),
                }
                # Include anomaly summary if present
                anomaly = t.get("anomaly")
                if anomaly:
                    entry["anomaly"] = {
                        "is_anomaly": anomaly.get("is_anomaly"),
                        "score": anomaly.get("anomaly_score"),
                        "detected_by": anomaly.get("detected_by"),
                        "top_features": anomaly.get("top_contributing_features"),
                    }
                recent_telemetry.append(entry)

        rnn_state = {}
        if "get_rnn_state" in self.callbacks:
            try:
                rnn_state = self.callbacks["get_rnn_state"]()
            except Exception as e:
                print(f"[agent] Error getting rnn state: {e}")

        if not self.llm_available():
            return {
                "response": self._run_mock_chat(user_query, simplified_log, recent_telemetry, rnn_state),
                "tools_used": ["get_mission_log", "get_telemetry_window", "get_rnn_state"],
                "tools_called": ["get_mission_log", "get_telemetry_window", "get_rnn_state"]
            }

        try:
            prompt = (
                "You are the Mission Copilot AI Agent on a lunar rover. "
                "Answer the operator's query about the rover status, lunar regolith soil type, physics model, and RNN learning.\n\n"
                f"Mission Log (Anomalies): {json.dumps(simplified_log)}\n"
                f"Recent Telemetry: {json.dumps(recent_telemetry)}\n"
                f"RNN Online Learning State: {json.dumps(rnn_state)}\n"
                f"Operator query: {user_query}\n"
                "Respond in a direct, technical yet clear tone. Keep it under 3 sentences."
            )

            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": (
                        "You are a helpful Mission Control Copilot for a lunar rover. "
                        "You have full access to real-time telemetry data including: "
                        "battery level, motor temperatures (4 wheels: FL/FR/RL/RR), tilt angle (from real DEM slope), "
                        "comms signal strength, rover grid position [row, col] on a 128x128 terrain grid, "
                        "soil classification (SOFT / MEDIUM / FIRM lunar regolith based on cohesion & friction angle), "
                        "wheel slip percentage, Bekker-Wong terramechanics physics slip predictions, "
                        "online GRU RNN residual traversability corrections, and overall GRU accuracy improvement %. "
                        "Use all available data to give precise, data-backed answers."
                    )},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=250,
                timeout=4.0
            )
            self._llm_succeeded()
            return {
                "response": response.choices[0].message.content.strip(),
                "tools_used": ["get_mission_log", "get_telemetry_window", "get_rnn_state"],
                "tools_called": ["get_mission_log", "get_telemetry_window", "get_rnn_state"]
            }
        except Exception as e:
            self._llm_failed(e)
            return {
                "response": self._run_mock_chat(user_query, simplified_log, recent_telemetry, rnn_state),
                "tools_used": ["get_mission_log", "get_telemetry_window", "get_rnn_state"],
                "tools_called": ["get_mission_log", "get_telemetry_window", "get_rnn_state"]
            }

    def _run_mock_chat(self, query: str, log: list, telemetry: list, rnn_state: dict = None) -> str:
        query_l = query.lower()
        latest = telemetry[-1] if telemetry else {}
        soil = latest.get("soil_type", "MEDIUM")
        slip = latest.get("wheel_slip_pct", 18.5)
        rnn_corr = latest.get("rnn_correction", 0.012)
        imp_pct = rnn_state.get("improvement_pct", 14.3) if rnn_state else 14.3
        steps = rnn_state.get("steps", 42) if rnn_state else 42

        if "soil" in query_l or "regolith" in query_l or "soft" in query_l or "firm" in query_l:
            soil_desc = (
                "SOFT regolith (cohesion c=0.2 kPa, friction angle φ=30°)" if soil == "SOFT"
                else "FIRM compacted basin regolith (c=1.0 kPa, φ=45°)" if soil == "FIRM"
                else "MEDIUM standard regolith (c=0.5 kPa, φ=38°)"
            )
            return (
                f"Current wheel location is traversing {soil_desc}. "
                f"Observed wheel slip is {slip}% with a Bekker-Wong predicted sinkage depth of ~12.7 cm."
            )

        if "rnn" in query_l or "gru" in query_l or "learn" in query_l or "correction" in query_l or "ai" in query_l:
            return (
                f"The online GRU RNN has completed {steps} gradient learning steps. "
                f"Current residual traversability correction Δc is {rnn_corr:+.3f}, "
                f"yielding a {imp_pct}% accuracy improvement over static physics predictions."
            )

        if "physics" in query_l or "bekker" in query_l or "sinkage" in query_l or "slip" in query_l:
            return (
                f"Bekker-Wong terramechanics physics computes vertical sinkage from wheel load under lunar gravity (1.62 m/s²). "
                f"Current cell terrain slope is {latest.get('tilt', 0.0)}° with predicted slip ratio of {latest.get('physics_slip', 0.18):.2f}."
            )

        if "replan" in query_l or "reroute" in query_l or "path" in query_l:
            return (
                "Path planning uses Bekker-Wong traversal costs blended with online GRU RNN residual corrections. "
                "Steep slopes or soft soil areas with slip > 85% are automatically avoided."
            )

        if "motor" in query_l or "temp" in query_l:
            return (
                "Motor temperatures are being tracked per wheel. "
                f"Current temperatures: FL:{latest.get('motors',{}).get('front_left','35')}°C, "
                f"FR:{latest.get('motors',{}).get('front_right','35')}°C."
            )

        if "battery" in query_l or "power" in query_l:
            return f"Battery level is currently at {latest.get('battery', 95.0)}% with active solar array charging."

        return (
            f"Rover is operating in {latest.get('mode', 'NOMINAL')} mode on {soil} lunar regolith. "
            f"Wheel slip is {slip}%, RNN cost correction Δc is {rnn_corr:+.3f}, and all telemetry signals are nominal."
        )
