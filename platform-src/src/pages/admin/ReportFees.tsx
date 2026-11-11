import { Fragment, useEffect, useMemo, useState } from "react";
import { configMissing } from "../../lib/supabase";
import { rpcAll, presetRange, periodKey, periodLabel, downloadCsv, money, pct, type Preset, type Period } from "../../lib/reports";
import { DateMenu, MultiSelect, StudentSelect, Segmented, FilterTags, Tile, DrillRow } from "../../components/ReportControls";

// Reports → Fees (phase 42, President 2026-11-10): one line per student per month — billed,
// paid, waived, still due and how it was paid — drilled school → grade → student → month / year.
interface Row { month: string; student_id: string; student: string; student_no: number; grade: string; grade_order: number;
  due: number; paid: number; waived: number; balance: number; status: Status; last_payment: string | null; methods: string | null }
type Status = "paid" | "paid_late" | "partial" | "unpaid" | "waived" | "not_due";
const STATUS: { key: Status; label: string; cls: string; badge: string }[] = [
  { key: "paid", label: "Paid on time", cls: "bg-emerald-brand text-white", badge: "bg-emerald-50 text-emerald-deep" },
  { key: "paid_late", label: "Paid late", cls: "bg-amber-500 text-white", badge: "bg-amber-100 text-amber-800" },
  { key: "partial", label: "Partly paid", cls: "bg-orange-500 text-white", badge: "bg-orange-100 text-orange-800" },
  { key: "unpaid", label: "Unpaid", cls: "bg-red-600 text-white", badge: "bg-red-100 text-red-700" },
  { key: "waived", label: "Waived", cls: "bg-gray-600 text-white", badge: "bg-gray-200 text-gray-700" },
  { key: "not_due", label: "Not due yet", cls: "bg-blue-600 text-white", badge: "bg-blue-100 text-blue-700" },
];
const sum = (rs: Row[]) => rs.reduce((t, r) => ({ due: t.due + Number(r.due), paid: t.paid + Number(r.paid), waived: t.waived + Number(r.waived), balance: t.balance + Number(r.balance) }), { due: 0, paid: 0, waived: 0, balance: 0 });
const MONTH_PRESETS: [Preset, string][] = [["month", "This month"], ["lastmonth", "Last month"], ["3months", "Last 3 months"], ["year", "School year"], ["custom", "Custom"]];

export default function ReportFees() {
  const [range, setRange] = useState<{ preset: Preset; from: string; to: string }>({ preset: "year", ...presetRange("year") });
  const [period, setPeriod] = useState<Period>("month");
  const [grades, setGrades] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [student, setStudent] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (configMissing) return;
    setRows(null); setErr(null);
    rpcAll<Row>("report_fees", { p_from: range.from, p_to: range.to }, "month").then(({ rows, error }) => {
      setRows(rows); setErr(error ? "Could not load: " + error + (error.includes("report_fees") ? " - run platform_schema_phase42.sql" : "") : null);
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
  const shown = useMemo(() => (rows ?? []).filter((r) => (!grades.length || grades.includes(r.grade)) && (!student || r.student_id === student)
    && (!statuses.length || statuses.includes(r.status))), [rows, grades, student, statuses]);

  const t = sum(shown);
  const late = shown.filter((r) => r.status === "paid_late").length;
  const owing = new Set(shown.filter((r) => Number(r.balance) > 0 && r.status !== "not_due").map((r) => r.student_id)).size;

  const byGrade = useMemo(() => {
    const g = new Map<string, { order: number; students: Map<string, { name: string; no: number; rows: Row[] }>; rows: Row[] }>();
    shown.forEach((r) => {
      if (!g.has(r.grade)) g.set(r.grade, { order: r.grade_order, students: new Map(), rows: [] });
      const G = g.get(r.grade)!; G.rows.push(r);
      if (!G.students.has(r.student_id)) G.students.set(r.student_id, { name: r.student, no: r.student_no, rows: [] });
      G.students.get(r.student_id)!.rows.push(r);
    });
    return [...g.entries()].sort((a, b) => a[1].order - b[1].order);
  }, [shown]);
  const group = (rs: Row[]) => {
    const m = new Map<string, Row[]>(); rs.forEach((r) => { const k = periodKey(r.month, period === "day" ? "month" : period); m.set(k, [...(m.get(k) ?? []), r]); });
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  };
  const badge = (s: Status) => { const o = STATUS.find((x) => x.key === s)!; return <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${o.badge}`}>{o.label}</span>; };
  const cells = (label: React.ReactNode, rs: Row[]) => {
    const x = sum(rs);
    return [label, money(x.due), <span className="text-emerald-deep">{money(x.paid)}</span>, x.waived ? money(x.waived) : "—",
      <span className={x.balance > 0 ? "font-semibold text-red-700" : "text-gray-400"}>{x.balance > 0 ? money(x.balance) : "—"}</span>,
      <span className="font-semibold">{pct(x.paid + x.waived, x.due)}%</span>];
  };
  const toggle = (k: string) => setOpen({ ...open, [k]: !open[k] });

  function csv() {
    downloadCsv(`fees_${range.from.slice(0, 7)}_${range.to.slice(0, 7)}.csv`,
      ["Month", "Grade", "Student #", "Student", "Billed", "Paid", "Waived", "Still due", "Status", "Last payment", "Paid by"],
      shown.map((r) => [r.month.slice(0, 7), r.grade, r.student_no, r.student, r.due, r.paid, r.waived, r.balance, STATUS.find((s) => s.key === r.status)?.label, r.last_payment, r.methods]));
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Fees report</h1>
        <button onClick={csv} disabled={!shown.length} className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver disabled:opacity-40">⬇ Download CSV</button>
      </div>
      <p className="mb-4 text-sm text-gray-500">Monthly tuition per student. Tuition is due by the 5th: fully paid after the 5th counts as "paid late". Click a grade, then a student.</p>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <DateMenu {...range} onChange={setRange} presets={MONTH_PRESETS} monthOnly />
          <MultiSelect label="Grade" options={gradeOpts} value={grades} onChange={(v) => { setGrades(v); setStudent(""); }} />
          <StudentSelect value={student} onChange={setStudent} groups={studentGroups} />
          <MultiSelect label="Status" options={STATUS.map((s) => ({ key: s.key, label: s.label, dot: ({ paid: "bg-emerald-500", paid_late: "bg-amber-500", partial: "bg-orange-500", unpaid: "bg-red-500", waived: "bg-gray-400", not_due: "bg-blue-500" })[s.key] }))} value={statuses} onChange={setStatuses} />
          <span className="ml-auto"><Segmented label="Show by" value={period === "year" ? "year" : "month"} onChange={setPeriod} options={[{ key: "month", label: "Month" }, { key: "year", label: "Year" }]} /></span>
        </div>
        <FilterTags tags={[
          ...(range.preset !== "year" ? [{ label: range.preset === "custom" ? `${range.from.slice(0, 7)} – ${range.to.slice(0, 7)}` : MONTH_PRESETS.find(([p]) => p === range.preset)![1], clear: () => setRange({ preset: "year", ...presetRange("year") }) }] : []),
          ...grades.map((g) => ({ label: g, clear: () => setGrades(grades.filter((x) => x !== g)) })),
          ...(student ? [{ label: studentOpts.find(([id]) => id === student)?.[1] ?? "Student", clear: () => setStudent("") }] : []),
          ...statuses.map((st) => ({ label: STATUS.find((x) => x.key === st)!.label, clear: () => setStatuses(statuses.filter((x) => x !== st)) })),
        ]} />
      </div>

      {err && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{err}</div>}
      {rows === null ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Tile label="Billed" value={money(t.due)} />
            <Tile label="Collected" value={money(t.paid)} tone="green" />
            <Tile label="Waived" value={money(t.waived)} tone="gray" />
            <Tile label="Still due" value={money(t.balance)} tone={t.balance > 0 ? "red" : "gray"} sub={`${owing} student${owing === 1 ? "" : "s"} owing`} />
            <Tile label="Collected %" value={`${pct(t.paid + t.waived, t.due)}%`} sub="paid + waived" />
            <Tile label="Paid late" value={late} sub="student-months" tone="amber" />
          </div>

          <section className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr className="border-b bg-silver/50 text-right text-xs text-gray-500">
                <th className="py-2 pl-3 text-left">Grade › Student › {period === "year" ? "Year" : "Month"}</th><th className="pr-3">Billed</th><th className="pr-3">Paid</th><th className="pr-3">Waived</th><th className="pr-3">Still due</th><th className="pr-3">Collected</th>
              </tr></thead>
              <tbody>
                {byGrade.map(([g, G]) => (
                  <Fragment key={g}>
                    <DrillRow depth={0} open={open[g]} onToggle={() => toggle(g)} cells={cells(<>{g} <span className="text-xs font-normal text-gray-400">· {G.students.size} students</span></>, G.rows)} />
                    {open[g] && [...G.students.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([sid, S]) => (
                      <Fragment key={sid}>
                        <DrillRow depth={1} open={open[g + sid]} onToggle={() => toggle(g + sid)} cells={cells(<>{S.name} <span className="text-xs text-gray-400">#{String(S.no).padStart(5, "0")}</span></>, S.rows)} />
                        {open[g + sid] && group(S.rows).map(([k, rs]) => (
                          <DrillRow key={k} depth={2} canOpen={false} cells={cells(<>{periodLabel(k, period === "year" ? "year" : "month")}
                            {rs.length === 1 && badge(rs[0].status)}
                            {rs.length === 1 && rs[0].last_payment && <span className="ml-1.5 text-[11px] text-gray-400">{rs[0].methods} · {new Date(rs[0].last_payment + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                          </>, rs)} />
                        ))}
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
                {byGrade.length > 0 && <tr className="border-t-2 border-gray-200 bg-silver/40 font-bold text-navy">
                  {cells("Total", shown).map((c, i) => <td key={i} className={i === 0 ? "py-2 pl-3" : "py-2 pr-3 text-right tabular-nums"}>{c}</td>)}
                </tr>}
                {!byGrade.length && <tr><td colSpan={6} className="p-6 text-center text-gray-400">Nothing for this selection.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-400">By {period === "year" ? "year" : "month"}</div>
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b text-right text-xs text-gray-500"><th className="py-1.5 pl-3 text-left">{period === "year" ? "Year" : "Month"}</th><th className="pr-3">Billed</th><th className="pr-3">Paid</th><th className="pr-3">Waived</th><th className="pr-3">Still due</th><th className="pr-3">Collected</th></tr></thead>
              <tbody>
                {group(shown).map(([k, rs]) => (
                  <tr key={k} className="border-b border-gray-100 last:border-0">
                    {cells(<>{periodLabel(k, period === "year" ? "year" : "month")} <span className="text-xs text-gray-400">· {STATUS.map((s) => { const n = rs.filter((r) => r.status === s.key).length; return n ? `${n} ${s.label.toLowerCase()}` : null; }).filter(Boolean).join(", ")}</span></>, rs)
                      .map((c, i) => <td key={i} className={i === 0 ? "py-1.5 pl-3" : "py-1.5 pr-3 text-right tabular-nums"}>{c}</td>)}
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
