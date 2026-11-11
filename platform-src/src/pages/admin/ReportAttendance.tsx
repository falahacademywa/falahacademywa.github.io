import { Fragment, useEffect, useMemo, useState } from "react";
import { configMissing } from "../../lib/supabase";
import { rpcAll, presetRange, periodKey, periodLabel, downloadCsv, pct, PRESETS, type Preset, type Period } from "../../lib/reports";
import { DateMenu, MultiSelect, StudentSelect, Segmented, FilterTags, Tile, DrillRow } from "../../components/ReportControls";

// Reports → Attendance (phase 42, President 2026-11-10): drill down school → grade → student →
// day / month / year, filtered by grade, student, status and a date range, with totals everywhere.
interface Mark { att_date: string; status: "present" | "late" | "absent"; enrollment_id: string; student_id: string; student: string; student_no: number; grade: string; grade_order: number }
type Status = Mark["status"];
const STATUS: { key: Status; label: string; cls: string }[] = [
  { key: "present", label: "Present", cls: "bg-emerald-brand text-white" },
  { key: "late", label: "Late", cls: "bg-amber-500 text-white" },
  { key: "absent", label: "Absent", cls: "bg-red-600 text-white" },
];
interface Tally { present: number; late: number; absent: number; total: number }
const tally = (ms: Mark[]): Tally => {
  const t = { present: 0, late: 0, absent: 0, total: ms.length };
  ms.forEach((m) => t[m.status]++);
  return t;
};

export default function ReportAttendance() {
  const [range, setRange] = useState<{ preset: Preset; from: string; to: string }>({ preset: "month", ...presetRange("month") });
  const [period, setPeriod] = useState<Period>("month");
  const [grades, setGrades] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [student, setStudent] = useState("");
  const [rows, setRows] = useState<Mark[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (configMissing) return;
    setRows(null); setErr(null);
    rpcAll<Mark>("report_attendance", { p_from: range.from, p_to: range.to }, "att_date").then(({ rows, error }) => {
      setRows(rows); setErr(error ? "Could not load: " + error + (error.includes("report_attendance") ? " - run platform_schema_phase42.sql" : "") : null);
    });
  }, [range.from, range.to]);

  const gradeOpts = useMemo(() => {
    const m = new Map<string, number>(); (rows ?? []).forEach((r) => m.set(r.grade, r.grade_order));
    return [...m.entries()].sort((a, b) => a[1] - b[1]).map(([g]) => ({ key: g, label: g }));
  }, [rows]);
  const studentOpts = useMemo(() => {
    const m = new Map<string, string>(); (rows ?? []).filter((r) => !grades.length || grades.includes(r.grade)).forEach((r) => m.set(r.student_id, r.student));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows, grades]);

  const studentGroups = useMemo(() => {
    const g = new Map<string, Map<string, string>>();
    (rows ?? []).filter((r) => !grades.length || grades.includes(r.grade)).forEach((r) => { if (!g.has(r.grade)) g.set(r.grade, new Map()); g.get(r.grade)!.set(r.student_id, r.student); });
    return gradeOpts.filter((o) => g.has(o.key)).map((o) => [o.key, [...g.get(o.key)!.entries()].sort((a, b) => a[1].localeCompare(b[1]))] as [string, [string, string][]]);
  }, [rows, grades, gradeOpts]);
  // the status filter narrows which marks are listed; percentages always use all marks of the selection
  const base = useMemo(() => (rows ?? []).filter((r) => (!grades.length || grades.includes(r.grade)) && (!student || r.student_id === student)), [rows, grades, student]);
  const shown = useMemo(() => base.filter((r) => !statuses.length || statuses.includes(r.status)), [base, statuses]);
  const all = tally(base);
  const days = new Set(base.map((r) => r.att_date)).size;
  const kids = new Set(base.map((r) => r.student_id)).size;

  const byGrade = useMemo(() => {
    const g = new Map<string, { order: number; students: Map<string, { name: string; no: number; marks: Mark[] }>; marks: Mark[] }>();
    shown.forEach((r) => {
      if (!g.has(r.grade)) g.set(r.grade, { order: r.grade_order, students: new Map(), marks: [] });
      const G = g.get(r.grade)!; G.marks.push(r);
      if (!G.students.has(r.student_id)) G.students.set(r.student_id, { name: r.student, no: r.student_no, marks: [] });
      G.students.get(r.student_id)!.marks.push(r);
    });
    return [...g.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [shown]);
  const byPeriod = useMemo(() => {
    const m = new Map<string, Mark[]>();
    shown.forEach((r) => { const k = periodKey(r.att_date, period); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [shown, period]);

  const cells = (label: React.ReactNode, ms: Mark[]) => {
    const t = tally(ms);
    return [label, t.present, <span className={t.late ? "text-amber-700" : ""}>{t.late}</span>, <span className={t.absent ? "text-red-700" : ""}>{t.absent}</span>, t.total,
      <span className="font-semibold">{pct(t.present + t.late, t.total)}%</span>];
  };
  const toggle = (k: string) => setOpen({ ...open, [k]: !open[k] });
  const periods = (ms: Mark[]) => {
    const m = new Map<string, Mark[]>(); ms.forEach((r) => { const k = periodKey(r.att_date, period); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };

  function csv() {
    downloadCsv(`attendance_${range.from}_${range.to}.csv`, ["Date", "Grade", "Student #", "Student", "Status"],
      shown.map((r) => [r.att_date, r.grade, r.student_no, r.student, r.status]));
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Attendance report</h1>
        <button onClick={csv} disabled={!shown.length} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver disabled:opacity-40">⬇ Download CSV</button>
      </div>
      <p className="mb-4 text-sm text-gray-500">Click a grade to see its students, a student to see the {period === "day" ? "days" : period === "month" ? "months" : "years"}. "Attended" counts present and late.</p>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <DateMenu {...range} onChange={setRange} />
          <MultiSelect label="Grade" options={gradeOpts} value={grades} onChange={(v) => { setGrades(v); setStudent(""); }} />
          <StudentSelect value={student} onChange={setStudent} groups={studentGroups} />
          <MultiSelect label="Status" options={STATUS.map((s) => ({ key: s.key, label: s.label, dot: ({ present: "bg-emerald-500", late: "bg-amber-500", absent: "bg-red-500" })[s.key] }))} value={statuses} onChange={setStatuses} />
          <span className="ml-auto"><Segmented label="Show by" value={period} onChange={setPeriod} options={[{ key: "day", label: "Day" }, { key: "month", label: "Month" }, { key: "year", label: "Year" }]} /></span>
        </div>
        <FilterTags tags={[
          ...(range.preset !== "month" ? [{ label: range.preset === "custom" ? `${range.from} – ${range.to}` : PRESETS.find(([p]) => p === range.preset)![1], clear: () => setRange({ preset: "month", ...presetRange("month") }) }] : []),
          ...grades.map((g) => ({ label: g, clear: () => setGrades(grades.filter((x) => x !== g)) })),
          ...(student ? [{ label: studentOpts.find(([id]) => id === student)?.[1] ?? "Student", clear: () => setStudent("") }] : []),
          ...statuses.map((st) => ({ label: STATUS.find((x) => x.key === st)!.label, clear: () => setStatuses(statuses.filter((x) => x !== st)) })),
        ]} />
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="School days" value={days} sub={`${kids} student${kids === 1 ? "" : "s"}`} />
            <Tile label="Marks" value={all.total} />
            <Tile label="Present" value={all.present} sub={`${pct(all.present, all.total)}%`} tone="green" />
            <Tile label="Late" value={all.late} sub={`${pct(all.late, all.total)}%`} tone="amber" />
            <Tile label="Absent" value={all.absent} sub={`${pct(all.absent, all.total)}%`} tone="red" />
            <Tile label="Attended" value={`${pct(all.present + all.late, all.total)}%`} sub="present + late" />
          </div>

          <section className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b bg-silver/50 text-right text-xs text-gray-500">
                <th className="py-2 pl-3 text-left">Grade › Student › {period[0].toUpperCase() + period.slice(1)}</th><th className="pr-3">Present</th><th className="pr-3">Late</th><th className="pr-3">Absent</th><th className="pr-3">Marks</th><th className="pr-3">Attended</th>
              </tr></thead>
              <tbody>
                {byGrade.map(([g, G]) => (
                  <Fragment key={g}>
                    <DrillRow depth={0} open={open[g]} onToggle={() => toggle(g)} cells={cells(<>{g} <span className="text-xs font-normal text-gray-400">· {G.students.size} students</span></>, G.marks)} />
                    {open[g] && [...G.students.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([sid, S]) => (
                      <Fragment key={sid}>
                        <DrillRow depth={1} open={open[g + sid]} onToggle={() => toggle(g + sid)} cells={cells(<>{S.name} <span className="text-xs text-gray-400">#{String(S.no).padStart(5, "0")}</span></>, S.marks)} />
                        {open[g + sid] && periods(S.marks).map(([k, ms]) => (
                          <DrillRow key={k} depth={2} canOpen={false} cells={cells(period === "day" ? <>{periodLabel(k, period)} <span className={`ml-1 rounded-full px-1.5 text-[10px] font-bold uppercase ${ms[0].status === "present" ? "bg-emerald-50 text-emerald-deep" : ms[0].status === "late" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{ms[0].status}</span></> : periodLabel(k, period), ms)} />
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
                {byGrade.length > 0 && <tr className="border-t-2 border-gray-200 bg-silver/40 font-bold text-navy">
                  {cells("Total", shown).map((c, i) => <td key={i} className={i === 0 ? "py-2 pl-3" : "py-2 pr-3 text-right tabular-nums"}>{c}</td>)}
                </tr>}
                {!byGrade.length && <tr><td colSpan={6} className="p-6 text-center text-gray-400">No attendance marks for this selection.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-400">By {period}</div>
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b text-right text-xs text-gray-500"><th className="py-1.5 pl-3 text-left">{period[0].toUpperCase() + period.slice(1)}</th><th className="pr-3">Present</th><th className="pr-3">Late</th><th className="pr-3">Absent</th><th className="pr-3">Marks</th><th className="pr-3">Attended</th></tr></thead>
              <tbody>
                {byPeriod.map(([k, ms]) => (
                  <tr key={k} className="border-b border-gray-100 last:border-0">
                    {cells(periodLabel(k, period), ms).map((c, i) => <td key={i} className={i === 0 ? "py-1.5 pl-3" : "py-1.5 pr-3 text-right tabular-nums"}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
