// Teacher app — Today: mark attendance for my class(es). One tap per child,
// saved immediately (upsert on enrollment + date). Replaces the Google Sheet.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useRoster, todayISO, medicalFlag, type RosterRow } from "../../lib/teacher";
import { usDate } from "../../lib/format";

type Status = "present" | "late" | "absent";
const BTN: Record<Status, string> = {
  present: "bg-green-600 text-white border-green-600", late: "bg-amber-500 text-white border-amber-500", absent: "bg-red-600 text-white border-red-600",
};

export default function Today() {
  const { roster, grades, loading, error } = useRoster();
  const [date, setDate] = useState(todayISO());
  const [gradeF, setGradeF] = useState<number | "">("");
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const rows = useMemo(() => roster.filter((r) => gradeF === "" || r.grade_id === gradeF), [roster, gradeF]);

  useEffect(() => {
    if (!roster.length) return;
    supabase.from("attendance").select("enrollment_id, status").eq("date", date).in("enrollment_id", roster.map((r) => r.enrollment_id))
      .then(({ data }) => {
        const m: Record<string, Status> = {};
        ((data as { enrollment_id: string; status: Status }[]) ?? []).forEach((a) => { m[a.enrollment_id] = a.status; });
        setMarks(m);
      });
  }, [date, roster]);

  async function mark(r: RosterRow, status: Status) {
    setSaving(r.enrollment_id); setMsg(null);
    const prev = marks[r.enrollment_id];
    setMarks({ ...marks, [r.enrollment_id]: status });
    const { error } = await supabase.from("attendance")
      .upsert({ enrollment_id: r.enrollment_id, date, status, recorded_by: "teacher app" }, { onConflict: "enrollment_id,date" });
    setSaving(null);
    if (error) { setMarks((m) => ({ ...m, [r.enrollment_id]: prev })); setMsg("Could not save: " + error.message); }
  }
  async function markAllPresent() {
    const missing = rows.filter((r) => !marks[r.enrollment_id]);
    if (!missing.length) return;
    setSaving("all");
    const { error } = await supabase.from("attendance")
      .upsert(missing.map((r) => ({ enrollment_id: r.enrollment_id, date, status: "present", recorded_by: "teacher app" })), { onConflict: "enrollment_id,date" });
    setSaving(null);
    if (error) return setMsg("Could not save: " + error.message);
    setMarks((m) => ({ ...m, ...Object.fromEntries(missing.map((r) => [r.enrollment_id, "present" as Status])) }));
  }

  const counts = rows.reduce((c, r) => { const s = marks[r.enrollment_id]; if (s) c[s]++; else c.unmarked++; return c; }, { present: 0, late: 0, absent: 0, unmarked: 0 });
  const weekend = [0, 5, 6].includes(new Date(date + "T00:00:00").getDay());

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="font-display text-xl font-semibold text-navy">Attendance</h1>
        <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm" />
      </div>
      {grades.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto">
          <button onClick={() => setGradeF("")} className={`rounded-full px-3 py-1 text-xs font-semibold ${gradeF === "" ? "bg-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}>All</button>
          {grades.map((g) => <button key={g.id} onClick={() => setGradeF(g.id)} className={`rounded-full px-3 py-1 text-xs font-semibold ${gradeF === g.id ? "bg-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}>{g.name}</button>)}
        </div>
      )}
      {weekend && <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">{usDate(date)} is not a school day (classes run Monday to Thursday).</div>}
      {msg && <div className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{msg}</div>}
      {error && <div className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div>}

      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="rounded-lg bg-green-100 px-2 py-1 font-semibold text-green-700">{counts.present} present</span>
        <span className="rounded-lg bg-amber-100 px-2 py-1 font-semibold text-amber-800">{counts.late} late</span>
        <span className="rounded-lg bg-red-100 px-2 py-1 font-semibold text-red-700">{counts.absent} absent</span>
        {counts.unmarked > 0 && <button onClick={markAllPresent} disabled={saving === "all"} className="ml-auto rounded-lg bg-navy px-3 py-1 font-semibold text-white disabled:opacity-50">Rest present ({counts.unmarked})</button>}
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.enrollment_id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <Link to={`/teacher/students/${r.student_id}`}>
              {r.profile_photo_url ? <img src={r.profile_photo_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-navy/10 text-sm font-bold text-navy">{r.first_name[0]}{r.last_name[0]}</div>}
            </Link>
            <Link to={`/teacher/students/${r.student_id}`} className="min-w-0 flex-1 active:opacity-70">
              <div className="truncate font-semibold text-navy underline decoration-gray-300 underline-offset-2">{r.first_name} {r.last_name}</div>
              <div className="text-[11px] text-gray-400">{r.grade_name}{medicalFlag(r) ? " · ⚕ medical note" : ""} · tap for profile</div>
            </Link>
            <div className="flex gap-1">
              {(["present", "late", "absent"] as Status[]).map((s) => (
                <button key={s} onClick={() => mark(r, s)} disabled={saving === r.enrollment_id}
                  className={`h-10 w-10 rounded-lg border text-sm font-bold ${marks[r.enrollment_id] === s ? BTN[s] : "border-gray-300 bg-white text-gray-500"}`}
                  aria-label={s}>{s[0].toUpperCase()}</button>
              ))}
            </div>
          </div>
        ))}
        {!loading && !rows.length && !error && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-sm text-gray-400">
            No students assigned to you yet. Ask the office to assign your grade on Admin → Teachers.
          </p>
        )}
      </div>
    </div>
  );
}
