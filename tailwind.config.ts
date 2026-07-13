import type { Config } from "tailwindcss";

/**
 * Token values come from design-system/MASTER.md (UI UX Pro Max output).
 * MASTER.md is the single source of truth — do not add colors that are not in it.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#1E40AF",
        "on-primary": "#FFFFFF",
        secondary: "#3B82F6",
        accent: "#D97706",
        background: "#F8FAFC",
        surface: "#FFFFFF",
        foreground: "#1E3A8A",
        body: "#334155",
        muted: "#E9EEF6",
        "muted-fg": "#64748B",
        border: "#DBEAFE",
        "border-neutral": "#E2E8F0",
        destructive: "#DC2626",
        ring: "#1E40AF",
        // Semantic status tokens (MASTER.md §1)
        status: {
          "present-fg": "#15803D",
          "present-bg": "#DCFCE7",
          "absent-fg": "#DC2626",
          "absent-bg": "#FEE2E2",
          "od-fg": "#1D4ED8",
          "od-bg": "#DBEAFE",
          "others-fg": "#475569",
          "others-bg": "#F1F5F9",
          "warn-fg": "#B45309",
          "warn-bg": "#FEF3C7",
        },
      },
      fontFamily: {
        heading: ["'Fira Code'", "ui-monospace", "monospace"],
        body: ["'Fira Sans'", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 4px 6px rgba(0,0,0,0.1)",
        lg: "0 10px 15px rgba(0,0,0,0.1)",
        xl: "0 20px 25px rgba(0,0,0,0.15)",
      },
      borderRadius: {
        input: "8px",
        card: "12px",
        modal: "16px",
      },
    },
  },
  plugins: [],
};
export default config;
