// ── Best-effort passive anti-spoofing on plain RGB webcams (§9) ─────────────
//
// ⚠ HONEST LIMITS: capture hardware is a plain RGB laptop webcam — no depth,
// no IR. Spoofing is NOT impossible here and we do not claim it is. These
// heuristics raise the bar against the *lazy* attacks (a static printed photo,
// a still image held on a phone) and log a liveness/quality signal with every
// mark, but a determined attacker with a good replay video remains a residual
// risk. Documented in README §"Anti-spoofing: what is and isn't covered".
//
// Heuristics:
//  1. Micro-motion band: a live palm held by a human always shows slight
//     natural frame-to-frame variation. Near-zero motion across the capture
//     window ⇒ looks like a static print / paused screen ⇒ reject.
//     (Excessive motion is already rejected by the blur quality gate.)
//  2. Texture: skin at webcam range keeps mid/high-frequency texture; flat
//     prints and re-photographed screens lose it (mean Laplacian variance).
//  3. Screen/backlight glare: emissive screens often clip highlights —
//     a high fraction of near-max luma pixels is suspicious.

export const MIN_MOTION = 0.35; // mean abs luma diff (0..255 scale) between consecutive ROIs
export const MAX_GLARE_FRAC = 0.06; // fraction of pixels with luma ≥ 250
export const MIN_TEXTURE = 45; // mean Laplacian variance across frames
export const MIN_LIVENESS_SCORE = 0.5; // composite pass bar

export interface LivenessResult {
  /** 0..1 composite — logged with every palm attendance mark (§9). */
  score: number;
  motion: number;
  glareFrac: number;
  texture: number;
  passed: boolean;
  notes: string[];
}

/**
 * Assess a capture window. `grays` are downscaled grayscale ROIs (same size)
 * from consecutive accepted frames; `laplacianVars` their per-frame variances.
 */
export function assessLiveness(grays: Float32Array[], laplacianVars: number[]): LivenessResult {
  const notes: string[] = [];

  // 1) micro-motion between consecutive frames
  let motion = 0;
  if (grays.length >= 2) {
    let total = 0;
    for (let f = 1; f < grays.length; f++) {
      const a = grays[f - 1];
      const b = grays[f];
      let d = 0;
      for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
      total += d / a.length;
    }
    motion = total / (grays.length - 1);
  }
  const motionOk = motion >= MIN_MOTION;
  if (!motionOk) notes.push("static-frames: capture looks like a still image (print/paused screen?)");

  // 2) glare / emissive-screen highlight clipping
  let clipped = 0;
  let count = 0;
  for (const g of grays) {
    for (let i = 0; i < g.length; i++) {
      if (g[i] >= 250) clipped++;
      count++;
    }
  }
  const glareFrac = count > 0 ? clipped / count : 0;
  const glareOk = glareFrac <= MAX_GLARE_FRAC;
  if (!glareOk) notes.push("glare: uniform bright highlights — possible screen backlight");

  // 3) texture
  const texture =
    laplacianVars.length > 0 ? laplacianVars.reduce((a, b) => a + b, 0) / laplacianVars.length : 0;
  const textureOk = texture >= MIN_TEXTURE;
  if (!textureOk) notes.push("low-texture: flat surface characteristics (print/screen?)");

  const motionScore = Math.min(1, motion / (MIN_MOTION * 2));
  const glareScore = glareFrac <= MAX_GLARE_FRAC ? 1 : Math.max(0, 1 - (glareFrac - MAX_GLARE_FRAC) * 10);
  const textureScore = Math.min(1, texture / (MIN_TEXTURE * 2));
  const score = 0.45 * motionScore + 0.25 * glareScore + 0.3 * textureScore;

  return {
    score,
    motion,
    glareFrac,
    texture,
    passed: motionOk && glareOk && textureOk && score >= MIN_LIVENESS_SCORE,
    notes,
  };
}
