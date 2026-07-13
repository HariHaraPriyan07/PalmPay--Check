"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, Hand, LayoutDashboard, LogOut, ScanLine, UserPlus } from "lucide-react";
import clsx from "clsx";
import { useEffect } from "react";
import { useAuth } from "@/lib/firebase/auth-context";
import { getHandLandmarker } from "@/lib/capture/handLandmarker";
import { getEmbeddingProvider } from "@/lib/ml/embeddingProvider";
import type { ReactNode } from "react";

const advisorNav = [
  { href: "/advisor", label: "Dashboard", icon: LayoutDashboard },
  { href: "/advisor/attendance", label: "Take attendance", icon: ScanLine },
  { href: "/advisor/enroll", label: "Enrollment", icon: UserPlus },
];
const staffNav = [
  { href: "/overview", label: "Department overview", icon: LayoutDashboard },
  { href: "/calendar", label: "Academic calendar", icon: CalendarDays },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { role, section, profile, user, signOut } = useAuth();
  const pathname = usePathname();
  const nav = role === "advisor" ? advisorNav : staffNav;

  const roleLabel =
    role === "advisor"
      ? `Class Advisor — Section ${section ?? "?"}`
      : role === "coordinator"
        ? "CSE Coordinator"
        : role === "hod"
          ? "HOD — CSE"
          : "";

  // Warm the palm detector + embedding provider as soon as an advisor's
  // session starts, not when they first open enroll/verify — both are
  // multi-MB first-load fetches (detector from CDN), and §11 requires daily
  // 1:1 matching to feel instant once the advisor is ready to scan.
  useEffect(() => {
    if (role !== "advisor") return;
    void getHandLandmarker().catch(() => {
      /* capture UI surfaces load failures itself when actually used */
    });
    void getEmbeddingProvider().catch(() => {});
  }, [role]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-surface shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-input bg-primary text-on-primary">
              <Hand className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="font-heading text-sm font-semibold leading-tight text-foreground">
                CIT Palm Attendance
              </p>
              <p className="text-xs text-muted-fg">CSE · 3rd Year</p>
            </div>
          </div>
          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {nav.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={clsx(
                  "flex cursor-pointer items-center gap-2 rounded-input px-3 py-2 text-sm font-medium transition-colors duration-200",
                  pathname === href
                    ? "bg-muted text-primary"
                    : "text-body hover:bg-muted hover:text-primary",
                )}
                aria-current={pathname === href ? "page" : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-body">{profile?.name ?? user?.email}</p>
              <p className="text-xs text-muted-fg">{roleLabel}</p>
            </div>
            <button
              onClick={() => void signOut()}
              className="flex cursor-pointer items-center gap-1.5 rounded-input border border-border-neutral px-3 py-2 text-sm text-body transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        {/* Mobile nav */}
        <nav aria-label="Primary mobile" className="flex gap-1 overflow-x-auto px-4 pb-2 md:hidden">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-input px-3 py-1.5 text-sm transition-colors duration-200",
                pathname === href ? "bg-muted text-primary" : "text-body hover:bg-muted",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
