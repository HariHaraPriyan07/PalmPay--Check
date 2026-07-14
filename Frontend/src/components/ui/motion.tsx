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
      <div
        className={clsx(
          "glass-panel relative overflow-hidden rounded-card p-4 shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          tone === "good" && "hover:shadow-glow-success",
          tone === "bad" && "hover:shadow-glow-danger",
          tone === "warn" && "hover:shadow-glow-warn",
          tone === "default" && "hover:shadow-glow-cyan",
        )}
      >
        {/* Accent energy bar keyed to the stat's tone */}
        <span
          aria-hidden
          className={clsx(
            "absolute inset-x-0 top-0 h-0.5",
            tone === "default" && "bg-gradient-to-r from-cyan-400/0 via-cyan-400/70 to-violet-400/0",
            tone === "good" && "bg-gradient-to-r from-emerald-400/0 via-emerald-400/70 to-emerald-400/0",
            tone === "bad" && "bg-gradient-to-r from-rose-400/0 via-rose-400/70 to-rose-400/0",
            tone === "warn" && "bg-gradient-to-r from-amber-400/0 via-amber-400/70 to-amber-400/0",
          )}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-fg">{label}</p>
          {icon && <span className="text-muted-fg" aria-hidden>{icon}</span>}
        </div>
        <p
          className={clsx(
            "hud-readout mt-2 text-2xl font-semibold",
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
