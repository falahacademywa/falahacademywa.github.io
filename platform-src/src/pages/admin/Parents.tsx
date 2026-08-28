import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface ParentRow {
  id: string;
  full_name: string;
  phone: string | null;
  suspended: boolean;
  parent_students: { student_id: string; students: { first_name: string; last_name: string } }[];
}

interface StudentOpt { id: string; first_name: string; last_name: string }

export default function Parents() {
  const [rows, setRows] = useState<ParentRow[]>([]);
  const [students, setStudents] = useState<StudentOpt[]>([]);
  const [linking, setLinking] = useState<string | null>(null); // parent id being edited
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, phone, suspended, parent_students ( student_id, students ( first_name, last_name ) )")
        .eq("role", "parent")
        .order("full_name"),
      supabase.from("students").select("id, first_name, last_name").eq("archived", false).order("last_name"),
    ]);
    setRows((p as unknown as ParentRow[]) ?? []);
    setStudents(s ?? []);
  }
  useEffect(() => { load(); }, []);

  async function link(parentId: string, studentId: string) {
    const { error } = await supabase.from("parent_students").insert({ parent_id: parentId, student_id: studentId });
    if (error) setMsg("Link failed: " + error.message);
    load();
  }
  async function unlink(parentId: string, studentId: string) {
    const { error } = await supabase.from("parent_students").delete()
      .eq("parent_id", parentId).eq("student_id", studentId);
    if (error) setMsg("Unlink failed: " + error.message);
    load();
  }
  async function toggleSuspend(p: ParentRow) {
    const { error } = await supabase.from("profiles").update({ suspended: !p.suspended }).eq("id", p.id);
    if (error) setMsg("Update failed: " + error.message);
    load();
  }

  return (
    <div>
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Parents</h1>
      <p className="mb-6 text-sm text-gray-500">
        Parent accounts are created from the Supabase dashboard (Authentication → Users → Add user) or via the
        <code className="mx-1 rounded bg-silver px-1">create-parent</code> Edge Function once deployed.
        New accounts appear here automatically; link children below. Activation happens on Orientation Day (BR-013).
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage parents.</p>}

      <div className="space-y-3">
        {rows.map((p) => (
          <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-semibold text-navy">{p.full_name}</span>
                {p.phone && <span className="ml-3 text-sm text-gray-500">{p.phone}</span>}
                {p.suspended && (
                  <span className="ml-3 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Suspended</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => setLinking(linking === p.id ? null : p.id)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                  Link child
                </button>
                <button onClick={() => toggleSuspend(p)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                  {p.suspended ? "Reactivate" : "Suspend"}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {p.parent_students.map((ps) => (
                <span key={ps.student_id} className="flex items-center gap-1.5 rounded-full bg-silver px-3 py-1 text-xs font-semibold text-navy">
                  {ps.students.first_name} {ps.students.last_name}
                  <button onClick={() => unlink(p.id, ps.student_id)} title="Unlink"
                    className="text-gray-400 hover:text-red-600">✕</button>
                </span>
              ))}
              {!p.parent_students.length && <span className="text-xs text-gray-400">No children linked yet.</span>}
            </div>
            {linking === p.id && (
              <div className="mt-3 border-t border-gray-100 pt-3">
                <select defaultValue="" onChange={(e) => { if (e.target.value) { link(p.id, e.target.value); setLinking(null); } }}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  <option value="" disabled>Select a student to link…</option>
                  {students
                    .filter((s) => !p.parent_students.some((ps) => ps.student_id === s.id))
                    .map((s) => <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
        {!configMissing && !rows.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">No parent accounts yet.</p>
        )}
      </div>
    </div>
  );
}
