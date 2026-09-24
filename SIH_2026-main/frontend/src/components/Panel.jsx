import { useRef } from 'react';

/**
 * A `.panel` section with a subtle cursor-reactive 3D tilt — pointer-fine
 * devices only. Resets smoothly on pointer leave.
 */
export default function Panel({ children, className = '', style, as: As = 'section', ...rest }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(900px) rotateX(${(-py * 5).toFixed(2)}deg) rotateY(${(px * 5).toFixed(2)}deg) translateZ(0)`;
    el.style.setProperty('--glow-x', `${(px + 0.5) * 100}%`);
    el.style.setProperty('--glow-y', `${(py + 0.5) * 100}%`);
  };
  const onLeave = () => {
    const el = ref.current;
    if (el) el.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
  };

  return (
    <As ref={ref} className={`panel tilt ${className}`} style={style}
      onMouseMove={onMove} onMouseLeave={onLeave} {...rest}>
      {children}
    </As>
  );
}
