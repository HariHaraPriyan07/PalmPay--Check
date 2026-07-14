import { collection, getDocs, query, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { AttendanceSummaryDoc } from "@/lib/types";

export async function getSectionSummaries(sectionId: string): Promise<AttendanceSummaryDoc[]> {
  const snap = await getDocs(
    query(collection(getDb(), "attendanceSummary"), where("sectionId", "==", sectionId)),
  );
  return snap.docs.map((d) => d.data() as AttendanceSummaryDoc);
}

/** Staff: all summaries department-wide (17 sections roll-up, §10). */
export async function getAllSummaries(): Promise<AttendanceSummaryDoc[]> {
  const snap = await getDocs(collection(getDb(), "attendanceSummary"));
  return snap.docs.map((d) => d.data() as AttendanceSummaryDoc);
}
