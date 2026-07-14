"use client";

// Academic calendar manager (§7). POLICY: a date counts toward attendance %
// ONLY if it is explicitly marked as a working day here — so holidays and
// unmarked days can never reduce a student's percentage. Coordinator/HOD only
// (write access enforced by Firestore rules; advisors have read access).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { RequireRole } from "@/lib/firebase/auth-context";
import { AppShell } from "@/components/AppShell";
import { Alert, Button, Card, Input, PageHeader, Spinner } from "@/components/ui/primitives";
import { getCalendarMonth, setCalendarDay } from "@/lib/db/calendar";
import type { CalendarDayDoc } from "@/lib/types";

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function CalendarInner() {
  const [month, setMonth] = useState(() => new Date());
  const [days, setDays] = useState<Map<string, CalendarDayDoc>>(new Map());
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [working, setWorking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const yearMonth = ym(month);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDays(await getCalendarMonth(yearMonth));
    } catch (err) {
      setError(`Could not load calendar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [yearMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  const grid = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const leadingBlanks = (first.getDay() + 6) % 7; // Monday-first grid
    const cells: (string | null)[] = Array(leadingBlanks).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${yearMonth}-${String(d).padStart(2, "0")}`);
    }
    return cells;
  }, [month, yearMonth]);

  function select(date: string) {
    setSelected(date);
    const doc = days.get(date);
    setWorking(doc?.isWorkingDay ?? false);
    setReason(doc?.reason ?? "");
  }

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      const doc: CalendarDayDoc = {
        date: selected,
        isWorkingDay: working,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      };
      await setCalendarDay(doc);
      setDays((prev) => new Map(prev).set(selected, doc));
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Academic calendar"
        subtitle="Only dates marked as working days count toward attendance percentages. Holidays and unmarked days never count against students."
      />
      {error && (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <button
              aria-label="Previous month"
              className="cursor-pointer rounded-input p-2 text-body transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <h2 className="font-heading text-lg font-semibold text-foreground">
              {month.toLocaleString("en-IN", { month: "long", year: "numeric" })}
            </h2>
            <button
              aria-label="Next month"
              className="cursor-pointer rounded-input p-2 text-body transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-fg">
                {WEEKDAYS.map((w) => (
                  <div key={w} className="py-1">
                    {w}
                  </div>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {grid.map((date, i) =>
                  date === null ? (
                    <div key={`blank-${i}`} />
                  ) : (
                    <button
                      key={date}
                      onClick={() => select(date)}
                      aria-label={`${date}: ${
                        days.get(date)?.isWorkingDay
                          ? "working day"
                          : days.get(date)
                            ? `non-working (${days.get(date)?.reason ?? "holiday"})`
                            : "unmarked"
                      }`}
                      className={clsx(
                        "cursor-pointer rounded-input border p-2 text-left text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected === date && "ring-2 ring-ring",
                        days.get(date)?.isWorkingDay
                          ? "border-status-present-fg/30 bg-status-present-bg text-status-present-fg"
                          : days.get(date)
                            ? "border-status-absent-fg/20 bg-status-absent-bg text-status-absent-fg"
                            : "border-border-neutral bg-surface text-muted-fg hover:bg-muted",
                      )}
                    >
                      <span className="font-heading">{Number(date.slice(-2))}</span>
                      <span className="block truncate text-[10px] leading-tight">
                        {days.get(date)?.isWorkingDay
                          ? "Working"
                          : (days.get(date)?.reason ?? (days.get(date) ? "Holiday" : "—"))}
                      </span>
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-heading text-base font-semibold text-foreground">Edit day</h2>
          {!selected ? (
            <p className="text-sm text-muted-fg">Select a date on the calendar to edit it.</p>
          ) : (
            <div className="space-y-4">
              <p className="font-heading text-sm font-semibold text-foreground">{selected}</p>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-body">Day type</legend>
                <div className="space-y-2 text-sm text-body">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="daytype"
                      checked={working}
                      onChange={() => setWorking(true)}
                      className="cursor-pointer accent-[#22D3EE]"
                    />
                    Working day (counts toward attendance %)
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="daytype"
                      checked={!working}
                      onChange={() => setWorking(false)}
                      className="cursor-pointer accent-[#22D3EE]"
                    />
                    Non-working (holiday / exam / event)
                  </label>
                </div>
              </fieldset>
              <div>
                <label htmlFor="reason" className="mb-1.5 block text-sm font-medium text-body">
                  Reason {working ? "(optional)" : "(e.g. Pongal, Model exam)"}
                </label>
                <Input
                  id="reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Holiday name / note"
                />
              </div>
              <Button onClick={() => void save()} disabled={saving} className="w-full">
                {saving ? "Saving…" : "Save day"}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

export default function CalendarPage() {
  return (
    <RequireRole roles={["coordinator", "hod"]}>
      <AppShell>
        <CalendarInner />
      </AppShell>
    </RequireRole>
  );
}
