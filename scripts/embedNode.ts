/*
 * Node-side embeddings transport for the OFFLINE seed-graph build. Mirrors the
 * browser path in src/ai/embeddings.ts (Ollama /api/embed and OpenAI-compatible
 * /embeddings) but reads its config from ENVIRONMENT VARIABLES instead of the
 * browser's settings, and uses Node 18+ global fetch. Used only by
 * scripts/buildSeedGraph.ts -- the app's runtime never imports this.
 *
 * Config (all optional):
 *   TESSERA_EMBED_PROVIDER   'ollama' | 'openai'   (default: openai if OPENAI_API_KEY else ollama)
 *   EMBED_MODEL              model name            (default: qwen3-embedding:latest / text-embedding-3-small)
 *   EMBED_DIMS               Matryoshka target     (default 1024 -- 8B vectors truncated + renormalized)
 *   OLLAMA_BASE_URL          e.g. http://localhost:11434
 *   OPENAI_BASE_URL          e.g. https://api.openai.com/v1
 *   OPENAI_API_KEY           required for the openai provider
 */

import { truncateUnit } from '../src/ai/vec';

// Matryoshka truncation target. The 8B model returns 4096-dim; we keep the first
// EMBED_DIMS and renormalize so the bundle stays lean while carrying the 8B's
// understanding. src/ai/embeddings.ts uses the SAME dims so spaces align.
const EMBED_DIMS = Number(process.env.EMBED_DIMS) || 1024;
// Per-request timeout: an 8B embed of a large batch can hang; abort + retry rather
// than wedge the whole build. Generous so genuinely-slow (but working) calls finish.
const REQ_TIMEOUT = Number(process.env.EMBED_TIMEOUT_MS) || 180000;

interface NodeEmbedConfig {
  provider: 'ollama' | 'openai';
  baseUrl: string;
  apiKey?: string;
  model: string;
}

export function nodeEmbedConfig(): NodeEmbedConfig {
  const explicit = process.env.TESSERA_EMBED_PROVIDER as 'ollama' | 'openai' | undefined;
  const provider = explicit ?? (process.env.OPENAI_API_KEY ? 'openai' : 'ollama');
  if (provider === 'openai') {
    return {
      provider,
      baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.EMBED_MODEL || 'text-embedding-3-small',
    };
  }
  return {
    provider: 'ollama',
    baseUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    model: process.env.EMBED_MODEL || 'qwen3-embedding:latest',
  };
}

/** Human-readable summary of the resolved embedder, for build logs. */
export function embedderInfo(): string {
  const c = nodeEmbedConfig();
  const warn = c.provider === 'openai' && !c.apiKey ? '  (!! no OPENAI_API_KEY set)' : '';
  return `${c.provider} · ${c.model} · ${c.baseUrl}${warn}`;
}

async function embedBatch(cfg: NodeEmbedConfig, texts: string[]): Promise<number[][] | null> {
  if (cfg.provider === 'ollama') {
    const res = await fetch(`${cfg.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, input: texts }),
      signal: AbortSignal.timeout(REQ_TIMEOUT),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings && data.embeddings.length === texts.length
      ? data.embeddings.map((v) => truncateUnit(v, EMBED_DIMS))
      : null;
  }
  // OpenAI-compatible
  const res = await fetch(`${cfg.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({ model: cfg.model, input: texts }),
    signal: AbortSignal.timeout(REQ_TIMEOUT),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: { embedding: number[] }[] };
  const vecs = data.data?.map((d) => d.embedding);
  return vecs && vecs.length === texts.length ? vecs.map((v) => truncateUnit(v, EMBED_DIMS)) : null;
}

/** Probe the embedder with one tiny request. False if it's unreachable/misconfigured. */
export async function probeEmbedder(): Promise<boolean> {
  try {
    const v = await embedBatch(nodeEmbedConfig(), ['tessera embedding probe']);
    return !!v && v.length === 1 && Array.isArray(v[0]) && v[0].length > 0;
  } catch {
    return false;
  }
}

/**
 * Embed every text, in batches, with a couple of retries per batch. Returns null
 * if any batch ultimately fails (callers ship topology-only in that case).
 */
export async function embedAll(
  texts: string[],
  {
    batchSize = Number(process.env.EMBED_BATCH) || 48,
    retries = 2,
  }: { batchSize?: number; retries?: number } = {},
): Promise<number[][] | null> {
  const cfg = nodeEmbedConfig();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const chunk = texts.slice(i, i + batchSize);
    let got: number[][] | null = null;
    for (let attempt = 0; attempt <= retries && !got; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt));
      try {
        got = await embedBatch(cfg, chunk);
      } catch {
        got = null;
      }
    }
    if (!got) return null;
    out.push(...got);
  }
  return out;
}
