import { useState } from 'react';
import type { Affinity, LearnerPrefs, Opening, SourceType } from '../types';
import { DEFAULT_PREFS, loadBandit, loadPrefs, saveBandit, savePrefs } from '../state/storage';
import { TypeBandit } from '../weave/bandit';
import { TYPE_DESC, TYPE_LABEL } from './labels';

// Startup flow: ask how the learner THINKS they learn, use it to warm-start
// the session -- then let evidence take over. The answers seed the source-type
// bandit as a low-confidence prior (2 phantom pulls per arm) and configure
// how the loom opens a topic and how often it asks for woven connections.
// What the learner actually does -- clips, opened sources, completed weaves --
// is the real signal, and it outweighs this questionnaire within a session or
// two. The flow says so out loud; no silent profiling.

const SOURCE_ORDER: SourceType[] = [
  'encyclopedia',
  'textbook',
  'paper',
  'discussion',
  'book',
  'news',
  'primary',
  'reference',
];

const OPENINGS: { value: Opening; title: string; desc: string }[] = [
  {
    value: 'ground',
    title: 'Ground me first',
    desc: 'Open with definitions and overviews; climb only once the footing is firm.',
  },
  {
    value: 'balanced',
    title: 'Balanced weave',
    desc: 'Let the connections lead — ground, mechanism, and debate as the material calls for them.',
  },
  {
    value: 'debate',
    title: 'Into the debate',
    desc: 'Pull discussion and disagreement forward early; sharpen the questions before the answers.',
  },
];

const CADENCES: { value: number; title: string; desc: string }[] = [
  { value: 4, title: 'Often', desc: 'Every ~4 cards. Maximum retention work.' },
  { value: 6, title: 'Steady', desc: 'Every ~6 cards. The default rhythm.' },
  { value: 9, title: 'Rarely', desc: 'Every ~9 cards. Mostly read, weave occasionally.' },
];

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const existing = loadPrefs();
  const hadBandit = loadBandit() !== null;
  const [step, setStep] = useState(0);
  // Merge over defaults so prefs saved before a source type existed still
  // produce an entry for every type.
  const [affinity, setAffinity] = useState<Record<SourceType, Affinity>>(() => ({
    ...DEFAULT_PREFS.sourceAffinity,
    ...(existing?.sourceAffinity ?? {}),
  }));
  const [opening, setOpening] = useState<Opening>((existing ?? DEFAULT_PREFS).opening);
  const [cadence, setCadence] = useState<number>((existing ?? DEFAULT_PREFS).checkpointEvery);

  const finish = () => {
    const prefs: LearnerPrefs = { sourceAffinity: affinity, opening, checkpointEvery: cadence };
    savePrefs(prefs);
    // Re-seed the bandit from the stated preferences. This resets any learned
    // source-type evidence (the UI warns when that is the case).
    const bandit = new TypeBandit(null);
    bandit.seed(affinity);
    saveBandit(bandit.toJSON());
    onDone();
  };

  return (
    <div className="onboarding">
      <div className="ob-inner">
        <div className="brand">
          <span className="brand-mark">◳</span> A.woke
        </div>
        <div className="ob-progress">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`ob-dot ${i === step ? 'on' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        {step === 0 && (
          <section className="ob-step">
            <h1>Which materials do you reach for?</h1>
            <p className="ob-sub">
              When you genuinely want to understand something — not just look it up — what do you
              read first? This tilts the feed's starting mix.
            </p>
            <div className="source-grid">
              {SOURCE_ORDER.map((type) => (
                <div key={type} className={`source-card ${type}`}>
                  <div className="source-card-head">
                    <span className={`type-badge ${type}`}>{TYPE_LABEL[type]}</span>
                  </div>
                  <p className="source-desc">{TYPE_DESC[type]}</p>
                  <div className="tri">
                    {([1, 0, -1] as Affinity[]).map((a) => (
                      <button
                        key={a}
                        className={`tri-btn ${affinity[type] === a ? 'on' : ''}`}
                        onClick={() => setAffinity((prev) => ({ ...prev, [type]: a }))}
                      >
                        {a === 1 ? 'Prefer' : a === 0 ? 'Neutral' : 'Less'}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="ob-step">
            <h1>How should a topic open?</h1>
            <p className="ob-sub">
              Every session climbs from foundations toward the frontier either way — this sets how
              the first cards feel.
            </p>
            <div className="radio-cards">
              {OPENINGS.map((o) => (
                <button
                  key={o.value}
                  className={`radio-card ${opening === o.value ? 'on' : ''}`}
                  onClick={() => setOpening(o.value)}
                >
                  <strong>{o.title}</strong>
                  <span>{o.desc}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="ob-step">
            <h1>How often should you weave?</h1>
            <p className="ob-sub">
              Checkpoints put two excerpts in your notebook and ask <em>you</em> to write the
              connection. Writing it in your own words is the strongest retention act in the app —
              completing one literally advances your mastery stage.
            </p>
            <div className="radio-cards">
              {CADENCES.map((c) => (
                <button
                  key={c.value}
                  className={`radio-card ${cadence === c.value ? 'on' : ''}`}
                  onClick={() => setCadence(c.value)}
                >
                  <strong>{c.title}</strong>
                  <span>{c.desc}</span>
                </button>
              ))}
            </div>
            <p className="ob-honest">
              These answers only warm-start the picture. From here A.woke watches what you
              actually do — what you clip, which sources you open, which weaves you complete — and
              forms its own evidence-based idea of how you retain. The questionnaire fades as the
              evidence grows.
              {hadBandit && (
                <strong> Finishing this resets what it has learned about your sources so far.</strong>
              )}
            </p>
          </section>
        )}

        <div className="ob-nav">
          {step > 0 ? (
            <button className="chip" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button className="ob-next" onClick={() => setStep((s) => s + 1)}>
              Continue →
            </button>
          ) : (
            <button className="ob-next" onClick={finish}>
              Start weaving
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
