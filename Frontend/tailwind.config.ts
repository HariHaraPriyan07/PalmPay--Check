import type { Config } from "tailwindcss";

/**
 * Theme v2 — "Aurora Biometric" (design-system/MASTER.md §Theme-v2).
 * A dark, holographic HUD theme built around the palm-scanning experience:
 * deep space-navy canvas, cyan/violet aurora accents, glass surfaces and
 * neon glow shadows. MASTER.md remains the single source of truth.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#22D3EE",
        "on-primary": "#04121A",
        secondary: "#818CF8",
        accent: "#A78BFA",
        background: "#05080F",
        surface: "#0B1220",
        "surface-raised": "#111A2E",
        foreground: "#F1F5F9",
        body: "#B6C2D9",
        muted: "#16203A",
        "muted-fg": "#7C8DB0",
        border: "#1E2A45",
        "border-neutral": "#233052",
        destructive: "#F87171",
        ring: "#22D3EE",
        // Semantic status tokens (dark variants)
        status: {
          "present-fg": "#4ADE80",
          "present-bg": "#0D2A1D",
          "absent-fg": "#F87171",
          "absent-bg": "#2E1216",
          "od-fg": "#93C5FD",
          "od-bg": "#12213D",
          "others-fg": "#A5B4CD",
          "others-bg": "#182238",
          "warn-fg": "#FBBF24",
          "warn-bg": "#2A2110",
        },
      },
      fontFamily: {
        heading: ["'Space Grotesk'", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["'Inter'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.4)",
        md: "0 6px 16px rgba(0,0,0,0.45)",
        lg: "0 14px 34px rgba(0,0,0,0.5)",
        xl: "0 24px 60px rgba(0,0,0,0.6)",
        "glow-cyan": "0 0 24px rgba(34,211,238,0.35), 0 0 64px rgba(34,211,238,0.12)",
        "glow-violet": "0 0 24px rgba(167,139,250,0.35), 0 0 64px rgba(167,139,250,0.12)",
        "glow-success": "0 0 28px rgba(74,222,128,0.35), 0 0 72px rgba(74,222,128,0.14)",
        "glow-danger": "0 0 28px rgba(248,113,113,0.35), 0 0 72px rgba(248,113,113,0.14)",
        "glow-warn": "0 0 28px rgba(251,191,36,0.3), 0 0 72px rgba(251,191,36,0.12)",
      },
      borderRadius: {
        input: "10px",
        card: "16px",
        modal: "20px",
      },
      keyframes: {
        "scan-line": {
          "0%": { top: "0%", opacity: "0" },
          "8%": { opacity: "1" },
          "92%": { opacity: "1" },
          "100%": { top: "100%", opacity: "0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.8" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        floaty: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        "hud-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "scan-line": "scan-line 2.6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.2,0.6,0.4,1) infinite",
        shimmer: "shimmer 2.4s linear infinite",
        floaty: "floaty 5s ease-in-out infinite",
        "hud-blink": "hud-blink 1.4s steps(1) infinite",
      },
    },
  },
  plugins: [],
};
export default config;
