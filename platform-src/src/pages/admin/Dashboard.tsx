import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr } from "../../lib/dates";
import { type Task, urgency, BUCKETS, bucketLabels } from "../../lib/tasks";
import { useAuth } from "../../lib/auth";
import { moduleForPath } from "../../lib/permissions";
import { type GradeLite, gradeColor } from "../../lib/calendar";
import { usDate } from "../../lib/format";

// Monday–Sunday of the week containing `iso`
function weekOf(iso: string): [string, string] {
  const d = new Date(iso + "T00:00:00");
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return [f(mon), f(sun)];
}

interface Widget {
  label: string;
  value: string | number;
  to: string;
  pair?: { paid: number; unpaid: number };   // two-number tile (fees this month)
}

export default function Dashboard() {
  const { can } = useAuth();
  // staff only see the tiles of modules they may view (phase 19)
  const allowed = (w: Widget) => { const m = moduleForPath(w.to); return !m || can(m.key); };
  const [widgets, setWidgets] = useState<Widget[]>([
    { label: "Total Students", value: "—", to: "/admin/students" },
    { label: "New Applications", value: "—", to: "/admin/admissions" },
    { label: "Parent Accounts", value: "—", to: "/admin/parents" },
    { label: "Teachers", value: "—", to: "/admin/teachers" },
  ]);

  // Open tasks from the school's to-do list, bucketed by urgency (same rules as the Tasks page).
  const [taskBuckets, setTaskBuckets] = useState<Record<string, number> | null>(null);
  const openTasks = taskBuckets ? Object.values(taskBuckets).reduce((s, n) => s + n, 0) : null;
  const labels = bucketLabels();

  // This week's class updates: per grade, the subjects that had at least one post (phase 22)
  const [week] = useState(() => weekOf(todayStr()));
  const [grades, setGrades] = useState<GradeLite[]>([]);
  const [weekSubjects, setWeekSubjects] = useState<Record<number, string[]> | null>(null);
  useEffect(() => {
    if (configMissing || !can("academics")) return;
    Promise.all([
      supabase.from("grades").select("id, name, level_order").eq("is_active", true).order("level_order"),
      supabase.from("class_updates").select("subject, grade_id, enrollments ( grade_id )").gte("update_date", week[0]).lte("update_date", week[1]),
    ]).then(([{ data: g }, { data: u }]) => {
      setGrades((g as GradeLite[]) ?? []);
      const m: Record<number, string[]> = {};
      ((u as unknown as { subject: string; grade_id: number | null; enrollments: { grade_id: number } | null }[]) ?? []).forEach((x) => {
        const gid = x.grade_id ?? x.enrollments?.grade_id; if (gid == null) return;
        const list = (m[gid] ??= []); if (!list.includes(x.subject)) list.push(x.subject);
      });
      Object.values(m).forEach((l) => l.sort());
      setWeekSubjects(m);
    });
  }, []);

  useEffect(() => {
    if (configMissing) return;
    supabase.from("admin_tasks").select("*").eq("is_done", false).then(({ data }) => {
      const counts: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b.icon, 0]));
      for (const t of (data as Task[]) ?? []) counts[urgency(t).icon] = (counts[urgency(t).icon] ?? 0) + 1;
      setTaskBuckets(counts);
    });
  }, []);

  useEffect(() => {
    if (configMissing) return;
    (async () => {
      const count = async (table: string, filter?: (q: any) => any) => {
        let q = supabase.from(table).select("*", { count: "exact", head: true });
        if (filter) q = filter(q);
        const { count: c } = await q;
        return c ?? 0;
      };
      const today = todayStr();
      const month = today.slice(0, 7);
      const [students, applicants, parents, teachers, presentToday, absentToday, plans, volunteers] = await Promise.all([
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
        count("volunteer_applications", (q) => q.in("status", ["new", "contacted", "screening"])).catch(() => 0),
      ]);
      const due = (plans as { start_date: string | null; payments: { payment_date: string }[] }[])
        .filter((p) => !p.start_date || p.start_date <= today);  // plans not yet started don't count
      const outstanding = due.filter((p) => !p.payments.some((x) => x.payment_date.startsWith(month))).length;
      const paid = due.length - outstanding;
      setWidgets([
        { label: "Total Students", value: students, to: "/admin/students" },
        { label: "New Applications", value: applicants, to: "/admin/admissions" },
        { label: "Volunteers in progress", value: volunteers, to: "/admin/volunteers" },
        { label: "Present Today", value: presentToday, to: "/admin/attendance" },
        { label: "Absent Today", value: absentToday, to: "/admin/attendance" },
        { label: "Fees this month", value: `${paid}/${due.length}`, to: "/admin/fees", pair: { paid, unpaid: outstanding } },
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
        {widgets.filter(allowed).map((w) => (
          <Link key={w.label} to={w.to}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-royal hover:shadow-md">
            {w.pair ? (
              <div className="flex items-end gap-4">
                <div><div className="font-display text-3xl font-semibold text-green-600">{w.pair.paid}</div><div className="text-xs font-semibold text-green-700">Paid</div></div>
                <div><div className={`font-display text-3xl font-semibold ${w.pair.unpaid ? "text-red-600" : "text-gray-300"}`}>{w.pair.unpaid}</div><div className={`text-xs font-semibold ${w.pair.unpaid ? "text-red-700" : "text-gray-400"}`}>Unpaid</div></div>
              </div>
            ) : (
              <div className="font-display text-3xl font-semibold text-navy">{w.value}</div>
            )}
            <div className="mt-1 text-sm text-gray-500">{w.label}</div>
          </Link>
        ))}

        {can("academics") && <Link to="/admin/updates" title="Open Class Updates"
          className="col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-royal hover:shadow-md lg:col-span-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-display text-xl font-semibold text-navy">Class updates this week</div>
            <div className="text-xs text-gray-400">Mon {usDate(week[0])} – Sun {usDate(week[1])} · click to open</div>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {grades.map((g) => { const subs = weekSubjects?.[g.id] ?? []; const c = gradeColor(grades, g.id); return (
              <div key={g.id} className={`rounded-lg border p-3 ${subs.length ? c.chip : "border-dashed border-gray-200 bg-silver/40 text-gray-400"}`}>
                <div className="flex items-center gap-2 text-sm font-bold"><span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />{g.name}</div>
                <div className="mt-1 text-sm">{weekSubjects == null ? "…" : subs.length ? subs.join(", ") : "no updates yet"}</div>
              </div>
            ); })}
            {!grades.length && <div className="text-sm text-gray-400">{weekSubjects == null ? "Loading…" : "No active grades."}</div>}
          </div>
        </Link>}

        {can("tasks") && <Link to="/admin/tasks"
          className="col-span-2 rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:border-royal hover:shadow-md lg:col-span-4">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="min-w-[8rem]">
              <div className="font-display text-5xl font-semibold text-navy">{openTasks ?? "—"}</div>
              <div className="mt-1 text-sm text-gray-500">Open tasks</div>
            </div>
            <div className="flex flex-1 flex-wrap gap-2">
              {BUCKETS.map((b) => (
                <div key={b.icon} className={`flex min-w-[6.5rem] flex-1 items-center gap-2 rounded-lg border px-3 py-2 ${b.className}`}>
                  <span className="text-lg">{b.icon}</span>
                  <div>
                    <div className="font-display text-2xl font-semibold leading-none">{taskBuckets ? taskBuckets[b.icon] ?? 0 : "—"}</div>
                    <div className="text-[11px] font-medium" title={b.name}>{labels[b.icon]}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Link>}
      </div>
    </div>
  );
}
