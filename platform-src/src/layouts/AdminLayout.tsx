import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

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
  { to: "/admin/reports", label: "Reports" },
  { to: "/admin/settings", label: "Settings" },
];

export default function AdminLayout() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

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
        <button onClick={() => setOpen(true)} aria-label="Open menu"
          className="rounded-lg border border-white/20 px-3 py-1.5 text-lg leading-none">☰</button>
      </header>

      {/* Backdrop (mobile, menu open) */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />
      )}

      {/* Sidebar: drawer on mobile, static on desktop */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy text-white transition-transform duration-200 lg:static lg:z-auto lg:w-60 lg:shrink-0 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <img src="../images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
          <div className="flex-1">
            <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
            <div className="text-[11px] font-semibold text-emerald-300">Administration Portal</div>
          </div>
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
