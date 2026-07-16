"use client";

// Daily 1:1 palm verification (§6): selected student → capture → embedding →
// cosine vs THAT student's stored template → accept / retry / reject against
// the configurable thresholds in ml/config.ts. Every attempt is logged to
// verificationEvents for FAR/FRR analysis (§8).

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, RefreshCcw, ShieldAlert, XCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Alert, Button, Spinner } from "@/components/ui/primitives";
import { CameraCapture, type CaptureResult } from "@/components/CameraCapture";
import { ScanResult3D } from "@/components/three/ScanResult3D";
import { getStudentEmbedding } from "@/lib/db/embeddings";
import { markAttendance } from "@/lib/db/attendance";
import { logVerificationEvent } from "@/lib/db/events";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import { averageEmbeddings } from "@/lib/ml/cosine";
import { getScoringContext, scorePair } from "@/lib/ml/centering";
import { MODEL_FAMILY, MODEL_VERSION, VERIFY_FRAME_COUNT } from "@/lib/ml/config";
import { todayStr } from "@/lib/config/app";
import type {
  AttendanceRecordDoc,
  EmbeddingDoc,
  Handedness,
  StudentDoc,
  VerifyOutcome,
} from "@/lib/types";

type Step = "loading" | "no-embedding" | "capture" | "processing" | "result";

interface VerifyState {
  outcome: VerifyOutcome;
  similarity: number;
  acceptThreshold: number;
  retryThreshold: number;
  centered: boolean;
  source: string;
  sampleCount: number;
  livenessPassed: boolean;
  livenessNotes: string[];
  handMismatch: boolean;
  enrolledHand: Handedness | null;
  shownHand: Handedness | null;
}

export function VerifyModal({
  student,
  advisorUid,
  open,
  onClose,
  onMarked,
}: {
  student: StudentDoc;
  advisorUid: string;
  open: boolean;
  onClose: () => void;
  onMarked: (record: AttendanceRecordDoc) => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [template, setTemplate] = useState<EmbeddingDoc | null>(null);
  const [result, setResult] = useState<VerifyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionMismatch, setVersionMismatch] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("loading");
    setResult(null);
    setError(null);
    (async () => {
      try {
        const emb = await getStudentEmbedding(student.studentId);
        if (!emb) {
          setStep("no-embedding");
          return;
        }
        setTemplate(emb);
        // All builds of the same trained network (MODEL_FAMILY prefix) produce
        // compatible templates (§7) — only a different family (e.g. the old
        // placeholder) requires re-enrollment.
        setVersionMismatch(!emb.modelVersion.startsWith(MODEL_FAMILY));
        setStep("capture");
      } catch (err) {
        setError(`Could not load the stored palm template: ${String(err)}`);
        setStep("result");
      }
    })();
  }, [open, student.studentId]);

  const handleCapture = useCallback(
    async (capture: CaptureResult) => {
      if (!template) return;
      setStep("processing");
      try {
        const provider = await getEmbeddingProvider();
        const embeddings = await Promise.all(
          capture.frames.map((f) => provider.getEmbedding(f)),
        );
        const live = averageEmbeddings(embeddings);

        // Score in the mean-centered space with the section's impostor-relative
        // thresholds (ml/centering.ts) — raw cosine on this model is not
        // separable, so both probe and template are centered against the
        // section mean before comparison.
        const ctx = await getScoringContext(student.sectionId);
        const similarity = scorePair(live, template.embedding, ctx);
        const { acceptThreshold, retryThreshold } = ctx;

        // Decision (§4): accept ≥ acceptThreshold, retry band just below, reject
        // under that. A failed liveness check can never auto-accept — it demotes
        // accept → retry (best-effort anti-spoof, §10).
        let outcome: VerifyOutcome;
        if (similarity >= acceptThreshold && capture.liveness.passed) outcome = "accept";
        else if (
          similarity >= retryThreshold ||
          (similarity >= acceptThreshold && !capture.liveness.passed)
        )
          outcome = "retry";
        else outcome = "reject";

        // Wrong hand (left vs right) can never verify, whatever the score — the
        // template stores which hand was enrolled and the two are mirror images
        // (§5). Labels are self-consistent between enroll and verify, so a
        // genuine same-hand attempt matches; a mismatch means the other hand.
        const enrolledHand = template.handedness ?? null;
        const shownHand = capture.handedness;
        const handMismatch = !!enrolledHand && !!shownHand && enrolledHand !== shownHand;
        if (handMismatch) outcome = "reject";

        const date = todayStr();
        await logVerificationEvent({
          studentId: student.studentId,
          sectionId: student.sectionId,
          date,
          similarity,
          outcome,
          qualityScore: capture.qualityScore,
          livenessScore: capture.liveness.score,
          modelVersion: provider.modelVersion,
          timestamp: Date.now(),
        });

        if (outcome === "accept") {
          const record: AttendanceRecordDoc = {
            studentId: student.studentId,
            sectionId: student.sectionId,
            date,
            status: "present",
            markedBy: advisorUid,
            method: "palm",
            similarityScore: Math.round(similarity * 10000) / 10000,
            livenessScore: Math.round(capture.liveness.score * 100) / 100,
            timestamp: Date.now(),
          };
          await markAttendance(record);
          onMarked(record);
        }
        setResult({
          outcome,
          similarity,
          acceptThreshold,
          retryThreshold,
          centered: ctx.centered,
          source: ctx.source,
          sampleCount: ctx.sampleCount,
          livenessPassed: capture.liveness.passed,
          livenessNotes: capture.liveness.notes,
          handMismatch,
          enrolledHand,
          shownHand,
        });
        setStep("result");
      } catch (err) {
        setError(`Verification failed: ${err instanceof Error ? err.message : String(err)}`);
        setStep("result");
      }
    },
    [advisorUid, onMarked, student, template],
  );

  return (
    <Modal open={open} onClose={onClose} title={`Verify palm — ${student.name}`} wide>
      <p className="mb-4 text-sm text-muted-fg">
        Roll no <span className="font-heading">{student.studentId}</span> · Section{" "}
        {student.sectionId} · 1:1 match against this student&apos;s stored template only
      </p>

      {versionMismatch && step !== "no-embedding" && (
        <div className="mb-4">
          <Alert tone="warn">
            This student&apos;s template was enrolled with a different model version
            {template ? ` (${template.modelVersion})` : ""} than the current one ({MODEL_VERSION}).
            Re-enroll the student for reliable matching.
          </Alert>
        </div>
      )}

      {step === "loading" && (
        <div className="flex items-center gap-3 py-8">
          <Spinner /> <span className="text-sm text-body">Loading stored template…</span>
        </div>
      )}

      {step === "no-embedding" && (
        <Alert tone="warn">
          {student.name} is not enrolled yet — no palm template exists. Enroll the student first
          (Enrollment page), or mark them manually below the roster.
        </Alert>
      )}

      {step === "capture" && (
        <CameraCapture
          targetFrames={VERIFY_FRAME_COUNT}
          instruction="Student: hold your palm flat toward the camera, inside the frame"
          onComplete={(c) => void handleCapture(c)}
        />
      )}

      {step === "processing" && (
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-full ring-2 ring-primary/50" aria-hidden />
            <Spinner className="h-8 w-8" />
          </div>
          <span className="hud-readout text-sm uppercase tracking-widest text-primary">
            Matching embedding…
          </span>
        </div>
      )}

      {step === "result" && (
        <div className="space-y-4">
          {error ? (
            <Alert tone="error">{error}</Alert>
          ) : result ? (
            <>
              {result.source === "raw-fallback" && (
                <Alert tone="warn">
                  Scoring on the UNRELIABLE raw-cosine fallback — no saved calibration and too few
                  enrolled templates. Palms will not separate reliably. Open{" "}
                  <span className="font-heading">Calibrate</span> and save a calibration (or enrol
                  more students) for accurate matching.
                </Alert>
              )}
              {/* 3D verdict: particles assemble into ✓ / retry ring / ✕ */}
              <div
                className={
                  "relative h-56 overflow-hidden rounded-card bg-black/40 ring-1 " +
                  (result.outcome === "accept"
                    ? "shadow-glow-success ring-status-present-fg/30"
                    : result.outcome === "retry"
                      ? "shadow-glow-warn ring-status-warn-fg/30"
                      : "shadow-glow-danger ring-status-absent-fg/30")
                }
              >
                <ScanResult3D outcome={result.outcome} className="absolute inset-0" />
                <div className="hud-readout pointer-events-none absolute left-3 top-3 text-[11px] uppercase tracking-[0.25em] text-muted-fg">
                  Match report · {student.studentId}
                </div>
                <div
                  className={
                    "hud-readout pointer-events-none absolute bottom-3 right-3 rounded bg-black/50 px-2 py-1 text-xs tracking-widest " +
                    (result.outcome === "accept"
                      ? "text-status-present-fg"
                      : result.outcome === "retry"
                        ? "text-status-warn-fg"
                        : "text-status-absent-fg")
                  }
                >
                  SIM {result.similarity.toFixed(4)} / THR {result.acceptThreshold.toFixed(4)}
                </div>
              </div>

              {result.outcome === "accept" && (
                <div className="flex items-start gap-3 rounded-card bg-status-present-bg p-4 text-status-present-fg ring-1 ring-inset ring-status-present-fg/25">
                  <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">Verified — marked present</p>
                    <p className="mt-1 text-sm">
                      Similarity {result.similarity.toFixed(4)} (accept ≥ {result.acceptThreshold.toFixed(4)}
                      {result.centered
                        ? `, centered on ${result.sampleCount} section templates`
                        : ", raw fallback — enrol more students to calibrate"}
                      )
                    </p>
                  </div>
                </div>
              )}
              {result.outcome === "retry" && (
                <div className="flex items-start gap-3 rounded-card bg-status-warn-bg p-4 text-status-warn-fg ring-1 ring-inset ring-status-warn-fg/25">
                  <RefreshCcw className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">Uncertain — please retry</p>
                    <p className="mt-1 text-sm">
                      Similarity {result.similarity.toFixed(4)} (accept ≥ {result.acceptThreshold.toFixed(4)}, retry ≥{" "}
                      {result.retryThreshold.toFixed(4)}). Reposition the palm — better light, closer, fingers open —
                      and try again. No mark has been made.
                    </p>
                    {!result.livenessPassed && (
                      <p className="mt-2 flex items-center gap-1.5 text-sm">
                        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                        Capture was flagged by the liveness check ({result.livenessNotes.join("; ")}).
                        A live palm with natural micro-movement is required.
                      </p>
                    )}
                  </div>
                </div>
              )}
              {result.outcome === "reject" && (
                <div className="flex items-start gap-3 rounded-card bg-status-absent-bg p-4 text-status-absent-fg ring-1 ring-inset ring-status-absent-fg/25">
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
                  <div>
                    <p className="font-semibold">Not verified</p>
                    {result.handMismatch ? (
                      <p className="mt-1 flex items-center gap-1.5 text-sm">
                        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden />
                        Wrong hand — this student enrolled their {result.enrolledHand} palm but the{" "}
                        {result.shownHand} palm was shown. Use the enrolled hand and try again.
                      </p>
                    ) : (
                      <p className="mt-1 text-sm">
                        Similarity {result.similarity.toFixed(4)} is below the retry band (≥{" "}
                        {result.retryThreshold.toFixed(4)}). The student was NOT marked present. If they are genuinely
                        present, use the manual status dropdown (Others + reason) and re-enroll their
                        palm later.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : null}
          <div className="flex justify-end gap-3">
            {result?.outcome !== "accept" && !error && (
              <Button variant="secondary" onClick={() => setStep("capture")}>
                <RefreshCcw className="h-4 w-4" aria-hidden /> Retry capture
              </Button>
            )}
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
