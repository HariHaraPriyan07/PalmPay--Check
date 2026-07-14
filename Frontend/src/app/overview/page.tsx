"use client";

// Coordinator / HOD roll-up (§10): all 17 sections — enrollment coverage,
// today's marking, average %, below-85 department-wide, CSV export.
// Both roles get identical full read access (§3); embeddings stay off-limits.

import { useEffect, useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { RequireRole } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/AppShell";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";
import { StatCard } from "@/components/ui/motion";
import { listAllStudents } from "@/lib/db/students";
import { getAllRecordsForDate } from "@/lib/db/attendance";
import { getAllSummaries } from "@/lib/db/summaries-read";
import { ATTENDANCE_THRESHOLD_PERCENT, SECTIONS, todayStr } from "@/lib/config/app";
import type { AttendanceRecordDoc, AttendanceSummaryDoc, StudentDoc } from "@/lib/types";

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function OverviewInner() {
  const date = todayStr();
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [summaries, setSummaries] = useState<AttendanceSummaryDoc[]>([]);
  const [todayRecords, setTodayRecords] = useState<AttendanceRecordDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [studs, sums, recs] = await Promise.all([
          listAllStudents(),
          getAllSummaries(),
          getAllRecordsForDate(date),
        ]);
        setStudents(studs);
        setSummaries(sums);
        setTodayRecords(recs);
      } catch (err) {
        setError(`Could not load overview: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [date]);

  const bySection = useMemo(() => {
    const nameOf = new Map(students.map((s) => [s.studentId, s.name]));
    const sumBy = new Map<string, AttendanceSummaryDoc[]>();
    for (const s of summaries) {
      const arr = sumBy.get(s.sectionId) ?? [];
      arr.push(s);
      sumBy.set(s.sectionId, arr);
    }
    const recBy = new Map<string, AttendanceRecordDoc[]>();
    for (const r of todayRecords) {
      const arr = recBy.get(r.sectionId) ?? [];
      arr.push(r);
      recBy.set(r.sectionId, arr);
    }
    const rows = SECTIONS.map((sec) => {
      const studs = students.filter((s) => s.sectionId === sec);
      const enrolled = studs.filter((s) => s.enrollmentStatus === "enrolled").length;
      const sums = sumBy.get(sec) ?? [];
      const recs = recBy.get(sec) ?? [];
      const presentToday = recs.filter((r) => r.status === "present").length;
      const avgPct =
        sums.length > 0 ? sums.reduce((a, b) => a + b.percentage, 0) / sums.length : null;
      const below = sums.filter((s) => s.belowThreshold).length;
      return {
        section: sec,
        total: studs.length,
        enrolled,
        markedToday: recs.length,
        presentToday,
        avgPct,
        below,
      };
    });
    const belowStudents = summaries
      .filter((s) => s.belowThreshold)
      .sort((a, b) => a.percentage - b.percentage)
      .map((s) => ({ ...s, name: nameOf.get(s.studentId) ?? s.studentId }));
    return { rows, belowStudents };
  }, [students, summaries, todayRecords]);

  const filteredBelow = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return bySection.belowStudents;
    return bySection.belowStudents.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.studentId.toLowerCase().includes(q) ||
        s.sectionId.toLowerCase() === q,
    );
  }, [bySection.belowStudents, filter]);

  const totals = useMemo(() => {
    const total = students.length;
    const enrolled = students.filter((s) => s.enrollmentStatus === "enrolled").length;
    const presentToday = todayRecords.filter((r) => r.status === "present").length;
    return { total, enrolled, presentToday, below: bySection.belowStudents.length };
  }, [students, todayRecords, bySection.belowStudents]);

  function exportSections() {
    downloadCsv(`cse3-sections-${date}.csv`, [
      ["Section", "Students", "Enrolled", "Marked today", "Present today", "Avg %", `Below ${ATTENDANCE_THRESHOLD_PERCENT}%`],
      ...bySection.rows.map((r) => [
        r.section,
        r.total,
        r.enrolled,
        r.markedToday,
        r.presentToday,
        r.avgPct === null ? "-" : r.avgPct.toFixed(2),
        r.below,
      ]),
    ]);
  }

  function exportBelow() {
    downloadCsv(`cse3-below-${ATTENDANCE_THRESHOLD_PERCENT}pct-${date}.csv`, [
      ["Section", "Roll no", "Name", "Present", "Working days", "Percentage"],
      ...bySection.belowStudents.map((s) => [
        s.sectionId,
        s.studentId,
        s.name,
        s.presentCount,
        s.workingDaysSoFar,
        s.percentage.toFixed(2),
      ]),
    ]);
  }

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
        title="CSE 3rd year — department overview"
        subtitle={`${date} · Sections A–Q (${SECTIONS.length} sections)`}
        actions={
          <Button variant="secondary" onClick={exportSections}>
            <Download className="h-4 w-4" aria-hidden /> Export sections CSV
          </Button>
        }
      />
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Students" value={totals.total} hint="Across all sections" />
        <StatCard
          label="Enrolled palms"
          value={`${totals.enrolled}/${totals.total}`}
          tone={totals.enrolled === totals.total && totals.total > 0 ? "good" : "warn"}
          hint="Department enrollment coverage"
          delay={0.05}
        />
        <StatCard label="Present today" value={totals.presentToday} delay={0.1} />
        <StatCard
          label={`Below ${ATTENDANCE_THRESHOLD_PERCENT}%`}
          value={totals.below}
          tone={totals.below > 0 ? "bad" : "good"}
          hint="Department-wide"
          delay={0.15}
        />
      </div>

      <Card dense className="mt-6">
        <h2 className="mb-3 font-heading text-base font-semibold text-foreground">
          Section roll-up
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-neutral text-left text-xs uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-medium">Section</th>
                <th className="px-3 py-2 font-medium">Students</th>
                <th className="px-3 py-2 font-medium">Enrolled</th>
                <th className="px-3 py-2 font-medium">Marked today</th>
                <th className="px-3 py-2 font-medium">Present today</th>
                <th className="px-3 py-2 font-medium">Avg %</th>
                <th className="px-3 py-2 font-medium">Below {ATTENDANCE_THRESHOLD_PERCENT}%</th>
              </tr>
            </thead>
            <tbody>
              {bySection.rows.map((r) => (
                <tr
                  key={r.section}
                  className="border-b border-border-neutral/60 transition-colors duration-150 hover:bg-status-others-bg"
                >
                  <td className="px-3 py-2 font-heading font-semibold text-foreground">{r.section}</td>
                  <td className="px-3 py-2">{r.total}</td>
                  <td className="px-3 py-2">
                    {r.total > 0 ? (
                      <span className={r.enrolled === r.total ? "text-status-present-fg" : ""}>
                        {r.enrolled}/{r.total}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">{r.markedToday}</td>
                  <td className="px-3 py-2">{r.presentToday}</td>
                  <td className="px-3 py-2 font-heading">
                    {r.avgPct === null ? "—" : `${r.avgPct.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2">
                    {r.below > 0 ? <Badge tone="absent">{r.below}</Badge> : <span>0</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card dense className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-base font-semibold text-foreground">
            Students below {ATTENDANCE_THRESHOLD_PERCENT}% — department-wide
          </h2>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
            <Input
              aria-label="Filter below-threshold students"
              placeholder="Filter by name, roll, or section…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-64 py-2 text-sm"
            />
            <Button variant="secondary" className="px-3 py-2 text-xs" onClick={exportBelow}>
              <Download className="h-3.5 w-3.5" aria-hidden /> CSV
            </Button>
          </div>
        </div>
        {filteredBelow.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-fg">
            No students below the threshold{filter ? " match the filter" : ""}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-neutral text-left text-xs uppercase tracking-wide text-muted-fg">
                  <th className="px-3 py-2 font-medium">Section</th>
                  <th className="px-3 py-2 font-medium">Roll no</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Present</th>
                  <th className="px-3 py-2 font-medium">Working days</th>
                  <th className="px-3 py-2 font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {filteredBelow.map((s) => (
                  <tr
                    key={s.studentId}
                    className="border-b border-border-neutral/60 transition-colors duration-150 hover:bg-status-others-bg"
                  >
                    <td className="px-3 py-2 font-heading">{s.sectionId}</td>
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
    </>
  );
}

export default function OverviewPage() {
  return (
    <RequireRole roles={["coordinator", "hod"]}>
      <AppShell>
        <OverviewInner />
      </AppShell>
    </RequireRole>
  );
}
