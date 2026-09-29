import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase, configMissing } from "../lib/supabase";
import { moduleForPath } from "../lib/permissions";

// module = the staff permission that unlocks the entry (phase 19); admins see all
const nav = [
  { to: "/admin", label: "Dashboard", end: true, module: null },
  { to: "/admin/students", label: "Students", module: "students" },
  { to: "/admin/admissions", label: "Admissions", module: "admissions" },
  { to: "/admin/parents", label: "Parents", module: "parents" },
  { to: "/admin/teachers", label: "Teachers", module: "teachers" },
  { to: "/admin/fees", label: "Fees", module: "fees" },
  { to: "/admin/academics", label: "Academics & Qur'an", module: "academics" },
  { to: "/admin/assignments", label: "Assignments", module: "academics" },
  { to: "/admin/updates", label: "Class Updates", module: "academics" },
  { to: "/admin/calendar", label: "Calendar", module: "calendar" },
  { to: "/admin/announcements", label: "Announcements", module: "announcements" },
  { to: "/admin/feedback", label: "Feedback", module: "feedback" },
  { to: "/admin/reports", label: "Reports", module: "reports" },
  { to: "/admin/tasks", label: "Tasks", module: "tasks" },
  { to: "/admin/settings", label: "Settings", module: "settings" },
];

interface Notif { id: number; title: string; message: string; priority: string; is_read: boolean; link_path: string | null; created_at: string }

export default function AdminLayout() {
  const { profile, signOut, can } = useAuth();
  const nav2 = useNavigate();
  const loc = useLocation();
  const isStaff = profile?.role === "staff";
  const portalLabel = isStaff ? (profile?.title?.trim() || "Office Staff") : "Administration Portal";
  const visibleNav = nav.filter((n) => !n.module || can(n.module));
  // Staff with view-only access to the current module: the page renders, nothing submits.
  const mod = moduleForPath(loc.pathname);
  const viewOnly = isStaff && !!mod && can(mod.key) && !can(mod.key, "edit");
  const noAccess = isStaff && !!mod && !can(mod.key);
  const [open, setOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);

  useEffect(() => {
    if (configMissing || !profile) return;
    supabase.from("notifications")
      .select("id, title, message, priority, is_read, link_path, created_at")
      .eq("recipient_id", profile.id)
      .order("created_at", { ascending: false }).limit(30)
      .then(({ data }) => setNotifs((data as Notif[]) ?? []));
  }, [profile?.id]);

  const unread = notifs.filter((n) => !n.is_read).length;

  async function openBell() {
    setBellOpen(!bellOpen);
    if (bellOpen) return;
    const ids = notifs.filter((n) => !n.is_read).map((n) => n.id);
    if (ids.length) {
      await supabase.from("notifications").update({ is_read: true }).in("id", ids);
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  }

  const bellButton = (
    <button onClick={openBell} aria-label="Notifications" className="relative text-xl leading-none">
      🔔
      {unread > 0 && (
        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {unread}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 text-white lg:hidden">
        <div className="flex items-center gap-3">
          <img src="../images/logo.jpg" alt="" className="h-8 w-8 rounded-full object-cover" />
          <div>
            <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
            <div className="text-[10px] font-semibold text-emerald-300">{portalLabel}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {bellButton}
          <button onClick={() => setOpen(true)} aria-label="Open menu"
            className="rounded-lg border border-white/20 px-3 py-1.5 text-lg leading-none">☰</button>
        </div>
      </header>

      {/* Backdrop (mobile, menu open) */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Notifications panel */}
      {bellOpen && (
        <>
          <div className="fixed inset-0 z-[65]" onClick={() => setBellOpen(false)} />
          <div className="fixed left-1/2 top-16 z-[70] max-h-[70vh] w-[22rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-xl bg-white p-2 text-gray-800 shadow-2xl lg:left-auto lg:right-6 lg:top-6 lg:translate-x-0">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-sm font-bold text-navy">Notifications</span>
              <button onClick={() => setBellOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
            </div>
            {notifs.map((n) => (
              <div key={n.id}
                onClick={() => { if (n.link_path) { setBellOpen(false); nav2(n.link_path); } }}
                className={`border-b p-2.5 text-sm last:border-0 ${n.link_path ? "cursor-pointer hover:bg-silver/60" : ""}`}>
                <div className="flex items-center gap-1.5 font-semibold text-navy">
                  {n.priority === "action" ? "🔴" : n.priority === "important" ? "🟡" : "🔵"} {n.title}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{n.message}</p>
                <p className="mt-0.5 text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
              </div>
            ))}
            {!notifs.length && <p className="p-3 text-sm text-gray-400">No notifications.</p>}
          </div>
        </>
      )}

      {/* Sidebar: drawer on mobile, static on desktop */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy text-white transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:shrink-0 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <img src="../images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
          <div className="flex-1">
            <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
            <div className="text-[11px] font-semibold text-emerald-300">{portalLabel}</div>
          </div>
          <span className="hidden lg:block">{bellButton}</span>
          <button onClick={() => setOpen(false)} aria-label="Close menu"
            className="text-white/60 hover:text-white lg:hidden">✕</button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {visibleNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2 text-sm transition ${
                  isActive ? "bg-emerald-brand font-semibold text-white" : "text-white/80 hover:bg-white/10"
                }`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <div className="mb-2 truncate text-white/70">{profile?.full_name}{isStaff && <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-300">staff</span>}</div>
          <button onClick={signOut} className="text-white/60 underline hover:text-white">Sign out</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-auto p-4 lg:p-8">
        {noAccess ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            You do not have access to this section. Ask the school office if you need it.
          </div>
        ) : (
          <>
            {viewOnly && (
              <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-800">
                👁 View only — you can read this section but not change it.
              </div>
            )}
            <div className={viewOnly ? "view-only" : undefined}>
              <Outlet />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
