import { cloneElement, useRef } from 'react';

/**
 * Wraps a single interactive child (button, tab) and pulls it gently
 * toward the cursor when nearby — resets with a spring-like transition.
 */
export default function Magnetic({ children, strength = 14 }) {
  const ref = useRef(null);

  const onMove = (e) => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2);
    const y = e.clientY - (r.top + r.height / 2);
    el.style.transform = `translate(${(x / r.width) * strength}px, ${(y / r.height) * strength}px)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = 'translate(0, 0)';
  };

  return cloneElement(children, {
    ref,
    onMouseMove: (e) => { onMove(e); children.props.onMouseMove?.(e); },
    onMouseLeave: (e) => { onLeave(e); children.props.onMouseLeave?.(e); },
    className: `${children.props.className || ''} magnetic`.trim(),
  });
}
