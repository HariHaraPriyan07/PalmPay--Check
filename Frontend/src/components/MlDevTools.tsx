"use client";

// Exposes the §8 dev self-tests in the browser console:
//   await window.__palmParitySelfTest()
//     → fixed image through production path (fp16 on WebGPU, or fp32 on WASM
//       fallback) AND the fp32 reference model; logs cosine — expect ~0.99+.
//   await window.__palmPairCheck(canvasA, canvasB)
//     → genuine-vs-impostor sanity: same-palm pairs should score ≥ 0.5346,
//       different-palm pairs below it.

import { useEffect } from "react";
import { runPairSanityCheck, runParitySelfTest } from "@/lib/ml/parity";

declare global {
  interface Window {
    __palmParitySelfTest?: typeof runParitySelfTest;
    __palmPairCheck?: typeof runPairSanityCheck;
  }
}

export function MlDevTools() {
  useEffect(() => {
    window.__palmParitySelfTest = runParitySelfTest;
    window.__palmPairCheck = runPairSanityCheck;
    console.info(
      "[ML] Dev self-tests available: await window.__palmParitySelfTest() " +
        "(production build vs fp32 reference, expect cosine ≥ 0.99) and " +
        "await window.__palmPairCheck(canvasA, canvasB) (genuine ≥ 0.5346, impostor below). " +
        "See README §Parity self-test.",
    );
    return () => {
      delete window.__palmParitySelfTest;
      delete window.__palmPairCheck;
    };
  }, []);
  return null;
}
