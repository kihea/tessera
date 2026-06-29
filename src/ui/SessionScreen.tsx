import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useSession } from '../state/session';
import { ConceptStrip } from './ConceptStrip';
import { FeedPane } from './FeedPane';
import { NotesPane } from './NotesPane';
import { WeaveMap } from './WeaveMap';
import { DevPanel } from './DevPanel';
import { SourceConverge } from './SourceConverge';
import type { ProviderProgress, StudyMap } from '../types';
import type { WebllmProgress } from '../ai/webllm';
import type { Sense } from '../research/disambiguate';

export function SessionScreen({ query, onBack }: { query: string; onBack: () => void }) {
  const session = useSession(query);
  const [showMap, setShowMap] = useState(false);
  const [showStudy, setShowStudy] = useState(false);
  const [notesPct, setNotesPct] = useState(42);
  const mainRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<string, HTMLElement>());

  // Esc closes the weave-map overlay (modal convention).
  useEffect(() => {
    if (!showMap) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowMap(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMap]);

  const registerEl = (cardId: string, el: HTMLElement | null) => {
    if (el) cardEls.current.set(cardId, el);
    else cardEls.current.delete(cardId);
  };

  const jumpTo = (cardId: string) => {
    const el = cardEls.current.get(cardId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
  };

  const jumpToConcept = (conceptId: string) => {
    for (const card of session.cards) {
      if (card.kind === 'passage' && card.concepts.includes(conceptId)) return jumpTo(card.id);
      if (card.kind === 'definition' && card.conceptId === conceptId) return jumpTo(card.id);
      if (card.kind === 'formula' && card.conceptId === conceptId) return jumpTo(card.id);
    }
  };

  const onDividerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const main = mainRef.current;
    if (!main) return;
    const move = (ev: PointerEvent) => {
      const rect = main.getBoundingClientRect();
      const pct = ((rect.right - ev.clientX) / rect.width) * 100;
      setNotesPct(Math.min(62, Math.max(24, pct)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sourceCount = session.corpus ? session.corpus.docs.size : 0;

  return (
    <div className="session">
      <header className="session-header">
        <button className="back-btn" onClick={onBack} title="Back to topics">
          ←
        </button>
        <div className="session-title">
          <h1>{query}</h1>
          {session.phase === 'ready' && (
            <span className="session-sub">
              {sourceCount} sources · {session.corpus?.passages.length ?? 0} excerpts ·{' '}
              {session.corpus?.concepts.length ?? 0} threads
            </span>
          )}
        </div>
        {session.phase === 'ready' && (
          <div className="session-stats">
            <span
              className={`stat stage-chip d${session.stage.rung}`}
              title="Your mastery stage — advanced by grounding terms and completing weaves"
            >
              Stage: {session.stage.label}
            </span>
            <span className="stat">{session.stats.cardsViewed} read</span>
            <span className="stat">{session.stats.clips} clipped</span>
            <span className="stat">{session.stats.checkpoints} woven</span>
            {session.stats.checksAnswered > 0 && (
              <span className="stat" title="Checks for understanding answered from memory">
                {session.stats.checksCorrect}/{session.stats.checksAnswered} recalled
              </span>
            )}
            {session.corpus?.studyMap && (
              <button
                className={`map-toggle ${showStudy ? 'on' : ''}`}
                onClick={() => setShowStudy((s) => !s)}
                title="How this session branched out from the main idea"
              >
                {showStudy ? 'Hide study map' : 'Study map'}
              </button>
            )}
            <button className={`map-toggle ${showMap ? 'on' : ''}`} onClick={() => setShowMap((s) => !s)}>
              {showMap ? 'Hide weave map' : 'Weave map'}
            </button>
          </div>
        )}
      </header>

      {session.phase === 'disambiguating' ? (
        <SensePicker
          query={query}
          senses={session.senses}
          onChoose={session.chooseSense}
          onBack={onBack}
        />
      ) : session.phase === 'empty' ? (
        <div className="phase-panel">
          <h2>Not enough source material surfaced.</h2>
          <p>Try rephrasing the topic — broader phrasing usually pulls more sources.</p>
          <button className="chip" onClick={onBack}>
            ← Try another topic
          </button>
        </div>
      ) : session.phase !== 'ready' ? (
        <ResearchProgress
          phase={session.phase}
          progress={session.progress}
          modelLoad={session.modelLoad}
          mapGenerating={session.mapGenerating}
        />
      ) : (
        <>
          <ConceptStrip
            corpus={session.corpus!}
            cards={session.cards}
            viewedCardIds={session.viewedCardIds}
            onConceptClick={jumpToConcept}
          />
          <div className="session-body">
            {showStudy && session.corpus?.studyMap && (
              <aside className="feed-sidebar">
                <StudyMapPanel map={session.corpus.studyMap} />
              </aside>
            )}
            <div
              className="session-main"
              ref={mainRef}
              style={{ '--notes-w': `${notesPct}%` } as CSSProperties}
            >
              <FeedPane session={session} registerEl={registerEl} onJump={jumpTo} />
              <div className="divider" onPointerDown={onDividerDown} title="Drag to resize" />
              <NotesPane session={session} query={query} />
            </div>
          </div>
          {showMap && (
            <div className="map-overlay" onClick={() => setShowMap(false)}>
              <div className="map-overlay-panel" onClick={(e) => e.stopPropagation()}>
                <div className="map-overlay-head">
                  <span className="map-overlay-title">Weave map — the corpus’s own structure</span>
                  <button
                    className="map-overlay-close"
                    onClick={() => setShowMap(false)}
                    aria-label="Close weave map"
                  >
                    ×
                  </button>
                </div>
                <WeaveMap
                  corpus={session.corpus!}
                  cards={session.cards}
                  viewedCardIds={session.viewedCardIds}
                  onConceptClick={(id) => {
                    setShowMap(false);
                    jumpToConcept(id);
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
      {import.meta.env.DEV && <DevPanel session={session} />}
    </div>
  );
}

function SensePicker({
  query,
  senses,
  onChoose,
  onBack,
}: {
  query: string;
  senses: Sense[];
  onChoose: (q: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="phase-panel sense-picker">
      <h2>
        “{query}” can mean a few things
      </h2>
      <p className="phase-note">
        Pick the sense you mean and the feed gathers around it — or search it exactly as you typed it.
      </p>
      <ul className="sense-list">
        {senses.map((s) => (
          <li key={s.title}>
            <button className="sense-option" onClick={() => onChoose(s.query)}>
              <span className="sense-title">{s.title}</span>
              {s.blurb && <span className="sense-blurb">{s.blurb}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="sense-actions">
        <button className="sense-asis" onClick={() => onChoose(query)}>
          Search “{query}” as I typed it →
        </button>
        <button className="chip" onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}

function ResearchProgress({
  phase,
  progress,
  modelLoad,
  mapGenerating,
}: {
  phase: string;
  progress: ProviderProgress[];
  modelLoad: WebllmProgress | null;
  mapGenerating: boolean;
}) {
  const heading =
    phase === 'researching'
      ? 'Gathering the sources…'
      : phase === 'expanding'
        ? 'Branching out from the main idea…'
        : 'Weaving the connections…';
  const note =
    phase === 'researching'
      ? 'Querying real archives — every excerpt you will read links back to its origin.'
      : phase === 'expanding'
        ? 'A study map names what the idea presupposes, how it works, and what goes into it — each thread gathered from real sources.'
        : 'Finding the terms your sources share and the threads between passages.';
  return (
    <div className="phase-panel">
      <h2>{heading}</h2>
      <p className="phase-note">{note}</p>
      {modelLoad && modelLoad.progress < 1 ? (
        <div className="mp-progress" aria-live="polite">
          <div className="mp-progress-bar">
            <div
              className="mp-progress-fill"
              style={{ width: `${Math.round(modelLoad.progress * 100)}%` }}
            />
          </div>
          <span className="mp-progress-text">
            {`Loading the model into your browser (one-time download, then cached) — ${modelLoad.text || 'starting…'}`}
          </span>
        </div>
      ) : mapGenerating ? (
        <div className="model-working" aria-live="polite">
          <span className="spinner" />
          <span>Mapping the topic with your model — this can take a moment on a slower machine.</span>
        </div>
      ) : null}
      <SourceConverge progress={progress} />
    </div>
  );
}

/**
 * The branch-out plan, shown openly: every thread names its relation to the
 * main idea and why it was gathered. The map decides WHAT to collect; the
 * sources themselves carry all the content.
 */
function StudyMapPanel({ map }: { map: StudyMap }) {
  // Group branches by kind so the outline reads as labelled sections instead of a
  // flat, mixed list. Insertion order of kinds is preserved.
  const groups = new Map<string, StudyMap['branches']>();
  for (const b of map.branches) {
    const k = b.kind || 'related';
    const arr = groups.get(k);
    if (arr) arr.push(b);
    else groups.set(k, [b]);
  }
  return (
    <div className="study-map">
      <div className="study-map-head">
        <span className="study-map-idea">{map.idea}</span>
        <span className="study-map-by">
          {map.builtBy === 'model'
            ? 'branched by your model — it only chose what to gather, never what to say'
            : 'branched heuristically — connect a model in Settings for smarter branching'}
        </span>
      </div>
      {[...groups.entries()].map(([kind, branches]) => (
        <section key={kind} className="study-group">
          <h4 className={`study-group-head branch-kind ${kind}`}>{kind}</h4>
          <ul className="study-branches">
            {branches.map((b) => (
              <li key={b.query} className="study-branch">
                <span className="branch-concept">{b.concept}</span>
                <span className="branch-why">{b.why}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
