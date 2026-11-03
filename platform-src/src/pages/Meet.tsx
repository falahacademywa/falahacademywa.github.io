// Parent-teacher meeting booking (phase 33, President 2026-11-02). Stand-alone page, no
// sign-in: /platform/#/meet/<token>, one link per class, shared with parents on WhatsApp and
// not linked from the website. The parent gives the child's first name and the phone number
// the school has on file; the database (ptm_family / ptm_book) checks both, then the family
// picks a free time. Siblings in the same class share one time. Taken times show no names.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase, configMissing } from "../lib/supabase";
import { ampm, longDate, icsFile } from "../lib/meetings";

interface Page { title: string; class: string; date: string; minutes: number; open: boolean; book_until: string | null; slots: { time: string; free: boolean }[] }
interface Family { children: string[]; slot: string | null; parent_name: string | null }

export default function Meet() {
  const { token = "" } = useParams();
  const [page, setPage] = useState<Page | null | undefined>(undefined);
  const [child, setChild] = useState("");
  const [phone, setPhone] = useState("");
  const [parent, setParent] = useState("");
  const [fam, setFam] = useState<Family | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);   // "booked" | "cancelled"

  async function loadPage() {
    if (configMissing) return setPage(null);
    const { data } = await supabase.rpc("ptm_page", { p_token: token });
    setPage((data as Page) ?? null);
  }
  useEffect(() => { loadPage(); }, [token]);
  useEffect(() => { document.title = page ? `${page.title} — ${page.class} | Falah Academy` : "Falah Academy"; }, [page]);

  async function identify(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    if (!child.trim()) return setErr("Please type your child's first name.");
    if (phone.replace(/\D/g, "").length < 10) return setErr("Please type the full phone number (10 digits).");
    setBusy(true);
    const { data } = await supabase.rpc("ptm_family", { p_token: token, p_child: child, p_phone: phone });
    setBusy(false);
    if (!data) return setErr("We could not match that name and phone number. Please use the number the school has on file for your child, or contact the office.");
    const f = data as Family;
    setFam(f); setPick(f.slot); setParent(f.parent_name ?? "");
  }

  async function book(slot: string | null) {
    setErr(null); setBusy(true);
    const { data, error } = await supabase.rpc("ptm_book", { p_token: token, p_child: child, p_phone: phone, p_slot: slot, p_parent: parent });
    setBusy(false);
    const r = data as { ok: boolean; error?: string; slot?: string | null } | null;
    if (error || !r?.ok) { setErr(r?.error ?? error?.message ?? "Something went wrong. Please try again."); loadPage(); return; }
    setFam((f) => (f ? { ...f, slot: r.slot ?? null } : f));
    setPick(r.slot ?? null);
    setDone(slot ? "booked" : "cancelled");
    loadPage();
  }

  const shell = (body: React.ReactNode) => (
    <div className="min-h-screen bg-silver px-4 py-6">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center gap-3">
          <img src="../images/logo.jpg" alt="" className="h-12 w-12 rounded-full object-cover shadow" />
          <div>
            <div className="font-display text-xl font-semibold leading-tight text-navy">Falah Academy</div>
            <div className="text-xs text-gray-500">Empowering Minds, Enlightening Futures</div>
          </div>
        </div>
        {body}
        <p className="mt-6 text-center text-xs text-gray-400">Questions? Call the school office at (301) 919-0106.</p>
      </div>
    </div>
  );

  if (page === undefined) return shell(<p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">Loading…</p>);
  if (page === null) return shell(<p className="rounded-xl bg-white p-6 text-center text-sm text-gray-600 shadow-sm">This booking link is not valid. Please use the link the school sent you.</p>);

  const card = "rounded-xl bg-white p-5 shadow-sm";
  const kids = fam ? fam.children.join(" & ") : "";
  return shell(
    <div className="space-y-4">
      <div className={card}>
        <h1 className="font-display text-2xl font-semibold text-navy">{page.title}</h1>
        <div className="mt-1 text-sm font-semibold text-gray-700">{page.class} · {longDate(page.date)}</div>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">
          Each meeting is {page.minutes} minutes with your child's class teacher; the Qur'an teacher joins for the last 5 minutes.
          Brothers and sisters in the same class share one meeting.
        </p>
        {!page.open && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Booking is closed. Please contact the school office.</p>}
      </div>

      {page.open && !fam && (
        <form onSubmit={identify} className={card}>
          <h2 className="font-display text-lg font-semibold text-navy">1. Who are you booking for?</h2>
          <label className="mt-3 block text-sm font-semibold text-gray-700">Your child's first name
            <input value={child} onChange={(e) => setChild(e.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
          </label>
          <label className="mt-3 block text-sm font-semibold text-gray-700">Your phone number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="(206) 555-0123" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
            <span className="mt-1 block text-xs font-normal text-gray-500">The number the school has on file for your child.</span>
          </label>
          {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          <button disabled={busy} className="mt-4 w-full rounded-lg bg-navy py-3 text-base font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Continue"}</button>
        </form>
      )}

      {fam && (
        <div className={card}>
          {done === "booked" && fam.slot ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-deep">
              <div className="text-base font-semibold">✓ Booked: {ampm(fam.slot)}, {longDate(page.date)}</div>
              <div className="mt-1">for {kids} ({page.class}). JazakAllah khair — see you then, in sha Allah.</div>
              <a href={icsFile(page, fam.slot, kids)} download="falah-parent-teacher-meeting.ics" className="mt-2 inline-block font-semibold text-royal underline">Add to my calendar</a>
            </div>
          ) : done === "cancelled" ? (
            <div className="mb-4 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Your meeting was cancelled. You can choose a new time below.</div>
          ) : fam.slot ? (
            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-deep">
              You are booked at <b>{ampm(fam.slot)}</b> for {kids}. To change, pick another time.
            </div>
          ) : null}

          <h2 className="font-display text-lg font-semibold text-navy">2. Choose a time for {kids}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {page.slots.map((s) => {
              const mine = fam.slot === s.time; const can = s.free || mine; const on = pick === s.time;
              return (
                <button key={s.time} type="button" disabled={!can || busy} onClick={() => { setPick(s.time); setDone(null); }}
                  className={`rounded-lg border px-3 py-3 text-base font-semibold ${on ? "border-navy bg-navy text-white" : can ? "border-gray-300 bg-white text-navy hover:border-navy" : "cursor-not-allowed border-gray-200 bg-gray-100 text-gray-400 line-through"}`}>
                  {ampm(s.time)}{mine && !on ? " ✓" : ""}{!can ? <span className="block text-[11px] font-normal no-underline">taken</span> : null}
                </button>
              );
            })}
          </div>
          <label className="mt-4 block text-sm font-semibold text-gray-700">Your name <span className="font-normal text-gray-400">(optional)</span>
            <input value={parent} onChange={(e) => setParent(e.target.value)} autoComplete="name" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base" />
          </label>
          {err && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</p>}
          <button disabled={!pick || busy || (pick === fam.slot && done === "booked")} onClick={() => book(pick)}
            className="mt-4 w-full rounded-lg bg-navy py-3 text-base font-semibold text-white disabled:opacity-50">
            {busy ? "Saving…" : pick ? (fam.slot && fam.slot !== pick ? `Change to ${ampm(pick)}` : `Book ${ampm(pick)}`) : "Pick a time"}
          </button>
          {fam.slot && (
            <button disabled={busy} onClick={() => { if (confirm("Cancel your meeting?")) book(null); }} className="mt-3 w-full text-sm font-semibold text-red-700 underline disabled:opacity-50">
              Cancel my meeting
            </button>
          )}
        </div>
      )}
    </div>
  );
}
