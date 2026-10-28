// Admin → Red Comet. Every workbook photo the teachers send from the teacher
// app (Red Comet tab → `work_uploads` + private `student-work` bucket), for the
// current calendar month and the month before, as a timeline (newest first).
// One entry per student + subject + day with the photos as thumbnails; filters
// for month, grade, student, subject, teacher and status. The status answers
// one question — were these pages entered in Red Comet or not? — and follows
// scripts/redcomet-pull.py: confirmed = entered; new/drafted = not yet;
// rejected = not used. (President 2026-10-28)
import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr } from "../../lib/dates";
import { usDate } from "../../lib/format";
import { type GradeLite, gradeColor, shiftMonth, monthLabel, monthRange } from "../../lib/calendar";

interface Row {
  id: number; enrollment_id: string; path: string; taken_at: string; subject: string | null; note: string | null;
  status: string; created_at: string; uploaded_by: string | null;
  enrollments: { grade_id: number; students: { first_name: string; last_name: string } } | null;
  profiles: { full_name: string | null } | null;
}
type Entered = "entered" | "pending" | "rejected";
interface Card { key: string; day: string; enrollment_id: string; subject: string; teacher: string; rows: Row[]; entered: Entered; done: number }

const enteredOf = (s: string): Entered => (s === "confirmed" ? "entered" : s === "rejected" ? "rejected" : "pending");
const BADGE: Record<Entered, { label: string; cls: string; dot: string }> = {
  entered:  { label: "Entered in Red Comet", cls: "bg-emerald-50 text-emerald-deep border-emerald-200", dot: "bg-emerald-500" },
  pending:  { label: "Not yet in Red Comet", cls: "bg-amber-50 text-amber-800 border-amber-200",       dot: "bg-amber-400" },
  rejected: { label: "Not used",             cls: "bg-gray-100 text-gray-500 border-gray-200",          dot: "bg-gray-300" },
};
const DAYS_OPEN = 14;   // days shown by default; older days sit behind "Show earlier"

export default function RedComet() {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [monthF, setMonthF] = useState<"both" | string>("both");
  const [gradeF, setGradeF] = useState<number | "">("");
  const [studentF, setStudentF] = useState("");
  const [subjectF, setSubjectF] = useState("");
  const [teacherF, setTeacherF] = useState("");
  const [statusF, setStatusF] = useState<"" | Entered>("");
  const [showAll, setShowAll] = useState(false);
  const [big, setBig] = useState<string | null>(null);

  useEffect(() => {
    if (configMissing) return;
    supabase.from("grades").select("id, name, level_order").eq("is_active", true).order("level_order")
      .then(({ data }) => setGrades((data as GradeLite[]) ?? []));
  }, []);

  async function load() {
    if (configMissing) return;
    setLoading(true);
    const from = monthRange(lastMonth)[0];
    const to = monthRange(thisMonth)[1];
    const { data, error } = await supabase.from("work_uploads")
      .select("id, enrollment_id, path, taken_at, subject, note, status, created_at, uploaded_by, enrollments ( grade_id, students ( first_name, last_name ) ), profiles:uploaded_by ( full_name )")
      .gte("taken_at", from).lte("taken_at", to)
      .order("taken_at", { ascending: false }).order("created_at", { ascending: false }).limit(2000);
    if (error) setMsg("Could not load: " + error.message);
    const list = (data as unknown as Row[]) ?? [];
    setRows(list);
    setLoading(false);
    // signed thumbnails (private bucket), 100 paths per call, valid 10 minutes
    const paths = list.map((r) => r.path);
    const add: Record<string, string> = {};
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { data: signed } = await supabase.storage.from("student-work").createSignedUrls(chunk, 600);
      (signed ?? []).forEach((s, j) => { if (s.signedUrl) add[chunk[j]] = s.signedUrl; });
    }
    setThumbs(add);
  }
  useEffect(() => { load(); }, []);

  const gradeName = (gid: number | null | undefined) => grades.find((g) => g.id === gid)?.name ?? "—";
  const studentName = (r: Row) => r.enrollments ? `${r.enrollments.students.first_name} ${r.enrollments.students.last_name}` : "—";
  const teacherName = (r: Row) => r.profiles?.full_name ?? "unknown";

  // option lists come from the loaded rows, so they only offer what exists
  const students = useMemo(() => {
    const m = new Map<string, { name: string; grade: number | null }>();
    rows.forEach((r) => { if (!m.has(r.enrollment_id)) m.set(r.enrollment_id, { name: studentName(r), grade: r.enrollments?.grade_id ?? null }); });
    return [...m.entries()].filter(([, v]) => gradeF === "" || v.grade === gradeF).sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows, gradeF, grades]);
  const subjects = useMemo(() => [...new Set(rows.map((r) => r.subject ?? "No subject"))].sort(), [rows]);
  const teachers = useMemo(() => [...new Set(rows.map(teacherName))].sort(), [rows]);

  const visible = useMemo(() => rows.filter((r) =>
    (monthF === "both" || r.taken_at.slice(0, 7) === monthF) &&
    (gradeF === "" || r.enrollments?.grade_id === gradeF) &&
    (!studentF || r.enrollment_id === studentF) &&
    (!subjectF || (r.subject ?? "No subject") === subjectF) &&
    (!teacherF || teacherName(r) === teacherF) &&
    (!statusF || enteredOf(r.status) === statusF)), [rows, monthF, gradeF, studentF, subjectF, teacherF, statusF]);

  // one entry per day + student + subject (a teacher's one "Send" for that subject)
  const cards = useMemo(() => {
    const m = new Map<string, Card>();
    visible.forEach((r) => {
      const subject = r.subject ?? "No subject";
      const key = `${r.taken_at}|${r.enrollment_id}|${subject}`;
      const c = m.get(key) ?? { key, day: r.taken_at, enrollment_id: r.enrollment_id, subject, teacher: teacherName(r), rows: [], entered: "entered" as Entered, done: 0 };
      c.rows.push(r);
      m.set(key, c);
    });
    m.forEach((c) => {
      const used = c.rows.filter((r) => r.status !== "rejected");
      c.done = used.filter((r) => r.status === "confirmed").length;
      c.entered = !used.length ? "rejected" : c.done === used.length ? "entered" : "pending";
    });
    return [...m.values()];
  }, [visible]);
  const days = useMemo(() => {
    const m: Record<string, Card[]> = {};
    cards.forEach((c) => (m[c.day] ??= []).push(c));
    Object.values(m).forEach((l) => l.sort((a, b) => (a.rows[0].enrollments?.grade_id ?? 0) - (b.rows[0].enrollments?.grade_id ?? 0) || studentName(a.rows[0]).localeCompare(studentName(b.rows[0])) || a.subject.localeCompare(b.subject)));
    return Object.keys(m).sort((a, b) => (a < b ? 1 : -1)).map((d) => [d, m[d]] as const);
  }, [cards]);
  const shownDays = showAll ? days : days.slice(0, DAYS_OPEN);
  const hiddenDays = days.length - shownDays.length;

  const counts = useMemo(() => ({
    photos: visible.length,
    entered: cards.filter((c) => c.entered === "entered").length,
    pending: cards.filter((c) => c.entered === "pending").length,
    students: new Set(visible.map((r) => r.enrollment_id)).size,
  }), [visible, cards]);

  const sel = "rounded border border-gray-300 bg-white px-2 py-1 text-sm";
  const anyFilter = monthF !== "both" || gradeF !== "" || studentF || subjectF || teacherF || statusF;
  const ago = (d: string) => { const n = Math.round((new Date(today + "T00:00:00").getTime() - new Date(d + "T00:00:00").getTime()) / 86400000); return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Red Comet</h1>
        <button onClick={load} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-silver">Refresh</button>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Workbook pages the teachers sent from the teacher app, newest first, {monthLabel(lastMonth)} and {monthLabel(thisMonth)}.
        Each entry is one student, one subject, one day. The badge says whether those pages have been entered in Red Comet yet;
        it updates on its own as the office works through the OneDrive inbox.
        {loading ? " Loading…" : ""}
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      {/* summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Not yet in Red Comet" value={counts.pending} tone="amber" onClick={() => setStatusF(statusF === "pending" ? "" : "pending")} active={statusF === "pending"} />
        <Stat label="Entered in Red Comet" value={counts.entered} tone="emerald" onClick={() => setStatusF(statusF === "entered" ? "" : "entered")} active={statusF === "entered"} />
        <Stat label="Photos" value={counts.photos} />
        <Stat label="Students" value={counts.students} />
      </div>

      {/* filters */}
      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <select value={statusF} onChange={(e) => setStatusF(e.target.value as "" | Entered)} className={sel}>
          <option value="">Entered or not — all</option>
          <option value="pending">Not yet in Red Comet</option>
          <option value="entered">Entered in Red Comet</option>
          <option value="rejected">Not used</option>
        </select>
        <select value={monthF} onChange={(e) => setMonthF(e.target.value)} className={sel}>
          <option value="both">Both months</option>
          <option value={thisMonth}>{monthLabel(thisMonth)}</option>
          <option value={lastMonth}>{monthLabel(lastMonth)}</option>
        </select>
        <select value={gradeF} onChange={(e) => { setGradeF(e.target.value === "" ? "" : Number(e.target.value)); setStudentF(""); }} className={sel}>
          <option value="">All grades</option>
          {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={studentF} onChange={(e) => setStudentF(e.target.value)} className={sel}>
          <option value="">All students</option>
          {students.map(([id, s]) => <option key={id} value={id}>{s.name}</option>)}
        </select>
        <select value={subjectF} onChange={(e) => setSubjectF(e.target.value)} className={sel}>
          <option value="">All subjects</option>
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={teacherF} onChange={(e) => setTeacherF(e.target.value)} className={sel}>
          <option value="">All teachers</option>
          {teachers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        {anyFilter && (
          <button onClick={() => { setMonthF("both"); setGradeF(""); setStudentF(""); setSubjectF(""); setTeacherF(""); setStatusF(""); }}
            className="text-xs font-semibold text-royal hover:underline">Clear filters</button>
        )}
      </div>

      {/* timeline, newest first */}
      <ol className="relative ml-3 border-l-2 border-gray-200 pl-6 sm:ml-4 sm:pl-8">
        {shownDays.map(([d, list]) => {
          const dayPending = list.some((c) => c.entered === "pending");
          return (
            <li key={d} className="relative mb-8 last:mb-0">
              <span className={`absolute -left-[2.05rem] top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white ring-2 sm:-left-[2.55rem] ${dayPending ? "bg-amber-400 ring-amber-200" : "bg-emerald-500 ring-emerald-200"}`} />
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-sm font-bold text-navy">{usDate(d)}</h2>
                <span className="text-xs text-gray-400">{ago(d)} · {list.length} {list.length === 1 ? "entry" : "entries"}</span>
              </div>
              <div className="space-y-3">
                {list.map((c) => { const g = c.rows[0].enrollments?.grade_id ?? null; const col = gradeColor(grades, g); const b = BADGE[c.entered]; const used = c.rows.filter((r) => r.status !== "rejected").length; return (
                  <div key={c.key} className={`rounded-xl border bg-white p-4 shadow-sm ${c.entered === "pending" ? "border-amber-200" : "border-gray-200"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>
                        <span className={`h-2 w-2 rounded-full ${b.dot}`} />{c.entered === "entered" ? "✓ " : ""}{b.label}
                        {c.entered === "pending" && c.done > 0 ? ` (${c.done} of ${used} done)` : ""}
                      </span>
                      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${col.chip}`}>{gradeName(g)}</span>
                      <span className="font-semibold text-navy">{studentName(c.rows[0])}</span>
                      <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-deep">{c.subject}</span>
                      <span className="text-xs text-gray-400">{c.rows.length} photo{c.rows.length === 1 ? "" : "s"}</span>
                      <span className="ml-auto text-xs text-gray-400">{c.teacher}</span>
                    </div>
                    {c.rows.some((r) => r.note) && (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{[...new Set(c.rows.map((r) => r.note).filter(Boolean))].join(" · ")}</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.rows.map((r) => thumbs[r.path]
                        ? <button key={r.id} onClick={() => setBig(thumbs[r.path])} title={`#${r.id} · ${BADGE[enteredOf(r.status)].label}`}
                            className={`relative h-24 w-24 overflow-hidden rounded-lg border bg-silver hover:ring-2 hover:ring-royal ${r.status === "confirmed" ? "border-emerald-300" : r.status === "rejected" ? "border-gray-200 opacity-50" : "border-amber-300"}`}>
                            <img src={thumbs[r.path]} alt="" loading="lazy" className="h-full w-full object-cover" />
                            {r.status === "confirmed" && <span className="absolute bottom-1 right-1 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">✓</span>}
                          </button>
                        : <div key={r.id} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-400">loading…</div>)}
                    </div>
                  </div>
                ); })}
              </div>
            </li>
          );
        })}
      </ol>
      {hiddenDays > 0 && (
        <button onClick={() => setShowAll(true)} className="mt-6 w-full rounded-xl border border-dashed border-gray-300 bg-white p-3 text-sm font-semibold text-royal hover:bg-silver/60">
          Show {hiddenDays} earlier {hiddenDays === 1 ? "day" : "days"}
        </button>
      )}
      {!configMissing && !loading && !cards.length && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
          No Red Comet photos{anyFilter ? " match these filters" : ` in ${monthLabel(lastMonth)} or ${monthLabel(thisMonth)}`}.
        </p>
      )}

      {/* full-size viewer */}
      {big && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4" onClick={() => setBig(null)}>
          <img src={big} alt="" className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <button onClick={() => setBig(null)} className="absolute right-4 top-4 text-2xl text-white/80 hover:text-white" aria-label="Close">✕</button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: number; tone?: "amber" | "emerald"; onClick?: () => void; active?: boolean }) {
  const toneCls = tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-deep" : "text-navy";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`rounded-xl border bg-white px-4 py-3 text-left shadow-sm ${active ? "border-royal ring-2 ring-royal/30" : "border-gray-200"} ${onClick ? "hover:bg-silver/50" : ""}`}
      title={onClick ? "Click to show only these" : undefined}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`font-display text-2xl font-semibold ${toneCls}`}>{value}</div>
    </Tag>
  );
}
