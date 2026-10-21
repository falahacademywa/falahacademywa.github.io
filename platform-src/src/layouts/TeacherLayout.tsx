// Teacher app shell (phase 26): phone-width column, top bar, bottom tabs.
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth";

const tabs = [
  { to: "/teacher", label: "Today", end: true, icon: "M8 7V3m8 4V3M3 11h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z" },
  { to: "/teacher/update", label: "Update", icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" },
  { to: "/teacher/progress", label: "Red Comet", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { to: "/teacher/me", label: "Me", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
];

export default function TeacherLayout() {
  const { profile } = useAuth();
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-silver">
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-navy px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white shadow">
        <img src="../images/logo.jpg" alt="" className="h-8 w-8 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-base font-semibold leading-tight">Falah Academy</div>
          <div className="truncate text-[11px] text-white/60">{profile?.full_name}</div>
        </div>
      </header>
      <main className="flex-1 px-3 pb-24 pt-3">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto grid max-w-md grid-cols-4 border-t border-gray-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? "text-navy" : "text-gray-400"}`}>
            {({ isActive }) => (<>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={isActive ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
              {t.label}
            </>)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
