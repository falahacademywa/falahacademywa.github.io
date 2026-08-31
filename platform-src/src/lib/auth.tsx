import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Navigate } from "react-router-dom";
import { supabase, configMissing } from "./supabase";

export type Role = "admin" | "parent";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  must_change_password: boolean;
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  // booted: the stored session has been read from the browser. Until then we
  // must NOT redirect anyone to /login — that race was signing users out on refresh.
  const [booted, setBooted] = useState(configMissing);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    if (configMissing) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setBooted(true);
    });
    // Supabase fires SIGNED_IN / TOKEN_REFRESHED on every tab refocus; keeping
    // the old session object when the user is unchanged avoids re-running the
    // profile effect, which unmounted the whole portal (closing modals, losing
    // scroll and half-typed forms).
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setSession((prev) => (prev?.user.id === s?.user.id ? prev : s)));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, role, must_change_password")
      .eq("id", uid)
      .single();
    setProfile((data as Profile) ?? null);
  }

  useEffect(() => {
    if (!session) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    loadProfile(session.user.id).finally(() => setProfileLoading(false));
  }, [session]);

  const loading = !booted || profileLoading;

  const signOut = async () => {
    await supabase.auth.signOut();
  };
  const refreshProfile = async () => {
    if (session) await loadProfile(session.user.id);
  };

  return (
    <AuthContext.Provider value={{ session, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

export function homeFor(role: Role | undefined) {
  return role === "admin" ? "/admin" : "/parent";
}

export function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy">
      <div className="text-center">
        <img src="../images/logo.jpg" alt="" className="mx-auto mb-3 h-14 w-14 animate-pulse rounded-full object-cover" />
        <div className="font-display text-lg font-semibold text-white">Falah Academy</div>
        <div className="mt-1 text-xs text-white/50">Loading…</div>
      </div>
    </div>
  );
}

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  // Splash only before the FIRST profile load — a background re-fetch for the
  // same user must not unmount the page beneath it.
  if (loading && !profile) return <Splash />;
  if (!session || !profile) return <Navigate to="/login" replace />;
  if (profile.must_change_password) return <Navigate to="/change-password" replace />;
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <>{children}</>;
}

// For pages any signed-in user may reach (e.g. change-password)
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
