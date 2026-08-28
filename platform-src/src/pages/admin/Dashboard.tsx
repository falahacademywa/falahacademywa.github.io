import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface Widget {
  label: string;
  value: string | number;
  to: string;
}

export default function Dashboard() {
  const [widgets, setWidgets] = useState<Widget[]>([
    { label: "Total Students", value: "—", to: "/admin/students" },
    { label: "New Applications", value: "—", to: "/admin/admissions" },
    { label: "Parent Accounts", value: "—", to: "/admin/parents" },
    { label: "Teachers", value: "—", to: "/admin/teachers" },
  ]);

  useEffect(() => {
    if (configMissing) return;
    (async () => {
      const count = async (table: string, filter?: (q: any) => any) => {
        let q = supabase.from(table).select("*", { count: "exact", head: true });
        if (filter) q = filter(q);
        const { count: c } = await q;
        return c ?? 0;
      };
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);
      const [students, applicants, parents, teachers, presentToday, absentToday, plans] = await Promise.all([
        count("students", (q) => q.eq("archived", false)),
        count("applicants", (q) => q.eq("status", "under_review")),
        count("profiles", (q) => q.eq("role", "parent")),
        count("teachers", (q) => q.eq("active", true)),
        count("attendance", (q) => q.eq("date", today).in("status", ["present", "late"])),
        count("attendance", (q) => q.eq("date", today).eq("status", "absent")),
        supabase.from("fee_plans")
          .select("id, total_amount, start_date, enrollments!inner ( status ), payments ( payment_date )")
          .eq("status", "active").eq("enrollments.status", "active").gt("total_amount", 0)
          .then(({ data }) => data ?? []),
      ]);
      const outstanding = (plans as { start_date: string | null; payments: { payment_date: string }[] }[])
        .filter((p) => !p.start_date || p.start_date <= today)  // plans not yet started don't count
        .filter((p) => !p.payments.some((x) => x.payment_date.startsWith(month))).length;
      setWidgets([
        { label: "Total Students", value: students, to: "/admin/students" },
        { label: "New Applications", value: applicants, to: "/admin/admissions" },
        { label: "Present Today", value: presentToday, to: "/admin/reports" },
        { label: "Absent Today", value: absentToday, to: "/admin/reports" },
        { label: "Fees Unpaid (this month)", value: outstanding, to: "/admin/fees" },
        { label: "Parent Accounts", value: parents, to: "/admin/parents" },
        { label: "Teachers", value: teachers, to: "/admin/teachers" },
      ]);
    })();
  }, []);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-navy">Dashboard</h1>
      <p className="mb-6 mt-1 text-sm text-gray-500">
        Every metric is clickable — drill down to the detail behind it.
      </p>
      {configMissing && (
        <div className="mb-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
          Platform is not connected to a database yet. Run the Supabase setup, then set the
          project URL and anon key in <code>src/lib/supabase.ts</code>.
        </div>
      )}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {widgets.map((w) => (
          <Link key={w.label} to={w.to}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-royal hover:shadow-md">
            <div className="font-display text-3xl font-semibold text-navy">{w.value}</div>
            <div className="mt-1 text-sm text-gray-500">{w.label}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
