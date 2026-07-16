// ── Best-effort passive anti-spoofing on plain RGB webcams (§9) ─────────────
//
// ⚠ HONEST LIMITS: capture hardware is a plain RGB laptop webcam — no depth,
// no IR. Spoofing is NOT impossible here and we do not claim it is. A
// determined attacker with a good replay video remains a residual risk.
//
// The strongest passive signal we have against a PHOTO of a palm (printed or on
// a phone) is NON-RIGIDITY. MediaPipe regresses a plausible 3D hand even from a
// flat photo, so "is it 3D?" does not separate them. But a real hand's landmark
// geometry micro-deforms frame to frame — fingers flex, joints shift — whereas
// a photo is a RIGID object: whether held still or waved around, its
// scale/rotation/translation change but the palm's internal geometry does not.
// We measure the frame-to-frame variation of scale-normalized pairwise
// landmark distances (translation- and rotation-invariant): a live hand varies,
// a photo stays ~constant. This catches the "moved photo" that slips past a
// pure pixel-motion gate.
//
// Heuristics (ALL must pass):
//  1. Non-rigidity (primary anti-photo): scale-normalized landmark geometry
//     must actually deform across the window — a rigid photo does not.
//  2. Micro-motion band: near-zero pixel motion ⇒ static print/paused screen.
//  3. Texture: flat prints/re-photographed screens lose mid/high-freq texture.
//  4. Screen/backlight glare: emissive screens clip highlights.

import { LM } from "./handLandmarker";
import type { Landmark } from "@mediapipe/tasks-vision";

export const MIN_MOTION = 0.15; // mean abs luma diff (0..255 scale) between consecutive ROIs
                                // Real hands always have slight natural movement; static prints don't.
export const MAX_GLARE_FRAC = 0.08; // fraction of pixels with luma ≥ 250
export const MIN_TEXTURE = 30; // mean Laplacian variance across frames
/**
 * Minimum non-rigid deformation: mean coefficient-of-variation of scale-
 * normalized pairwise landmark distances across the capture window. A live
 * hand's fingers micro-flex (CoV typically a few %); a rigid photo — even one
 * that is moved/tilted — stays near MediaPipe's regression noise floor.
 * ⚠ PROVISIONAL: tune on-device with real palms vs a printed/phone photo (the
 * per-attempt value is logged in `notes`/`nonRigidity`). Raise it if photos
 * still pass; lower it if genuine steady palms are wrongly flagged.
 */
export const MIN_NONRIGIDITY = 0.006;
export const MIN_LIVENESS_SCORE = 0.5; // composite pass bar

export interface LivenessResult {
  /** 0..1 composite — logged with every palm attendance mark (§9). */
  score: number;
  motion: number;
  glareFrac: number;
  texture: number;
  /** Frame-to-frame non-rigid geometry variation (null when no 3D landmarks). */
  nonRigidity: number | null;
  passed: boolean;
  notes: string[];
}

// Scale-invariant descriptor: distances between these landmark pairs, each
// divided by the palm size (wrist→middle-MCP). Rotation/translation cancel.
const SHAPE_PAIRS: readonly [number, number][] = [
  [LM.THUMB_TIP, LM.PINKY_TIP],
  [LM.INDEX_TIP, LM.PINKY_TIP],
  [LM.THUMB_TIP, LM.INDEX_TIP],
  [LM.INDEX_TIP, LM.WRIST],
  [LM.MIDDLE_TIP, LM.WRIST],
  [LM.RING_TIP, LM.WRIST],
  [LM.PINKY_TIP, LM.WRIST],
  [LM.THUMB_TIP, LM.MIDDLE_TIP],
];

function dist3(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Mean coefficient of variation of scale-normalized pairwise landmark distances
 * across frames. High = geometry deforms (live hand); ~0 = rigid (photo).
 * Returns null if there aren't enough 3D-landmark frames to judge.
 */
export function nonRigidityScore(world: Landmark[][]): number | null {
  const frames = world.filter((f) => f && f.length >= 21);
  if (frames.length < 2) return null;

  // Per-frame, per-pair normalized distances.
  const perPair: number[][] = SHAPE_PAIRS.map(() => []);
  for (const f of frames) {
    const scale = dist3(f[LM.WRIST], f[LM.MIDDLE_MCP]);
    if (scale <= 1e-6) continue;
    SHAPE_PAIRS.forEach(([i, j], p) => {
      perPair[p].push(dist3(f[i], f[j]) / scale);
    });
  }

  let covSum = 0;
  let covCount = 0;
  for (const vals of perPair) {
    if (vals.length < 2) continue;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (mean <= 1e-6) continue;
    const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
    covSum += Math.sqrt(variance) / mean;
    covCount++;
  }
  return covCount > 0 ? covSum / covCount : null;
}

/**
 * Assess a capture window. `grays` are downscaled grayscale ROIs (same size)
 * from consecutive accepted frames; `laplacianVars` their per-frame variances;
 * `world` the per-frame MediaPipe 3D hand landmarks (anti-photo non-rigidity).
 */
export function assessLiveness(
  grays: Float32Array[],
  laplacianVars: number[],
  world: Landmark[][] = [],
): LivenessResult {
  const notes: string[] = [];

  // 0) non-rigidity — the primary anti-photo gate (see module header)
  const nonRigidity = nonRigidityScore(world);
  // Only ENFORCE the gate when we actually have 3D landmarks to judge; if the
  // detector never supplied world landmarks, fall back to the pixel heuristics
  // rather than silently passing everything.
  const nonRigidOk = nonRigidity === null ? true : nonRigidity >= MIN_NONRIGIDITY;
  if (nonRigidity !== null && !nonRigidOk) {
    notes.push("rigid-geometry: hand shape does not deform between frames (photo/print?)");
  }

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
  // Non-rigidity dominates the composite when available — it's the signal that
  // actually separates a live hand from a photo. Falls back to 1 (neutral) when
  // no 3D landmarks were captured so the pixel heuristics still decide.
  const nonRigidScore =
    nonRigidity === null ? 1 : Math.min(1, nonRigidity / (MIN_NONRIGIDITY * 2));
  const score =
    0.4 * nonRigidScore + 0.25 * motionScore + 0.15 * glareScore + 0.2 * textureScore;

  return {
    score,
    motion,
    glareFrac,
    texture,
    nonRigidity,
    passed:
      nonRigidOk && motionOk && glareOk && textureOk && score >= MIN_LIVENESS_SCORE,
    notes,
  };
}
