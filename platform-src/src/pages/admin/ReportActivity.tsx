import { useEffect, useMemo, useState } from "react";
import { configMissing } from "../../lib/supabase";
import { rpcAll, presetRange, downloadCsv, iso, type Preset } from "../../lib/reports";
import { DateMenu, MultiSelect, StudentSelect, SearchBox, FilterTags, Tile } from "../../components/ReportControls";

// Reports → Activity Log (phase 42, President 2026-11-10): what parents, teachers, staff and the
// system did — pages opened, actions (forms, prints, uploads), every change to the data
// (audit log) and sign-ins — with search and filters. Page visits are kept 400 days.
interface Ev { at: string; user_id: string | null; person: string; role: string; kind: Kind; action: string; entity: string | null; entity_id: string | null; detail: string | null }
type Kind = "visit" | "action" | "change" | "sign-in";
const KINDS: { key: Kind; label: string; cls: string }[] = [
  { key: "visit", label: "Page visits", cls: "bg-blue-600 text-white" },
  { key: "action", label: "Actions", cls: "bg-purple-600 text-white" },
  { key: "change", label: "Changes", cls: "bg-amber-500 text-white" },
  { key: "sign-in", label: "Sign-ins", cls: "bg-emerald-brand text-white" },
];
const ROLES = ["parent", "teacher", "staff", "admin", "system"].map((r) => ({ key: r, label: r[0].toUpperCase() + r.slice(1) + "s" }));
const PRESETS: [Preset, string][] = [["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"], ["3months", "Last 3 months"], ["year", "School year"], ["custom", "Custom"]];

const ENTITY: Record<string, string> = {
  students: "student", enrollments: "enrollment", guardians: "parent/guardian", emergency_contacts: "emergency contact", applicants: "application",
  applicant: "application", teachers: "teacher", fee_plans: "fee plan", payment: "payment", payments: "payment", calendar_events: "calendar event",
  announcements: "announcement", staff_permissions: "staff permission", attendance: "attendance mark", class_updates: "class update",
  assignments: "assignment", parent_students: "parent link", profiles: "account", teacher_requests: "teacher request",
  teacher_request_notes: "request note", feedback: "feedback", app_settings: "setting", fee_reminders: "fee reminder",
  work_uploads: "Red Comet photo", volunteer_applications: "volunteer application", medical_info: "medical form", media_consent: "media consent",
  social_posts: "social post", social_templates: "social template", redcomet_messages: "Red Comet message", ptm_bookings: "meeting booking", ptm_remarks: "meeting remark", student: "student",
};
// page addresses → the names people see in the menu
const PAGES: [RegExp, string][] = [
  [/^\/admin\/?$/, "Dashboard"], [/^\/admin\/students\/.+/, "a student profile"], [/^\/admin\/students/, "Students"],
  [/^\/admin\/attendance/, "Attendance"], [/^\/admin\/fees/, "Fees"], [/^\/admin\/updates/, "Class Updates"], [/^\/admin\/assignments/, "Assignments"],
  [/^\/admin\/parents\/.+/, "a parent profile"], [/^\/admin\/parents/, "Parents"], [/^\/admin\/meetings/, "Parent Meetings"],
  [/^\/admin\/teachers\/.+/, "a teacher profile"], [/^\/admin\/teachers/, "Teachers"], [/^\/admin\/teacher-requests/, "Teacher Requests"],
  [/^\/admin\/admissions/, "Admissions"], [/^\/admin\/volunteers/, "Volunteers"], [/^\/admin\/redcomet\/messages/, "Red Comet › Messages"],
  [/^\/admin\/redcomet/, "Red Comet › Student Work"], [/^\/admin\/announcements/, "Announcements"], [/^\/admin\/social/, "Social Posts"],
  [/^\/admin\/calendar/, "Calendar"], [/^\/admin\/feedback/, "Feedback"], [/^\/admin\/reports\/attendance/, "Reports › Attendance"],
  [/^\/admin\/reports\/fees/, "Reports › Fees"], [/^\/admin\/reports\/activity/, "Reports › Activity Log"], [/^\/admin\/tasks/, "Tasks"],
  [/^\/admin\/settings/, "Settings"], [/^\/teacher\/update/, "Teacher app › Class update"], [/^\/teacher\/progress/, "Teacher app › Red Comet"],
  [/^\/teacher\/meetings/, "Teacher app › Meetings"], [/^\/teacher\/requests/, "Teacher app › Requests"], [/^\/teacher\/students/, "Teacher app › a student"],
  [/^\/teacher/, "Teacher app › Today"], [/^\/parent/, "Family Portal"],
];
const pageName = (path: string) => PAGES.find(([re]) => re.test(path))?.[1] ?? path;
function what(e: Ev) {
  if (e.kind === "visit") return "Opened " + pageName((e.detail ?? "").replace(/ · TESTDATA$/, "").replace(/ TEST44$/, ""));
  if (e.kind === "sign-in") return { login: "Signed in", logout: "Signed out", user_recovery_requested: "Asked for a password reset", user_updated_password: "Changed password" }[e.action] ?? e.action;
  if (e.kind === "action") return { open_portal: "Opened the Family Portal", view_child: "Looked at a child", open_form: "Opened a form", print_statement: "Printed the tuition statement", post_update: "Posted a class update", upload_photos: "Uploaded Red Comet photos" }[e.action] ?? e.action.replace(/_/g, " ");
  const m = e.action.match(/^(insert|update|delete)_(.+)$/);
  if (m) return `${{ insert: "Added", update: "Changed", delete: "Deleted" }[m[1] as "insert"]} ${ENTITY[m[2]] ?? m[2].replace(/_/g, " ")}`;
  return e.action.replace(/_/g, " ") + (e.entity ? ` (${ENTITY[e.entity] ?? e.entity})` : "");
}
const PAGE = 100;

export default function ReportActivity() {
  const [range, setRange] = useState<{ preset: Preset; from: string; to: string }>({ preset: "week", ...presetRange("week") });
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [person, setPerson] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Ev[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (configMissing) return;
    setRows(null); setErr(null); setPage(0);
    const to = new Date(range.to + "T00:00:00"); to.setDate(to.getDate() + 1);
    rpcAll<Ev>("activity_feed", { p_from: new Date(range.from + "T00:00:00").toISOString(), p_to: to.toISOString() }, "at", false).then(({ rows, error }) => {
      setRows(rows); setErr(error ? "Could not load: " + error + (error.includes("activity_feed") ? " - run platform_schema_phase42.sql" : "") : null);
    });
  }, [range.from, range.to]);

  const people = useMemo(() => {
    const m = new Map<string, string>(); (rows ?? []).forEach((r) => m.set(r.user_id ?? "system", `${r.person} (${r.role})`));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);
  // people grouped by role for the picker
  const personGroups = useMemo(() => {
    const g = new Map<string, [string, string][]>();
    (rows ?? []).forEach((r) => { const k = r.role[0].toUpperCase() + r.role.slice(1) + "s"; const id = r.user_id ?? "system"; if (!g.has(k)) g.set(k, []); if (!g.get(k)!.some(([x]) => x === id)) g.get(k)!.push([id, r.person]); });
    return [...g.entries()].filter(([k]) => !roles.length || roles.some((r) => k.toLowerCase().startsWith(r))).sort().map(([k, l]) => [k, l.sort((a, b) => a[1].localeCompare(b[1]))] as [string, [string, string][]]);
  }, [rows, roles]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!kinds.length || kinds.includes(r.kind)) && (!roles.length || roles.includes(r.role))
      && (!person || (r.user_id ?? "system") === person)
      && (!needle || [r.person, what(r), r.detail, r.entity, r.role].some((x) => (x ?? "").toLowerCase().includes(needle))));
  }, [rows, kinds, roles, person, q]);
  useEffect(() => setPage(0), [kinds, roles, person, q]);

  const active = new Set(shown.filter((r) => r.user_id).map((r) => r.user_id)).size;
  const count = (k: Kind) => shown.filter((r) => r.kind === k).length;
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const kindBadge = (k: Kind) => { const o = KINDS.find((x) => x.key === k)!; return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${o.cls}`}>{k}</span>; };

  function csv() {
    downloadCsv(`activity_${range.from}_${range.to}.csv`, ["When", "Person", "Role", "Kind", "What", "Detail", "Record"],
      shown.map((r) => [new Date(r.at).toLocaleString("en-US"), r.person, r.role, r.kind, what(r), r.detail, r.entity_id]));
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Activity Log</h1>
        <button onClick={csv} disabled={!shown.length} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver disabled:opacity-40">⬇ Download CSV</button>
      </div>
      <p className="mb-4 text-sm text-gray-500">Pages people opened, things they did and every change to the school's records, newest first. Page visits are kept for 400 days; changes are kept permanently.</p>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={q} onChange={setQ} placeholder="Search name, page or record" />
          <DateMenu {...range} onChange={setRange} presets={PRESETS} />
          <MultiSelect label="Who" options={ROLES} value={roles} onChange={(v) => { setRoles(v); setPerson(""); }} />
          <MultiSelect label="What" options={KINDS.map((k) => ({ key: k.key, label: k.label, dot: ({ visit: "bg-blue-500", action: "bg-purple-500", change: "bg-amber-500", "sign-in": "bg-emerald-500" })[k.key] }))} value={kinds} onChange={setKinds} />
          <StudentSelect value={person} onChange={setPerson} label="Everyone" groups={personGroups} />
        </div>
        <FilterTags tags={[
          ...(range.preset !== "week" ? [{ label: range.preset === "custom" ? `${range.from} – ${range.to}` : PRESETS.find(([p]) => p === range.preset)![1], clear: () => setRange({ preset: "week", ...presetRange("week") }) }] : []),
          ...roles.map((r) => ({ label: ROLES.find((x) => x.key === r)!.label, clear: () => setRoles(roles.filter((x) => x !== r)) })),
          ...kinds.map((k) => ({ label: KINDS.find((x) => x.key === k)!.label, clear: () => setKinds(kinds.filter((x) => x !== k)) })),
          ...(person ? [{ label: people.find(([id]) => id === person)?.[1] ?? "Person", clear: () => setPerson("") }] : []),
          ...(q ? [{ label: `"${q}"`, clear: () => setQ("") }] : []),
        ]} />
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Events" value={shown.length.toLocaleString()} />
            <Tile label="People" value={active} sub="active in this range" />
            <Tile label="Page visits" value={count("visit")} />
            <Tile label="Actions" value={count("action")} />
            <Tile label="Changes" value={count("change")} tone="amber" />
            <Tile label="Sign-ins" value={count("sign-in")} tone="green" />
          </div>
          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="border-b bg-silver/50 text-left text-xs text-gray-500">
                <th className="py-2 pl-3">When</th><th className="pr-3">Who</th><th className="pr-3"></th><th className="pr-3">What</th><th className="pr-3">Detail</th>
              </tr></thead>
              <tbody>
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((r, i) => (
                  <tr key={i} className="border-b border-gray-100 align-top last:border-0">
                    <td className="whitespace-nowrap py-1.5 pl-3 pr-3 text-xs text-gray-500">{new Date(r.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td className="py-1.5 pr-3"><span className="font-semibold text-navy">{r.person}</span> <span className="text-xs text-gray-400">{r.role}</span></td>
                    <td className="py-1.5 pr-3">{kindBadge(r.kind)}</td>
                    <td className="py-1.5 pr-3 text-gray-800">{what(r)}</td>
                    <td className="py-1.5 pr-3 text-xs text-gray-500">{r.kind === "visit" ? "" : (r.detail ?? "").replace(/^TESTDATA$/, "")}</td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={5} className="p-6 text-center text-gray-400">No activity for this selection.</td></tr>}
              </tbody>
            </table>
          </section>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <button disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">‹ Newer</button>
              <span className="text-gray-500">Page {page + 1} of {pages}</span>
              <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40">Older ›</button>
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">Range {range.from} – {range.to} · loaded {iso(new Date())}.</p>
        </>
      )}
    </div>
  );
}
