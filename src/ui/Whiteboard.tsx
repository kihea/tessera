import { useEffect, useRef, useState } from 'react';
import { loadWhiteboard, saveWhiteboard } from '../state/storage';
import type { WhiteboardData } from '../state/storage';

// A free-form board in the notebook where the learner lays out THEIR OWN idea
// nodes and draws the connections between them -- the synthesis the app never
// makes for them. Hand-rolled SVG (same pattern as WeaveMap), no deps. Persisted
// per topic in localStorage. Drag to move; click two nodes to connect; × deletes.

const W = 820;
const H = 460;

export function Whiteboard({ slug }: { slug: string }) {
  const [board, setBoard] = useState<WhiteboardData>(() => loadWhiteboard(slug) ?? { nodes: [], edges: [] });
  const [label, setLabel] = useState('');
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [pendingPos, setPendingPos] = useState<{ x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);

  // Reload when the topic changes, and persist on every change.
  useEffect(() => {
    setBoard(loadWhiteboard(slug) ?? { nodes: [], edges: [] });
    setLinkFrom(null);
  }, [slug]);
  useEffect(() => {
    saveWhiteboard(slug, board);
  }, [slug, board]);

  const toSvg = (e: { clientX: number; clientY: number }): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const addNode = () => {
    const t = label.trim();
    if (!t) return;
    const id = `n${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const p = pendingPos; // where the user clicked, if any
    setBoard((b) => ({
      ...b,
      nodes: [
        ...b.nodes,
        {
          id,
          x: p ? p.x : W / 2 + ((b.nodes.length % 5) - 2) * 24,
          y: p ? p.y : 70 + ((b.nodes.length * 46) % (H - 140)),
          label: t,
        },
      ],
    }));
    setLabel('');
    setPendingPos(null);
  };

  const onNodeDown = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* pointer capture is best-effort; dragging still works without it */
    }
    drag.current = { id, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const pos = toSvg(e);
    if (!pos) return;
    d.moved = true;
    // Reference the captured `d`, never `drag.current!`, inside the updater: pointerup
    // can null drag.current before React runs this updater, and the non-null assertion
    // would then dereference null and crash mid-drag.
    setBoard((b) => ({
      ...b,
      nodes: b.nodes.map((n) => (n.id === d.id ? { ...n, x: pos.x, y: pos.y } : n)),
    }));
  };
  const onNodeUp = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    const wasDrag = drag.current?.moved;
    drag.current = null;
    if (wasDrag) return; // it was a move, not a click
    // Click-to-link, computed from current state. NB: never nest one setState
    // inside another's updater (updaters must be pure -- React 19 throws / double
    // -fires in StrictMode, which crashed the board when connecting two nodes).
    if (linkFrom === null || linkFrom === id) {
      setLinkFrom(linkFrom === id ? null : id);
      return;
    }
    const from = linkFrom;
    setBoard((b) =>
      b.edges.some((x) => (x.from === from && x.to === id) || (x.from === id && x.to === from))
        ? b
        : { ...b, edges: [...b.edges, { from, to: id }] },
    );
    setLinkFrom(null);
  };
  const del = (id: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    drag.current = null;
    setBoard((b) => ({
      nodes: b.nodes.filter((n) => n.id !== id),
      edges: b.edges.filter((x) => x.from !== id && x.to !== id),
    }));
    setLinkFrom((f) => (f === id ? null : f));
  };

  const pos = new Map(board.nodes.map((n) => [n.id, n] as const));

  return (
    <div className="whiteboard">
      <div className="wb-toolbar">
        <input
          ref={inputRef}
          value={label}
          placeholder={pendingPos ? 'Name this idea…' : 'Add an idea…'}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addNode()}
          aria-label="New idea"
        />
        <button onClick={addNode}>+ Idea</button>
        <span className="wb-hint">
          {linkFrom
            ? 'Click another idea to connect — or the same one to cancel.'
            : pendingPos
              ? 'Type a name, then Enter — your idea lands where you clicked.'
              : 'Click the board to place an idea · drag to move · click two to connect · × to delete.'}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="wb-svg"
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={onMove}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
        onClick={(e) => {
          setLinkFrom(null);
          // Click empty board to drop the next idea there, then type to name it.
          if ((e.target as Element).tagName.toLowerCase() === 'svg') {
            const p = toSvg(e);
            if (p) {
              setPendingPos(p);
              inputRef.current?.focus();
            }
          }
        }}
        role="img"
        aria-label="Your idea board"
      >
        {board.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          return <line key={i} className="wb-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
        {pendingPos && <circle className="wb-pending" cx={pendingPos.x} cy={pendingPos.y} r={15} />}
        {board.nodes.map((n) => (
          <g
            key={n.id}
            className={`wb-node ${linkFrom === n.id ? 'linking' : ''}`}
            onPointerDown={onNodeDown(n.id)}
            onPointerUp={onNodeUp(n.id)}
          >
            <rect x={n.x - 54} y={n.y - 16} width={108} height={32} rx={8} />
            <text x={n.x} y={n.y + 4} textAnchor="middle">
              {n.label.length > 18 ? `${n.label.slice(0, 17)}…` : n.label}
            </text>
            <text className="wb-del" x={n.x + 46} y={n.y - 4} onPointerDown={del(n.id)}>
              ×
            </text>
          </g>
        ))}
      </svg>
      {board.nodes.length === 0 && (
        <p className="wb-empty">
          Lay out your own connections — add ideas and link them. Saved with this topic.
        </p>
      )}
    </div>
  );
}
