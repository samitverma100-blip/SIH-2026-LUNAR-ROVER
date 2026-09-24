function tempTone(t) {
  if (t >= 75) return '#ff5a6e';
  if (t >= 55) return '#ffc857';
  return '#ffa63d';
}

function Wheel({ pos, label, temp }) {
  const color = tempTone(temp);
  return (
    <div className={`rig-wheel wheel-${pos}`} style={{ color }}>
      <span className="hz" />
      <span className="t">{Number.isFinite(temp) ? temp.toFixed(0) : '--'}°</span>
      <span>{label}</span>
    </div>
  );
}

export default function WheelRig({ fl, fr, rl, rr }) {
  return (
    <div className="rig">
      <div className="rig-chassis">
        <svg viewBox="0 0 160 220" fill="none">
          <rect x="34" y="26" width="92" height="168" rx="10" stroke="var(--line-2)" strokeWidth="1.5" />
          <line x1="34" y1="60" x2="126" y2="60" stroke="var(--line)" />
          <line x1="34" y1="160" x2="126" y2="160" stroke="var(--line)" />
          <circle cx="80" cy="110" r="18" stroke="var(--line-2)" strokeWidth="1.5" />
          <path d="M80 92 L80 128 M62 110 L98 110" stroke="var(--line-2)" strokeWidth="1" />
        </svg>
        <Wheel pos="fl" label="FL" temp={fl} />
        <Wheel pos="fr" label="FR" temp={fr} />
        <Wheel pos="rl" label="RL" temp={rl} />
        <Wheel pos="rr" label="RR" temp={rr} />
      </div>
    </div>
  );
}
