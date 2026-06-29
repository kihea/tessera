// Compact int8 quantization for concept embedding vectors. Lets the bundled
// seed graph ship REAL vectors (so semantic edges + vector-blended intensity are
// available on first run) without a multi-megabyte asset: a 768-dim float32
// vector is ~3 KB as JSON numbers but ~1 KB as base64 int8, and the
// reconstruction error is far below the cosine thresholds the graph uses.
//
// Symmetric per-vector quantization: scale = maxAbs/127, q = round(v/scale).
// Pure and portable -- no Buffer / btoa -- so the same code runs in the Node
// build (scripts/buildSeedGraph.ts) and the browser runtime (ensureSeeded).

export interface QuantizedVector {
  q: string; // base64 of the int8 bytes
  s: number; // dequantization scale
  n: number; // dimensions (sanity check on decode)
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INV: Int16Array = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const len = b64.length;
  if (len === 0) return new Uint8Array(0);
  let pad = 0;
  if (b64[len - 1] === '=') pad++;
  if (b64[len - 2] === '=') pad++;
  const outLen = (len / 4) * 3 - pad;
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_INV[b64.charCodeAt(i)];
    const b = B64_INV[b64.charCodeAt(i + 1)];
    const c = b64.charCodeAt(i + 2) === 61 ? 0 : B64_INV[b64.charCodeAt(i + 2)];
    const d = b64.charCodeAt(i + 3) === 61 ? 0 : B64_INV[b64.charCodeAt(i + 3)];
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}

/** Quantize a float vector to a compact base64 int8 form. */
export function quantizeVector(v: number[]): QuantizedVector {
  const n = v.length;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(v[i]);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 0 ? maxAbs / 127 : 1;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let q = Math.round(v[i] / scale);
    if (q > 127) q = 127;
    else if (q < -127) q = -127;
    bytes[i] = q & 0xff; // store the int8 as an unsigned byte
  }
  return { q: bytesToBase64(bytes), s: scale, n };
}

/** Reconstruct an approximate float vector from its quantized form. */
export function dequantizeVector(qv: QuantizedVector): number[] {
  const bytes = base64ToBytes(qv.q);
  const out = new Array<number>(qv.n);
  for (let i = 0; i < qv.n; i++) {
    const b = bytes[i] ?? 0;
    const signed = b < 128 ? b : b - 256; // unsigned byte -> int8
    out[i] = signed * qv.s;
  }
  return out;
}

/** Is this stored value a quantized vector (vs a plain number[] or undefined)? */
export function isQuantizedVector(x: unknown): x is QuantizedVector {
  return (
    !!x &&
    typeof x === 'object' &&
    typeof (x as QuantizedVector).q === 'string' &&
    typeof (x as QuantizedVector).s === 'number' &&
    typeof (x as QuantizedVector).n === 'number'
  );
}
