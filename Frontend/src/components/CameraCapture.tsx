"use client";

// Shared palm-capture stage: webcam → MediaPipe Hands → ROI → quality gates →
// N accepted frames → liveness assessment. Used by both enrollment (10 frames)
// and daily verification (5 frames). Handles the §11 error cases: camera
// unavailable/denied, no palm, poor light, model load failure.

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, RefreshCcw, Video } from "lucide-react";
import type { Landmark } from "@mediapipe/tasks-vision";
import { getHandLandmarker, detectHands, getHandedness } from "@/lib/capture/handLandmarker";
import { extractPalmRoi } from "@/lib/capture/roi";
import { assessQuality, grayFromCanvas, laplacianVariance } from "@/lib/capture/quality";
import { assessLiveness, type LivenessResult } from "@/lib/capture/liveness";
import { drawGuides, distanceStatus, type DistanceStatus } from "@/lib/capture/guides";
import { preprocessRoi, type PreprocessedInput } from "@/lib/ml/preprocess";
import { STEADY_HOLD_MS, STEADY_MOVE_THRESHOLD } from "@/lib/ml/config";
import { Alert, Button, Select, Spinner } from "@/components/ui/primitives";
import type { Handedness } from "@/lib/types";

/** Mean luma below this on a persistently sampled frame reads as a black/dead feed. */
const BLACK_FRAME_LUMA_THRESHOLD = 6;
/** Consecutive low-brightness samples (at BLACK_FRAME_SAMPLE_MS apart) before warning. */
const BLACK_FRAME_STREAK = 3;
const BLACK_FRAME_SAMPLE_MS = 700;

/**
 * Some webcams/drivers intermittently fail to start a stream (AbortError /
 * NotReadableError, e.g. Chrome's "Timeout starting video source") even
 * though the exact same request succeeds moments later — a transient
 * hardware/USB negotiation hiccup, not a real permission or missing-device
 * problem. Those two error types are retried automatically before ever
 * surfacing an error to the user; permission/not-found errors are not
 * (retrying those is pointless and would just delay the real message).
 */
const AUTO_RETRY_ERROR_NAMES = new Set(["AbortError", "NotReadableError"]);
const AUTO_RETRY_ATTEMPTS = 4;
const AUTO_RETRY_DELAY_MS = 900;

export interface CaptureResult {
  frames: PreprocessedInput[];
  /** Mean per-frame quality score (0..1) of accepted frames. */
  qualityScore: number;
  liveness: LivenessResult;
  /** Majority hand across accepted frames (left/right enforcement, §5). */
  handedness: Handedness | null;
}

type Stage = "starting" | "capturing" | "done" | "error";

const MIN_FRAME_GAP_MS = 180; // default spacing between accepted frames → natural micro-movement between them (§9)

/**
 * Open the webcam robustly. Some Windows machines abort ("Timeout starting
 * video source") on the first constraint set or on a virtual camera device
 * (OBS etc.), so fall back: ideal constraints → bare `video: true` → each
 * physical video input by deviceId.
 */
async function openCameraStream(deviceId?: string): Promise<MediaStream> {
  // An explicit device (from the camera picker) is requested exactly — no
  // fallback substitution, since the whole point is picking a specific one.
  if (deviceId) {
    return navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
  }
  const attempts: MediaStreamConstraints[] = [
    {
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false,
    },
    { video: true, audio: false },
  ];
  let lastErr: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastErr = err;
    }
  }
  // Last resort: enumerate cameras and try each one explicitly (skips a
  // broken/virtual default camera).
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const d of devices.filter((d) => d.kind === "videoinput")) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: d.deviceId } },
          audio: false,
        });
      } catch (err) {
        lastErr = err;
      }
    }
  } catch {
    /* enumeration itself failed — report the original error */
  }
  throw lastErr;
}

export function CameraCapture({
  targetFrames,
  onComplete,
  instruction,
  frameGapMs = MIN_FRAME_GAP_MS,
  requireSteady = false,
}: {
  targetFrames: number;
  onComplete: (result: CaptureResult) => void;
  instruction: string;
  /**
   * Minimum spacing between accepted frames. Enrollment passes a wide gap so the
   * capture is slow and deliberate instead of bursting near-duplicate frames.
   */
  frameGapMs?: number;
  /**
   * Require the palm to be held still (low frame-to-frame motion) for a short
   * hold before each frame is accepted. Rejects shaky/mid-motion captures —
   * used for enrollment, where a blurred frame permanently corrupts the template.
   */
  requireSteady?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const collectedRef = useRef<{
    frames: PreprocessedInput[];
    grays: Float32Array[];
    lapVars: number[];
    qualities: number[];
    world: Landmark[][];
    hands: (Handedness | null)[];
    lastAcceptTs: number;
    /** Previous frame's ROI center/size — used to measure steadiness. */
    prevRoi: { x: number; y: number; size: number } | null;
    /** Timestamp the palm last moved beyond STEADY_MOVE_THRESHOLD. */
    steadySinceTs: number;
  }>({
    frames: [],
    grays: [],
    lapVars: [],
    qualities: [],
    world: [],
    hands: [],
    lastAcceptTs: 0,
    prevRoi: null,
    steadySinceTs: 0,
  });

  const [stage, setStage] = useState<Stage>("starting");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string>("Starting camera…");
  const [count, setCount] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [blackFrameHint, setBlackFrameHint] = useState(false);
  // Live positioning guidance overlay (Issue #2) — landmarks + framing + distance.
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const lastDistLabelRef = useRef("");
  const [distance, setDistance] = useState<{ status: DistanceStatus; label: string }>({
    status: "none",
    label: "Show your palm",
  });

  // Guards against React Strict Mode's double-invoked effects (mount → cleanup
  // → mount) racing two concurrent getUserMedia() calls against the same
  // physical camera, which manifests as intermittent timeouts/black frames.
  // Each start() captures its own generation; if a newer one has begun by the
  // time an await resolves, this call backs off and releases what it opened.
  const generationRef = useRef(0);
  const brightnessTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (brightnessTimerRef.current) {
      clearInterval(brightnessTimerRef.current);
      brightnessTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    const myGeneration = ++generationRef.current;
    const stillCurrent = () => generationRef.current === myGeneration;

    setStage("starting");
    setError(null);
    setCount(0);
    setBlackFrameHint(false);
    collectedRef.current = {
      frames: [], grays: [], lapVars: [], qualities: [], world: [], hands: [],
      lastAcceptTs: 0, prevRoi: null, steadySinceTs: 0,
    };
    try {
      setHint("Requesting camera…");
      let stream: MediaStream | undefined;
      for (let attempt = 1; attempt <= AUTO_RETRY_ATTEMPTS; attempt++) {
        if (!stillCurrent()) return;
        try {
          stream = await openCameraStream(deviceId);
          break;
        } catch (err) {
          const name = (err as DOMException)?.name;
          if (!AUTO_RETRY_ERROR_NAMES.has(name) || attempt === AUTO_RETRY_ATTEMPTS) throw err;
          if (!stillCurrent()) return;
          setHint(`Camera didn't respond — retrying automatically (${attempt}/${AUTO_RETRY_ATTEMPTS})…`);
          await new Promise((r) => setTimeout(r, AUTO_RETRY_DELAY_MS));
        }
      }
      if (!stream) throw new Error("Camera could not be opened");
      if (!stillCurrent()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      if (!stillCurrent()) return;

      // Now that permission is granted, device labels are populated — offer
      // a picker whenever more than one physical camera is present, so a
      // black/dead default (common on machines with an IR + color camera
      // pair) can be swapped without troubleshooting Windows services.
      const track = stream.getVideoTracks()[0];
      setActiveDeviceId(track?.getSettings().deviceId ?? deviceId ?? null);
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (stillCurrent()) setDevices(list.filter((d) => d.kind === "videoinput"));
      } catch {
        /* enumeration is a nice-to-have; ignore failures */
      }

      // Periodically sample raw video brightness (independent of palm
      // detection) so a black/dead feed is surfaced proactively instead of
      // silently sitting at "No palm detected" forever.
      const sampleCanvas = document.createElement("canvas");
      sampleCanvas.width = 16;
      sampleCanvas.height = 16;
      const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
      let lowStreak = 0;
      brightnessTimerRef.current = setInterval(() => {
        const v = videoRef.current;
        if (!stillCurrent() || !sctx || !v || v.readyState < 2) return;
        sctx.drawImage(v, 0, 0, 16, 16);
        const { data } = sctx.getImageData(0, 0, 16, 16);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }
        const mean = sum / (data.length / 4);
        if (mean < BLACK_FRAME_LUMA_THRESHOLD) {
          lowStreak++;
          if (lowStreak >= BLACK_FRAME_STREAK) setBlackFrameHint(true);
        } else {
          lowStreak = 0;
          setBlackFrameHint(false);
        }
      }, BLACK_FRAME_SAMPLE_MS);

      setHint("Loading palm detector…");
      const landmarker = await getHandLandmarker();
      if (!stillCurrent()) return;

      setStage("capturing");
      setHint(instruction);

      const loop = () => {
        if (!stillCurrent()) return; // a newer start() has taken over; stop looping
        const v = videoRef.current;
        if (!v || v.readyState < 2) {
          rafRef.current = requestAnimationFrame(loop);
          return;
        }
        const result = detectHands(landmarker, v, performance.now());
        const landmarks = result.landmarks?.[0];
        const worldLandmarks = result.worldLandmarks?.[0];
        const handedness = getHandedness(result);
        const roi = landmarks ? extractPalmRoi(v, landmarks) : null;
        const quality = assessQuality(roi);

        // Live positioning overlay + distance readout (Issue #2). Purely visual —
        // does not gate capture (the quality/steady gates below still decide).
        const overlay = overlayRef.current;
        if (overlay) {
          const ow = v.clientWidth || v.videoWidth;
          const oh = v.clientHeight || v.videoHeight;
          if (overlay.width !== ow) overlay.width = ow;
          if (overlay.height !== oh) overlay.height = oh;
          drawGuides(overlay, {
            landmarks: landmarks ?? null,
            sizeFrac: roi?.sizeFrac ?? null,
            mirrored: true,
          });
        }
        const dist = distanceStatus(roi?.sizeFrac ?? null);
        if (dist.label !== lastDistLabelRef.current) {
          lastDistLabelRef.current = dist.label;
          setDistance(dist);
        }

        if (!quality.ok) {
          setHint(quality.message ?? instruction);
          if (requireSteady) collectedRef.current.steadySinceTs = 0; // lost the palm → re-steady
        } else if (roi) {
          const now = performance.now();
          const col = collectedRef.current;

          // Steadiness gate (enrollment): only accept once the palm has been held
          // still for STEADY_HOLD_MS. Motion (ROI center drift + size change)
          // beyond the threshold restarts the hold timer, so a shaky palm never
          // captures a frame — even if it momentarily passes the sharpness gate.
          let steady = true;
          if (requireSteady) {
            const prev = col.prevRoi;
            const moved =
              !prev ||
              Math.hypot(roi.centerX - prev.x, roi.centerY - prev.y) +
                Math.abs(roi.sizeFrac - prev.size) >
                STEADY_MOVE_THRESHOLD;
            if (moved || col.steadySinceTs === 0) col.steadySinceTs = now;
            steady = now - col.steadySinceTs >= STEADY_HOLD_MS;
          }
          col.prevRoi = { x: roi.centerX, y: roi.centerY, size: roi.sizeFrac };

          if (requireSteady && !steady) {
            setHint(`Hold your palm still — steadying… (${col.frames.length} / ${targetFrames})`);
          } else if (now - col.lastAcceptTs >= frameGapMs) {
            col.lastAcceptTs = now;
            const gray64 = grayFromCanvas(roi.canvas);
            col.frames.push(preprocessRoi(roi.canvas));
            col.grays.push(gray64);
            col.lapVars.push(laplacianVariance(gray64));
            col.qualities.push(quality.score);
            if (worldLandmarks) col.world.push(worldLandmarks);
            col.hands.push(handedness);
            setCount(col.frames.length);
            setHint(`Captured ${col.frames.length} / ${targetFrames} — hold your palm steady`);

            if (col.frames.length >= targetFrames) {
              const liveness = assessLiveness(col.grays, col.lapVars, col.world);
              const qualityScore =
                col.qualities.reduce((a, b) => a + b, 0) / col.qualities.length;
              // Majority hand across accepted frames (ignore null votes).
              let left = 0;
              let right = 0;
              for (const h of col.hands) {
                if (h === "Left") left++;
                else if (h === "Right") right++;
              }
              const handedness: Handedness | null =
                left === 0 && right === 0 ? null : left >= right ? "Left" : "Right";
              setStage("done");
              stopStream();
              onComplete({ frames: col.frames, qualityScore, liveness, handedness });
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      if (!stillCurrent()) return; // superseded by a newer start(); ignore this failure
      stopStream();
      setStage("error");
      const name = (err as DOMException)?.name;
      if (name === "NotAllowedError") {
        setError("Camera permission was denied. Allow camera access in the browser and retry.");
      } else if (name === "NotFoundError") {
        setError("No camera was found on this device.");
      } else if (name === "NotReadableError" || name === "AbortError") {
        setError(
          "The camera could not be started (“Timeout starting video source”). Usual fixes: " +
            "1) close any app already using the camera (Teams/Zoom/Camera app); " +
            "2) Windows Settings → Privacy & security → Camera: turn ON “Camera access” and “Let desktop apps access your camera”; " +
            "3) if the laptop has a camera privacy shutter or Fn-key toggle, enable the camera; " +
            "then click Retry.",
        );
      } else {
        setError(
          `Could not start capture: ${err instanceof Error ? err.message : String(err)}. ` +
            "If this mentions the palm detector, check the network connection (the detector loads on first use).",
        );
      }
    }
  }, [instruction, onComplete, stopStream, targetFrames]);

  useEffect(() => {
    void start();
    return () => {
      generationRef.current++; // invalidate this generation before releasing its stream
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchCamera(deviceId: string) {
    stopStream(); // release the current device immediately, don't wait for the new open
    void start(deviceId);
  }

  return (
    <div>
      {(devices.length > 1 || blackFrameHint) && stage !== "error" && (
        <div className="mb-3 flex items-center gap-2">
          <Video className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
          <label htmlFor="camera-picker" className="sr-only">
            Choose camera
          </label>
          <Select
            id="camera-picker"
            className="max-w-xs py-1.5 text-sm"
            value={activeDeviceId ?? ""}
            onChange={(e) => switchCamera(e.target.value)}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${i + 1}`}
              </option>
            ))}
          </Select>
        </div>
      )}
      {blackFrameHint && stage === "capturing" && (
        <div className="mb-3">
          <Alert tone="warn">
            This camera feed looks black. Some laptops have more than one camera (e.g. an
            infrared one) — try a different option in the camera picker above.
          </Alert>
        </div>
      )}
      <div className="relative overflow-hidden rounded-card bg-black shadow-glow-cyan ring-1 ring-primary/30">
        {/* Mirrored preview so the student can position naturally */}
        <video
          ref={videoRef}
          playsInline
          muted
          className="aspect-video w-full -scale-x-100 object-cover"
        />
        {/* Live positioning guides: hand landmarks + optimal framing box (Issue #2) */}
        <canvas
          ref={overlayRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        />
        {stage === "capturing" && (
          <div
            className={
              "hud-readout absolute left-1/2 top-3 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-medium tracking-wide ring-1 " +
              (distance.status === "good"
                ? "bg-status-present-bg/90 text-status-present-fg ring-status-present-fg/40"
                : "bg-status-warn-bg/90 text-status-warn-fg ring-status-warn-fg/40")
            }
          >
            Distance: {distance.label}
          </div>
        )}
        {stage === "capturing" && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {/* Sweeping scan line */}
            <div className="absolute inset-x-6 h-px animate-scan-line bg-gradient-to-r from-transparent via-cyan-300 to-transparent shadow-glow-cyan" />
            {/* HUD corner brackets */}
            <span className="absolute left-4 top-4 h-8 w-8 border-l-2 border-t-2 border-cyan-300/80" />
            <span className="absolute right-4 top-4 h-8 w-8 border-r-2 border-t-2 border-cyan-300/80" />
            <span className="absolute bottom-4 left-4 h-8 w-8 border-b-2 border-l-2 border-cyan-300/80" />
            <span className="absolute bottom-4 right-4 h-8 w-8 border-b-2 border-r-2 border-cyan-300/80" />
            {/* Target reticle for the palm */}
            <div className="absolute inset-x-[22%] inset-y-[12%] rounded-[24px] border border-dashed border-cyan-200/40" />
            {/* Telemetry readouts */}
            <div className="hud-readout absolute left-4 top-14 flex items-center gap-2 text-[11px] uppercase tracking-widest text-cyan-200/90">
              <span className="h-2 w-2 animate-hud-blink rounded-full bg-rose-400" />
              Scanning
            </div>
            <div className="hud-readout absolute bottom-14 right-4 rounded bg-black/40 px-2 py-1 text-[11px] tracking-widest text-cyan-200/90">
              FRAMES {String(count).padStart(2, "0")}/{String(targetFrames).padStart(2, "0")}
            </div>
          </div>
        )}
        {stage === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 bg-background/85 text-foreground backdrop-blur-sm">
            <Spinner />
            <span className="hud-readout text-sm">{hint}</span>
          </div>
        )}
        {stage === "done" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/85 text-foreground backdrop-blur-sm">
            <CheckCircle2 className="h-6 w-6 text-status-present-fg drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]" aria-hidden />
            <span className="hud-readout text-sm">Capture complete</span>
          </div>
        )}
      </div>

      {stage === "capturing" && (
        <>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full bg-gradient-to-r from-cyan-400 to-violet-400 shadow-glow-cyan transition-all duration-200 motion-reduce:transition-none"
              style={{ width: `${(count / targetFrames) * 100}%` }}
            />
          </div>
          <p
            className="mt-2 flex items-center gap-2 text-sm text-body"
            role="status"
            aria-live="polite"
          >
            <Camera className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {hint}
          </p>
        </>
      )}

      {stage === "error" && error && (
        <div className="mt-3 space-y-3">
          <Alert tone="error">{error}</Alert>
          {devices.length > 1 && (
            <Select
              aria-label="Choose a different camera before retrying"
              className="max-w-xs py-1.5 text-sm"
              value={activeDeviceId ?? ""}
              onChange={(e) => setActiveDeviceId(e.target.value)}
            >
              {devices.map((d, i) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" onClick={() => void start(activeDeviceId ?? undefined)}>
            <RefreshCcw className="h-4 w-4" aria-hidden /> Retry
          </Button>
        </div>
      )}
    </div>
  );
}
