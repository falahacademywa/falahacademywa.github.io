import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, configMissing } from "../lib/supabase";
import { homeFor, useAuth, Splash } from "../lib/auth";
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

  // Don't paint the login form until we know whether a session exists —
  // otherwise signed-in users see it flash for a frame on refresh.
  if (authLoading || (session && profile)) return <Splash />;

  async function forgot() {
    if (!email) return setError("Enter your email above first, then tap Forgot password.");
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + "/platform/#/change-password",
    });
    if (error) setError(error.message);
    else setInfo("Password reset email sent — check your inbox (and spam).");
  }

  // Teacher app (phase 26): sign in with the teacher's own Google or Microsoft
  // account. Works only when Admin → Teachers has switched App access on for
  // a teacher record with that e-mail; anyone else lands on a "no access" page.
  async function oauth(provider: "google" | "azure") {
    setError(null);
    const redirectTo = window.location.href.split("#")[0];   // back to this portal (PKCE code in the query)
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, scopes: provider === "azure" ? "email openid profile" : undefined,
                 queryParams: provider === "google" ? { prompt: "select_account" } : undefined },
    });
    if (error) setError(error.message);
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

        <div className="my-5 flex items-center gap-3 text-xs text-gray-400">
          <span className="h-px flex-1 bg-gray-200" />Teachers<span className="h-px flex-1 bg-gray-200" />
        </div>
        <div className="grid gap-2">
          <button type="button" onClick={() => oauth("google")} disabled={configMissing}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-700 hover:bg-silver disabled:opacity-50">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
          </button>
          <button type="button" onClick={() => oauth("azure")} disabled={configMissing}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-700 hover:bg-silver disabled:opacity-50">
            <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF"/><rect x="11" y="11" width="9" height="9" fill="#FFB900"/></svg>
            Continue with Microsoft
          </button>
        </div>
        <p className="mt-5 text-center text-xs leading-relaxed text-gray-400">
          Accounts are created by the school and activated during Orientation.
          Forgot your password? Use the reset link in your invitation email or contact the office.
        </p>
      </div>
    </div>
  );
}
