// ── Data-driven calibration: pick the best transform + threshold from real palms
// Raw cosine on this model is not separable, but the RIGHT linear transform +
// an empirically-placed threshold might be. Rather than assume, this tries
// several transforms on the ACTUAL captured palms and keeps whichever separates
// best (lowest equal-error rate):
//   • raw      — L2-normalized embedding, plain cosine.
//   • centered — subtract the population mean, renormalize (removes the shared
//                "DC" direction).
//   • whitened — subtract the mean AND divide each dimension by its across-sample
//                std (diagonal whitening), renormalize. Helps when a few
//                dimensions dominate the cosine.
// The chosen transform (mean + optional per-dim scale) + thresholds are
// persisted and applied identically at verification time (ml/centering.ts).

import { cosineSimilarity, l2Normalize, meanVector } from "./cosine";
import { EMBEDDING_DIM, MODEL_FAMILY } from "./config";

const STORAGE_KEY = "palmCalibration.v1";

export type TransformMode = "raw" | "centered" | "whitened";

export interface CalibrationData {
  /** Embedding-space tag (MODEL_FAMILY). Calibration is void if it changes. */
  preprocVersion: string;
  /** Which transform separated best on the captured palms. */
  mode: TransformMode;
  mean: number[]; // centering origin (EMBEDDING_DIM); ignored when mode==="raw"
  scale?: number[]; // per-dim divisor (EMBEDDING_DIM); present only when mode==="whitened"
  acceptThreshold: number; // accept bar in the chosen transform's cosine space
  retryThreshold: number; // retry floor
  genuineMean: number;
  genuineStd: number;
  impostorMean: number;
  impostorStd: number;
  /** Equal-error rate of the chosen transform (0..1). Lower = better. */
  eer: number;
  /** EER of every candidate transform, for diagnostics. */
  eerByMode: Record<TransformMode, number>;
  separation: number;
  sampleCount: number;
  personCount: number;
  updatedAt: number;
}

export interface LabeledSample {
  /** Person identity — SAME label = genuine pair, DIFFERENT = impostor pair. */
  label: string;
  /** Raw (uncentered) L2-normalized embedding. */
  embedding: Float32Array;
}

export interface CalibrationAnalysis {
  ok: boolean;
  message: string;
  data: CalibrationData | null;
  genuineScores: number[];
  impostorScores: number[];
}

function stdOf(values: number[], mean: number): number {
  if (values.length === 0) return 0;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(Math.max(0, v));
}

/** Apply a transform (subtract mean, optional per-dim scale) then L2-normalize. */
export function applyTransform(
  v: ArrayLike<number>,
  mode: TransformMode,
  mean?: ArrayLike<number> | null,
  scale?: ArrayLike<number> | null,
): Float32Array {
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    let x = v[i];
    if (mode !== "raw" && mean) x -= mean[i];
    if (mode === "whitened" && scale) x /= scale[i];
    out[i] = x;
  }
  return l2Normalize(out);
}

interface Separation {
  eer: number;
  acceptThreshold: number;
  retryThreshold: number;
  genuineMean: number;
  genuineStd: number;
  impostorMean: number;
  impostorStd: number;
  genuine: number[];
  impostor: number[];
}

/**
 * Score genuine/impostor the way the DEPLOYED system does: a probe capture vs a
 * per-person AVERAGED template — using leave-one-out so the probe is never in
 * its own template. Single captures are noisy (same-person cosine ~0.25), but a
 * template averaged over several captures cancels that noise and separates
 * cleanly. Falls back to pairwise only when nobody has ≥2 samples.
 */
function templateSeparation(
  samples: LabeledSample[],
  mode: TransformMode,
  mean: Float32Array,
  scale: Float32Array,
): { genuine: number[]; impostor: number[] } {
  const labels = [...new Set(samples.map((s) => s.label))];
  const tf = (e: ArrayLike<number>) => applyTransform(e, mode, mean, scale);
  const genuine: number[] = [];
  const impostor: number[] = [];
  for (let t = 0; t < samples.length; t++) {
    const probe = tf(samples[t].embedding);
    for (const L of labels) {
      const group = samples.filter((s, k) => k !== t && s.label === L);
      if (group.length === 0) continue; // no template for this person without the probe
      const tmplRaw = meanVector(group.map((s) => s.embedding));
      const score = cosineSimilarity(probe, tf(tmplRaw));
      if (L === samples[t].label) genuine.push(score);
      else impostor.push(score);
    }
  }
  return { genuine, impostor };
}

function statsFrom(genuine: number[], impostor: number[]): Separation {
  const gMean = genuine.length ? genuine.reduce((a, b) => a + b, 0) / genuine.length : 0;
  const iMean = impostor.length ? impostor.reduce((a, b) => a + b, 0) / impostor.length : 0;

  // Threshold that minimizes total error (FAR+FRR); center of the min-error band.
  const EPS = 1e-9;
  let bestErr = Infinity;
  let plateau: { t: number; far: number; frr: number }[] = [];
  for (let s = 0; s <= 400; s++) {
    const t = -1 + (2 * s) / 400;
    const far = impostor.length ? impostor.filter((x) => x >= t).length / impostor.length : 0;
    const frr = genuine.length ? genuine.filter((x) => x < t).length / genuine.length : 1;
    const err = far + frr;
    if (err < bestErr - EPS) {
      bestErr = err;
      plateau = [{ t, far, frr }];
    } else if (err <= bestErr + EPS) {
      plateau.push({ t, far, frr });
    }
  }
  const best = plateau.length ? plateau[Math.floor(plateau.length / 2)] : { t: 0, far: 1, frr: 1 };
  return {
    eer: (best.far + best.frr) / 2,
    acceptThreshold: Math.round(best.t * 1000) / 1000,
    retryThreshold: Math.round(Math.max(-1, best.t - 0.08) * 1000) / 1000,
    genuineMean: gMean,
    genuineStd: stdOf(genuine, gMean),
    impostorMean: iMean,
    impostorStd: stdOf(impostor, iMean),
    genuine,
    impostor,
  };
}

/**
 * Try raw / centered / whitened transforms on the captured palms and keep the
 * one with the lowest EER. Persistable result drives verification scoring.
 */
export function analyzeCalibration(samples: LabeledSample[]): CalibrationAnalysis {
  const empty = { genuineScores: [], impostorScores: [] };
  const labels = new Set(samples.map((s) => s.label));
  if (samples.length < 4 || labels.size < 2) {
    return {
      ok: false,
      message:
        "Need at least 2 people and ~4 samples total. Capture YOUR palm 3+ times and 2+ other " +
        "people once or twice each.",
      data: null,
      ...empty,
    };
  }

  const mean = meanVector(samples.map((s) => s.embedding));
  // Per-dimension std across mean-subtracted samples → diagonal-whitening scale.
  const scale = new Float32Array(EMBEDDING_DIM);
  for (const s of samples) {
    for (let d = 0; d < EMBEDDING_DIM; d++) {
      const c = s.embedding[d] - mean[d];
      scale[d] += (c * c) / samples.length;
    }
  }
  for (let d = 0; d < EMBEDDING_DIM; d++) scale[d] = Math.sqrt(scale[d]) || 1;

  // Evaluate each transform the way the deployed system scores: probe vs a
  // per-person AVERAGED template (leave-one-out), NOT single-capture pairwise —
  // single captures are too noisy, but averaged templates separate cleanly.
  const modes: TransformMode[] = ["raw", "centered", "whitened"];
  const results = modes.map((mode) => {
    const { genuine, impostor } = templateSeparation(samples, mode, mean, scale);
    return { mode, sep: statsFrom(genuine, impostor) };
  });
  if (results[0].sep.genuine.length === 0) {
    return {
      ok: false,
      message:
        "No genuine templates — each person needs at least 2 captures (so a template can be built " +
        "from the others and tested against the held-out one). Capture each person 3–4×.",
      data: null,
      ...empty,
    };
  }

  const eerByMode = {
    raw: results[0].sep.eer,
    centered: results[1].sep.eer,
    whitened: results[2].sep.eer,
  } as Record<TransformMode, number>;
  const winner = results.reduce((a, b) => (b.sep.eer < a.sep.eer ? b : a));
  const sep = winner.sep;

  const data: CalibrationData = {
    preprocVersion: MODEL_FAMILY,
    mode: winner.mode,
    mean: Array.from(mean),
    scale: winner.mode === "whitened" ? Array.from(scale) : undefined,
    acceptThreshold: sep.acceptThreshold,
    retryThreshold: sep.retryThreshold,
    genuineMean: sep.genuineMean,
    genuineStd: sep.genuineStd,
    impostorMean: sep.impostorMean,
    impostorStd: sep.impostorStd,
    eer: sep.eer,
    eerByMode,
    separation: sep.genuineMean - sep.impostorMean,
    sampleCount: samples.length,
    personCount: labels.size,
    updatedAt: Date.now(),
  };

  const lowConfidence = sep.genuine.length < 8 || sep.impostor.length < 16;
  const confidenceNote = lowConfidence
    ? ` ⚠ Low-confidence (${sep.genuine.length} genuine / ${sep.impostor.length} impostor template comparisons) — add more people/captures.`
    : "";
  const modeNote =
    ` Best transform: ${winner.mode} (probe-vs-template EER raw ${(eerByMode.raw * 100).toFixed(1)}%, ` +
    `centered ${(eerByMode.centered * 100).toFixed(1)}%, whitened ${(eerByMode.whitened * 100).toFixed(1)}%).`;

  let message: string;
  if (sep.eer <= 0.05) {
    message =
      `Strong separation (EER ${(sep.eer * 100).toFixed(1)}%). Save this. Then ENROL each student from ` +
      `≥4 separate captures — the template must average several captures to match reliably.`;
  } else if (sep.eer <= 0.12) {
    message = `Usable separation (EER ${(sep.eer * 100).toFixed(1)}%). Capture each person 4+ times to tighten it, then save.`;
  } else {
    message =
      `Weak separation (EER ${(sep.eer * 100).toFixed(1)}%). Most likely too few captures per person — the ` +
      `template needs ≥3–4 captures to average out per-capture noise. Capture each person 4+ times ` +
      `(reposition between each). If it stays high with good counts, check the ROI preview (palm should ` +
      `fill the frame) or Export for deeper analysis.`;
  }

  return {
    ok: true,
    message: message + modeNote + confidenceNote,
    data,
    genuineScores: sep.genuine,
    impostorScores: sep.impostor,
  };
}

export function loadCalibration(): CalibrationData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as CalibrationData;
    if (!Array.isArray(data.mean) || data.mean.length !== EMBEDDING_DIM) return null;
    if (data.preprocVersion !== MODEL_FAMILY) return null;
    return data;
  } catch {
    return null;
  }
}

export function saveCalibration(data: CalibrationData): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function clearCalibration(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
