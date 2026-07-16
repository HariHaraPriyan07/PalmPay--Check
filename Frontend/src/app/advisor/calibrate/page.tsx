"use client";

// ── Calibration screen: measure real genuine-vs-impostor separation ──────────
// Capture a few real palms (YOUR palm several times + a few other people), and
// this computes the centering mean and the accept/retry thresholds from the
// measured equal-error crossover — then persists them for verification to use.
// This is how the model is calibrated efficiently on real hands instead of a
// guessed threshold.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FlaskConical, Hand, Plus, Save, Trash2, UserRound } from "lucide-react";
import { RequireRole } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/AppShell";
import { Alert, Badge, Button, Card, Input, PageHeader, Spinner } from "@/components/ui/primitives";
import { CameraCapture, type CaptureResult } from "@/components/CameraCapture";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import { averageEmbeddings } from "@/lib/ml/cosine";
import { INPUT_SIZE, MODEL_FAMILY } from "@/lib/ml/config";
import {
  analyzeCalibration,
  clearCalibration,
  loadCalibration,
  saveCalibration,
  type CalibrationAnalysis,
  type LabeledSample,
} from "@/lib/ml/calibration";
import { clearAllScoringContexts } from "@/lib/ml/centering";

const CAPTURE_FRAMES = 6;

/** Render a 224×224 grayscale ROI (what the model actually sees) to a canvas. */
function RoiPreview({ gray }: { gray: Float32Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(INPUT_SIZE, INPUT_SIZE);
    for (let i = 0; i < gray.length; i++) {
      const v = Math.max(0, Math.min(255, gray[i]));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [gray]);
  return (
    <canvas
      ref={ref}
      width={INPUT_SIZE}
      height={INPUT_SIZE}
      className="h-32 w-32 rounded-input ring-1 ring-border-neutral"
    />
  );
}

function CalibrateInner() {
  const [label, setLabel] = useState("");
  const [samples, setSamples] = useState<LabeledSample[]>([]);
  const [lastRoi, setLastRoi] = useState<Float32Array | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CalibrationAnalysis | null>(null);
  const [saved, setSaved] = useState(() => loadCalibration());

  const counts = useMemo(() => {
    const byLabel = new Map<string, number>();
    for (const s of samples) byLabel.set(s.label, (byLabel.get(s.label) ?? 0) + 1);
    return byLabel;
  }, [samples]);

  const handleCapture = useCallback(
    async (capture: CaptureResult) => {
      setCapturing(false);
      setBusy(true);
      setError(null);
      try {
        const provider = await getEmbeddingProvider();
        const embs = await Promise.all(capture.frames.map((f) => provider.getEmbedding(f)));
        const embedding = averageEmbeddings(embs); // raw, L2-normalized
        setSamples((prev) => [...prev, { label: label.trim(), embedding }]);
        if (capture.frames[0]?.gray) setLastRoi(capture.frames[0].gray);
        setAnalysis(null);
      } catch (err) {
        setError(`Could not embed the capture: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    },
    [label],
  );

  function exportSamples() {
    const payload = {
      preprocVersion: MODEL_FAMILY,
      exportedAt: new Date().toISOString(),
      samples: samples.map((s) => ({ label: s.label, embedding: Array.from(s.embedding) })),
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `palm-calibration-samples-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function analyze() {
    setError(null);
    setAnalysis(analyzeCalibration(samples));
  }

  function persist() {
    if (!analysis?.data) return;
    saveCalibration(analysis.data);
    clearAllScoringContexts(); // verification must pick up the new mean/thresholds
    setSaved(analysis.data);
  }

  function reset() {
    setSamples([]);
    setAnalysis(null);
  }

  function removeSaved() {
    clearCalibration();
    clearAllScoringContexts();
    setSaved(null);
  }

  const canCapture = label.trim().length > 0 && !capturing && !busy;

  return (
    <>
      <PageHeader
        title="Palm calibration"
        subtitle="Measure real genuine-vs-impostor separation and set the operating point"
      />

      {saved && (
        <div className="mb-4">
          <Alert tone="success">
            Active calibration: accept ≥ {saved.acceptThreshold.toFixed(3)} · retry ≥{" "}
            {saved.retryThreshold.toFixed(3)} · EER {(saved.eer * 100).toFixed(1)}% · from{" "}
            {saved.sampleCount} samples / {saved.personCount} people.{" "}
            <button className="cursor-pointer underline" onClick={removeSaved}>
              Clear
            </button>
          </Alert>
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <Card dense className="mb-4">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
          <div className="text-sm text-body">
            <p className="font-semibold text-foreground">How to calibrate</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>
                Type a label (e.g. <span className="font-heading">You</span>) and capture that palm{" "}
                <strong>at least 4 times</strong>, <strong>repositioning between each</strong> (take
                the hand fully out of frame, slightly vary angle/distance). A single capture is
                noisy — the template is built by averaging several.
              </li>
              <li>
                Change the label and do the same for <strong>3–4 other people, 4× each</strong>.
              </li>
              <li>
                Press <strong>Analyze</strong> — it scores each capture against per-person averaged
                templates (how real verification works). Aim for <strong>EER ≤ 5%</strong>, then{" "}
                <strong>Save</strong>.
              </li>
            </ol>
            <p className="mt-2 text-xs text-muted-fg">
              Why 4×: measured on real palms, a template from 1 capture ≈ 11% EER, from 3 ≈ 1%, from
              4 ≈ 0%. Averaging separate captures cancels the per-capture noise. Enrol students the
              same way (the enrollment flow now takes {" "}
              <span className="font-heading">multiple rounds</span> automatically).
            </p>
          </div>
        </div>
      </Card>

      {!capturing && (
        <Card dense className="mb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[12rem]">
              <label htmlFor="cal-label" className="mb-1 block text-xs font-medium text-muted-fg">
                Person label
              </label>
              <Input
                id="cal-label"
                placeholder="You / Ravi / Priya…"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="py-2 text-sm"
              />
            </div>
            <Button disabled={!canCapture} onClick={() => setCapturing(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Capture sample
            </Button>
            {busy && <Spinner className="h-5 w-5" />}
          </div>
        </Card>
      )}

      {capturing && (
        <Card dense className="mb-4">
          <p className="mb-3 text-sm text-body">
            Capturing <strong>{label.trim()}</strong> — hold the palm flat, filling the frame.
          </p>
          <CameraCapture
            targetFrames={CAPTURE_FRAMES}
            instruction="Hold the palm flat toward the camera, fingers open"
            onComplete={(c) => void handleCapture(c)}
          />
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => setCapturing(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <Card dense className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
            <Hand className="h-4 w-4 text-primary" aria-hidden /> Collected samples ({samples.length})
          </h2>
          {samples.length > 0 && (
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={reset}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear samples
            </Button>
          )}
        </div>
        {counts.size === 0 ? (
          <p className="py-4 text-center text-sm text-muted-fg">No samples yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[...counts.entries()].map(([name, n]) => (
              <Badge key={name} tone={n >= 2 ? "present" : "warn"}>
                <UserRound className="mr-1 inline h-3 w-3" aria-hidden />
                {name}: {n}
              </Badge>
            ))}
          </div>
        )}
        {lastRoi && (
          <div className="mt-4 flex items-center gap-3">
            <RoiPreview gray={lastRoi} />
            <p className="max-w-sm text-xs text-muted-fg">
              This is exactly what the model sees (last capture). If the palm doesn&apos;t fill most
              of this square, or looks blurry/dark, that&apos;s why palms don&apos;t separate — move
              the hand closer and steadier.
            </p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button disabled={samples.length < 4} onClick={analyze}>
            Analyze separation
          </Button>
          <Button variant="secondary" disabled={samples.length === 0} onClick={exportSamples}>
            <Download className="h-4 w-4" aria-hidden /> Export samples (JSON)
          </Button>
        </div>
      </Card>

      {analysis && (
        <Card>
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">Result</h2>
          <Alert tone={analysis.ok ? (analysis.data && analysis.data.eer <= 0.15 ? "success" : "warn") : "error"}>
            {analysis.message}
          </Alert>
          {analysis.data && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label={`Transform (best)`} value={analysis.data.mode} />
                <Stat label="EER" value={`${(analysis.data.eer * 100).toFixed(1)}%`} />
                <Stat label="Genuine mean" value={analysis.data.genuineMean.toFixed(3)} />
                <Stat label="Impostor mean" value={analysis.data.impostorMean.toFixed(3)} />
                <Stat label="EER raw" value={`${(analysis.data.eerByMode.raw * 100).toFixed(1)}%`} />
                <Stat label="EER centered" value={`${(analysis.data.eerByMode.centered * 100).toFixed(1)}%`} />
                <Stat label="EER whitened" value={`${(analysis.data.eerByMode.whitened * 100).toFixed(1)}%`} />
                <Stat label="Separation" value={analysis.data.separation.toFixed(3)} />
                <Stat label="Accept ≥" value={analysis.data.acceptThreshold.toFixed(3)} />
                <Stat label="Retry ≥" value={analysis.data.retryThreshold.toFixed(3)} />
                <Stat label="Genuine pairs" value={String(analysis.genuineScores.length)} />
                <Stat label="Impostor pairs" value={String(analysis.impostorScores.length)} />
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={persist}>
                  <Save className="h-4 w-4" aria-hidden /> Save &amp; use this calibration
                </Button>
              </div>
            </>
          )}
        </Card>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-input bg-muted p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-fg">{label}</p>
      <p className="font-heading text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

export default function CalibratePage() {
  return (
    <RequireRole roles={["advisor"]}>
      <AppShell>
        <CalibrateInner />
      </AppShell>
    </RequireRole>
  );
}
