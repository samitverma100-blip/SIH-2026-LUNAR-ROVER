import { useEffect, useRef } from 'react';

const SKY = ['#ff8a5b', '#ff5da2', '#8b5cf6', '#22c1c3', '#ffc857'];

function toneColor(tone) {
  if (tone === 'crit') return '#ff5a6e';
  if (tone === 'warn') return '#ffc857';
  return '#ff3d81';
}

/**
 * Full-viewport generative "aurora" backdrop — no dependencies, canvas 2D only.
 * Layers:
 *   1. Large soft-edged color blobs (screen blend) that drift AND get pulled
 *      strongly toward the cursor, at different depths — the parallax is
 *      large and obvious, not subtle.
 *   2. A field of small glowing dust motes that individually repel away from
 *      the cursor within a radius, then drift back — a direct, playable
 *      mouse interaction.
 *   3. A comet-style particle trail spawned right at the cursor as it moves.
 *   4. A stylised lunar horizon silhouette with an animated rim-light scan
 *      that recolors with the current rover mode.
 */
export default function AuroraCanvas({ alertTone = 'ok' }) {
  const canvasRef = useRef(null);
  const toneRef = useRef(alertTone);
  toneRef.current = alertTone;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let raf = null;
    let w = 0, h = 0, dpr = Math.min(2, window.devicePixelRatio || 1);

    const mouse = { x: 0, y: 0, active: false };
    const onMove = (e) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      spawnTrail(e.clientX, e.clientY);
    };
    // `mouseleave` (not `mouseout`) on `document` — it doesn't bubble, so it
    // only fires when the pointer truly exits the viewport, not on every
    // child-element transition (which `mouseout` does, constantly resetting
    // `active` to false while moving across a content-dense dashboard).
    const onLeave = () => { mouse.active = false; };
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);

    const rand = (a, b) => a + Math.random() * (b - a);

    // ── Blobs ────────────────────────────────────────────────
    let blobs = [];
    const buildBlobs = () => {
      blobs = SKY.map((color, i) => ({
        color,
        homeX: (0.15 + (i / SKY.length) * 0.8) * w,
        homeY: rand(0.1, 0.55) * h,
        x: 0, y: 0,
        r: rand(0.22, 0.34) * Math.max(w, h),
        depth: 0.3 + (i / SKY.length) * 0.9,
        phase: rand(0, Math.PI * 2),
        speed: rand(0.15, 0.3),
      }));
      blobs.forEach(b => { b.x = b.homeX; b.y = b.homeY; });
    };

    // ── Dust particles ──────────────────────────────────────
    let dust = [];
    const buildDust = () => {
      const count = Math.min(110, Math.floor((w * h) / 9000));
      dust = Array.from({ length: count }, () => ({
        baseX: rand(0, w), baseY: rand(0, h * 0.85),
        x: 0, y: 0, vx: 0, vy: 0,
        r: rand(1, 2.6),
        color: SKY[Math.floor(rand(0, SKY.length))],
        phase: rand(0, Math.PI * 2),
        speed: rand(0.4, 1.2),
      }));
      dust.forEach(p => { p.x = p.baseX; p.y = p.baseY; });
    };

    // ── Cursor comet trail ──────────────────────────────────
    let trail = [];
    function spawnTrail(x, y) {
      for (let i = 0; i < 2; i++) {
        trail.push({
          x: x + rand(-4, 4), y: y + rand(-4, 4), life: 1,
          color: SKY[Math.floor(rand(0, SKY.length))], r: rand(3, 6.5),
        });
      }
      if (trail.length > 70) trail.splice(0, trail.length - 70);
    }

    // ── Terrain ──────────────────────────────────────────────
    let terrain = [];
    const buildTerrain = () => {
      const pts = 24;
      terrain = Array.from({ length: pts + 1 }, (_, i) => {
        const x = (w / pts) * i;
        const base = h * 0.9;
        const ridge = Math.sin(i * 0.7) * 10 + Math.sin(i * 1.9) * 6 + rand(-6, 6);
        return { x, y: base - ridge };
      });
    };

    const resize = () => {
      w = window.innerWidth; h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildBlobs();
      buildDust();
      buildTerrain();
    };
    resize();
    window.addEventListener('resize', resize);

    let scan = 0;

    const draw = (now) => {
      ctx.clearRect(0, 0, w, h);

      // Base wash so the canvas always reads as colorful even before blooms
      const wash = ctx.createLinearGradient(0, 0, w, h);
      wash.addColorStop(0, 'rgba(139,92,246,0.10)');
      wash.addColorStop(1, 'rgba(34,193,195,0.08)');
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, w, h);

      // ── Blobs: strong mouse parallax, additive bloom ──────
      ctx.globalCompositeOperation = 'screen';
      const mx = mouse.active ? mouse.x : w / 2;
      const my = mouse.active ? mouse.y : h / 2;
      const cx = w / 2, cy = h / 2;
      for (const b of blobs) {
        const pull = (mx - cx) * 0.6 * b.depth;
        const pullY = (my - cy) * 0.6 * b.depth;
        const driftX = Math.sin(now * 0.00012 * b.speed + b.phase) * 40;
        const driftY = Math.cos(now * 0.00015 * b.speed + b.phase) * 30;
        const targetX = b.homeX + pull + driftX;
        const targetY = b.homeY + pullY + driftY;
        b.x += (targetX - b.x) * 0.045;
        b.y += (targetY - b.y) * 0.045;

        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        grad.addColorStop(0, b.color + '55');
        grad.addColorStop(1, b.color + '00');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // ── Dust motes: repel from cursor, drift otherwise ────
      for (const p of dust) {
        const driftX = Math.sin(now * 0.0006 * p.speed + p.phase) * 14;
        const driftY = Math.cos(now * 0.0005 * p.speed + p.phase) * 10;
        let targetX = p.baseX + driftX;
        let targetY = p.baseY + driftY;

        if (mouse.active) {
          const dx = p.x - mouse.x, dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          const radius = 190;
          if (dist < radius && dist > 0.01) {
            const push = (1 - dist / radius) * 110;
            targetX += (dx / dist) * push;
            targetY += (dy / dist) * push;
          }
        }
        p.x += (targetX - p.x) * 0.16;
        p.y += (targetY - p.y) * 0.16;

        const tw = 0.5 + 0.5 * Math.sin(now * 0.002 * p.speed + p.phase);
        ctx.globalAlpha = 0.55 + tw * 0.45;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ── Cursor comet trail ─────────────────────────────────
      ctx.globalCompositeOperation = 'screen';
      for (let i = trail.length - 1; i >= 0; i--) {
        const t = trail[i];
        ctx.globalAlpha = t.life * 0.95;
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * t.life, 0, Math.PI * 2);
        ctx.fill();
        t.life -= 0.035;
        t.y -= 0.5;
        if (t.life <= 0) trail.splice(i, 1);
      }
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // ── Lunar horizon silhouette ───────────────────────────
      const mxShift = mouse.active ? (mouse.x / w - 0.5) * 10 : 0;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (const p of terrain) ctx.lineTo(p.x + mxShift, p.y);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = 'rgba(43, 20, 77, 0.55)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 241, 220, 0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      terrain.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x + mxShift, p.y) : ctx.lineTo(p.x + mxShift, p.y)));
      ctx.stroke();

      // Scanning rim-glow across the terrain band, colored by rover mode
      scan += 0.006;
      const sx = ((Math.sin(scan) + 1) / 2) * w;
      const tone = toneColor(toneRef.current);
      const glow = ctx.createLinearGradient(sx - 110, 0, sx + 110, 0);
      glow.addColorStop(0, tone + '00');
      glow.addColorStop(0.5, tone + '33');
      glow.addColorStop(1, tone + '00');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 110, h * 0.82, 220, h * 0.18);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return <canvas ref={canvasRef} className="aurora-canvas" />;
}
