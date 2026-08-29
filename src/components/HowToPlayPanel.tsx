import type { ControlHint } from '../types/game';

export default function HowToPlayPanel({ controls }: { controls: ControlHint[] }) {
  return (
    <details className="how-to-play">
      <summary>How to play</summary>
      <dl>
        {controls.map((c) => (
          <div key={c.action} className="how-to-play__row">
            <dt>{c.action}</dt>
            <dd>{c.how}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
