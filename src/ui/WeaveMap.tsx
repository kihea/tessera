import { useMemo } from 'react';
import type { Corpus, Dimension, FeedCard } from '../types';

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
  kind?: 'form' | 'attribute';
  dim?: Dimension; // 1-5 dimensional layer, for node coloring
}

/** Typed, degreed edges (from the knowledge graph) for the graph screen. */
export interface MapEdge {
  a: string;
  b: string;
  degree: number;
  /** -1..1 signed intensity; negative reads as tension/opposition. */
  intensity?: number;
  kind: 'associative' | 'abstraction' | 'attribute' | 'semantic';
}

export function WeaveMap({
  corpus,
  cards,
  viewedCardIds,
  onConceptClick,
  edges: graphEdges,
}: {
  corpus: Corpus;
  cards: FeedCard[];
  viewedCardIds: Set<string>;
  onConceptClick: (conceptId: string) => void;
  /** When supplied (graph screen), render these typed/degree edges instead of
   *  the on-the-fly co-occurrence edges, and show every subgraph node. */
  edges?: MapEdge[];
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

    // Graph screen shows the whole (bounded) subgraph; a live session shows the
    // densest 18 concepts.
    const sorted = [...corpus.concepts]
      .sort((a, b) => b.df - a.df)
      .slice(0, graphEdges ? 40 : 18);
    const n = Math.max(1, sorted.length); // never divide by zero
    const num = (v: number, d: number) => (Number.isFinite(v) ? v : d); // no NaN reaches the SVG
    const nodes: NodePos[] = sorted.map((c, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return {
        id: c.id,
        label: c.label,
        x: num(cx + rx * Math.cos(angle), cx),
        y: num(cy + ry * Math.sin(angle), cy),
        r: num(5 + Math.min(9, c.df), 5),
        seen: seenConcepts.has(c.id),
        kind: c.kind,
        dim: c.dimension,
      };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));

    const edges: { a: NodePos; b: NodePos; w: number; kind: MapEdge['kind']; tension: boolean }[] = [];
    if (graphEdges) {
      for (const e of graphEdges) {
        const a = byId.get(e.a);
        const b = byId.get(e.b);
        if (a && b) edges.push({ a, b, w: 0.5 + e.degree * 3, kind: e.kind, tension: (e.intensity ?? 0) < -0.05 });
      }
    } else {
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const shared = sorted[i].passageIds.filter((p) => sorted[j].passageIds.includes(p)).length;
          if (shared >= 2) {
            edges.push({
              a: byId.get(sorted[i].id)!,
              b: byId.get(sorted[j].id)!,
              w: shared,
              kind: 'associative',
              tension: false,
            });
          }
        }
      }
    }
    edges.sort((x, y) => y.w - x.w);
    return { nodes, edges: edges.slice(0, graphEdges ? 80 : 36) };
  }, [corpus, cards, viewedCardIds, graphEdges]);

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
            className={`map-edge edge-${e.kind} ${e.tension ? 'tension' : ''} ${e.a.seen && e.b.seen ? 'lit' : ''}`}
            strokeWidth={Math.min(3.4, graphEdges ? e.w : 0.6 + e.w * 0.5)}
            strokeDasharray={
              e.kind === 'attribute' ? '4 3' : e.kind === 'semantic' ? '1 4' : undefined
            }
          />
        ))}
        {nodes.map((n) => (
          <g
            key={n.id}
            className={`map-node ${n.seen ? 'seen' : ''} ${n.kind ?? ''} ${n.dim ? `dim-${n.dim}` : ''}`}
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
