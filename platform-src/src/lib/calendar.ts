// Month-grid helpers and the per-grade color scheme shared by the admin
// Class Updates calendar and the Attendance calendar (phase 22).

export interface GradeLite { id: number; name: string; level_order?: number }

// fixed color per grade name; grades not listed take the next free slot
const PALETTE = [
  { chip: "bg-rose-100 text-rose-800 border-rose-200", dot: "bg-rose-400", ring: "ring-rose-300" },
  { chip: "bg-violet-100 text-violet-800 border-violet-200", dot: "bg-violet-400", ring: "ring-violet-300" },
  { chip: "bg-sky-100 text-sky-800 border-sky-200", dot: "bg-sky-400", ring: "ring-sky-300" },
  { chip: "bg-orange-100 text-orange-800 border-orange-200", dot: "bg-orange-400", ring: "ring-orange-300" },
  { chip: "bg-lime-100 text-lime-800 border-lime-200", dot: "bg-lime-500", ring: "ring-lime-300" },
  { chip: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200", dot: "bg-fuchsia-400", ring: "ring-fuchsia-300" },
  { chip: "bg-cyan-100 text-cyan-800 border-cyan-200", dot: "bg-cyan-400", ring: "ring-cyan-300" },
  { chip: "bg-yellow-100 text-yellow-800 border-yellow-200", dot: "bg-yellow-400", ring: "ring-yellow-300" },
];
const BY_NAME: Record<string, number> = { "Pre-K": 0, KG: 1, "Grade 1": 2, "Grade 2": 6, "Grade 3": 3, "Grade 4": 4, "Grade 5": 5 };

export function gradeColor(grades: GradeLite[], gid: number | null | undefined) {
  const g = grades.find((x) => x.id === gid);
  if (!g) return { chip: "bg-gray-100 text-gray-700 border-gray-200", dot: "bg-gray-400", ring: "ring-gray-300" };
  const idx = BY_NAME[g.name] ?? (grades.findIndex((x) => x.id === gid) + PALETTE.length - 1);
  return PALETTE[idx % PALETTE.length];
}
export const gradeShort = (name: string) => name.replace(/^Grade\s+/i, "G");

export const ATT_STATUS = {
  present: { chip: "bg-green-100 text-green-700 border-green-200", dot: "bg-green-500", label: "Present" },
  late: { chip: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500", label: "Late" },
  absent: { chip: "bg-red-100 text-red-700 border-red-200", dot: "bg-red-500", label: "Absent" },
} as const;
export type AttStatus = keyof typeof ATT_STATUS;

// ---- months ----
export const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
export const monthLabel = (ym: string) => new Date(ym + "-15T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
export function monthRange(ym: string): [string, string] {
  const [y, m] = ym.split("-").map(Number);
  return [`${ym}-01`, `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`];
}
/** Sunday-first grid of ISO dates, null for padding, always whole weeks. */
export function monthCells(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const out: (string | null)[] = [];
  for (let i = 0; i < first; i++) out.push(null);
  for (let d = 1; d <= days; d++) out.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (out.length % 7) out.push(null);
  return out;
}
export const isWeekend = (iso: string) => [0, 5, 6].includes(new Date(iso + "T00:00:00").getDay());  // school runs Mon–Thu
