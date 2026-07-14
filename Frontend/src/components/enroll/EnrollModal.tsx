"use client";

// One-time enrollment (§5): consent FIRST (no consent → no enrollment), then
// ~10 quality-gated frames, each embedded; the averaged re-normalized vector
// is stored as the template. Only the embedding is stored — never raw images.

import { useCallback, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Alert, Button, Spinner } from "@/components/ui/primitives";
import { CameraCapture, type CaptureResult } from "@/components/CameraCapture";
import { ScanResult3D } from "@/components/three/ScanResult3D";
import { setEnrollmentStatus, setStudentConsent } from "@/lib/db/students";
import { saveStudentEmbedding } from "@/lib/db/embeddings";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import { averageEmbeddings } from "@/lib/ml/cosine";
import { ENROLL_FRAME_COUNT } from "@/lib/ml/config";
import { todayStr } from "@/lib/config/app";
import type { EnrollmentStatus, StudentDoc } from "@/lib/types";

type Step = "consent" | "capture" | "saving" | "done" | "failed";

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

  async function acceptConsent() {
    try {
      await setStudentConsent(student.studentId, true); // consentGiven + consentTimestamp (§5.1)
      onStatusChange(student.studentId, student.enrollmentStatus, true);
      setStep("capture");
    } catch (err) {
      setError(`Could not record consent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const handleCapture = useCallback(
    async (capture: CaptureResult) => {
      setStep("saving");
      setError(null);
      try {
        // Enrollment quality must be strict from day one (§5): a capture that
        // fails the liveness screen is rejected outright, not stored.
        if (!capture.liveness.passed) {
          setLivenessWarn(capture.liveness.notes);
          setError(
            "Capture rejected by the liveness/quality screen. Use the student's real palm with natural hand movement — not a photo or screen — and retry.",
          );
          setStep("failed");
          await setEnrollmentStatus(student.studentId, "failed");
          onStatusChange(student.studentId, "failed");
          return;
        }
        const provider = await getEmbeddingProvider();
        const embeddings = await Promise.all(capture.frames.map((f) => provider.getEmbedding(f)));
        const template = averageEmbeddings(embeddings); // averaged + re-normalized (§5.2)
        await saveStudentEmbedding({
          studentId: student.studentId,
          sectionId: student.sectionId,
          embedding: Array.from(template),
          modelVersion: provider.modelVersion,
          enrollmentDate: todayStr(),
          deviceInfo: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          qualityScore: Math.round(capture.qualityScore * 100) / 100,
        });
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
    [onStatusChange, student],
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
          <p className="text-sm text-body">
            Capturing <strong>{ENROLL_FRAME_COUNT} high-quality frames</strong>. Each frame must
            pass the quality gates (palm detected, centered, open, well-lit, sharp, large enough) —
            follow the on-screen hints.
          </p>
          <CameraCapture
            targetFrames={ENROLL_FRAME_COUNT}
            instruction="Hold the palm flat toward the camera, fingers relaxed and open"
            onComplete={(c) => void handleCapture(c)}
          />
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
            <Button onClick={() => setStep("capture")}>Retry capture</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
