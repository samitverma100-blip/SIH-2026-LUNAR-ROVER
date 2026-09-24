import { useEffect, useRef } from 'react';

/**
 * Two-layer custom cursor: a tight dot plus a lagging ring.
 * Any element with data-cx="label" grows the ring and shows the label.
 * Disabled automatically on touch/coarse-pointer devices.
 */
export default function Cursor() {
  const dotRef = useRef(null);
  const ringRef = useRef(null);
  const pos = useRef({ x: 0, y: 0 });
  const ring = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    if (!fine) return;
    document.documentElement.classList.add('has-fine-pointer');

    const onMove = (e) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0) translate(-50%, -50%)`;
      }
      const target = e.target.closest?.('[data-cx]');
      if (ringRef.current) {
        if (target) {
          ringRef.current.classList.add('active');
          ringRef.current.textContent = target.getAttribute('data-cx') || '';
        } else {
          ringRef.current.classList.remove('active');
          ringRef.current.textContent = '';
        }
      }
    };

    let raf;
    const loop = () => {
      ring.current.x += (pos.current.x - ring.current.x) * 0.18;
      ring.current.y += (pos.current.y - ring.current.y) * 0.18;
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%)`;
      }
      raf = requestAnimationFrame(loop);
    };
    loop();

    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('has-fine-pointer');
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cx-dot" />
      <div ref={ringRef} className="cx-ring" />
    </>
  );
}
