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

// ── Mean-centering (fixes the "matches all hands" collapse) ──────────────────
// This palm model's raw 256-D outputs share a dominant common direction: even
// completely unrelated images score cosine ~0.6–0.97 against each other, so the
// genuine and impostor distributions OVERLAP and no raw-cosine threshold can
// separate them. Subtracting the population-mean embedding (the shared
// direction) and re-normalizing pulls impostors down toward ~0 while genuine
// pairs stay high — restoring a usable margin. Templates are stored RAW; both
// probe and template are centered symmetrically at match time, so the mean can
// keep improving as more students enrol without invalidating stored templates.

/** Element-wise mean of many vectors (NOT re-normalized — this is the centering origin). */
export function meanVector(embeddings: ArrayLike<number>[]): Float32Array {
  if (embeddings.length === 0) throw new Error("meanVector: empty input");
  const dim = embeddings[0].length;
  const out = new Float32Array(dim);
  for (const e of embeddings) {
    for (let i = 0; i < dim; i++) out[i] += e[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= embeddings.length;
  return out;
}

/** (v − mean) then L2-normalized. Returns a fresh vector; inputs untouched. */
export function centerAndNormalize(v: ArrayLike<number>, mean: ArrayLike<number>): Float32Array {
  if (v.length !== mean.length) {
    throw new Error(`centerAndNormalize: dim mismatch ${v.length} vs ${mean.length}`);
  }
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] - mean[i];
  return l2Normalize(out);
}

/** Cosine similarity in the mean-centered space (subtract `mean`, renormalize, dot). */
export function centeredCosine(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  mean: ArrayLike<number>,
): number {
  return cosineSimilarity(centerAndNormalize(a, mean), centerAndNormalize(b, mean));
}
