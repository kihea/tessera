// localStorage persistence: notes per topic, recent topics, bandit state,
// learner preferences from onboarding.

import type { BanditState } from '../weave/bandit';
import type { LearnerPrefs } from '../types';

export function slugify(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export interface RecentTopic {
  query: string;
  slug: string;
  updated: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full / privacy mode: notes still live in memory for the session
  }
}

export function loadNotes(slug: string): string | null {
  return read<string>(`tessera:notes:${slug}`);
}

export function saveNotes(slug: string, notes: string): void {
  write(`tessera:notes:${slug}`, notes);
}

export function loadTopics(): RecentTopic[] {
  return read<RecentTopic[]>('tessera:topics') ?? [];
}

export function rememberTopic(query: string, slug: string): void {
  const topics = loadTopics().filter((t) => t.slug !== slug);
  topics.unshift({ query, slug, updated: Date.now() });
  write('tessera:topics', topics.slice(0, 12));
}

export function forgetTopic(slug: string): void {
  write('tessera:topics', loadTopics().filter((t) => t.slug !== slug));
  try {
    localStorage.removeItem(`tessera:notes:${slug}`);
  } catch {
    // ignore
  }
}

export function loadBandit(): BanditState | null {
  return read<BanditState>('tessera:bandit');
}

export function saveBandit(state: BanditState): void {
  write('tessera:bandit', state);
}

export const DEFAULT_PREFS: LearnerPrefs = {
  sourceAffinity: {
    encyclopedia: 0,
    textbook: 0,
    paper: 0,
    discussion: 0,
    book: 0,
    news: 0,
    primary: 0,
    reference: 0,
    video: 0,
  },
  opening: 'balanced',
  checkpointEvery: 6,
};

export function loadPrefs(): LearnerPrefs | null {
  return read<LearnerPrefs>('tessera:prefs');
}

export function savePrefs(prefs: LearnerPrefs): void {
  write('tessera:prefs', prefs);
}

/**
 * The model that powers source CONNECTION (never synthesis): it reads the
 * seed material and decides what neighboring concepts to gather real sources
 * for, and why. Users run their own small local model (Ollama / any
 * OpenAI-compatible server) or plug an API key. 'none' = the app's built-in
 * heuristic does the branching instead.
 */
export type AiProvider = 'none' | 'ollama' | 'openai' | 'anthropic';

/**
 * How a model connects: the heuristic (none); the bundled in-browser model
 * (webllm, downloaded once and run client-side via WebGPU); a local Ollama
 * model; or an OpenAI-/Anthropic-compatible API.
 */
export type AiKind = 'none' | 'webllm' | 'ollama' | 'openai' | 'anthropic';

/**
 * One selectable connection model. The two builtins (heuristic, small) are
 * always offered; locally-installed Ollama models are discovered at runtime;
 * API entries are user-saved. Picking any of them sets it as `selected`.
 */
export interface AiModel {
  id: string;
  kind: AiKind;
  label: string;
  /** One-line descriptor shown under the label in the picker (size, tradeoff). */
  note?: string;
  /** Provider model id (e.g. 'llama3.2:1b', 'gpt-5-mini', a WebLLM model id). */
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

/**
 * WebLLM model ids for the bundled in-browser tiers — each downloaded once and
 * run client-side via WebGPU. Only one is resident in memory at a time; picking
 * another swaps it in (the old one is unloaded to free VRAM, weights stay
 * cached). All three are q4f16, 4096-token context, and emit only the JSON
 * study map — never content the learner reads.
 */
export const SMALL_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
export const MEDIUM_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const LARGE_MODEL_ID = 'gemma-2-2b-it-q4f16_1-MLC';

export const HEURISTIC_MODEL: AiModel = { id: 'heuristic', kind: 'none', label: 'Heuristic branching' };
export const SMALL_MODEL: AiModel = {
  id: 'small',
  kind: 'webllm',
  label: 'Small model',
  model: SMALL_MODEL_ID,
  note: 'Llama 3.2 1B · ~0.9 GB · fastest, lightest',
};
export const MEDIUM_MODEL: AiModel = {
  id: 'medium',
  kind: 'webllm',
  label: 'Medium model',
  model: MEDIUM_MODEL_ID,
  note: 'Qwen2.5 1.5B · ~1 GB · best balance',
};
export const LARGE_MODEL: AiModel = {
  id: 'large',
  kind: 'webllm',
  label: 'Large model',
  model: LARGE_MODEL_ID,
  note: 'Gemma 2 2B · ~1.6 GB · strongest (needs ~2 GB VRAM)',
};
export const BUILTIN_MODELS: AiModel[] = [HEURISTIC_MODEL, SMALL_MODEL, MEDIUM_MODEL, LARGE_MODEL];

export interface AiSettings {
  /** Branch-out reach 0..1 (how far from the main idea to gather). */
  radius?: number;
  /** The active connection model. */
  selected?: AiModel;
  /** User-saved API / local-server entries, selectable from the picker. */
  apiEntries?: AiModel[];
  // -- legacy fields: read once to migrate an older settings blob, never written --
  provider?: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export const DEFAULT_AI: AiSettings = { radius: 0.5, selected: HEURISTIC_MODEL, apiEntries: [] };

/** Migrate a pre-registry settings blob (provider/model/...) into one entry. */
function legacyEntry(ai: AiSettings): AiModel | null {
  if (ai.provider && ai.provider !== 'none' && ai.model?.trim()) {
    return {
      id: 'legacy',
      kind: ai.provider,
      label: ai.model.trim(),
      model: ai.model.trim(),
      baseUrl: ai.baseUrl,
      apiKey: ai.apiKey,
    };
  }
  return null;
}

/** The active connection model, resolving defaults + legacy migration. */
export function activeModel(ai: AiSettings | undefined = loadSettings().ai): AiModel {
  if (ai?.selected) return ai.selected;
  return legacyEntry(ai ?? {}) ?? HEURISTIC_MODEL;
}

/** The saved API/local entries (migrating an older single entry in if present). */
export function apiEntries(ai: AiSettings | undefined = loadSettings().ai): AiModel[] {
  if (ai?.apiEntries) return ai.apiEntries;
  const legacy = legacyEntry(ai ?? {});
  return legacy ? [legacy] : [];
}

/**
 * Per-user connection settings. Everything here stays in THIS browser's
 * localStorage -- keys are never bundled into the app or sent anywhere except
 * the provider they belong to.
 */
/** Visual themes. Standard is the original dark scholarly look. */
export type ThemeName = 'standard' | 'alexandria' | 'terminal';

export const THEMES: { key: ThemeName; label: string; blurb: string }[] = [
  { key: 'standard', label: 'Standard', blurb: 'The dark scholarly default — quiet, high-contrast reading.' },
  { key: 'alexandria', label: 'Library of Alexandria', blurb: 'Warm parchment and sepia ink — a classical reading room.' },
  { key: 'terminal', label: 'Terminal', blurb: 'Black screen, phosphor green, monospace — a CRT console.' },
];

/** Apply a theme to the document root. Safe to call before/without a DOM. */
export function applyTheme(theme: ThemeName | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme ?? 'standard';
}

export interface AppSettings {
  /** OpenAlex Premium API key (optional -- raises rate limits). */
  openAlexApiKey?: string;
  /** Email for OpenAlex's keyless "polite pool" (optional -- better service). */
  politeEmail?: string;
  /** YouTube Data API key (optional, desktop only) -- enables the video feed. */
  youtubeApiKey?: string;
  /** SerpApi key (optional, desktop only) -- enables the Google Scholar feed. */
  serpApiKey?: string;
  /** Local/API model used to connect sources (optional). */
  ai?: AiSettings;
  /** Visual theme (optional, defaults to 'standard'). */
  theme?: ThemeName;
}

export function loadSettings(): AppSettings {
  return read<AppSettings>('tessera:settings') ?? {};
}

export function saveSettings(settings: AppSettings): void {
  write('tessera:settings', settings);
}

// -- reported sources ---------------------------------------------------------
// A learner can flag a bad source (broken OCR, off-topic, untrustworthy).
// Reported docs are excluded from the live session AND from every future
// research merge. Local-only, reversible by clearing site data.

export interface ReportedSource {
  url: string;
  title: string;
  when: number;
}

export function loadReports(): ReportedSource[] {
  return read<ReportedSource[]>('tessera:reported') ?? [];
}

export function addReport(url: string, title: string): void {
  const all = loadReports().filter((r) => r.url !== url);
  all.unshift({ url, title, when: Date.now() });
  write('tessera:reported', all.slice(0, 200));
}

export function isReported(url: string): boolean {
  return loadReports().some((r) => r.url === url);
}
