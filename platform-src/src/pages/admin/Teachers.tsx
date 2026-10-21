import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface TeacherRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  app_access: boolean;
  user_id: string | null;
  app_last_sign_in: string | null;
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
        .select("id, first_name, last_name, email, phone, active, app_access, user_id, app_last_sign_in, teacher_grades ( id, role, grades ( name ) )")
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
  // Teacher app (phase 26): grant or revoke sign-in with the teacher's own Google/Microsoft account
  async function toggleApp(t: TeacherRow) {
    setMsg(null);
    if (t.app_access && !confirm(`Revoke app access for ${t.first_name}? Their phone stops working on the next request.`)) return;
    const { data, error } = await supabase.rpc("set_teacher_app_access", { p_teacher: t.id, p_on: !t.app_access });
    if (error) return setMsg("Could not change app access: " + error.message + (error.message.includes("set_teacher_app_access") ? " — run platform_schema_phase26.sql" : ""));
    const r = data as { app_access: boolean; linked?: boolean };
    setMsg(r.app_access
      ? `App access on. ${t.first_name} signs in at the portal with "Continue with Google" or "Continue with Microsoft" using ${t.email}${r.linked ? " (an existing login with that e-mail is now linked)" : ""}.`
      : `App access revoked for ${t.first_name}.`);
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
      {msg && <div className={`mb-4 rounded-lg p-3 text-sm ${/^App access/.test(msg) ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg}</div>}
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
                <Link to={`/admin/teachers/${t.id}`} className="font-semibold text-navy hover:underline">
                  {t.first_name} {t.last_name}
                </Link>
                <span className="ml-3 text-sm text-gray-500">{t.email ?? ""} {t.phone ? `· ${t.phone}` : ""}</span>
                {!t.active && <span className="ml-3 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Inactive</span>}
                <Link to={`/admin/teachers/${t.id}`} className="ml-3 text-xs font-semibold text-royal hover:underline">View profile →</Link>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  !t.app_access ? "bg-gray-100 text-gray-500" : t.app_last_sign_in ? "bg-emerald-50 text-emerald-deep" : "bg-amber-100 text-amber-800"}`}
                  title={t.app_last_sign_in ? `Last app sign-in ${new Date(t.app_last_sign_in).toLocaleString()}` : ""}>
                  {!t.app_access ? "App: off" : t.app_last_sign_in ? `App: signed in ${new Date(t.app_last_sign_in).toLocaleDateString()}` : "App: invited, not signed in"}
                </span>
                <button onClick={() => toggleApp(t)} disabled={!t.active || !t.email} title={!t.email ? "Add the teacher's e-mail first" : ""}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${t.app_access ? "border border-red-200 text-red-600 hover:bg-red-50" : "bg-navy text-white hover:bg-royal"}`}>
                  {t.app_access ? "Revoke app access" : "Grant app access"}
                </button>
                <button onClick={() => toggleActive(t)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                  {t.active ? "Deactivate" : "Reactivate"}
                </button>
              </div>
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
