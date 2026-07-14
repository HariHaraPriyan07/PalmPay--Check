"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signOut as fbSignOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { getDb, getFirebaseAuth } from "./client";
import type { Role, UserDoc } from "@/lib/types";

interface AuthState {
  user: User | null;
  /** Resolved from custom claims (canonical — security rules use claims) or the profile doc. */
  role: Role | null;
  /** Advisor's own section (A–Q), null for coordinator/hod. */
  section: string | null;
  profile: UserDoc | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  role: null,
  section: null,
  profile: null,
  loading: true,
  signOut: async () => {},
});

const VALID_ROLES: Role[] = ["advisor", "coordinator", "hod"];

/** Coerce an arbitrary value into a valid Role (case-insensitive), or null. */
function normalizeRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  return (VALID_ROLES as string[]).includes(lowered) ? (lowered as Role) : null;
}

/**
 * Read a field from a Firestore doc tolerating capitalization differences
 * (e.g. a manually-created doc using `Role`/`AssignedSection` instead of the
 * canonical lowercase keys). Returns the first case-insensitive key match.
 */
function readField(data: Record<string, unknown>, key: string): unknown {
  if (key in data) return data[key];
  const target = key.toLowerCase();
  for (const k of Object.keys(data)) {
    if (k.toLowerCase() === target) return data[k];
  }
  return undefined;
}

interface ResolvedProfile {
  profile: UserDoc | null;
  role: Role | null;
  section: string | null;
}

/**
 * Resolve role/section for a signed-in user. Precedence:
 *   1. Firestore users/{uid} profile doc (tolerant of field-name casing)
 *   2. Firebase Auth custom claims (what security rules actually enforce)
 */
async function resolveProfile(u: User): Promise<ResolvedProfile> {
  let profile: UserDoc | null = null;
  let role: Role | null = null;
  let section: string | null = null;

  // 1. Profile doc (readable per rules: your own doc).
  try {
    const snap = await getDoc(doc(getDb(), "users", u.uid));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      role = normalizeRole(readField(data, "role"));
      const rawSection = readField(data, "assignedSection");
      section = typeof rawSection === "string" && rawSection ? rawSection : null;
      const rawName = readField(data, "name");
      const rawEmail = readField(data, "email");
      profile = {
        uid: u.uid,
        email: typeof rawEmail === "string" ? rawEmail : (u.email ?? ""),
        role: role ?? "advisor",
        name: typeof rawName === "string" ? rawName : (u.displayName ?? u.email ?? ""),
        ...(section ? { assignedSection: section } : {}),
      };
    }
  } catch (err) {
    console.error("[auth] Failed to read profile doc:", err);
  }

  // 2. Fall back to custom claims (or use them to fill a missing role).
  if (!role) {
    try {
      const token = await u.getIdTokenResult();
      role = normalizeRole(token.claims.role);
      if (!section && typeof token.claims.section === "string") {
        section = token.claims.section;
      }
    } catch (err) {
      console.error("[auth] Failed to read custom claims:", err);
    }
  }

  return { profile, role, section };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [section, setSection] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setRole(null);
        setSection(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      const resolved = await resolveProfile(u);
      setProfile(resolved.profile);
      setRole(resolved.role);
      setSection(resolved.section);
      setLoading(false);
    });
  }, []);

  const signOut = useCallback(async () => {
    await fbSignOut(getFirebaseAuth());
  }, []);

  const value = useMemo(
    () => ({ user, role, section, profile, loading, signOut }),
    [user, role, section, profile, loading, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

export function homeRouteForRole(role: Role | null): string {
  if (role === "advisor") return "/advisor";
  if (role === "coordinator" || role === "hod") return "/overview";
  return "/login";
}

/** Client-side route guard. (Real enforcement lives in Firestore rules — this is UX only.) */
export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: ReactNode;
}) {
  const { user, role, loading } = useAuth();
  const router = useRouter();
  // Stable primitive so the effect doesn't re-fire on every render (the `roles`
  // prop is a fresh array literal each render, which would otherwise loop router.replace).
  const rolesKey = roles.join(",");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (!role) return; // Signed in but no role yet — handled by the render below.
    const allowed = rolesKey.split(",") as Role[];
    if (!allowed.includes(role)) {
      router.replace(homeRouteForRole(role));
    }
  }, [user, role, loading, rolesKey, router]);

  // Signed in but no role resolved (no profile doc and no custom claim).
  if (!loading && user && !role) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <p className="font-heading text-lg font-semibold text-foreground">
          Account not fully provisioned
        </p>
        <p className="max-w-md text-sm text-muted-fg">
          You&apos;re signed in, but no role is assigned to this account. An administrator
          needs to set your role before you can continue.
        </p>
      </div>
    );
  }

  if (loading || !user || !role || !roles.includes(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none"
          role="status"
          aria-label="Loading"
        />
      </div>
    );
  }
  return <>{children}</>;
}
