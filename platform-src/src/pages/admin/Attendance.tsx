// Admin → Attendance (phase 22). A month calendar of the whole school: each
// day shows one chip per grade (present+late / recorded, absences in red),
// one color per grade. Pick a student to see that child's own green / amber /
// red days. Click a day for who was late or absent. Arrows move through any
// month. Data comes from the teachers' Google Sheet via attendance-sync.gs.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr } from "../../lib/dates";
import { usDate } from "../../lib/format";
import { type GradeLite, type AttStatus, ATT_STATUS, gradeColor, gradeShort, shiftMonth, monthLabel, monthRange, monthCells, isWeekend } from "../../lib/calendar";

interface Enr { id: string; grade_id: number; grade_name: string | null; student_id: string; students: { first_name: string; last_name: string; student_no: number } }
interface Att { date: string; status: AttStatus; notes: string | null; enrollment_id: string;
  enrollments: { grade_id: number; student_id: string; students: { first_name: string; last_name: string } } }

export default function Attendance() {
  const [month, setMonth] = useState(todayStr().slice(0, 7));
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [enrs, setEnrs] = useState<Enr[]>([]);
  const [gradeF, setGradeF] = useState<number | "">("");
  const [enrF, setEnrF] = useState("");
  const [att, setAtt] = useState<Att[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (configMissing) return;
    Promise.all([
      supabase.from("grades").select("id, name, level_order").eq("is_active", true).order("level_order"),
      supabase.from("enrollments").select("id, grade_id, grade_name, student_id, students ( first_name, last_name, student_no )").eq("status", "active"),
    ]).then(([{ data: g }, { data: e }]) => {
      setGrades((g as GradeLite[]) ?? []);
      setEnrs(((e as unknown as Enr[]) ?? []).sort((a, b) => a.students.first_name.localeCompare(b.students.first_name)));
    });
  }, []);

  useEffect(() => {
    if (configMissing) return;
    setLoading(true); setDay(null);
    const [from, to] = monthRange(month);
    supabase.from("attendance")
      .select("date, status, notes, enrollment_id, enrollments!inner ( grade_id, student_id, students ( first_name, last_name ) )")
      .gte("date", from).lte("date", to).limit(5000)
      .then(({ data }) => { setAtt((data as unknown as Att[]) ?? []); setLoading(false); });
  }, [month]);

  const selEnr = enrs.find((e) => e.id === enrF) ?? null;
  const studentOptions = enrs.filter((e) => gradeF === "" || e.grade_id === gradeF);
  const gradeName = (gid: number) => grades.find((g) => g.id === gid)?.name ?? "—";
  const visible = useMemo(() => att.filter((a) => selEnr ? a.enrollment_id === selEnr.id : gradeF === "" || a.enrollments.grade_id === gradeF), [att, gradeF, selEnr]);

  // per day → per grade counts (or the one student's status)
  const byDay = useMemo(() => {
    const m: Record<string, { grades: Record<number, { present: number; late: number; absent: number }>; mine?: Att }> = {};
    visible.forEach((a) => {
      const cell = (m[a.date] ??= { grades: {} });
      const g = (cell.grades[a.enrollments.grade_id] ??= { present: 0, late: 0, absent: 0 });
      g[a.status]++;
      if (selEnr) cell.mine = a;
    });
    return m;
  }, [visible, selEnr]);
  const totals = useMemo(() => {
    const t = { present: 0, late: 0, absent: 0, days: Object.keys(byDay).length };
    visible.forEach((a) => t[a.status]++);
    return t;
  }, [visible, byDay]);
  const cells = useMemo(() => monthCells(month), [month]);
  const today = todayStr();

  const dayRows = day ? visible.filter((a) => a.date === day) : [];
  const dayByGrade = useMemo(() => {
    const m: Record<number, Att[]> = {};
    dayRows.forEach((a) => (m[a.enrollments.grade_id] ??= []).push(a));
    Object.values(m).forEach((l) => l.sort((a, b) => a.enrollments.students.first_name.localeCompare(b.enrollments.students.first_name)));
    return m;
  }, [dayRows]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Attendance</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select value={gradeF} onChange={(e) => { setGradeF(e.target.value === "" ? "" : Number(e.target.value)); setEnrF(""); }} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
            <option value="">All grades</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={enrF} onChange={(e) => setEnrF(e.target.value)} className="rounded border border-gray-300 bg-white px-2 py-1 text-sm">
            <option value="">Whole school</option>
            {studentOptions.map((e) => <option key={e.id} value={e.id}>{e.students.first_name} {e.students.last_name} · {e.grade_name ?? gradeName(e.grade_id)}</option>)}
          </select>
          <div className="flex items-center rounded-lg border border-gray-300 bg-white">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="px-2.5 py-1 text-sm text-gray-600 hover:bg-silver" title="Previous month">‹</button>
            <button onClick={() => setMonth(today.slice(0, 7))} className="border-x border-gray-300 px-3 py-1 text-sm font-semibold text-navy hover:bg-silver">{monthLabel(month)}</button>
            <button onClick={() => setMonth(shiftMonth(month, 1))} className="px-2.5 py-1 text-sm text-gray-600 hover:bg-silver" title="Next month">›</button>
          </div>
        </div>
      </div>
      <p className="mb-3 text-sm text-gray-500">
        Teachers mark attendance in the Google Sheet; it syncs here hourly. Each day shows one chip per grade: present + late out of recorded, absences in red.
        Pick a student to see their own days. Click a day for the names. Corrections are made in the Sheet.
      </p>

      {/* summary + legend */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-lg bg-green-100 px-2.5 py-1 font-semibold text-green-700">{totals.present} present</span>
        <span className="rounded-lg bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">{totals.late} late</span>
        <span className="rounded-lg bg-red-100 px-2.5 py-1 font-semibold text-red-700">{totals.absent} absent</span>
        <span className="text-gray-400">{loading ? "Loading…" : `${totals.days} school days recorded in ${monthLabel(month)}`}</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-600">
          {selEnr
            ? (Object.keys(ATT_STATUS) as AttStatus[]).map((k) => <span key={k} className="flex items-center gap-1"><span className={`h-3 w-3 rounded-full ${ATT_STATUS[k].dot}`} />{ATT_STATUS[k].label}</span>)
            : grades.map((g) => <span key={g.id} className="flex items-center gap-1"><span className={`h-3 w-3 rounded-full ${gradeColor(grades, g.id).dot}`} />{g.name}</span>)}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-gray-400">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={i} className="min-h-[5.5rem] rounded-lg bg-silver/60" />;
              const c = byDay[d];
              return (
                <button key={d} onClick={() => setDay(day === d ? null : d)}
                  className={`min-h-[5.5rem] rounded-lg border p-1 text-left align-top transition hover:border-royal ${day === d ? "border-royal ring-2 ring-royal/30" : "border-gray-100"} ${isWeekend(d) ? "bg-silver/40" : "bg-white"} ${d > today ? "opacity-60" : ""}`}>
                  <div className={`mb-1 text-xs font-semibold ${d === today ? "inline-block rounded-full bg-navy px-1.5 text-white" : "text-gray-500"}`}>{Number(d.slice(-2))}</div>
                  <div className="flex flex-col gap-0.5">
                    {c && selEnr && c.mine && (
                      <span className={`rounded border px-1 text-[10px] font-semibold leading-4 ${ATT_STATUS[c.mine.status].chip}`}>{ATT_STATUS[c.mine.status].label}</span>
                    )}
                    {c && !selEnr && Object.entries(c.grades).sort(([a], [b]) => Number(a) - Number(b)).map(([gid, v]) => {
                      const rec = v.present + v.late + v.absent;
                      return (
                        <span key={gid} className={`flex items-center justify-between gap-1 rounded border px-1 text-[10px] font-semibold leading-4 ${gradeColor(grades, Number(gid)).chip}`}
                          title={`${gradeName(Number(gid))}: ${v.present} present, ${v.late} late, ${v.absent} absent`}>
                          <span>{gradeShort(gradeName(Number(gid)))} {v.present + v.late}/{rec}</span>
                          {v.absent > 0 && <span className="rounded bg-red-500 px-1 text-[9px] text-white">{v.absent}</span>}
                        </span>
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          {!day ? (
            <p className="text-sm text-gray-400">Click a day to see who was present, late or absent.</p>
          ) : (
            <>
              <h2 className="font-display text-lg font-semibold text-navy">{usDate(day)}</h2>
              {!dayRows.length && <p className="mt-2 text-sm text-gray-400">No attendance recorded{selEnr ? " for this student" : ""}.</p>}
              {Object.entries(dayByGrade).sort(([a], [b]) => Number(a) - Number(b)).map(([gid, list]) => (
                <div key={gid} className="mt-3">
                  <div className="mb-1 flex items-center gap-2">
                    <span className={`rounded border px-1.5 text-[10px] font-semibold ${gradeColor(grades, Number(gid)).chip}`}>{gradeName(Number(gid))}</span>
                    <span className="text-xs text-gray-500">{list.filter((a) => a.status === "present").length} present · {list.filter((a) => a.status === "late").length} late · {list.filter((a) => a.status === "absent").length} absent</span>
                  </div>
                  <ul className="space-y-0.5 text-sm">
                    {list.map((a) => (
                      <li key={a.enrollment_id} className="flex items-center justify-between gap-2">
                        <Link to={`/admin/students/${a.enrollments.student_id}`} className="text-gray-700 hover:text-royal hover:underline">{a.enrollments.students.first_name} {a.enrollments.students.last_name}</Link>
                        <span className={`rounded border px-1.5 text-[10px] font-semibold ${ATT_STATUS[a.status].chip}`} title={a.notes ?? ""}>{ATT_STATUS[a.status].label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="mt-4 text-xs"><Link to="/admin/reports" className="text-royal hover:underline">Monthly attendance CSV</Link></div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
