import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface Teacher {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  qualification: string | null;
  hire_date: string | null;
  active: boolean;
  teacher_grades: { id: number; role: string; grades: { id: number; name: string } }[];
}
interface Enr {
  grade_id: number;
  grade_name: string;
  students: { id: string; student_no: number; first_name: string; last_name: string };
}

export default function TeacherProfile() {
  const { id } = useParams();
  const [t, setT] = useState<Teacher | null>(null);
  const [enrs, setEnrs] = useState<Enr[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (configMissing || !id) return;
    (async () => {
      const { data, error } = await supabase
        .from("teachers")
        .select("id, first_name, last_name, email, phone, qualification, hire_date, active, teacher_grades ( id, role, grades ( id, name ) )")
        .eq("id", id).single();
      if (error) { setErr(error.message); return; }
      const teacher = data as unknown as Teacher;
      setT(teacher);
      const gradeIds = teacher.teacher_grades.map((tg) => tg.grades.id);
      if (gradeIds.length) {
        const { data: e } = await supabase
          .from("enrollments")
          .select("grade_id, grade_name, students ( id, student_no, first_name, last_name )")
          .in("grade_id", gradeIds).eq("status", "active");
        setEnrs(((e as unknown as Enr[]) ?? []).sort((a, b) =>
          a.grade_name.localeCompare(b.grade_name) || a.students.last_name.localeCompare(b.students.last_name)));
      }
    })();
  }, [id]);

  if (configMissing) return <p className="text-sm text-gray-500">Connect the database first.</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!t) return <p className="text-sm text-gray-500">Loading…</p>;

  const byGrade = new Map<string, Enr[]>();
  enrs.forEach((e) => {
    byGrade.set(e.grade_name, [...(byGrade.get(e.grade_name) ?? []), e]);
  });

  return (
    <div className="max-w-4xl">
      <Link to="/admin/teachers" className="text-sm text-royal hover:underline">← Teachers</Link>
      <div className="mt-2 mb-6">
        <h1 className="font-display text-2xl font-semibold text-navy">{t.first_name} {t.last_name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          {t.email && <span>✉️ {t.email}</span>}
          {t.phone && <span>📞 {t.phone}</span>}
          {t.qualification && <span>{t.qualification}</span>}
          {!t.active && <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Inactive</span>}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {t.teacher_grades.map((tg) => (
            <span key={tg.id}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${tg.role === "quran" ? "bg-emerald-50 text-emerald-deep" : "bg-navy/10 text-navy"}`}>
              {tg.grades.name} · {tg.role === "quran" ? "Qur'an" : "Homeroom"}
            </span>
          ))}
          {!t.teacher_grades.length && <span className="text-xs text-gray-400">No grades assigned yet.</span>}
        </div>
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">
        Students ({enrs.length})
      </h2>
      {[...byGrade.entries()].map(([grade, rows]) => (
        <section key={grade} className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 font-display text-base font-semibold text-navy">{grade} <span className="text-sm font-normal text-gray-400">({rows.length})</span></h3>
          <table className="w-full text-sm">
            <tbody>
              {rows.map((e) => (
                <tr key={e.students.id} className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                  <td className="w-24 py-2 font-mono text-gray-500">
                    <Link to={`/admin/students/${e.students.id}`}>{String(e.students.student_no).padStart(5, "0")}</Link>
                  </td>
                  <td className="py-2 font-semibold text-navy">
                    <Link to={`/admin/students/${e.students.id}`}>{e.students.first_name} {e.students.last_name}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!enrs.length && (
        <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
          No active students in this teacher's grades yet.
        </p>
      )}
    </div>
  );
}
