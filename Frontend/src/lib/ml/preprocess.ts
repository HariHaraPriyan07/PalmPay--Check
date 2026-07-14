// ROI → model-input preprocessing. The ONLY place pixels become tensors.
//
// LOCKED to the training pipeline (§3) — EXACTLY these steps and nothing more:
//   1. resize palm ROI to 224×224          2. RGB channel order
//   3. scale ÷255 → [0,1]                  4. ImageNet mean/std per channel
//   5. NCHW [1,3,224,224]                  6. dtype cast happens in the provider
//
// ⚠ NO CLAHE HERE. CLAHE was train-time augmentation only — applying it at
// inference silently corrupts embeddings. No gamma, no histogram equalization,
// no illumination/edge/skeleton ops of any kind.

import { CHANNEL_ORDER, INPUT_SIZE, NORMALIZE_MEAN, NORMALIZE_STD } from "./config";

export interface PreprocessedInput {
  /** CHW float32 tensor, size 3*S*S: x = (px/255 − mean) / std, planes in CHANNEL_ORDER. */
  tensor: Float32Array;
  /** Grayscale luma (0..255), size S*S — used only by quality checks / the dev placeholder. */
  gray: Float32Array;
  width: number;
  height: number;
}

/**
 * Resize a palm-ROI canvas to INPUT_SIZE² and produce the normalized
 * CHW tensor (+ a grayscale copy for quality checks).
 */
export function preprocessRoi(roi: HTMLCanvasElement | OffscreenCanvas): PreprocessedInput {
  const S = INPUT_SIZE;
  const work = document.createElement("canvas");
  work.width = S;
  work.height = S;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("preprocessRoi: 2D context unavailable");
  ctx.drawImage(roi as CanvasImageSource, 0, 0, S, S);
  const { data } = ctx.getImageData(0, 0, S, S);

  const px = S * S;
  const tensor = new Float32Array(3 * px);
  const gray = new Float32Array(px);

  // Channel plane order per CHANNEL_ORDER (RGB → planes r,g,b; BGR → planes b,g,r).
  const planeOf: [number, number, number] = CHANNEL_ORDER === "RGB" ? [0, 1, 2] : [2, 1, 0];

  for (let i = 0; i < px; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const rgb = [r / 255, g / 255, b / 255];
    for (let c = 0; c < 3; c++) {
      tensor[planeOf[c] * px + i] = (rgb[c] - NORMALIZE_MEAN[c]) / NORMALIZE_STD[c];
    }
  }
  return { tensor, gray, width: S, height: S };
}
