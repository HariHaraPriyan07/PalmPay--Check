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

// ── Model variants & versioning (§7) ─────────────────────────────────────────

/** Base network + embedding dim + release — shared by all four builds. */
export const MODEL_FAMILY = "palm-mnv3l-256-v1";

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
// Calibrated operating point of the real model — NOT a placeholder value.
// Genuine cosine scores in this embedding space sit around/above ~0.52, not
// ~0.9; that is the correct scale. Do not rescale scores to look higher.

/** Accept when cosine(probe, template) ≥ this. Calibrated at FAR 0.1%. */
export const VERIFICATION_THRESHOLD = 0.5346;

/** Tunable width of the "reposition & retry" band just below accept. */
export const RETRY_MARGIN = 0.05;

/** VERIFICATION_THRESHOLD − RETRY_MARGIN ≤ cosine < VERIFICATION_THRESHOLD → retry; below → reject. */
export const RETRY_THRESHOLD = VERIFICATION_THRESHOLD - RETRY_MARGIN;

/** Parity self-test pass bar: cosine(int8-web, fp32 reference) on the fixed image (§8). */
export const PARITY_MIN_COSINE = 0.99;

// ── Capture parameters ───────────────────────────────────────────────────────
/** Frames captured (and embedded, then averaged + re-normalized) during enrollment (§5). */
export const ENROLL_FRAME_COUNT = 10;

/** Good frames required for a daily verification attempt. */
export const VERIFY_FRAME_COUNT = 5;
