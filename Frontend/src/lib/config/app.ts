// ── Application-level policy configuration ──────────────────────────────────
// Single place for attendance policy. Do NOT scatter these rules elsewhere.

/** Attendance % below this flags a student (§7). */
export const ATTENDANCE_THRESHOLD_PERCENT = 85;

/**
 * THE OD RULE (single configurable rule, §7):
 * When true, an 'od' (On Duty) mark counts as present/excused in the
 * attendance percentage. When false, OD counts against the student like an
 * absence. CIT CSE policy treats OD as excused → default true.
 */
export const OD_COUNTS_AS_PRESENT = true;

/** CSE 3rd year sections A through Q — 17 sections. */
export const SECTIONS: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q",
] as const;

export const DEPARTMENT = "CSE";
export const YEAR = 3;

/** Local calendar date as YYYY-MM-DD (device timezone — the college's local day). */
export function todayStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Counts toward the numerator of the attendance % (implements the OD rule). */
export function countsAsPresent(status: string): boolean {
  return status === "present" || (OD_COUNTS_AS_PRESENT && status === "od");
}
