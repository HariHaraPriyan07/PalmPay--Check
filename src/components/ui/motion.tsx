"use client";

// Aether-UI-style animated pieces (fade-in sections, stat cards), rebuilt on
// Framer Motion and conformed to MASTER tokens. Animations are subtle
// (fade/short slide only) and fully disabled under prefers-reduced-motion.

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import clsx from "clsx";

export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
  delay = 0,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "good" | "bad" | "warn";
  icon?: ReactNode;
  delay?: number;
}) {
  return (
    <FadeIn delay={delay}>
      <div className="rounded-card bg-surface p-4 shadow-sm transition-shadow duration-200 hover:shadow-md motion-reduce:transition-none">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">{label}</p>
          {icon && <span className="text-muted-fg" aria-hidden>{icon}</span>}
        </div>
        <p
          className={clsx(
            "mt-2 font-heading text-2xl font-semibold",
            tone === "default" && "text-foreground",
            tone === "good" && "text-status-present-fg",
            tone === "bad" && "text-status-absent-fg",
            tone === "warn" && "text-status-warn-fg",
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted-fg">{hint}</p>}
      </div>
    </FadeIn>
  );
}
