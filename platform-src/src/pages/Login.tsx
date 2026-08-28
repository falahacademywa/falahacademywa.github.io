import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, configMissing } from "../lib/supabase";
import { homeFor, useAuth } from "../lib/auth";
import type { Role } from "../lib/auth";

export default function Login() {
  const nav = useNavigate();
  const { session, profile, loading: authLoading } = useAuth();

  // Already signed in? Straight to the right dashboard.
  useEffect(() => {
    if (!authLoading && session && profile) {
      nav(profile.must_change_password ? "/change-password" : homeFor(profile.role), { replace: true });
    }
  }, [authLoading, session, profile]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function forgot() {
    if (!email) return setError("Enter your email above first, then tap Forgot password.");
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/platform/#/change-password",
    });
    if (error) setError(error.message);
    else setInfo("Password reset email sent — check your inbox (and spam).");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (configMissing) {
      setError("Platform is not connected to a database yet (setup in progress).");
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    const { data: p } = await supabase
      .from("profiles")
      .select("role, must_change_password")
      .eq("id", data.user.id)
      .single();
    nav(p?.must_change_password ? "/change-password" : homeFor(p?.role as Role), { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <img src="../images/logo.jpg" alt="Falah Academy" className="mx-auto mb-3 h-16 w-16 rounded-full object-cover" />
          <h1 className="font-display text-2xl font-semibold text-navy">Falah Academy</h1>
          <p className="mt-1 text-sm text-gray-500">Parent &amp; School Operations Platform</p>
        </div>
        {configMissing && (
          <div className="mb-4 rounded-lg bg-silver p-3 text-sm text-navy">
            Platform is not connected to a database yet (setup in progress).
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {info && (
          <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{info}</div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-navy" htmlFor="email">Email</label>
            <input id="email" type="email" required autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/30"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-navy" htmlFor="password">Password</label>
            <input id="password" type="password" required autoComplete="current-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/30"
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" disabled={busy}
            className="w-full rounded-lg bg-navy py-2.5 font-semibold text-white transition hover:bg-royal disabled:opacity-50">
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <button onClick={forgot} className="mt-3 w-full text-center text-sm text-royal hover:underline">
          Forgot password?
        </button>
        <p className="mt-5 text-center text-xs leading-relaxed text-gray-400">
          Accounts are created by the school and activated during Orientation.
          Forgot your password? Use the reset link in your invitation email or contact the office.
        </p>
      </div>
    </div>
  );
}
