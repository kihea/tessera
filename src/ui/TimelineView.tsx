import { useMemo } from 'react';
import type { Corpus } from '../types';
import { formatYear } from '../weave/chronology';

// A chronological view of a subgraph showing only its 5th-DIMENSIONAL concepts --
// societies, sciences, ideologies, movements (not 1st/3rd forms) -- each placed at
// its REPRESENTATIVE (median) year, so the *conceptual* history reads in order. The
// median is robust to a stray outlier date; years come from each concept's verbatim
// passages via the caller. The board scrolls horizontally so long spans stay legible.

const H = 340;
const PAD_X = 56;
const TOP = 26;
const AXIS_Y = H - 34;
const LANES = 9;
const PX_PER_NODE = 66; // horizontal room per concept; widens the board so it scrolls

export function TimelineView({
  corpus,
  eras,
  onConceptClick,
  seenConcepts,
}: {
  corpus: Corpus;
  eras: Map<string, number>; // conceptId -> representative (median) year
  onConceptClick: (conceptId: string) => void;
  seenConcepts?: Set<string>;
}) {
  const layout = useMemo(() => {
    // 5th-dimensional concepts only -- the conceptual layer, not concrete forms.
    const dated = corpus.concepts
      .filter((c) => c.dimension === 5 && eras.has(c.id))
      .map((c) => ({ c, year: eras.get(c.id)! }))
      .sort((a, b) => a.year - b.year);
    if (dated.length === 0) return null;

    const W = Math.max(900, dated.length * PX_PER_NODE); // dynamic -> scrolls when dense
    const minY = dated[0].year;
    const maxY = dated[dated.length - 1].year;
    const span = Math.max(1, maxY - minY);
    const num = (v: number, d: number) => (Number.isFinite(v) ? v : d); // no NaN reaches the SVG
    const x = (year: number) => num(PAD_X + ((year - minY) / span) * (W - 2 * PAD_X), PAD_X);

    // Greedy lane assignment so labels stop overlapping.
    const laneEnd: number[] = new Array(LANES).fill(-Infinity);
    const placed = dated.map((d) => {
      const px = x(d.year);
      const estW = Math.min(160, 22 + d.c.label.length * 6.6);
      let lane = laneEnd.findIndex((e) => px > e + 10);
      if (lane === -1) lane = laneEnd.indexOf(Math.min(...laneEnd));
      laneEnd[lane] = px + estW;
      const y = TOP + (lane * (AXIS_Y - TOP - 14)) / Math.max(1, LANES - 1);
      return { ...d, px, y };
    });

    const TICKS = Math.min(10, Math.max(4, Math.round(W / 150)));
    const ticks = Array.from({ length: TICKS + 1 }, (_, i) => {
      const year = Math.round(minY + (span * i) / TICKS);
      return { year, x: x(year) };
    });
    return { placed, ticks, W };
  }, [corpus, eras]);

  if (!layout) return null;
  const { W } = layout;

  return (
    <div className="timeline-scroll">
      <svg className="timeline-map" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Concept timeline (5th-dimensional)">
        <line className="tl-axis" x1={PAD_X} y1={AXIS_Y} x2={W - PAD_X} y2={AXIS_Y} />
        {layout.ticks.map((t, i) => (
          <g key={i} className="tl-tick">
            <line x1={t.x} y1={AXIS_Y} x2={t.x} y2={AXIS_Y + 5} />
            <text x={t.x} y={AXIS_Y + 18} textAnchor="middle">
              {formatYear(t.year)}
            </text>
          </g>
        ))}
        {layout.placed.map((n) => {
          const labelRight = n.px > W * 0.82;
          return (
            <g
              key={n.c.id}
              className={`tl-node ${seenConcepts?.has(n.c.id) ? 'seen' : ''}`}
              onClick={() => onConceptClick(n.c.id)}
            >
              <line className="tl-stem" x1={n.px} y1={n.y + 4} x2={n.px} y2={AXIS_Y} />
              <circle cx={n.px} cy={n.y} r={4} />
              <text x={n.px + (labelRight ? -7 : 7)} y={n.y + 3} textAnchor={labelRight ? 'end' : 'start'}>
                {n.c.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
