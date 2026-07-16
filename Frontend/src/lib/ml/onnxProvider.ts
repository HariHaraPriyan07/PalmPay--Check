// ── REAL palm-embedding provider: ONNX Runtime Web (§1–§3, §6) ───────────────
// One trained MobileNetV3-Large network, two browser builds:
//   • PRIMARY:  palm_fp16_web.onnx on the WebGPU EP (fp16 I/O) — when
//               ENABLE_WEBGPU is set AND the browser exposes WebGPU.
//   • FALLBACK: palm_256_l2_fp32.onnx on the WASM EP (fp32 I/O) — every laptop,
//               used whenever WebGPU is unavailable or fails to init.
// INT8 builds (palm_int8_web.onnx / palm_int8_mobile.onnx) are NOT used here —
// quantization drift testing rejected them (see deploy_config.json). The fp32
// reference build doubles as the parity self-test ground truth (parity.ts).
//
// The session is created ONCE per app session and kept warm. All runtime
// assets (loader script + .wasm) are SELF-HOSTED under /public/ort — no CDN
// fetch on first use (classroom networks).
//
// Output contract: the model L2-normalizes in-graph — this provider returns
// the raw 256-D output as a Float32Array WITHOUT re-normalizing, for every
// variant, so downstream cosine/enrollment code is dtype-agnostic.

import {
  EMBEDDING_DIM,
  ENABLE_WEBGPU,
  INPUT_NAME,
  INPUT_SIZE,
  MODEL_VARIANTS,
  MODEL_VERSION,
  ORT_ASSET_BASE,
  OUTPUT_NAME,
  type ModelVariant,
  type ModelVariantKey,
} from "./config";
import type { PreprocessedInput } from "./preprocess";
import type { EmbeddingProvider } from "./embeddingProvider";
import type * as OrtNs from "onnxruntime-web";

// ONNX Runtime Web is loaded via script tag from our own /public/ort (its ESM
// bundle uses import.meta/worker tricks Next's bundler cannot minify; the npm
// package is used for TypeScript types and as the source of the dist assets).
const ORT_WASM_SCRIPT = `${ORT_ASSET_BASE}ort.min.js`; // wasm EP bundle
const ORT_WEBGPU_SCRIPT = `${ORT_ASSET_BASE}ort.webgpu.min.js`; // webgpu + wasm EPs

declare global {
  interface Window {
    ort?: typeof OrtNs;
  }
}

// Keyed by script URL — NOT a single shared promise. ort.webgpu.min.js and
// ort.min.js each define their own top-level `ort` module instance with
// independent internal WASM-init state. If a WebGPU session attempt fails,
// ONNX Runtime Web permanently marks that module's wasm backend as failed
// ("previous call to 'initWasm()' failed") — retrying within the SAME module
// instance is impossible. The WASM fallback therefore needs its own fresh
// module (a real load of ort.min.js), not the already-loaded webgpu bundle.
const ortScriptPromises = new Map<string, Promise<typeof OrtNs>>();

function loadOrt(script: string): Promise<typeof OrtNs> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("OnnxEmbeddingProvider is browser-only"));
  }
  let promise = ortScriptPromises.get(script);
  if (!promise) {
    promise = new Promise<typeof OrtNs>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = script;
      s.async = true;
      s.onload = () => {
        if (!window.ort) {
          reject(new Error(`${script} loaded but window.ort is missing`));
          return;
        }
        // Fetch ort-wasm-simd-threaded[.jsep].{wasm,mjs} from /public/ort too.
        window.ort.env.wasm.wasmPaths = ORT_ASSET_BASE;
        resolve(window.ort);
      };
      s.onerror = () =>
        reject(
          new Error(
            `Failed to load ONNX Runtime Web from ${script}. The runtime is ` +
              `self-hosted — is /public/ort deployed with the app?`,
          ),
        );
      document.head.appendChild(s);
    }).catch((err) => {
      ortScriptPromises.delete(script); // allow retry after transient failure
      throw err;
    });
    ortScriptPromises.set(script, promise);
  }
  return promise;
}

// ── float16 <-> float32 (the fp16 model's I/O dtype, §2) ─────────────────────

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** IEEE 754 binary32 → binary16 bit pattern (round-to-nearest-even). */
export function float32ToFloat16Bits(src: Float32Array): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) {
    f32Scratch[0] = src[i];
    const x = u32Scratch[0];
    const sign = (x >>> 16) & 0x8000;
    const exp = (x >>> 23) & 0xff;
    const mant = x & 0x7fffff;
    let h: number;
    if (exp === 0xff) {
      h = sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
    } else {
      let e = exp - 127 + 15;
      if (e >= 0x1f) {
        h = sign | 0x7c00; // overflow → Inf
      } else if (e <= 0) {
        if (e < -10) {
          h = sign; // underflow → signed zero
        } else {
          // subnormal half
          const m = mant | 0x800000;
          const shift = 14 - e;
          let half = m >>> shift;
          if ((m >>> (shift - 1)) & 1) half += 1; // round
          h = sign | half;
        }
      } else {
        let half = mant >>> 13;
        if (mant & 0x1000) {
          half += 1; // round-to-nearest (ties away is fine at this precision)
          if (half === 0x400) {
            half = 0;
            e += 1;
            if (e >= 0x1f) {
              out[i] = sign | 0x7c00;
              continue;
            }
          }
        }
        h = sign | (e << 10) | half;
      }
    }
    out[i] = h;
  }
  return out;
}

/** IEEE 754 binary16 bit pattern → binary32. */
export function float16BitsToFloat32(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const h = src[i];
    const sign = h & 0x8000 ? -1 : 1;
    const exp = (h >>> 10) & 0x1f;
    const mant = h & 0x3ff;
    if (exp === 0) out[i] = sign * 2 ** -14 * (mant / 1024);
    else if (exp === 0x1f) out[i] = mant ? NaN : sign * Infinity;
    else out[i] = sign * 2 ** (exp - 15) * (1 + mant / 1024);
  }
  return out;
}

/** Model output (fp32, fp16-bits, or native Float16Array) → fresh Float32Array. */
function outputToFloat32(data: unknown): Float32Array {
  if (data instanceof Float32Array) return new Float32Array(data);
  if (data instanceof Uint16Array) return float16BitsToFloat32(data);
  const F16 = (globalThis as { Float16Array?: unknown }).Float16Array;
  if (typeof F16 === "function" && data instanceof (F16 as new () => object)) {
    return Float32Array.from(data as unknown as ArrayLike<number>);
  }
  throw new Error(`Unexpected model output data type: ${Object.prototype.toString.call(data)}`);
}

// ── Session helpers ──────────────────────────────────────────────────────────

async function createSession(
  ort: typeof OrtNs,
  variant: ModelVariant,
): Promise<OrtNs.InferenceSession> {
  const session = await ort.InferenceSession.create(variant.path, {
    executionProviders: [variant.executionProvider],
  });
  if (!session.inputNames.includes(INPUT_NAME) || !session.outputNames.includes(OUTPUT_NAME)) {
    throw new Error(
      `Model at ${variant.path} does not match the I/O contract ` +
        `(expected input "${INPUT_NAME}" / output "${OUTPUT_NAME}", ` +
        `got inputs [${session.inputNames}] / outputs [${session.outputNames}]).`,
    );
  }
  return session;
}

async function runSessionUnsafe(
  ort: typeof OrtNs,
  session: OrtNs.InferenceSession,
  variant: ModelVariant,
  input: PreprocessedInput,
): Promise<Float32Array> {
  const dims = [1, 3, INPUT_SIZE, INPUT_SIZE];
  // Cast the fp32 preprocessed tensor to the variant's input dtype (§2/§3.6):
  // float16 for palm_fp16_web, float32 for the fp32 model.
  const tensor =
    variant.dtype === "float16"
      ? new ort.Tensor("float16", float32ToFloat16Bits(input.tensor), dims)
      : new ort.Tensor("float32", input.tensor, dims);
  const results = await session.run({ [INPUT_NAME]: tensor });
  const emb = outputToFloat32(results[OUTPUT_NAME].data);
  if (emb.length !== EMBEDDING_DIM) {
    throw new Error(`Model output dim ${emb.length} != expected ${EMBEDDING_DIM}.`);
  }
  // Already L2-normalized in-graph (§2) — returned as-is, NOT re-normalized.
  return emb;
}

// ONNX Runtime Web's WASM backend allows only ONE session.run() in flight at
// a time — it's a single-flight guard baked into the wasm module itself
// (shared across every session created from that module, including the
// parity self-test's reference session), not something scoped per JS
// session object. Enrollment/verification embed several captured frames via
// Promise.all, so every run() must be funneled through this queue instead of
// called directly, or ORT throws "Session already started".
let runQueue: Promise<unknown> = Promise.resolve();

function runSession(
  ort: typeof OrtNs,
  session: OrtNs.InferenceSession,
  variant: ModelVariant,
  input: PreprocessedInput,
): Promise<Float32Array> {
  const run = runQueue.catch(() => {}).then(() => runSessionUnsafe(ort, session, variant, input));
  runQueue = run.catch(() => {});
  return run;
}

export class OnnxEmbeddingProvider implements EmbeddingProvider {
  private variantKey: ModelVariantKey = "web_wasm";
  private ort: typeof OrtNs | null = null;
  private session: OrtNs.InferenceSession | null = null;
  private normWarned = false;

  get name(): string {
    return `ONNX Runtime Web — real palm model (${this.variantKey}, ${
      MODEL_VARIANTS[this.variantKey].executionProvider
    } EP)`;
  }

  /** Stamped on every template/verification this provider produces (§7). */
  get modelVersion(): string {
    return this.session ? MODEL_VARIANTS[this.variantKey].version : MODEL_VERSION;
  }

  /** Loaded once and kept warm for the whole session (§6/§11). */
  async init(): Promise<void> {
    if (this.session) return;

    const wantWebgpu =
      ENABLE_WEBGPU && typeof navigator !== "undefined" && "gpu" in navigator;
    let ort: typeof OrtNs;

    if (wantWebgpu) {
      ort = await loadOrt(ORT_WEBGPU_SCRIPT);
      try {
        this.session = await createSession(ort, MODEL_VARIANTS.web_webgpu);
        this.variantKey = "web_webgpu";
      } catch (err) {
        // The webgpu bundle's wasm backend permanently marks itself failed after
        // one bad initWasm() — reusing `ort` here would just throw "previous
        // call to 'initWasm()' failed" instead of actually retrying. Load a
        // fresh ort.min.js module (its own independent wasm-init state) below.
        console.warn(
          "[ML] WebGPU session failed — falling back to FP32 on WASM (the safe default).",
          err,
        );
      }
    }
    if (!this.session) {
      ort = await loadOrt(ORT_WASM_SCRIPT);
      try {
        this.session = await createSession(ort, MODEL_VARIANTS.web_wasm);
        this.variantKey = "web_wasm";
      } catch (err) {
        throw new Error(
          `Failed to load the palm model from ${MODEL_VARIANTS.web_wasm.path}. ` +
            `Is /public/models deployed with the app? Cause: ${String(err)}`,
        );
      }
    }
    this.ort = ort!;

    // Warm-up inference so the first real scan doesn't pay kernel-compile cost.
    const zeros: PreprocessedInput = {
      tensor: new Float32Array(3 * INPUT_SIZE * INPUT_SIZE),
      gray: new Float32Array(INPUT_SIZE * INPUT_SIZE),
      width: INPUT_SIZE,
      height: INPUT_SIZE,
    };
    await runSession(ort, this.session, MODEL_VARIANTS[this.variantKey], zeros);
    console.info(`[ML] Real palm model ready: ${this.modelVersion} (${this.name})`);
  }

  async getEmbedding(input: PreprocessedInput): Promise<Float32Array> {
    if (!this.session || !this.ort) throw new Error("OnnxEmbeddingProvider not initialized");
    const emb = await runSession(this.ort, this.session, MODEL_VARIANTS[this.variantKey], input);
    if (!this.normWarned) {
      // One-time sanity check only — the output must NOT be re-normalized here.
      let sum = 0;
      for (let i = 0; i < emb.length; i++) sum += emb[i] * emb[i];
      const norm = Math.sqrt(sum);
      if (Math.abs(norm - 1) > 0.02) {
        this.normWarned = true;
        console.warn(
          `[ML] Embedding L2 norm ${norm.toFixed(4)} deviates from 1 — the model should ` +
            `normalize in-graph. Check that the correct .onnx files are deployed.`,
        );
      }
    }
    return emb;
  }
}

// ── FP32 reference path (parity self-test ONLY — §8) ─────────────────────────

let referenceSessionPromise: Promise<OrtNs.InferenceSession> | null = null;

/**
 * Run an input through palm_256_l2_fp32.onnx (ground truth, WASM EP).
 * Dev-only: used by the parity self-test to prove the browser preprocessing
 * and the active production build match training. Never used for real matching.
 */
export async function getReferenceEmbedding(input: PreprocessedInput): Promise<Float32Array> {
  const ort = await loadOrt(ORT_WASM_SCRIPT); // no-op if a bundle is already loaded
  if (!referenceSessionPromise) {
    referenceSessionPromise = createSession(ort, MODEL_VARIANTS.reference_fp32).catch((err) => {
      referenceSessionPromise = null;
      throw err;
    });
  }
  const session = await referenceSessionPromise;
  return runSession(ort, session, MODEL_VARIANTS.reference_fp32, input);
}
