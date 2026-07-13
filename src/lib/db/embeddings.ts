import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { EmbeddingDoc } from "@/lib/types";

// Embeddings are the matching credential (raw palm images are never stored
// for matching, §11). Firestore rules restrict access to the owning section's
// advisor only.

export async function getStudentEmbedding(studentId: string): Promise<EmbeddingDoc | null> {
  const snap = await getDoc(doc(getDb(), "embeddings", studentId));
  return snap.exists() ? (snap.data() as EmbeddingDoc) : null;
}

export async function saveStudentEmbedding(embedding: EmbeddingDoc): Promise<void> {
  await setDoc(doc(getDb(), "embeddings", embedding.studentId), embedding);
}

export async function deleteStudentEmbedding(studentId: string): Promise<void> {
  await deleteDoc(doc(getDb(), "embeddings", studentId));
}
