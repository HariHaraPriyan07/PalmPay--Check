"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { Hand, ShieldCheck } from "lucide-react";
import { getFirebaseAuth } from "@/lib/firebase/client";
import { homeRouteForRole, useAuth } from "@/lib/firebase/auth-context";
import { Alert, Button, Input } from "@/components/ui/primitives";
import { FadeIn } from "@/components/ui/motion";

export default function LoginPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace(homeRouteForRole(role));
  }, [user, role, loading, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      // AuthProvider resolves claims; the effect above routes by role.
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
        setError("Invalid email or password.");
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Try again in a few minutes.");
      } else if (code === "auth/network-request-failed") {
        setError("Network error — check your connection and try again.");
      } else {
        setError("Sign-in failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Institutional panel (Aether-UI-style hero treatment, MASTER tokens, calm) */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-10 text-on-primary lg:flex">
        <FadeIn>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-input bg-white/10">
              <Hand className="h-6 w-6" aria-hidden />
            </span>
            <div>
              <p className="font-heading text-lg font-semibold">CIT Palm Attendance</p>
              <p className="text-sm text-white/70">Chennai Institute of Technology · CSE</p>
            </div>
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <h1 className="max-w-md font-heading text-3xl font-semibold leading-snug">
            Daily attendance, verified by palm.
          </h1>
          <p className="mt-4 max-w-md text-white/80">
            1:1 palm verification for 17 sections of CSE 3rd year. Palms are stored as numeric
            embeddings — never as raw images — and every match is logged for accuracy measurement.
          </p>
        </FadeIn>
        <FadeIn delay={0.2}>
          <p className="flex items-center gap-2 text-sm text-white/70">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            Section-isolated access enforced by server-side security rules
          </p>
        </FadeIn>
      </div>

      {/* Sign-in form */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <FadeIn className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <p className="font-heading text-xl font-semibold text-foreground">CIT Palm Attendance</p>
            <p className="text-sm text-muted-fg">Chennai Institute of Technology · CSE</p>
          </div>
          <h2 className="font-heading text-2xl font-semibold text-foreground">Sign in</h2>
          <p className="mt-1 text-sm text-muted-fg">
            Use your CIT college email. Access is limited to your role and section.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-body">
                College email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                placeholder="name@citchennai.net"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-body">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <Button type="submit" disabled={submitting || !email || !password} className="w-full">
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </FadeIn>
      </div>
    </div>
  );
}
