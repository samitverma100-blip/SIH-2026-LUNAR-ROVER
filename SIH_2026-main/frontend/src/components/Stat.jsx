import { useEffect, useRef, useState } from 'react';

/** Smoothly tweens a numeric readout instead of snapping — kinetic numeral feel. */
function useAnimatedNumber(value, decimals = 0) {
  const [display, setDisplay] = useState(value ?? 0);
  const raf = useRef(null);
  const from = useRef(value ?? 0);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const start = from.current;
    const t0 = performance.now();
    const dur = 600;
    cancelAnimationFrame(raf.current);

    const step = (t) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(start + (target - start) * eased);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return display.toFixed(decimals);
}

export default function Stat({ label, value, unit = '', decimals = 0, sub, pct, tone = 'ok' }) {
  const shown = useAnimatedNumber(value, decimals);
  const [flash, setFlash] = useState(false);
  const prevTone = useRef(tone);

  useEffect(() => {
    if (prevTone.current !== tone) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      prevTone.current = tone;
      return () => clearTimeout(t);
    }
  }, [tone]);

  return (
    <div className={`stat ${tone} ${flash ? 'flash' : ''}`}>
      <div className="label"><span>{label}</span></div>
      <div className="num">
        <span>{shown}</span>
        {unit && <span className="unit">{unit}</span>}
      </div>
      {sub && <div className="sub">{sub}</div>}
      {pct != null && <div className="bar" style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />}
    </div>
  );
}
