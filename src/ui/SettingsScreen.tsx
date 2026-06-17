// Connection settings: per-user API keys, kept in THIS browser's localStorage
// only. Tessera ships keyless and stays fully usable keyless -- a key is an
// upgrade (higher OpenAlex rate limits), never a requirement. An invalid key
// would 401 every OpenAlex request, so the key is tested live before saving.
//
// The connection MODEL is now chosen on the home screen's picker (the built-in
// heuristic, a bundled in-browser model in three tiers, your local Ollama
// models, or saved API entries). This screen shows the active model and lets you remove
// saved entries -- the model only builds the study map that decides what real
// material to gather; it never writes a word the learner studies.

import { useState } from 'react';
import type { AiModel } from '../state/storage';
import {
  activeModel,
  apiEntries,
  DEFAULT_AI,
  HEURISTIC_MODEL,
  loadBandit,
  loadSettings,
  saveSettings,
} from '../state/storage';
import { webllmSupported } from '../ai/webllm';
import { extLinkProps } from './external';
import { DownloadAppButton } from './DownloadAppButton';
import type { SourceType } from '../types';
import { TYPE_LABEL } from './labels';

type KeyStatus = 'idle' | 'testing' | 'rejected' | 'unreachable';

export function SettingsScreen({ onDone, onRetune }: { onDone: () => void; onRetune: () => void }) {
  const existing = loadSettings();
  const [apiKey, setApiKey] = useState(existing.openAlexApiKey ?? '');
  const [email, setEmail] = useState(existing.politeEmail ?? '');
  const [youtubeKey, setYoutubeKey] = useState(existing.youtubeApiKey ?? '');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<KeyStatus>('idle');
  const [ai, setAi] = useState(existing.ai ?? DEFAULT_AI);
  const active = activeModel(ai);
  const entries = apiEntries(ai);

  const persist = () => {
    saveSettings({
      openAlexApiKey: apiKey.trim() || undefined,
      politeEmail: email.trim() || undefined,
      youtubeApiKey: youtubeKey.trim() || undefined,
      ai,
    });
    onDone();
  };

  const removeEntry = (id: string) => {
    const nextAi = {
      ...ai,
      apiEntries: entries.filter((e) => e.id !== id),
      ...(active.id === id ? { selected: HEURISTIC_MODEL } : {}),
    };
    setAi(nextAi);
    saveSettings({ ...loadSettings(), ai: nextAi });
  };

  const save = async () => {
    const key = apiKey.trim();
    if (!key) {
      persist(); // empty = run keyless (also how a key is removed)
      return;
    }
    setStatus('testing');
    try {
      const res = await fetch(
        `https://api.openalex.org/works?per-page=1&select=id&api_key=${encodeURIComponent(key)}`,
      );
      if (res.status === 401 || res.status === 403) {
        setStatus('rejected');
        return;
      }
      if (!res.ok) {
        setStatus('unreachable');
        return;
      }
    } catch {
      setStatus('unreachable');
      return;
    }
    persist();
  };

  return (
    <div className="settings-screen">
      <div className="settings-panel">
        <div className="brand">
          <span className="brand-mark">◳</span> Tessera
        </div>
        <h1>Connection settings</h1>
        <p className="settings-note">
          Tessera runs entirely in your browser against open APIs and works with no keys at all.
          Anything you enter here is stored only in this browser&rsquo;s local storage and sent only
          to the provider it belongs to — never bundled with the app, never to anyone else.
        </p>

        <section className="settings-field">
          <label htmlFor="yt-key">YouTube Data API key</label>
          <p className="settings-hint">
            Optional, <strong>desktop app only</strong>. With a free YouTube Data API key, relevant
            video moments are woven into the feed — the official player at the timestamp, plus a
            short transcript snippet. Left empty (or in the web build) no videos are gathered. Stored
            only on this device.
          </p>
          <div className="settings-key-row">
            <input
              id="yt-key"
              type={showKey ? 'text' : 'password'}
              value={youtubeKey}
              onChange={(e) => setYoutubeKey(e.target.value)}
              placeholder="paste a YouTube Data API key, or leave empty"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </section>

        <section className="settings-field">
          <label htmlFor="oa-key">OpenAlex API key</label>
          <p className="settings-hint">
            Optional. Scholarly papers and cited works come from{' '}
            <a {...extLinkProps('https://docs.openalex.org')}>
              OpenAlex
            </a>
            , which is free without a key; a key from your own OpenAlex account raises your rate
            limits. The key is checked against the live API before it is saved.
          </p>
          <div className="settings-key-row">
            <input
              id="oa-key"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setStatus('idle');
              }}
              placeholder="paste your key, or leave empty to run keyless"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="chip"
              onClick={() => setShowKey((s) => !s)}
              title={showKey ? 'Hide the key' : 'Show the key'}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          {status === 'rejected' && (
            <p className="settings-error">
              OpenAlex rejected this key (401) — check it for typos. Not saved; a bad key would
              break every scholarly lookup.
            </p>
          )}
          {status === 'unreachable' && (
            <p className="settings-error">
              Couldn&rsquo;t reach OpenAlex to test the key.{' '}
              <button type="button" className="linkish" onClick={persist}>
                Save anyway
              </button>{' '}
              or try again in a moment.
            </p>
          )}
        </section>

        <section className="settings-field">
          <label>Connection model</label>
          <p className="settings-hint">
            Chosen from the picker on the home screen — the built-in heuristic, a bundled
            in-browser model (small / medium / large), your local Ollama models, or a saved API
            entry. It reads the seed sources and chooses which neighboring concepts to gather real
            material for; it never writes content you study.
          </p>
          <div className="active-model">
            <span className="active-model-dot">◇</span>
            <div className="active-model-text">
              <strong>{active.kind === 'none' ? 'Heuristic branching' : active.label}</strong>
              <span>{describeActive(active)}</span>
            </div>
            <span className="active-model-tag">Active</span>
          </div>
          {entries.length > 0 && (
            <div className="entry-list">
              <div className="entry-list-title">Saved API models</div>
              {entries.map((m) => (
                <div key={m.id} className="entry-row">
                  <span className="entry-name">{m.label}</span>
                  <span className="entry-kind">{describeKind(m)}</span>
                  <button
                    type="button"
                    className="entry-x"
                    title="Remove this saved model"
                    onClick={() => removeEntry(m.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="settings-hint">
            {webllmSupported()
              ? 'The bundled in-browser models can run here — your browser has WebGPU. Each downloads once the first time it’s picked (~0.9–1.6 GB by tier), then runs offline.'
              : 'The bundled in-browser models need WebGPU, which this browser doesn’t expose. Use a recent Chrome/Edge, or the desktop app, to run them.'}
          </p>
          <DownloadAppButton variant="chip" />
        </section>

        <section className="settings-field">
          <label htmlFor="oa-mail">Contact email for the polite pool</label>
          <p className="settings-hint">
            Optional, no signup needed. OpenAlex gives keyless requests that include a contact
            email (&ldquo;polite pool&rdquo;) faster and more reliable service.
          </p>
          <input
            id="oa-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
            spellCheck={false}
          />
        </section>

        <section className="settings-field">
          <label>How you learn</label>
          <p className="settings-hint">
            Tessera&rsquo;s evolving picture of how you retain: warm-started by the startup
            questions, then reshaped by what you actually clip, open, weave, and recall, and shown
            openly so you can retune the starting answers any time.
          </p>
          <HowYouLearn onRetune={onRetune} />
        </section>

        <div className="settings-actions">
          <button className="chip" onClick={onDone}>
            Cancel
          </button>
          <button className="ob-next" onClick={save} disabled={status === 'testing'}>
            {status === 'testing' ? 'Testing key…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function describeKind(m: AiModel): string {
  if (m.kind === 'webllm') return 'In-browser · WebGPU';
  if (m.kind === 'anthropic') return 'Anthropic API';
  if (m.kind === 'ollama') return 'Local · Ollama';
  return m.baseUrl ? 'Local server' : 'OpenAI API';
}

function describeActive(m: AiModel): string {
  if (m.kind === 'none') return 'Built-in — no model, no setup. Always works.';
  if (m.kind === 'webllm') return m.note ?? 'Bundled in-browser model — runs via WebGPU.';
  return describeKind(m);
}

/**
 * The learner-model panel, relocated here from the home screen: the bandit's
 * current read on which source types this learner retains from, plus the button
 * that reopens the startup questions to retune the warm-start.
 */
function HowYouLearn({ onRetune }: { onRetune: () => void }) {
  const state = loadBandit();
  const entries = state
    ? (Object.entries(state) as [SourceType, { pulls: number; value: number }][])
        .filter(([, arm]) => arm.pulls > 0)
        .sort((a, b) => b[1].value - a[1].value)
    : [];
  const observations = entries.reduce((sum, [, arm]) => sum + arm.pulls, 0);

  return (
    <div className="learn-panel">
      <div className="learn-head">
        <h2>What the feed believes</h2>
        <button className="chip" onClick={onRetune}>
          Retune preferences
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="learn-empty">
          No picture yet — it forms from what you clip, open, weave, and recall.
        </p>
      ) : (
        <>
          {entries.map(([type, arm]) => (
            <div key={type} className="learn-row">
              <span className={`type-badge ${type}`}>{TYPE_LABEL[type]}</span>
              <div className="learn-bar">
                <div className="learn-fill" style={{ width: `${Math.round(arm.value * 100)}%` }} />
              </div>
              <span className="learn-val">{arm.value.toFixed(2)}</span>
            </div>
          ))}
          <p className="learn-note">
            {observations} observations — warm-started from your answers; what you actually clip,
            open, weave, and recall in checks reshapes it. Retention counts most.
          </p>
        </>
      )}
    </div>
  );
}
