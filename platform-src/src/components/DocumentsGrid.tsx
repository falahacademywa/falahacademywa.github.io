import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { downloadCsv } from "../lib/reports";
import { type FormStudent, PAPER_WITH_FORM, formsFor, loadFormStudents, missingOf } from "../lib/formsStatus";

// Students → Forms (TODO #138; reworked for the President 2026-11-22): one row per active student,
// one column per ELECTRONIC form: the two contact forms and the three health and consent forms as
// they are on file in the portal. A student is "missing" only when one of those is not filled in.
// Paper documents that have no electronic form (birth certificate, immunization, choice transfer)
// are not counted; "Show paper documents" adds them as extra columns for reference
// (📎 = scanned copy uploaded, ✓ = marked received on paper, ✗ = not on file).
// Click a student to open the profile, where forms are filled in and documents uploaded.
export const shortDoc = (n: string) => ({
  "Birth Certificate": "Birth cert.", "Primary Contact Information": "Primary contact", "Emergency Contact Information": "Emergency contact",
  "Medical/Allergies Form": "Medical form", "Photo, Video & Media Consent Form": "Media consent", "Immunization Certificate (CIS)": "Immunization",
  "Choice Transfer Confirmation": "Choice transfer",
}[n] ?? n);

export default function DocumentsGrid({ gradeFilter, search }: { gradeFilter: string | null; search: string }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const health = can("health");
  const forms = formsFor(health);
  const [paperTypes, setPaperTypes] = useState<string[]>([]);
  const [rows, setRows] = useState<FormStudent[] | null>(null);
  const [missingOnly, setMissingOnly] = useState(true);
  const [showPaper, setShowPaper] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("document_types").select("name").eq("active", true).order("sort"),
      loadFormStudents(health),
    ]).then(([{ data: t }, s]) => {
      // only the documents that have no electronic form; the others are the columns above
      setPaperTypes(((t as { name: string }[]) ?? []).map((x) => x.name).filter((n) => !PAPER_WITH_FORM.has(n)));
      setRows(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [health]);

  const doc = (s: FormStudent, t: string) => s.docs.find((d) => d.document_type === t);
  const missing = (s: FormStudent) => missingOf(s, health);
  const list = useMemo(() => {
    const q = search.toLowerCase();
    return (rows ?? []).filter((s) => (!gradeFilter || s.grade === gradeFilter) && (!q || `${s.first_name} ${s.last_name}`.toLowerCase().includes(q) || String(s.student_no).includes(q))
      && (!missingOnly || missing(s).length > 0))
      .sort((a, b) => missing(b).length - missing(a).length || `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, health, gradeFilter, search, missingOnly]);
  const scope = (rows ?? []).filter((s) => !gradeFilter || s.grade === gradeFilter);
  const complete = scope.filter((s) => missing(s).length === 0).length;
  const cols = showPaper ? paperTypes : [];

  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-deep">{complete} of {scope.length} students complete</span>
        <span className="rounded-full bg-red-50 px-3 py-1 font-semibold text-red-700">{scope.length - complete} missing a form</span>
        <label className="flex items-center gap-2 text-gray-600"><input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Only students with a form missing</label>
        {paperTypes.length > 0 && (
          <label className="flex items-center gap-2 text-gray-600" title="Birth certificate, immunization and the like: shown for reference, not counted as missing">
            <input type="checkbox" checked={showPaper} onChange={(e) => setShowPaper(e.target.checked)} /> Show paper documents
          </label>
        )}
        <button onClick={() => downloadCsv("missing_forms.csv", ["Student #", "Student", "Grade", ...forms.map((f) => f.label), ...cols.map((t) => `${shortDoc(t)} (paper)`), "Forms missing"],
          list.map((s) => [s.student_no, `${s.first_name} ${s.last_name}`, s.grade, ...forms.map((f) => (s.has[f.key] ? "yes" : "MISSING")),
            ...cols.map((t) => (doc(s, t) ? "on file" : "not on file")), missing(s).map((f) => f.label).join("; ")]))}
          className="ml-auto rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">⬇ Download CSV</button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-silver text-xs text-gray-500">
              <th className="px-3 py-2 text-left uppercase tracking-wide">Student</th>
              <th className="px-2 py-2 text-left uppercase tracking-wide">Grade</th>
              {forms.map((f) => { const n = scope.filter((s) => !s.has[f.key]).length; return (
                <th key={f.key} className="px-2 py-2 text-center font-semibold" title={f.title}>
                  {f.label}<div className={`text-[10px] font-normal ${n ? "text-red-600" : "text-emerald-deep"}`}>{n ? `${n} missing` : "all in"}</div>
                </th>
              ); })}
              {cols.map((t) => { const n = scope.filter((s) => !doc(s, t)).length; return (
                <th key={t} className="border-l border-gray-200 px-2 py-2 text-center font-semibold text-gray-400" title={`${t} (paper document, not counted)`}>
                  {shortDoc(t)}<div className="text-[10px] font-normal text-gray-400">{n ? `${n} not on file` : "all in"}</div>
                </th>
              ); })}
              <th className="px-3 py-2 text-right uppercase tracking-wide">Missing</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id} onClick={() => nav(`/admin/students/${s.id}`)} className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                <td className="px-3 py-2"><span className="font-semibold text-navy">{s.first_name} {s.last_name}</span> <span className="font-mono text-xs text-gray-400">{String(s.student_no).padStart(5, "0")}</span></td>
                <td className="px-2 py-2 text-gray-600">{s.grade}</td>
                {forms.map((f) => {
                  const scan = !s.has[f.key] && !!doc(s, f.paper);   // the paper form was scanned but never entered
                  return <td key={f.key} className="px-2 py-2 text-center" title={s.has[f.key] ? f.title : scan ? "Not filled in. A scan of the paper form is on file: open the student and enter it." : "Not filled in"}>
                    {s.has[f.key] ? <span className="font-bold text-emerald-deep">✓</span>
                      : <span className="font-bold text-red-600">✗{scan && <span className="ml-0.5 text-xs font-normal">📎</span>}</span>}
                  </td>;
                })}
                {cols.map((t) => {
                  const d = doc(s, t);
                  return <td key={t} className="border-l border-gray-100 px-2 py-2 text-center" title={d ? (d.storage_path || d.file_url ? "Copy on file" : "Marked received (paper)") : "Not on file"}>
                    {d ? <span className="text-emerald-deep">{d.storage_path || d.file_url ? "📎" : "✓"}</span> : <span className="text-gray-300">✗</span>}
                  </td>;
                })}
                <td className={`px-3 py-2 text-right font-semibold ${missing(s).length ? "text-red-700" : "text-emerald-deep"}`}>{missing(s).length || "—"}</td>
              </tr>
            ))}
            {!list.length && <tr><td colSpan={forms.length + cols.length + 3} className="px-4 py-8 text-center text-gray-400">{missingOnly ? "Every student has all the forms. 🎉" : "No students match."}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        ✓ on file in the portal · ✗ not filled in (📎 = a scan of the paper form is on file and can be entered). Only these electronic forms are counted; parents fill them in the Family Portal, or the office enters them from the paper form in the student's profile.
        {!health && " Health and consent forms are not part of your access, so only the two contact forms are shown."}
        {" "}Paper documents such as the birth certificate and immunization certificate are not counted: tick “Show paper documents” to see them.
      </p>
    </div>
  );
}
