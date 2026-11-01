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
  { key: "academics",     label: "Academics, assignments & class updates", paths: ["/admin/academics", "/admin/assignments", "/admin/updates"] },
  { key: "redcomet",      label: "Red Comet",                 paths: ["/admin/redcomet"],   note: "workbook photos from the teacher app; edit = upload and delete photos not yet entered (phase 31)" },
  { key: "calendar",      label: "Calendar",                  paths: ["/admin/calendar"] },
  { key: "announcements", label: "Announcements",             paths: ["/admin/announcements"] },
  { key: "feedback",      label: "Feedback",                  paths: ["/admin/feedback"] },
  { key: "reports",       label: "Reports",                   paths: ["/admin/reports"],    note: "exports only show data from modules the person can view" },
  { key: "tasks",         label: "Tasks",                     paths: ["/admin/tasks"] },
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
