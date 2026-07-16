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

import {
  CHANNEL_ORDER,
  INPUT_SIZE,
  NORMALIZE_MEAN,
  NORMALIZE_STD,
  ROI_ILLUMINATION_NORM,
} from "./config";

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

  // Gray copy is always the same (quality checks / dev placeholder use it).
  for (let i = 0; i < px; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  if (ROI_ILLUMINATION_NORM) {
    // Per-ROI per-channel standardization: (px − channelMean) / channelStd.
    // Removes this capture's brightness + contrast so lighting/exposure changes
    // don't move the embedding (illumination invariance, §3.6b). No ÷255 /
    // ImageNet step — the standardization subsumes it.
    const mean = [0, 0, 0];
    for (let i = 0; i < px; i++) {
      mean[0] += data[i * 4];
      mean[1] += data[i * 4 + 1];
      mean[2] += data[i * 4 + 2];
    }
    mean[0] /= px;
    mean[1] /= px;
    mean[2] /= px;
    const varc = [0, 0, 0];
    for (let i = 0; i < px; i++) {
      for (let c = 0; c < 3; c++) {
        const d = data[i * 4 + c] - mean[c];
        varc[c] += d * d;
      }
    }
    const std = varc.map((v) => Math.sqrt(v / px) || 1);
    for (let i = 0; i < px; i++) {
      for (let c = 0; c < 3; c++) {
        tensor[planeOf[c] * px + i] = (data[i * 4 + c] - mean[c]) / std[c];
      }
    }
  } else {
    // Fixed ÷255 + ImageNet mean/std (original training contract).
    for (let i = 0; i < px; i++) {
      for (let c = 0; c < 3; c++) {
        tensor[planeOf[c] * px + i] = (data[i * 4 + c] / 255 - NORMALIZE_MEAN[c]) / NORMALIZE_STD[c];
      }
    }
  }
  return { tensor, gray, width: S, height: S };
}
