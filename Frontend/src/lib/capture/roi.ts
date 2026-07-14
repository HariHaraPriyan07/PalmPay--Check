// Palm ROI extraction: crop a rotation-normalized square around the palm
// (wrist → finger-base region) from the video frame.

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { LM } from "./handLandmarker";

export interface RoiInfo {
  canvas: HTMLCanvasElement;
  /** Palm width as a fraction of the frame's smaller dimension (size gate input). */
  sizeFrac: number;
  /** Palm center in normalized [0,1] frame coordinates (centering gate input). */
  centerX: number;
  centerY: number;
  /** Mean fingertip spread / palm size — openness gate input (fist ≈ low). */
  openness: number;
}

const ROI_SCALE = 1.7; // crop side = palm size × this (covers full palm + finger bases)

/**
 * Extract a rotation-normalized palm crop. The palm axis (wrist → middle MCP)
 * is rotated to vertical so the embedding sees a consistently oriented palm.
 */
export function extractPalmRoi(
  video: HTMLVideoElement,
  landmarks: NormalizedLandmark[],
  outSize = 256,
): RoiInfo {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const wrist = landmarks[LM.WRIST];
  const midMcp = landmarks[LM.MIDDLE_MCP];
  const palmPts = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP].map(
    (i) => landmarks[i],
  );

  // Palm center: mean of wrist + MCP row, in pixels.
  let cx = 0;
  let cy = 0;
  for (const p of palmPts) {
    cx += p.x * vw;
    cy += p.y * vh;
  }
  cx /= palmPts.length;
  cy /= palmPts.length;

  // Palm size: wrist → middle-finger MCP distance in pixels.
  const dx = (midMcp.x - wrist.x) * vw;
  const dy = (midMcp.y - wrist.y) * vh;
  const palmSize = Math.hypot(dx, dy);
  const sizeFrac = palmSize / Math.min(vw, vh);

  // Openness: mean fingertip distance from palm center relative to palm size.
  const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP].map((i) => landmarks[i]);
  let tipDist = 0;
  for (const t of tips) {
    tipDist += Math.hypot(t.x * vw - cx, t.y * vh - cy);
  }
  tipDist /= tips.length;
  const openness = palmSize > 0 ? tipDist / palmSize : 0;

  // Rotation-normalized crop: rotate so the wrist→middleMCP axis points up.
  const angle = Math.atan2(dy, dx) + Math.PI / 2;
  const crop = palmSize * ROI_SCALE;

  const canvas = document.createElement("canvas");
  canvas.width = outSize;
  canvas.height = outSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.save();
  ctx.translate(outSize / 2, outSize / 2);
  ctx.scale(outSize / crop, outSize / crop);
  ctx.rotate(-angle);
  ctx.translate(-cx, -cy);
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  return { canvas, sizeFrac, centerX: cx / vw, centerY: cy / vh, openness };
}
