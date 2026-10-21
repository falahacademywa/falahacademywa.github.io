// Teacher app — my profile: photo, name (office-managed), assigned grades
// (read-only), phone, short bio, address, emergency contact; install hint; sign out.
import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useMyTeacher, compressImage } from "../../lib/teacher";

export default function Me() {
  const { signOut, session } = useAuth();
  const { me, reload } = useMyTeacher();
  const [form, setForm] = useState({ phone: "", bio: "", address: "", emergency_name: "", emergency_phone: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (me) setForm({ phone: me.phone ?? "", bio: me.bio ?? "", address: me.address ?? "", emergency_name: me.emergency_name ?? "", emergency_phone: me.emergency_phone ?? "" });
  }, [me]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!me) return;
    setBusy(true);
    const clean = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null]));
    const { error } = await supabase.from("teachers").update(clean).eq("id", me.id);
    setBusy(false);
    setMsg(error ? "Could not save: " + error.message + (error.message.includes("column") ? " — the office needs to run the latest phase 26 script" : "") : "Saved.");
    reload();
  }
  async function changePhoto(file: File | null) {
    if (!file || !me) return;
    setBusy(true); setMsg(null);
    const blob = await compressImage(file, 800, 0.85);
    const path = `${me.id}/${crypto.randomUUID()}.jpg`;
    const up = await supabase.storage.from("teacher-photos").upload(path, blob, { contentType: "image/jpeg" });
    if (up.error) { setBusy(false); return setMsg("Photo upload failed: " + up.error.message); }
    const url = supabase.storage.from("teacher-photos").getPublicUrl(path).data.publicUrl;
    const { error } = await supabase.from("teachers").update({ photo_url: url }).eq("id", me.id);
    setBusy(false);
    setMsg(error ? "Could not save the photo: " + error.message : "Photo updated.");
    reload();
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  const inp = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const lbl = "block text-xs font-semibold text-gray-500";
  return (
    <div>
      <h1 className="mb-3 font-display text-xl font-semibold text-navy">My profile</h1>
      {me ? (
        <>
          <div className="mb-3 flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <label className="relative cursor-pointer" title="Change photo">
              {me.photo_url
                ? <img src={me.photo_url} alt="" className="h-20 w-20 rounded-full object-cover" />
                : <div className="flex h-20 w-20 items-center justify-center rounded-full bg-navy/10 text-xl font-bold text-navy">{me.first_name[0]}{me.last_name[0]}</div>}
              <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-navy text-white shadow">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9a2 2 0 012-2h2l2-3h6l2 3h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={(e) => { changePhoto(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            </label>
            <div className="min-w-0">
              <div className="truncate text-lg font-semibold text-navy">{me.first_name} {me.last_name}</div>
              <div className="truncate text-xs text-gray-500">{session?.user.email}</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {me.teacher_grades.map((tg) => <span key={tg.id} className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tg.role === "quran" ? "bg-emerald-50 text-emerald-deep" : "bg-silver text-navy"}`}>{tg.grades.name}{tg.role === "quran" ? " · Qur'an" : ""}</span>)}
                {!me.teacher_grades.length && <span className="text-xs text-gray-400">No grade assigned yet</span>}
              </div>
            </div>
          </div>

          <form onSubmit={save} className="space-y-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <label className={lbl}>Phone<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inp} /></label>
            <label className={lbl}>Short bio<textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} rows={3} className={inp} placeholder="A line or two about you for the school" /></label>
            <label className={lbl}>Address<textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className={inp} /></label>
            <div className="pt-1 text-xs font-bold uppercase tracking-wide text-gray-400">Emergency contact</div>
            <label className={lbl}>Name<input value={form.emergency_name} onChange={(e) => setForm({ ...form, emergency_name: e.target.value })} className={inp} /></label>
            <label className={lbl}>Phone number<input type="tel" value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} className={inp} /></label>
            {msg && <div className={`rounded-lg p-2 text-sm ${/^(Saved|Photo updated)/.test(msg) ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg}</div>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            <p className="text-[11px] text-gray-400">Name, e-mail and assigned grade are changed by the office.</p>
          </form>
        </>
      ) : <p className="text-sm text-gray-400">Loading…</p>}

      {!standalone && (
        <div className="mt-3 rounded-xl border border-gold/50 bg-gold/10 p-3 text-xs text-navy">
          <b>Install this app:</b> {ios ? "tap the Share button in Safari, then “Add to Home Screen”." : "open the browser menu (⋮) and tap “Install app” or “Add to Home screen”."} You stay signed in.
        </div>
      )}
      <button onClick={signOut} className="mt-4 w-full rounded-lg border border-gray-300 bg-white py-2.5 text-sm font-semibold text-gray-600">Sign out</button>
    </div>
  );
}
