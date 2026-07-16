"use client";

// One-time enrollment (§5): consent FIRST (no consent → no enrollment), then
// ~10 quality-gated frames, each embedded; the averaged re-normalized vector
// is stored as the template. Only the embedding is stored — never raw images.

import { useCallback, useRef, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Alert, Button, Spinner } from "@/components/ui/primitives";
import { CameraCapture, type CaptureResult } from "@/components/CameraCapture";
import { ScanResult3D } from "@/components/three/ScanResult3D";
import { setEnrollmentStatus, setStudentConsent } from "@/lib/db/students";
import { saveStudentEmbedding } from "@/lib/db/embeddings";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import { averageEmbeddings } from "@/lib/ml/cosine";
import { invalidateScoringContext } from "@/lib/ml/centering";
import { ENROLL_FRAME_COUNT, ENROLL_FRAME_GAP_MS, ENROLL_ROUNDS } from "@/lib/ml/config";
import { todayStr } from "@/lib/config/app";
import type { EmbeddingDoc, EnrollmentStatus, Handedness, StudentDoc } from "@/lib/types";

type Step = "consent" | "capture" | "reposition" | "saving" | "done" | "failed";

export function EnrollModal({
  student,
  open,
  onClose,
  onStatusChange,
}: {
  student: StudentDoc;
  open: boolean;
  onClose: () => void;
  onStatusChange: (studentId: string, status: EnrollmentStatus, consent?: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(student.consentGiven ? "capture" : "consent");
  const [consentChecked, setConsentChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [livenessWarn, setLivenessWarn] = useState<string[]>([]);
  // The template is averaged over SEVERAL separate capture rounds — one session
  // alone doesn't cancel session-to-session noise (measured: 1 round ≈ 11% EER,
  // 4 rounds ≈ 0%). Accumulate every round's embeddings, then average at the end.
  const [round, setRound] = useState(1);
  const [captureKey, setCaptureKey] = useState(0); // bump to remount CameraCapture
  const accRef = useRef<{ embs: Float32Array[]; qualities: number[]; hands: (Handedness | null)[] }>(
    { embs: [], qualities: [], hands: [] },
  );

  function resetRounds() {
    accRef.current = { embs: [], qualities: [], hands: [] };
    setRound(1);
    setCaptureKey((k) => k + 1);
  }

  async function acceptConsent() {
    try {
      await setStudentConsent(student.studentId, true); // consentGiven + consentTimestamp (§5.1)
      onStatusChange(student.studentId, student.enrollmentStatus, true);
      resetRounds();
      setStep("capture");
    } catch (err) {
      setError(`Could not record consent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const handleCapture = useCallback(
    async (capture: CaptureResult) => {
      setError(null);
      // Each round must pass liveness — a failed round is re-taken, NOT stored,
      // and does not consume the round count.
      if (!capture.liveness.passed) {
        setLivenessWarn(capture.liveness.notes);
        setError(
          "This round was rejected by the liveness/quality screen. Use the student's real palm with natural hand movement — not a photo or screen — and re-capture this round.",
        );
        setCaptureKey((k) => k + 1);
        setStep("capture");
        return;
      }
      setStep("saving");
      try {
        const provider = await getEmbeddingProvider();
        const embeddings = await Promise.all(capture.frames.map((f) => provider.getEmbedding(f)));
        const acc = accRef.current;
        acc.embs.push(...embeddings);
        acc.qualities.push(capture.qualityScore);
        acc.hands.push(capture.handedness);

        // More rounds to go → prompt a reposition so the next capture is independent.
        if (round < ENROLL_ROUNDS) {
          setRound(round + 1);
          setStep("reposition");
          return;
        }

        // Final round → average ALL rounds' embeddings into the template.
        const template = averageEmbeddings(acc.embs); // averaged + re-normalized (§5.2)
        let left = 0;
        let right = 0;
        for (const h of acc.hands) {
          if (h === "Left") left++;
          else if (h === "Right") right++;
        }
        const handedness: Handedness | null =
          left === 0 && right === 0 ? null : left >= right ? "Left" : "Right";
        const meanQuality =
          acc.qualities.reduce((a, b) => a + b, 0) / Math.max(1, acc.qualities.length);
        const doc: EmbeddingDoc = {
          studentId: student.studentId,
          sectionId: student.sectionId,
          embedding: Array.from(template),
          modelVersion: provider.modelVersion,
          enrollmentDate: todayStr(),
          deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          qualityScore: Math.round(meanQuality * 100) / 100,
        };
        // Firestore rejects undefined fields — only set handedness when detected.
        if (handedness) doc.handedness = handedness;
        await saveStudentEmbedding(doc);
        // A new template shifts the section mean → drop the cached centering context.
        invalidateScoringContext(student.sectionId);
        await setEnrollmentStatus(student.studentId, "enrolled");
        onStatusChange(student.studentId, "enrolled");
        setStep("done");
      } catch (err) {
        setError(`Enrollment failed: ${err instanceof Error ? err.message : String(err)}`);
        setStep("failed");
        try {
          await setEnrollmentStatus(student.studentId, "failed");
          onStatusChange(student.studentId, "failed");
        } catch {
          /* status update best-effort */
        }
      }
    },
    [onStatusChange, round, student],
  );

  return (
    <Modal open={open} onClose={onClose} title={`Enroll palm — ${student.name}`} wide>
      <p className="mb-4 text-sm text-muted-fg">
        Roll no <span className="font-heading">{student.studentId}</span> · Section {student.sectionId}
      </p>

      {step === "consent" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-card bg-muted p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
            <div className="text-sm text-body">
              <p className="font-semibold text-foreground">Biometric consent — read to the student</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  Your palm will be converted into a <strong>numeric embedding</strong> (256
                  numbers). This embedding — <strong>not a photo of your palm</strong> — is stored
                  and used only to verify your daily attendance.
                </li>
                <li>Only your class advisor can access your section&apos;s palm data.</li>
                <li>
                  You can ask for your palm data to be deleted; attendance is then marked manually.
                </li>
                <li>Consent is voluntary. Without it, no palm data is captured at all.</li>
              </ul>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-body">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(e) => setConsentChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-[#22D3EE]"
            />
            The student has heard and understood the above and consents to palm enrollment. The
            consent and its timestamp will be recorded.
          </label>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              No consent — cancel
            </Button>
            <Button disabled={!consentChecked} onClick={() => void acceptConsent()}>
              Record consent &amp; continue
            </Button>
          </div>
        </div>
      )}

      {step === "capture" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-body">
              <strong>
                Round {round} of {ENROLL_ROUNDS}
              </strong>{" "}
              · {ENROLL_FRAME_COUNT} frames. Multiple rounds (each repositioned) are averaged into
              the template — this is what makes daily matching reliable.
            </p>
            <div className="hud-readout shrink-0 rounded bg-muted px-2 py-1 text-xs tracking-widest text-primary">
              {round}/{ENROLL_ROUNDS}
            </div>
          </div>
          {error && <Alert tone="warn">{error}</Alert>}
          <CameraCapture
            key={captureKey}
            targetFrames={ENROLL_FRAME_COUNT}
            instruction="Hold the palm flat toward the camera, fingers relaxed and open"
            // Enrollment is slow and deliberate: wide frame spacing + require the
            // palm to be held still before each frame, so no shaky/blurred crop
            // ever corrupts the stored template.
            frameGapMs={ENROLL_FRAME_GAP_MS}
            requireSteady
            onComplete={(c) => void handleCapture(c)}
          />
        </div>
      )}

      {step === "reposition" && (
        <div className="space-y-4 py-6">
          <div className="flex items-start gap-3 rounded-card bg-muted p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-present-fg" aria-hidden />
            <div className="text-sm text-body">
              <p className="font-semibold text-foreground">
                Round {round - 1} of {ENROLL_ROUNDS} captured
              </p>
              <p className="mt-1">
                <strong>Take your hand fully out of frame and reposition it</strong> — slightly
                different angle/distance/lighting. Independent rounds are what make the template
                robust. {ENROLL_ROUNDS - (round - 1)} round(s) to go.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setCaptureKey((k) => k + 1);
                setStep("capture");
              }}
            >
              Capture round {round}
            </Button>
          </div>
        </div>
      )}

      {step === "saving" && (
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="relative flex h-16 w-16 items-center justify-center">
            <span className="absolute inset-0 animate-pulse-ring rounded-full ring-2 ring-primary/50" aria-hidden />
            <Spinner className="h-8 w-8" />
          </div>
          <span className="hud-readout text-sm uppercase tracking-widest text-primary">
            Computing template · saving embedding…
          </span>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-4">
          <div className="relative h-56 overflow-hidden rounded-card bg-black/40 shadow-glow-success ring-1 ring-status-present-fg/30">
            <ScanResult3D outcome="accept" className="absolute inset-0" />
            <div className="hud-readout pointer-events-none absolute left-3 top-3 text-[11px] uppercase tracking-[0.25em] text-muted-fg">
              Template stored · {student.studentId}
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-card bg-status-present-bg p-4 text-status-present-fg ring-1 ring-inset ring-status-present-fg/25">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">{student.name} enrolled</p>
              <p className="mt-1 text-sm">
                Averaged embedding stored (256-D, L2-normalized). The student can now be verified by
                palm during daily attendance.
              </p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}

      {step === "failed" && (
        <div className="space-y-4">
          <div className="relative h-44 overflow-hidden rounded-card bg-black/40 shadow-glow-danger ring-1 ring-status-absent-fg/30">
            <ScanResult3D outcome="reject" className="absolute inset-0" />
            <div className="hud-readout pointer-events-none absolute left-3 top-3 text-[11px] uppercase tracking-[0.25em] text-muted-fg">
              Enrollment rejected · {student.studentId}
            </div>
          </div>
          <Alert tone="error">{error ?? "Enrollment failed."}</Alert>
          {livenessWarn.length > 0 && (
            <Alert tone="warn">Liveness screen notes: {livenessWarn.join("; ")}</Alert>
          )}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button
              onClick={() => {
                resetRounds();
                setStep("capture");
              }}
            >
              Restart capture
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
