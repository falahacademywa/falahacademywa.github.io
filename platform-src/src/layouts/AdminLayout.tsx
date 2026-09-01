import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase, configMissing } from "../lib/supabase";

const nav = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/students", label: "Students" },
  { to: "/admin/admissions", label: "Admissions" },
  { to: "/admin/parents", label: "Parents" },
  { to: "/admin/teachers", label: "Teachers" },
  { to: "/admin/fees", label: "Fees" },
  { to: "/admin/academics", label: "Academics & Qur'an" },
  { to: "/admin/assignments", label: "Assignments" },
  { to: "/admin/updates", label: "Class Updates" },
  { to: "/admin/calendar", label: "Calendar" },
  { to: "/admin/announcements", label: "Announcements" },
  { to: "/admin/feedback", label: "Feedback" },
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/settings", label: "Settings" },
];

interface Notif { id: number; title: string; message: string; priority: string; is_read: boolean; link_path: string | null; created_at: string }

export default function AdminLayout() {
  const { profile, signOut } = useAuth();
  const nav2 = useNavigate();
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
            <div className="text-[10px] font-semibold text-emerald-300">Administration Portal</div>
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
            <div className="text-[11px] font-semibold text-emerald-300">Administration Portal</div>
          </div>
          <span className="hidden lg:block">{bellButton}</span>
          <button onClick={() => setOpen(false)} aria-label="Close menu"
            className="text-white/60 hover:text-white lg:hidden">✕</button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {nav.map((n) => (
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
          <div className="mb-2 truncate text-white/70">{profile?.full_name}</div>
          <button onClick={signOut} className="text-white/60 underline hover:text-white">Sign out</button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-x-auto p-4 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
