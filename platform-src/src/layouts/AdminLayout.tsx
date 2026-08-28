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
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-navy text-white">
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <img src="../images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
          <div>
            <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
            <div className="text-[11px] font-semibold text-emerald-300">Administration Portal</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
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
      <main className="flex-1 overflow-x-auto p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
