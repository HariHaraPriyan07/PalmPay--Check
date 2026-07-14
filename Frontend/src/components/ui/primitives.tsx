"use client";

// UI kit — Theme v2 "Aurora Biometric" (design-system/MASTER.md).
// Glass surfaces, neon glow accents, monospaced HUD readouts. Every visual
// value traces to the tokens in tailwind.config.ts / globals.css.

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import clsx from "clsx";

// ── Buttons ──────────────────────────────────────────────────────────────────
type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function Button({ variant = "primary", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-input px-6 py-3 text-sm font-semibold transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none",
        variant === "primary" &&
          "bg-gradient-to-r from-cyan-400 to-sky-500 text-on-primary shadow-glow-cyan hover:brightness-110 hover:-translate-y-px motion-reduce:hover:translate-y-0",
        variant === "secondary" &&
          "border border-primary/50 bg-primary/5 text-primary hover:border-primary hover:bg-primary/10 hover:shadow-glow-cyan",
        variant === "ghost" && "text-primary hover:bg-muted",
        variant === "destructive" &&
          "bg-gradient-to-r from-rose-500 to-red-500 text-white shadow-glow-danger hover:brightness-110",
        className,
      )}
      {...props}
    />
  );
});

// ── Card ─────────────────────────────────────────────────────────────────────
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
        "glass-panel rounded-card shadow-md transition-all duration-200 hover:border-primary/25 hover:shadow-lg motion-reduce:transition-none",
        dense ? "p-4" : "p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={clsx(
          "w-full rounded-input border border-border-neutral bg-surface/80 px-4 py-3 text-base text-foreground transition-all duration-200 placeholder:text-muted-fg focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20 focus:shadow-glow-cyan motion-reduce:transition-none",
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
          "w-full cursor-pointer rounded-input border border-border-neutral bg-surface px-3 py-2 text-sm text-foreground transition-colors duration-200 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20 motion-reduce:transition-none",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

// ── Status badge (semantic tokens) ───────────────────────────────────────────
export type BadgeTone = "present" | "absent" | "od" | "others" | "warn";

const badgeTones: Record<BadgeTone, string> = {
  present: "bg-status-present-bg text-status-present-fg ring-1 ring-inset ring-status-present-fg/25",
  absent: "bg-status-absent-bg text-status-absent-fg ring-1 ring-inset ring-status-absent-fg/25",
  od: "bg-status-od-bg text-status-od-fg ring-1 ring-inset ring-status-od-fg/25",
  others: "bg-status-others-bg text-status-others-fg ring-1 ring-inset ring-status-others-fg/25",
  warn: "bg-status-warn-bg text-status-warn-fg ring-1 ring-inset ring-status-warn-fg/25",
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
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
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
    error: "bg-status-absent-bg text-status-absent-fg ring-1 ring-inset ring-status-absent-fg/25",
    warn: "bg-status-warn-bg text-status-warn-fg ring-1 ring-inset ring-status-warn-fg/25",
    info: "bg-status-od-bg text-status-od-fg ring-1 ring-inset ring-status-od-fg/25",
    success:
      "bg-status-present-bg text-status-present-fg ring-1 ring-inset ring-status-present-fg/25",
  };
  return (
    <div role="alert" className={clsx("rounded-input px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}
