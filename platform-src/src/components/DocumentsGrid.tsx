import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { downloadCsv } from "../lib/reports";

// Students → Documents (TODO #138, President 2026-11-10): one row per active student, one column
// per required document (Settings → Required Documents; switching a type off removes it here).
// ✓ = on file (📎 = scanned copy uploaded, ✓ alone = marked received on paper), ✗ = missing.
// Click a student to open the profile, where documents are uploaded or marked received.
interface Stu { id: string; student_no: number; first_name: string; last_name: string; grade: string; docs: { document_type: string; storage_path: string | null; file_url: string | null }[] }

export const shortDoc = (n: string) => ({
  "Birth Certificate": "Birth cert.", "Primary Contact Information": "Primary contact", "Emergency Contact Information": "Emergency contact",
  "Medical/Allergies Form": "Medical form", "Photo, Video & Media Consent Form": "Media consent", "Immunization Certificate (CIS)": "Immunization",
  "Choice Transfer Confirmation": "Choice transfer",
}[n] ?? n);

export default function DocumentsGrid({ gradeFilter, search }: { gradeFilter: string | null; search: string }) {
  const nav = useNavigate();
  const [types, setTypes] = useState<string[]>([]);
  const [rows, setRows] = useState<Stu[] | null>(null);
  const [missingOnly, setMissingOnly] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from("document_types").select("name").eq("active", true).order("sort"),
      supabase.from("students").select("id, student_no, first_name, last_name, archived, enrollments ( grade_name, status ), document_references ( document_type, storage_path, file_url )").eq("archived", false),
    ]).then(([{ data: t }, { data: s }]) => {
      setTypes(((t as { name: string }[]) ?? []).map((x) => x.name));
      setRows(((s as unknown as (Omit<Stu, "grade" | "docs"> & { enrollments: { grade_name: string; status: string }[]; document_references: Stu["docs"] })[]) ?? [])
        .map((x) => ({ ...x, grade: (x.enrollments.find((e) => e.status === "active") ?? x.enrollments[0])?.grade_name ?? "—", docs: x.document_references ?? [] }))
        .filter((x) => x.grade !== "—"));
    });
  }, []);

  const has = (s: Stu, t: string) => s.docs.find((d) => d.document_type === t);
  const missing = (s: Stu) => types.filter((t) => !has(s, t));
  const list = useMemo(() => {
    const q = search.toLowerCase();
    return (rows ?? []).filter((s) => (!gradeFilter || s.grade === gradeFilter) && (!q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || String(s.student_no).includes(q))
      && (!missingOnly || missing(s).length > 0))
      .sort((a, b) => missing(b).length - missing(a).length || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
  }, [rows, types, gradeFilter, search, missingOnly]);
  const scope = (rows ?? []).filter((s) => !gradeFilter || s.grade === gradeFilter);
  const perType = (t: string) => scope.filter((s) => !has(s, t)).length;
  const complete = scope.filter((s) => missing(s).length === 0).length;

  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-deep">{complete} of {scope.length} students complete</span>
        <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-700">{scope.length - complete} missing something</span>
        <label className="flex items-center gap-2 text-gray-600"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Only students with something missing</label>
        <button onClick={() => downloadCsv("missing_documents.csv", ["Student #", "Student", "Grade", ...types.map(shortDoc), "Missing"],
          list.map((s) => [s.student_no, `${s.first_name} ${s.last_name}`, s.grade, ...types.map((t) => (has(s, t) ? "yes" : "MISSING")), missing(s).map(shortDoc).join("; ")]))}
          className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">⬇ Download CSV</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-silver text-xs text-gray-500">
              <th className="px-3 py-2 text-left uppercase tracking-wide">Student</th>
              <th className="px-2 py-2 text-left uppercase tracking-wide">Grade</th>
              {types.map((t) => (
                <th key={t} className="px-2 py-2 text-center font-semibold" title={t}>
                  {shortDoc(t)}<div className={`text-[10px] font-normal ${perType(t) ? "text-red-600" : "text-emerald-deep"}`}>{perType(t) ? `${perType(t)} missing` : "all in"}</div>
                </th>
              ))}
              <th className="px-3 py-2 text-right uppercase tracking-wide">Missing</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} onClick={() => nav(`/admin/students/${s.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                <td className="px-3 py-2"><span className="font-semibold text-navy">{s.first_name} {s.last_name}</span> <span className="font-mono text-xs text-gray-400">{String(s.student_no).padStart(5, "0")}</span></td>
                <td className="px-2 py-2 text-gray-600">{s.grade}</td>
                {types.map((t) => {
                  const d = has(s, t);
                  return <td key={t} className="px-2 py-2 text-center" title={d ? (d.storage_path || d.file_url ? "Copy on file" : "Marked received (paper)") : "Missing"}>
                    {d ? <span className="font-bold text-emerald-deep">{d.storage_path || d.file_url ? "📎" : "✓"}</span> : <span className="font-bold text-red-600">✗</span>}
                  </td>;
                })}
                <td className={`px-3 py-2 text-right font-semibold ${missing(s).length ? "text-red-700" : "text-emerald-deep"}`}>{missing(s).length || "—"}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={types.length + 3} className="px-4 py-8 text-center text-gray-400">{missingOnly ? "Every student has all required documents. 🎉" : "No students match."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">📎 scanned copy uploaded · ✓ marked received on paper · ✗ missing. Required documents are set in Settings → Required Documents. Click a student to upload or mark a document.</p>
    </div>
  );
}
