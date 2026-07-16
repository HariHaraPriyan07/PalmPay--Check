"use client";

// ── True 1:N palm identification (Issue #3) ──────────────────────────────────
// The camera scans CONTINUOUSLY. When a steady palm is held, a probe embedding
// is matched against EVERY enrolled template in the OPEN SECTION (never the
// whole department). The best match is auto-marked present when it clears the
// accept floor AND beats the runner-up by the margin — no name selection.
// States: identified · already-present · no-match (retry / manual override).
// Section templates are pre-loaded into memory once, not fetched per scan.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BadgeCheck, CheckCircle2, RefreshCcw, ShieldAlert, UserRoundSearch, XCircle } from "lucide-react";
import { Alert, Button, Input, Spinner } from "@/components/ui/primitives";
import { getHandLandmarker, detectHands } from "@/lib/capture/handLandmarker";
import { extractPalmRoi } from "@/lib/capture/roi";
import { assessQuality } from "@/lib/capture/quality";
import { drawGuides, distanceStatus, type DistanceStatus } from "@/lib/capture/guides";
import { preprocessRoi, type PreprocessedInput } from "@/lib/ml/preprocess";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import { averageEmbeddings, cosineSimilarity } from "@/lib/ml/cosine";
import {
  IDENTIFY_ACCEPT_THRESHOLD,
  IDENTIFY_MARGIN,
  IDENTIFY_PROBE_FRAMES,
  IDENTIFY_RESULT_HOLD_MS,
  MODEL_FAMILY,
  STEADY_HOLD_MS,
  STEADY_MOVE_THRESHOLD,
} from "@/lib/ml/config";
import { listSectionEmbeddings } from "@/lib/db/embeddings";
import { markAttendance } from "@/lib/db/attendance";
import { logVerificationEvent } from "@/lib/db/events";
import { todayStr } from "@/lib/config/app";
import type { AttendanceRecordDoc, StudentDoc } from "@/lib/types";

interface Template {
  studentId: string;
  embedding: Float32Array;
}

type Phase = "loading" | "scanning" | "processing" | "result" | "manual" | "error";

interface ScanResult {
  kind: "present" | "already" | "nomatch";
  studentId?: string;
  name?: string;
  score: number;
  runnerUpScore: number;
  runnerUpId?: string;
}

const FRAME_GAP_MS = 160; // spacing between collected probe frames

// Solid dark HUD-grid scrim for overlays that sit on top of the live camera
// feed. Inline-styled (not a Tailwind class) so it can never render transparent
// or be purged — it must stay fully opaque or the text is unreadable over video.
const SCRIM_STYLE: CSSProperties = {
  backgroundColor: "rgba(5, 8, 15, 0.97)", // theme `background` (#05080F), near-opaque
  backgroundImage:
    "linear-gradient(rgba(34,211,238,0.10) 1px, transparent 1px)," +
    "linear-gradient(90deg, rgba(34,211,238,0.10) 1px, transparent 1px)",
  backgroundSize: "24px 24px",
  backgroundPosition: "center",
};

async function openCamera(): Promise<MediaStream> {
  const attempts: MediaStreamConstraints[] = [
    { video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr: unknown;
  for (const c of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export function IdentifyScan({
  sectionId,
  advisorUid,
  students,
  records,
  onMarked,
}: {
  sectionId: string;
  advisorUid: string;
  students: StudentDoc[];
  records: Map<string, AttendanceRecordDoc>;
  onMarked: (record: AttendanceRecordDoc) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const templatesRef = useRef<Template[]>([]);
  const phaseRef = useRef<Phase>("loading");
  const generationRef = useRef(0);
  const collectRef = useRef<{
    frames: PreprocessedInput[];
    lastTs: number;
    steadySince: number;
    prevRoi: { x: number; y: number; size: number } | null;
  }>({ frames: [], lastTs: 0, steadySince: 0, prevRoi: null });
  // Latest records/students without re-subscribing the loop.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const studentsRef = useRef(students);
  studentsRef.current = students;

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [templateCount, setTemplateCount] = useState(0);
  const [distance, setDistance] = useState<{ status: DistanceStatus; label: string }>({
    status: "none",
    label: "Show your palm",
  });
  const [result, setResult] = useState<ScanResult | null>(null);
  const [manualFilter, setManualFilter] = useState("");

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const nameOf = useCallback(
    (id?: string) => (id ? (studentsRef.current.find((s) => s.studentId === id)?.name ?? id) : "—"),
    [],
  );

  // ── identification ─────────────────────────────────────────────────────────
  const identify = useCallback(
    async (probe: Float32Array) => {
      const scored = templatesRef.current
        .map((t) => ({ id: t.studentId, score: cosineSimilarity(probe, t.embedding) }))
        .sort((a, b) => b.score - a.score);
      const best = scored[0];
      const runner = scored[1];
      const bestScore = best?.score ?? -1;
      const runnerScore = runner?.score ?? -1;
      const margin = bestScore - (runner ? runnerScore : -1);
      const matched =
        !!best && bestScore >= IDENTIFY_ACCEPT_THRESHOLD && (!runner || margin >= IDENTIFY_MARGIN);

      const date = todayStr();
      const commonLog = {
        sectionId,
        date,
        qualityScore: 1,
        livenessScore: 1,
        modelVersion: MODEL_FAMILY,
        timestamp: Date.now(),
        runnerUpScore: runner ? Math.round(runnerScore * 10000) / 10000 : undefined,
        runnerUpId: runner?.id,
        cohortSize: templatesRef.current.length,
      };

      if (matched && best) {
        const already = recordsRef.current.get(best.id)?.status === "present";
        void logVerificationEvent({
          ...commonLog,
          studentId: best.id,
          runnerUpStudentId: runner?.id,
          similarity: Math.round(bestScore * 10000) / 10000,
          outcome: "accept",
        });
        if (already) {
          return {
            kind: "already" as const,
            studentId: best.id,
            name: nameOf(best.id),
            score: bestScore,
            runnerUpScore: runnerScore,
            runnerUpId: runner?.id,
          };
        }
        const record: AttendanceRecordDoc = {
          studentId: best.id,
          sectionId,
          date,
          status: "present",
          markedBy: advisorUid,
          method: "palm",
          similarityScore: Math.round(bestScore * 10000) / 10000,
          runnerUpScore: runner ? Math.round(runnerScore * 10000) / 10000 : undefined,
          runnerUpStudentId: runner?.id,
          timestamp: Date.now(),
        };
        // Firestore rejects undefined — strip absent runner-up fields.
        if (record.runnerUpScore === undefined) delete record.runnerUpScore;
        if (record.runnerUpStudentId === undefined) delete record.runnerUpStudentId;
        try {
          await markAttendance(record);
          onMarked(record);
        } catch {
          /* surfaced as nomatch-ish; keep scanning */
        }
        return {
          kind: "present" as const,
          studentId: best.id,
          name: nameOf(best.id),
          score: bestScore,
          runnerUpScore: runnerScore,
          runnerUpId: runner?.id,
        };
      }

      // No qualifying candidate → explicit no-match (ambiguous or unrecognized).
      void logVerificationEvent({
        ...commonLog,
        studentId: best?.id ?? "unknown",
        runnerUpStudentId: runner?.id,
        similarity: Math.round(bestScore * 10000) / 10000,
        outcome: bestScore >= IDENTIFY_ACCEPT_THRESHOLD ? "retry" : "reject",
      });
      return {
        kind: "nomatch" as const,
        studentId: best?.id,
        name: nameOf(best?.id),
        score: bestScore,
        runnerUpScore: runnerScore,
        runnerUpId: runner?.id,
      };
    },
    [advisorUid, nameOf, onMarked, sectionId],
  );

  const resumeScanning = useCallback(() => {
    collectRef.current = { frames: [], lastTs: 0, steadySince: 0, prevRoi: null };
    setResult(null);
    setPhaseBoth("scanning");
  }, [setPhaseBoth]);

  // ── camera + detection loop ────────────────────────────────────────────────
  useEffect(() => {
    const myGen = ++generationRef.current;
    const stillCurrent = () => generationRef.current === myGen;
    let lastDistLabel = "";

    (async () => {
      try {
        // Pre-load section templates + models ONCE.
        const [docs, provider, landmarker] = await Promise.all([
          listSectionEmbeddings(sectionId),
          getEmbeddingProvider(),
          getHandLandmarker(),
        ]);
        if (!stillCurrent()) return;
        templatesRef.current = docs
          .filter(
            (d) =>
              Array.isArray(d.embedding) &&
              (!d.modelVersion || d.modelVersion.startsWith(MODEL_FAMILY)),
          )
          .map((d) => ({ studentId: d.studentId, embedding: Float32Array.from(d.embedding) }));
        setTemplateCount(templatesRef.current.length);

        const stream = await openCamera();
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
        setPhaseBoth("scanning");

        const loop = () => {
          if (!stillCurrent()) return;
          const v = videoRef.current;
          const overlay = overlayRef.current;
          if (!v || v.readyState < 2) {
            rafRef.current = requestAnimationFrame(loop);
            return;
          }
          const res = detectHands(landmarker, v, performance.now());
          const landmarks = res.landmarks?.[0] ?? null;
          const roi = landmarks ? extractPalmRoi(v, landmarks) : null;
          const sizeFrac = roi?.sizeFrac ?? null;

          // Draw overlay every frame (guides + skeleton), sized to the video box.
          if (overlay) {
            const w = v.clientWidth || v.videoWidth;
            const h = v.clientHeight || v.videoHeight;
            if (overlay.width !== w) overlay.width = w;
            if (overlay.height !== h) overlay.height = h;
            drawGuides(overlay, { landmarks, sizeFrac, mirrored: true });
          }

          const dist = distanceStatus(sizeFrac);
          if (dist.label !== lastDistLabel) {
            lastDistLabel = dist.label;
            setDistance(dist);
          }

          // Only collect while actively scanning and framing is good.
          if (phaseRef.current === "scanning" && roi) {
            const quality = assessQuality(roi);
            const now = performance.now();
            const col = collectRef.current;
            if (quality.ok && dist.status === "good") {
              // Steadiness: palm must be held still briefly before frames count.
              const prev = col.prevRoi;
              const moved =
                !prev ||
                Math.hypot(roi.centerX - prev.x, roi.centerY - prev.y) +
                  Math.abs(roi.sizeFrac - prev.size) >
                  STEADY_MOVE_THRESHOLD;
              if (moved || col.steadySince === 0) col.steadySince = now;
              col.prevRoi = { x: roi.centerX, y: roi.centerY, size: roi.sizeFrac };
              const steady = now - col.steadySince >= STEADY_HOLD_MS;

              if (steady && now - col.lastTs >= FRAME_GAP_MS) {
                col.lastTs = now;
                col.frames.push(preprocessRoi(roi.canvas));
                if (col.frames.length >= IDENTIFY_PROBE_FRAMES) {
                  // Freeze, identify, show result, then resume.
                  setPhaseBoth("processing");
                  const frames = col.frames;
                  col.frames = [];
                  void (async () => {
                    try {
                      const embs = await Promise.all(
                        frames.map((f) => provider.getEmbedding(f)),
                      );
                      const probe = averageEmbeddings(embs);
                      const r = await identify(probe);
                      if (!stillCurrent()) return;
                      setResult(r);
                      setPhaseBoth("result");
                      window.setTimeout(() => {
                        if (stillCurrent() && phaseRef.current === "result") resumeScanning();
                      }, IDENTIFY_RESULT_HOLD_MS);
                    } catch {
                      if (stillCurrent()) resumeScanning();
                    }
                  })();
                }
              }
            } else {
              col.steadySince = 0; // lost good framing → re-steady
            }
          }
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (!stillCurrent()) return;
        const name = (err as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access and reopen attendance."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : `Could not start the scanner: ${err instanceof Error ? err.message : String(err)}`,
        );
        setPhaseBoth("error");
      }
    })();

    return () => {
      generationRef.current++;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  // ── manual override ────────────────────────────────────────────────────────
  async function markManual(student: StudentDoc) {
    const record: AttendanceRecordDoc = {
      studentId: student.studentId,
      sectionId,
      date: todayStr(),
      status: "present",
      markedBy: advisorUid,
      method: "manual",
      timestamp: Date.now(),
    };
    try {
      await markAttendance(record);
      onMarked(record);
    } catch {
      /* best-effort */
    }
    setManualFilter("");
    resumeScanning();
  }

  const manualList = students.filter((s) => {
    const q = manualFilter.trim().toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q);
  });

  const presentCount = students.filter((s) => records.get(s.studentId)?.status === "present").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-body">
          <span className="font-heading text-foreground">Continuous palm scan</span> · searching{" "}
          <strong>{templateCount}</strong> enrolled templates in section {sectionId} ·{" "}
          <strong>{presentCount}</strong>/{students.length} present today
        </div>
        <div
          className={
            "hud-readout rounded-full px-3 py-1 text-xs font-medium tracking-wide ring-1 " +
            (distance.status === "good"
              ? "bg-status-present-bg text-status-present-fg ring-status-present-fg/40"
              : "bg-status-warn-bg text-status-warn-fg ring-status-warn-fg/40")
          }
        >
          Distance: {distance.label}
        </div>
      </div>

      {templateCount === 0 && phase !== "loading" && phase !== "error" && (
        <Alert tone="warn">
          No enrolled templates in this section yet — enroll students first (Enrollment page), or use
          the Roster tab to mark manually. Nothing to identify against.
        </Alert>
      )}

      <div className="relative overflow-hidden rounded-card bg-black shadow-glow-cyan ring-1 ring-primary/30">
        <video ref={videoRef} playsInline muted className="aspect-video w-full -scale-x-100 object-cover" />
        {/* Live guidance overlay (landmarks + framing box), mirrored to match preview */}
        <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />

        {/* Top instruction band */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center gap-1 bg-gradient-to-b from-black/60 to-transparent p-3 text-center">
          <p className="hud-readout text-sm font-semibold uppercase tracking-widest text-cyan-200">
            Scan your palm
          </p>
          <p className="text-xs text-cyan-100/80">Hold palm 30–50 cm from camera · wait for auto-ID</p>
        </div>

        {phase === "loading" && (
          <div style={SCRIM_STYLE} className="absolute inset-0 flex items-center justify-center gap-3">
            <Spinner /> <span className="hud-readout text-sm text-slate-100">Loading scanner & section templates…</span>
          </div>
        )}
        {phase === "processing" && (
          <div style={SCRIM_STYLE} className="absolute inset-0 flex items-center justify-center gap-3">
            <Spinner /> <span className="hud-readout text-sm uppercase tracking-widest text-cyan-300">Identifying…</span>
          </div>
        )}

        {/* Result overlays */}
        {phase === "result" && result?.kind === "present" && (
          <ResultBanner
            icon={<BadgeCheck className="h-8 w-8" />}
            title={`${result.name} — marked present`}
            sub={`match ${result.score.toFixed(3)} · margin ${(result.score - result.runnerUpScore).toFixed(3)} over ${nameOf(result.runnerUpId)}`}
          />
        )}
        {phase === "result" && result?.kind === "already" && (
          <ResultBanner
            icon={<CheckCircle2 className="h-8 w-8" />}
            title={`${result.name} already marked present`}
            sub="No duplicate recorded"
          />
        )}
        {phase === "result" && result?.kind === "nomatch" && (
          <div
            style={SCRIM_STYLE}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
          >
            <XCircle className="h-9 w-9 text-red-400" aria-hidden />
            <p className="font-heading text-lg font-semibold text-white">No match found</p>
            <p className="max-w-md text-sm text-slate-200">
              The scanned palm was not confidently recognized (best {result.score.toFixed(3)}
              {result.runnerUpScore > -1 ? `, runner-up ${result.runnerUpScore.toFixed(3)}` : ""}).
              Not enrolled, poor positioning/lighting, or hand not fully visible.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={resumeScanning}>
                <RefreshCcw className="h-4 w-4" aria-hidden /> Retry scan
              </Button>
              <Button variant="secondary" onClick={() => setPhaseBoth("manual")}>
                <UserRoundSearch className="h-4 w-4" aria-hidden /> Mark manually
              </Button>
            </div>
          </div>
        )}

        {phase === "manual" && (
          <div style={SCRIM_STYLE} className="absolute inset-0 flex flex-col p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="font-heading text-sm font-semibold text-white">
                Mark manually — pick the student
              </p>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={resumeScanning}>
                Cancel
              </Button>
            </div>
            <Input
              autoFocus
              placeholder="Filter by name or roll no…"
              value={manualFilter}
              onChange={(e) => setManualFilter(e.target.value)}
              className="mb-2 py-2 text-sm"
            />
            <div className="min-h-0 flex-1 overflow-y-auto rounded-input ring-1 ring-border-neutral">
              {manualList.map((s) => {
                const present = records.get(s.studentId)?.status === "present";
                return (
                  <button
                    key={s.studentId}
                    disabled={present}
                    onClick={() => void markManual(s)}
                    className="flex w-full items-center justify-between gap-2 border-b border-border-neutral/60 px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span>
                      <span className="font-heading">{s.studentId}</span> · {s.name}
                    </span>
                    {present && <span className="text-xs text-status-present-fg">present</span>}
                  </button>
                );
              })}
              {manualList.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-fg">No students match.</p>
              )}
            </div>
          </div>
        )}

        {phase === "error" && error && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <Alert tone="error">{error}</Alert>
          </div>
        )}
      </div>

      <div className="flex items-start gap-3 rounded-card bg-muted p-4 text-sm text-body">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
        <ul className="grid gap-1 sm:grid-cols-2">
          <li>✓ Palm open, fingers spread, facing camera</li>
          <li>✓ Distance 30–50 cm (green “Good distance”)</li>
          <li>✓ Even lighting, no glare or shadow</li>
          <li>✓ Hold steady until identified</li>
        </ul>
      </div>
    </div>
  );
}

function ResultBanner({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-status-present-bg/90 p-6 text-center text-status-present-fg backdrop-blur-sm">
      <span className="drop-shadow-[0_0_10px_rgba(74,222,128,0.7)]">{icon}</span>
      <p className="font-heading text-xl font-semibold">{title}</p>
      <p className="text-sm opacity-90">{sub}</p>
    </div>
  );
}
