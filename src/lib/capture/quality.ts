// Per-frame quality gates for enrollment/verification captures (§5.3).
// Every threshold is a named constant — reject + re-prompt on failure.

import type { RoiInfo } from "./roi";

// ── Gate thresholds (tunable) ────────────────────────────────────────────────
export const MIN_PALM_SIZE_FRAC = 0.18; // palm must fill enough of the frame
export const CENTER_TOLERANCE = 0.28; // palm center within ±28% of frame center
export const MIN_OPENNESS = 1.05; // fingertip spread / palm size; fist ≈ < 0.8
export const MIN_BRIGHTNESS = 60; // mean luma 0..255
export const MAX_BRIGHTNESS = 205;
export const MIN_LAPLACIAN_VARIANCE = 55; // motion blur / focus gate

export interface QualityChecks {
  detected: boolean;
  centered: boolean;
  sizeOk: boolean;
  open: boolean;
  bright: boolean;
  sharp: boolean;
}

export interface QualityResult {
  ok: boolean;
  checks: QualityChecks;
  brightness: number;
  laplacianVar: number;
  /** 0..1 composite used as the stored qualityScore. */
  score: number;
  /** First failing gate as a user-facing hint (design-system status-warn styling). */
  message: string | null;
}

/** Downscaled grayscale of a canvas — shared by blur/brightness and liveness checks. */
export function grayFromCanvas(canvas: HTMLCanvasElement, size = 64): Float32Array {
  const work = document.createElement("canvas");
  work.width = size;
  work.height = size;
  const ctx = work.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const gray = new Float32Array(size * size);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  return gray;
}

/** Variance of the 4-neighbor Laplacian — low = blurred/defocused frame. */
export function laplacianVariance(gray: Float32Array, size = 64): number {
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - size] - gray[i + size];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export function meanBrightness(gray: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < gray.length; i++) sum += gray[i];
  return sum / gray.length;
}

export function assessQuality(roi: RoiInfo | null): QualityResult {
  const checks: QualityChecks = {
    detected: false,
    centered: false,
    sizeOk: false,
    open: false,
    bright: false,
    sharp: false,
  };
  if (!roi) {
    return {
      ok: false,
      checks,
      brightness: 0,
      laplacianVar: 0,
      score: 0,
      message: "No palm detected — hold your palm facing the camera",
    };
  }
  checks.detected = true;
  checks.centered =
    Math.abs(roi.centerX - 0.5) <= CENTER_TOLERANCE &&
    Math.abs(roi.centerY - 0.5) <= CENTER_TOLERANCE;
  checks.sizeOk = roi.sizeFrac >= MIN_PALM_SIZE_FRAC;
  checks.open = roi.openness >= MIN_OPENNESS;

  const gray = grayFromCanvas(roi.canvas);
  const brightness = meanBrightness(gray);
  const laplacianVar = laplacianVariance(gray);
  checks.bright = brightness >= MIN_BRIGHTNESS && brightness <= MAX_BRIGHTNESS;
  checks.sharp = laplacianVar >= MIN_LAPLACIAN_VARIANCE;

  const ok = Object.values(checks).every(Boolean);
  const passed = Object.values(checks).filter(Boolean).length;
  const score = passed / 6;

  let message: string | null = null;
  if (!checks.centered) message = "Center your palm in the frame";
  else if (!checks.sizeOk) message = "Move your palm closer to the camera";
  else if (!checks.open) message = "Open your hand — fingers relaxed, palm flat";
  else if (!checks.bright)
    message =
      brightness < MIN_BRIGHTNESS
        ? "Too dark — face a light source or turn on room lights"
        : "Too bright — avoid direct light on the palm";
  else if (!checks.sharp) message = "Hold steady — the image is blurred";

  return { ok, checks, brightness, laplacianVar, score, message };
}
