// Admin → Class Updates. A month calendar on top: every teacher post is an
// event on its day ("KG: Mathematics", "G1: Science"), one color per grade;
// clicking an event scrolls to that update in the list below and highlights
// it. Arrows move freely through past and future months. (phase 22)
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr } from "../../lib/dates";
import { usDate } from "../../lib/format";
import { type GradeLite, gradeColor, gradeShort, shiftMonth, monthLabel, monthRange, monthCells, isWeekend } from "../../lib/calendar";

interface Row {
  id: string; subject: string; note: string; update_date: string; homework_due: string | null;
  attachment_url: string | null; teacher_email: string | null; enrollment_id: string | null; grade_id: number | null;
  grades: { name: string } | null;
  enrollments: { grade_id: number; students: { first_name: string; last_name: string } } | null;
}

export default function ClassUpdates() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [gradeF, setGradeF] = useState<number | "">("");
  const [focus, setFocus] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const listRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (configMissing) return;
    supabase.from("grades").select("id, name, level_order").eq("is_active", true).order("level_order")
      .then(({ data }) => setGrades((data as GradeLite[]) ?? []));
  }, []);

  async function load() {
    if (configMissing) return;
    setLoading(true);
    const [from, to] = monthRange(month);
    const { data, error } = await supabase.from("class_updates")
      .select("id, subject, note, update_date, homework_due, attachment_url, teacher_email, enrollment_id, grade_id, grades ( name ), enrollments ( grade_id, students ( first_name, last_name ) )")
      .gte("update_date", from).lte("update_date", to)
      .order("update_date", { ascending: false }).order("created_at", { ascending: false });
    if (error) setMsg("Could not load: " + error.message);
    setRows((data as unknown as Row[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [month]);

  async function remove(id: string) {
    if (!confirm("Delete this update? Parents will no longer see it.")) return;
    const { error } = await supabase.from("class_updates").delete().eq("id", id);
    if (error) setMsg("Delete failed: " + error.message);
    load();
  }

  const gradeOf = (u: Row) => u.grade_id ?? u.enrollments?.grade_id ?? null;
  const gradeName = (gid: number | null) => grades.find((g) => g.id === gid)?.name ?? "—";
  const visible = useMemo(() => rows.filter((u) => gradeF === "" || gradeOf(u) === gradeF), [rows, gradeF]);
  const byDay = useMemo(() => {
    const m: Record<string, Row[]> = {};
    visible.forEach((u) => (m[u.update_date] ??= []).push(u));
    Object.values(m).forEach((l) => l.sort((a, b) => (gradeOf(a) ?? 0) - (gradeOf(b) ?? 0)));
    return m;
  }, [visible]);
  const cells = useMemo(() => monthCells(month), [month]);
  const today = todayStr();

  function jump(id: string) {
    setFocus(id);
    listRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => setFocus((f) => (f === id ? null : f)), 2500);
  }

  // list grouped by day, newest first
  const days = useMemo(() => Object.keys(byDay).sort((a, b) => (a < b ? 1 : -1)), [byDay]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Class Updates</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={gradeF} onChange={(e) => setGradeF(e.target.value === "" ? "" : Number(e.target.value))} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
            <option value="">All grades</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <div className="flex items-center rounded-lg border border-gray-300 bg-white">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2.5 py-1 text-sm text-gray-600 hover:bg-silver" title="Previous month">‹</button>
            <button onClick={() => setMonth(today.slice(0, 7))} className="border-x border-gray-300 px-3 py-1 text-sm font-semibold text-navy hover:bg-silver">{monthLabel(month)}</button>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2.5 py-1 text-sm text-gray-600 hover:bg-silver" title="Next month">›</button>
          </div>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Teacher notes from the Class Update and Qur'an Update forms. Each post is an event on its day; click one to jump to it below.
        Parents see the same posts in their feed with an evening digest; admins get a bell alert per post.
        {loading ? " Loading…" : ` ${visible.length} in ${monthLabel(month)}.`}
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      {/* legend */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
        {grades.map((g) => <span key={g.id} className="flex items-center gap-1.5"><span className={`h-3 w-3 rounded-full ${gradeColor(grades, g.id).dot}`} /> {g.name}</span>)}
        <span className="text-gray-400">· "(name)" = one student only · ★ = homework due date set</span>
      </div>

      {/* calendar */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-gray-400">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} className="min-h-[9rem] rounded-lg bg-silver/60" />;
            const list = byDay[d] ?? [];
            const shown = list;
            return (
              <div key={d} className={`min-h-[9rem] rounded-lg border border-gray-100 p-1.5 ${isWeekend(d) ? "bg-silver/40" : "bg-white"} ${d > today ? "opacity-60" : ""}`}>
                <div className={`mb-1 text-xs font-semibold ${d === today ? "inline-block rounded-full bg-navy px-1.5 text-white" : "text-gray-500"}`}>{Number(d.slice(-2))}</div>
                <div className="flex flex-col gap-1">
                  {shown.map((u) => { const g = gradeOf(u); const c = gradeColor(grades, g); return (
                    <button key={u.id} onClick={() => jump(u.id)}
                      title={`${gradeName(g)} · ${u.subject}${u.enrollments ? ` · ${u.enrollments.students.first_name} ${u.enrollments.students.last_name}` : ""}\n${u.note.slice(0, 160)}`}
                      className={`cursor-pointer rounded border px-1.5 py-0.5 text-left text-[11px] font-semibold leading-4 hover:ring-2 ${c.chip} ${c.ring}`}>
                      {gradeShort(gradeName(g))}: {u.subject}{u.enrollments ? ` (${u.enrollments.students.first_name})` : ""}{u.homework_due ? " ★" : ""}
                    </button>
                  ); })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* list */}
      <div className="space-y-5">
        {days.map((d) => (
          <section key={d}>
            <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{usDate(d)}{d === today ? " · today" : ""}</h2>
            <div className="space-y-3">
              {byDay[d].map((u) => { const g = gradeOf(u); const c = gradeColor(grades, g); return (
                <div key={u.id} ref={(el) => { listRefs.current[u.id] = el; }}
                  className={`rounded-xl border bg-white p-4 shadow-sm transition ${focus === u.id ? `border-royal ring-4 ${c.ring}` : "border-gray-200"}`}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${c.chip}`}>{gradeName(g)}</span>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-deep">{u.subject}</span>
                    {u.enrollment_id && u.enrollments && (
                      <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-navy">{u.enrollments.students.first_name} {u.enrollments.students.last_name} only</span>
                    )}
                    {u.homework_due && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">★ due {usDate(u.homework_due)}</span>}
                    <span className="ml-auto text-xs text-gray-400">{u.teacher_email ?? "unknown"}</span>
                    {u.attachment_url && <a href={u.attachment_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-royal hover:underline">Attachment</a>}
                    <button onClick={() => remove(u.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{u.note}</p>
                </div>
              ); })}
            </div>
          </section>
        ))}
        {!configMissing && !loading && !visible.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No class updates in {monthLabel(month)}{gradeF !== "" ? " for this grade" : ""}. Use the arrows to look at other months.
          </p>
        )}
      </div>
    </div>
  );
}
