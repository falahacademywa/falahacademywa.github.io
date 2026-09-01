import { useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { monthStr } from "../../lib/dates";

function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function Reports() {
  const [month, setMonth] = useState(monthStr());
  const [msg, setMsg] = useState<string | null>(null);

  async function exportRoster() {
    const { data } = await supabase.from("students")
      .select("student_no, first_name, last_name, date_of_birth, archived, enrollments ( school_year, grade_name, status )")
      .order("student_no");
    downloadCsv("falah-roster.csv",
      ["StudentNo", "First Name", "Last Name", "DOB", "Grade", "School Year", "Status"],
      (data ?? []).map((s: any) => {
        const e = s.enrollments?.find((x: any) => x.status === "active") ?? s.enrollments?.[0];
        return [s.student_no, s.first_name, s.last_name, s.date_of_birth,
          e?.grade_name ?? "", e?.school_year ?? "", s.archived ? "Archived" : "Active"];
      }));
    setMsg("Roster exported.");
  }

  async function exportAttendance() {
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const { data } = await supabase.from("attendance")
      .select("date, status, enrollments!inner ( grade_name, students ( student_no, first_name, last_name ) )")
      .gte("date", `${month}-01`).lte("date", `${month}-${String(last).padStart(2, "0")}`)
      .order("date");
    downloadCsv(`falah-attendance-${month}.csv`,
      ["Date", "StudentNo", "Student", "Grade", "Status"],
      (data ?? []).map((r: any) => [r.date, r.enrollments.students.student_no,
        `${r.enrollments.students.first_name} ${r.enrollments.students.last_name}`,
        r.enrollments.grade_name, r.status]));
    setMsg(`Attendance for ${month} exported.`);
  }

  async function exportFees() {
    const { data } = await supabase.from("fee_plans")
      .select("plan_name, total_amount, billing_frequency, enrollments!inner ( grade_name, status, students ( student_no, first_name, last_name ) ), payments ( payment_date, amount )")
      .eq("enrollments.status", "active");
    const thisMonth = monthStr();
    downloadCsv("falah-fees.csv",
      ["StudentNo", "Student", "Grade", "Plan $", "Frequency", "Total Paid", "Paid This Month"],
      (data ?? []).map((r: any) => [
        r.enrollments.students.student_no,
        `${r.enrollments.students.first_name} ${r.enrollments.students.last_name}`,
        r.enrollments.grade_name, r.total_amount, r.billing_frequency,
        r.payments.reduce((s: number, p: any) => s + Number(p.amount), 0),
        r.payments.some((p: any) => p.payment_date.startsWith(thisMonth)) ? "Yes" : "No",
      ]));
    setMsg("Fees exported.");
  }

  const card = "rounded-xl border border-gray-200 bg-white p-5 shadow-sm";
  const btn = "rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal";

  return (
    <div className="max-w-3xl">
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Reports &amp; Exports</h1>
      <p className="mb-6 text-sm text-gray-500">
        Dashboards answer most questions; exports are for record-keeping and offline review. CSV opens in Excel/Sheets.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="space-y-4">
        <div className={card}>
          <h2 className="font-semibold text-navy">Student Roster</h2>
          <p className="mb-3 mt-1 text-sm text-gray-500">All students with current grade, year, and status.</p>
          <button className={btn} onClick={exportRoster}>Export CSV</button>
        </div>
        <div className={card}>
          <h2 className="font-semibold text-navy">Monthly Attendance</h2>
          <p className="mb-3 mt-1 text-sm text-gray-500">Every attendance record for the selected month.</p>
          <div className="flex items-center gap-3">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
            <button className={btn} onClick={exportAttendance}>Export CSV</button>
          </div>
        </div>
        <div className={card}>
          <h2 className="font-semibold text-navy">Fees Status</h2>
          <p className="mb-3 mt-1 text-sm text-gray-500">Every active fee plan with totals and this-month payment status.</p>
          <button className={btn} onClick={exportFees}>Export CSV</button>
        </div>
      </div>
    </div>
  );
}
