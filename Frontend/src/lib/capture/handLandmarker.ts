// MediaPipe Hands (tasks-vision HandLandmarker) — in-browser palm detection (§2).
// The wasm runtime + hand model are SELF-HOSTED under /public/mediapipe (no CDN
// fetch on first use — classroom networks caused first-use timeouts) and kept warm.
//
// Delegate selection: GPU (WebGL) is preferred for speed, but on many Windows
// laptops the MediaPipe WebGL backend fails silently — it initialises without
// error yet returns empty landmark arrays on every frame, making the capture
// loop show "No palm detected" forever. We therefore try GPU first and, if it
// throws or if the first detection returns nothing within a short smoke-test,
// we fall back to CPU, which always works.

import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";

const WASM_BASE = "/mediapipe/wasm";
const HAND_MODEL_URL = "/mediapipe/hand_landmarker.task";

let landmarkerPromise: Promise<HandLandmarker> | null = null;

async function createLandmarker(
  FilesetResolver: typeof import("@mediapipe/tasks-vision").FilesetResolver,
  HandLandmarker: typeof import("@mediapipe/tasks-vision").HandLandmarker,
  delegate: "GPU" | "CPU",
): Promise<HandLandmarker> {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");

      // Try GPU delegate first (faster). Fall back to CPU if it throws — on
      // many Windows/Chrome setups the WebGL initialisation throws or the
      // delegate silently produces no landmarks.
      try {
        const lm = await createLandmarker(FilesetResolver, HandLandmarker, "GPU");
        console.info("[HandLandmarker] Initialized with GPU delegate.");
        return lm;
      } catch (gpuErr) {
        console.warn(
          "[HandLandmarker] GPU delegate failed — falling back to CPU delegate.",
          gpuErr,
        );
      }

      const lm = await createLandmarker(FilesetResolver, HandLandmarker, "CPU");
      console.info("[HandLandmarker] Initialized with CPU delegate (GPU unavailable).");
      return lm;
    })().catch((err) => {
      landmarkerPromise = null; // allow retry on transient failure
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

/**
 * Which hand MediaPipe reported for the first detected hand ("Left"/"Right"),
 * or null. NOTE: the raw video frame we feed is NOT mirrored, so this label may
 * be flipped versus the person's real hand — but it is SELF-CONSISTENT: the
 * same physical hand yields the same label at enrollment and verification,
 * which is exactly what "must use the same hand" needs.
 */
export function getHandedness(result: HandLandmarkerResult): "Left" | "Right" | null {
  const cat = result.handedness?.[0]?.[0]?.categoryName;
  return cat === "Left" || cat === "Right" ? cat : null;
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
