// ── Parity self-test (§8) — proves browser preprocessing matches training ────
// Runs ONE fixed, deterministic synthetic image through:
//   A. the PRODUCTION path: preprocess → active provider (palm_int8_web on WASM)
//   B. the GROUND-TRUTH path: same preprocess → palm_256_l2_fp32.onnx (reference)
// and logs cosine(A, B). Expect ~0.99+ (int8 quantization noise only). A large
// gap means the preprocessing is wrong — most likely: forgot ÷255, wrong
// mean/std order, BGR vs RGB, or CLAHE accidentally applied at inference.
//
// Exposed in the browser as `window.__palmParitySelfTest()` (see MlDevTools).
// A genuine-vs-impostor pair check is also available: `window.__palmPairCheck`.

import { INPUT_SIZE, PARITY_MIN_COSINE, USE_PLACEHOLDER_PROVIDER, VERIFICATION_THRESHOLD } from "./config";
import { cosineSimilarity } from "./cosine";
import { getEmbeddingProvider } from "./embeddingProvider";
import { preprocessRoi } from "./preprocess";

/**
 * Fixed test pattern — reproduce in Python (uint8, RGB, S×S) as:
 *   r = (x * 7 + y * 13) % 256
 *   g = (x * 3 + y * 5) % 256
 *   b = (x * 11 + y * 2) % 256
 */
export function drawParityTestImage(size = INPUT_SIZE): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.data[i] = (x * 7 + y * 13) % 256;
      img.data[i + 1] = (x * 3 + y * 5) % 256;
      img.data[i + 2] = (x * 11 + y * 2) % 256;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export interface ParityResult {
  provider: string;
  modelVersion: string;
  dim: number;
  l2Norm: number;
  first8: number[];
  /** cosine(production embedding, fp32 reference embedding). Expect ≥ PARITY_MIN_COSINE. */
  referenceCosine: number | null;
  passed: boolean | null;
  embedding: number[];
}

export async function runParitySelfTest(): Promise<ParityResult> {
  const provider = await getEmbeddingProvider();
  const pre = preprocessRoi(drawParityTestImage());
  const emb = await provider.getEmbedding(pre);

  let norm = 0;
  for (let i = 0; i < emb.length; i++) norm += emb[i] * emb[i];

  let referenceCosine: number | null = null;
  let passed: boolean | null = null;
  if (USE_PLACEHOLDER_PROVIDER) {
    console.warn(
      "[ML parity] Active provider is the PLACEHOLDER — comparing it against the fp32 " +
        "reference model is meaningless. Set USE_PLACEHOLDER_PROVIDER = false.",
    );
  } else {
    const { getReferenceEmbedding } = await import("./onnxProvider");
    const ref = await getReferenceEmbedding(pre);
    referenceCosine = cosineSimilarity(emb, ref);
    passed = referenceCosine >= PARITY_MIN_COSINE;
  }

  const result: ParityResult = {
    provider: provider.name,
    modelVersion: provider.modelVersion,
    dim: emb.length,
    l2Norm: Math.sqrt(norm),
    first8: Array.from(emb.slice(0, 8)),
    referenceCosine,
    passed,
    embedding: Array.from(emb),
  };

  console.info("[ML parity self-test]", {
    provider: result.provider,
    modelVersion: result.modelVersion,
    dim: result.dim,
    l2Norm: result.l2Norm,
    first8: result.first8,
    referenceCosine: result.referenceCosine,
  });
  if (result.passed === true) {
    console.info(
      `[ML parity self-test] PASS — cosine(int8-web, fp32 reference) = ` +
        `${result.referenceCosine!.toFixed(6)} ≥ ${PARITY_MIN_COSINE}. Preprocessing matches training.`,
    );
  } else if (result.passed === false) {
    const c = result.referenceCosine!;
    if (c < 0.9) {
      console.error(
        `[ML parity self-test] FAIL — cosine(int8-web, fp32 reference) = ${c.toFixed(6)} ` +
          `< ${PARITY_MIN_COSINE}. The pipeline is broken. Check (most likely first): ÷255 scaling, ` +
          `mean/std values and order, RGB vs BGR, CLAHE/illumination ops accidentally applied ` +
          `at inference, or wrong .onnx files deployed.`,
      );
    } else {
      // Measured integration baseline (2026-07-13, offline onnxruntime with the
      // exact preprocessing): int8-web vs fp32 ≈ 0.948 on this image (~0.93–0.96
      // on realistic ones), while fp16 vs fp32 = 0.999994 — preprocessing is
      // exact; the gap is quantization noise of the shipped INT8 export itself.
      console.warn(
        `[ML parity self-test] BELOW BAR — cosine(int8-web, fp32 reference) = ${c.toFixed(6)} ` +
          `< ${PARITY_MIN_COSINE}, but in the 0.9–0.99 range that matches the known INT8 ` +
          `quantization divergence of this export (preprocessing itself validated exact via ` +
          `the fp16 build). Not a preprocessing bug — raise with the model team whether the ` +
          `INT8 export should be regenerated (e.g. static QDQ) or the 0.99 expectation revised.`,
      );
    }
  }
  return result;
}

// ── Genuine-vs-impostor sanity check (§8) ────────────────────────────────────

export interface PairCheckResult {
  cosine: number;
  threshold: number;
  verdict: "match (genuine-like)" | "no match (impostor-like)";
}

/**
 * Embed two palm images through the PRODUCTION path and compare.
 * Same-palm pairs should score ≥ VERIFICATION_THRESHOLD (0.5216, FAR 0.1%);
 * different-palm pairs should score below it. Dev console:
 *   await window.__palmPairCheck(canvasA, canvasB)
 */
export async function runPairSanityCheck(
  a: HTMLCanvasElement | OffscreenCanvas,
  b: HTMLCanvasElement | OffscreenCanvas,
): Promise<PairCheckResult> {
  const provider = await getEmbeddingProvider();
  const [ea, eb] = await Promise.all([
    provider.getEmbedding(preprocessRoi(a)),
    provider.getEmbedding(preprocessRoi(b)),
  ]);
  const cosine = cosineSimilarity(ea, eb);
  const result: PairCheckResult = {
    cosine,
    threshold: VERIFICATION_THRESHOLD,
    verdict: cosine >= VERIFICATION_THRESHOLD ? "match (genuine-like)" : "no match (impostor-like)",
  };
  console.info(
    `[ML pair check] cosine = ${cosine.toFixed(6)} vs threshold ${VERIFICATION_THRESHOLD} → ${result.verdict}`,
  );
  return result;
}
