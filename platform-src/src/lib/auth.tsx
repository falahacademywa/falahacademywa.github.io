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
  const [loading, setLoading] = useState(!configMissing);

  useEffect(() => {
    if (configMissing) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
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
      setLoading(false);
      return;
    }
    loadProfile(session.user.id).then(() => setLoading(false));
  }, [session]);

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

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (!session || !profile) return <Navigate to="/login" replace />;
  if (profile.must_change_password) return <Navigate to="/change-password" replace />;
  if (!roles.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <>{children}</>;
}

// For pages any signed-in user may reach (e.g. change-password)
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-gray-500">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
