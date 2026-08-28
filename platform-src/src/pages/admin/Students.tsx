import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface StudentRow {
  id: string;
  student_no: number;
  first_name: string;
  last_name: string;
  archived: boolean;
  profile_photo_url: string | null;
  enrollments: { school_year: string; grade_name: string; status: string }[];
}

type SortKey = "student_no" | "name" | "grade" | "status";

export default function Students() {
  const nav = useNavigate();
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(!configMissing);

  useEffect(() => {
    if (configMissing) return;
    supabase.from("students")
      .select("id, student_no, first_name, last_name, archived, profile_photo_url, enrollments ( school_year, grade_name, status )")
      .then(({ data }) => {
        setRows((data as unknown as StudentRow[]) ?? []);
        setLoading(false);
      });
  }, []);

  const current = (r: StudentRow) =>
    r.enrollments?.find((e) => e.status === "active") ?? r.enrollments?.[0];

  const tiles = useMemo(() => {
    const m = new Map<string, number>();
    rows.filter((r) => !r.archived).forEach((r) => {
      const g = current(r)?.grade_name;
      if (g) m.set(g, (m.get(g) ?? 0) + 1);
    });
    const order = ["Pre-K", "KG", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"];
    return [...m.entries()].sort((a, b) => {
      const ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const list = rows.filter((r) => {
      if (!showArchived && r.archived) return false;
      if (gradeFilter && current(r)?.grade_name !== gradeFilter) return false;
      return !q || `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) || String(r.student_no).includes(q);
    });
    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortKey) {
        case "student_no": return (a.student_no - b.student_no) * dir;
        case "grade": return ((current(a)?.grade_name ?? "").localeCompare(current(b)?.grade_name ?? "")) * dir;
        case "status": return ((a.archived ? 1 : 0) - (b.archived ? 1 : 0)) * dir;
        default: return (`${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)) * dir;
      }
    });
  }, [rows, search, showArchived, gradeFilter, sortKey, sortAsc]);

  function sortBy(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(true); }
  }
  const arrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ▲" : " ▼") : "";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Students</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          <input
            placeholder="Search name or student ID…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-royal focus:outline-none"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Grade tiles */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([grade, count]) => (
          <button key={grade} onClick={() => setGradeFilter(gradeFilter === grade ? null : grade)}
            className={`rounded-xl border p-4 text-left shadow-sm transition ${
              gradeFilter === grade ? "border-emerald-brand bg-emerald-50" : "border-gray-200 bg-white hover:border-royal"}`}>
            <div className="font-display text-3xl font-semibold text-navy">{count}</div>
            <div className="mt-0.5 text-sm text-gray-500">{grade}{gradeFilter === grade ? " · filtering ✕" : ""}</div>
          </button>
        ))}
      </div>

      {configMissing ? (
        <p className="text-sm text-gray-500">Connect the database to see students.</p>
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-silver text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("student_no")}>Student ID{arrow("student_no")}</th>
                <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("name")}>Name{arrow("name")}</th>
                <th className="px-4 py-3">Year</th>
                <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("grade")}>Grade{arrow("grade")}</th>
                <th className="cursor-pointer px-4 py-3 hover:text-navy" onClick={() => sortBy("status")}>Status{arrow("status")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const e = current(r);
                return (
                  <tr key={r.id} onClick={() => nav(`/admin/students/${r.id}`)}
                    className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                    <td className="px-4 py-2.5 font-mono">{String(r.student_no).padStart(5, "0")}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {r.profile_photo_url ? (
                          <img src={r.profile_photo_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
                            {r.first_name[0]}{r.last_name[0]}
                          </span>
                        )}
                        <span className="font-semibold text-navy">{r.first_name} {r.last_name}</span>
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{e?.school_year ?? "—"}</td>
                    <td className="px-4 py-2.5">{e?.grade_name ?? "—"}</td>
                    <td className="px-4 py-2.5">
                      {r.archived ? (
                        <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Archived</span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700">Active</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No students match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
