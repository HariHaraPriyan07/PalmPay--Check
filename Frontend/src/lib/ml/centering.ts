// ── Deployment mean-centering + cohort-relative thresholding ─────────────────
// WHY THIS EXISTS: empirically, this palm model's raw 256-D outputs share a
// dominant common direction — unrelated palms score cosine ~0.6–0.97 against
// each other, so genuine and impostor score distributions OVERLAP and NO raw
// threshold separates them (root cause of "it matches all hands"). Two fixes,
// both driven by the section's own enrolled templates (real palms):
//   1. MEAN-CENTERING — subtract the population mean, re-normalize. Removes the
//      shared direction so impostors fall toward ~0 and genuine stays high.
//   2. COHORT-RELATIVE THRESHOLD (T-norm style) — measure the centered
//      impostor cloud from cross-student template pairs and place the accept
//      boundary at impostorMean + ACCEPT_Z·impostorStd. This self-locates the
//      boundary above the impostor cloud without a hand-tuned magic cosine.
// Templates are stored RAW and centered symmetrically at match time, so the
// mean/threshold keep improving as more students enrol — no re-enrollment.

import { centerAndNormalize, cosineSimilarity, meanVector } from "./cosine";
import {
  ACCEPT_Z,
  CENTERED_THRESHOLD_MAX,
  CENTERED_THRESHOLD_MIN,
  EMBEDDING_CENTERING,
  EMBEDDING_DIM,
  MIN_TEMPLATES_FOR_CENTERING,
  RETRY_THRESHOLD,
  RETRY_Z,
  VERIFICATION_THRESHOLD,
} from "./config";
import { applyTransform, loadCalibration, type TransformMode } from "./calibration";
import { listSectionEmbeddings } from "@/lib/db/embeddings";

/** How the active scoring context was derived — surfaced in the verify UI. */
export type ScoringSource = "calibration" | "section-mean" | "raw-fallback";

export interface ScoringContext {
  /** Which linear transform to apply before cosine. */
  mode: TransformMode;
  /** Transform origin (subtracted), or null for raw. */
  mean: Float32Array | null;
  /** Per-dim divisor for whitened mode, else null. */
  scale: Float32Array | null;
  /** How many templates/samples the stats were built from. */
  sampleCount: number;
  /** True when a non-raw transform is applied. */
  centered: boolean;
  /** Where the mean + thresholds came from. */
  source: ScoringSource;
  /** Accept when score ≥ this. */
  acceptThreshold: number;
  /** Retry band floor: acceptThreshold > score ≥ retryThreshold → reposition & retry. */
  retryThreshold: number;
  /** Measured impostor cloud (diagnostics / calibration readout). */
  impostorMean: number | null;
  impostorStd: number | null;
}

const contextCache = new Map<string, ScoringContext>();

function rawFallback(sampleCount: number): ScoringContext {
  return {
    mode: "raw",
    mean: null,
    scale: null,
    sampleCount,
    centered: false,
    source: "raw-fallback",
    acceptThreshold: VERIFICATION_THRESHOLD,
    retryThreshold: RETRY_THRESHOLD,
    impostorMean: null,
    impostorStd: null,
  };
}

/**
 * Build (and cache) the scoring context for a section. Priority:
 *   1. SAVED CALIBRATION (ml/calibration.ts) — measured mean + EER thresholds
 *      from real labeled palms. Best; works from the first student.
 *   2. SECTION-TEMPLATE MEAN — mean of this section's enrolled templates with
 *      impostor-cohort-relative thresholds (needs enough templates).
 *   3. RAW FALLBACK — fixed (unreliable) cosine threshold. Loudly flagged.
 */
export async function getScoringContext(sectionId: string): Promise<ScoringContext> {
  const cached = contextCache.get(sectionId);
  if (cached) return cached;

  // 1) Saved calibration takes precedence — it is the measured operating point.
  const cal = loadCalibration();
  if (EMBEDDING_CENTERING && cal && cal.mean.length === EMBEDDING_DIM) {
    const ctx: ScoringContext = {
      mode: cal.mode,
      mean: cal.mode === "raw" ? null : Float32Array.from(cal.mean),
      scale: cal.mode === "whitened" && cal.scale ? Float32Array.from(cal.scale) : null,
      sampleCount: cal.sampleCount,
      centered: cal.mode !== "raw",
      source: "calibration",
      acceptThreshold: cal.acceptThreshold,
      retryThreshold: cal.retryThreshold,
      impostorMean: cal.impostorMean,
      impostorStd: cal.impostorStd,
    };
    contextCache.set(sectionId, ctx);
    return ctx;
  }

  let ctx = rawFallback(0);
  if (EMBEDDING_CENTERING) {
    try {
      const docs = await listSectionEmbeddings(sectionId);
      const vecs = docs
        .map((d) => d.embedding)
        .filter((e): e is number[] => Array.isArray(e) && e.length === EMBEDDING_DIM);

      if (vecs.length >= MIN_TEMPLATES_FOR_CENTERING) {
        const mean = meanVector(vecs);
        const centered = vecs.map((v) => centerAndNormalize(v, mean));

        // Impostor cloud = centered cosine between DIFFERENT students' templates.
        let sum = 0;
        let sumSq = 0;
        let n = 0;
        for (let i = 0; i < centered.length; i++) {
          for (let j = i + 1; j < centered.length; j++) {
            const c = cosineSimilarity(centered[i], centered[j]);
            sum += c;
            sumSq += c * c;
            n++;
          }
        }
        const impMean = n > 0 ? sum / n : 0;
        const impStd = n > 0 ? Math.sqrt(Math.max(0, sumSq / n - impMean * impMean)) : 0;

        const clamp = (t: number) =>
          Math.min(CENTERED_THRESHOLD_MAX, Math.max(CENTERED_THRESHOLD_MIN, t));

        ctx = {
          mode: "centered",
          mean,
          scale: null,
          sampleCount: vecs.length,
          centered: true,
          source: "section-mean",
          acceptThreshold: clamp(impMean + ACCEPT_Z * impStd),
          retryThreshold: clamp(impMean + RETRY_Z * impStd),
          impostorMean: impMean,
          impostorStd: impStd,
        };
      } else {
        ctx = rawFallback(vecs.length);
      }
    } catch {
      // Reading the section for the mean is best-effort — never block a
      // verification on it; fall back to raw scoring (documented as unreliable).
      ctx = rawFallback(0);
    }
  }
  contextCache.set(sectionId, ctx);
  return ctx;
}

/** Invalidate the cached context for a section (call after a new enrollment). */
export function invalidateScoringContext(sectionId: string): void {
  contextCache.delete(sectionId);
}

/** Drop ALL cached contexts (call after saving/clearing calibration). */
export function clearAllScoringContexts(): void {
  contextCache.clear();
}

/**
 * Calibration readout for a section's live scoring operating point. Dev console:
 *   await window.__palmScoring("A")
 * Shows whether centering is active, how many templates the mean/impostor stats
 * came from, the measured impostor cloud, and the adaptive accept/retry bars —
 * so the operating point can be tuned against real enrolled palms.
 */
export async function describeSectionScoring(sectionId: string): Promise<ScoringContext> {
  invalidateScoringContext(sectionId); // always measure fresh for calibration
  const ctx = await getScoringContext(sectionId);
  console.info("[ML scoring]", {
    sectionId,
    centered: ctx.centered,
    templates: ctx.sampleCount,
    impostorMean: ctx.impostorMean,
    impostorStd: ctx.impostorStd,
    acceptThreshold: ctx.acceptThreshold,
    retryThreshold: ctx.retryThreshold,
  });
  if (!ctx.centered) {
    console.warn(
      `[ML scoring] Section ${sectionId} is NOT centered (only ${ctx.sampleCount} templates; ` +
        `need ≥ MIN_TEMPLATES_FOR_CENTERING). Verification is on the UNRELIABLE raw-cosine ` +
        `fallback until more students are enrolled.`,
    );
  }
  return ctx;
}

/** Score a probe against a template using the section's scoring context. */
export function scorePair(
  probe: ArrayLike<number>,
  template: ArrayLike<number>,
  ctx: ScoringContext,
): number {
  return cosineSimilarity(
    applyTransform(probe, ctx.mode, ctx.mean, ctx.scale),
    applyTransform(template, ctx.mode, ctx.mean, ctx.scale),
  );
}
