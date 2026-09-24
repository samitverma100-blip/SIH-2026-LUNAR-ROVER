import useScramble from '../hooks/useScramble.js';

/** Section header whose title decode-scrambles in whenever `trigger` changes. */
export default function SecHead({ title, meta, trigger }) {
  const shown = useScramble(title.toUpperCase(), trigger);
  return (
    <div className="sec-head">
      <h2 className="scramble">{shown}</h2>
      {meta && <span className="meta">{meta}</span>}
    </div>
  );
}
