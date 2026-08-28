import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Applicant {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  application_date: string;
  status: string;
  notes: string | null;
  applied_grade_id: number | null;
  grades: { name: string } | null;
}

const STATUSES = [
  ["under_review", "Under Review"],
  ["accepted", "Accepted"],
  ["waitlisted", "Waitlisted"],
  ["not_accepted", "Not Accepted"],
  ["deferred", "Deferred"],
] as const;

const statusStyles: Record<string, string> = {
  under_review: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-700",
  waitlisted: "bg-blue-100 text-blue-700",
  not_accepted: "bg-red-100 text-red-700",
  deferred: "bg-gray-200 text-gray-600",
};

export default function Admissions() {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [filter, setFilter] = useState<string>("under_review");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data }, { data: g }] = await Promise.all([
      supabase
        .from("applicants")
        .select("*, grades ( name )")
        .order("application_date", { ascending: false }),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
    ]);
    setRows((data as unknown as Applicant[]) ?? []);
    setGrades(g ?? []);
  }
  useEffect(() => { load(); }, []);

  async function setStatus(a: Applicant, status: string) {
    setMsg(null);
    if (status === "accepted") {
      const { data, error } = await supabase.rpc("accept_applicant", { p_applicant: a.id });
      if (error) return setMsg("Accept failed: " + error.message);
      setMsg(`${a.first_name} ${a.last_name} accepted — student record created (${data ? "ID assigned" : "ok"}).`);
    } else {
      const { error } = await supabase.from("applicants").update({ status }).eq("id", a.id);
      if (error) return setMsg("Update failed: " + error.message);
    }
    load();
  }

  async function setGrade(a: Applicant, gradeId: number) {
    const { error } = await supabase.from("applicants").update({ applied_grade_id: gradeId }).eq("id", a.id);
    if (error) setMsg("Grade change failed: " + error.message);
    load();
  }

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Admissions</h1>
        <div className="flex gap-1.5">
          <button onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === "all" ? "bg-navy text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
            All ({rows.length})
          </button>
          {STATUSES.map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === v ? "bg-navy text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
              {label} ({rows.filter((r) => r.status === v).length})
            </button>
          ))}
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage admissions.</p>}

      <div className="space-y-3">
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-navy">{a.first_name} {a.last_name}</span>
                <span className={`ml-3 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[a.status]}`}>
                  {STATUSES.find(([v]) => v === a.status)?.[1] ?? a.status}
                </span>
              </div>
              <div className="text-xs text-gray-400">Applied {a.application_date}</div>
            </div>
            <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
              <div>DOB: {a.date_of_birth ?? "—"}</div>
              <div>Parent: {a.parent_name ?? "—"} {a.parent_phone ? `· ${a.parent_phone}` : ""}</div>
              <div>Email: {a.parent_email ?? "—"}</div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
              <label className="flex items-center gap-2 text-xs text-gray-500">
                Recommended grade:
                <select value={a.applied_grade_id ?? ""} onChange={(e) => setGrade(a, Number(e.target.value))}
                  className="rounded border border-gray-300 px-2 py-1 text-sm">
                  <option value="" disabled>—</option>
                  {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <div className="ml-auto flex gap-2">
                {a.status !== "accepted" && (
                  <>
                    <button onClick={() => setStatus(a, "accepted")}
                      className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">
                      Accept → Enroll
                    </button>
                    <button onClick={() => setStatus(a, "waitlisted")}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Waitlist</button>
                    <button onClick={() => setStatus(a, "deferred")}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Defer</button>
                    <button onClick={() => setStatus(a, "not_accepted")}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Decline</button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {!configMissing && !filtered.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No applicants in this view. New submissions from the website admission form will appear here automatically once form intake is connected.
          </p>
        )}
      </div>
    </div>
  );
}
