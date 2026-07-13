"use client";

// UI kit — every visual value here traces to design-system/MASTER.md.
// Functional shapes (table/form/modal patterns) originated from 21st.dev
// generations and were restyled to MASTER tokens (MASTER.md is the authority).

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import clsx from "clsx";

// ── Buttons (MASTER §5) ──────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = "primary", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-input px-6 py-3 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
        variant === "primary" &&
          "bg-accent text-on-primary hover:opacity-90 hover:-translate-y-px motion-reduce:hover:translate-y-0",
        variant === "secondary" &&
          "border-2 border-primary bg-transparent text-primary hover:bg-primary/5",
        variant === "ghost" && "text-primary hover:bg-muted",
        variant === "destructive" && "bg-destructive text-white hover:opacity-90",
        className,
      )}
      {...props}
    />
  );
});

// ── Card (MASTER §5) ─────────────────────────────────────────────────────────
export function Card({
  className,
  children,
  dense = false,
}: {
  className?: string;
  children: ReactNode;
  dense?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-card bg-surface shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none",
        dense ? "p-4" : "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Inputs (MASTER §5) ───────────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          "w-full rounded-input border border-border-neutral bg-surface px-4 py-3 text-base text-body transition-colors duration-200 placeholder:text-muted-fg focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 motion-reduce:transition-none",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={clsx(
          "w-full cursor-pointer rounded-input border border-border-neutral bg-surface px-3 py-2 text-sm text-body transition-colors duration-200 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

// ── Status badge (MASTER §1 semantic tokens) ─────────────────────────────────
export type BadgeTone = "present" | "absent" | "od" | "others" | "warn";

const badgeTones: Record<BadgeTone, string> = {
  present: "bg-status-present-bg text-status-present-fg",
  absent: "bg-status-absent-bg text-status-absent-fg",
  od: "bg-status-od-bg text-status-od-fg",
  others: "bg-status-others-bg text-status-others-fg",
  warn: "bg-status-warn-bg text-status-warn-fg",
};

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  );
}

// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={clsx(
        "h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none",
        className,
      )}
    />
  );
}

// ── Page header ──────────────────────────────────────────────────────────────
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-fg">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

// ── Alert banner ─────────────────────────────────────────────────────────────
export function Alert({
  tone,
  children,
}: {
  tone: "error" | "warn" | "info" | "success";
  children: ReactNode;
}) {
  const tones = {
    error: "bg-status-absent-bg text-status-absent-fg",
    warn: "bg-status-warn-bg text-status-warn-fg",
    info: "bg-status-od-bg text-status-od-fg",
    success: "bg-status-present-bg text-status-present-fg",
  };
  return (
    <div role="alert" className={clsx("rounded-input px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}
