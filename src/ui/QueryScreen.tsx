import { useState } from 'react';
import { DEFAULT_AI, forgetTopic, loadSettings, loadTopics, saveSettings } from '../state/storage';
import { ModelToggle } from './ModelToggle';
import { ReachSelector } from './ReachSelector';
import { WeaveBackground } from './WeaveBackground';
import { DownloadAppButton } from './DownloadAppButton';

const EXAMPLES = [
  'how transformers predict the next token',
  'the Socratic method',
  'CRISPR gene editing',
  'how interest rates shape inflation',
  'the printing press and the Reformation',
];

export function QueryScreen({
  onSubmit,
  onSettings,
}: {
  onSubmit: (query: string) => void;
  onSettings: () => void;
}) {
  const [value, setValue] = useState('');
  const [recents, setRecents] = useState(() => loadTopics());
  const [radius, setRadius] = useState(() => loadSettings().ai?.radius ?? 0.5);

  const go = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length >= 3) onSubmit(trimmed);
  };

  const setReach = (r: number) => {
    setRadius(r);
    const settings = loadSettings();
    saveSettings({ ...settings, ai: { ...(settings.ai ?? DEFAULT_AI), radius: r } });
  };

  return (
    <div className="query-screen">
      <WeaveBackground reach={radius} />
      <button
        className="settings-link"
        onClick={onSettings}
        title="Settings — connection model, API keys, and how you learn"
      >
        ⚙ Settings
      </button>

      <div className="composer">
        <div className="brand">
          <span className="brand-mark">◳</span> Tessera
        </div>
        <h1 className="composer-title">Learn from the sources themselves.</h1>
        <p className="composer-sub">
          Name a topic. Tessera gathers real material &mdash; encyclopedias, textbooks, papers,
          books &mdash; and weaves the <em>verbatim</em> excerpts into a feed. You read the sources;
          you write the synthesis.
        </p>

        <form
          className="composer-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(value);
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="What do you want to understand?"
            aria-label="Topic to learn"
          />
          <button type="submit">Weave it</button>
        </form>

        <div className="composer-controls">
          <ModelToggle onOpenSettings={onSettings} />
          <ReachSelector radius={radius} onChange={setReach} />
        </div>

        <div className="example-row">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => go(ex)}>
              {ex}
            </button>
          ))}
        </div>

        {recents.length > 0 && (
          <div className="recents">
            <h2>Pick the weave back up</h2>
            {recents.map((t) => (
              <div key={t.slug} className="recent-row">
                <button className="recent-link" onClick={() => go(t.query)}>
                  {t.query}
                </button>
                <button
                  className="recent-x"
                  title="Forget this topic and its notes"
                  onClick={() => {
                    forgetTopic(t.slug);
                    setRecents(loadTopics());
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="philosophy">
          &ldquo;Construct the form from the material&rdquo; &mdash; not a finished form handed down
          from outside the sources (Plato), but one you build from them (Aristotle).
        </p>
        <DownloadAppButton />
      </div>
    </div>
  );
}
