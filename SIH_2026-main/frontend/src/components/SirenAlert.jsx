import { useEffect, useRef } from 'react';
import { playSiren } from '../lib/audio.js';

/**
 * Persistent alarm dressing shown whenever the rover is in a non-nominal
 * mode: rotating corner beacons, a sliding hazard-stripe bar, and a
 * pulsing warning cross. Fires a synthesized siren wail on transition
 * into (or escalation within) an alert state.
 */
export default function SirenAlert({ tone }) {
  const prevTone = useRef('ok');

  useEffect(() => {
    if (tone !== 'ok' && tone !== prevTone.current) {
      playSiren(tone === 'crit');
    }
    prevTone.current = tone;
  }, [tone]);

  if (tone === 'ok') return null;

  return (
    <div className={`siren siren-${tone}`}>
      <div className="siren-beacon siren-beacon-l" />
      <div className="siren-beacon siren-beacon-r" />
      <div className="siren-stripes" />
      <div className="siren-cross" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <rect x="46" y="6" width="8" height="88" rx="3" transform="rotate(45 50 50)" fill="currentColor" />
          <rect x="46" y="6" width="8" height="88" rx="3" transform="rotate(-45 50 50)" fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}
