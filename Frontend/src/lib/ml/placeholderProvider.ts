// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  ⚠ PLACEHOLDER EMBEDDING PROVIDER — NOT A BIOMETRIC MODEL ⚠               ║
// ║                                                                          ║
// ║  This exists ONLY to wire and end-to-end test the enrollment/attendance ║
// ║  pipeline while the real palm-embedding ONNX model is being trained.    ║
// ║  It computes deterministic image statistics (patch luminance means fed  ║
// ║  through a fixed pseudo-random projection), so the same palm image      ║
// ║  yields a near-identical vector each capture — which makes enrollment   ║
// ║  vs. verification meaningful for FLOW testing.                          ║
// ║                                                                          ║
// ║  It has essentially NO biometric discriminative power. Do not tune      ║
// ║  thresholds against it, do not report accuracy from it, and do not      ║
// ║  deploy it as if it identified anyone. See README §"Placeholder model". ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { EMBEDDING_DIM } from "./config";
import { l2Normalize } from "./cosine";
import type { PreprocessedInput } from "./preprocess";
import type { EmbeddingProvider } from "./embeddingProvider";

const GRID = 16; // 16×16 patch grid → 256 raw features
const PROJECTION_SEED = 0xc17a11; // fixed → fully deterministic across sessions/devices

/** mulberry32 PRNG — deterministic projection matrix without shipping weights. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let projection: Float32Array | null = null; // GRID² × EMBEDDING_DIM, lazily built

function getProjection(): Float32Array {
  if (!projection) {
    const rand = mulberry32(PROJECTION_SEED);
    projection = new Float32Array(GRID * GRID * EMBEDDING_DIM);
    for (let i = 0; i < projection.length; i++) {
      projection[i] = rand() * 2 - 1;
    }
  }
  return projection;
}

export class PlaceholderEmbeddingProvider implements EmbeddingProvider {
  readonly name = "PLACEHOLDER (deterministic image-statistics — NOT a biometric model)";
  readonly modelVersion = "placeholder-v1"; // never confuse placeholder templates with real ones

  async init(): Promise<void> {
    getProjection();
    if (typeof console !== "undefined") {
      console.warn(
        "[ML] Running the PLACEHOLDER embedding provider. It is NOT a biometric model — " +
          "flow-testing only. See src/lib/ml/placeholderProvider.ts and README.",
      );
    }
  }

  async getEmbedding(input: PreprocessedInput): Promise<Float32Array> {
    const { gray, width, height } = input;
    const patchW = width / GRID;
    const patchH = height / GRID;

    // 256 patch-luminance means, centered on the global mean.
    const features = new Float32Array(GRID * GRID);
    let globalMean = 0;
    for (let py = 0; py < GRID; py++) {
      for (let px = 0; px < GRID; px++) {
        let sum = 0;
        let n = 0;
        const x0 = Math.floor(px * patchW);
        const y0 = Math.floor(py * patchH);
        const x1 = Math.floor((px + 1) * patchW);
        const y1 = Math.floor((py + 1) * patchH);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            sum += gray[y * width + x];
            n++;
          }
        }
        const mean = n > 0 ? sum / n : 0;
        features[py * GRID + px] = mean;
        globalMean += mean;
      }
    }
    globalMean /= features.length;
    for (let i = 0; i < features.length; i++) features[i] -= globalMean;

    // Fixed random projection to EMBEDDING_DIM, then L2-normalize.
    const proj = getProjection();
    const out = new Float32Array(EMBEDDING_DIM);
    for (let f = 0; f < features.length; f++) {
      const v = features[f];
      if (v === 0) continue;
      const row = f * EMBEDDING_DIM;
      for (let d = 0; d < EMBEDDING_DIM; d++) {
        out[d] += v * proj[row + d];
      }
    }
    return l2Normalize(out);
  }
}
