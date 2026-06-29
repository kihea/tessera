import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session } from '../state/session';
import type { CheckCard, FeedCard, FlashcardCard, FormulaCard, PassageCard, Thread } from '../types';
import { DEPTH_LABEL } from '../weave/depth';
import { BLANK_TOKEN, clozeMatches } from '../weave/checks';
import { splitUrlMatch, urlRegex } from '../research/net';
import { extLinkProps } from './external';
import { TYPE_LABEL } from './labels';

const KIND_VERB: Record<Thread['kind'], string> = {
  defines: 'defines',
  extends: 'builds on',
  contrasts: 'pushes back on',
  applies: 'applies',
  questions: 'questions',
  grounds: 'grounds',
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Mark {
  id: string;
  label: string;
}

/**
 * Render excerpt text with raw URLs collapsed to a short link element. The
 * verbatim words stay verbatim; a pasted-in URL is chrome, not prose -- it
 * reads as "link ↗" and the href survives. Thread marking runs on the text
 * BETWEEN links so an address never underlines as a concept.
 */
function excerptText(
  text: string,
  marks: Mark[],
  muted: Set<string>,
  onToggle: (id: string) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  const re = urlRegex();
  let last = 0;
  let seg = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(...threadText(text.slice(last, m.index), marks, muted, onToggle, `s${seg++}`));
    const { href, trail } = splitUrlMatch(m[0]);
    out.push(
      <a key={`url-${m.index}`} className="inline-link" title={href} {...extLinkProps(href)}>
        link&nbsp;↗
      </a>,
    );
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...threadText(text.slice(last), marks, muted, onToggle, `s${seg++}`));
  return out;
}

/** URLs collapsed, no thread marks -- for quoted excerpts in checkpoint cards. */
function plainExcerpt(text: string): ReactNode[] {
  return excerptText(text, [], new Set(), () => {});
}

/**
 * Underline only the THREAD terms (the ones that connect this card to others or
 * open a new thread) -- not every concept. Each is click-to-deselect: muting a
 * thread stops it underlining anywhere. Text stays verbatim.
 */
function threadText(
  text: string,
  marks: Mark[],
  muted: Set<string>,
  onToggle: (id: string) => void,
  keyPrefix = '',
): ReactNode[] {
  const active = marks.filter((m) => !muted.has(m.id));
  if (active.length === 0) return [text];
  const byKey = new Map<string, string>();
  for (const m of active) {
    byKey.set(m.label.toLowerCase(), m.id);
    byKey.set(m.label.toLowerCase().replace(/(es|s)$/, ''), m.id);
  }
  const pattern = active
    .map((m) => escapeRe(m.label))
    .sort((a, b) => b.length - a.length)
    .join('|');
  const re = new RegExp(`\\b(?:${pattern})(?:es|s)?\\b`, 'gi');
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0].toLowerCase();
    const id = byKey.get(raw) ?? byKey.get(raw.replace(/(es|s)$/, ''));
    if (id) {
      out.push(
        <span
          key={`${keyPrefix}-${m.index}-${k++}`}
          className="thread-mark"
          role="button"
          tabIndex={0}
          title="click to stop underlining this thread"
          onClick={() => onToggle(id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onToggle(id);
          }}
        >
          {m[0]}
        </span>,
      );
    } else {
      out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function CardView({
  card,
  session,
  onJump,
}: {
  card: FeedCard;
  session: Session;
  onJump: (cardId: string) => void;
}) {
  switch (card.kind) {
    case 'passage':
      return <PassageView card={card} session={session} onJump={onJump} />;
    case 'definition':
      return (
        <article className="card definition-card">
          <div className="card-top">
            <span className="type-badge reference">Reference</span>
            <span className="card-num">#{card.index}</span>
          </div>
          <p className="reason">{card.reason}</p>
          <h3 className="def-term">{card.label}</h3>
          <blockquote className="excerpt">{card.definition}</blockquote>
          <div className="card-actions">
            <button className="action" onClick={() => session.clipCard(card)}>
              ✂ Clip to notes
            </button>
            <a className="action link" {...extLinkProps(card.url, () => session.openSource(card))}>
              {card.source} ↗
            </a>
          </div>
        </article>
      );
    case 'checkpoint':
      return <CheckpointView card={card} session={session} onJump={onJump} />;
    case 'check':
      return <CheckView card={card} session={session} onJump={onJump} />;
    case 'formula':
      return <FormulaView card={card} session={session} />;
    case 'flashcard':
      return <FlashcardView card={card} />;
    case 'end':
      return (
        <article className="card end-card">
          <h3>The weave is complete.</h3>
          <p>
            You read {session.stats.cardsViewed} cards across {session.corpus?.docs.size ?? 0}{' '}
            sources, clipped {session.stats.clips} excerpts, and wove {session.stats.checkpoints}{' '}
            connections in your own words.
          </p>
          <p className="end-hint">
            The understanding lives in your notebook now — export it, or follow any source link
            deeper. The feed only ever showed you the material; the form you built from it is
            yours.
          </p>
        </article>
      );
  }
}

function FlashcardView({ card }: { card: FlashcardCard }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <article className="card flashcard-card">
      <div className="card-top">
        <span className="type-badge flashcard">Flashcard</span>
        <span className="card-num">#{card.index}</span>
      </div>
      <p className="reason">{card.reason}</p>
      <h3 className="flashcard-front">{card.front}</h3>
      {flipped ? (
        <>
          <blockquote className="excerpt serif flashcard-back">{card.back}</blockquote>
          <div className="card-actions">
            <a className="action link" {...extLinkProps(card.source.url, () => {})}>
              {card.source.title} ↗
            </a>
          </div>
        </>
      ) : (
        <button className="action flashcard-flip" onClick={() => setFlipped(true)}>
          Show answer
        </button>
      )}
    </article>
  );
}

function PassageView({
  card,
  session,
  onJump,
}: {
  card: PassageCard;
  session: Session;
  onJump: (cardId: string) => void;
}) {
  const { passage, doc } = card;
  // Underline only the connective threads: concepts this card carries INTO an
  // earlier card, plus the new threads it opens. Not every term -- that was the
  // distracting wall of highlight.
  const marks = useMemo<Mark[]>(() => {
    const concepts = session.corpus?.concepts ?? [];
    const ids = new Set<string>(card.newConcepts);
    for (const t of card.threads) for (const id of t.via) ids.add(id);
    // Only underline MEANINGFUL threads, and only a few -- a quiet cue, never a
    // wall. Generic terms never underline even if they carry a connection.
    return concepts
      .filter((c) => ids.has(c.id) && c.important)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map((c) => ({ id: c.id, label: c.label }));
  }, [session.corpus, card.newConcepts, card.threads]);

  const newLabels = useMemo(
    () =>
      (session.corpus?.concepts ?? [])
        .filter((c) => card.newConcepts.includes(c.id))
        .map((c) => c.label),
    [session.corpus, card.newConcepts],
  );
  const [clipped, setClipped] = useState(false);

  const reported = session.reportedDocs.has(doc.id);

  return (
    <article className={`card passage-card ${doc.sourceType} ${reported ? 'reported' : ''}`}>
      <div className="card-top">
        <span className={`type-badge ${doc.sourceType}`}>{TYPE_LABEL[doc.sourceType]}</span>
        <span className={`depth-chip d${card.depth}`} title="Mastery rung this excerpt sits on">
          {DEPTH_LABEL[card.depth]}
        </span>
        {doc.branch && (
          <span className="branch-chip" title={doc.branch.why}>
            ↳ {doc.branch.kind} · {doc.branch.concept}
          </span>
        )}
        <span className="doc-title">
          <a {...extLinkProps(doc.url, () => session.openSource(card))}>
            {doc.title}
          </a>
          {doc.author && <span className="doc-meta"> · {doc.author}</span>}
          {doc.date && <span className="doc-meta"> · {doc.date}</span>}
        </span>
        <span className="card-num">#{card.index}</span>
      </div>
      <p className="reason">{card.reason}</p>
      <blockquote className="excerpt serif">
        {excerptText(passage.text, marks, session.mutedConcepts, session.toggleMuteConcept)}
      </blockquote>
      <div className="excerpt-origin">
        {passage.anchor && <span className="anchor">{passage.anchor}</span>}
        {doc.license && <span className="license">{doc.license}</span>}
      </div>
      {passage.embed && /^[A-Za-z0-9_-]{11}$/.test(passage.embed.videoId) && (
        <div className="video-embed">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${passage.embed.videoId}?start=${passage.embed.startSec}${
              passage.embed.endSec ? `&end=${passage.embed.endSec}` : ''
            }&rel=0&cc_load_policy=1&cc_lang_pref=en`}
            title={doc.title}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      )}
      {card.threads.length > 0 && (
        <div className="threads">
          {card.threads.map((t) => (
            <button
              key={t.toCardId}
              className={`thread ${t.kind}`}
              onClick={() => onJump(t.toCardId)}
              title={`${KIND_VERB[t.kind]} card ${t.toCardIndex} — ${t.sourceTitle}`}
            >
              ↳ {KIND_VERB[t.kind]} “{t.viaLabels.slice(0, 2).join('”, “')}” · card {t.toCardIndex}
            </button>
          ))}
        </div>
      )}
      {newLabels.length > 0 && (
        <div className="new-concepts">
          new threads: {newLabels.slice(0, 3).map((l) => (
            <span key={l} className="new-tag">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="card-actions">
        <div className="action-group">
          <button
            className={`action ${clipped ? 'done' : ''}`}
            onClick={() => {
              session.clipCard(card);
              setClipped(true);
            }}
          >
            {clipped ? '✓ Clipped' : '✂ Clip to notes'}
          </button>
          <a
            className="action link"
            {...extLinkProps(passage.anchorUrl ?? doc.url, () => session.openSource(card))}
          >
            Read at source ↗
          </a>
        </div>
        <button
          className={`action report ${reported ? 'done' : ''}`}
          disabled={reported}
          title="Report this source — removes its excerpts from this weave and all future ones (stored on this device)"
          onClick={() => {
            if (window.confirm(`Report “${doc.title}”?\n\nIts excerpts will be removed from this weave and never gathered again on this device.`)) {
              session.reportSource(card);
            }
          }}
        >
          {reported ? '⚑ Reported' : '⚑ Report'}
        </button>
      </div>
      {reported && (
        <p className="reported-note">
          Reported — its remaining excerpts won’t appear, here or in future weaves.
        </p>
      )}
    </article>
  );
}

function FormulaView({ card, session }: { card: FormulaCard; session: Session }) {
  const [clipped, setClipped] = useState(false);
  // The alt is the page's own TeX, wrapped in {\displaystyle ...} -- unwrap
  // for the readable source view only; the image renders the original.
  const tex =
    card.latex.startsWith('{\\displaystyle') && card.latex.endsWith('}')
      ? card.latex.slice('{\\displaystyle'.length, -1).trim()
      : card.latex;

  return (
    <article className="card formula-card">
      <div className="card-top">
        <span className="type-badge formula">Formula</span>
        <span className="doc-title">
          <a {...extLinkProps(card.url, () => session.openSource(card))}>
            {card.sourceTitle}
          </a>
          {card.section && <span className="doc-meta"> · {card.section}</span>}
        </span>
        <span className="card-num">#{card.index}</span>
      </div>
      <p className="reason">{card.reason}</p>
      {card.caption && <h3 className="def-term">{card.caption}</h3>}
      {card.context && <blockquote className="excerpt serif mini">{card.context}</blockquote>}
      <div className="formula-panel">
        <img className="formula-img" src={card.svgUrl} alt={card.latex} loading="lazy" />
      </div>
      <details className="formula-tex">
        <summary>TeX source</summary>
        <code>{tex}</code>
      </details>
      <div className="card-actions">
        <button
          className={`action ${clipped ? 'done' : ''}`}
          onClick={() => {
            session.clipCard(card);
            setClipped(true);
          }}
        >
          {clipped ? '✓ Clipped' : '✂ Clip to notes'}
        </button>
        <a className="action link" {...extLinkProps(card.url, () => session.openSource(card))}>
          Read at source ↗
        </a>
      </div>
    </article>
  );
}

function CheckpointView({
  card,
  session,
  onJump,
}: {
  card: Extract<FeedCard, { kind: 'checkpoint' }>;
  session: Session;
  onJump: (cardId: string) => void;
}) {
  const done = session.completedGates.has(card.id);
  const [text, setText] = useState('');
  const ready = text.trim().length >= 8;

  return (
    <article className={`card checkpoint-card ${done ? 'cleared' : ''}`}>
      <div className="card-top">
        <span className="type-badge checkpoint">Weave checkpoint</span>
        <span className="card-num">#{card.index}</span>
      </div>
      <p className="reason">{card.reason}</p>
      <h3 className="checkpoint-q">{card.prompt}</h3>
      <p className="checkpoint-hint">
        Cards{' '}
        <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRefA))}>
          {card.cardRefA}
        </button>{' '}
        and{' '}
        <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRefB))}>
          {card.cardRefB}
        </button>{' '}
        both pull on <em>{card.labelA}</em> and <em>{card.labelB}</em>. A.woke will not connect them
        for you — that synthesis is the learning.
      </p>
      <div className="quote-pair">
        <figure className="quote-block">
          <blockquote className="excerpt mini serif clamp">{plainExcerpt(card.quoteA.text)}</blockquote>
          <figcaption className="quote-cite">
            <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRefA))}>
              card {card.cardRefA} ↗
            </button>
            {' · '}
            {card.quoteA.title}
          </figcaption>
        </figure>
        <div className="quote-divider" aria-hidden="true">
          <span>×</span>
        </div>
        <figure className="quote-block">
          <blockquote className="excerpt mini serif clamp">{plainExcerpt(card.quoteB.text)}</blockquote>
          <figcaption className="quote-cite">
            <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRefB))}>
              card {card.cardRefB} ↗
            </button>
            {' · '}
            {card.quoteB.title}
          </figcaption>
        </figure>
      </div>
      {done ? (
        session.skippedGates.has(card.id) ? (
          <p className="gate-done soft">Skipped — the feed is open again. The weave is here whenever you want it.</p>
        ) : (
          <p className="gate-done">✓ Woven into your notebook. The feed is open again — keep going.</p>
        )
      ) : (
        <>
          <textarea
            className="checkpoint-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write the connection in your own words…"
            rows={3}
          />
          <div className="card-actions">
            <button
              className="action primary"
              disabled={!ready}
              title={ready ? '' : 'Write a sentence or two first'}
              onClick={() => session.submitCheckpoint(card, text)}
            >
              ✎ Weave it into my notebook & continue
            </button>
            <button
              className="skip-link"
              title="Pass this checkpoint without writing — no penalty, no credit"
              onClick={() => session.skipGate(card)}
            >
              skip for now →
            </button>
          </div>
        </>
      )}
    </article>
  );
}

function CheckView({
  card,
  session,
  onJump,
}: {
  card: CheckCard;
  session: Session;
  onJump: (cardId: string) => void;
}) {
  const done = session.completedGates.has(card.id);
  const [value, setValue] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [resolved, setResolved] = useState<'correct' | 'revealed' | null>(null);

  const before = card.blanked.split(BLANK_TOKEN);

  const fill = (node: ReactNode) => (
    <p className="check-sentence serif">
      {before[0]}
      {node}
      {before.slice(1).join(BLANK_TOKEN)}
    </p>
  );

  const submitCloze = () => {
    if (clozeMatches(value, card.accept)) {
      setResolved('correct');
      session.submitCheck(card, true);
    } else {
      setWrong((w) => w + 1);
    }
  };

  const pickOption = (opt: string) => {
    if (resolved || done) return;
    setPicked(opt);
    if (opt === card.answer) {
      setResolved('correct');
      session.submitCheck(card, true);
    } else {
      setWrong((w) => w + 1);
    }
  };

  const reveal = () => {
    setResolved('revealed');
    session.submitCheck(card, false);
  };

  const skipped = session.skippedGates.has(card.id);
  const settled = resolved !== null || done;
  const blankNode = settled ? (
    <span className={`blank-filled ${resolved === 'correct' ? 'correct' : 'revealed'}`}>
      {card.answer}
    </span>
  ) : (
    <span className="blank" />
  );

  return (
    <article className={`card check-card ${settled ? 'cleared' : ''}`}>
      <div className="card-top">
        <span className="type-badge check">Check</span>
        <span className="card-num">#{card.index}</span>
      </div>
      <p className="reason">{card.reason}</p>
      <p className="check-instruction">{card.instruction}</p>
      {fill(blankNode)}

      {card.format === 'mcq' && (
        <div className="check-options">
          {card.options!.map((opt) => {
            const isAnswer = opt === card.answer;
            const isPicked = picked === opt;
            const cls = settled
              ? isAnswer
                ? 'right'
                : isPicked
                  ? 'wrong'
                  : ''
              : isPicked
                ? 'picked'
                : '';
            return (
              <button
                key={opt}
                className={`check-option ${cls}`}
                disabled={settled}
                onClick={() => pickOption(opt)}
              >
                {opt}
              </button>
            );
          })}
        </div>
      )}

      {card.format === 'cloze' && !settled && (
        <div className="card-actions cloze-row">
          <input
            className="cloze-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCloze();
            }}
            placeholder="type the term…"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="action primary" disabled={!value.trim()} onClick={submitCloze}>
            Check
          </button>
        </div>
      )}

      {!settled && wrong > 0 && (
        <p className="check-feedback wrong">
          Not quite — look back at{' '}
          <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRef))}>
            card {card.cardRef}
          </button>
          {card.format === 'cloze' ? ' and try again.' : ' and pick again.'}
          {wrong >= 2 && (
            <button className="reveal-btn" onClick={reveal}>
              Reveal &amp; continue
            </button>
          )}
        </p>
      )}

      {!settled && (
        <button
          className="skip-link"
          title="Pass this check without answering — no penalty, no credit"
          onClick={() => session.skipGate(card)}
        >
          skip for now →
        </button>
      )}

      {settled && (
        <p className={`gate-done ${resolved === 'correct' ? '' : 'soft'}`}>
          {skipped
            ? `Skipped — the answer was “${card.answer}”. The feed is open again.`
            : resolved === 'revealed'
              ? `The answer was “${card.answer}”. Noted — the feed is open again.`
              : '✓ Right — from memory. The feed is open again.'}{' '}
          <button className="cardref" onClick={() => onJump(findCardId(session, card.cardRef))}>
            card {card.cardRef}
          </button>
        </p>
      )}
    </article>
  );
}

function findCardId(session: Session, cardIndex: number): string {
  return session.cards.find((c) => c.index === cardIndex)?.id ?? '';
}
