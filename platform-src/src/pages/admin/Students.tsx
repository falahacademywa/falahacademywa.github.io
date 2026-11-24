import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import SecureImg from "../../components/SecureImg";
import DocumentsGrid from "../../components/DocumentsGrid";
import { downloadCsv } from "../../lib/reports";
import { useAuth } from "../../lib/auth";
import { needsReview } from "../../components/FormChanges";

interface StudentRow {
  id: string;
  student_no: number;
  first_name: string;
  last_name: string;
  archived: boolean;
  profile_photo_url: string | null;
  photo_pending_url: string | null;
  enrollments: { school_year: string; grade_name: string; status: string }[];
}

type SortKey = "student_no" | "name" | "grade" | "status";

export default function Students() {
  const nav = useNavigate();
  const { can } = useAuth();
  // What parents changed and the office has not reviewed yet (President 2026-11-23): highlighted rows
  const [review, setReview] = useState<Record<string, string[]>>({});
  const [reviewOnly, setReviewOnly] = useState(false);
  const [rows, setRows] = useState<StudentRow[]>([]);
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [gradeFilter, setGradeFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [loading, setLoading] = useState(!configMissing);
  // List or the electronic-forms checklist (TODO #138); ?view=docs opens the checklist (Dashboard tile "Missing forms")
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "docs" ? "docs" : "list";

  useEffect(() => {
    if (configMissing) return;
    supabase.from("students")
      .select("id, student_no, first_name, last_name, date_of_birth, archived, profile_photo_url, photo_pending_url, enrollments ( school_year, grade_name, status )")
      .then(({ data }) => {
        const list = (data as unknown as StudentRow[]) ?? [];
        setRows(list);
        setLoading(false);
        const m: Record<string, string[]> = {};
        const add = (id: string, what: string) => { (m[id] ??= []).push(what); };
        list.forEach((r) => { if (r.photo_pending_url) add(r.id, "Photo to approve"); });
        if (!can("health")) { setReview(m); return; }
        Promise.all([
          supabase.from("medical_info").select("student_id, updated_at, reviewed_at"),
          supabase.from("media_consent").select("student_id, updated_at, reviewed_at"),
        ]).then(([{ data: med }, { data: con }]) => {
          type R = { student_id: string; updated_at: string | null; reviewed_at: string | null };
          ((med as R[]) ?? []).filter(needsReview).forEach((r) => add(r.student_id, "Health form"));
          ((con as R[]) ?? []).filter(needsReview).forEach((r) => add(r.student_id, "Photo consent"));
          setReview({ ...m });
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (reviewOnly && !review[r.id]) return false;
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
  }, [rows, search, showArchived, gradeFilter, sortKey, sortAsc, reviewOnly, review]);
  const toReview = rows.filter((r) => review[r.id]).length;

  function sortBy(k: SortKey) {
    if (sortKey === k) setSortAsc(!sortAsc);
    else { setSortKey(k); setSortAsc(true); }
  }
  const arrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ▲" : " ▼") : "";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="font-display text-2xl font-semibold text-navy">Students</h1>
          <div className="flex rounded-lg border border-gray-300 bg-white p-0.5 text-xs font-semibold">
            {(["list", "docs"] as const).map((v) => (
              <button key={v} onClick={() => setParams(v === "docs" ? { view: "docs" } : {})}
                className={`rounded-md px-3 py-1 ${view === v ? "bg-navy text-white" : "text-gray-600 hover:bg-silver"}`}>{v === "list" ? "List" : "Forms"}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <label className={`flex items-center gap-2 text-sm text-gray-600 ${view === "docs" ? "invisible" : ""}`}>
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {view === "list" && (
            <button onClick={() => downloadCsv("falah-roster.csv", ["Student #", "First name", "Last name", "Date of birth", "Grade", "School year", "Status"],
              filtered.map((r) => { const e = current(r); return [r.student_no, r.first_name, r.last_name, (r as StudentRow & { date_of_birth?: string }).date_of_birth ?? "", e?.grade_name ?? "", e?.school_year ?? "", r.archived ? "Archived" : "Active"]; }))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-silver">⬇ Roster CSV</button>
          )}
          <input
            placeholder="Search name or student ID…"
            className="w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-royal focus:outline-none"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Grade tiles (the Forms view draws its own: students missing a form per grade) */}
      {view === "list" && <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(([grade, count]) => (
          <button key={grade} onClick={() => setGradeFilter(gradeFilter === grade ? null : grade)}
            className={`rounded-xl border p-4 text-left shadow-sm transition ${
              gradeFilter === grade ? "border-emerald-brand bg-emerald-50" : "border-gray-200 bg-white hover:border-royal"}`}>
            <div className="font-display text-3xl font-semibold text-navy">{count}</div>
            <div className="mt-0.5 text-sm text-gray-500">{grade}{gradeFilter === grade ? " · filtering ✕" : ""}</div>
          </button>
        ))}
      </div>}

      {configMissing ? (
        <p className="text-sm text-gray-500">Connect the database to see students.</p>
      ) : view === "docs" ? (
        <DocumentsGrid gradeFilter={gradeFilter} search={search} onGrade={setGradeFilter} />
      ) : loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
        {toReview > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <span><b>{toReview} student{toReview === 1 ? "" : "s"}</b> {toReview === 1 ? "has" : "have"} changes from parents to review (highlighted). Open one to see exactly what changed.</span>
            <button onClick={() => setReviewOnly(!reviewOnly)}
              className="ml-auto rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
              {reviewOnly ? "Show all students" : "Show only these"}
            </button>
          </div>
        )}
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
                    className={`cursor-pointer border-b last:border-0 ${review[r.id] ? "bg-amber-50 shadow-[inset_4px_0_0_#f59e0b] hover:bg-amber-100" : "hover:bg-silver/60"}`}>
                    <td className="px-4 py-2.5 font-mono">{String(r.student_no).padStart(5, "0")}</td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        {r.profile_photo_url ? (
                          <SecureImg src={r.profile_photo_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-navy/10 text-[10px] font-bold text-navy">
                            {r.first_name[0]}{r.last_name[0]}
                          </span>
                        )}
                        <span className="font-semibold text-navy">{r.first_name} {r.last_name}</span>
                        {review[r.id] && (
                          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-900" title="Changed by a parent: open the student to see what changed">
                            ⚠ Review: {review[r.id].join(" · ")}
                          </span>
                        )}
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
        </>
      )}
    </div>
  );
}
