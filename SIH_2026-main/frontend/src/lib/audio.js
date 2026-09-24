/**
 * Tiny synthesized sound engine — no audio files, just oscillators.
 * Lazily creates a single AudioContext on first use (browsers block audio
 * before a user gesture, so the very first call may be silently skipped —
 * that's fine, real usage always follows a click).
 */
let ctx = null;
const getCtx = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/** Call once on the first user gesture so the browser's autoplay policy unlocks audio. */
export const unlock = () => { getCtx(); };

const MUTE_KEY = 'transmission-copilot-muted';
export const isMuted = () => localStorage.getItem(MUTE_KEY) === '1';
export const setMuted = (m) => localStorage.setItem(MUTE_KEY, m ? '1' : '0');
export const toggleMuted = () => { const m = !isMuted(); setMuted(m); return m; };

function tone(freqStart, freqEnd, duration, { type = 'sine', gain = 0.12, delay = 0 } = {}) {
  if (isMuted()) return;
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const amp = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + duration * 0.15);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Two-tone ascending "lock acquired" chime for the boot sequence finale. */
export function playChime() {
  tone(440, 880, 0.18, { type: 'sine', gain: 0.1 });
  tone(660, 1320, 0.22, { type: 'sine', gain: 0.09, delay: 0.14 });
}

/** Short emergency-style wail. `urgent` = faster/higher for critical states. */
export function playSiren(urgent = false) {
  const ac = getCtx();
  if (!ac || isMuted()) return;
  const cycles = urgent ? 4 : 2;
  const cycleDur = urgent ? 0.22 : 0.4;
  for (let i = 0; i < cycles; i++) {
    const delay = i * cycleDur;
    tone(urgent ? 620 : 480, urgent ? 1000 : 760, cycleDur * 0.95, {
      type: 'sawtooth', gain: urgent ? 0.07 : 0.06, delay,
    });
  }
}

/** Soft UI blip for boot-log lines ticking in. */
export function playBlip() {
  tone(320, 420, 0.05, { type: 'square', gain: 0.035 });
}
