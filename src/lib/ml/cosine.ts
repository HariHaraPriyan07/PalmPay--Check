/** Cosine similarity. Inputs are expected to be L2-normalized (then this is just a dot product). */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dim mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** In-place L2 normalization; returns the same array. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) v[i] /= norm;
  }
  return v;
}

/** Element-wise average of several vectors, re-normalized (enrollment template, §5). */
export function averageEmbeddings(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) throw new Error("averageEmbeddings: empty input");
  const dim = embeddings[0].length;
  const out = new Float32Array(dim);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) out[i] += e[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= embeddings.length;
  return l2Normalize(out);
}
