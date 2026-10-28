// Admin → Red Comet. Every workbook photo the teachers send from the teacher
// app (Red Comet tab → `work_uploads` + private `student-work` bucket), for the
// current calendar month and the month before. Two views: a timeline (newest
// first) and a grouped accordion Month → Entered or not → Grade → Student →
// Subject that opens
// and closes at every level. One entry per student + subject + day with the
// photos as thumbnails; filters for month, grade, student, subject, teacher and
// status. The status answers one question — were these pages entered in Red
// Comet or not? — and follows scripts/redcomet-pull.py: confirmed = entered;
// new/drafted = not yet; rejected = not used. (President 2026-10-28)
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { compressImage, todayISO } from "../../lib/teacher";
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
interface Card { key: string; day: string; enrollment_id: string; student: string; grade_id: number | null; subject: string; teacher: string; rows: Row[]; entered: Entered; done: number }
type View = "timeline" | "grouped";

const enteredOf = (s: string): Entered => (s === "confirmed" ? "entered" : s === "rejected" ? "rejected" : "pending");
const BADGE: Record<Entered, { label: string; cls: string; dot: string }> = {
  entered:  { label: "Entered in Red Comet", cls: "bg-emerald-50 text-emerald-deep border-emerald-200", dot: "bg-emerald-500" },
  pending:  { label: "Not yet in Red Comet", cls: "bg-amber-50 text-amber-800 border-amber-200",       dot: "bg-amber-400" },
  rejected: { label: "Not used",             cls: "bg-gray-100 text-gray-500 border-gray-200",          dot: "bg-gray-300" },
};
const DAYS_OPEN = 14;   // timeline: days shown by default; older days sit behind "Show earlier"
const VIEW_KEY = "falah.redcomet.view";

export default function RedComet() {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const lastMonth = shiftMonth(thisMonth, -1);
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || "timeline"; } catch { return "timeline"; } });
  const [monthF, setMonthF] = useState<"both" | string>("both");
  const [gradeF, setGradeF] = useState<number | "">("");
  const [studentF, setStudentF] = useState("");
  const [subjectF, setSubjectF] = useState("");
  const [teacherF, setTeacherF] = useState("");
  const [sp] = useSearchParams();   // /admin/redcomet?status=pending from the Dashboard tile
  const [statusF, setStatusF] = useState<"" | Entered>(() => { const v = sp.get("status"); return v === "pending" || v === "entered" || v === "rejected" ? v : ""; });
  const [showUpload, setShowUpload] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  // grouped view: explicit open/closed per node; nodes not listed use the level default
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [allState, setAllState] = useState<boolean | null>(null);   // Expand all / Collapse all override

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* private window */ } }, [view]);
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
  const gradeOrder = (gid: number | null) => grades.findIndex((g) => g.id === gid);
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
      const c = m.get(key) ?? { key, day: r.taken_at, enrollment_id: r.enrollment_id, student: studentName(r), grade_id: r.enrollments?.grade_id ?? null, subject, teacher: teacherName(r), rows: [], entered: "entered" as Entered, done: 0 };
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
  const sortCards = (l: Card[]) => l.sort((a, b) => gradeOrder(a.grade_id) - gradeOrder(b.grade_id) || a.student.localeCompare(b.student) || a.subject.localeCompare(b.subject));

  // timeline: by day, newest first
  const days = useMemo(() => {
    const m: Record<string, Card[]> = {};
    cards.forEach((c) => (m[c.day] ??= []).push(c));
    Object.values(m).forEach(sortCards);
    return Object.keys(m).sort((a, b) => (a < b ? 1 : -1)).map((d) => [d, m[d]] as const);
  }, [cards, grades]);
  const shownDays = showAll ? days : days.slice(0, DAYS_OPEN);
  const hiddenDays = days.length - shownDays.length;

  // grouped: Month → Entered or not → Grade → Student → Subject → entries (newest first)
  const ENT_ORDER: Record<Entered, number> = { pending: 0, entered: 1, rejected: 2 };
  interface Node { key: string; label: string; level: number; cards: Card[]; children: Node[] }
  const tree = useMemo(() => {
    const build = (list: Card[], level: number, parentKey: string): Node[] => {
      const groups = new Map<string, { label: string; sort: string | number; cards: Card[] }>();
      list.forEach((c) => {
        const [id, label, sort]: [string, string, string | number] =
          level === 0 ? [c.day.slice(0, 7), monthLabel(c.day.slice(0, 7)), c.day.slice(0, 7)] :
          level === 1 ? [c.entered, BADGE[c.entered].label, ENT_ORDER[c.entered]] :
          level === 2 ? [String(c.grade_id), gradeName(c.grade_id), gradeOrder(c.grade_id)] :
          level === 3 ? [c.enrollment_id, c.student, c.student] : [c.subject, c.subject, c.subject];
        const g = groups.get(id) ?? { label, sort, cards: [] };
        g.cards.push(c); groups.set(id, g);
      });
      return [...groups.entries()]
        .sort((a, b) => level === 0 ? (a[1].sort < b[1].sort ? 1 : -1) : a[1].sort < b[1].sort ? -1 : a[1].sort > b[1].sort ? 1 : 0)
        .map(([id, g]) => {
          const key = `${parentKey}/${id}`;
          return { key, label: g.label, level, cards: g.cards, children: level < 4 ? build(g.cards, level + 1, key) : [] };
        });
    };
    return build(cards, 0, "");
  }, [cards, grades]);
  // defaults: current month, its status groups and grades open; students and subjects closed
  const isOpen = (n: Node) => open[n.key] ?? allState ?? (n.level === 0 ? n.key === `/${thisMonth}` : n.level <= 2);
  const toggle = (k: string, now: boolean) => setOpen((o) => ({ ...o, [k]: !now }));
  const setAll = (v: boolean) => { setOpen({}); setAllState(v); };

  const counts = useMemo(() => ({
    photos: visible.length,
    entered: cards.filter((c) => c.entered === "entered").length,
    pending: cards.filter((c) => c.entered === "pending").length,
    students: new Set(visible.map((r) => r.enrollment_id)).size,
  }), [visible, cards]);

  const sel = "rounded border border-gray-300 bg-white px-2 py-1 text-sm";
  const anyFilter = monthF !== "both" || gradeF !== "" || studentF || subjectF || teacherF || statusF;
  const ago = (d: string) => { const n = Math.round((new Date(today + "T00:00:00").getTime() - new Date(d + "T00:00:00").getTime()) / 86400000); return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
  const card = (c: Card, withDay = false) => <EntryCard key={c.key} c={c} grades={grades} thumbs={thumbs} onBig={setBig} withDay={withDay} gradeName={gradeName} />;

  function renderNode(n: Node) {
    const o = isOpen(n);
    const pend = n.cards.filter((c) => c.entered === "pending").length;
    const entd = n.cards.filter((c) => c.entered === "entered").length;
    const photos = n.cards.reduce((s, c) => s + c.rows.length, 0);
    const pad = ["", "ml-4 sm:ml-6", "ml-8 sm:ml-12", "ml-12 sm:ml-18", "ml-16 sm:ml-24"][n.level];
    const head = ["text-base font-bold text-navy", "text-sm font-bold", "text-sm font-semibold text-navy", "text-sm font-semibold text-gray-800", "text-sm text-gray-700"][n.level];
    const ent = n.level === 1 ? n.cards[0].entered : null;
    const chip = ent ? BADGE[ent].cls : n.level === 2 ? gradeColor(grades, n.cards[0].grade_id).chip : n.level === 4 ? "bg-emerald-50 text-emerald-deep border-emerald-100" : "";
    const nStudents = new Set(n.cards.map((c) => c.enrollment_id)).size;
    const sub = n.level === 3 ? `${n.children.length} subject${n.children.length === 1 ? "" : "s"}` : n.level < 3 ? `${nStudents} student${nStudents === 1 ? "" : "s"}` : "";
    return (
      <div key={n.key} className={`${pad} ${n.level === 0 ? "mb-3" : "mt-1.5"}`}>
        <button onClick={() => toggle(n.key, o)} aria-expanded={o}
          className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-silver/60 ${n.level === 0 ? "border-gray-200 bg-white shadow-sm" : "border-transparent bg-white/70"} ${pend && !o ? "border-l-4 border-l-amber-400" : ""}`}>
          <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${o ? "rotate-90" : ""}`}>▶</span>
          <span className={`${head} ${chip ? `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip}` : ""}`}>
            {ent && <span className={`h-2 w-2 rounded-full ${BADGE[ent].dot}`} />}{ent === "entered" ? "✓ " : ""}{n.label}
          </span>
          <span className="text-xs text-gray-400">{sub}{sub ? " · " : ""}{n.cards.length} {n.cards.length === 1 ? "entry" : "entries"} · {photos} photo{photos === 1 ? "" : "s"}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
            {n.level !== 1 && pend > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" title="not yet in Red Comet">{pend} not yet</span>}
            {n.level !== 1 && entd > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-deep" title="entered in Red Comet">✓ {entd}</span>}
          </span>
        </button>
        {o && (n.level < 4
          ? n.children.map(renderNode)
          : <div className="ml-6 mt-2 space-y-2 sm:ml-8">{[...n.cards].sort((a, b) => (a.day < b.day ? 1 : -1)).map((c) => card(c, true))}</div>)}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Red Comet</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm">
            {(["timeline", "grouped"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1 ${view === v ? "bg-navy font-semibold text-white" : "text-gray-600 hover:bg-silver"}`}>
                {v === "timeline" ? "Timeline" : "Grouped"}
              </button>
            ))}
          </div>
          {view === "grouped" && (
            <>
              <button onClick={() => setAll(true)} className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-silver">Expand all</button>
              <button onClick={() => setAll(false)} className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-silver">Collapse all</button>
            </>
          )}
          <button onClick={() => setShowUpload((v) => !v)} className={`rounded border px-3 py-1 text-sm font-semibold ${showUpload ? "border-navy bg-navy text-white" : "border-navy/30 bg-white text-navy hover:bg-silver"}`}>
            {showUpload ? "Close upload" : "Upload photos"}
          </button>
          <button onClick={load} className="rounded border border-gray-300 bg-white px-3 py-1 text-sm text-gray-600 hover:bg-silver">Refresh</button>
        </div>
      </div>
      <p className="mb-4 text-sm text-gray-500">
        Workbook pages the teachers sent from the teacher app, {monthLabel(lastMonth)} and {monthLabel(thisMonth)}.
        {view === "timeline" ? " Newest first; each entry is one student, one subject, one day." : " Grouped by month, entered or not, grade, student and subject; click a row to open or close it."}
        {" "}The badge says whether those pages have been entered in Red Comet yet; it updates on its own as the office works through the OneDrive inbox.
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

      {showUpload && <AdminUpload grades={grades} onDone={() => { load(); }} />}

      {view === "grouped" ? (
        <div>{tree.map(renderNode)}</div>
      ) : (
        <>
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
                  <div className="space-y-3">{list.map((c) => card(c))}</div>
                </li>
              );
            })}
          </ol>
          {hiddenDays > 0 && (
            <button onClick={() => setShowAll(true)} className="mt-6 w-full rounded-xl border border-dashed border-gray-300 bg-white p-3 text-sm font-semibold text-royal hover:bg-silver/60">
              Show {hiddenDays} earlier {hiddenDays === 1 ? "day" : "days"}
            </button>
          )}
        </>
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

function EntryCard({ c, grades, thumbs, onBig, withDay, gradeName }: {
  c: Card; grades: GradeLite[]; thumbs: Record<string, string>; onBig: (u: string) => void; withDay: boolean; gradeName: (g: number | null) => string;
}) {
  const col = gradeColor(grades, c.grade_id); const b = BADGE[c.entered]; const used = c.rows.filter((r) => r.status !== "rejected").length;
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm ${c.entered === "pending" ? "border-amber-200" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {withDay && <span className="text-xs font-bold text-gray-500">{usDate(c.day)}</span>}
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.cls}`}>
          <span className={`h-2 w-2 rounded-full ${b.dot}`} />{c.entered === "entered" ? "✓ " : ""}{b.label}
          {c.entered === "pending" && c.done > 0 ? ` (${c.done} of ${used} done)` : ""}
        </span>
        {!withDay && <>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${col.chip}`}>{gradeName(c.grade_id)}</span>
          <span className="font-semibold text-navy">{c.student}</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-deep">{c.subject}</span>
        </>}
        <span className="text-xs text-gray-400">{c.rows.length} photo{c.rows.length === 1 ? "" : "s"}</span>
        <span className="ml-auto text-xs text-gray-400">{c.teacher}</span>
      </div>
      {c.rows.some((r) => r.note) && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{[...new Set(c.rows.map((r) => r.note).filter(Boolean))].join(" · ")}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.rows.map((r) => thumbs[r.path]
          ? <button key={r.id} onClick={() => onBig(thumbs[r.path])} title={`#${r.id} · ${BADGE[enteredOf(r.status)].label}`}
              className={`relative h-24 w-24 overflow-hidden rounded-lg border bg-silver hover:ring-2 hover:ring-royal ${r.status === "confirmed" ? "border-emerald-300" : r.status === "rejected" ? "border-gray-200 opacity-50" : "border-amber-300"}`}>
              <img src={thumbs[r.path]} alt="" loading="lazy" className="h-full w-full object-cover" />
              {r.status === "confirmed" && <span className="absolute bottom-1 right-1 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">✓</span>}
            </button>
          : <div key={r.id} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-400">loading…</div>)}
      </div>
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

// Office upload: the admin photographs or picks workbook pages for any student in
// any grade. Same bucket, same `work_uploads` row as the teacher app, so the
// hourly pull and the status follow the usual path. (President 2026-10-28)
const RC_SUBJECTS = ["English", "Maths", "Science"];
interface Enr { id: string; grade_id: number; students: { first_name: string; last_name: string } }
interface Picked { file: File; url: string }
function AdminUpload({ grades, onDone }: { grades: GradeLite[]; onDone: () => void }) {
  const { profile } = useAuth();
  const [enrs, setEnrs] = useState<Enr[]>([]);
  const [gradeId, setGradeId] = useState<number | "">("");
  const [enr, setEnr] = useState("");
  const [subject, setSubject] = useState("English");
  const [other, setOther] = useState("");
  const [day, setDay] = useState(todayISO());
  const [note, setNote] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (configMissing) return;
    supabase.from("enrollments").select("id, grade_id, students ( first_name, last_name )").eq("status", "active")
      .then(({ data }) => setEnrs(((data as unknown as Enr[]) ?? []).sort((a, b) => `${a.students.first_name} ${a.students.last_name}`.localeCompare(`${b.students.first_name} ${b.students.last_name}`))));
  }, []);
  const options = enrs.filter((e) => gradeId === "" || e.grade_id === gradeId);
  const student = enrs.find((e) => e.id === enr);
  const finalSubject = subject === "Other" ? other.trim() : subject;

  function pick(files: FileList | null) {
    if (!files) return;
    // read the FileList now: the input is cleared right after this call, and a lazy updater would see it empty
    const add = Array.from(files).filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPicked((p) => [...p, ...add]);
    setMsg(null);
  }
  function unpick(i: number) { setPicked((p) => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i); }); }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!enr) return setMsg({ ok: false, text: "Choose the student first." });
    if (!finalSubject) return setMsg({ ok: false, text: "Give the subject a name." });
    if (!picked.length) return setMsg({ ok: false, text: "Add at least one photo." });
    setMsg(null);
    let done = 0;
    for (const p of [...picked]) {
      setBusy(`Uploading ${done + 1} of ${picked.length}…`);
      const blob = await compressImage(p.file);
      const path = `${enr}/${day}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("student-work").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(null); return setMsg({ ok: false, text: `Photo failed: ${up.error.message}. ${done} uploaded; the rest are still selected, press Upload again.` }); }
      const { error } = await supabase.from("work_uploads").insert({ enrollment_id: enr, path, subject: finalSubject, note: note.trim() || null, taken_at: day, uploaded_by: profile?.id ?? null });
      if (error) { setBusy(null); return setMsg({ ok: false, text: `Photo stored but not recorded: ${error.message}` }); }
      done++;
      setPicked((prev) => prev.filter((x) => x !== p));
      URL.revokeObjectURL(p.url);
    }
    setBusy(null); setNote("");
    setMsg({ ok: true, text: `${done} photo${done === 1 ? "" : "s"} uploaded for ${student ? `${student.students.first_name} ${student.students.last_name}` : "the student"} (${finalSubject}, ${usDate(day)}). They now show below as "Not yet in Red Comet" and reach the OneDrive inbox within the hour.` });
    onDone();
  }

  const inp = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
  const lab = "block text-xs font-semibold text-gray-500";
  const tile = "flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 hover:bg-silver";
  return (
    <form onSubmit={upload} className="mb-6 rounded-xl border border-navy/20 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-lg font-semibold text-navy">Upload workbook photos</div>
        <div className="text-xs text-gray-400">For any student in any grade · same path as the teacher app</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className={lab}>Grade
          <select value={gradeId} onChange={(e) => { setGradeId(e.target.value === "" ? "" : Number(e.target.value)); setEnr(""); }} className={inp}>
            <option value="">All grades</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className={lab}>Student
          <select value={enr} onChange={(e) => { setEnr(e.target.value); setMsg(null); }} className={`${inp} ${!enr ? "border-amber-400 bg-amber-50" : ""}`}>
            <option value="">Choose the student…</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.students.first_name} {o.students.last_name}{gradeId === "" ? ` · ${grades.find((g) => g.id === o.grade_id)?.name ?? ""}` : ""}</option>)}
          </select>
        </label>
        <label className={lab}>Subject
          <select value={subject} onChange={(e) => setSubject(e.target.value)} className={inp}>
            {RC_SUBJECTS.map((s) => <option key={s}>{s}</option>)}
            <option>Other</option>
          </select>
          {subject === "Other" && <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Subject name" className={inp} />}
        </label>
        <label className={lab}>Date of the work
          <input type="date" value={day} max={todayISO()} onChange={(e) => setDay(e.target.value)} className={inp} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {picked.map((p, i) => (
          <div key={p.url} className="relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200 bg-silver">
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            <button type="button" onClick={() => unpick(i)} aria-label="Remove" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">✕</button>
          </div>
        ))}
        <label className={tile}>
          <span className="text-xl leading-none">＋</span>
          <span className="mt-0.5 text-[10px] font-semibold">Add photos</span>
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </label>
        <label className={`${tile} sm:hidden`}>
          <span className="text-xl leading-none">📷</span>
          <span className="mt-0.5 text-[10px] font-semibold">Camera</span>
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
        </label>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, e.g. unit 3 pages 12–15 (optional)" className={`${inp} mt-3`} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!!busy} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">
          {busy ?? `Upload ${picked.length || ""} photo${picked.length === 1 ? "" : "s"}`}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-deep" : "text-red-700"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
