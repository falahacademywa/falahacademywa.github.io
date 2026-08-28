import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Row {
  id: string; subject: string; note: string; update_date: string; homework_due: string | null;
  attachment_url: string | null; teacher_email: string | null; enrollment_id: string | null;
  grades: { name: string } | null;
  enrollments: { students: { first_name: string; last_name: string } } | null;
}

export default function ClassUpdates() {
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const { data } = await supabase.from("class_updates")
      .select("id, subject, note, update_date, homework_due, attachment_url, teacher_email, enrollment_id, grades ( name ), enrollments ( students ( first_name, last_name ) )")
      .order("created_at", { ascending: false }).limit(100);
    setRows((data as unknown as Row[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    const { error } = await supabase.from("class_updates").delete().eq("id", id);
    if (error) setMsg("Delete failed: " + error.message);
    load();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Class Updates</h1>
      <p className="mb-6 text-sm text-gray-500">
        Teacher notes posted through the Class Update form. Parents see them in their feed;
        an evening digest notification goes out once per day. Delete anything posted in error.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="space-y-3">
        {rows.map((u) => (
          <div key={u.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-deep">{u.subject}</span>
              {u.enrollment_id ? (
                <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-navy">
                  {u.enrollments?.students.first_name} {u.enrollments?.students.last_name} only
                </span>
              ) : (
                <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs text-navy">{u.grades?.name}</span>
              )}
              {u.homework_due && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">due {u.homework_due}</span>}
              <span className="ml-auto text-xs text-gray-400">{u.update_date} · {u.teacher_email ?? "unknown"}</span>
              {u.attachment_url && (
                <a href={u.attachment_url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-royal hover:underline">Attachment</a>
              )}
              <button onClick={() => remove(u.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{u.note}</p>
          </div>
        ))}
        {!configMissing && !rows.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No class updates yet — they appear here as teachers submit the form.
          </p>
        )}
      </div>
    </div>
  );
}
