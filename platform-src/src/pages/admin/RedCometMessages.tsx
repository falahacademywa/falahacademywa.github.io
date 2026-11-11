import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { presetRange, type Preset } from "../../lib/reports";
import { DateMenu, MultiSelect, StudentSelect, SearchBox, FilterTags } from "../../components/ReportControls";

// Red Comet → Messages (phase 44, President 2026-11-10): an inbox.
//   Tabs: Needs me (new + drafts to approve) · With Claude · To post · Done · All
//   One filter bar (search, subject, student by grade, teacher, dates) with removable filter tags.
//   List on the left, the open message on the right with its reply box; under it, the earlier
//   answered or ignored messages for the same student and subject as a carousel (collapsed).
// Claude saves the messages from Buzz (scripts/redcomet-messages.py), drafts the replies asked for,
// and posts approved replies in Buzz with the President signed in. Kept for the whole school year.
interface Msg {
  id: number; student_id: string | null; subject: string; activity: string | null; from_name: string | null;
  kind: string; title: string | null; body: string; sent_at: string; status: Status; request_note: string | null;
  reply_draft: string | null; reply_text: string | null; approved_at: string | null; replied_at: string | null; replied_by: string | null;
  students: { first_name: string; last_name: string; enrollments: { grade_name: string; status: string }[] } | null;
}
type Status = "new" | "draft_requested" | "draft_ready" | "approved" | "replied" | "no_reply";
const BADGE: Record<Status, { label: string; dot: string; cls: string }> = {
  new: { label: "New", dot: "bg-red-500", cls: "bg-red-100 text-red-700" },
  draft_requested: { label: "With Claude", dot: "bg-purple-500", cls: "bg-purple-100 text-purple-800" },
  draft_ready: { label: "Draft ready", dot: "bg-amber-500", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "To post", dot: "bg-blue-500", cls: "bg-blue-100 text-blue-700" },
  replied: { label: "Replied", dot: "bg-emerald-500", cls: "bg-emerald-50 text-emerald-deep" },
  no_reply: { label: "No reply needed", dot: "bg-gray-400", cls: "bg-gray-200 text-gray-600" },
};
type Tab = "needs" | "claude" | "post" | "done" | "all";
const TABS: { key: Tab; label: string; st: Status[] }[] = [
  { key: "needs", label: "Needs me", st: ["new", "draft_ready"] },
  { key: "claude", label: "With Claude", st: ["draft_requested"] },
  { key: "post", label: "To post", st: ["approved"] },
  { key: "done", label: "Done", st: ["replied", "no_reply"] },
  { key: "all", label: "All", st: ["new", "draft_requested", "draft_ready", "approved", "replied", "no_reply"] },
];
const SUBJECTS = ["Language Arts", "Math", "Science", "Other"];
const DATES: [Preset, string][] = [["week", "This week"], ["month", "This month"], ["3months", "Last 3 months"], ["year", "School year"], ["custom", "Custom dates"]];
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function RedCometMessages() {
  const { can, profile } = useAuth();
  const canEdit = profile?.role === "admin" || can("redcomet", "edit");
  const [range, setRange] = useState<{ preset: Preset; from: string; to: string }>({ preset: "year", ...presetRange("year") });
  const [rows, setRows] = useState<Msg[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("needs");
  const [q, setQ] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const [student, setStudent] = useState("");
  const [teachersSel, setTeachersSel] = useState<string[]>([]);
  const [sel, setSel] = useState<number | null>(null);

  async function load() {
    if (configMissing) return;
    const to = new Date(range.to + "T00:00:00"); to.setDate(to.getDate() + 1);
    const { data, error } = await supabase.from("redcomet_messages")
      .select("*, students ( first_name, last_name, enrollments ( grade_name, status ) )")
      .gte("sent_at", new Date(range.from + "T00:00:00").toISOString()).lt("sent_at", to.toISOString())
      .order("sent_at", { ascending: false }).limit(2000);
    if (error) { setErr("Could not load: " + error.message + (error.message.includes("redcomet_messages") ? " - run platform_schema_phase44.sql" : "")); setRows([]); return; }
    setErr(null); setRows((data as unknown as Msg[]) ?? []);
  }
  useEffect(() => { load(); }, [range.from, range.to]);

  const grade = (m: Msg) => (m.students?.enrollments.find((e) => e.status === "active") ?? m.students?.enrollments[0])?.grade_name ?? "";
  const name = (m: Msg) => (m.students ? `${m.students.first_name} ${m.students.last_name}` : "School-wide");
  const byGrade = useMemo(() => {
    const g = new Map<string, Map<string, string>>();
    (rows ?? []).filter((r) => r.student_id).forEach((r) => { const k = grade(r) || "—"; if (!g.has(k)) g.set(k, new Map()); g.get(k)!.set(r.student_id!, name(r)); });
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);
  const teachers = useMemo(() => [...new Set((rows ?? []).map((r) => r.from_name ?? "").filter(Boolean))].sort(), [rows]);
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!subjects.length || subjects.includes(r.subject)) && (!student || r.student_id === student) && (!teachersSel.length || teachersSel.includes(r.from_name ?? ""))
      && (!n || [r.body, r.title, r.activity, r.from_name, name(r), r.reply_draft, r.reply_text].some((x) => (x ?? "").toLowerCase().includes(n))));
  }, [rows, subjects, student, teachersSel, q]);
  const inTab = (t: Tab) => filtered.filter((r) => TABS.find((x) => x.key === t)!.st.includes(r.status));
  const list = inTab(tab);
  const current = (rows ?? []).find((r) => r.id === sel) ?? null;
  // on a computer the first message opens by itself; on a phone the list shows first
  useEffect(() => {
    if (window.innerWidth >= 1024 && (!current || !list.some((r) => r.id === current.id))) setSel(list[0]?.id ?? null);
  }, [tab, rows, subjects, student, teachersSel, q]);

  const tags: { label: string; clear: () => void }[] = [
    ...(range.preset !== "year" ? [{ label: range.preset === "custom" ? `${range.from} – ${range.to}` : DATES.find(([p]) => p === range.preset)![1], clear: () => setRange({ preset: "year", ...presetRange("year") }) }] : []),
    ...subjects.map((x) => ({ label: x, clear: () => setSubjects(subjects.filter((y) => y !== x)) })),
    ...(student ? [{ label: byGrade.flatMap(([, m]) => [...m.entries()]).find(([id]) => id === student)?.[1] ?? "Student", clear: () => setStudent("") }] : []),
    ...teachersSel.map((x) => ({ label: x, clear: () => setTeachersSel(teachersSel.filter((y) => y !== x)) })),
    ...(q ? [{ label: `"${q}"`, clear: () => setQ("") }] : []),
  ];

  async function save(m: Msg, patch: Partial<Msg>) {
    const { error } = await supabase.from("redcomet_messages").update(patch).eq("id", m.id);
    if (error) return setErr("Could not save: " + error.message);
    load();
  }

  return (
    <div className="max-w-6xl">
      <h1 className="font-display text-2xl font-semibold text-navy">Red Comet Messages</h1>
      <p className="mb-3 mt-1 text-sm text-gray-500">From the Red Comet teachers, saved by Claude from Buzz. Ask Claude for a reply, approve it, and Claude posts it in Buzz at the next session.</p>

      {/* tabs */}
      <div className="mb-3 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-gray-200">
        {TABS.map((t) => {
          const n = inTab(t.key).length;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === t.key ? "border-navy font-semibold text-navy" : "border-transparent text-gray-500 hover:text-navy"}`}>
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] font-semibold ${t.key === "needs" && n ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* one filter bar (same as the reports) */}
      <div className="mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search messages and replies" />
          <DateMenu {...range} onChange={setRange} presets={DATES} />
          <MultiSelect label="Subject" options={SUBJECTS.map((x) => ({ key: x, label: x }))} value={subjects} onChange={setSubjects} />
          <StudentSelect value={student} onChange={setStudent} groups={byGrade.map(([g, m]) => [g, [...m.entries()].sort((x, y) => x[1].localeCompare(y[1]))] as [string, [string, string][]])} />
          <MultiSelect label="Teacher" options={teachers.map((x) => ({ key: x, label: x }))} value={teachersSel} onChange={setTeachersSel} />
        </div>
        <FilterTags tags={tags} />
      </div>

      {err && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : (
        <div className="grid overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* list */}
          <div className={`max-h-[72vh] overflow-y-auto lg:border-r lg:border-gray-200 ${current ? "hidden lg:block" : ""}`}>
            {list.map((m) => (
              <button key={m.id} onClick={() => setSel(m.id)}
                className={`block w-full border-b border-gray-100 px-3 py-2.5 text-left last:border-0 ${m.id === sel ? "border-l-4 border-l-royal bg-silver/70" : "hover:bg-silver/40"}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${BADGE[m.status].dot}`} title={BADGE[m.status].label} />
                  <span className="truncate font-semibold text-navy">{name(m)}</span>
                  {grade(m) && <span className="shrink-0 text-[11px] text-gray-400">{grade(m)}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-gray-400">{day(m.sent_at)}</span>
                </div>
                <div className="ml-4 truncate text-xs text-gray-500">{m.subject}{m.activity ? ` · ${m.activity}` : ""}</div>
                <div className="ml-4 truncate text-xs text-gray-600">{m.body}</div>
              </button>
            ))}
            {!list.length && <p className="p-8 text-center text-sm text-gray-400">{tab === "needs" ? "Nothing needs you right now." : "No messages here."}</p>}
          </div>
          {/* reading pane */}
          <div className={`min-h-[20rem] ${current ? "" : "hidden lg:block"}`}>
            {current
              ? <Reader key={current.id} m={current} name={name(current)} grade={grade(current)} canEdit={canEdit} onSave={(p) => save(current, p)} onBack={() => setSel(null)} />
              : <p className="p-10 text-center text-sm text-gray-400">Choose a message on the left.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Reader({ m, name, grade, canEdit, onSave, onBack }: { m: Msg; name: string; grade: string; canEdit: boolean; onSave: (p: Partial<Msg>) => void; onBack: () => void }) {
  const [draft, setDraft] = useState(m.reply_draft ?? "");
  const [note, setNote] = useState(m.request_note ?? "");
  useEffect(() => { setDraft(m.reply_draft ?? ""); setNote(m.request_note ?? ""); }, [m.reply_draft, m.request_note]);
  const b = BADGE[m.status];
  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40";
  return (
    <div className="p-4">
      <button onClick={onBack} className="mb-2 text-xs font-semibold text-royal lg:hidden">‹ Back to the list</button>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg font-semibold text-navy">{name}</span>
        {grade && <span className="text-sm text-gray-400">{grade}</span>}
        <span className="rounded-full bg-silver px-2 py-0.5 text-[11px] font-semibold text-navy">{m.subject}</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${b.cls}`}>{b.label}</span>
      </div>
      <div className="mt-0.5 text-xs text-gray-500">{m.from_name ?? "Red Comet"} · {when(m.sent_at)}{m.activity ? ` · ${m.activity}` : ""}</div>
      <div className="mt-3 whitespace-pre-wrap rounded-lg bg-silver/60 p-3 text-sm text-gray-800">{m.title && <b>{m.title}: </b>}{m.body}</div>

      {m.status === "replied" && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
          <div className="mb-1 text-[11px] font-bold uppercase text-emerald-deep">Our reply · {m.replied_at ? when(m.replied_at) : ""}{m.replied_by ? ` · ${m.replied_by}` : ""}</div>
          <div className="whitespace-pre-wrap text-gray-800">{m.reply_text}</div>
        </div>
      )}

      {canEdit && m.status !== "replied" && (
        <div className="mt-3">
          {(m.status === "new" || m.status === "no_reply" || m.status === "draft_requested") && (
            <>
              <label className="text-xs font-semibold text-gray-600">Note for Claude: what the reply should say (optional)
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Thank her; we'll redo page 12 on Monday"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-normal text-gray-800" />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => onSave({ status: "draft_requested", request_note: note.trim() || null })} className={`${btn} bg-purple-700 text-white`}>
                  {m.status === "draft_requested" ? "Update the note" : "Ask Claude to draft"}
                </button>
                <button onClick={() => onSave({ status: "draft_ready", reply_draft: "" })} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Write it myself</button>
                {m.status === "no_reply"
                  ? <button onClick={() => onSave({ status: "new" })} className={`${btn} text-gray-500`}>Back to New</button>
                  : <button onClick={() => onSave({ status: "no_reply" })} className={`${btn} text-gray-500`}>No reply needed</button>}
              </div>
              {m.status === "draft_requested" && <p className="mt-2 text-[11px] text-purple-800">Claude drafts this at the next Red Comet session; it then appears under Needs me.</p>}
            </>
          )}
          {(m.status === "draft_ready" || m.status === "approved") && (
            <>
              <label className="text-xs font-semibold text-gray-600">{m.status === "approved" ? "Approved reply — Claude posts it in Buzz at the next session" : "Reply draft — edit, then approve"}
                <textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm font-normal text-gray-800" />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {m.status === "draft_ready" && <button onClick={() => onSave({ status: "approved", reply_draft: draft })} disabled={!draft.trim()} className={`${btn} bg-navy text-white`}>Approve reply</button>}
                {m.status === "approved" && <button onClick={() => onSave({ status: "draft_ready", reply_draft: draft })} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Undo approval</button>}
                {draft !== (m.reply_draft ?? "") && <button onClick={() => onSave({ reply_draft: draft })} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Save draft</button>}
                <button onClick={() => onSave({ status: "draft_requested", request_note: note.trim() || "Please redo this draft." })} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Ask Claude to redo</button>
                <button onClick={() => { if (window.confirm("Mark as replied? Use this if you posted the reply in Buzz yourself.")) onSave({ status: "replied", reply_text: draft, replied_by: "marked by the office" }); }} className={`${btn} text-emerald-deep`}>I posted it myself</button>
              </div>
            </>
          )}
          {m.request_note && <p className="mt-2 text-[11px] text-gray-500">Note for Claude: {m.request_note}</p>}
        </div>
      )}

      {m.student_id && <History m={m} name={name} />}
    </div>
  );
}

// Earlier answered or ignored messages for the same student and subject: a carousel, collapsed by default.
function History({ m, name }: { m: Msg; name: string }) {
  const [items, setItems] = useState<Msg[] | null>(null);
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    supabase.from("redcomet_messages").select("id, subject, activity, from_name, body, title, sent_at, status, reply_text, replied_at, replied_by")
      .eq("student_id", m.student_id!).eq("subject", m.subject).in("status", ["replied", "no_reply"]).neq("id", m.id)
      .order("sent_at", { ascending: false }).limit(50)
      .then(({ data }) => setItems((data as unknown as Msg[]) ?? []));
  }, [m.id]);
  if (!items || !items.length) return <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-400">No earlier answered messages for {name.split(" ")[0]} in {m.subject}.</p>;
  const answered = items.filter((x) => x.status === "replied").length;
  const h = items[Math.min(i, items.length - 1)];
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-navy">
        <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span>
        History — {name.split(" ")[0]} · {m.subject}
        <span className="text-xs font-normal text-gray-500">{answered} answered{items.length - answered ? `, ${items.length - answered} no reply` : ""}</span>
      </button>
      {open && (
        <div className="mt-2">
          <div className="rounded-xl border border-gray-200 bg-white p-3">
            <div className="flex items-center gap-2 text-[11px] text-gray-500">
              <span className={`rounded-full px-1.5 py-0.5 font-bold uppercase ${BADGE[h.status].cls}`}>{BADGE[h.status].label}</span>
              <span>{h.from_name ?? "Red Comet"} · {when(h.sent_at)}</span>
            </div>
            {h.activity && <div className="mt-1 text-xs text-gray-500">{h.activity}</div>}
            <div className="mt-1.5 whitespace-pre-wrap text-sm text-gray-800">{h.body}</div>
            {h.status === "replied" && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm">
                <div className="text-[11px] font-bold uppercase text-emerald-deep">Our reply{h.replied_at ? ` · ${day(h.replied_at)}` : ""}</div>
                <div className="whitespace-pre-wrap text-gray-800">{h.reply_text}</div>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-center gap-3">
            <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Newer" className="rounded-full border border-gray-300 px-2.5 py-0.5 text-sm disabled:opacity-30">‹</button>
            <div className="flex items-center gap-1">
              {items.length <= 12
                ? items.map((x, k) => <button key={x.id} onClick={() => setI(k)} aria-label={`Message ${k + 1}`} className={`h-2 w-2 rounded-full ${k === i ? "bg-navy" : "bg-gray-300"}`} />)
                : <span className="text-xs text-gray-500">{i + 1} of {items.length}</span>}
            </div>
            <button onClick={() => setI(Math.min(items.length - 1, i + 1))} disabled={i >= items.length - 1} aria-label="Older" className="rounded-full border border-gray-300 px-2.5 py-0.5 text-sm disabled:opacity-30">›</button>
          </div>
          <p className="mt-1 text-center text-[11px] text-gray-400">Newest first · {i + 1} of {items.length}</p>
        </div>
      )}
    </div>
  );
}
