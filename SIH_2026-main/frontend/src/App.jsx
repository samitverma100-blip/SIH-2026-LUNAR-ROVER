/*
  TRANSMISSION // MISSION COPILOT
  Gritty analog-console telemetry dashboard for an autonomous lunar rover.
*/

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import './index.css';
import Cursor from './components/Cursor.jsx';
import Grain from './components/Grain.jsx';
import Stat from './components/Stat.jsx';
import WheelRig from './components/WheelRig.jsx';
import AuroraCanvas from './components/AuroraCanvas.jsx';
import BootSequence from './components/BootSequence.jsx';
import Panel from './components/Panel.jsx';
import Magnetic from './components/Magnetic.jsx';
import SirenAlert from './components/SirenAlert.jsx';
import SecHead from './components/SecHead.jsx';
import HomeTab from './components/HomeTab.jsx';
import useScramble from './hooks/useScramble.js';
import { isMuted, toggleMuted, unlock } from './lib/audio.js';

/* ─── Constants ──────────────────────────────────────────────── */
const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
const WS_URL = BACKEND.replace(/^http/, 'ws') + '/ws/telemetry';
const MAX_PTS = 60;

/* ─── Helpers ────────────────────────────────────────────────── */
const fmt = (v, d = 1) => (v != null && Number.isFinite(v) ? Number(v).toFixed(d) : '--');

function modeTone(mode) {
  switch (mode) {
    case 'NOMINAL': return 'ok';
    case 'COOL_DOWN': return 'warn';
    case 'HAZARD_BYPASS': return 'warn';
    case 'HIBERNATION': return 'crit';
    default: return 'ok';
  }
}


function statTone(value, warnAt, critAt, invert = false) {
  if (value == null) return 'ok';
  const bad = invert ? value < critAt : value >= critAt;
  const mid = invert ? value < warnAt : value >= warnAt;
  if (bad) return 'crit';
  if (mid) return 'warn';
  return 'ok';
}

/* ─── Chart tooltip ──────────────────────────────────────────── */
function InkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(56,24,97,0.92)', border: '1px solid rgba(255,224,240,0.3)', borderRadius: 4,
      padding: '8px 10px', fontFamily: 'var(--font-mono)', fontSize: 10, backdropFilter: 'blur(8px)',
    }}>
      <div style={{ color: '#ffa63d', marginBottom: 4, fontWeight: 700 }}>TICK {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>{p.name}: <strong>{fmt(p.value)}</strong></div>
      ))}
    </div>
  );
}

/* ─── Chat message ───────────────────────────────────────────── */
function ChatMsg({ role, text, tools }) {
  const isAI = role === 'ai';
  return (
    <div className={`msg ${isAI ? 'ai' : 'user'}`}>
      {isAI && <div className="tag">AI-CORE // MISSION COPILOT</div>}
      {tools?.length > 0 && (
        <div className="tools">{tools.map((t, i) => <span key={i}>⚙ {t}</span>)}</div>
      )}
      {text}
    </div>
  );
}


/* ─── Mission log slip ───────────────────────────────────────── */
function LogSlip({ entry }) {
  return (
    <div className="slip">
      <div className="slip-top">
        <span className="slip-tick">TICK {entry.tick}</span>
        <span className="slip-src">{entry.detected_by}</span>
      </div>
      <div className="slip-body">
        SCORE <strong>{entry.anomaly_score?.toFixed(3)}</strong> · MODE {entry.mode}
      </div>
      {entry.top_contributing_features?.slice(0, 2).map((f, j) => (
        <div key={j} className="slip-feat">⚠ {f.feature} (z={f.z_score?.toFixed(2)})</div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [booting, setBooting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState([]);
  const [latest, setLatest] = useState(null);
  const [anomalyAlert, setAnomalyAlert] = useState(null);
  const [missionLog, setMissionLog] = useState([]);
  const [rnnState, setRnnState] = useState(null);
  const [feedLines, setFeedLines] = useState([]);
  const [chatHistory, setChatHistory] = useState([
    { role: 'ai', text: 'COPILOT ONLINE. Mission telemetry active — query status, anomalies, or path navigation.' }
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [decisions, setDecisions] = useState([]);
  const [utcClock, setUtcClock] = useState('');

  const wsRef = useRef(null);
  const feedRef = useRef(null);
  const chatBoxRef = useRef(null);
  const anomalyTimer = useRef(null);
  const reconnectTimer = useRef(null);

  /* ── Audio: read stored mute pref, unlock AudioContext on first click ── */
  useEffect(() => {
    setMuted(isMuted());
    const onFirstClick = () => unlock();
    document.addEventListener('pointerdown', onFirstClick, { once: true });
    return () => document.removeEventListener('pointerdown', onFirstClick);
  }, []);

  /* ── UTC Clock ── */
  useEffect(() => {
    const tickClock = () => {
      const n = new Date();
      setUtcClock(`${String(n.getUTCHours()).padStart(2, '0')}:${String(n.getUTCMinutes()).padStart(2, '0')}:${String(n.getUTCSeconds()).padStart(2, '0')}`);
    };
    tickClock();
    const id = setInterval(tickClock, 1000);
    return () => clearInterval(id);
  }, []);

  /* ── Feed helper ── */
  const pushFeed = (text, highlight = false) => {
    const ts = new Date().toISOString().substr(11, 8);
    setFeedLines(prev => {
      const next = [...prev, { ts, text, highlight, id: Date.now() + Math.random() }];
      return next.length > 80 ? next.slice(next.length - 80) : next;
    });
  };

  /* ── WebSocket ── */
  const connect = useCallback(() => {
    // Retire any previous socket *without* letting its onclose schedule yet another
    // reconnect. (Closing it with handlers attached made every reconnect close the
    // last one, which fired its onclose, which reconnected again, forever.)
    const previous = wsRef.current;
    if (previous) {
      previous.onopen = previous.onmessage = previous.onclose = previous.onerror = null;
      previous.close();
    }
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      pushFeed('LINK ESTABLISHED — TELEMETRY FEED ONLINE', false);
    };

    ws.onmessage = (evt) => {
      let r;
      try { r = JSON.parse(evt.data); } catch { return; }
      setLatest(r);
      setHistory(prev => {
        const next = [...prev, r];
        return next.length > MAX_PTS ? next.slice(next.length - MAX_PTS) : next;
      });

      pushFeed(
        `TICK ${String(r.tick).padStart(4, '0')} · BAT ${fmt(r.battery_pct, 1)}% · SLIP ${fmt(r.wheel_slip_pct, 1)}% · MODE ${r.mode} · SOIL ${r.soil_type || '--'}`,
        r.anomaly?.is_anomaly
      );

      if (r.anomaly?.is_anomaly) {
        const feat = r.anomaly.top_contributing_features?.[0];
        setAnomalyAlert({
          score: r.anomaly.anomaly_score?.toFixed(3),
          feature: feat ? `${feat.feature} (z=${feat.z_score?.toFixed(2)})` : 'UNSPECIFIED',
          by: r.anomaly.detected_by,
        });
        clearTimeout(anomalyTimer.current);
        anomalyTimer.current = setTimeout(() => setAnomalyAlert(null), 8000);
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;   // a retired socket - not a real disconnect
      setConnected(false);
      pushFeed('LINK LOST — RETRYING...', true);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      clearTimeout(anomalyTimer.current);
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        ws.close();
      }
    };
  }, [connect]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [feedLines]);

  useEffect(() => {
    if (chatBoxRef.current) chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
  }, [chatHistory]);

  /* ── Poll mission log / rnn / decisions ── */
  useEffect(() => {
    const fetchExtras = async () => {
      try {
        const [logRes, rnnRes, decRes] = await Promise.all([
          fetch(`${BACKEND}/api/mission_log?limit=20`),
          fetch(`${BACKEND}/api/rnn/state`),
          fetch(`${BACKEND}/api/agent/decisions`),
        ]);
        setMissionLog((await logRes.json()).entries || []);
        setRnnState(await rnnRes.json());
        setDecisions((await decRes.json()).decisions || []);
      } catch { /* backend unreachable — feed stays empty */ }
    };
    fetchExtras();
    const id = setInterval(fetchExtras, 5000);
    return () => clearInterval(id);
  }, []);

  /* ── Fault injection & chat ── */
  const injectFault = async (fault_type, target = 'general', magnitude = 1.5) => {
    try {
      await fetch(`${BACKEND}/api/inject_fault`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault_type, target, magnitude, duration_ticks: 25 }),
      });
      pushFeed(`FAULT INJECTED: ${fault_type.toUpperCase()} ON ${target.toUpperCase()}`, true);
    } catch { pushFeed('FAULT INJECT FAILED — BACKEND UNAVAILABLE', true); }
  };

  const resetBattery = async () => {
    try {
      await fetch(`${BACKEND}/api/reset_battery`, { method: 'POST' });
      pushFeed('SOLAR RECHARGE INITIATED — BATTERY NOMINAL', false);
    } catch { /* noop */ }
  };

  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput('');
    setChatHistory(prev => [...prev, { role: 'user', text: msg }]);
    setChatLoading(true);
    try {
      const res = await fetch(`${BACKEND}/api/agent/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: [] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChatHistory(prev => [...prev, {
        role: 'ai', text: data.response || data.message || 'No response from copilot.',
        tools: data.tools_used || data.tools_called || [],
      }]);
    } catch {
      setChatHistory(prev => [...prev, { role: 'ai', text: 'COMMS ERROR — BACKEND UNREACHABLE OR TIMED OUT' }]);
    } finally {
      setChatLoading(false);
    }
  };

  /* ── Derived values ── */
  const motorTemps = latest?.motor_temp || {};
  const fl = motorTemps.front_left ?? 35, fr = motorTemps.front_right ?? 35;
  const rl = motorTemps.rear_left ?? 35, rr = motorTemps.rear_right ?? 35;
  const maxMotor = Math.max(fl, fr, rl, rr);
  const battPct = latest?.battery_pct ?? 0;
  const signalPct = latest?.comms_signal ?? 0;
  const tiltDeg = latest?.tilt_deg ?? 0;
  const slipPct = latest?.wheel_slip_pct ?? 0;
  const roverMode = latest?.mode ?? 'NOMINAL';
  const tone = modeTone(roverMode);
  const gridPos = latest?.grid_pos;

  const tabs = [
    { id: 'home', label: 'Home' },
    { id: 'telemetry', label: 'Telemetry' },
    { id: 'sensors', label: 'Sensors' },
    { id: 'log', label: 'Mission Log' },
    { id: 'copilot', label: 'AI Copilot' },
  ];

  const word1 = useScramble('TRANSMISSION', booting);
  const word2 = useScramble('COPILOT', booting);

  return (
    <>
      {booting && <BootSequence onDone={() => setBooting(false)} />}
      <div className={`shell ${tone !== 'ok' ? `state-${tone}` : ''}`}>
        <AuroraCanvas alertTone={tone} />
        <Cursor />
        <Grain />
        <SirenAlert tone={tone} />

        {/* ── Header ── */}
        <header className="hdr">
        <div className="wrap hdr-row">
          <div className="wordmark">
            <h1 className="scramble">{word1}<span className="slash">/</span>{word2}</h1>
            <span className="sub">SYS AL-904 · UTC {utcClock}</span>
          </div>
          <div className="hdr-status">
            <span className={`stamp`} style={{ color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--crit)' }}>
              {roverMode}
            </span>
            <span className={`pill ${connected ? 'live' : 'dead'}`}>
              <span className="dot" />{connected ? 'LIVE' : 'OFFLINE'}
            </span>
            <Magnetic strength={8}>
              <button className="pill" data-cx={muted ? 'UNMUTE' : 'MUTE'}
                onClick={() => setMuted(toggleMuted())}>
                {muted ? '🔇 MUTED' : '🔊 AUDIO'}
              </button>
            </Magnetic>
          </div>
        </div>
      </header>

      {/* ── Ticker ── */}
      <div className={`ticker ${tone !== 'ok' ? 'alert' : ''}`}>
        <div className="ticker-track">
          {[0, 1].map(dup => (
            <span key={dup} style={{ display: 'inline-flex' }}>
              <span className="ticker-item">BATTERY <strong>{fmt(battPct, 1)}%</strong></span>
              <span className="ticker-item">SIGNAL <strong>{fmt(signalPct, 0)}%</strong></span>
              <span className="ticker-item">SLIP <strong>{fmt(slipPct, 1)}%</strong></span>
              <span className="ticker-item">TILT <strong>{fmt(tiltDeg, 1)}°</strong></span>
              <span className="ticker-item">SOIL <strong>{latest?.soil_type || '--'}</strong></span>
              <span className="ticker-item">GRID <strong>[{gridPos ? gridPos.join(', ') : '--'}]</strong></span>
              <span className="ticker-item">MODE <strong>{roverMode}</strong></span>
              <span className="ticker-item">TICK <strong>{latest?.tick ?? 0}</strong></span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <nav className="wrap tabs">
        {tabs.map(t => (
          <Magnetic key={t.id} strength={10}>
            <button className={`tab ${activeTab === t.id ? 'active' : ''}`}
              data-cx="VIEW" onClick={() => setActiveTab(t.id)}>
              {t.label}
            </button>
          </Magnetic>
        ))}
      </nav>

      {/* ── Anomaly banner ── */}
      {anomalyAlert && (
        <div className="wrap mt-space">
          <div className="panel" style={{ borderLeft: '3px solid var(--crit)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--crit)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                ⚠ Anomaly detected — score {anomalyAlert.score}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--paper-dim)', marginTop: 4 }}>
                {anomalyAlert.feature} via {anomalyAlert.by}
              </div>
            </div>
            <Magnetic><button className="btn" data-cx="CLOSE" onClick={() => setAnomalyAlert(null)}>Dismiss</button></Magnetic>
          </div>
        </div>
      )}

      {/* ── Main ── */}
      <main className="wrap" style={{ flex: 1, padding: '24px clamp(16px,3vw,40px) 40px' }}>

        {activeTab === 'home' && (
          <HomeTab trigger={activeTab} onEnter={() => setActiveTab('telemetry')} />
        )}

        {activeTab === 'telemetry' && (
          <div className="flex-col" style={{ gap: 24 }}>
            <section>
              <SecHead title="By The Numbers" meta="Live · updates every tick" trigger={activeTab} />
              <div className="grid g-stats">
                <Stat label="Battery" value={battPct} unit="%" decimals={1} pct={battPct}
                  tone={latest ? statTone(battPct, 40, 20, true) : 'ok'} sub={`${fmt(battPct * 0.284, 1)} VDC bus`} />
                <Stat label="Comms Signal" value={signalPct} unit="%" decimals={0} pct={signalPct}
                  tone={latest ? statTone(signalPct, 40, 15, true) : 'ok'} sub={`-${fmt(30 + (100 - signalPct) * 0.46, 0)} dBm`} />
                <Stat label="Wheel Slip" value={slipPct} unit="%" decimals={1} pct={slipPct}
                  tone={latest ? statTone(slipPct, 40, 65) : 'ok'} sub="Bekker-Wong + RNN corrected" />
                <Stat label="Chassis Tilt" value={tiltDeg} unit="°" decimals={1} pct={Math.min(100, Math.abs(tiltDeg) * 3)}
                  tone={latest ? statTone(Math.abs(tiltDeg), 15, 25) : 'ok'} sub="Pitch/roll from DEM slope" />
              </div>
            </section>

            <div className="grid g-2">
              <Panel className="flex-col">
                <div className="sec-head"><h2>Live Feed</h2>
                  <span className="meta hidden-mobile">1 reading / sec</span>
                </div>
                <div ref={feedRef} className="feed">
                  {feedLines.length === 0 && <div className="feed-line">Awaiting datastream...</div>}
                  {feedLines.map(l => (
                    <div key={l.id} className={`feed-line ${l.highlight ? 'hl' : ''}`}>
                      <span className="ts">{l.ts}</span><span>{l.text}</span>
                    </div>
                  ))}
                  <div className="feed-line"><span className="ts">SYNC</span><span className="caret" /></div>
                </div>
              </Panel>

              <Panel className="flex-col">
                <div className="sec-head"><h2>Fault Injection</h2><span className="meta">Operator controls</span></div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--paper-dim)', marginBottom: 14, lineHeight: 1.6 }}>
                  Trigger a simulated fault for demo purposes. The FDIR system and AI copilot respond autonomously.
                </p>
                <div className="btn-row">
                  <Magnetic><button className="btn" data-cx="INJECT" onClick={() => injectFault('motor_temp_spike', 'front_left', 2.0)}>Motor Overheat</button></Magnetic>
                  <Magnetic><button className="btn" data-cx="INJECT" onClick={() => injectFault('battery_drain', 'general', 1.5)}>Battery Drain</button></Magnetic>
                  <Magnetic><button className="btn" data-cx="INJECT" onClick={() => injectFault('comms_dropout', 'general', 2.0)}>Comms Dropout</button></Magnetic>
                  <Magnetic><button className="btn" data-cx="INJECT" onClick={() => injectFault('tilt_spike', 'general', 1.5)}>Tilt Spike</button></Magnetic>
                  <Magnetic><button className="btn primary" data-cx="RESET" onClick={resetBattery}>Solar Recharge</button></Magnetic>
                </div>
              </Panel>
            </div>

            <Panel>
              <div className="sec-head"><h2>Battery Trend</h2><span className="meta">{fmt(battPct, 1)}%</span></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,224,240,0.14)" />
                    <XAxis dataKey="tick" stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <YAxis domain={[0, 100]} stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <Tooltip content={<InkTooltip />} />
                    <Line type="monotone" dataKey="battery_pct" name="Battery%" stroke="#ffa63d" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel>
              <div className="sec-head"><h2>Slip &amp; Signal Trend</h2><span className="meta">Slip {fmt(slipPct, 1)}% · Sig {fmt(signalPct, 0)}%</span></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,224,240,0.14)" />
                    <XAxis dataKey="tick" stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <YAxis domain={[0, 100]} stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <Tooltip content={<InkTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
                    <Line type="monotone" dataKey="wheel_slip_pct" name="Slip%" stroke="#ff5a6e" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="comms_signal" name="Signal%" stroke="#e2c6ee" strokeOpacity={0.6} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        )}

        {activeTab === 'sensors' && (
          <div className="flex-col" style={{ gap: 24 }}>
            <div className="grid g-2">
              <Panel>
                <div className="sec-head"><h2>Motor Thermal Rig</h2><span className="meta">4 actuators</span></div>
                <WheelRig fl={fl} fr={fr} rl={rl} rr={rr} />
              </Panel>

              <div className="grid" style={{ gridTemplateColumns: '1fr', gap: 16 }}>
                <Stat label="Peak Motor Temp" value={maxMotor} unit="°C" decimals={1}
                  tone={latest ? statTone(maxMotor, 55, 75) : 'ok'} sub="FDIR trips COOL_DOWN above 55°C" />
                <Panel>
                  <div className="sec-head"><h2>RNN Learning</h2></div>
                  {rnnState ? (
                    <>
                      <div className="stat ok" style={{ border: 'none', padding: 0 }}>
                        <div className="num"><span>+{fmt(rnnState.improvement_pct, 1)}</span><span className="unit">%</span></div>
                        <div className="sub">MAE {fmt(rnnState.before_mae, 3)} → {fmt(rnnState.after_mae, 3)} · {rnnState.steps} steps</div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--paper-dim)' }}>Connecting to RNN telemetry...</div>
                  )}
                </Panel>
              </div>
            </div>

            <Panel>
              <div className="sec-head"><h2>Motor Temp Trend</h2></div>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="2 6" stroke="rgba(255,224,240,0.14)" />
                    <XAxis dataKey="tick" stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <YAxis domain={[20, 90]} stroke="rgba(255,224,240,0.45)" tick={{ fontFamily: 'JetBrains Mono', fontSize: 9 }} />
                    <Tooltip content={<InkTooltip />} />
                    <Legend wrapperStyle={{ fontFamily: 'JetBrains Mono', fontSize: 10 }} />
                    <Line type="monotone" dataKey="motor_temp.front_left" name="FL" stroke="#ffa63d" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="motor_temp.front_right" name="FR" stroke="#ffc857" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="motor_temp.rear_left" name="RL" stroke="#e2c6ee" strokeOpacity={0.5} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="motor_temp.rear_right" name="RR" stroke="#ff5a6e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>
        )}

        {activeTab === 'log' && (
          <section>
            <SecHead title="Anomaly Mission Log" meta={`${missionLog.length} logged events`} trigger={activeTab} />
            {missionLog.length === 0 ? (
              <div className="panel" style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--paper-dim)', padding: '40px 20px' }}>
                No anomalies detected — telemetry stream nominal
              </div>
            ) : (
              <div className="grid g-2">
                {missionLog.map((entry, i) => <LogSlip key={i} entry={entry} />)}
              </div>
            )}
          </section>
        )}

        {activeTab === 'copilot' && (
          <div className="grid g-2">
            <Panel className="flex-col">
              <div className="sec-head">
                <h2>Mission Copilot AI</h2>
                <span className="meta" style={{ color: connected ? 'var(--ok)' : 'var(--crit)' }}>{connected ? '● ONLINE' : '● OFFLINE'}</span>
              </div>
              <div className="quick-row">
                {['What is current status?', 'Explain last anomaly', 'Is path safe?', 'Recommend action'].map(q => (
                  <Magnetic key={q} strength={8}><button className="quick" data-cx="ASK" onClick={() => setChatInput(q)}>{q}</button></Magnetic>
                ))}
              </div>
              <div className="chat" ref={chatBoxRef}>
                {chatHistory.map((msg, i) => <ChatMsg key={i} {...msg} />)}
                {chatLoading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--signal-2)' }}>COPILOT THINKING<span className="caret" style={{ marginLeft: 4 }} /></div>}
              </div>
              <div className="chat-input-row">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Query copilot AI core..." />
                <Magnetic><button className="btn primary" data-cx="SEND" onClick={sendChat}>Send</button></Magnetic>
              </div>
            </Panel>

            <Panel>
              <div className="sec-head"><h2>Autonomous Decisions</h2><span className="meta">{decisions.length} actions</span></div>
              {decisions.length === 0 ? (
                <div style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--paper-dim)', padding: '40px 20px' }}>
                  No autonomous actions required — nominal
                </div>
              ) : (
                <div className="flex-col" style={{ gap: 10, maxHeight: 420, overflowY: 'auto' }}>
                  {decisions.slice(-10).reverse().map((d, i) => (
                    <div key={i} className="panel" style={{ borderLeft: '2px solid var(--signal)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--signal-2)', textTransform: 'uppercase' }}>{d.final_action || d.action}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--paper-dim)' }}>TICK {d.anomaly?.tick ?? d.tick}</span>
                      </div>
                      {(d.explanation || d.reasoning) && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--paper-dim)', fontStyle: 'italic', borderLeft: '1px solid var(--line-2)', paddingLeft: 8 }}>{d.explanation || d.reasoning}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        )}
      </main>

      {/* ── Footer status bar ── */}
      <footer className="footbar">
        <div className="wrap">
          <span>SYS AL-904</span>
          <span>{connected ? 'TELEMETRY LINK ACTIVE' : 'TELEMETRY LINK DOWN'}</span>
          <span className="hidden-mobile">GRID [{gridPos ? gridPos.join(', ') : '--'}]</span>
          <span>TICK {latest?.tick ?? 0}</span>
        </div>
      </footer>
      </div>
    </>
  );
}
