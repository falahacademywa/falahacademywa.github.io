import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface Student {
  id: string;
  student_no: number;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  archived: boolean;
  notes: string | null;
  enrollments: { id: string; school_year: string; grade_name: string; status: string; enrollment_date: string }[];
  parent_students: { profiles: { full_name: string; email: string | null; phone: string | null; address: string | null; must_change_password: boolean } }[];
  guardians: { id: string; name: string; relationship: string; phone: string | null; email: string | null; sort: number }[];
  emergency_contacts: { id: string; name: string; phone: string; relationship: string | null; is_primary: boolean }[];
  medical_info: { allergies: string | null; medical_conditions: string | null; medications: string | null } | null;
  document_references: { id: string; document_type: string; file_url: string; uploaded_date: string }[];
}

export default function StudentProfile() {
  const { id } = useParams();
  const [s, setS] = useState<Student | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    if (configMissing || !id) return;
    const { data, error } = await supabase
      .from("students")
      .select(`id, student_no, first_name, last_name, date_of_birth, gender, archived, notes,
        enrollments ( id, school_year, grade_name, status, enrollment_date ),
        parent_students ( profiles ( full_name, email, phone, address, must_change_password ) ),
        guardians ( id, name, relationship, phone, email, sort ),
        emergency_contacts ( id, name, phone, relationship, is_primary ),
        medical_info ( allergies, medical_conditions, medications ),
        document_references ( id, document_type, file_url, uploaded_date )`)
      .eq("id", id)
      .single();
    if (error) setErr(error.message);
    setS(data as unknown as Student);
  }
  useEffect(() => { load(); }, [id]);

  async function toggleArchive() {
    if (!s) return;
    await supabase.from("students").update({ archived: !s.archived }).eq("id", s.id);
    load();
  }

  if (configMissing) return <p className="text-sm text-gray-500">Connect the database to view student profiles.</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!s) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="max-w-4xl">
      <Link to="/admin/students" className="text-sm text-royal hover:underline">← Students</Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">{s.first_name} {s.last_name}</h1>
          <div className="mt-1 text-sm text-gray-500">
            Student ID <span className="font-mono font-semibold">{String(s.student_no).padStart(5, "0")}</span>
            {s.date_of_birth && <> · DOB {s.date_of_birth}</>}
            {s.gender && <> · {s.gender}</>}
            {s.archived && <span className="ml-2 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Archived</span>}
          </div>
        </div>
        <button onClick={toggleArchive}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
          {s.archived ? "Restore" : "Archive"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Enrollment History</h2>
          {s.enrollments.length ? (
            <table className="w-full text-sm">
              <tbody>
                {s.enrollments.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 font-semibold text-navy">{e.school_year}</td>
                    <td className="py-2">{e.grade_name}</td>
                    <td className="py-2 text-gray-500">{e.status}</td>
                    <td className="py-2 text-gray-400">{e.enrollment_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-400">No enrollments.</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Parents &amp; Guardians</h2>
          {(() => {
            const accounts = s.parent_students.map((ps) => ps.profiles);
            const badge = (email: string | null) => {
              const acc = email ? accounts.find((a) => a.email?.toLowerCase() === email.toLowerCase()) : undefined;
              if (!acc) return <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">no portal account</span>;
              return acc.must_change_password
                ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">invited — hasn't signed in</span>
                : <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">account active</span>;
            };
            const rows = [...s.guardians].sort((a, b) => a.sort - b.sort);
            if (!rows.length && !accounts.length)
              return <p className="text-sm text-gray-400">No parents on file yet.</p>;
            return (
              <>
                {rows.map((g) => (
                  <div key={g.id} className="border-b py-2 text-sm last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy">{g.name}</span>
                      <span className="text-xs capitalize text-gray-400">({g.relationship})</span>
                      {badge(g.email)}
                    </div>
                    <div className="mt-0.5 text-gray-600">
                      {g.phone && <span className="mr-3">📞 {g.phone}</span>}
                      {g.email && <span>✉️ {g.email}</span>}
                    </div>
                  </div>
                ))}
                {/* accounts that exist but aren't in the guardians registry */}
                {accounts.filter((a) => !rows.some((g) => g.email?.toLowerCase() === a.email?.toLowerCase())).map((a, i) => (
                  <div key={"acc" + i} className="border-b py-2 text-sm last:border-0">
                    <span className="font-semibold text-navy">{a.full_name}</span>
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">portal account</span>
                    <div className="mt-0.5 text-gray-600">
                      {a.phone && <span className="mr-3">📞 {a.phone}</span>}
                      {a.email && <span>✉️ {a.email}</span>}
                    </div>
                  </div>
                ))}
                {accounts.find((a) => a.address) && (
                  <p className="mt-2 text-xs text-gray-500">🏠 {accounts.find((a) => a.address)?.address}</p>
                )}
              </>
            );
          })()}
          {s.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-silver/60 p-3 text-xs text-gray-600">{s.notes}</p>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Emergency Contacts</h2>
          {s.emergency_contacts.length ? s.emergency_contacts.map((c) => (
            <div key={c.id} className="py-1 text-sm">
              <span className="font-semibold text-navy">{c.name}</span>
              <span className="ml-2 text-gray-500">{c.phone}</span>
              {c.relationship && <span className="ml-2 text-gray-400">({c.relationship})</span>}
              {c.is_primary && <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs text-navy">Primary</span>}
            </div>
          )) : <p className="text-sm font-semibold text-red-500">⚠ No emergency contact on file (BR-007).</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Medical Information</h2>
          {s.medical_info ? (
            <dl className="space-y-1 text-sm">
              <div><dt className="inline font-semibold text-navy">Allergies: </dt><dd className="inline text-gray-600">{s.medical_info.allergies || "None recorded"}</dd></div>
              <div><dt className="inline font-semibold text-navy">Conditions: </dt><dd className="inline text-gray-600">{s.medical_info.medical_conditions || "None recorded"}</dd></div>
              <div><dt className="inline font-semibold text-navy">Medications: </dt><dd className="inline text-gray-600">{s.medical_info.medications || "None recorded"}</dd></div>
            </dl>
          ) : <p className="text-sm text-gray-400">No medical information recorded.</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Documents (stored in Google Drive)</h2>
          {s.document_references.length ? s.document_references.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <a href={d.file_url} target="_blank" rel="noreferrer" className="font-semibold text-royal hover:underline">{d.document_type}</a>
              <span className="text-xs text-gray-400">{new Date(d.uploaded_date).toLocaleDateString()}</span>
            </div>
          )) : <p className="text-sm text-gray-400">No documents referenced.</p>}
        </section>
      </div>
    </div>
  );
}
