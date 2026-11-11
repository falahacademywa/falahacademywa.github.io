// Staff modules (phase 19). The keys match the database's can_view()/can_edit()
// modules; paths map admin routes to the module that governs them.
// RULE (President 2026-10-31): every new admin page gets its own entry here (or joins an
// existing module) — the menu and the Staff & Permissions screen both read this list, and
// `npm run build` fails (scripts/check-modules.mjs) when a menu item or /admin route is not
// covered by a module or by ALWAYS_OPEN below.
export type Level = "view" | "edit";

export interface Module { key: string; label: string; paths: string[]; note?: string }

export const MODULES: Module[] = [
  { key: "students",      label: "Students",                  paths: ["/admin/students", "/admin/attendance"], note: "profiles, guardians, documents, attendance calendar" },
  { key: "health",        label: "Health & consent forms",    paths: [],                   note: "allergy, medical and photo-consent forms on the student profile" },
  { key: "admissions",    label: "Admissions",                paths: ["/admin/admissions"], note: "applications, Accept → Enroll, decline" },
  { key: "volunteers",    label: "Volunteers",                paths: ["/admin/volunteers"], note: "website volunteer applications, screening checks, approve" },
  { key: "parents",       label: "Parents",                   paths: ["/admin/parents", "/admin/parent-activity"], note: "accounts, link, suspend, activity" },
  { key: "teachers",      label: "Teachers",                  paths: ["/admin/teachers"] },
  { key: "fees",          label: "Fees",                      paths: ["/admin/fees"],       note: "plans and payments" },
  { key: "academics",     label: "Class work (assignments & class updates)", paths: ["/admin/assignments", "/admin/updates"], note: "Qur'an and lesson notes come in as class updates; the old Academics & Qur'an page was removed in phase 42" },
  { key: "redcomet",      label: "Red Comet",                 paths: ["/admin/redcomet"],   note: "workbook photos from the teacher app; edit = upload and delete photos not yet entered (phase 31)" },
  { key: "meetings",      label: "Parent meetings",           paths: ["/admin/meetings"],   note: "parent-teacher meeting bookings and teachers' remarks; edit = invite list, cancel a booking (phase 33)" },
  { key: "calendar",      label: "Calendar",                  paths: ["/admin/calendar"] },
  { key: "announcements", label: "Announcements",             paths: ["/admin/announcements"] },
  { key: "social",        label: "Social posts",              paths: ["/admin/social"],     note: "Facebook + Instagram queue; edit = write, schedule-ready and skip posts, and post the unplanned-closure (T6) posts; everything else is posted by the President or an admin (phase 36)" },
  { key: "feedback",      label: "Feedback",                  paths: ["/admin/feedback"] },
  { key: "report_attendance", label: "Reports: Attendance",   paths: ["/admin/reports/attendance"], note: "drill-down by grade, student, status and dates (President 2026-11-10: President only until granted)" },
  { key: "report_fees",   label: "Reports: Fees",             paths: ["/admin/reports/fees"], note: "drill-down by grade, student, payment status and dates (President only until granted)" },
  { key: "report_activity", label: "Reports: Activity Log",   paths: ["/admin/reports/activity"], note: "what parents, teachers and staff did in the portal (President only until granted)" },
  { key: "tasks",         label: "Tasks",                     paths: ["/admin/tasks"] },
  { key: "teacher_requests", label: "Teacher requests",       paths: ["/admin/teacher-requests"], note: "requests from the teacher app; edit = notes, progress and due dates (approve/decline stays with the President and admins) (phase 35)" },
  { key: "settings",      label: "Settings",                  paths: ["/admin/settings"],   note: "years, grades, document types — staff permissions stay with full admins" },
];


// Admin routes every admin/staff login may open (no module): the dashboard and profile pages
// that follow the module of the list they belong to are handled by their path prefix.
export const ALWAYS_OPEN = ["/admin"];

export function moduleForPath(path: string): Module | null {
  let best: Module | null = null;
  for (const m of MODULES) for (const p of m.paths) {
    if (path === p || path.startsWith(p + "/")) { if (!best || p.length > (best.paths[0]?.length ?? 0)) best = m; }
  }
  return best;
}
