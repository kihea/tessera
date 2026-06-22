// Optional embeddings layer. When the learner's configured model has an
// embeddings backend (Ollama or any OpenAI-compatible server/API), the
// knowledge graph can refine its neighborhoods and abstraction with real concept
// vectors instead of topology alone. Strictly opt-in (Settings → Developer):
// `embed()` returns null whenever embeddings aren't enabled/available, and every
// caller has a topology-only fallback, so the app is unchanged without it.
//
// Transport mirrors llm.ts: the desktop app routes through the Rust core
// (`llm_embed`, no CORS, keys stay out of webview fetch); a plain browser falls
// back to direct fetch (works for Ollama localhost; api.openai.com is CORS-
// blocked there, so embeddings on that backend want the desktop app).

import { activeModel, loadSettings } from '../state/storage';

const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface EmbedConfig {
  provider: 'ollama' | 'openai';
  baseUrl?: string;
  apiKey?: string;
  model: string;
}

/** The embeddings backend, or null when off / unsupported (anthropic/webllm/none). */
export function embeddingsConfig(): EmbedConfig | null {
  if (loadSettings().dev?.embeddings !== true) return null; // opt-in only
  const m = activeModel();
  if (m.kind === 'ollama') {
    return { provider: 'ollama', baseUrl: m.baseUrl, model: 'nomic-embed-text' };
  }
  if (m.kind === 'openai' && m.model?.trim()) {
    return { provider: 'openai', baseUrl: m.baseUrl, apiKey: m.apiKey, model: 'text-embedding-3-small' };
  }
  return null;
}

export function embeddingsAvailable(): boolean {
  return embeddingsConfig() !== null;
}

/** Embed a batch of texts; null on any failure (callers fall back to topology). */
export async function embed(texts: string[]): Promise<number[][] | null> {
  const cfg = embeddingsConfig();
  if (!cfg || texts.length === 0) return null;
  try {
    if (inTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      const req = {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        input: texts,
      };
      const out = await invoke<number[][]>('llm_embed', { req });
      return Array.isArray(out) && out.length === texts.length ? out : null;
    }
    return await viaBrowser(cfg, texts);
  } catch {
    return null;
  }
}

async function viaBrowser(cfg: EmbedConfig, texts: string[]): Promise<number[][] | null> {
  if (cfg.provider === 'ollama') {
    const base = (cfg.baseUrl?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, input: texts }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings && data.embeddings.length === texts.length ? data.embeddings : null;
  }
  // OpenAI-compatible
  const base = (cfg.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetch(`${base}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const vecs = data.data?.map((d) => d.embedding);
  return vecs && vecs.length === texts.length ? vecs : null;
}
