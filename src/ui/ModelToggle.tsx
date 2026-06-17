import { useEffect, useRef, useState } from 'react';
import type { AiModel, AiSettings } from '../state/storage';
import {
  activeModel,
  apiEntries,
  BUILTIN_MODELS,
  DEFAULT_AI,
  HEURISTIC_MODEL,
  loadSettings,
  saveSettings,
} from '../state/storage';
import { testModel } from '../ai/llm';
import { prewarmWebllm, webllmLoaded, webllmSupported } from '../ai/webllm';
import { extLinkProps } from './external';
import type { WebllmProgress } from '../ai/webllm';

// The connection-model picker: a single dropdown of everything selectable —
// the built-in heuristic, the bundled in-browser small model, the local models
// you actually have (read live from Ollama), and any API entries you've saved.
// Picking one sets it active; the API "Add" flow saves a reusable entry. Keys
// and URLs you enter stay in this browser's localStorage. The model only maps
// which real sources to gather — it never writes what you read.

type Target = 'anthropic' | 'openai' | 'local';
interface Draft {
  target: Target;
  baseUrl: string;
  model: string;
  apiKey: string;
}
const EMPTY_DRAFT: Draft = { target: 'anthropic', baseUrl: '', model: '', apiKey: '' };

const TARGETS: { value: Target; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'local', label: 'Local server' },
];

const MODEL_PH: Record<Target, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-5-mini',
  local: 'your-model-id',
};

function shortLabel(m: AiModel): string {
  if (m.kind === 'none') return 'Heuristic';
  return m.label || m.model || 'Model';
}

function kindBadge(kind: AiModel['kind']): string {
  return kind === 'webllm'
    ? 'in-browser'
    : kind === 'ollama'
      ? 'local'
      : kind === 'anthropic'
        ? 'Anthropic'
        : kind === 'openai'
          ? 'API'
          : '';
}

export function ModelToggle({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [ai, setAi] = useState<AiSettings>(() => loadSettings().ai ?? DEFAULT_AI);
  const [locals, setLocals] = useState<AiModel[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [test, setTest] = useState<{ ok: boolean; note: string } | 'testing' | null>(null);
  const [dl, setDl] = useState<WebllmProgress | null>(null);
  const [detectNonce, setDetectNonce] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);

  const active = activeModel(ai);
  const entries = apiEntries(ai);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Discover locally-installed Ollama models when the picker opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      try {
        const res = await fetch('http://localhost:11434/api/tags', { signal: ctrl.signal });
        const data = (await res.json()) as { models?: { name: string }[] };
        if (!cancelled) {
          setLocals(
            (data.models ?? []).map((m) => ({
              id: `ollama:${m.name}`,
              kind: 'ollama',
              label: m.name,
              model: m.name,
              baseUrl: 'http://localhost:11434',
            })),
          );
        }
      } catch {
        if (!cancelled) setLocals([]);
      } finally {
        clearTimeout(timer);
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, detectNonce]);

  const persist = (patch: Partial<AiSettings>) => {
    const s = loadSettings();
    const nextAi = { ...(s.ai ?? DEFAULT_AI), ...patch };
    saveSettings({ ...s, ai: nextAi });
    setAi(nextAi);
  };

  const warm = async (m: AiModel) => {
    if (!webllmSupported() || !m.model) return;
    if (webllmLoaded(m.model)) {
      setDl({ progress: 1, text: 'Ready' });
      return;
    }
    setDl({ progress: 0, text: 'Starting…' });
    const ok = await prewarmWebllm(m.model, (p) => setDl(p));
    setDl(ok ? { progress: 1, text: 'Ready' } : null);
  };

  const select = (m: AiModel) => {
    persist({ selected: m });
    setTest(null);
    if (m.kind === 'webllm') {
      warm(m); // keep the popover open to show download progress
    } else {
      setDl(null);
      setOpen(false);
    }
  };

  const draftModel = (): AiModel => ({
    id: 'draft',
    kind: draft.target === 'anthropic' ? 'anthropic' : 'openai',
    label: draft.model.trim(),
    model: draft.model.trim(),
    baseUrl: draft.target === 'local' ? draft.baseUrl.trim() || undefined : undefined,
    apiKey: draft.apiKey.trim() || undefined,
  });

  const saveEntry = () => {
    const model = draft.model.trim();
    if (!model) return;
    const entry: AiModel = {
      ...draftModel(),
      id: `api:${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
    };
    persist({ apiEntries: [...entries, entry], selected: entry });
    setAdding(false);
    setDraft(EMPTY_DRAFT);
    setTest(null);
    setOpen(false);
  };

  const removeEntry = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    persist({ apiEntries: next, ...(active.id === id ? { selected: HEURISTIC_MODEL } : {}) });
  };

  const runTest = async () => {
    setTest('testing');
    setTest(await testModel(draftModel()));
  };

  const row = (m: AiModel, opts?: { sub?: string; removable?: boolean; disabled?: boolean }) => (
    <button
      key={m.id}
      type="button"
      className={`mp-item ${active.id === m.id ? 'on' : ''}`}
      disabled={opts?.disabled}
      onClick={() => select(m)}
    >
      <span className="mp-item-main">
        <span className="mp-item-name">{m.label}</span>
        {kindBadge(m.kind) && <span className="mp-badge">{kindBadge(m.kind)}</span>}
      </span>
      {opts?.sub && <span className="mp-item-sub">{opts.sub}</span>}
      {opts?.removable && (
        <span
          className="mp-x"
          role="button"
          aria-label="Remove this model"
          title="Remove"
          onClick={(e) => {
            e.stopPropagation();
            removeEntry(m.id);
          }}
        >
          ×
        </span>
      )}
    </button>
  );

  const supported = webllmSupported();

  return (
    <div className="model-toggle" ref={ref}>
      <button
        type="button"
        className="model-toggle-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Connection model — the engine that maps which sources to gather (it never writes what you read)"
      >
        <span className="mt-diamond">◇</span>
        <span className="mt-name">{shortLabel(active)}</span>
        <span className="mt-caret">▾</span>
      </button>

      {open && (
        <div className="model-pop mp" role="dialog" aria-label="Connection model">
          <div className="mp-group">
            <div className="mp-group-title">Built in</div>
            {BUILTIN_MODELS.map((m) =>
              m.kind === 'webllm'
                ? row(m, {
                    sub: supported
                      ? m.note ?? 'Runs in your browser · downloads once, then offline'
                      : 'Needs WebGPU (recent Chrome/Edge, or the desktop app)',
                    disabled: !supported,
                  })
                : row(m, { sub: 'Built-in — no model, no setup. Always works.' }),
            )}
            {dl && active.kind === 'webllm' && (
              <div className="mp-progress" aria-live="polite">
                <div className="mp-progress-bar">
                  <div className="mp-progress-fill" style={{ width: `${Math.round(dl.progress * 100)}%` }} />
                </div>
                <span className="mp-progress-text">
                  {dl.progress >= 1 ? 'Ready — runs offline now.' : dl.text || 'Downloading…'}
                </span>
              </div>
            )}
          </div>

          <div className="mp-group">
            <div className="mp-group-title">
              On your machine
              <button
                type="button"
                className="mp-refresh"
                title="Re-check for local models"
                onClick={() => setDetectNonce((n) => n + 1)}
              >
                ↻
              </button>
            </div>
            {detecting ? (
              <p className="mp-empty">Looking for local models…</p>
            ) : locals.length > 0 ? (
              locals.map((m) => row(m, { sub: 'Ollama' }))
            ) : (
              <p className="mp-empty">
                No local models found. Start{' '}
                <a {...extLinkProps('https://ollama.com')}>
                  Ollama
                </a>{' '}
                and pull one (e.g. <code>ollama pull llama3.2</code>).
              </p>
            )}
          </div>

          <div className="mp-group">
            <div className="mp-group-title">API models</div>
            {entries.map((m) => row(m, { sub: kindBadgeSub(m), removable: true }))}
            {!adding ? (
              <button type="button" className="mp-add" onClick={() => setAdding(true)}>
                + Add API model
              </button>
            ) : (
              <div className="mp-form">
                <div className="mt-seg" role="radiogroup" aria-label="API target">
                  {TARGETS.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.target === t.value}
                      className={`mt-seg-btn ${draft.target === t.value ? 'on' : ''}`}
                      onClick={() => {
                        setDraft((d) => ({ ...d, target: t.value }));
                        setTest(null);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {draft.target === 'local' && (
                  <input
                    className="mt-model"
                    value={draft.baseUrl}
                    onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
                    placeholder="http://localhost:1234/v1"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
                <input
                  className="mt-model"
                  value={draft.model}
                  onChange={(e) => setDraft((d) => ({ ...d, model: e.target.value }))}
                  placeholder={MODEL_PH[draft.target]}
                  autoComplete="off"
                  spellCheck={false}
                />
                <input
                  className="mt-model"
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft((d) => ({ ...d, apiKey: e.target.value }))}
                  placeholder={draft.target === 'local' ? 'API key (optional)' : 'API key'}
                  autoComplete="off"
                  spellCheck={false}
                />
                <div className="mp-form-actions">
                  <button type="button" className="chip" onClick={runTest} disabled={test === 'testing' || !draft.model.trim()}>
                    {test === 'testing' ? 'Testing…' : 'Test'}
                  </button>
                  <div className="mp-form-right">
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        setAdding(false);
                        setDraft(EMPTY_DRAFT);
                        setTest(null);
                      }}
                    >
                      Cancel
                    </button>
                    <button type="button" className="mp-save" onClick={saveEntry} disabled={!draft.model.trim()}>
                      Save &amp; use
                    </button>
                  </div>
                </div>
                {test && test !== 'testing' && (
                  <span className={`ai-test-note ${test.ok ? 'ok' : 'bad'}`}>{test.note}</span>
                )}
              </div>
            )}
          </div>

          <p className="mt-hint">
            The model only maps which real sources to gather — never the words you read. Keys stay on
            this device.{' '}
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              Manage in Settings →
            </button>
          </p>
        </div>
      )}
    </div>
  );
}

function kindBadgeSub(m: AiModel): string {
  if (m.kind === 'anthropic') return 'Anthropic API';
  if (m.kind === 'ollama') return `Local · ${m.baseUrl ?? 'Ollama'}`;
  return m.baseUrl ? `Local server · ${m.baseUrl}` : 'OpenAI API';
}
