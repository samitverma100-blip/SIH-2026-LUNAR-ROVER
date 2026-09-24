import { useEffect, useState, useRef } from 'react';

const CHARS = '!<>-_\\/[]{}—=+*^?#________0123456789';

/**
 * Decodes `text` from random characters into itself whenever `trigger` changes.
 * Classic terminal/transmission decode effect — resolves left to right.
 */
export default function useScramble(text, trigger) {
  const [out, setOut] = useState(text);
  const raf = useRef(null);

  useEffect(() => {
    let iteration = 0;
    const totalFrames = text.length * 3 + 10;
    cancelAnimationFrame(raf.current);

    const step = () => {
      iteration += 1;
      const revealed = Math.floor((iteration / totalFrames) * text.length * 1.4);
      setOut(
        text.split('').map((ch, i) => {
          if (ch === ' ') return ' ';
          if (i < revealed) return text[i];
          return CHARS[Math.floor(Math.random() * CHARS.length)];
        }).join('')
      );
      if (iteration < totalFrames) {
        raf.current = requestAnimationFrame(step);
      } else {
        setOut(text);
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, trigger]);

  return out;
}
