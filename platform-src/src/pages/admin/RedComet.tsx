// Admin → Red Comet. Every workbook photo the teachers send from the teacher
// app (Red Comet tab → `work_uploads` + private `student-work` bucket), for the
// last 12 months. Two views: a timeline (newest
// first) and a grouped accordion Month → Grade → Student → Subject → Date
// (President 2026-11-01; the entered/not badge sits on each entry) that opens
// and closes at every level. One entry per student + subject + day with the
// photos as thumbnails; filters for month, grade, student, subject, teacher and
// status. The status answers one question — were these pages entered in Red
// Comet or not? — and follows scripts/redcomet-pull.py: confirmed = entered;
// new/drafted = not yet; rejected = not used. (President 2026-10-28)
// Phase 31 (2026-10-31): own staff module 'redcomet'; "Select photos" → Delete for
// photos not yet entered (the database refuses entered ones; the hourly pull removes
// the OneDrive copy); the hourly photo check (GitHub Actions + CLIP) flags photos that
// do not look like workbook pages — they show red, with "It is school work" to clear.
// 2026-11-01 (President): the last 12 months instead of two; thumbnails are signed
// only when their entry is on screen (keeps Supabase egress on the free plan); hover
// a photo → tick box to select, Delete bar at the bottom (no separate select mode).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  check_status?: string; check_label?: string | null; page_last?: number | null; kind?: string;
  enrollments: { grade_id: number; students: { first_name: string; last_name: string } } | null;
  profiles: { full_name: string | null } | null;
}
type Entered = "entered" | "pending" | "rejected";
interface Card { key: string; day: string; enrollment_id: string; student: string; grade_id: number | null; subject: string; teacher: string; rows: Row[]; entered: Entered; done: number; flagged: number }
type View = "timeline" | "grouped";

const enteredOf = (s: string): Entered => (s === "confirmed" ? "entered" : s === "rejected" ? "rejected" : "pending");
const BADGE: Record<Entered, { label: string; cls: string; dot: string }> = {
  entered:  { label: "Entered in Red Comet", cls: "bg-emerald-50 text-emerald-deep border-emerald-200", dot: "bg-emerald-500" },
  pending:  { label: "Not yet in Red Comet", cls: "bg-amber-50 text-amber-800 border-amber-200",       dot: "bg-amber-400" },
  rejected: { label: "Not used",             cls: "bg-gray-100 text-gray-500 border-gray-200",          dot: "bg-gray-300" },
};
const DAYS_OPEN = 14;   // timeline: days shown by default; older days sit behind "Show earlier"
const VIEW_KEY = "falah.redcomet.view";
const MONTHS = 12;      // months loaded (this month and the 11 before)
const PAGE = 1000;      // PostgREST returns at most 1000 rows per request
const SIGN_TTL = 3600;  // signed thumbnail links last an hour

export default function RedComet() {
  const today = todayStr();
  const thisMonth = today.slice(0, 7);
  const firstMonth = shiftMonth(thisMonth, -(MONTHS - 1));
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem(VIEW_KEY) as View) || "timeline"; } catch { return "timeline"; } });
  const [monthF, setMonthF] = useState<"all" | string>("all");
  const [gradeF, setGradeF] = useState<number | "">("");
  const [studentF, setStudentF] = useState("");
  const [subjectF, setSubjectF] = useState("");
  const [teacherF, setTeacherF] = useState("");
  const [sp] = useSearchParams();   // /admin/redcomet?status=pending from the Dashboard tile
  const [statusF, setStatusF] = useState<"" | Entered>(() => { const v = sp.get("status"); return v === "pending" || v === "entered" || v === "rejected" ? v : ""; });
  const [checkF, setCheckF] = useState(sp.get("check") === "flagged");   // only photos the photo check flagged
  const { can } = useAuth();
  const canEdit = can("redcomet", "edit");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const selecting = picked.size > 0;   // ticking the first box starts a selection
  const [busy, setBusy] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
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
    setLoading(true); setMsg(null);
    const from = monthRange(firstMonth)[0];
    const to = monthRange(thisMonth)[1];
    const list: Row[] = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error } = await supabase.from("work_uploads")
        .select("id, enrollment_id, path, taken_at, subject, note, status, created_at, uploaded_by, check_status, check_label, page_last, kind, enrollments ( grade_id, students ( first_name, last_name ) ), profiles:uploaded_by ( full_name )")
        .gte("taken_at", from).lte("taken_at", to)
        .order("taken_at", { ascending: false }).order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(off, off + PAGE - 1);
      if (error) { setMsg("Could not load: " + error.message); break; }
      const page = (data as unknown as Row[]) ?? [];
      list.push(...page);
      if (page.length < PAGE) break;
    }
    setRows(list);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Thumbnails are signed only when an entry is on screen (EntryCard asks for its
  // paths); requests are batched, 100 paths per call. The <img> itself is lazy, so a
  // photo is downloaded only when it scrolls into view — 12 months cost no more egress
  // than two unless someone actually scrolls through them.
  const asked = useRef<Set<string>>(new Set());
  const queue = useRef<Set<string>>(new Set());
  const timer = useRef<number | null>(null);
  const need = useCallback((paths: string[]) => {
    paths.forEach((p) => { if (!asked.current.has(p)) { asked.current.add(p); queue.current.add(p); } });
    if (!queue.current.size || timer.current) return;
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      const all = [...queue.current]; queue.current.clear();
      for (let i = 0; i < all.length; i += 100) {
        const chunk = all.slice(i, i + 100);
        const { data: signed } = await supabase.storage.from("student-work").createSignedUrls(chunk, SIGN_TTL);
        const add: Record<string, string> = {};
        // a path with no image file is marked "" (shown as "no image") and not asked again
        (signed ?? []).forEach((s, j) => { add[chunk[j]] = s.signedUrl || ""; });
        setThumbs((t) => ({ ...t, ...add }));
      }
    }, 30);
  }, []);
  // signed links expire after an hour: forget them so open entries ask again
  useEffect(() => {
    const t = window.setInterval(() => { asked.current.clear(); setThumbs({}); }, (SIGN_TTL - 120) * 1000);
    return () => window.clearInterval(t);
  }, []);
  // Esc clears a selection
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setPicked(new Set()); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const months = useMemo(() => [...new Set(rows.map((r) => r.taken_at.slice(0, 7)))].sort().reverse(), [rows]);

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
    (monthF === "all" || r.taken_at.slice(0, 7) === monthF) &&
    (gradeF === "" || r.enrollments?.grade_id === gradeF) &&
    (!studentF || r.enrollment_id === studentF) &&
    (!subjectF || (r.subject ?? "No subject") === subjectF) &&
    (!teacherF || teacherName(r) === teacherF) &&
    (!statusF || enteredOf(r.status) === statusF) &&
    (!checkF || r.check_status === "flagged")), [rows, monthF, gradeF, studentF, subjectF, teacherF, statusF, checkF]);

  // one entry per day + student + subject (a teacher's one "Send" for that subject)
  const cards = useMemo(() => {
    const m = new Map<string, Card>();
    visible.forEach((r) => {
      const subject = r.subject ?? "No subject";
      const key = `${r.taken_at}|${r.enrollment_id}|${subject}`;
      const c = m.get(key) ?? { key, day: r.taken_at, enrollment_id: r.enrollment_id, student: studentName(r), grade_id: r.enrollments?.grade_id ?? null, subject, teacher: teacherName(r), rows: [], entered: "entered" as Entered, done: 0, flagged: 0 };
      c.rows.push(r);
      m.set(key, c);
    });
    m.forEach((c) => {
      const used = c.rows.filter((r) => r.status !== "rejected");
      c.done = used.filter((r) => r.status === "confirmed").length;
      c.entered = !used.length ? "rejected" : c.done === used.length ? "entered" : "pending";
      c.flagged = c.rows.filter((r) => r.check_status === "flagged").length;
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

  // grouped: Month → Grade → Student → Subject → entries by date (newest first)
  interface Node { key: string; label: string; level: number; cards: Card[]; children: Node[] }
  const tree = useMemo(() => {
    const build = (list: Card[], level: number, parentKey: string): Node[] => {
      const groups = new Map<string, { label: string; sort: string | number; cards: Card[] }>();
      list.forEach((c) => {
        const [id, label, sort]: [string, string, string | number] =
          level === 0 ? [c.day.slice(0, 7), monthLabel(c.day.slice(0, 7)), c.day.slice(0, 7)] :
          level === 1 ? [String(c.grade_id), gradeName(c.grade_id), gradeOrder(c.grade_id)] :
          level === 2 ? [c.enrollment_id, c.student, c.student] : [c.subject, c.subject, c.subject];
        const g = groups.get(id) ?? { label, sort, cards: [] };
        g.cards.push(c); groups.set(id, g);
      });
      return [...groups.entries()]
        .sort((a, b) => level === 0 ? (a[1].sort < b[1].sort ? 1 : -1) : a[1].sort < b[1].sort ? -1 : a[1].sort > b[1].sort ? 1 : 0)
        .map(([id, g]) => {
          const key = `${parentKey}/${id}`;
          return { key, label: g.label, level, cards: g.cards, children: level < 3 ? build(g.cards, level + 1, key) : [] };
        });
    };
    return build(cards, 0, "");
  }, [cards, grades]);
  // defaults: the newest month with photos (not the calendar month, which is empty on the 1st),
  // and its grades open; students and subjects closed
  const isOpen = (n: Node) => open[n.key] ?? allState ?? (n.level === 0 ? n.key === tree[0]?.key : n.level <= 1);
  const toggle = (k: string, now: boolean) => setOpen((o) => ({ ...o, [k]: !now }));
  const setAll = (v: boolean) => { setOpen({}); setAllState(v); };

  const counts = useMemo(() => ({
    photos: visible.length,
    entered: cards.filter((c) => c.entered === "entered").length,
    pending: cards.filter((c) => c.entered === "pending").length,
    students: new Set(visible.map((r) => r.enrollment_id)).size,
    flagged: rows.filter((r) => r.check_status === "flagged").length,
  }), [visible, cards, rows]);

  // ---- delete (phase 31): only photos not yet entered in Red Comet ----
  const deletable = (r: Row) => r.status !== "confirmed";
  function togglePick(r: Row) {
    if (!deletable(r)) return;
    setPicked((s) => { const n = new Set(s); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n; });
  }
  function pickMany(list: Row[], on: boolean) {
    setPicked((s) => { const n = new Set(s); list.filter(deletable).forEach((r) => (on ? n.add(r.id) : n.delete(r.id))); return n; });
  }
  async function deleteRows(ids: number[]) {
    if (!ids.length) return;
    const n = ids.length;
    if (!confirm(`Delete ${n} photo${n === 1 ? "" : "s"}?\n\nThey disappear from the portal now and from the office OneDrive within the hour. This cannot be undone.`)) return;
    setBusy(`Deleting ${n}…`); setMsg(null); setOkMsg(null);
    const { data, error } = await supabase.from("work_uploads").delete().in("id", ids).select("id, path");
    if (error) { setBusy(null); setMsg("Could not delete: " + error.message); return; }
    const gone = (data as { id: number; path: string }[]) ?? [];
    let storageNote = "";
    if (gone.length) {
      const { error: e2 } = await supabase.storage.from("student-work").remove(gone.map((g) => g.path));
      if (e2) storageNote = ` (the image files could not all be removed: ${e2.message})`;
    }
    setBusy(null); setPicked(new Set());
    const skipped = n - gone.length;
    setOkMsg(`${gone.length} photo${gone.length === 1 ? "" : "s"} deleted${skipped ? `, ${skipped} not deleted (already entered or not allowed)` : ""}. The OneDrive copies go on the next hourly run.${storageNote}`);
    load();
  }
  async function clearFlag(ids: number[]) {
    if (!ids.length) return;
    setBusy("Saving…"); setMsg(null); setOkMsg(null);
    const { error } = await supabase.from("work_uploads").update({ check_status: "cleared" }).in("id", ids);
    setBusy(null);
    if (error) { setMsg("Could not save: " + error.message); return; }
    setOkMsg(`${ids.length} photo${ids.length === 1 ? "" : "s"} marked as school work; ${ids.length === 1 ? "it goes" : "they go"} to the office OneDrive on the next hourly run.`);
    load();
  }

  const sel = "rounded border border-gray-300 bg-white px-2 py-1 text-sm";
  const anyFilter = monthF !== "all" || gradeF !== "" || studentF || subjectF || teacherF || statusF || checkF;
  const ago = (d: string) => { const n = Math.round((new Date(today + "T00:00:00").getTime() - new Date(d + "T00:00:00").getTime()) / 86400000); return n === 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };
  const card = (c: Card, withDay = false) => <EntryCard key={c.key} c={c} grades={grades} thumbs={thumbs} onBig={setBig} withDay={withDay} gradeName={gradeName}
    selecting={selecting} picked={picked} onPick={togglePick} onPickAll={pickMany} canEdit={canEdit} busy={!!busy}
    onDelete={deleteRows} onClear={clearFlag} need={need} />;

  function renderNode(n: Node) {
    const o = isOpen(n);
    const pend = n.cards.filter((c) => c.entered === "pending").length;
    const entd = n.cards.filter((c) => c.entered === "entered").length;
    const photos = n.cards.reduce((s, c) => s + c.rows.length, 0);
    const pad = ["", "ml-4 sm:ml-6", "ml-8 sm:ml-12", "ml-12 sm:ml-18"][n.level];
    const head = ["text-base font-bold text-navy", "text-sm font-semibold text-navy", "text-sm font-semibold text-gray-800", "text-sm text-gray-700"][n.level];
    const chip = n.level === 1 ? gradeColor(grades, n.cards[0].grade_id).chip : n.level === 3 ? "bg-emerald-50 text-emerald-deep border-emerald-100" : "";
    const nStudents = new Set(n.cards.map((c) => c.enrollment_id)).size;
    const sub = n.level === 2 ? `${n.children.length} subject${n.children.length === 1 ? "" : "s"}` : n.level < 2 ? `${nStudents} student${nStudents === 1 ? "" : "s"}` : "";
    return (
      <div key={n.key} className={`${pad} ${n.level === 0 ? "mb-3" : "mt-1.5"}`}>
        <button onClick={() => toggle(n.key, o)} aria-expanded={o}
          className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-silver/60 ${n.level === 0 ? "border-gray-200 bg-white shadow-sm" : "border-transparent bg-white/70"} ${pend && !o ? "border-l-4 border-l-amber-400" : ""}`}>
          <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${o ? "rotate-90" : ""}`}>▶</span>
          <span className={`${head} ${chip ? `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${chip}` : ""}`}>
            {n.label}
          </span>
          <span className="text-xs text-gray-400">{sub}{sub ? " · " : ""}{n.cards.length} {n.cards.length === 1 ? "entry" : "entries"} · {photos} photo{photos === 1 ? "" : "s"}</span>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-semibold">
            {pend > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800" title="not yet in Red Comet">{pend} not yet</span>}
            {entd > 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-deep" title="entered in Red Comet">✓ {entd}</span>}
          </span>
        </button>
        {o && (n.level < 3
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
        Workbook pages the teachers sent from the teacher app over the last 12 months ({monthLabel(firstMonth)} – {monthLabel(thisMonth)}).
        {view === "timeline" ? " Newest first; each entry is one student, one subject, one day." : " Grouped by month, grade, student and subject, then by date; click a row to open or close it."}
        {" "}The badge says whether those pages have been entered in Red Comet yet; it updates on its own as the office works through the OneDrive inbox.
        {canEdit && " To delete, hover over a photo and tick its box (on a phone the boxes are always shown); photos already entered in Red Comet (✓) cannot be deleted."}
        {loading ? " Loading…" : ""}
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {okMsg && <div className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-deep">{okMsg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      {/* summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Not yet in Red Comet" value={counts.pending} tone="amber" onClick={() => setStatusF(statusF === "pending" ? "" : "pending")} active={statusF === "pending"} />
        <Stat label="Entered in Red Comet" value={counts.entered} tone="emerald" onClick={() => setStatusF(statusF === "entered" ? "" : "entered")} active={statusF === "entered"} />
        {counts.flagged > 0
          ? <Stat label="Needs a look" value={counts.flagged} tone="red" onClick={() => setCheckF(!checkF)} active={checkF} />
          : <Stat label="Photos" value={counts.photos} />}
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
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={checkF} onChange={(e) => setCheckF(e.target.checked)} /> Needs a look only
        </label>
        <select value={monthF} onChange={(e) => setMonthF(e.target.value)} className={sel}>
          <option value="all">All 12 months</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
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
          <button onClick={() => { setMonthF("all"); setGradeF(""); setStudentF(""); setSubjectF(""); setTeacherF(""); setStatusF(""); setCheckF(false); }}
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
          No Red Comet photos{anyFilter ? " match these filters" : " in the last 12 months"}.
        </p>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-4 z-[60] mx-auto flex w-fit items-center gap-3 rounded-full bg-navy px-5 py-2.5 text-sm text-white shadow-2xl">
          <span className="font-semibold">{picked.size} selected</span>
          <button onClick={() => deleteRows([...picked])} disabled={!!busy}
            className="rounded-full bg-red-600 px-4 py-1.5 font-semibold hover:bg-red-700 disabled:opacity-50">{busy ?? `Delete ${picked.size}`}</button>
          <button onClick={() => setPicked(new Set())} className="text-white/70 underline hover:text-white" title="Esc">Clear</button>
        </div>
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

function EntryCard({ c, grades, thumbs, onBig, withDay, gradeName, selecting, picked, onPick, onPickAll, canEdit, busy, onDelete, onClear, need }: {
  c: Card; grades: GradeLite[]; thumbs: Record<string, string>; onBig: (u: string) => void; withDay: boolean; gradeName: (g: number | null) => string;
  selecting: boolean; picked: Set<number>; onPick: (r: Row) => void; onPickAll: (rows: Row[], on: boolean) => void; canEdit: boolean; busy: boolean;
  onDelete: (ids: number[]) => void; onClear: (ids: number[]) => void; need: (paths: string[]) => void;
}) {
  // ask for signed thumbnails only while this entry is on screen
  useEffect(() => {
    const missing = c.rows.map((r) => r.path).filter((p) => thumbs[p] === undefined);
    if (missing.length) need(missing);
  }, [c.rows, thumbs, need]);
  const flaggedRows = c.rows.filter((r) => r.check_status === "flagged");
  const pickable = canEdit ? c.rows.filter((r) => r.status !== "confirmed") : [];
  const allPicked = pickable.length > 0 && pickable.every((r) => picked.has(r.id));
  const col = gradeColor(grades, c.grade_id); const b = BADGE[c.entered]; const used = c.rows.filter((r) => r.status !== "rejected").length;
  return (
    <div className={`group/card rounded-xl border bg-white p-4 shadow-sm ${c.flagged ? "border-red-300 ring-1 ring-red-200" : c.entered === "pending" ? "border-amber-200" : "border-gray-200"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {withDay && <span className="text-sm font-bold text-navy">{usDate(c.day)}</span>}
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
        {pickable.length > 1 && (
          <button onClick={() => onPickAll(pickable, !allPicked)}
            className={`rounded border border-red-200 px-2 py-0.5 text-xs font-semibold text-red-700 hover:bg-red-50 ${selecting ? "" : "opacity-0 focus:opacity-100 group-hover/card:opacity-100 [@media(hover:none)]:opacity-100"}`}>
            {allPicked ? "Unselect all" : "Select all"}
          </button>
        )}
        <span className="ml-auto text-xs text-gray-400">{c.teacher}</span>
      </div>
      {flaggedRows.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="font-semibold">⚠ {flaggedRows.length} photo{flaggedRows.length === 1 ? "" : "s"} may not be a workbook page</span>
          <span className="text-red-700/80">({[...new Set(flaggedRows.map((r) => r.check_label).filter(Boolean))].join(", ") || "photo check"})</span>
          {canEdit && <>
            <button disabled={busy} onClick={() => onClear(flaggedRows.map((r) => r.id))} className="ml-auto rounded border border-emerald-300 bg-white px-2 py-0.5 font-semibold text-emerald-deep hover:bg-emerald-50 disabled:opacity-50">It is school work</button>
            <button disabled={busy} onClick={() => onDelete(flaggedRows.filter((r) => r.status !== "confirmed").map((r) => r.id))} className="rounded border border-red-300 bg-white px-2 py-0.5 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">Delete</button>
          </>}
        </div>
      )}
      {c.rows.some((r) => r.kind === "test") && <p className="mt-1.5 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-800">TEST / QUIZ — enter answers exactly as marked</p>}
      {c.rows.some((r) => r.page_last) && (
        <p className="mt-1.5 text-xs font-semibold text-navy">Up to page {Math.max(...c.rows.map((r) => r.page_last ?? 0))}</p>
      )}
      {c.rows.some((r) => r.note) && (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{[...new Set(c.rows.map((r) => r.note).filter(Boolean))].join(" · ")}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {c.rows.map((r) => {
          const can = pickable.includes(r); const on = picked.has(r.id);
          if (!thumbs[r.path]) return <div key={r.id} title={`#${r.id}`} className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed border-gray-300 text-[10px] text-gray-400">{thumbs[r.path] === "" ? "no image" : "loading…"}</div>;
          return (
            <div key={r.id} className={`group relative h-24 w-24 overflow-hidden rounded-lg border bg-silver ${r.check_status === "flagged" ? "border-2 border-red-500" : r.status === "confirmed" ? "border-emerald-300" : r.status === "rejected" ? "border-gray-200 opacity-50" : "border-amber-300"} ${on ? "ring-4 ring-red-500" : "hover:ring-2 hover:ring-royal"}`}>
              {/* click the photo: open it — or, while a selection is under way, add/remove it */}
              <button onClick={() => (selecting && can ? onPick(r) : onBig(thumbs[r.path]))} className="block h-full w-full"
                title={`#${r.id} · ${BADGE[enteredOf(r.status)].label}${r.check_status === "flagged" ? ` · needs a look (${r.check_label ?? "photo check"})` : ""}${canEdit && r.status === "confirmed" ? " · already entered, cannot be deleted" : ""}`}>
                <img src={thumbs[r.path]} alt="" loading="lazy" className={`h-full w-full object-cover ${on ? "scale-95" : ""}`} />
              </button>
              {r.status === "confirmed" && <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-emerald-600 px-1 text-[10px] font-bold text-white">✓</span>}
              {r.check_status === "flagged" && <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-red-600 px-1 text-[10px] font-bold text-white">⚠</span>}
              {can && (
                <button onClick={() => onPick(r)} role="checkbox" aria-checked={on} aria-label={on ? "Unselect photo" : "Select photo"}
                  className={`absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded border-2 text-sm font-bold shadow transition-opacity ${on ? "border-red-600 bg-red-600 text-white opacity-100" : `border-white bg-black/30 text-transparent hover:bg-black/50 ${selecting ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"}`}`}>✓</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone, onClick, active }: { label: string; value: number; tone?: "amber" | "emerald" | "red"; onClick?: () => void; active?: boolean }) {
  const toneCls = tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-deep" : tone === "red" ? "text-red-600" : "text-navy";
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
const RC_SUBJECTS = ["English", "Maths", "Science"];   // the only Red Comet courses the school offers (no "Other", President 2026-11-01)
interface Enr { id: string; grade_id: number; students: { first_name: string; last_name: string } }
interface Picked { file: File; url: string }
function AdminUpload({ grades, onDone }: { grades: GradeLite[]; onDone: () => void }) {
  const { profile } = useAuth();
  const [enrs, setEnrs] = useState<Enr[]>([]);
  const [gradeId, setGradeId] = useState<number | "">("");
  const [enr, setEnr] = useState("");
  const [subject, setSubject] = useState("English");
  const [day, setDay] = useState(todayISO());
  const [note, setNote] = useState("");
  const [page, setPage] = useState("");   // last workbook page in these photos (phase 37, required)
  const [lastPage, setLastPage] = useState<{ page: number; date: string } | null>(null);
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
  const finalSubject = subject;
  const pageOk = /^\d{1,4}$/.test(page.trim()) && Number(page) >= 1;
  async function loadLastPage() {
    if (!enr) { setLastPage(null); return; }
    const { data } = await supabase.from("work_uploads").select("page_last, taken_at").eq("enrollment_id", enr).eq("subject", subject)
      .not("page_last", "is", null).order("created_at", { ascending: false }).limit(1);
    const r = (data as { page_last: number; taken_at: string }[] | null)?.[0];
    setLastPage(r ? { page: r.page_last, date: r.taken_at } : null);
  }
  useEffect(() => { loadLastPage(); }, [enr, subject]);

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
    if (!picked.length) return setMsg({ ok: false, text: "Add at least one photo." });
    if (!pageOk) return setMsg({ ok: false, text: "Enter the last page number in these photos." });
    setMsg(null);
    let done = 0;
    for (const p of [...picked]) {
      setBusy(`Uploading ${done + 1} of ${picked.length}…`);
      const blob = await compressImage(p.file);
      const path = `${enr}/${day}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("student-work").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(null); return setMsg({ ok: false, text: `Photo failed: ${up.error.message}. ${done} uploaded; the rest are still selected, press Upload again.` }); }
      const { error } = await supabase.from("work_uploads").insert({ enrollment_id: enr, path, subject: finalSubject, note: note.trim() || null, page_last: Number(page), taken_at: day, uploaded_by: profile?.id ?? null });
      if (error) { setBusy(null); return setMsg({ ok: false, text: `Photo stored but not recorded: ${error.message}` }); }
      done++;
      setPicked((prev) => prev.filter((x) => x !== p));
      URL.revokeObjectURL(p.url);
    }
    setBusy(null); setNote(""); setPage(""); loadLastPage();
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
          </select>
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
      {enr && (
        <p className="mt-3 rounded-md bg-silver/70 px-2.5 py-1.5 text-xs text-navy">
          {subject} · Last Page uploaded: <b>{lastPage ? lastPage.page : "none yet"}</b>{lastPage && <span className="text-gray-500"> · {usDate(lastPage.date)}</span>}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className={lab}>Last page in these photos (required)
          <input type="number" inputMode="numeric" min={1} max={9999} value={page} onChange={(e) => { setPage(e.target.value); setMsg(null); }}
            placeholder={lastPage ? `after page ${lastPage.page}` : "page number"} className={`${inp} ${!pageOk ? "border-amber-400 bg-amber-50" : ""}`} />
        </label>
        <label className={lab}>Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. unit 3 test" className={inp} />
        </label>
      </div>
      {pageOk && lastPage && Number(page) <= lastPage.page && (
        <p className="mt-1 text-xs text-amber-700">That is not after the last page uploaded ({lastPage.page}). Check the number; upload anyway if it is right.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!!busy} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">
          {busy ?? `Upload ${picked.length || ""} photo${picked.length === 1 ? "" : "s"}`}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-deep" : "text-red-700"}`}>{msg.text}</span>}
      </div>
    </form>
  );
}
