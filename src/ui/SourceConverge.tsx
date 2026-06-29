// The "gathering sources" indicator: one node per provider flies in from the
// rim and settles at the center "tessera" tile the moment its real result lands
// (ok), or dims in place (fail). A pure function of the live ProviderProgress[]
// -- no extra state, no engine coupling. The aria-live count line is the
// accessible source of truth; the SVG is decorative and respects reduced motion.

import { useRef } from 'react';
import type { ProviderProgress } from '../types';

const SIZE = 220;
const C = SIZE / 2;
const RIM = 94; // radius where pending sources wait before converging
const GOLDEN = 2.399963229; // golden angle (rad) -> even, stable spread

export function SourceConverge({ progress }: { progress: ProviderProgress[] }) {
  // One stable angle per provider name, assigned in arrival order and kept
  // across renders so a node settles (never jumps) when its status flips.
  const slots = useRef(new Map<string, number>());
  for (const p of progress) {
    if (!slots.current.has(p.name)) slots.current.set(p.name, slots.current.size * GOLDEN);
  }

  const ok = progress.filter((p) => p.status === 'ok');
  const excerpts = ok.reduce((s, p) => s + p.passages, 0);

  return (
    <div className="converge">
      <svg
        className="converge-svg"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        focusable="false"
      >
        <circle className="converge-ring" cx={C} cy={C} r={RIM} />
        <circle className="converge-ring" cx={C} cy={C} r={RIM * 0.55} />
        {progress.map((p) => {
          const a = slots.current.get(p.name) ?? 0;
          const rx = C + RIM * Math.cos(a);
          const ry = C + RIM * Math.sin(a);
          const settled = p.status === 'ok';
          const failed = p.status === 'fail';
          return (
            <g key={p.name} className={`converge-node ${p.status}`}>
              {settled && <line className="converge-thread" x1={rx} y1={ry} x2={C} y2={C} />}
              <circle
                cx={settled ? C : rx}
                cy={settled ? C : ry}
                r={settled ? 4.5 : failed ? 3 : 3.5}
              />
            </g>
          );
        })}
        <rect
          className="converge-core"
          x={C - 9}
          y={C - 9}
          width={18}
          height={18}
          rx={3}
          transform={`rotate(45 ${C} ${C})`}
        />
      </svg>
      <p className="converge-count" aria-live="polite" role="status">
        {ok.length > 0
          ? `Gathered ${ok.length} source${ok.length === 1 ? '' : 's'} · ${excerpts} excerpt${
              excerpts === 1 ? '' : 's'
            } so far`
          : 'Reaching out to the archives…'}
      </p>
    </div>
  );
}
