// ── Live positioning guidance overlay (Issue #2) ─────────────────────────────
// Draws, over the mirrored camera preview: the 21 MediaPipe hand landmarks +
// skeleton, an optimal-framing guide box, and a distance classification derived
// from the palm's apparent size. The web equivalent of the brief's Flutter
// CustomPaint overlay. Pure drawing — no React state churn per frame.

import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// Palm size as a fraction of the frame's smaller side (roi.sizeFrac). Below the
// min the palm is too far/small to resolve detail; above the max it overflows
// the frame. Tuned to the ROI_SCALE crop — "good" ≈ palm fills the guide box.
export const DISTANCE_GOOD_MIN = 0.2;
export const DISTANCE_GOOD_MAX = 0.42;

export type DistanceStatus = "too-far" | "good" | "too-close" | "none";

export function distanceStatus(sizeFrac: number | null): {
  status: DistanceStatus;
  label: string;
} {
  if (sizeFrac == null) return { status: "none", label: "Show your palm" };
  if (sizeFrac < DISTANCE_GOOD_MIN) return { status: "too-far", label: "Move closer" };
  if (sizeFrac > DISTANCE_GOOD_MAX) return { status: "too-close", label: "Move farther back" };
  return { status: "good", label: "Good distance — hold steady" };
}

// MediaPipe hand skeleton (index pairs) — palm + five fingers.
const HAND_CONNECTIONS: readonly [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

const STATUS_COLOR: Record<DistanceStatus, string> = {
  good: "#22D3EE",
  "too-far": "#FBBF24",
  "too-close": "#FBBF24",
  none: "#64748B",
};

export interface GuideDrawOpts {
  landmarks: NormalizedLandmark[] | null;
  sizeFrac: number | null;
  /** Draw landmarks mirrored to match a CSS -scale-x-100 preview. */
  mirrored?: boolean;
}

/**
 * Redraw the overlay for one frame. Clears the canvas, then draws the framing
 * guide box and (if a hand is present) its skeleton + joints, colored by the
 * distance status. Call once per rAF tick with the latest landmarks.
 */
export function drawGuides(canvas: HTMLCanvasElement, opts: GuideDrawOpts): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const { status } = distanceStatus(opts.sizeFrac);
  const color = STATUS_COLOR[status];

  // Optimal framing zone (matches the dashed reticle: inset ~22% x / 12% y).
  const bx = W * 0.22;
  const by = H * 0.12;
  const bw = W * 0.56;
  const bh = H * 0.76;
  ctx.save();
  ctx.strokeStyle = status === "good" ? "rgba(34,211,238,0.9)" : "rgba(148,163,184,0.55)";
  ctx.lineWidth = status === "good" ? 3 : 2;
  ctx.setLineDash([10, 8]);
  roundRect(ctx, bx, by, bw, bh, 22);
  ctx.stroke();
  ctx.restore();

  const lms = opts.landmarks;
  if (!lms || lms.length < 21) return;

  const px = (lm: NormalizedLandmark) => (opts.mirrored ? (1 - lm.x) * W : lm.x * W);
  const py = (lm: NormalizedLandmark) => lm.y * H;

  // Skeleton
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.85;
  for (const [a, b] of HAND_CONNECTIONS) {
    if (!lms[a] || !lms[b]) continue;
    ctx.beginPath();
    ctx.moveTo(px(lms[a]), py(lms[a]));
    ctx.lineTo(px(lms[b]), py(lms[b]));
    ctx.stroke();
  }
  ctx.restore();

  // Joints — wrist + fingertips larger, rest small.
  const bigJoints = new Set([0, 4, 8, 12, 16, 20]);
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < lms.length; i++) {
    ctx.beginPath();
    ctx.arc(px(lms[i]), py(lms[i]), bigJoints.has(i) ? 6 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
