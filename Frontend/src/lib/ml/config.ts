// ── ML configuration: REAL MODEL (MobileNetV3-Large → 256-D palm embedding) ──
//
// The trained palm-recognition model is integrated. One PyTorch network,
// exported as ONNX runtime builds with an IDENTICAL I/O contract
// (input "input" [batch,3,224,224] NCHW RGB → output "embedding" [batch,256],
// L2-normalized IN-GRAPH). Only precision/dtype differ:
//
//   web_webgpu     palm_fp16_web.onnx     FP16  fp16 I/O  ← PRIMARY (browser, WebGPU EP)
//   web_wasm       palm_256_l2_fp32.onnx  FP32  fp32 I/O  ← FALLBACK (browser, WASM EP, every laptop)
//   reference_fp32 palm_256_l2_fp32.onnx  FP32  fp32 I/O  (parity self-test ground truth)
//
// INT8 (palm_int8_web.onnx / palm_int8_mobile.onnx) is NOT viable: quantization
// drift testing failed both (mean cosine ~0.70, min ~0.47 vs fp32 reference —
// see deploy_config.json). Those files remain on disk for diagnostic reference
// only — never route auth traffic at them. Any templates built while INT8 was
// mistakenly in use must be re-enrolled against the fp16/fp32 path.

export const EMBEDDING_DIM = 256;

// ── Model I/O + preprocessing contract — LOCKED, matches training exactly ────
// Inference preprocessing is ONLY: resize 224 → RGB → ÷255 → ImageNet
// mean/std → NCHW. ⚠ NO CLAHE at inference — CLAHE was train-time augmentation
// only; applying it here silently corrupts embeddings. No gamma, no histogram/
// illumination ops, no edge/skeleton steps.

export const INPUT_NAME = "input";
export const OUTPUT_NAME = "embedding";
export const INPUT_SIZE = 224;
export const CHANNEL_ORDER: "RGB" | "BGR" = "RGB";
export const LAYOUT = "NCHW";
export const SCALE = 1 / 255;
export const NORMALIZE_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
export const NORMALIZE_STD: readonly [number, number, number] = [0.229, 0.224, 0.225];
/** The model L2-normalizes in-graph — do NOT re-normalize its output. */
export const OUTPUT_IS_L2_NORMALIZED = true;

/**
 * Per-ROI illumination normalization (§3.6b). When true, each capture's pixels
 * are standardized per channel to zero-mean/unit-std WITHIN the ROI instead of
 * the fixed ÷255 + ImageNet mean/std. This removes each frame's brightness and
 * contrast before the model sees it, so lighting/exposure changes no longer move
 * the embedding — measured to hold genuine similarity ~0.99 across a gain
 * 0.7–1.3 / gamma 0.7–1.5 sweep (vs ~0.90 without) and drop calibration EER from
 * ~3% to ~0% when captures span mixed lighting.
 * ⚠ This changes the embedding space: templates + calibration made under a
 * different setting are incompatible — RE-ENROLL and RE-CALIBRATE after toggling.
 * The active mode is stamped into MODEL_FAMILY so stale data is flagged.
 */
export const ROI_ILLUMINATION_NORM = true;

// ── Model variants & versioning (§7) ─────────────────────────────────────────

/**
 * Base network + embedding dim + release + preprocessing mode. The preprocessing
 * suffix is part of the family because it defines the embedding space: templates
 * from a different preprocessing mode are NOT comparable, so bumping it makes the
 * verify screen flag old templates for re-enrollment.
 */
export const MODEL_FAMILY = ROI_ILLUMINATION_NORM
  ? "palm-mnv3l-256-v2zscore"
  : "palm-mnv3l-256-v1";

export type ModelVariantKey = "web_wasm" | "web_webgpu" | "reference_fp32";

export interface ModelVariant {
  /** Served from /public (self-hosted — no CDN fetch at first use). */
  path: string;
  /** Input/output tensor dtype this build expects. */
  dtype: "float32" | "float16";
  /** ONNX Runtime execution provider this build is paired with. */
  executionProvider: "wasm" | "webgpu";
  /** Stamped on every template/verification produced by this build. */
  version: string;
}

export const MODEL_VARIANTS: Record<ModelVariantKey, ModelVariant> = {
  web_wasm: {
    path: "/models/palm_256_l2_fp32.onnx",
    dtype: "float32",
    executionProvider: "wasm",
    version: `${MODEL_FAMILY}-fp32wasm`,
  },
  web_webgpu: {
    path: "/models/palm_fp16_web.onnx",
    dtype: "float16",
    executionProvider: "webgpu",
    version: `${MODEL_FAMILY}-fp16webgpu`,
  },
  reference_fp32: {
    path: "/models/palm_256_l2_fp32.onnx",
    dtype: "float32",
    executionProvider: "wasm",
    version: `${MODEL_FAMILY}-fp32ref`,
  },
};

/**
 * Default deployed build (FP32 on WASM — works on every advisor laptop).
 * Shown in the UI; per-template versions come from the provider that made them.
 */
export const MODEL_VERSION = MODEL_VARIANTS.web_wasm.version;

/**
 * Load palm_fp16_web.onnx on the WebGPU EP when the browser supports it
 * (primary path, per deploy_config.json). Falls back to palm_256_l2_fp32.onnx
 * on the WASM EP when WebGPU is unavailable. All variants are the same
 * trained network, so templates stay compatible either way.
 */
export const ENABLE_WEBGPU = true;

/** false → real ONNX provider (onnxProvider.ts). true → flow-testing placeholder. */
export const USE_PLACEHOLDER_PROVIDER = false;

/** Self-hosted ONNX Runtime Web assets (loader scripts + .wasm) — see /public/ort. */
export const ORT_ASSET_BASE = "/ort/";

// ── 1:1 match decision (§4) ──────────────────────────────────────────────────
// ⚠ RAW cosine on this model is NOT separable. Measured: unrelated palms score
// cosine ~0.6–0.97 against each other, and the impostor max EXCEEDS a genuine
// pair — so no fixed raw-cosine threshold can tell people apart (this is the
// "matches all hands" bug). Verification therefore scores in the MEAN-CENTERED
// space (see ml/centering.ts) with an impostor-cohort-relative threshold
// computed per section (T-norm style), NOT the fixed value below.

/**
 * Turn on deployment mean-centering for verification scoring. Leave ON — raw
 * cosine does not work for this model (see ml/centering.ts for the evidence).
 */
export const EMBEDDING_CENTERING = true;

/**
 * Minimum enrolled templates before a section's OWN mean is used as the
 * centering origin (fallback path only). A SAVED CALIBRATION (ml/calibration.ts,
 * the Calibrate screen) always takes precedence and works from the first
 * student — prefer that. Below this AND with no calibration, verification drops
 * to the unreliable raw fallback and flags it loudly.
 */
export const MIN_TEMPLATES_FOR_CENTERING = 3;

/**
 * Accept when centered score ≥ (impostorMean + ACCEPT_Z · impostorStd), where
 * the impostor mean/std are measured from the section's own cross-student
 * template pairs each session. This self-locates the decision boundary above
 * the impostor cloud regardless of the space's absolute scale. ACCEPT_Z ≈ 4
 * targets a low false-accept rate; RETRY_Z opens a "reposition & retry" band
 * just below it. Tune with window.__palmPairCheck / the calibration readout.
 */
export const ACCEPT_Z = 4.0;
export const RETRY_Z = 3.0;

/**
 * Clamp the adaptive centered accept threshold into a sane band — guardrails
 * against a degenerate impostor std, NOT the operating point itself (that comes
 * from the impostor cohort). MAX is deliberately below typical genuine scores
 * so a wide impostor spread can't push the bar above reachable genuine matches.
 * ⚠ Validate on real palms with the calibration readout before relying on it.
 */
export const CENTERED_THRESHOLD_MIN = 0.25;
export const CENTERED_THRESHOLD_MAX = 0.7;

/**
 * RAW-cosine fallback threshold, used ONLY when centering is unavailable (too
 * few templates). Documented-unreliable for this model; kept so the flow still
 * produces a score. Not the primary decision path.
 */
export const VERIFICATION_THRESHOLD = 0.5346;

/** Tunable width of the "reposition & retry" band just below accept (raw fallback). */
export const RETRY_MARGIN = 0.05;

/** VERIFICATION_THRESHOLD − RETRY_MARGIN ≤ cosine < VERIFICATION_THRESHOLD → retry; below → reject. */
export const RETRY_THRESHOLD = VERIFICATION_THRESHOLD - RETRY_MARGIN;

/** Parity self-test pass bar: cosine(int8-web, fp32 reference) on the fixed image (§8). */
export const PARITY_MIN_COSINE = 0.99;

// ── Capture parameters ───────────────────────────────────────────────────────
// ⚠ CRITICAL for accuracy: a single capture session's frames are correlated
// (same pose/lighting), so averaging within ONE session does NOT cancel the
// session-to-session noise that dominates same-person variation. Measured on
// real palms: a template from 1 capture → EER ~11%; from 3 → ~1%; from 4 → ~0%.
// Enrollment therefore takes SEVERAL separate rounds (reposition between each)
// and averages ALL their embeddings into the stored template.

/** Frames captured per enrollment round (averaged within the round). */
export const ENROLL_FRAME_COUNT = 6;

// ── Enrollment is deliberately slow (§5.3) ───────────────────────────────────
// Garbage in → garbage template: a shaky/blurred enrollment frame permanently
// corrupts the stored template, so enrollment must NOT rush. It captures fewer
// frames per second than verification and only accepts a frame once the palm is
// held genuinely still, trading a couple of seconds for clean, in-focus crops.

/** Spacing between accepted enrollment frames — wide, so we don't blast a burst
 *  of near-duplicate frames from a single instant of motion. */
export const ENROLL_FRAME_GAP_MS = 650;

/** How far the palm may drift (ROI center distance + |size change|, in frame
 *  fractions) between raw frames and still count as "steady". */
export const STEADY_MOVE_THRESHOLD = 0.018;

/** The palm must stay within STEADY_MOVE_THRESHOLD for this long before the
 *  first frame of a steady hold is accepted — rejects mid-motion captures. */
export const STEADY_HOLD_MS = 450;

/** Separate capture rounds per enrollment — reposition between each (§5). */
export const ENROLL_ROUNDS = 4;

/** Good frames required for a daily verification attempt. */
export const VERIFY_FRAME_COUNT = 5;

// ── 1:N identification (Issue #3 — true continuous-scan attendance) ───────────
// The camera scans continuously and identifies WHO from the section roster (no
// name selection). Decision uses the fixed raw-cosine floor AND a margin over
// the runner-up — in 1:N the margin is the real discriminator (nearest-template
// rank-1 was ~100% on measured data; the floor filters non-palms/unenrolled).

/** Accept floor: best raw cosine must clear this. */
export const IDENTIFY_ACCEPT_THRESHOLD = 0.5216;

/** Best − runner-up must be ≥ this, or the scan is ambiguous → No match. */
export const IDENTIFY_MARGIN = 0.05;

/** Good steady frames averaged into one identification probe. */
export const IDENTIFY_PROBE_FRAMES = 5;

/** How long an identification result is shown before scanning resumes (ms). */
export const IDENTIFY_RESULT_HOLD_MS = 2200;
