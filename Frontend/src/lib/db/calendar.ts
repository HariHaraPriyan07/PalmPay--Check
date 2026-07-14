import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { getDb } from "@/lib/firebase/client";
import type { CalendarDayDoc } from "@/lib/types";

// Academic calendar drives working-day counting (§7). POLICY: a date counts
// as a working day ONLY if an academicCalendar doc exists for it with
// isWorkingDay === true. Unmarked/holiday dates can therefore NEVER count
// against a student. The calendar is maintained by coordinator/HOD
// (see /calendar page; seed script pre-fills Mon–Fri).

export async function setCalendarDay(day: CalendarDayDoc): Promise<void> {
  await setDoc(doc(getDb(), "academicCalendar", day.date), day);
}

/** All working days with date ≤ upTo (inclusive). One indexed query. */
export async function getWorkingDaysUpTo(upTo: string): Promise<string[]> {
  const snap = await getDocs(
    query(
      collection(getDb(), "academicCalendar"),
      where("isWorkingDay", "==", true),
      where("date", "<=", upTo),
    ),
  );
  return snap.docs.map((d) => (d.data() as CalendarDayDoc).date).sort();
}

/** All calendar docs in a month ("YYYY-MM") for the calendar management UI. */
export async function getCalendarMonth(yearMonth: string): Promise<Map<string, CalendarDayDoc>> {
  const snap = await getDocs(
    query(
      collection(getDb(), "academicCalendar"),
      where("date", ">=", `${yearMonth}-01`),
      where("date", "<=", `${yearMonth}-31`),
    ),
  );
  const map = new Map<string, CalendarDayDoc>();
  for (const d of snap.docs) {
    const day = d.data() as CalendarDayDoc;
    map.set(day.date, day);
  }
  return map;
}

export async function isWorkingDay(date: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(getDb(), "academicCalendar"),
      where("date", "==", date),
      where("isWorkingDay", "==", true),
    ),
  );
  return !snap.empty;
}
