"use client";

// Enrollment management (§5.5): per-student status list (enrolled / not yet /
// failed) so no student is missed, with per-student enroll/re-enroll actions.

import { useEffect, useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { RequireRole, useAuth } from "@/lib/firebase/auth-context";
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
import { EnrollModal } from "@/components/enroll/EnrollModal";
import { listStudents } from "@/lib/db/students";
import type { StudentDoc } from "@/lib/types";

function EnrollInner() {
  const { section } = useAuth();
  const [students, setStudents] = useState<StudentDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState<StudentDoc | null>(null);

  useEffect(() => {
    if (!section) return;
    listStudents(section)
      .then(setStudents)
      .catch((err) =>
        setLoadError(`Could not load students: ${err instanceof Error ? err.message : String(err)}`),
      )
      .finally(() => setLoading(false));
  }, [section]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) => s.name.toLowerCase().includes(q) || s.studentId.toLowerCase().includes(q),
    );
  }, [students, filter]);

  const enrolled = students.filter((s) => s.enrollmentStatus === "enrolled").length;
  const failed = students.filter((s) => s.enrollmentStatus === "failed").length;
  const pending = students.length - enrolled - failed;

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
        title="Palm enrollment"
        subtitle={`Section ${section} · ${enrolled} enrolled · ${pending} not yet · ${failed} failed`}
      />
      {loadError && (
        <div className="mb-4">
          <Alert tone="error">{loadError}</Alert>
        </div>
      )}

      <Card dense className="mb-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-body">
            Enrollment coverage:{" "}
            <span className="font-heading font-semibold text-foreground">
              {students.length > 0 ? Math.round((enrolled / students.length) * 100) : 0}%
            </span>
          </p>
          <div className="h-2 w-48 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full bg-status-present-fg transition-all duration-300 motion-reduce:transition-none"
              style={{
                width: `${students.length > 0 ? (enrolled / students.length) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </Card>

      <Card dense>
        <div className="mb-3 flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-muted-fg" aria-hidden />
          <Input
            aria-label="Filter students"
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
                <th className="px-3 py-2 font-medium">Consent</th>
                <th className="px-3 py-2 font-medium">Enrollment</th>
                <th className="px-3 py-2 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.studentId}
                  className="border-b border-border-neutral/60 transition-colors duration-150 hover:bg-status-others-bg"
                >
                  <td className="px-3 py-2 font-heading">{s.studentId}</td>
                  <td className="px-3 py-2 text-body">{s.name}</td>
                  <td className="px-3 py-2">
                    {s.consentGiven ? (
                      <Badge tone="present">Given</Badge>
                    ) : (
                      <Badge tone="others">Not recorded</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {s.enrollmentStatus === "enrolled" ? (
                      <Badge tone="present">Enrolled</Badge>
                    ) : s.enrollmentStatus === "failed" ? (
                      <Badge tone="absent">Failed</Badge>
                    ) : (
                      <Badge tone="warn">Not yet</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => setTarget(s)}
                    >
                      <UserPlus className="h-3.5 w-3.5" aria-hidden />
                      {s.enrollmentStatus === "enrolled" ? "Re-enroll" : "Enroll"}
                    </Button>
                  </td>
                </tr>
              ))}
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

      {target && (
        <EnrollModal
          key={target.studentId}
          student={target}
          open={target !== null}
          onClose={() => setTarget(null)}
          onStatusChange={(studentId, status, consent) =>
            setStudents((prev) =>
              prev.map((s) =>
                s.studentId === studentId
                  ? {
                      ...s,
                      enrollmentStatus: status,
                      ...(consent !== undefined
                        ? { consentGiven: consent, consentTimestamp: Date.now() }
                        : {}),
                    }
                  : s,
              ),
            )
          }
        />
      )}
    </>
  );
}

export default function EnrollPage() {
  return (
    <RequireRole roles={["advisor"]}>
      <AppShell>
        <EnrollInner />
      </AppShell>
    </RequireRole>
  );
}
