// The bundled small model, run fully in the browser via WebLLM (WebGPU). It is
// the same "connection engine, never an author" as every other model path: it
// only builds the JSON study map (which neighboring sources to gather), never
// content the learner reads.
//
// Everything here is lazy: the ~1 GB weights and the WebLLM runtime are only
// fetched the first time the small model is actually selected/used, via a
// dynamic import, so the rest of the app loads untouched. The weights are
// cached by the browser after the first download. If WebGPU is unavailable or
// anything fails, callers fall back to the heuristic — the app never depends on
// this path being present.

export interface WebllmProgress {
  /** 0..1 load progress. */
  progress: number;
  /** Human-readable status line from the loader. */
  text: string;
}
type ProgressCb = (p: WebllmProgress) => void;

/** WebGPU is required. Modern Chrome/Edge and the Tauri WebView2 have it. */
export function webllmSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

// One engine instance, reused across calls. Keyed by model id so switching
// models rebuilds it. `loadedModelId` is the model whose load has STARTED;
// `readyModelId` is only set once that load has actually FINISHED -- so callers
// can tell a warm model (use it now) from a cold one (show progress while it
// loads).
let enginePromise: Promise<unknown> | null = null;
let loadedModelId: string | null = null;
let readyModelId: string | null = null;
// The most recent progress listener. Updated on every getEngine call so an
// in-flight load reports to whoever asked last: the home-page picker starts the
// download, then a session that opens before it finishes takes over the bar.
let activeProgress: ProgressCb | undefined;
let activeCompletions = 0; // in-flight generations -- never unload an engine mid-completion

function resetEngine(): void {
  enginePromise = null;
  loadedModelId = null;
  readyModelId = null;
}

/** True once the given model's load has started (or finished) this session. */
export function webllmReady(modelId: string): boolean {
  return loadedModelId === modelId && enginePromise !== null;
}

/** True only once the model has FINISHED loading into memory this session. */
export function webllmLoaded(modelId: string): boolean {
  return readyModelId === modelId;
}

async function getEngine(modelId: string, onProgress?: ProgressCb): Promise<unknown | null> {
  if (!webllmSupported()) return null;
  // Always adopt the latest listener so an in-flight load reports to the
  // current caller (the picker hands off to the session on navigation).
  activeProgress = onProgress;
  if (!enginePromise || loadedModelId !== modelId) {
    const previous = enginePromise; // outgoing model -- free its VRAM before loading the next
    loadedModelId = modelId;
    readyModelId = null;
    enginePromise = (async () => {
      if (previous) {
        try {
          const old = (await previous) as { unload?: () => Promise<void> } | null;
          if (activeCompletions === 0) await old?.unload?.();
        } catch {
          // best-effort: a failed/early previous load has nothing to free
        }
      }
      const webllm = await import('@mlc-ai/web-llm');
      const engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (r: { progress?: number; text?: string }) =>
          activeProgress?.({ progress: r.progress ?? 0, text: r.text ?? '' }),
      });
      readyModelId = modelId;
      return engine;
    })();
  }
  return enginePromise;
}

/**
 * Kick off (or resume) the model download without generating anything — used by
 * the picker to warm the model and show progress the moment it is selected.
 * Returns false if WebGPU is missing or the load fails.
 */
export async function prewarmWebllm(modelId: string, onProgress?: ProgressCb): Promise<boolean> {
  try {
    const engine = await getEngine(modelId, onProgress);
    return !!engine;
  } catch {
    resetEngine();
    return false;
  }
}

/** Race a promise against a timeout; resolves to null if the timer wins. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  if (!ms || ms <= 0) return p.then((v) => v as T | null, () => null);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      },
    );
  });
}

/**
 * One completion via the in-browser model. Returns null on any failure.
 *
 * The model LOAD (cold start: ~1 GB download + WebGPU init) is awaited WITHOUT
 * a timeout -- it can legitimately take minutes, and `onProgress` surfaces it so
 * the caller shows a bar instead of appearing frozen. Only GENERATION is bounded
 * by `genTimeoutMs`, so a stalled WebGPU inference falls back to the caller's
 * model-free path instead of hanging the app forever. A failed load is reset so
 * the next attempt can retry rather than re-await a permanently-rejected engine.
 */
export async function webllmComplete(
  modelId: string,
  system: string,
  user: string,
  maxTokens: number,
  onProgress?: ProgressCb,
  genTimeoutMs = 120000,
): Promise<string | null> {
  let engine: {
    chat: {
      completions: {
        create: (req: unknown) => Promise<{ choices?: { message?: { content?: string } }[] }>;
      };
    };
  } | null;
  try {
    engine = (await getEngine(modelId, onProgress)) as typeof engine;
  } catch {
    resetEngine();
    return null;
  }
  if (!engine) return null;
  activeCompletions += 1;
  try {
    const reply = await withTimeout(
      engine.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
      genTimeoutMs,
    );
    return reply?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    activeCompletions -= 1;
  }
}
