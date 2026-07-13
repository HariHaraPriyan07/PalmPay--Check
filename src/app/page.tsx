"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeRouteForRole, useAuth } from "@/lib/firebase/auth-context";
import { Spinner } from "@/components/ui/primitives";

/** Root: route to the role's home (advisor → /advisor, coordinator/hod → /overview). */
export default function RootPage() {
  const { user, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? homeRouteForRole(role) : "/login");
  }, [user, role, loading, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spinner />
    </div>
  );
}
