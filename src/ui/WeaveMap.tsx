import { useMemo } from 'react';
import type { Corpus, FeedCard } from '../types';

// The totality view: every recurring concept as a node, an edge wherever two
// concepts co-occur in the same excerpts. Nothing here is synthesized -- it
// is the corpus's own co-occurrence structure, made visible.

interface NodePos {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
  seen: boolean;
}

export function WeaveMap({
  corpus,
  cards,
  viewedCardIds,
  onConceptClick,
}: {
  corpus: Corpus;
  cards: FeedCard[];
  viewedCardIds: Set<string>;
  onConceptClick: (conceptId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const W = 920;
    const H = 360;
    const cx = W / 2;
    const cy = H / 2;
    const rx = W / 2 - 110;
    const ry = H / 2 - 46;

    const seenConcepts = new Set<string>();
    for (const card of cards) {
      if (!viewedCardIds.has(card.id)) continue;
      if (card.kind === 'passage') card.concepts.forEach((c) => seenConcepts.add(c));
      if (card.kind === 'definition' || card.kind === 'formula') seenConcepts.add(card.conceptId);
    }

    const sorted = [...corpus.concepts].sort((a, b) => b.df - a.df).slice(0, 18);
    const nodes: NodePos[] = sorted.map((c, i) => {
      const angle = (2 * Math.PI * i) / sorted.length - Math.PI / 2;
      return {
        id: c.id,
        label: c.label,
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
        r: 5 + Math.min(9, c.df),
        seen: seenConcepts.has(c.id),
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const edges: { a: NodePos; b: NodePos; w: number }[] = [];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const shared = sorted[i].passageIds.filter((p) => sorted[j].passageIds.includes(p)).length;
        if (shared >= 2) {
          edges.push({ a: byId.get(sorted[i].id)!, b: byId.get(sorted[j].id)!, w: shared });
        }
      }
    }
    edges.sort((x, y) => y.w - x.w);
    return { nodes, edges: edges.slice(0, 36) };
  }, [corpus, cards, viewedCardIds]);

  return (
    <div className="weave-map">
      <svg viewBox="0 0 920 360" role="img" aria-label="Concept co-occurrence map">
        {edges.map((e, i) => (
          <line
            key={i}
            x1={e.a.x}
            y1={e.a.y}
            x2={e.b.x}
            y2={e.b.y}
            className={`map-edge ${e.a.seen && e.b.seen ? 'lit' : ''}`}
            strokeWidth={Math.min(3, 0.6 + e.w * 0.5)}
          />
        ))}
        {nodes.map((n) => (
          <g
            key={n.id}
            className={`map-node ${n.seen ? 'seen' : ''}`}
            onClick={() => onConceptClick(n.id)}
          >
            <circle cx={n.x} cy={n.y} r={n.r} />
            <text x={n.x} y={n.y - n.r - 6} textAnchor="middle">
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="map-caption">
        The corpus's own structure: nodes are recurring terms, edges mean “these appear in the same
        excerpts”. It lights up as you read.
      </div>
    </div>
  );
}
