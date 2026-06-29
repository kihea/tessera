// Dev-only weave-tuning panel (gated by import.meta.env.DEV in SessionScreen).
// Edits the WeaveWeights and calls session.reLoom on every change, which rebuilds
// the Loom over the CACHED corpus and replays the feed instantly -- no research,
// no model, no re-weave. Tuned values persist (localStorage) and drive future
// sessions. Toggle with the Escape key. Live metrics show cohesion shifting.

import { useEffect, useRef, useState } from 'react';
import type { Session } from '../state/session';
import type { FeedCard } from '../types';
import { DEFAULT_WEIGHTS, loadWeights, resetWeights, type WeaveWeights } from '../weave/weights';
import type { TuneResult } from '../weave/tune';

interface Field {
  key: keyof WeaveWeights;
  label: string;
  min: number;
  max: number;
  step: number;
}
interface Group {
  title: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: 'Source cohesion',
    fields: [
      { key: 'maxPerDoc', label: 'Max per doc', min: 1, max: 20, step: 1 },
      { key: 'maxSameDocRun', label: 'Max same-doc run', min: 1, max: 8, step: 1 },
      { key: 'contextRunLen', label: 'Context run length', min: 0, max: 8, step: 1 },
      { key: 'maxVideoCards', label: 'Video cards', min: 0, max: 6, step: 1 },
      { key: 'continueInOrderBonus', label: 'Continue-in-order bonus', min: 0, max: 3, step: 0.05 },
      { key: 'maxTypeStreak', label: 'Max type streak', min: 1, max: 6, step: 1 },
      { key: 'docReusePenalty', label: 'Doc-reuse penalty', min: 0, max: 1, step: 0.05 },
      { key: 'docReuseCap', label: 'Doc-reuse cap (0=off)', min: 0, max: 10, step: 1 },
    ],
  },
  {
    title: 'Continues chain',
    fields: [
      { key: 'chainLen', label: 'Chain length', min: 1, max: 8, step: 1 },
      { key: 'chainEveryCards', label: 'Min cards between', min: 1, max: 40, step: 1 },
      { key: 'chainSpineTopN', label: 'Spine: top-N df', min: 1, max: 24, step: 1 },
      { key: 'chainSpineMinDocs', label: 'Spine: min docs', min: 1, max: 10, step: 1 },
      { key: 'chainMinPosition', label: 'Chain min position', min: 0, max: 20, step: 1 },
    ],
  },
  {
    title: 'Passage scoring',
    fields: [
      { key: 'connectionWeight', label: 'Connection weight', min: 0, max: 4, step: 0.1 },
      { key: 'masteryFitBase', label: 'Mastery-fit base', min: 0, max: 2, step: 0.05 },
      { key: 'masteryAbovePenalty', label: 'Above-stage penalty', min: 0, max: 3, step: 0.05 },
      { key: 'masteryBelowPenalty', label: 'Below-stage penalty', min: 0, max: 2, step: 0.05 },
      { key: 'noveltyFewBonus', label: 'Novelty bonus', min: 0, max: 2, step: 0.05 },
      { key: 'noveltyNonePenalty', label: 'No-novelty penalty', min: 0, max: 2, step: 0.05 },
      { key: 'dueReviewBonus', label: 'Due-review bonus', min: 0, max: 2, step: 0.05 },
      { key: 'banditWeight', label: 'Bandit weight', min: 0, max: 2, step: 0.05 },
      { key: 'frontierPush', label: 'Frontier push', min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    title: 'Gates',
    fields: [
      { key: 'hotExposure', label: 'Hot exposure', min: 1, max: 6, step: 1 },
      { key: 'maxFormulas', label: 'Max formulas', min: 0, max: 12, step: 1 },
      { key: 'checkpointTogetherWeight', label: 'Checkpoint together', min: 0, max: 8, step: 0.5 },
      { key: 'checkpointReusePenalty', label: 'Checkpoint reuse pen.', min: 0, max: 6, step: 0.1 },
    ],
  },
];

function isPassage(c: FeedCard): c is Extract<FeedCard, { kind: 'passage' }> {
  return c.kind === 'passage';
}

function metricsOf(cards: FeedCard[]) {
  const passages = cards.filter(isPassage);
  const docs = new Set(passages.map((p) => p.doc.id));
  let maxRun = passages.length ? 1 : 0;
  let run = 1;
  for (let i = 1; i < passages.length; i++) {
    if (passages[i].doc.id === passages[i - 1].doc.id) {
      run += 1;
      maxRun = Math.max(maxRun, run);
    } else run = 1;
  }
  const positions = new Map<string, number[]>();
  passages.forEach((p, i) => {
    const arr = positions.get(p.doc.id) ?? [];
    arr.push(i);
    positions.set(p.doc.id, arr);
  });
  let gapSum = 0;
  let gapN = 0;
  for (const arr of positions.values())
    for (let i = 1; i < arr.length; i++) {
      gapSum += arr[i] - arr[i - 1];
      gapN += 1;
    }
  return {
    cards: cards.length,
    docs: docs.size,
    maxRun,
    avgGap: gapN ? (gapSum / gapN).toFixed(1) : '—',
  };
}

export function DevPanel({ session }: { session: Session }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState<WeaveWeights>(() => loadWeights());
  const [tuning, setTuning] = useState<{ gen: number; best: number } | null>(null);
  const [tuned, setTuned] = useState<TuneResult | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const apply = (next: WeaveWeights) => {
    setW(next);
    session.reLoom(next);
  };
  const setField = (key: keyof WeaveWeights, value: number) =>
    apply({ ...w, [key]: value } as WeaveWeights);
  const reset = () => {
    resetWeights();
    apply({ ...DEFAULT_WEIGHTS });
  };
  const runTune = async () => {
    if (runningRef.current) return; // render-independent guard against a double-click
    runningRef.current = true;
    setTuned(null);
    setTuning({ gen: 0, best: 0 });
    try {
      const res = await session.tuneWeights((gen, best) => setTuning({ gen, best }));
      if (res) {
        setW(res.weights);
        setTuned(res);
      }
    } finally {
      setTuning(null);
      runningRef.current = false;
    }
  };

  if (!open) {
    return (
      <button className="devpanel-tab" onClick={() => setOpen(true)} title="Weave tuning (Esc)">
        ⚙ tune
      </button>
    );
  }

  const m = metricsOf(session.cards);

  return (
    <div className="devpanel">
      <div className="devpanel-head">
        <strong>Weave tuning</strong>
        <span className="devpanel-hint">replays instantly · Esc toggles</span>
        <button className="devpanel-x" onClick={() => setOpen(false)} aria-label="Close">
          ×
        </button>
      </div>
      <div className="devpanel-metrics">
        <span>{m.cards} cards</span>
        <span>{m.docs} sources</span>
        <span>max run {m.maxRun}</span>
        <span>avg gap {m.avgGap}</span>
      </div>
      <div className="devpanel-body">
        {session.phase !== 'ready' && (
          <p className="devpanel-note">Start a session to tune — changes replay the live feed.</p>
        )}
        <label className="devpanel-field devpanel-toggle">
          <span className="devpanel-field-label">Continues chain</span>
          <input
            type="checkbox"
            checked={w.chainEnabled}
            onChange={(e) => apply({ ...w, chainEnabled: e.target.checked })}
          />
        </label>
        {GROUPS.map((g) => (
          <div key={g.title} className="devpanel-group">
            <div className="devpanel-group-title">{g.title}</div>
            {g.fields.map((f) => (
              <label key={String(f.key)} className="devpanel-field">
                <span className="devpanel-field-label">{f.label}</span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={Number(w[f.key])}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                />
                <input
                  type="number"
                  className="devpanel-num"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={Number(w[f.key])}
                  onChange={(e) => setField(f.key, Number(e.target.value))}
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="devpanel-foot">
        <div className="devpanel-foot-row">
          <button
            className="chip"
            onClick={runTune}
            disabled={!!tuning || session.phase !== 'ready'}
            title="Search weights that maximize feed quality on this corpus (separable CMA-ES)"
          >
            {tuning ? `Tuning… gen ${tuning.gen} · ${tuning.best.toFixed(3)}` : '✦ Auto-tune'}
          </button>
          <button className="chip" onClick={reset} disabled={!!tuning}>
            Reset to defaults
          </button>
        </div>
        {tuned && (
          <div className="devpanel-tuned">
            quality {tuned.baseScore.toFixed(3)} → <strong>{tuned.score.toFixed(3)}</strong> · {tuned.evals} evals
            <div className="devpanel-parts">
              {Object.entries(tuned.parts).map(([k, v]) => (
                <span key={k}>
                  {k} {v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
