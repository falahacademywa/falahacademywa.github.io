// Teacher app — Meetings (phase 33): my classes' parent-teacher meeting times and a remarks
// box per student. The class teacher and the Qur'an teacher each write their own remarks;
// a box opens only when that meeting is over (the database refuses earlier saves too) and
// the parents see the remarks on their portal home.
import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { ampm, longDate, KIND_LABEL, type Remark } from "../../lib/meetings";
import SecureImg from "../../components/SecureImg";

interface Stu { student_id: string; name: string; photo: string | null; family_no: number; slot: string | null; parent_name: string | null; ends_at: string | null; remarks: Record<string, Remark> }
interface Cls { class_id: number; class: string; title: string; date: string; minutes: number; quran_minutes: number; kinds: string[]; last_end: string; students: Stu[] }

export default function Meetings() {
  const [classes, setClasses] = useState<Cls[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  async function load() {
    if (configMissing) return;
    const { data, error } = await supabase.rpc("ptm_teacher_view");
    if (error) setErr(error.message.includes("ptm_teacher_view") ? "Parent meetings are not set up on this project yet (phase 33)." : error.message);
    setClasses((data as Cls[]) ?? []);
  }
  useEffect(() => { load(); }, []);
  // boxes open on their own as meetings end
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);

  if (err) return <p className="rounded-xl bg-white p-4 text-sm text-red-700 shadow-sm">{err}</p>;
  if (!classes) return <p className="p-4 text-sm text-gray-500">Loading…</p>;
  if (!classes.length) return <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">No parent-teacher meeting is planned for your classes.</p>;

  return (
    <div className="space-y-4">
      {classes.map((c) => {
        const booked = c.students.filter((s) => s.slot);
        const open = c.students.filter((s) => !s.slot);
        return (
          <section key={c.class_id}>
            <div className="mb-2 px-1">
              <h1 className="font-display text-lg font-semibold text-navy">{c.title} · {c.class}</h1>
              <div className="text-xs text-gray-500">{longDate(c.date)} · {booked.length} of {c.students.length} booked · Qur'an teacher: last {c.quran_minutes} min</div>
            </div>
            <div className="space-y-2">
              {booked.map((s) => <StudentRow key={s.student_id} c={c} s={s} now={now} onSaved={load} />)}
              {open.length > 0 && <div className="px-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-400">Not booked yet</div>}
              {open.map((s) => <StudentRow key={s.student_id} c={c} s={s} now={now} onSaved={load} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StudentRow({ c, s, now, onSaved }: { c: Cls; s: Stu; now: number; onSaved: () => void }) {
  const ends = new Date(s.ends_at ?? c.last_end).getTime();
  const isOver = now >= ends;
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 text-left">
        <span className={`w-16 shrink-0 rounded-lg px-1.5 py-1 text-center text-sm font-bold ${s.slot ? "bg-navy text-white" : "bg-gray-100 text-gray-400"}`}>{s.slot ? ampm(s.slot) : "—"}</span>
        {s.photo ? <SecureImg src={s.photo} alt="" className="h-9 w-9 rounded-full object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-silver text-sm font-bold text-navy">{s.name[0]}</span>}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-gray-800">{s.name}</span>
          <span className="block truncate text-[11px] text-gray-500">{s.parent_name ? `Parent: ${s.parent_name}` : s.slot ? "booked" : "no time chosen"}</span>
        </span>
        <span className="flex shrink-0 gap-1">
          {c.kinds.map((k) => <span key={k} className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${s.remarks[k] ? "bg-emerald-50 text-emerald-deep" : "bg-gray-100 text-gray-400"}`}>{k === "quran" ? "Q" : "C"}{s.remarks[k] ? " ✓" : ""}</span>)}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          {c.kinds.map((k) => <RemarkBox key={k} c={c} s={s} kind={k} isOver={isOver} ends={ends} onSaved={onSaved} />)}
          {Object.keys(s.remarks).filter((k) => !c.kinds.includes(k)).map((k) => (
            <div key={k} className="rounded-lg bg-silver/60 p-2.5 text-sm text-gray-700">
              <div className="mb-1 text-[11px] font-bold text-gray-500">{KIND_LABEL[k]}{s.remarks[k].by ? ` · ${s.remarks[k].by}` : ""}</div>
              <p className="whitespace-pre-wrap">{s.remarks[k].body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RemarkBox({ c, s, kind, isOver, ends, onSaved }: { c: Cls; s: Stu; kind: string; isOver: boolean; ends: number; onSaved: () => void }) {
  const had = s.remarks[kind];
  const [body, setBody] = useState(had?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("ptm_save_remark", { p_class: c.class_id, p_student: s.student_id, p_kind: kind, p_body: body });
    setBusy(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return setMsg({ ok: false, text: r?.error ?? error?.message ?? "Could not save." });
    setMsg({ ok: true, text: had ? "Saved. Parents see the new text." : "Posted. The parents can read it on their portal now." });
    onSaved();
  }
  const opensAt = new Date(ends).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div>
      <div className="mb-1 text-xs font-bold text-navy">{KIND_LABEL[kind]} remarks{had?.by ? <span className="font-normal text-gray-400"> · last saved by {had.by}</span> : null}</div>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!isOver || busy} rows={4}
        placeholder={isOver ? "How is the child doing, what to practise at home, anything agreed with the parents…" : `Opens when the meeting is over (${opensAt}).`}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
      {msg && <p className={`mt-1 text-xs ${msg.ok ? "text-emerald-deep" : "text-red-700"}`}>{msg.text}</p>}
      {isOver && (
        <button onClick={save} disabled={busy || !body.trim() || body.trim() === had?.body}
          className="mt-1 w-full rounded-lg bg-navy py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? "Saving…" : had ? "Save changes" : "Post for the parents"}
        </button>
      )}
    </div>
  );
}
