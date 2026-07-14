import { addDoc, collection } from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { VerificationEventDoc } from "@/lib/types";

/**
 * Append-only instrumentation (§8): EVERY verification attempt is logged with
 * its similarity score, outcome, quality and liveness signals, and model
 * version — this is the dataset from which FAR/FRR will be computed once the
 * real model replaces the placeholder. That measurement is the point of the
 * project; do not remove these logs.
 */
export async function logVerificationEvent(event: VerificationEventDoc): Promise<void> {
  try {
    await addDoc(collection(getDb(), "verificationEvents"), event);
  } catch (err) {
    // Instrumentation must never block attendance-taking.
    console.error("Failed to log verification event", err);
  }
}
