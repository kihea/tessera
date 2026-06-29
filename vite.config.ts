import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// web-llm ships a sourcemap whose `sources` point at files it doesn't publish
// (its own ../src/*.ts and bundled deps), so Vite's dev server logs a noisy
// "Sourcemap for … points to missing source files" warning for it. It is purely
// cosmetic and unrelated to runtime, so drop just that one message.
const logger = createLogger();
const isSourcemapNoise = (msg: string) =>
  msg.includes('Sourcemap for') && msg.includes('points to missing source files');
const baseWarn = logger.warn;
logger.warn = (msg, opts) => {
  if (typeof msg === 'string' && isSourcemapNoise(msg)) return;
  baseWarn(msg, opts);
};
const baseWarnOnce = logger.warnOnce;
logger.warnOnce = (msg, opts) => {
  if (typeof msg === 'string' && isSourcemapNoise(msg)) return;
  baseWarnOnce(msg, opts);
};

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  server: { port: 5173 },
  // web-llm is large and WASM-bearing; keep it out of dev prebundling so it
  // only loads as a lazy chunk when the bundled small model is actually picked.
  optimizeDeps: { exclude: ['@mlc-ai/web-llm'] },
});
