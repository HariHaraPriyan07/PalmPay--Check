"use client";

// Daily attendance (§6). Attendance is tied to the calendar DATE (normally
// taken before 1st hour, but allowed any time that working day — no clock
// lock). Present is only ever set by palm verification; everyone else gets
// Absent / OD / Others (reason required) from the dropdown.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanLine, Save, Search } from "lucide-react";
import { RequireRole, useAuth } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Select,
  Spinner,
  type BadgeTone,
} from "@/components/ui/primitives";
import { VerifyModal } from "@/components/attendance/VerifyModal";
import { listStudents } from "@/lib/db/students";
import { getSectionRecordsForDate, markAttendance } from "@/lib/db/attendance";
import { isWorkingDay } from "@/lib/db/calendar";
import { recomputeSectionSummaries } from "@/lib/db/summary";
import { todayStr } from "@/lib/config/app";
import type { AttendanceRecordDoc, AttendanceStatus, StudentDoc } from "@/lib/types";

const statusTone: Record<AttendanceStatus, BadgeTone> = {
  present: "present",
  absent: "absent",
  od: "od",
  others: "others",
};
const statusLabel: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  od: "OD",
  others: "Others",
};

function AttendanceInner() {
  const { user, section } = useAuth();
  const date = todayStr();

  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [records, setRecords] = useState<Map<string, AttendanceRecordDoc>>(new Map());
  const [workingDay, setWorkingDay] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [verifyTarget, setVerifyTarget] = useState<StudentDoc | null>(null);
  const [drafts, setDrafts] = useState<Map<string, { status: AttendanceStatus | ""; reason: string }>>(
    new Map(),
  );
  const [rowError, setRowError] = useState<Map<string, string>>(new Map());
  const [savingRows, setSavingRows] = useState<Set<string>>(new Set());
  const recomputeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const studentsRef = useRef<StudentDoc[]>([]);

  useEffect(() => {
    if (!section) return;
    (async () => {
      try {
        // Batched: one roster query + one records query + one calendar check (§6 concurrency).
        const [roster, recs, working] = await Promise.all([
          listStudents(section),
          getSectionRecordsForDate(section, date),
          isWorkingDay(date),
        ]);
        setStudents(roster);
        studentsRef.current = roster;
        setRecords(recs);
        setWorkingDay(working);
      } catch (err) {
        setLoadError(`Could not load the roster: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [section, date]);

  // Debounced summary recompute so a burst of ~60 sequential marks doesn't
  // trigger 60 recomputes (§6 concurrency note).
  const scheduleRecompute = useCallback(() => {
    if (!section) return;
    if (recomputeTimer.current) clearTimeout(recomputeTimer.current);
    recomputeTimer.current = setTimeout(() => {
      void recomputeSectionSummaries(section, studentsRef.current).catch((err) =>
        console.error("Summary recompute failed", err),
      );
    }, 4000);
  }, [section]);

  const onMarked = useCallback(
    (record: AttendanceRecordDoc) => {
      setRecords((prev) => new Map(prev).set(record.studentId, record));
      scheduleRecompute();
    },
    [scheduleRecompute],
  );

  async function saveManual(student: StudentDoc) {
    if (!user || !section) return;
    const draft = drafts.get(student.studentId);
    if (!draft || !draft.status) return;
    // 'Others' requires a reason BEFORE saving (§6.6, §14) — also enforced in Firestore rules.
    if (draft.status === "others" && draft.reason.trim().length === 0) {
      setRowError((prev) =>
        new Map(prev).set(student.studentId, "A reason is required for status 'Others'."),
      );
      return;
    }
    setRowError((prev) => {
      const m = new Map(prev);
      m.delete(student.studentId);
      return m;
    });
    setSavingRows((prev) => new Set(prev).add(student.studentId));
    const record: AttendanceRecordDoc = {
      studentId: student.studentId,
      sectionId: section,
      date,
      status: draft.status,
      ...(draft.status === "others" ? { reason: draft.reason.trim() } : {}),
      markedBy: user.uid,
      method: "manual",
      timestamp: Date.now(),
    };
    try {
      await markAttendance(record); // doc id = date_studentId → duplicate-proof; overwrite = same-day correction
      onMarked(record);
      setDrafts((prev) => {
        const m = new Map(prev);
        m.delete(student.studentId);
        return m;
      });
    } catch (err) {
      setRowError((prev) =>
        new Map(prev).set(
          student.studentId,
          `Save failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    } finally {
      setSavingRows((prev) => {
        const s = new Set(prev);
        s.delete(student.studentId);
        return s;
      });
    }
  }

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q),
    );
  }, [students, filter]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, od: 0, others: 0, unmarked: 0 };
    for (const s of students) {
      const r = records.get(s.studentId);
      if (!r) c.unmarked++;
      else c[r.status]++;
    }
    return c;
  }, [students, records]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Take attendance"
        subtitle={`Section ${section} · ${date} · ${counts.present} present / ${counts.absent} absent / ${counts.od} OD / ${counts.others} others / ${counts.unmarked} unmarked`}
      />

      {loadError && (
        <div className="mb-4">
          <Alert tone="error">{loadError}</Alert>
        </div>
      )}

      {workingDay === false && (
        <div className="mb-4">
          <Alert tone="warn">
            {date} is not marked as a working day in the academic calendar, so attendance cannot be
            taken today and no student&apos;s percentage is affected. If this is wrong, ask the CSE
            coordinator to update the calendar.
          </Alert>
        </div>
      )}

      <Card dense>
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
          <Input
            aria-label="Filter students by name or roll number"
            placeholder="Filter by name or roll number…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-sm py-2 text-sm"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-neutral text-left text-xs uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-medium">Roll no</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Palm verify</th>
                <th className="px-3 py-2 font-medium">Manual status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const rec = records.get(s.studentId);
                const draft = drafts.get(s.studentId) ?? { status: "" as const, reason: "" };
                const err = rowError.get(s.studentId);
                const saving = savingRows.has(s.studentId);
                const disabled = workingDay === false;
                return (
                  <tr
                    key={s.studentId}
                    className="border-b border-border-neutral/60 transition-colors duration-150 hover:bg-status-others-bg"
                  >
                    <td className="px-3 py-2 font-heading">{s.studentId}</td>
                    <td className="px-3 py-2 text-body">{s.name}</td>
                    <td className="px-3 py-2">
                      {rec ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge tone={statusTone[rec.status]}>
                            {statusLabel[rec.status]}
                            {rec.method === "palm" ? " · palm" : ""}
                          </Badge>
                          {rec.method === "palm" && rec.similarityScore !== undefined && (
                            <span className="text-xs text-muted-fg">
                              sim {rec.similarityScore.toFixed(3)}
                            </span>
                          )}
                          {rec.status === "others" && rec.reason && (
                            <span className="text-xs text-muted-fg">“{rec.reason}”</span>
                          )}
                        </div>
                      ) : (
                        <Badge tone="others">Unmarked</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Button
                        variant="secondary"
                        className="px-3 py-1.5 text-xs"
                        disabled={disabled || s.enrollmentStatus !== "enrolled"}
                        title={
                          s.enrollmentStatus !== "enrolled"
                            ? "Student has no palm template — enroll first"
                            : undefined
                        }
                        onClick={() => setVerifyTarget(s)}
                      >
                        <ScanLine className="h-3.5 w-3.5" aria-hidden />
                        {rec?.status === "present" ? "Re-verify" : "Verify"}
                      </Button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={`Manual status for ${s.name}`}
                          className="w-28"
                          disabled={disabled}
                          value={draft.status}
                          onChange={(e) =>
                            setDrafts((prev) =>
                              new Map(prev).set(s.studentId, {
                                status: e.target.value as AttendanceStatus | "",
                                reason: draft.reason,
                              }),
                            )
                          }
                        >
                          <option value="">— set —</option>
                          <option value="absent">Absent</option>
                          <option value="od">OD</option>
                          <option value="others">Others</option>
                        </Select>
                        {draft.status === "others" && (
                          <Input
                            aria-label={`Reason for ${s.name}`}
                            placeholder="Reason (required)"
                            required
                            className="w-44 py-2 text-sm"
                            value={draft.reason}
                            onChange={(e) =>
                              setDrafts((prev) =>
                                new Map(prev).set(s.studentId, {
                                  status: draft.status,
                                  reason: e.target.value,
                                }),
                              )
                            }
                          />
                        )}
                        {draft.status && (
                          <Button
                            className="px-3 py-1.5 text-xs"
                            disabled={
                              saving ||
                              disabled ||
                              (draft.status === "others" && draft.reason.trim().length === 0)
                            }
                            onClick={() => void saveManual(s)}
                          >
                            <Save className="h-3.5 w-3.5" aria-hidden />
                            {saving ? "Saving…" : "Save"}
                          </Button>
                        )}
                      </div>
                      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-muted-fg">
                    No students match the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {verifyTarget && user && (
        <VerifyModal
          student={verifyTarget}
          advisorUid={user.uid}
          open={verifyTarget !== null}
          onClose={() => setVerifyTarget(null)}
          onMarked={onMarked}
        />
      )}
    </>
  );
}

export default function AttendancePage() {
  return (
    <RequireRole roles={["advisor"]}>
      <AppShell>
        <AttendanceInner />
      </AppShell>
    </RequireRole>
  );
}
