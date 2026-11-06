// Admin → Parent meetings (phase 33, President 2026-11-02; staff module 'meetings').
// One card per class: the booking link to share on WhatsApp, the day's schedule (who booked
// which time), the families that have not booked yet, every remark the class teacher and the
// Qur'an teacher posted, and — with edit permission — the invite list: leave a child out, or
// put two children in one meeting (siblings, even when the portal has different phones).
// The office also controls the times (2026-11-03): open or close each time per class, add a time.
import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { ampm, longDate, KIND_LABEL, type Remark } from "../../lib/meetings";

interface Stu { student_id: string; name: string; grade: string | null; family_no: number; invited: boolean; slot: string | null;
  parent_name: string | null; phone: string | null; booked_at: string | null; remarks: Record<string, Remark> }
interface Cls { id: number; name: string; capacity: number; token: string | null; slug: string | null; closed: string[]; students: Stu[] }
interface Ev { id: number; title: string; meet_date: string; slot_minutes: number; slots: string[]; quran_minutes: number; book_until: string | null; active: boolean }
interface View { event: Ev; events: { id: number; title: string; date: string }[]; classes: Cls[] }

export default function Meetings() {
  const { can } = useAuth();
  const canEdit = can("meetings", "edit");
  const [view, setView] = useState<View | null | undefined>(undefined);
  const [evId, setEvId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTime, setNewTime] = useState("");

  async function load(id = evId) {
    if (configMissing) return;
    const { data, error } = await supabase.rpc("ptm_admin_view", { p_event: id });
    if (error) { setMsg({ ok: false, text: error.message.includes("ptm_admin_view") ? "Parent meetings are not set up on this project yet (phase 33)." : error.message }); setView(null); return; }
    setView((data as View) ?? null);
  }
  useEffect(() => { load(); }, [evId]);

  async function act(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc(fn, args);
    setBusy(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return setMsg({ ok: false, text: r?.error ?? error?.message ?? "Could not save." });
    setMsg({ ok: true, text: ok }); load();
  }

  if (view === undefined) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!view) return <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">{msg?.text ?? "No parent-teacher meeting has been set up yet."}</p>;
  const ev = view.event;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Parent meetings</h1>
        <div className="flex items-center gap-2">
          {view.events.length > 1 && (
            <select value={ev.id} onChange={(e) => setEvId(Number(e.target.value))} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
              {view.events.map((x) => <option key={x.id} value={x.id}>{x.title} · {x.date}</option>)}
            </select>
          )}
          <button onClick={() => load()} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-silver">Refresh</button>
        </div>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-gray-500">
        {ev.title}, {longDate(ev.meet_date)}: {ev.slots.length} times of {ev.slot_minutes} minutes ({ev.slots.map((s) => ampm(s.slice(0, 5))).join(", ")}); the Qur'an teacher joins for the last {ev.quran_minutes} minutes.
        Parents book with the class link below (child's first name + the phone number on file); siblings in one class share a time.
        {ev.book_until ? ` Booking closes ${new Date(ev.book_until).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.` : ""}
        {" "}Teachers post remarks in the teacher app (Meetings tab) after each meeting; parents read them on their portal home.
      </p>
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); if (newTime.trim()) act("ptm_admin_add_time", { p_event: ev.id, p_slot: newTime.trim() }, `${newTime.trim()} added for every class.`); setNewTime(""); }}
          className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Add a time to the day:</span>
          <input value={newTime} onChange={(e) => setNewTime(e.target.value)} placeholder="e.g. 2:00 PM" className="w-28 rounded border border-gray-300 px-2 py-1" />
          <button disabled={busy || !newTime.trim()} className="rounded border border-navy/30 bg-white px-2.5 py-1 text-xs font-semibold text-navy hover:bg-silver disabled:opacity-50">Add</button>
          <span className="text-xs text-gray-400">Close a time for one class with its "close" button below.</span>
        </form>
      )}
      {msg && <p className={`mb-3 rounded-lg p-3 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-deep" : "bg-red-50 text-red-700"}`}>{msg.text}</p>}
      <div className="grid gap-4 xl:grid-cols-2">
        {view.classes.map((c) => <ClassCard key={c.id} c={c} ev={ev} canEdit={canEdit} busy={busy} act={act} />)}
      </div>
    </div>
  );
}

function ClassCard({ c, ev, canEdit, busy, act }: { c: Cls; ev: Ev; canEdit: boolean; busy: boolean;
  act: (fn: string, args: Record<string, unknown>, ok: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [openRemark, setOpenRemark] = useState<string | null>(null);
  // family codes for the invitation slips (phase 40): read out to a parent who lost theirs
  const [codes, setCodes] = useState<Record<number, string>>({});
  useEffect(() => {
    supabase.from("ptm_codes").select("family_no, code").eq("class_id", c.id)
      .then(({ data }) => setCodes(Object.fromEntries(((data as { family_no: number; code: string }[]) ?? []).map((x) => [x.family_no, x.code]))));
  }, [c.id, c.students]);
  const codeChip = (no: number) => codes[no]
    ? <span title="Family code (on the invitation slip)" className="rounded bg-silver px-1.5 py-0.5 font-mono text-[11px] font-semibold tracking-wider text-navy">{codes[no]}</span>
    : null;
  // the short link parents can remember (falahacademywa.org/meet/kg, a static redirect page);
  // the long token link keeps working too
  const site = location.origin + location.pathname.replace(/platform\/.*$/, "");
  const link = c.slug ? `${site}meet/${c.slug}` : c.token ? `${location.origin}${location.pathname}#/meet/${c.token}` : "";
  const invited = c.students.filter((s) => s.invited);
  // families: siblings share a family number (and a time)
  const fams = useMemo(() => {
    const m = new Map<number, Stu[]>();
    c.students.filter((s) => s.invited).forEach((s) => m.set(s.family_no, [...(m.get(s.family_no) ?? []), s]));
    return [...m.entries()].map(([no, kids]) => ({ no, kids, slot: kids[0].slot, parent: kids[0].parent_name, phone: kids[0].phone, at: kids[0].booked_at }));
  }, [c.students]);
  const bySlot = (t: string) => fams.filter((f) => f.slot === t.slice(0, 5));
  const notBooked = fams.filter((f) => !f.slot);
  const isClosed = (t: string) => c.closed.includes(t.slice(0, 5));
  const free = ev.slots.filter((t) => !isClosed(t)).reduce((n, t) => n + Math.max(0, c.capacity - bySlot(t).length), 0);
  const openTimes = ev.slots.filter((t) => !isClosed(t)).length;
  const names = (kids: Stu[]) => kids.map((k) => k.name).join(" & ");
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* ignore */ } }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-navy">{c.name}</h2>
        <span className="text-sm text-gray-500">
          <b className="text-navy">{fams.length - notBooked.length}</b> of {fams.length} families booked · {free} time{free === 1 ? "" : "s"} free
          {fams.length > openTimes * c.capacity && <span className="ml-1 font-semibold text-red-700">· more families than times!</span>}
        </span>
      </div>
      {link && (
        <div className="mt-2 flex items-center gap-2">
          <input readOnly value={link} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded border border-gray-200 bg-silver/50 px-2 py-1 font-mono text-sm text-navy" />
          <button onClick={copy} className="shrink-0 rounded border border-navy/30 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-silver">{copied ? "Copied ✓" : "Copy link"}</button>
          <a href={link} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-royal hover:underline">Open</a>
        </div>
      )}

      <table className="mt-3 w-full text-sm">
        <tbody>
          {ev.slots.map((t) => {
            const fs = bySlot(t); const shut = isClosed(t);
            return (
              <tr key={t} className={`border-t border-gray-100 align-top ${shut ? "bg-gray-50" : ""}`}>
                <td className={`w-20 py-1.5 pr-2 font-semibold ${shut ? "text-gray-400 line-through" : "text-navy"}`}>{ampm(t.slice(0, 5))}</td>
                <td className="py-1.5">
                  {fs.length === 0 && <span className="text-gray-300">{shut ? "closed — parents cannot pick it" : "free"}</span>}
                  {fs.map((f) => (
                    <div key={f.no} className="flex flex-wrap items-center gap-x-2">
                      <span className="font-semibold text-gray-800">{names(f.kids)}</span>
                      {codeChip(f.no)}
                      <span className="text-xs text-gray-500">{[f.parent, f.phone].filter(Boolean).join(" · ")}{f.at ? ` · booked ${new Date(f.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
                      {canEdit && <button disabled={busy} onClick={() => { if (confirm(`Cancel the ${ampm(t.slice(0, 5))} meeting for ${names(f.kids)}? The time becomes free again.`)) act("ptm_admin_cancel", { p_class: c.id, p_family: f.no }, "Booking cancelled; the time is free again."); }}
                        className="text-xs font-semibold text-red-700 hover:underline disabled:opacity-50">cancel</button>}
                    </div>
                  ))}
                </td>
                <td className="w-14 py-1.5 text-right">
                  {canEdit && <button disabled={busy} onClick={() => act("ptm_admin_slot", { p_class: c.id, p_slot: t.slice(0, 5), p_open: shut },
                      shut ? `${c.name}: ${ampm(t.slice(0, 5))} is open again.` : `${c.name}: ${ampm(t.slice(0, 5))} is closed${fs.length ? " (the booking already made there stays)" : ""}.`)}
                    className={`text-xs font-semibold hover:underline disabled:opacity-50 ${shut ? "text-emerald-deep" : "text-gray-400"}`}>{shut ? "open" : "close"}</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {notBooked.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="font-semibold text-amber-800">Not booked yet ({notBooked.length})</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-amber-900">{notBooked.map((f) => <span key={f.no} className="inline-flex items-center gap-1">{names(f.kids)} {codeChip(f.no)}</span>)}</div>
        </div>
      )}

      {/* remarks posted after the meetings */}
      <div className="mt-3">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">Remarks</div>
        <div className="flex flex-wrap gap-1.5">
          {invited.map((s) => (
            <button key={s.student_id} onClick={() => setOpenRemark(openRemark === s.student_id ? null : s.student_id)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${openRemark === s.student_id ? "border-navy bg-navy text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-silver"}`}>
              {s.name.split(" ")[0]} <span className={openRemark === s.student_id ? "text-white/80" : "text-gray-400"}>{s.remarks.class ? "C✓" : "C–"} {s.remarks.quran ? "Q✓" : "Q–"}</span>
            </button>
          ))}
        </div>
        {openRemark && (() => {
          const s = invited.find((x) => x.student_id === openRemark); if (!s) return null;
          const ks = Object.keys(s.remarks);
          return (
            <div className="mt-2 space-y-2">
              {!ks.length && <p className="text-sm text-gray-400">No remarks posted for {s.name} yet.</p>}
              {ks.map((k) => (
                <div key={k} className="rounded-lg bg-silver/60 p-3 text-sm text-gray-800">
                  <div className="mb-1 text-xs font-bold text-gray-500">{KIND_LABEL[k] ?? k}{s.remarks[k].by ? ` · ${s.remarks[k].by}` : ""} · {new Date(s.remarks[k].at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  <p className="whitespace-pre-wrap">{s.remarks[k].body}</p>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* invite list */}
      <button onClick={() => setListOpen(!listOpen)} className="mt-3 text-xs font-semibold text-royal hover:underline">
        {listOpen ? "▴ Hide invite list" : `▾ Invite list (${invited.length} of ${c.students.length} children invited)`}
      </button>
      {listOpen && (
        <table className="mt-2 w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-400"><th className="py-1 font-semibold">Child</th><th className="font-semibold">Invited</th><th className="font-semibold">Meeting shared with</th></tr></thead>
          <tbody>
            {c.students.map((s) => {
              const sibs = c.students.filter((x) => x.family_no === s.family_no && x.student_id !== s.student_id);
              return (
                <tr key={s.student_id} className={`border-t border-gray-100 ${s.invited ? "" : "text-gray-400"}`}>
                  <td className="py-1.5">{s.name}{s.grade && s.grade !== c.name ? <span className="ml-1 text-xs text-gray-400">({s.grade})</span> : null}</td>
                  <td><input type="checkbox" checked={s.invited} disabled={!canEdit || busy}
                    onChange={(e) => act("ptm_admin_set", { p_class: c.id, p_student: s.student_id, p_invited: e.target.checked, p_same_as: null }, e.target.checked ? `${s.name} is invited again.` : `${s.name} is left out of this meeting.`)} /></td>
                  <td>
                    {canEdit ? (
                      <select value="" disabled={busy} onChange={(e) => {
                          const v = e.target.value; if (!v) return;
                          if (v === "__own") act("ptm_admin_split", { p_class: c.id, p_student: s.student_id }, `${s.name} now has a meeting of their own.`);
                          else act("ptm_admin_set", { p_class: c.id, p_student: s.student_id, p_invited: s.invited, p_same_as: v }, `${s.name} now shares a meeting with ${c.students.find((x) => x.student_id === v)?.name}.`);
                        }} className="max-w-[14rem] rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs">
                        <option value="">{sibs.length ? sibs.map((x) => x.name.split(" ")[0]).join(", ") : "own meeting"}</option>
                        {sibs.length > 0 && <option value="__own">→ own meeting</option>}
                        {c.students.filter((x) => x.family_no !== s.family_no).map((x) => <option key={x.student_id} value={x.student_id}>→ with {x.name}</option>)}
                      </select>
                    ) : <span className="text-xs">{sibs.length ? sibs.map((x) => x.name).join(", ") : "own meeting"}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
