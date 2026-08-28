import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth, homeFor } from "../lib/auth";

// Shown on first login (BR-014: temporary passwords must be changed)
// and after a password-reset link.
export default function ChangePassword() {
  const nav = useNavigate();
  const { profile, refreshProfile } = useAuth();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) return setError("Password must be at least 8 characters.");
    if (pw1 !== pw2) return setError("Passwords do not match.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    await supabase.from("profiles").update({ must_change_password: false }).eq("id", profile?.id ?? "");
    await refreshProfile();
    nav(homeFor(profile?.role), { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <h1 className="font-display text-xl font-semibold text-navy">Set a new password</h1>
        <p className="mb-5 mt-1 text-sm text-gray-500">
          For your family's security, please choose your own password before continuing.
        </p>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-semibold text-navy" htmlFor="pw1">New password</label>
            <input id="pw1" type="password" required autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-royal focus:outline-none"
              value={pw1} onChange={(e) => setPw1(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-navy" htmlFor="pw2">Repeat new password</label>
            <input id="pw2" type="password" required autoComplete="new-password"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-royal focus:outline-none"
              value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
          <button type="submit" disabled={busy}
            className="w-full rounded-lg bg-navy py-2.5 font-semibold text-white hover:bg-royal disabled:opacity-50">
            {busy ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
