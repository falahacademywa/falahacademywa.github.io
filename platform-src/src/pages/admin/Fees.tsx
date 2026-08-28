import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

interface PlanRow {
  id: string;
  plan_name: string;
  total_amount: number;
  billing_frequency: string;
  status: string;
  enrollment_id: string;
  enrollments: {
    id: string;
    grade_name: string;
    school_year: string;
    status: string;
    students: { first_name: string; last_name: string; student_no: number };
  };
  payments: { id: number; payment_date: string; amount: number; payment_method: string; reference_no: string | null }[];
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
  const [payForm, setPayForm] = useState({ amount: "", payment_method: "cash", reference_no: "", payment_date: new Date().toISOString().slice(0, 10) });
  const [planForm, setPlanForm] = useState({ enrollment_id: "", total_amount: "", billing_frequency: "monthly" });

  async function load() {
    if (configMissing) return;
    const [{ data: p }, { data: e }] = await Promise.all([
      supabase.from("fee_plans")
        .select("*, enrollments!inner ( id, grade_name, school_year, status, students ( first_name, last_name, student_no ) ), payments ( id, payment_date, amount, payment_method, reference_no )")
        .eq("enrollments.status", "active"),
      supabase.from("enrollments")
        .select("id, grade_name, students ( first_name, last_name ), fee_plans ( id )")
        .eq("status", "active"),
    ]);
    setPlans(((p as unknown as PlanRow[]) ?? []).sort((a, b) =>
      a.enrollments.students.last_name.localeCompare(b.enrollments.students.last_name)));
    setUnplanned(((e as unknown as (EnrollmentOpt & { fee_plans: unknown[] })[]) ?? [])
      .filter((x) => !x.fee_plans?.length));
  }
  useEffect(() => { load(); }, []);

  const paid = (r: PlanRow) => r.payments.reduce((s, p) => s + Number(p.amount), 0);
  const paidThisMonth = (r: PlanRow) => {
    const m = new Date().toISOString().slice(0, 7);
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

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Fees</h1>
      <p className="mb-6 text-sm text-gray-500">
        One plan per enrollment (BR-010). Each student's fee can differ. $0 plans never trigger reminders (BR-121).
        Recording a payment automatically notifies the family.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage fees.</p>}

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
                paidThisMonth(r)
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
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-1">{p.payment_date}</td>
                        <td className="py-1 font-semibold">${Number(p.amount).toFixed(2)}</td>
                        <td className="py-1">{p.payment_method}</td>
                        <td className="py-1 text-gray-400">{p.reference_no ?? ""}</td>
                      </tr>
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
