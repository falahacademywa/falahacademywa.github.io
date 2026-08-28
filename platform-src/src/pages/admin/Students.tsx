import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface StudentRow {
  id: string;
  student_no: number;
  first_name: string;
  last_name: string;
  archived: boolean;
  enrollments: { school_year: string; grade_name: string; status: string }[];
}

export default function Students() {
  const nav = useNavigate();
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(!configMissing);

  useEffect(() => {
    if (configMissing) return;
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("id, student_no, first_name, last_name, archived, enrollments ( school_year, grade_name, status )")
        .order("last_name");
      setRows((data as unknown as StudentRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const filtered = rows.filter((r) => {
    if (!showArchived && r.archived) return false;
    const q = search.toLowerCase();
    return (
      !q ||
      `${r.first_name} ${r.last_name}`.toLowerCase().includes(q) ||
      String(r.student_no).includes(q)
    );
  });

  const current = (r: StudentRow) =>
    r.enrollments?.find((e) => e.status === "active") ?? r.enrollments?.[0];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
      {configMissing ? (
        <p className="text-sm text-gray-500">Connect the database to see students.</p>
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-silver text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Student ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3">Grade</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const e = current(r);
                return (
                  <tr key={r.id} onClick={() => nav(`/admin/students/${r.id}`)}
                    className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                    <td className="px-4 py-3 font-mono">{String(r.student_no).padStart(5, "0")}</td>
                    <td className="px-4 py-3 font-semibold text-navy">{r.first_name} {r.last_name}</td>
                    <td className="px-4 py-3">{e?.school_year ?? "—"}</td>
                    <td className="px-4 py-3">{e?.grade_name ?? "—"}</td>
                    <td className="px-4 py-3">
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
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No students found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
