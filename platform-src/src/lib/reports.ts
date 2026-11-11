// Shared helpers for the President's reports (phase 42): date ranges, paging through RPC
// results (Supabase returns at most 1000 rows per request) and CSV download.
import { supabase } from "./supabase";

export const SCHOOL_YEAR = { from: "2026-08-26", to: "2027-06-24", label: "School year 2026–27" };

const pad = (n: number) => String(n).padStart(2, "0");
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayIso = () => iso(new Date());

export type Preset = "week" | "month" | "lastmonth" | "3months" | "year" | "custom";
export function presetRange(p: Preset): { from: string; to: string } {
  const t = new Date();
  if (p === "week") { const d = new Date(t); d.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return { from: iso(d), to: iso(t) }; }
  if (p === "month") return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t) };
  if (p === "lastmonth") return { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)) };
  if (p === "3months") return { from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: iso(t) };
  return { from: SCHOOL_YEAR.from, to: todayIso() < SCHOOL_YEAR.to ? todayIso() : SCHOOL_YEAR.to };
}
export const PRESETS: [Preset, string][] = [["week", "This week"], ["month", "This month"], ["lastmonth", "Last month"], ["3months", "Last 3 months"], ["year", "School year"], ["custom", "Custom"]];

export type Period = "day" | "month" | "year";
export function periodKey(date: string, p: Period) { return p === "day" ? date : p === "month" ? date.slice(0, 7) : date.slice(0, 4); }
export function periodLabel(key: string, p: Period) {
  if (p === "year") return key;
  if (p === "month") return new Date(key + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return new Date(key + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Calls an RPC page by page (1000 rows each) until everything is in. */
export async function rpcAll<T>(fn: string, args: Record<string, unknown>, order: string, ascending = true): Promise<{ rows: T[]; error: string | null }> {
  const out: T[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const { data, error } = await supabase.rpc(fn, args).order(order, { ascending }).range(from, from + 999);
    if (error) return { rows: out, error: error.message };
    const d = (data as T[]) ?? [];
    out.push(...d);
    if (d.length < 1000) break;
  }
  return { rows: out, error: null };
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
export const money = (n: number) => "$" + Math.round(Number(n)).toLocaleString("en-US");
