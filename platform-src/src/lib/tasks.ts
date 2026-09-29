// Shared bits for the school's to-do list (admin_tasks table, mirror of the hub's TODO.md).

export interface Task {
  code: string;
  task_no: number | null;
  is_done: boolean;
  category: string;
  task: string;
  assigned_to: string;
  due_text: string;
  due_date: string | null;
  status: string;
  done_on: string | null;
  updated_at: string;
  attachments?: TaskDoc[];   // phase 16: files in the private "task-docs" bucket
  source?: string;           // 'TODO.md' (synced from the hub) or 'portal' (created here, phase 20)
  notes?: string | null;
  created_at?: string;
}

// Priority picker on the phone form → due date (the tracker's urgency comes from the date)
export const PRIORITIES: { key: string; label: string; days: number | null }[] = [
  { key: "urgent", label: "🔴 Urgent — within 3 days", days: 3 },
  { key: "week", label: "🟠 This week", days: 7 },
  { key: "month", label: "🟡 This month", days: 30 },
  { key: "later", label: "🟢 Later — in about 2 months", days: 60 },
  { key: "someday", label: "⚪ Someday / parked", days: null },
];

export interface TaskDoc { name: string; path: string; size?: number }

export interface Urgency { icon: string; rank: number; label: string; name: string }

const DAY = 86400000;

// Same rules as TODO.md: 🔴 ≤7 days or overdue · 🟠 ≤3 weeks · 🟡 ≤6 weeks · 🟢 later · 🔵 waiting · ⚪ parked · ✅ done
export function urgency(t: Task): Urgency {
  if (t.is_done) return { icon: "✅", rank: 9, label: "Done", name: "Done" };
  const st = t.status.toLowerCase();
  if (st === "parked" || st === "on hold") return { icon: "⚪", rank: 8, label: "Parked", name: "Parked" };
  if (st === "waiting") return { icon: "🔵", rank: 7, label: "Waiting on someone else", name: "Waiting" };
  if (!t.due_date) return { icon: "🟢", rank: 4, label: "No fixed date", name: "Later" };
  const days = Math.round((new Date(t.due_date + "T12:00:00").getTime() - Date.now()) / DAY);
  if (days <= 7) return { icon: "🔴", rank: 1, label: days < 0 ? `${-days} days overdue` : `due in ${days} days`, name: "This week" };
  if (days <= 21) return { icon: "🟠", rank: 2, label: `due in ${days} days`, name: "3 weeks" };
  if (days <= 45) return { icon: "🟡", rank: 3, label: `due in ${days} days`, name: "6 weeks" };
  return { icon: "🟢", rank: 4, label: `due in ${days} days`, name: "Later" };
}

// Order and styling of the six buckets shown on the Dashboard tile. Labels carry the
// actual cut-off dates for today, e.g. "by Oct 3" · "Oct 4 – Oct 17" · "Oct 18 – Nov 10" · "after Nov 10".
const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const plus = (days: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + days); return d; };

export function bucketLabels(): Record<string, string> {
  return {
    "🔴": `by ${fmt(plus(7))}`,
    "🟠": `${fmt(plus(8))} – ${fmt(plus(21))}`,
    "🟡": `${fmt(plus(22))} – ${fmt(plus(45))}`,
    "🟢": `after ${fmt(plus(45))}`,
    "🔵": "Waiting",
    "⚪": "Parked",
  };
}

export const BUCKETS: { icon: string; name: string; className: string }[] = [
  { icon: "🔴", name: "This week", className: "bg-red-50 text-red-700 border-red-200" },
  { icon: "🟠", name: "3 weeks", className: "bg-orange-50 text-orange-700 border-orange-200" },
  { icon: "🟡", name: "6 weeks", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { icon: "🟢", name: "Later", className: "bg-green-50 text-green-700 border-green-200" },
  { icon: "🔵", name: "Waiting", className: "bg-sky-50 text-sky-700 border-sky-200" },
  { icon: "⚪", name: "Parked", className: "bg-gray-50 text-gray-600 border-gray-200" },
];
