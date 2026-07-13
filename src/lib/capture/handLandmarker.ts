// MediaPipe Hands (tasks-vision HandLandmarker) — in-browser palm detection (§2).
// The wasm runtime + hand model are SELF-HOSTED under /public/mediapipe (no CDN
// fetch on first use — classroom networks caused first-use timeouts) and kept warm.

import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";

const WASM_BASE = "/mediapipe/wasm";
const HAND_MODEL_URL = "/mediapipe/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
      return HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
    })().catch((err) => {
      landmarkerPromise = null; // allow retry (e.g. transient network failure)
      throw err;
    });
  }
  return landmarkerPromise;
}

export function detectHands(
  landmarker: HandLandmarker,
  video: HTMLVideoElement,
  timestampMs: number,
): HandLandmarkerResult {
  return landmarker.detectForVideo(video, timestampMs);
}

// MediaPipe hand landmark indices used across the capture pipeline.
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  INDEX_MCP: 5,
  MIDDLE_MCP: 9,
  RING_MCP: 13,
  PINKY_MCP: 17,
  THUMB_TIP: 4,
  INDEX_TIP: 8,
  MIDDLE_TIP: 12,
  RING_TIP: 16,
  PINKY_TIP: 20,
} as const;
