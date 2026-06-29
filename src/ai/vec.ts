// Tiny vector helpers for the optional embeddings layer. Pure and dependency-
// free so they are trivially testable and run anywhere.

/** Dot product. Assumes equal length. */
export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Euclidean norm. */
export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity in [-1, 1]; 0 for a zero/empty/mismatched vector. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/** Mean vector of a non-empty set (component-wise average). */
export function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const out = new Array<number>(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i];
  for (let i = 0; i < out.length; i++) out[i] /= vectors.length;
  return out;
}

/**
 * Matryoshka truncation: take the first `dims` components and L2-normalize. Qwen3
 * embeddings are MRL-trained, so the leading dims of the 8B model's 4096-vector
 * stay a faithful, smaller unit vector -- strong understanding at a lean size.
 * If `dims` >= length, the whole vector is normalized; a zero vector is returned
 * as-is. Build and runtime MUST use the same dims so vectors share one space.
 */
export function truncateUnit(v: number[], dims: number): number[] {
  const head = dims < v.length ? v.slice(0, dims) : v.slice();
  const n = norm(head);
  if (n === 0) return head;
  for (let i = 0; i < head.length; i++) head[i] /= n;
  return head;
}
