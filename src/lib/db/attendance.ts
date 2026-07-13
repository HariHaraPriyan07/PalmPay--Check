import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { AttendanceRecordDoc } from "@/lib/types";

/**
 * Deterministic doc id — one record per student per day. Re-marking the same
 * student on the same date overwrites the record (same-day correction, §6);
 * a second doc for the same day is structurally impossible.
 */
export function attendanceDocId(date: string, studentId: string): string {
  return `${date}_${studentId}`;
}

/** Save (create or same-day correct) one attendance record. */
export async function markAttendance(record: AttendanceRecordDoc): Promise<void> {
  if (record.status === "others" && !(record.reason && record.reason.trim().length > 0)) {
    // Also enforced server-side in firestore.rules.
    throw new Error("A reason is required when status is 'Others'.");
  }
  await setDoc(doc(getDb(), "attendanceRecords", attendanceDocId(record.date, record.studentId)), record);
}

/** One batched read: all records for a section on a date. */
export async function getSectionRecordsForDate(
  sectionId: string,
  date: string,
): Promise<Map<string, AttendanceRecordDoc>> {
  const snap = await getDocs(
    query(
      collection(getDb(), "attendanceRecords"),
      where("sectionId", "==", sectionId),
      where("date", "==", date),
    ),
  );
  const map = new Map<string, AttendanceRecordDoc>();
  for (const d of snap.docs) {
    const rec = d.data() as AttendanceRecordDoc;
    map.set(rec.studentId, rec);
  }
  return map;
}

/** All records for a section (full summary recompute). */
export async function getSectionRecords(sectionId: string): Promise<AttendanceRecordDoc[]> {
  const snap = await getDocs(
    query(collection(getDb(), "attendanceRecords"), where("sectionId", "==", sectionId)),
  );
  return snap.docs.map((d) => d.data() as AttendanceRecordDoc);
}

/** Staff view: all sections' records for one date. */
export async function getAllRecordsForDate(date: string): Promise<AttendanceRecordDoc[]> {
  const snap = await getDocs(
    query(collection(getDb(), "attendanceRecords"), where("date", "==", date)),
  );
  return snap.docs.map((d) => d.data() as AttendanceRecordDoc);
}
