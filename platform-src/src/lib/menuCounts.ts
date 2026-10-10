// Action counts shown beside admin menu items (TODO #131). Each entry is the number of things
// waiting for the admin on that page; a page with nothing waiting shows no badge.
// Two-part counts: Tasks = [red, orange], Fees = [paid, unpaid] this month (same rule as the Dashboard tile).
import { supabase } from "./supabase";
import { todayStr } from "./dates";
import { type Task, urgency } from "./tasks";

export type MenuCounts = Record<string, number[]>;

const SEEN_UPDATES = "falah.seen.classUpdates";

export function markClassUpdatesSeen() {
  try { localStorage.setItem(SEEN_UPDATES, new Date().toISOString()); } catch { /* private mode */ }
}

function seenUpdatesAt(): string {
  try { return localStorage.getItem(SEEN_UPDATES) ?? new Date(Date.now() - 7 * 86400000).toISOString(); }
  catch { return new Date(Date.now() - 7 * 86400000).toISOString(); }
}

async function count(table: string, filter: (q: any) => any): Promise<number> {
  const { count: c, error } = await filter(supabase.from(table).select("*", { count: "exact", head: true }));
  return error ? 0 : c ?? 0;
}

const isNewer = (a?: string | null, b?: string | null) => !!a && (!b || a > b);

export async function loadMenuCounts(can: (module: string) => boolean): Promise<MenuCounts> {
  const today = todayStr();
  const month = today.slice(0, 7);
  const out: MenuCounts = {};
  const jobs: Promise<void>[] = [];

  if (can("admissions"))
    jobs.push(count("applicants", (q) => q.eq("status", "under_review")).then((n) => { out["/admin/admissions"] = [n]; }));

  if (can("volunteers"))
    jobs.push(count("volunteer_applications", (q) => q.eq("status", "new")).then((n) => { out["/admin/volunteers"] = [n]; }));

  if (can("feedback"))
    jobs.push(count("feedback", (q) => q.eq("resolved", false)).then((n) => { out["/admin/feedback"] = [n]; }));

  if (can("fees"))
    jobs.push((async () => {
      // paid / unpaid = same rule as the Dashboard "Fees this month" tile
      const { data } = await supabase.from("fee_plans")
        .select("id, start_date, enrollments!inner ( status ), payments ( payment_date )")
        .eq("status", "active").eq("enrollments.status", "active").gt("total_amount", 0);
      const due = ((data ?? []) as { start_date: string | null; payments: { payment_date: string }[] }[])
        .filter((p) => !p.start_date || p.start_date <= today);
      const unpaid = due.filter((p) => !p.payments.some((x) => x.payment_date.startsWith(month))).length;
      out["/admin/fees"] = [due.length - unpaid, unpaid];
    })());

  if (can("students"))
    jobs.push((async () => {
      const photos = await count("students", (q) => q.eq("archived", false).not("photo_pending_url", "is", null));
      const [{ data: med }, { data: con }] = await Promise.all([
        supabase.from("medical_info").select("updated_at, reviewed_at"),
        supabase.from("media_consent").select("updated_at, reviewed_at"),
      ]);
      const forms = [...(med ?? []), ...(con ?? [])]
        .filter((r: { updated_at?: string | null; reviewed_at?: string | null }) => isNewer(r.updated_at, r.reviewed_at)).length;
      out["/admin/students"] = [photos + forms];
    })());

  if (can("students"))
    jobs.push((async () => {
      // School runs Mon–Thu; after 10 AM, grades with active students and no mark today need attention.
      const now = new Date();
      if (![1, 2, 3, 4].includes(now.getDay()) || now.getHours() < 10) { out["/admin/attendance"] = [0]; return; }
      const [{ data: enr }, { data: att }] = await Promise.all([
        supabase.from("enrollments").select("id, grade_id").eq("status", "active"),
        supabase.from("attendance").select("enrollment_id").eq("date", today),
      ]);
      const marked = new Set((att ?? []).map((a: { enrollment_id: string }) => a.enrollment_id));
      const byGrade = new Map<number, boolean>();
      for (const e of (enr ?? []) as { id: string; grade_id: number }[])
        byGrade.set(e.grade_id, (byGrade.get(e.grade_id) ?? false) || marked.has(e.id));
      out["/admin/attendance"] = [[...byGrade.values()].filter((m) => !m).length];
    })());

  if (can("academics"))
    jobs.push(count("class_updates", (q) => q.gt("created_at", seenUpdatesAt())).then((n) => { out["/admin/updates"] = [n]; }));

  if (can("tasks"))
    jobs.push((async () => {
      const { data } = await supabase.from("admin_tasks").select("*").eq("is_done", false);
      const icons = ((data ?? []) as Task[]).map((t) => urgency(t).icon);
      out["/admin/tasks"] = [icons.filter((i) => i === "🔴").length, icons.filter((i) => i === "🟠").length];
    })());

  await Promise.allSettled(jobs);
  return out;
}
