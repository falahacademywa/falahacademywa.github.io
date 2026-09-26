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
}

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

// Order and styling of the six buckets shown on the Dashboard tile.
export const BUCKETS: { icon: string; name: string; className: string }[] = [
  { icon: "🔴", name: "This week", className: "bg-red-50 text-red-700 border-red-200" },
  { icon: "🟠", name: "3 weeks", className: "bg-orange-50 text-orange-700 border-orange-200" },
  { icon: "🟡", name: "6 weeks", className: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  { icon: "🟢", name: "Later", className: "bg-green-50 text-green-700 border-green-200" },
  { icon: "🔵", name: "Waiting", className: "bg-sky-50 text-sky-700 border-sky-200" },
  { icon: "⚪", name: "Parked", className: "bg-gray-50 text-gray-600 border-gray-200" },
];
