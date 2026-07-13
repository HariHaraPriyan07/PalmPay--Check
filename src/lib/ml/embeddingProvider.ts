// ── The swappable embedding-provider seam (§8) ───────────────────────────────
// Everything else in the app (enrollment, attendance, scoring, UI) talks ONLY
// to this interface. Swapping the placeholder for the real ONNX model changes
// nothing outside src/lib/ml/.

import type { PreprocessedInput } from "./preprocess";
import { USE_PLACEHOLDER_PROVIDER } from "./config";

export interface EmbeddingProvider {
  /** Human-readable provider name (shown in dev/instrumentation). */
  readonly name: string;
  /** Persisted with every stored embedding (§4, §11). */
  readonly modelVersion: string;
  /** Load/warm the model. Idempotent; called once and kept warm (§11). */
  init(): Promise<void>;
  /** Preprocessed palm ROI → 256-D **L2-normalized** embedding. */
  getEmbedding(input: PreprocessedInput): Promise<Float32Array>;
}

let providerPromise: Promise<EmbeddingProvider> | null = null;

/**
 * Singleton factory — the provider is created and initialized once per
 * session and kept warm so daily 1:1 matching feels instant (§11).
 */
export function getEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const provider = USE_PLACEHOLDER_PROVIDER
        ? new (await import("./placeholderProvider")).PlaceholderEmbeddingProvider()
        : new (await import("./onnxProvider")).OnnxEmbeddingProvider();
      await provider.init();
      return provider;
    })();
  }
  return providerPromise;
}
