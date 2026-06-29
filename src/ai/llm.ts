// The model adapter. One job: given (system, user), return the model's text.
//
// Tessera treats the model as a CONNECTION engine, never an author -- nothing
// it writes is ever shown as learning content. It only decides which real
// sources to gather and how they relate (see prompts.ts), so a small local
// model is enough: the Odysseus pattern -- bring your own weights (Ollama or
// any OpenAI-compatible server: llama.cpp, LM Studio, vLLM), or plug an API
// key (Anthropic / OpenAI).
//
// Transport: inside the desktop (Tauri) app every call goes through the Rust
// core (`llm_complete`) -- no CORS, and API keys never travel through webview
// fetch. In a plain browser we fall back to direct fetch, which works for
// Ollama (localhost origins are allowed by default) and Anthropic (browser
// access header); api.openai.com blocks browser CORS -- the desktop app is
// the way to use that one.

import type { AiModel } from '../state/storage';
import { activeModel } from '../state/storage';
import { webllmComplete, webllmSupported } from './webllm';
import type { WebllmProgress } from './webllm';

/** Whether the active model can actually run (heuristic / 'none' = not configured). */
export function aiConfigured(m: AiModel = activeModel()): boolean {
  if (m.kind === 'none') return false;
  if (m.kind === 'webllm') return webllmSupported();
  return !!m.model?.trim();
}

function inTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface LlmRequest {
  provider: string;
  baseUrl?: string;
  model: string;
  apiKey?: string;
  system: string;
  user: string;
  maxTokens: number;
}

async function viaTauri(req: LlmRequest): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('llm_complete', { req });
}

async function postJSON(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text().then((t) => t.slice(0, 200)).catch(() => '')}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaBrowser(req: LlmRequest, timeoutMs: number): Promise<string> {
  if (req.provider === 'ollama') {
    const base = (req.baseUrl?.trim() || 'http://localhost:11434').replace(/\/+$/, '');
    const data = (await postJSON(
      `${base}/api/chat`,
      {},
      {
        model: req.model,
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      },
      timeoutMs,
    )) as { message?: { content?: string } };
    return data.message?.content ?? '';
  }
  if (req.provider === 'anthropic') {
    const data = (await postJSON(
      'https://api.anthropic.com/v1/messages',
      {
        'x-api-key': req.apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
      },
      timeoutMs,
    )) as { content?: { type: string; text?: string }[] };
    return (data.content ?? []).map((b) => b.text ?? '').join('');
  }
  // OpenAI-compatible (api.openai.com, LM Studio, llama.cpp server, vLLM...)
  const base = (req.baseUrl?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const data = (await postJSON(
    `${base}/chat/completions`,
    req.apiKey ? { authorization: `Bearer ${req.apiKey}` } : {},
    {
      model: req.model,
      temperature: 0.2,
      max_tokens: req.maxTokens,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    },
    timeoutMs,
  )) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content ?? '';
}

/**
 * Run one completion. Returns null when no model is configured or the call
 * fails -- callers always have a model-free fallback (the app must remain
 * fully usable with no AI at all).
 */
export async function complete(
  system: string,
  user: string,
  opts?: { maxTokens?: number; timeoutMs?: number; model?: AiModel; onProgress?: (p: WebllmProgress) => void },
): Promise<string | null> {
  const m = opts?.model ?? activeModel();
  if (!aiConfigured(m)) return null;
  const maxTokens = opts?.maxTokens ?? 1400;
  // The bundled small model runs in-page (no fetch/Tauri transport). A cold
  // model reports load progress via onProgress; generation is bounded by the
  // same timeout the network providers use, so it can never hang the caller.
  if (m.kind === 'webllm')
    return webllmComplete(m.model!, system, user, maxTokens, opts?.onProgress, opts?.timeoutMs ?? 120000);
  const req: LlmRequest = {
    provider: m.kind,
    baseUrl: m.baseUrl,
    model: m.model!.trim(),
    apiKey: m.apiKey,
    system,
    user,
    maxTokens,
  };
  try {
    const text = inTauri() ? await viaTauri(req) : await viaBrowser(req, opts?.timeoutMs ?? 120000);
    return text.trim() || null;
  } catch {
    return null;
  }
}

/** Picker "Test" button: distinguishes "works" from "reachable but refused" from "unreachable". */
export async function testModel(m: AiModel): Promise<{ ok: boolean; note: string }> {
  if (m.kind === 'none') return { ok: false, note: 'Heuristic branching needs no model — it always works.' };
  if (m.kind === 'webllm') {
    return webllmSupported()
      ? { ok: true, note: 'WebGPU detected — the model downloads on first use (~1 GB), then runs offline.' }
      : { ok: false, note: 'This browser has no WebGPU. Use a recent Chrome/Edge, or the desktop app.' };
  }
  if (!m.model?.trim()) return { ok: false, note: 'Enter a model id first.' };
  const req: LlmRequest = {
    provider: m.kind,
    baseUrl: m.baseUrl,
    model: m.model.trim(),
    apiKey: m.apiKey,
    system: 'Reply with exactly: ok',
    user: 'ok?',
    maxTokens: 8,
  };
  try {
    const text = inTauri() ? await viaTauri(req) : await viaBrowser(req, 30000);
    return text.trim()
      ? { ok: true, note: `Model replied — connection works.` }
      : { ok: false, note: 'Connected, but the model returned nothing.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|load failed/i.test(msg)) {
      return {
        ok: false,
        note:
          m.kind === 'ollama'
            ? 'Could not reach Ollama. Is it running? (In the browser, Ollama allows localhost pages by default; the desktop app always works.)'
            : 'Could not reach the server from the browser (likely CORS). The desktop app routes this through Rust and works.',
      };
    }
    return { ok: false, note: `The server answered with an error: ${msg.slice(0, 140)}` };
  }
}

/**
 * Pull the first JSON object out of a model reply (tolerates ```json fences
 * and prose around it). Returns null when nothing parses -- the caller falls
 * back to the heuristic path.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text;
  const start = fenced.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < fenced.length; i++) {
    const ch = fenced[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(fenced.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
