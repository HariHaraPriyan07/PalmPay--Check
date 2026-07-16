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
import { describeSectionScoring } from "@/lib/ml/centering";

declare global {
  interface Window {
    __palmParitySelfTest?: typeof runParitySelfTest;
    __palmPairCheck?: typeof runPairSanityCheck;
    __palmScoring?: typeof describeSectionScoring;
  }
}

export function MlDevTools() {
  useEffect(() => {
    window.__palmParitySelfTest = runParitySelfTest;
    window.__palmPairCheck = runPairSanityCheck;
    window.__palmScoring = describeSectionScoring;
    console.info(
      "[ML] Dev self-tests available: await window.__palmParitySelfTest() " +
        "(production build vs fp32 reference, expect cosine ≥ 0.99); " +
        "await window.__palmPairCheck(canvasA, canvasB) (raw cosine — note production " +
        "scores in the mean-centered space); and await window.__palmScoring(\"A\") " +
        "(live centering + adaptive-threshold operating point for a section). " +
        "See README §Parity self-test.",
    );
    return () => {
      delete window.__palmParitySelfTest;
      delete window.__palmPairCheck;
      delete window.__palmScoring;
    };
  }, []);
  return null;
}
