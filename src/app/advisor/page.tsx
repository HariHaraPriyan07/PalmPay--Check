"use client";

// Advisor dashboard (§10): today's status, running %, below-85% list,
// enrollment progress, links to take/correct attendance and enroll.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCcw, ScanLine, UserPlus } from "lucide-react";
import { RequireRole, useAuth } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/AppShell";
import { Alert, Badge, Button, Card, PageHeader, Spinner } from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/motion";
import { listStudents } from "@/lib/db/students";
import { getSectionRecordsForDate } from "@/lib/db/attendance";
import { getSectionSummaries } from "@/lib/db/summaries-read";
import { recomputeSectionSummaries } from "@/lib/db/summary";
import { ATTENDANCE_THRESHOLD_PERCENT, todayStr } from "@/lib/config/app";
import type { AttendanceRecordDoc, AttendanceSummaryDoc, StudentDoc } from "@/lib/types";

function AdvisorDashboardInner() {
  const { section } = useAuth();
  const date = todayStr();
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [records, setRecords] = useState<Map<string, AttendanceRecordDoc>>(new Map());
  const [summaries, setSummaries] = useState<AttendanceSummaryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!section) return;
    try {
      const [roster, recs, sums] = await Promise.all([
        listStudents(section),
        getSectionRecordsForDate(section, date),
        getSectionSummaries(section),
      ]);
      setStudents(roster);
      setRecords(recs);
      setSummaries(sums);
    } catch (err) {
      setError(`Could not load dashboard: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [section, date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function recompute() {
    if (!section) return;
    setRecomputing(true);
    try {
      const updated = await recomputeSectionSummaries(section, students);
      setSummaries(updated);
    } catch (err) {
      setError(`Recompute failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRecomputing(false);
    }
  }

  const stats = useMemo(() => {
    const enrolled = students.filter((s) => s.enrollmentStatus === "enrolled").length;
    let present = 0;
    let marked = 0;
    for (const s of students) {
      const r = records.get(s.studentId);
      if (r) {
        marked++;
        if (r.status === "present") present++;
      }
    }
    const nameOf = new Map(students.map((s) => [s.studentId, s.name]));
    const below = summaries
      .filter((x) => x.belowThreshold)
      .sort((a, b) => a.percentage - b.percentage)
      .map((x) => ({ ...x, name: nameOf.get(x.studentId) ?? x.studentId }));
    return { enrolled, present, marked, below };
  }, [students, records, summaries]);

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
        title={`Section ${section} — dashboard`}
        subtitle={`${date} · CSE 3rd year`}
        actions={
          <>
            <Button variant="secondary" onClick={() => void recompute()} disabled={recomputing}>
              <RefreshCcw className="h-4 w-4" aria-hidden />
              {recomputing ? "Recalculating…" : "Recalculate %"}
            </Button>
            <Link href="/advisor/attendance">
              <Button>
                <ScanLine className="h-4 w-4" aria-hidden /> Take attendance
              </Button>
            </Link>
          </>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Students" value={students.length} hint={`Section ${section}`} />
        <StatCard
          label="Enrolled palms"
          value={`${stats.enrolled}/${students.length}`}
          tone={stats.enrolled === students.length ? "good" : "warn"}
          hint="Enrollment coverage"
          delay={0.05}
        />
        <StatCard
          label="Marked today"
          value={`${stats.marked}/${students.length}`}
          hint={`${stats.present} present`}
          delay={0.1}
        />
        <StatCard
          label={`Below ${ATTENDANCE_THRESHOLD_PERCENT}%`}
          value={stats.below.length}
          tone={stats.below.length > 0 ? "bad" : "good"}
          hint="Students at risk"
          delay={0.15}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-warn-fg" aria-hidden />
            <h2 className="font-heading text-base font-semibold text-foreground">
              Below {ATTENDANCE_THRESHOLD_PERCENT}% attendance
            </h2>
          </div>
          {stats.below.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-fg">
              No student is below the threshold. If percentages look stale, use “Recalculate %”.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-neutral text-left text-xs uppercase tracking-wide text-muted-fg">
                    <th className="px-3 py-2 font-medium">Roll no</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Present</th>
                    <th className="px-3 py-2 font-medium">Working days</th>
                    <th className="px-3 py-2 font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.below.map((s) => (
                    <tr
                      key={s.studentId}
                      className="border-b border-border-neutral/60 transition-colors duration-150 hover:bg-status-others-bg"
                    >
                      <td className="px-3 py-2 font-heading">{s.studentId}</td>
                      <td className="px-3 py-2 text-body">{s.name}</td>
                      <td className="px-3 py-2">{s.presentCount}</td>
                      <td className="px-3 py-2">{s.workingDaysSoFar}</td>
                      <td className="px-3 py-2">
                        <Badge tone="absent">{s.percentage.toFixed(1)}%</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">Quick actions</h2>
          <div className="space-y-2">
            <Link
              href="/advisor/attendance"
              className="flex cursor-pointer items-center justify-between rounded-input bg-muted px-4 py-3 text-sm font-medium text-body transition-colors duration-200 hover:bg-border"
            >
              <span className="flex items-center gap-2">
                <ScanLine className="h-4 w-4 text-primary" aria-hidden /> Take / correct today&apos;s
                attendance
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/advisor/enroll"
              className="flex cursor-pointer items-center justify-between rounded-input bg-muted px-4 py-3 text-sm font-medium text-body transition-colors duration-200 hover:bg-border"
            >
              <span className="flex items-center gap-2">
                <UserPlus className="h-4 w-4 text-primary" aria-hidden /> Enroll student palms
              </span>
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-fg">
            Attendance % counts only academic-calendar working days. OD marks count as present per
            department policy (configurable in <span className="font-heading">config/app.ts</span>).
          </p>
        </Card>
      </div>
    </>
  );
}

export default function AdvisorDashboard() {
  return (
    <RequireRole roles={["advisor"]}>
      <AppShell>
        <AdvisorDashboardInner />
      </AppShell>
    </RequireRole>
  );
}
