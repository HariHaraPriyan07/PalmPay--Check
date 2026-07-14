import { doc, writeBatch } from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import { ATTENDANCE_THRESHOLD_PERCENT, countsAsPresent, todayStr } from "@/lib/config/app";
import type { AttendanceSummaryDoc, StudentDoc } from "@/lib/types";
import { getSectionRecords } from "./attendance";
import { getWorkingDaysUpTo } from "./calendar";

// Derived attendanceSummary (§4, §7):
//   percentage = presentCount / workingDaysSoFar
// where workingDaysSoFar comes ONLY from academicCalendar working days
// (non-working days never count against a student) and presentCount applies
// the single OD rule from config/app.ts. belowThreshold flips below 85%.

/**
 * Full recompute for a section — one batched write for the whole roster.
 * Run after taking/correcting attendance (cheap: one records query + one
 * calendar query + one batch).
 */
export async function recomputeSectionSummaries(
  sectionId: string,
  students: StudentDoc[],
): Promise<AttendanceSummaryDoc[]> {
  const [workingDays, records] = await Promise.all([
    getWorkingDaysUpTo(todayStr()),
    getSectionRecords(sectionId),
  ]);
  const workingSet = new Set(workingDays);
  const workingDaysSoFar = workingDays.length;

  const presentByStudent = new Map<string, number>();
  for (const rec of records) {
    if (!workingSet.has(rec.date)) continue; // records on non-working days never count
    if (countsAsPresent(rec.status)) {
      presentByStudent.set(rec.studentId, (presentByStudent.get(rec.studentId) ?? 0) + 1);
    }
  }

  const now = Date.now();
  const summaries: AttendanceSummaryDoc[] = students.map((s) => {
    const presentCount = presentByStudent.get(s.studentId) ?? 0;
    const percentage =
      workingDaysSoFar > 0 ? Math.round((presentCount / workingDaysSoFar) * 10000) / 100 : 100;
    return {
      studentId: s.studentId,
      sectionId,
      workingDaysSoFar,
      presentCount,
      percentage,
      belowThreshold: workingDaysSoFar > 0 && percentage < ATTENDANCE_THRESHOLD_PERCENT,
      updatedAt: now,
    };
  });

  // Firestore batches cap at 500 writes; a section is ~60 students, but chunk defensively.
  const db = getDb();
  for (let i = 0; i < summaries.length; i += 450) {
    const batch = writeBatch(db);
    for (const s of summaries.slice(i, i + 450)) {
      batch.set(doc(db, "attendanceSummary", s.studentId), s);
    }
    await batch.commit();
  }
  return summaries;
}
