// The knowledge-graph screen: browse/search the persistent graph you've built
// across sessions. A search finds the region (subsection) around a topic,
// renders it as a WeaveMap, and plays its verbatim material as a normal feed
// (the same Loom/FeedPane, fed a rehydrated subgraph corpus). When the graph
// has little on a topic, it offers to research it live (which then folds back
// into the graph). Nothing here is synthesized -- it is your own gathered
// material, connected.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Corpus } from '../types';
import { useSession } from '../state/session';
import {
  loadGraph,
  notesForConcepts,
  searchGraph,
  subgraphEdges,
  subgraphToCorpus,
} from '../state/graphStore';
import type { KnowledgeGraph } from '../state/graphStore';
import type { MapEdge } from './WeaveMap';
import { slugify } from '../state/storage';
import { WeaveMap } from './WeaveMap';
import { FeedPane } from './FeedPane';
import { NotesPane } from './NotesPane';

export function GraphScreen({
  topic,
  onBack,
  onSearch,
  onOpenTopic,
}: {
  topic: string | null; // null = browse the whole graph
  onBack: () => void;
  onSearch: (topic: string) => void;
  onOpenTopic: (query: string) => void;
}) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [input, setInput] = useState(topic ?? '');

  useEffect(() => {
    let alive = true;
    loadGraph().then((g) => {
      if (alive) setGraph(g);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => setInput(topic ?? ''), [topic]);

  // The subsection around the topic (its connected region).
  const sub = useMemo(
    () => (graph && topic ? searchGraph(graph, topic) : null),
    [graph, topic],
  );

  // The corpus to play: the matched subgraph for a topic, or the densest
  // concepts when browsing. Null when the graph is empty or has no match.
  const corpus = useMemo<Corpus | null>(() => {
    if (!graph || graph.passages.length === 0) return null;
    if (topic) return sub && sub.conceptIds.length ? subgraphToCorpus(graph, sub.conceptIds) : null;
    const top = [...graph.concepts].sort((a, b) => b.df - a.df).slice(0, 18).map((c) => c.id);
    return top.length ? subgraphToCorpus(graph, top) : null;
  }, [graph, topic, sub]);

  // Typed/degreed edges for the visualization (forms vs attributes, has-attribute).
  const mapEdges = useMemo<MapEdge[]>(
    () => (graph && corpus ? subgraphEdges(graph, corpus.concepts.map((c) => c.id)) : []),
    [graph, corpus],
  );

  // "Broaden" follows the abstraction axis: the most general idea in this
  // region (pig's region -> animal -> animalness), to traverse outward/up.
  const broaden = useMemo(() => {
    if (!graph || !sub || sub.conceptIds.length === 0) return null;
    const inSub = graph.concepts.filter((c) => sub.conceptIds.includes(c.id));
    const top = [...inSub]
      .sort((a, b) => b.generality - a.generality)
      .find((c) => c.label.toLowerCase() !== (topic ?? '').toLowerCase());
    return top?.label ?? null;
  }, [graph, sub, topic]);

  // The user's own notes that touch this region -- their curated layer, woven
  // in alongside the sources. Excludes the current topic (its notes show in the
  // feed's own notes pane).
  const regionNotes = useMemo(() => {
    if (!graph) return [];
    const ids = sub
      ? sub.conceptIds
      : [...graph.concepts].sort((a, b) => b.df - a.df).slice(0, 18).map((c) => c.id);
    const here = topic ? slugify(topic) : '';
    return notesForConcepts(graph, ids).filter((n) => n.slug !== here);
  }, [graph, sub, topic]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (q.length >= 2) onSearch(q);
  };

  return (
    <div className="graph-screen">
      <header className="session-header">
        <button className="back-btn" onClick={onBack} title="Back to topics">
          ←
        </button>
        <div className="session-title">
          <h1>Knowledge graph</h1>
          <p className="graph-sub">
            {graph
              ? `${graph.concepts.length} ideas · ${graph.passages.length} excerpts · ${graph.topics.length} topics`
              : 'Loading…'}
          </p>
        </div>
        <form className="graph-search" onSubmit={submit}>
          {broaden && (
            <button
              type="button"
              className="chip"
              title={`Broaden toward the more general idea: ${broaden}`}
              onClick={() => onSearch(broaden)}
            >
              ↑ {broaden}
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search your knowledge graph…"
            aria-label="Search the knowledge graph"
          />
          <button type="submit">Search</button>
        </form>
      </header>

      {regionNotes.length > 0 && (
        <div className="graph-notes">
          <h2>Your notes across these ideas</h2>
          <div className="graph-notes-row">
            {regionNotes.slice(0, 6).map((n) => (
              <button
                key={n.id}
                className="graph-note"
                onClick={() => onOpenTopic(n.slug.replace(/-/g, ' '))}
                title="Reopen this topic"
              >
                <span className="graph-note-topic">{n.slug.replace(/-/g, ' ')}</span>
                <span className="graph-note-text">
                  {n.text.replace(/^#.*$/m, '').replace(/\s+/g, ' ').trim().slice(0, 200)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!graph ? (
        <div className="graph-empty">Loading your knowledge graph…</div>
      ) : graph.passages.length === 0 ? (
        <div className="graph-empty">
          <p>Your knowledge graph is empty.</p>
          <p>
            Research any topic and it folds in here automatically — ideas become nodes, shared
            concepts become the links between them.
          </p>
        </div>
      ) : topic && !corpus ? (
        <div className="graph-empty">
          <p>
            Nothing in your graph about &ldquo;{topic}&rdquo; yet.
          </p>
          <button className="ob-next" onClick={() => onOpenTopic(topic)}>
            Research &ldquo;{topic}&rdquo; and add it
          </button>
        </div>
      ) : corpus ? (
        <GraphFeed
          key={topic ?? '__browse__'}
          topic={topic ?? 'Knowledge graph'}
          corpus={corpus}
          edges={mapEdges}
          onSearchConcept={onSearch}
        />
      ) : (
        <div className="graph-empty">No connected ideas to show yet.</div>
      )}
    </div>
  );
}

/**
 * Plays a rehydrated subgraph as a feed. `key`ed on the topic by the parent so a
 * new search remounts it fresh with the new corpus. Uses the full session
 * engine via `useSession(topic, corpus)` — gates, clips, notes all work.
 */
function GraphFeed({
  topic,
  corpus,
  edges,
  onSearchConcept,
}: {
  topic: string;
  corpus: Corpus;
  edges: MapEdge[];
  onSearchConcept: (topic: string) => void;
}) {
  const session = useSession(topic, corpus);
  const cardEls = useRef(new Map<string, HTMLElement>());

  const registerEl = (cardId: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(cardId, el);
    else cardEls.current.delete(cardId);
  };
  const jumpTo = (cardId: string) => {
    const el = cardEls.current.get(cardId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  };
  const searchConcept = (conceptId: string) => {
    const label = corpus.concepts.find((c) => c.id === conceptId)?.label;
    if (label) onSearchConcept(label);
  };

  return (
    <>
      <WeaveMap
        corpus={corpus}
        cards={session.cards}
        viewedCardIds={session.viewedCardIds}
        onConceptClick={searchConcept}
        edges={edges}
      />
      <div className="graph-legend">
        <span className="legend-item legend-form">● form</span>
        <span className="legend-item legend-attr">● attribute</span>
        <span className="legend-item legend-edge-attr">┄ has-attribute</span>
        <span className="legend-item legend-edge-assoc">— relates (thicker = stronger)</span>
      </div>
      <div className="session-main graph-main">
        <FeedPane session={session} registerEl={registerEl} onJump={jumpTo} />
        <div className="divider" />
        <NotesPane session={session} query={topic} />
      </div>
    </>
  );
}
