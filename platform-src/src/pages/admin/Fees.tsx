import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr, monthStr } from "../../lib/dates";
import { useAuth } from "../../lib/auth";

interface PlanRow {
  id: string;
  plan_name: string;
  total_amount: number;
  billing_frequency: string;
  start_date: string | null;
  status: string;
  enrollment_id: string;
  enrollments: {
    id: string;
    grade_name: string;
    school_year: string;
    status: string;
    students: { id: string; first_name: string; last_name: string; student_no: number };
  };
  payments: { id: number; payment_date: string; amount: number; payment_method: string; reference_no: string | null }[];
}
// Zelle alerts read from the school Gmail (phase 21): pending ones need a match
interface ZelleRow {
  id: number; received_at: string; payer: string; amount: number; memo: string | null; status: string;
  matched_student_ids: string[]; match_note: string | null; resolved_at: string | null;
}
interface EnrollmentOpt {
  id: string;
  grade_name: string;
  students: { first_name: string; last_name: string };
}

export default function Fees() {
  const { profile } = useAuth();
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [unplanned, setUnplanned] = useState<EnrollmentOpt[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", payment_method: "cash", reference_no: "", payment_date: todayStr() });
  const [planForm, setPlanForm] = useState({ enrollment_id: "", total_amount: "", billing_frequency: "monthly" });
  // Correcting a recorded payment (wrong method/amount/date). Admin-only via
  // RLS; every change is written to audit_log by the payments_audit trigger.
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ payment_date: "", amount: "", payment_method: "cash", reference_no: "" });
  // Zelle review queue (phase 21)
  const [zelle, setZelle] = useState<ZelleRow[]>([]);
  const [zPick, setZPick] = useState<Record<number, string[]>>({});   // inbox id -> chosen student ids
  const [zBusy, setZBusy] = useState<number | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: p }, { data: e }, { data: z }] = await Promise.all([
      supabase.from("fee_plans")
        .select("*, enrollments!inner ( id, grade_name, school_year, status, students ( id, first_name, last_name, student_no ) ), payments ( id, payment_date, amount, payment_method, reference_no )")
        .eq("enrollments.status", "active"),
      supabase.from("enrollments")
        .select("id, grade_name, students ( first_name, last_name ), fee_plans ( id )")
        .eq("status", "active"),
      supabase.from("zelle_inbox").select("id, received_at, payer, amount, memo, status, matched_student_ids, match_note, resolved_at")
        .order("received_at", { ascending: false }).limit(60),
    ]);
    const zr = (z as ZelleRow[]) ?? [];
    setZelle(zr);
    setZPick((prev) => { const m = { ...prev }; zr.forEach((r) => { if (!m[r.id]) m[r.id] = r.matched_student_ids ?? []; }); return m; });
    setPlans(((p as unknown as PlanRow[]) ?? []).sort((a, b) =>
      a.enrollments.students.last_name.localeCompare(b.enrollments.students.last_name)));
    // fee_plans.enrollment_id is UNIQUE, so PostgREST embeds it as a to-one
    // object (or null) — never an array with .length.
    setUnplanned(((e as unknown as (EnrollmentOpt & { fee_plans: unknown })[]) ?? [])
      .filter((x) => !x.fee_plans || (Array.isArray(x.fee_plans) && !x.fee_plans.length)));
  }
  useEffect(() => { load(); }, []);

  const paid = (r: PlanRow) => r.payments.reduce((s, p) => s + Number(p.amount), 0);
  const paidThisMonth = (r: PlanRow) => {
    const m = monthStr();
    return r.payments.some((p) => p.payment_date.startsWith(m));
  };

  async function addPlan(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("fee_plans").insert({
      enrollment_id: planForm.enrollment_id,
      total_amount: Number(planForm.total_amount || 0),
      billing_frequency: planForm.billing_frequency,
      plan_name: Number(planForm.total_amount) === 0 ? "No fee" : "Standard",
    });
    if (error) return setMsg("Plan failed: " + error.message);
    setPlanForm({ enrollment_id: "", total_amount: "", billing_frequency: "monthly" });
    setMsg(null); load();
  }

  async function recordPayment(planId: string) {
    const { error } = await supabase.from("payments").insert({
      fee_plan_id: planId,
      amount: Number(payForm.amount),
      payment_method: payForm.payment_method,
      reference_no: payForm.reference_no || null,
      payment_date: payForm.payment_date,
      recorded_by: profile?.id,
    });
    if (error) return setMsg("Payment failed: " + error.message);
    setPayFor(null);
    setPayForm({ ...payForm, amount: "", reference_no: "" });
    setMsg(null); load();
  }

  async function postZelle(z: ZelleRow) {
    const ids = zPick[z.id] ?? [];
    if (!ids.length) return setMsg("Tick the student(s) this payment is for.");
    setZBusy(z.id);
    const { error } = await supabase.rpc("post_zelle", { p_inbox: z.id, p_students: ids, p_note: "matched by the office" });
    setZBusy(null);
    if (error) return setMsg("Could not post: " + error.message);
    setMsg(null); load();
  }
  async function ignoreZelle(z: ZelleRow) {
    if (!confirm(`Ignore the $${Number(z.amount).toFixed(2)} from ${z.payer}? (Use for non-tuition money such as donations.)`)) return;
    await supabase.from("zelle_inbox").update({ status: "ignored", resolved_at: new Date().toISOString(), resolved_by: profile?.id }).eq("id", z.id);
    load();
  }
  const studentName = (sid: string) => {
    const r = plans.find((p) => p.enrollments.students.id === sid);
    return r ? `${r.enrollments.students.first_name} ${r.enrollments.students.last_name}` : "student";
  };
  const zPending = zelle.filter((z) => z.status === "pending");
  const zRecent = zelle.filter((z) => z.status !== "pending").slice(0, 8);

  type Payment = PlanRow["payments"][number];
  function startEdit(p: Payment) {
    setEditId(p.id);
    setEditForm({ payment_date: p.payment_date, amount: String(p.amount), payment_method: p.payment_method, reference_no: p.reference_no ?? "" });
  }
  async function saveEdit() {
    if (editId == null) return;
    const { error } = await supabase.from("payments").update({
      payment_date: editForm.payment_date,
      amount: Number(editForm.amount),
      payment_method: editForm.payment_method,
      reference_no: editForm.reference_no || null,
    }).eq("id", editId);
    if (error) return setMsg("Update failed: " + error.message);
    setEditId(null); setMsg(null); load();
  }
  async function deletePayment(p: Payment) {
    if (!confirm(`Delete the $${Number(p.amount).toFixed(2)} payment dated ${p.payment_date}? This cannot be undone.`)) return;
    const { error } = await supabase.from("payments").delete().eq("id", p.id);
    if (error) return setMsg("Delete failed: " + error.message);
    setMsg(null); load();
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Fees</h1>
      <p className="mb-6 text-sm text-gray-500">
        One plan per enrollment (BR-010). Each student's fee can differ. $0 plans never trigger reminders (BR-121).
        Zelle receipts are read from the school Gmail every hour and posted automatically when the sender and amount are certain;
        the rest wait below. Every change to a payment is kept in the audit log. Parents are not notified of payments.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage fees.</p>}

      {zPending.length > 0 && (
        <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-800">💸 Zelle received — needs a match ({zPending.length})</h2>
          <p className="mb-3 text-xs text-amber-700">Tick the student(s) the money is for and post. The sender is remembered, so next month it posts by itself.</p>
          <div className="space-y-3">
            {zPending.map((z) => (
              <div key={z.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-navy">{z.payer}</span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-deep">${Number(z.amount).toFixed(2)}</span>
                  {z.memo && <span className="text-xs text-gray-500">"{z.memo}"</span>}
                  <span className="ml-auto text-xs text-gray-400">{new Date(z.received_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                </div>
                {z.match_note && <div className="mt-1 text-xs text-amber-700">{z.match_note}</div>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {plans.filter((p) => Number(p.total_amount) > 0).map((p) => {
                    const sid = p.enrollments.students.id;
                    const on = (zPick[z.id] ?? []).includes(sid);
                    return (
                      <label key={p.id} className={`flex items-center gap-1.5 text-xs ${on ? "font-semibold text-navy" : "text-gray-600"}`}>
                        <input type="checkbox" checked={on}
                          onChange={(e) => setZPick({ ...zPick, [z.id]: e.target.checked ? [...(zPick[z.id] ?? []), sid] : (zPick[z.id] ?? []).filter((x) => x !== sid) })} />
                        {p.enrollments.students.first_name} {p.enrollments.students.last_name} <span className="text-gray-400">${Number(p.total_amount).toFixed(0)}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => postZelle(z)} disabled={zBusy === z.id}
                    className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep disabled:opacity-50">
                    {zBusy === z.id ? "Posting…" : `Post $${Number(z.amount).toFixed(0)} to ${(zPick[z.id] ?? []).length || "…"} student${(zPick[z.id] ?? []).length === 1 ? "" : "s"}`}
                  </button>
                  <button onClick={() => ignoreZelle(z)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Not tuition — ignore</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {zRecent.length > 0 && (
        <details className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-navy">Recent Zelle alerts handled ({zRecent.length})</summary>
          <table className="mt-2 w-full text-xs">
            <tbody>
              {zRecent.map((z) => (
                <tr key={z.id} className="border-b last:border-0">
                  <td className="py-1 text-gray-500">{new Date(z.received_at).toLocaleDateString()}</td>
                  <td className="py-1 font-semibold text-navy">{z.payer}</td>
                  <td className="py-1">${Number(z.amount).toFixed(2)}</td>
                  <td className="py-1 text-gray-500">{z.status === "posted" ? "posted → " + (z.matched_student_ids ?? []).map(studentName).join(", ") : "ignored"}</td>
                  <td className="py-1 text-gray-400">{z.match_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {unplanned.length > 0 && (
        <form onSubmit={addPlan} className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-800">
            {unplanned.length} enrollment{unplanned.length > 1 ? "s" : ""} without a fee plan:
          </div>
          <select required value={planForm.enrollment_id}
            onChange={(e) => setPlanForm({ ...planForm, enrollment_id: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="" disabled>Select student…</option>
            {unplanned.map((u) => (
              <option key={u.id} value={u.id}>{u.students.first_name} {u.students.last_name} · {u.grade_name}</option>
            ))}
          </select>
          <input required type="number" min="0" step="1" placeholder="Monthly $"
            value={planForm.total_amount}
            onChange={(e) => setPlanForm({ ...planForm, total_amount: e.target.value })}
            className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm" />
          <select value={planForm.billing_frequency}
            onChange={(e) => setPlanForm({ ...planForm, billing_frequency: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm">
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="one-time">One-time</option>
          </select>
          <button className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Create plan</button>
        </form>
      )}

      <div className="space-y-3">
        {plans.map((r) => (
          <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-navy">
                {r.enrollments.students.first_name} {r.enrollments.students.last_name}
              </span>
              <span className="text-xs text-gray-400">
                #{String(r.enrollments.students.student_no).padStart(5, "0")} · {r.enrollments.grade_name}
              </span>
              <span className="rounded-full bg-silver px-2.5 py-0.5 text-xs font-semibold text-navy">
                ${Number(r.total_amount).toFixed(0)} / {r.billing_frequency}
              </span>
              {Number(r.total_amount) > 0 && (
                r.start_date && r.start_date > todayStr()
                  ? <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                      Starts {new Date(r.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  : paidThisMonth(r)
                    ? <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Paid this month</span>
                    : <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Not paid this month</span>
              )}
              <span className="ml-auto text-xs text-gray-400">Total received: ${paid(r).toFixed(2)}</span>
              <button onClick={() => setPayFor(payFor === r.id ? null : r.id)}
                className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">
                {payFor === r.id ? "Cancel" : "Record payment"}
              </button>
            </div>

            {payFor === r.id && (
              <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3">
                <input type="date" value={payForm.payment_date}
                  onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input type="number" min="1" step="0.01" placeholder="Amount $" value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <select value={payForm.payment_method}
                  onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {["cash", "check", "bank", "zelle", "other"].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input placeholder="Reference # (optional)" value={payForm.reference_no}
                  onChange={(e) => setPayForm({ ...payForm, reference_no: e.target.value })}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <button onClick={() => recordPayment(r.id)} disabled={!payForm.amount}
                  className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">
                  Save
                </button>
              </div>
            )}

            {r.payments.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-gray-400 hover:text-navy">
                  Payment history ({r.payments.length})
                </summary>
                <table className="mt-2 w-full text-xs">
                  <tbody>
                    {[...r.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).map((p) => (
                      editId === p.id ? (
                        <tr key={p.id} className="border-b bg-amber-50 last:border-0">
                          <td className="py-1 pr-2">
                            <input type="date" value={editForm.payment_date}
                              onChange={(e) => setEditForm({ ...editForm, payment_date: e.target.value })}
                              className="rounded border border-gray-300 px-1.5 py-1 text-xs" />
                          </td>
                          <td className="py-1 pr-2">
                            <input type="number" min="1" step="0.01" value={editForm.amount}
                              onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                              className="w-24 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                          </td>
                          <td className="py-1 pr-2">
                            <select value={editForm.payment_method}
                              onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}
                              className="rounded border border-gray-300 px-1.5 py-1 text-xs">
                              {["cash", "check", "bank", "zelle", "other"].map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                          </td>
                          <td className="py-1 pr-2">
                            <input placeholder="Reference #" value={editForm.reference_no}
                              onChange={(e) => setEditForm({ ...editForm, reference_no: e.target.value })}
                              className="w-28 rounded border border-gray-300 px-1.5 py-1 text-xs" />
                          </td>
                          <td className="py-1 text-right whitespace-nowrap">
                            <button onClick={saveEdit} disabled={!editForm.amount || !editForm.payment_date}
                              className="rounded bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-royal disabled:opacity-50">Save</button>
                            <button onClick={() => setEditId(null)} className="ml-2 text-xs text-gray-500 hover:text-navy">Cancel</button>
                          </td>
                        </tr>
                      ) : (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-1">{p.payment_date}</td>
                          <td className="py-1 font-semibold">${Number(p.amount).toFixed(2)}</td>
                          <td className="py-1">{p.payment_method}</td>
                          <td className="py-1 text-gray-400">{p.reference_no ?? ""}</td>
                          <td className="py-1 text-right whitespace-nowrap">
                            <button onClick={() => startEdit(p)} className="text-xs font-semibold text-royal hover:underline">Edit</button>
                            <button onClick={() => deletePayment(p)} className="ml-3 text-xs text-red-600 hover:underline">Delete</button>
                          </td>
                        </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        ))}
        {!configMissing && !plans.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No fee plans yet. Create one per enrolled student above.
          </p>
        )}
      </div>
    </div>
  );
}
