import { useEffect, useRef, useState } from 'react';
import { playChime, playBlip } from '../lib/audio.js';

const LOG_LINES = [
  'ESTABLISHING DEEP-SPACE LINK...',
  'TRIANGULATING LUNAR ORBIT...',
  'LOADING DEM TERRAIN GRID...',
  'CALIBRATING BEKKER-WONG TERRAMECHANICS...',
  'SYNCING ONLINE GRU CORRECTION MODEL...',
  'WAKING AI MISSION COPILOT...',
  'SIGNAL LOCK ACQUIRED',
];

const STAGE_LABEL = [
  'ACQUIRING SIGNAL',
  'MAPPING TERRAIN',
  'CALIBRATING PHYSICS',
  'SYNCING NEURAL MODEL',
  'COPILOT ONLINE',
];

const SKY = ['#ff8a5b', '#ff5da2', '#8b5cf6', '#22c1c3', '#ffc857'];
const N_PARTICLES = 260;
const ASSEMBLE_MS = 1500;
const LOCK_MS = 2950;
const EXPLODE_START_MS = 3150;
const TOTAL_MS = 3700;

function fibonacciSphere(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const rY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    pts.push({ x: Math.cos(theta) * rY, y, z: Math.sin(theta) * rY });
  }
  return pts;
}

export default function BootSequence({ onDone }) {
  const canvasRef = useRef(null);
  const [shown, setShown] = useState(0);
  const [progress, setProgress] = useState(0);
  const [stageIdx, setStageIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [locked, setLocked] = useState(false);
  const doneRef = useRef(false);
  const lastLineCount = useRef(0);
  const lockedFiredRef = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(onDone, 520);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const rand = (a, b) => a + Math.random() * (b - a);
    const sphere = fibonacciSphere(N_PARTICLES);
    const particles = sphere.map((s, i) => ({
      sx: s.x, sy: s.y, sz: s.z,
      color: SKY[i % SKY.length],
      scatterX: rand(0, w), scatterY: rand(0, h),
    }));

    const start = performance.now();
    let raf = null;

    const draw = (now) => {
      const elapsed = now - start;
      const p = Math.min(1, elapsed / TOTAL_MS);

      // Drive the DOM overlay (log lines / progress / stage) from the same clock.
      const lineCount = Math.min(LOG_LINES.length, Math.floor((elapsed / 2500) * LOG_LINES.length));
      if (lineCount !== lastLineCount.current) {
        lastLineCount.current = lineCount;
        if (lineCount > 0) playBlip();
        setShown(lineCount);
      }
      setProgress(Math.min(1, elapsed / (EXPLODE_START_MS - 200)));
      setStageIdx(Math.min(STAGE_LABEL.length - 1, Math.floor(p * STAGE_LABEL.length)));
      if (elapsed >= LOCK_MS && !lockedFiredRef.current) {
        lockedFiredRef.current = true;
        setLocked(true);
        playChime();
      }

      ctx.clearRect(0, 0, w, h);

      const cx = w / 2, cy = h * 0.42;
      const R = Math.min(w, h) * 0.16;
      const focal = 420;
      const rot = elapsed * 0.00055;
      const tilt = 0.38;
      const assembleP = Math.min(1, elapsed / ASSEMBLE_MS);
      const eased = 1 - Math.pow(1 - assembleP, 3);
      const explodeP = elapsed > EXPLODE_START_MS ? Math.min(1, (elapsed - EXPLODE_START_MS) / (TOTAL_MS - EXPLODE_START_MS)) : 0;

      // Orbit ring (drawn behind particles)
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot * 0.4);
      ctx.scale(1, 0.32);
      ctx.strokeStyle = `rgba(255,241,220,${0.18 * eased * (1 - explodeP)})`;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Radar pulses
      for (let ring = 0; ring < 2; ring++) {
        const cycle = 1400;
        const t2 = ((elapsed + ring * cycle * 0.5) % cycle) / cycle;
        ctx.strokeStyle = SKY[ring % SKY.length] + Math.floor((1 - t2) * 60).toString(16).padStart(2, '0');
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1 + t2 * 2.2), 0, Math.PI * 2);
        ctx.stroke();
      }

      // Particle sphere
      ctx.globalCompositeOperation = 'screen';
      const cosA = Math.cos(rot), sinA = Math.sin(rot);
      for (const pt of particles) {
        const x1 = pt.sx * cosA - pt.sz * sinA;
        const z1 = pt.sx * sinA + pt.sz * cosA;
        const y1 = pt.sy * Math.cos(tilt) - z1 * Math.sin(tilt);
        const z2 = pt.sy * Math.sin(tilt) + z1 * Math.cos(tilt);

        const scale = focal / (focal + z2 * R + R);
        const targetX = cx + x1 * R * scale;
        const targetY = cy + y1 * R * scale;

        const curX = pt.scatterX + (targetX - pt.scatterX) * eased;
        const curY = pt.scatterY + (targetY - pt.scatterY) * eased;

        const dx = curX - cx, dy = curY - cy;
        const explodeMul = 1 + explodeP * explodeP * 6;
        const fx = cx + dx * explodeMul;
        const fy = cy + dy * explodeMul;

        const alpha = (0.4 + 0.6 * scale) * (1 - explodeP);
        const r = Math.max(0.7, 2.6 * scale);

        ctx.globalAlpha = Math.max(0, alpha);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(fx, fy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (elapsed < TOTAL_MS && !doneRef.current) {
        raf = requestAnimationFrame(draw);
      } else {
        finish();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`boot ${leaving ? 'leaving' : ''}`}>
      <canvas ref={canvasRef} className="boot-canvas" />
      <div className={`boot-inner ${locked ? 'locked' : ''}`}>
        <div className="boot-stage">{STAGE_LABEL[stageIdx]}</div>
        <div className="boot-mark">TRANSMISSION<span>/</span>COPILOT</div>
        <div className="boot-log">
          {LOG_LINES.slice(0, shown).map((l, i) => (
            <div key={i} className="boot-line" style={{ animationDelay: `${i * 0.03}s` }}>
              <span className="boot-caret">›</span> {l}
            </div>
          ))}
        </div>
        <div className="boot-bar"><div className="boot-bar-fill" style={{ width: `${progress * 100}%` }} /></div>
      </div>
      <button className="boot-skip" onClick={finish}>SKIP ▸</button>
    </div>
  );
}
