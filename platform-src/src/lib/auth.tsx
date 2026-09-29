import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { Navigate } from "react-router-dom";
import { supabase, configMissing } from "./supabase";

export type Role = "admin" | "parent" | "staff";
export type Level = "view" | "edit";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
  must_change_password: boolean;
  title?: string | null;   // display title for staff ("Office Staff", "Principal")
}

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  perms: Record<string, Level>;                 // staff module permissions (phase 19); admins pass everything
  can: (module: string, level?: Level) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  profile: null,
  perms: {},
  can: () => false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [perms, setPerms] = useState<Record<string, Level>>({});
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
    // `title` arrives with phase 19; fall back so an un-migrated project still signs in.
    let r = await supabase.from("profiles").select("id, full_name, role, must_change_password, title").eq("id", uid).single();
    if (r.error) r = await supabase.from("profiles").select("id, full_name, role, must_change_password").eq("id", uid).single();
    const p = (r.data as Profile) ?? null;
    setProfile(p);
    if (p?.role === "staff") {
      const { data } = await supabase.from("staff_permissions").select("module, level").eq("user_id", uid);
      const m: Record<string, Level> = {};
      ((data as { module: string; level: Level }[]) ?? []).forEach((x) => { m[x.module] = x.level; });
      setPerms(m);
    } else {
      setPerms({});
    }
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
  // Admins may do everything; staff only what staff_permissions grants.
  const can = (module: string, level: Level = "view") => {
    if (profile?.role === "admin") return true;
    if (profile?.role !== "staff") return false;
    const l = perms[module];
    return level === "view" ? l === "view" || l === "edit" : l === "edit";
  };

  return (
    <AuthContext.Provider value={{ session, profile, perms, can, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}

export function homeFor(role: Role | undefined) {
  return role === "parent" ? "/parent" : "/admin";
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
