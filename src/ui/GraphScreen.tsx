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
import { loadGraph, searchGraph, subgraphToCorpus } from '../state/graphStore';
import type { KnowledgeGraph } from '../state/graphStore';
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

  // The corpus to play: the matched subgraph for a topic, or the densest
  // concepts when browsing. Null when the graph is empty or has no match.
  const corpus = useMemo<Corpus | null>(() => {
    if (!graph || graph.passages.length === 0) return null;
    if (topic) {
      const sub = searchGraph(graph, topic);
      return sub.conceptIds.length ? subgraphToCorpus(graph, sub.conceptIds) : null;
    }
    const top = [...graph.concepts].sort((a, b) => b.df - a.df).slice(0, 18).map((c) => c.id);
    return top.length ? subgraphToCorpus(graph, top) : null;
  }, [graph, topic]);

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
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search your knowledge graph…"
            aria-label="Search the knowledge graph"
          />
          <button type="submit">Search</button>
        </form>
      </header>

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
  onSearchConcept,
}: {
  topic: string;
  corpus: Corpus;
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
      />
      <div className="session-main graph-main">
        <FeedPane session={session} registerEl={registerEl} onJump={jumpTo} />
        <div className="divider" />
        <NotesPane session={session} query={topic} />
      </div>
    </>
  );
}
