import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface TeacherRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  teacher_grades: { id: number; role: string; grades: { name: string } }[];
}

export default function Teachers() {
  const [rows, setRows] = useState<TeacherRow[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [yearId, setYearId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ first_name: "", last_name: "", email: "", phone: "" });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: t }, { data: g }, { data: y }] = await Promise.all([
      supabase.from("teachers")
        .select("id, first_name, last_name, email, phone, active, teacher_grades ( id, role, grades ( name ) )")
        .order("last_name"),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
      supabase.from("school_years").select("id").eq("is_current", true).single(),
    ]);
    setRows((t as unknown as TeacherRow[]) ?? []);
    setGrades(g ?? []);
    setYearId((y as { id: number } | null)?.id ?? null);
  }
  useEffect(() => { load(); }, []);

  async function addTeacher(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("teachers").insert(form);
    if (error) return setMsg("Add failed: " + error.message);
    setForm({ first_name: "", last_name: "", email: "", phone: "" });
    setShowForm(false);
    load();
  }

  async function assign(teacherId: string, gradeId: number, role: string) {
    if (!yearId) return setMsg("Set a current school year in Settings first.");
    const { error } = await supabase.from("teacher_grades")
      .insert({ teacher_id: teacherId, grade_id: gradeId, school_year_id: yearId, role });
    if (error) setMsg("Assign failed: " + error.message);
    load();
  }
  async function unassign(id: number) {
    await supabase.from("teacher_grades").delete().eq("id", id);
    load();
  }
  async function toggleActive(t: TeacherRow) {
    await supabase.from("teachers").update({ active: !t.active }).eq("id", t.id);
    load();
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-navy">Teachers</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-emerald-brand px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-deep">
          {showForm ? "Cancel" : "+ Add Teacher"}
        </button>
      </div>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage teachers.</p>}

      {showForm && (
        <form onSubmit={addTeacher} className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
          <input required placeholder="First name" className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <input required placeholder="Last name" className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <input type="email" placeholder="Email" className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Phone" className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Save</button>
        </form>
      )}

      <div className="space-y-3">
        {rows.map((t) => (
          <div key={t.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-navy">{t.first_name} {t.last_name}</span>
                <span className="ml-3 text-sm text-gray-500">{t.email ?? ""} {t.phone ? `· ${t.phone}` : ""}</span>
                {!t.active && <span className="ml-3 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Inactive</span>}
              </div>
              <button onClick={() => toggleActive(t)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                {t.active ? "Deactivate" : "Reactivate"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {t.teacher_grades.map((tg) => (
                <span key={tg.id} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${tg.role === "quran" ? "bg-emerald-50 text-emerald-deep" : "bg-silver text-navy"}`}>
                  {tg.grades.name} · {tg.role === "quran" ? "Qur'an" : "Homeroom"}
                  <button onClick={() => unassign(tg.id)} className="text-gray-400 hover:text-red-600">✕</button>
                </span>
              ))}
              <details className="relative">
                <summary className="cursor-pointer list-none rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:bg-silver">+ Assign grade</summary>
                <div className="absolute z-10 mt-1 w-52 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                  {grades.map((g) => (
                    <div key={g.id} className="flex items-center justify-between px-2 py-1 text-sm">
                      <span>{g.name}</span>
                      <span className="flex gap-1">
                        <button onClick={() => assign(t.id, g.id, "homeroom")}
                          className="rounded bg-silver px-2 py-0.5 text-xs hover:bg-gray-200">Homeroom</button>
                        <button onClick={() => assign(t.id, g.id, "quran")}
                          className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-deep hover:bg-emerald-100">Qur'an</button>
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        ))}
        {!configMissing && !rows.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No teachers yet — add the four class teachers and the Qur'an teacher.</p>
        )}
      </div>
    </div>
  );
}
