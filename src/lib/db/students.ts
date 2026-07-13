import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { EnrollmentStatus, StudentDoc } from "@/lib/types";

/** One batched read for the whole section roster (§6 concurrency note). */
export async function listStudents(sectionId: string): Promise<StudentDoc[]> {
  const snap = await getDocs(
    query(collection(getDb(), "students"), where("sectionId", "==", sectionId)),
  );
  return snap.docs
    .map((d) => d.data() as StudentDoc)
    .sort((a, b) => a.studentId.localeCompare(b.studentId));
}

export async function listAllStudents(): Promise<StudentDoc[]> {
  const snap = await getDocs(collection(getDb(), "students"));
  return snap.docs.map((d) => d.data() as StudentDoc);
}

export async function addStudent(student: StudentDoc): Promise<void> {
  await setDoc(doc(getDb(), "students", student.studentId), student);
}

export async function setStudentConsent(studentId: string, consentGiven: boolean): Promise<void> {
  await updateDoc(doc(getDb(), "students", studentId), {
    consentGiven,
    consentTimestamp: Date.now(),
  });
}

export async function setEnrollmentStatus(
  studentId: string,
  enrollmentStatus: EnrollmentStatus,
): Promise<void> {
  await updateDoc(doc(getDb(), "students", studentId), { enrollmentStatus });
}
