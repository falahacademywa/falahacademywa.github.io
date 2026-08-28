import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

interface Asg {
  id: string;
  grade_id: number | null;
  enrollment_id: string | null;
  subject: string;
  title: string;
  instructions: string | null;
  file_url: string | null;
  assigned_date: string;
  due_date: string | null;
  source: string;
  grades: { name: string } | null;
  enrollments: { students: { first_name: string; last_name: string } } | null;
}

const emptyForm = { scope: "grade", grade_id: "", enrollment_id: "", subject: "", title: "", instructions: "", file_url: "", due_date: "" };

export default function AssignmentsAdmin() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Asg[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data }, { data: g }, { data: en }] = await Promise.all([
      supabase.from("assignments")
        .select("*, grades ( name ), enrollments ( students ( first_name, last_name ) )")
        .order("assigned_date", { ascending: false }).limit(100),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
      supabase.from("enrollments").select("id, grade_name, students ( first_name, last_name )").eq("status", "active"),
    ]);
    setRows((data as unknown as Asg[]) ?? []);
    setGrades(g ?? []);
    setStudents(((en as any[]) ?? []).map((e) => ({
      id: e.id, label: `${e.students.first_name} ${e.students.last_name} · ${e.grade_name}`,
    })));
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("assignments").insert({
      grade_id: form.scope === "grade" ? Number(form.grade_id) : null,
      enrollment_id: form.scope === "student" ? form.enrollment_id : null,
      subject: form.subject || "General",
      title: form.title,
      instructions: form.instructions || null,
      file_url: form.file_url || null,
      due_date: form.due_date || null,
      created_by: profile?.id,
    });
    if (error) return setMsg("Save failed: " + error.message);
    setForm({ ...emptyForm });
    setShowForm(false);
    setMsg(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("assignments").delete().eq("id", id);
    if (error) setMsg("Delete failed: " + error.message);
    load();
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-4xl">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-navy">Assignments</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-emerald-brand px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-deep">
          {showForm ? "Cancel" : "+ New Assignment"}
        </button>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Files live in Google Drive — paste the share link here, or drop files in the synced Drive folder
        and they appear automatically. Publishing notifies the families (BR-038).
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      {showForm && (
        <form onSubmit={save} className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <div className="flex gap-4 sm:col-span-2">
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={form.scope === "grade"} onChange={() => setForm({ ...form, scope: "grade" })} /> Whole grade
            </label>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="radio" checked={form.scope === "student"} onChange={() => setForm({ ...form, scope: "student" })} /> One student
            </label>
          </div>
          {form.scope === "grade" ? (
            <select required value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="" disabled>Select grade…</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          ) : (
            <select required value={form.enrollment_id} onChange={(e) => setForm({ ...form, enrollment_id: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="" disabled>Select student…</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          )}
          <input placeholder="Subject (Math, Qur'an…)" value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm" />
          <input required placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
          <input placeholder="Google Drive link (optional)" value={form.file_url}
            onChange={(e) => setForm({ ...form, file_url: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm" />
          <label className="text-xs text-gray-500">Due date
            <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <textarea placeholder="Instructions (optional)" rows={2} value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
          <button className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">
            Publish assignment
          </button>
        </form>
      )}

      <div className="space-y-2">
        {rows.map((a) => (
          <div key={a.id} className="rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-navy">{a.title}</span>
              <span className="rounded-full bg-silver px-2 py-0.5 text-xs text-gray-600">{a.subject}</span>
              {a.grade_id ? (
                <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs text-navy">{a.grades?.name}</span>
              ) : (
                <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs text-navy">
                  {a.enrollments?.students.first_name} {a.enrollments?.students.last_name}
                </span>
              )}
              {a.source === "drive" && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">from Drive</span>}
              {a.due_date && (
                <span className={`text-xs font-semibold ${a.due_date < today ? "text-red-600" : "text-gray-500"}`}>
                  due {a.due_date}
                </span>
              )}
              <span className="ml-auto text-xs text-gray-400">{a.assigned_date}</span>
              {a.file_url && (
                <a href={a.file_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-royal hover:underline">Open</a>
              )}
              <button onClick={() => remove(a.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
            </div>
            {a.instructions && <p className="mt-1 text-xs text-gray-500">{a.instructions}</p>}
          </div>
        ))}
        {!configMissing && !rows.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No assignments yet.</p>
        )}
      </div>
    </div>
  );
}
