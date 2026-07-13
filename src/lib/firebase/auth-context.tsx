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
  /** Resolved from custom claims (canonical — security rules use claims). */
  role: Role | null;
  /** Advisor's own section (claims), null for coordinator/hod. */
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
      try {
        // Custom claims are the source of truth (rules enforce with them).
        const token = await u.getIdTokenResult();
        const claimRole = (token.claims.role as Role | undefined) ?? null;
        const claimSection = (token.claims.section as string | undefined) ?? null;
        setRole(claimRole);
        setSection(claimSection);
        // Profile doc for display name etc. (readable: own doc per rules).
        try {
          const snap = await getDoc(doc(getDb(), "users", u.uid));
          setProfile(snap.exists() ? (snap.data() as UserDoc) : null);
        } catch {
          setProfile(null);
        }
      } finally {
        setLoading(false);
      }
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

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
    } else if (!role || !roles.includes(role)) {
      router.replace(homeRouteForRole(role));
    }
  }, [user, role, loading, roles, router]);

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
