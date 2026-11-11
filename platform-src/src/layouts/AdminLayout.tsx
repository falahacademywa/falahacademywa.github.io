import { Fragment, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  type LucideIcon, LayoutDashboard, FileText, GraduationCap, School, ClipboardCheck, Wallet, Notebook, BookOpen,
  Users, UserRound, Presentation, Briefcase, IdCard, ClipboardList, HandHeart, Rocket, Images, Inbox, Megaphone,
  Share2, CalendarDays, MessageSquare, BarChart3, Banknote, Activity, ListChecks, Settings, ChevronDown, ChevronRight,
  PanelLeftClose, PanelLeftOpen, ChevronsLeft, Menu, LogOut, ArrowLeftRight,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase, configMissing } from "../lib/supabase";
import { moduleForPath } from "../lib/permissions";
import { loadMenuCounts, markClassUpdatesSeen, type MenuCounts } from "../lib/menuCounts";

// Admin menu (President 2026-11-10): grouped, with icons, in three stages — full, icons only,
// hidden (☰ brings it back). module = the staff permission that unlocks the entry (phase 19);
// admins see all. Staff see only what they may open; an empty group disappears and a group left
// with one item shows as a plain link. Tasks and Settings stay fixed at the bottom.
interface Item { to: string; label: string; module: string | null; icon: LucideIcon; end?: boolean }
interface Group { group: string; label: string; icon: LucideIcon; items: Item[] }
type Entry = Item | Group;
const isGroup = (e: Entry): e is Group => "items" in e;

const nav: Entry[] = [
  { to: "/admin", label: "Dashboard", end: true, module: null, icon: LayoutDashboard },
  { to: "/admin/admissions", label: "Admissions", module: "admissions", icon: FileText },
  { group: "students", label: "Students & Classes", icon: GraduationCap, items: [
    { to: "/admin/students", label: "Students", module: "students", icon: School },
    { to: "/admin/attendance", label: "Attendance", module: "students", icon: ClipboardCheck },
    { to: "/admin/fees", label: "Fees", module: "fees", icon: Wallet },
    { to: "/admin/updates", label: "Class Updates", module: "academics", icon: Notebook },
    { to: "/admin/assignments", label: "Assignments", module: "academics", icon: BookOpen },
  ] },
  { group: "families", label: "Families", icon: Users, items: [
    { to: "/admin/parents", label: "Parents", module: "parents", icon: UserRound },
    { to: "/admin/meetings", label: "Parent Meetings", module: "meetings", icon: Presentation },
  ] },
  { group: "staff", label: "Staff", icon: Briefcase, items: [
    { to: "/admin/teachers", label: "Teachers", module: "teachers", icon: IdCard },
    { to: "/admin/teacher-requests", label: "Teacher Requests", module: "teacher_requests", icon: ClipboardList },
    { to: "/admin/volunteers", label: "Volunteers", module: "volunteers", icon: HandHeart },
  ] },
  { group: "redcomet", label: "Red Comet", icon: Rocket, items: [
    { to: "/admin/redcomet", label: "Student Work", end: true, module: "redcomet", icon: Images },
    { to: "/admin/redcomet/messages", label: "Messages", module: "redcomet", icon: Inbox },
  ] },
  { group: "comms", label: "Communications", icon: Megaphone, items: [
    { to: "/admin/announcements", label: "Announcements", module: "announcements", icon: Megaphone },
    { to: "/admin/social", label: "Social Posts", module: "social", icon: Share2 },
  ] },
  { to: "/admin/calendar", label: "Calendar", module: "calendar", icon: CalendarDays },
  { to: "/admin/feedback", label: "Feedback", module: "feedback", icon: MessageSquare },
  { group: "reports", label: "Reports", icon: BarChart3, items: [
    { to: "/admin/reports/attendance", label: "Attendance", module: "report_attendance", icon: ClipboardCheck },
    { to: "/admin/reports/fees", label: "Fees", module: "report_fees", icon: Banknote },
    { to: "/admin/reports/activity", label: "Activity Log", module: "report_activity", icon: Activity },
  ] },
];
const bottomNav: Item[] = [
  { to: "/admin/tasks", label: "Tasks", module: "tasks", icon: ListChecks },
  { to: "/admin/settings", label: "Settings", module: "settings", icon: Settings },
];

type Mode = "full" | "icons" | "hidden";
const MODE_KEY = "falah.adminMenu";
function readMode(): Mode { try { const v = localStorage.getItem(MODE_KEY); return v === "icons" || v === "hidden" ? v : "full"; } catch { return "full"; } }
function readLast(): "full" | "icons" { try { return localStorage.getItem(MODE_KEY + ".last") === "icons" ? "icons" : "full"; } catch { return "full"; } }

// Count shown as plain text after the label, e.g. "Volunteers (1)"; two-part items read
// "Tasks (red, orange)" and "Fees (Zelle to match, unpaid)" — the hover title explains them.
const COUNT_HINT: Record<string, string> = {
  "/admin/tasks": "red tasks (due within 7 days or overdue), orange tasks (due within 3 weeks)",
  "/admin/fees": "families paid this month, families unpaid this month",
};
// Colour per number for the two-part items; single counts use the menu's own text colour.
const COUNT_COLORS: Record<string, string[]> = {
  "/admin/tasks": ["text-red-400", "text-orange-400"],
  "/admin/fees": ["text-green-400", "text-red-400"],
};

function MenuBadge({ values, to, active }: { values?: number[]; to?: string; active?: boolean }) {
  if (!values || !values.some((v) => v > 0)) return null;
  const colors = to && !active ? COUNT_COLORS[to] : undefined;
  return (
    <span className="shrink-0 font-semibold" title={to ? COUNT_HINT[to] : undefined}>
      ({values.map((v, i) => (
        <Fragment key={i}>{i > 0 && ", "}<span className={colors?.[i]}>{v}</span></Fragment>
      ))})
    </span>
  );
}

interface Notif { id: number; title: string; message: string; priority: string; is_read: boolean; link_path: string | null; created_at: string }

export default function AdminLayout() {
  const { profile, signOut, can, isTeacher } = useAuth();
  const nav2 = useNavigate();
  const loc = useLocation();
  const isStaff = profile?.role === "staff";
  const portalLabel = isStaff ? (profile?.title?.trim() || "Office Staff") : "Administration Portal";
  // Staff see only the entries their modules allow; an empty group disappears, a group with one
  // item left shows as that item.
  const ok = (i: Item) => !i.module || can(i.module);
  // A–Z (President 2026-11-10): Dashboard first, then groups and links by name, each group's items
  // A–Z; Settings and Tasks stay at the bottom (also A–Z).
  const az = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const entries: Entry[] = nav.flatMap((e): Entry[] => {
    if (!isGroup(e)) return ok(e) ? [e] : [];
    const items = e.items.filter(ok).sort(az);
    return items.length === 0 ? [] : items.length === 1 ? [items[0]] : [{ ...e, items }];
  }).sort((a, b) => (!isGroup(a) && a.to === "/admin" ? -1 : !isGroup(b) && b.to === "/admin" ? 1 : az(a, b)));
  const bottom = bottomNav.filter(ok).sort(az);
  const isActive = (i: Item) => (i.end ? loc.pathname === i.to : loc.pathname === i.to || loc.pathname.startsWith(i.to + "/"));
  const activeGroup = entries.find((e) => isGroup(e) && e.items.some(isActive)) as Group | undefined;
  // Staff with view-only access to the current module: the page renders, nothing submits.
  const mod = moduleForPath(loc.pathname);
  const viewOnly = isStaff && !!mod && can(mod.key) && !can(mod.key, "edit");
  const noAccess = isStaff && !!mod && !can(mod.key);
  const [open, setOpen] = useState(false);            // mobile drawer
  const [mode, setModeState] = useState<Mode>(readMode);
  const [lastShown, setLastShown] = useState<"full" | "icons">(readLast);
  const [tapped, setTapped] = useState<Record<string, boolean>>({});   // group opened by a click/tap
  const [fly, setFly] = useState<{ group: string; top: number } | null>(null);   // icons-only pop-out
  const closeTimer = useRef<number | undefined>(undefined);
  function setMode(m: Mode) {
    setModeState(m); setFly(null);
    if (m !== "hidden") setLastShown(m);
    try { localStorage.setItem(MODE_KEY, m); if (m !== "hidden") localStorage.setItem(MODE_KEY + ".last", m); } catch { /* private window */ }
  }
  const enter = (_g: string) => { window.clearTimeout(closeTimer.current); };
  const leave = () => { window.clearTimeout(closeTimer.current); closeTimer.current = window.setTimeout(() => setFly(null), 180); };
  useEffect(() => { setFly(null); }, [loc.pathname]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [counts, setCounts] = useState<MenuCounts>({});

  // Action counts beside menu items (#131): reload on every page change; opening Class Updates marks posts seen.
  useEffect(() => {
    if (configMissing || !profile) return;
    if (loc.pathname.startsWith("/admin/updates")) markClassUpdatesSeen();
    let live = true;
    loadMenuCounts((m) => can(m)).then((c) => { if (live) setCounts(c); });
    return () => { live = false; };
  }, [profile?.id, loc.pathname]);

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

  // attention number of an entry: Fees counts the unpaid families, the rest their first number
  const attention = (to: string) => { const v = counts[to]; return !v ? 0 : to === "/admin/fees" ? (v[1] ?? 0) : (v[0] ?? 0); };
  const iconsOnly = mode === "icons";

  function itemLink(i: Item, nested: boolean, inFlyout = false) {
    const Icon = i.icon;
    const compact = iconsOnly && !inFlyout;
    const n = attention(i.to);
    return (
      <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)} title={compact ? i.label : undefined}
        className={({ isActive }) =>
          `relative flex items-center gap-2.5 rounded-lg py-2 text-sm transition ${nested && !inFlyout ? "pl-3 pr-2" : "px-3"} ${compact ? "lg:justify-center lg:px-0" : ""} ${
            isActive ? "bg-emerald-brand font-semibold text-white" : "text-white/80 hover:bg-white/10"
          }`}>
        {({ isActive }) => (
          <>
            <Icon size={nested ? 16 : 18} className="shrink-0" aria-hidden />
            <span className={`flex min-w-0 items-center gap-1.5 ${compact ? "lg:hidden" : ""}`}>
              <span className="truncate">{i.label}</span>
              <MenuBadge values={counts[i.to]} to={i.to} active={isActive} />
            </span>
            {compact && n > 0 && <span className="absolute right-1 top-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white lg:flex">{n}</span>}
          </>
        )}
      </NavLink>
    );
  }

  // Groups open to the RIGHT on a computer (President 2026-11-10): hovering a group shows its
  // items in a panel beside the menu, in both full and icons-only mode. On a phone (drawer) there
  // is no room on the right, so a tap opens the group downwards.
  function groupRow(g: Group) {
    const Icon = g.icon;
    const total = g.items.reduce((s, i) => s + attention(i.to), 0);
    const isOpen = activeGroup?.group === g.group || !!tapped[g.group];
    const hasActive = activeGroup?.group === g.group;
    const current = hasActive ? g.items.find(isActive) : undefined;
    const openFly = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      enter(g.group);
      setFly({ group: g.group, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 60 - g.items.length * 40)) });
    };
    const flyOpen = fly?.group === g.group;
    return (
      <Fragment key={g.group}>
        <button title={iconsOnly ? g.label : undefined}
          onMouseEnter={(ev) => openFly(ev.currentTarget)} onMouseLeave={leave}
          onClick={(ev) => (flyOpen ? setFly(null) : openFly(ev.currentTarget))}
          aria-expanded={flyOpen}
          className={`relative hidden w-full items-center gap-2.5 rounded-lg py-2 text-left text-sm transition lg:flex ${iconsOnly ? "justify-center" : "px-3"} ${
            hasActive ? "bg-white/15 font-semibold text-white" : flyOpen ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/10"}`}>
          <Icon size={18} className="shrink-0" aria-hidden />
          {!iconsOnly && (
            <span className="min-w-0 flex-1">
              <span className="block truncate">{g.label}</span>
              {current && <span className="block truncate text-[11px] font-normal text-emerald-300">{current.label}</span>}
            </span>
          )}
          {!iconsOnly && total > 0 && <span className="font-semibold">({total})</span>}
          {!iconsOnly && <ChevronRight size={15} className={`shrink-0 transition-transform ${flyOpen ? "translate-x-0.5 text-white" : "text-white/50"}`} aria-hidden />}
          {iconsOnly && total > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{total}</span>}
        </button>
        <div className="lg:hidden">{fullGroup(g, Icon, total, isOpen, hasActive)}</div>
      </Fragment>
    );
  }

  function fullGroup(g: Group, Icon: LucideIcon, total: number, isOpen: boolean, hasActive: boolean) {
    return (
      <div>
        <button onClick={() => setTapped({ ...tapped, [g.group]: !tapped[g.group] })}
          aria-expanded={isOpen}
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${hasActive ? "font-semibold text-white" : "text-white/80 hover:bg-white/10"}`}>
          <Icon size={18} className="shrink-0" aria-hidden />
          <span className="flex-1 truncate">{g.label}</span>
          {!isOpen && total > 0 && <span className="font-semibold">({total})</span>}
          <ChevronDown size={15} className={`shrink-0 text-white/50 transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
        </button>
        {isOpen && (
          <div className="mb-1 ml-[1.15rem] space-y-0.5 border-l border-white/15 pl-2">
            {g.items.map((i) => itemLink(i, true))}
          </div>
        )}
      </div>
    );
  }

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

      {/* Desktop, menu hidden: one button brings it back */}
      {mode === "hidden" && (
        <div className="fixed left-3 top-3 z-40 hidden items-center gap-3 rounded-xl bg-navy px-3 py-2 text-white shadow-lg lg:flex">
          <button onClick={() => setMode(lastShown)} aria-label="Show menu" title="Show menu" className="hover:text-emerald-300"><Menu size={20} /></button>
          {bellButton}
        </div>
      )}

      {/* Sidebar: drawer on mobile (always full), on desktop full / icons only / hidden */}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy text-white transition-[transform,width] duration-200 lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:shrink-0 lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"} ${mode === "icons" ? "lg:w-16" : "lg:w-60"} ${mode === "hidden" ? "lg:hidden" : ""}`}>
        <div className={`flex items-center gap-3 border-b border-white/10 px-5 py-4 ${mode === "icons" ? "lg:flex-col lg:gap-2 lg:px-2" : ""}`}>
          <img src="../images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
          <div className={`flex-1 ${mode === "icons" ? "lg:hidden" : ""}`}>
            <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
            <div className="text-[11px] font-semibold text-emerald-300">{portalLabel}</div>
          </div>
          <span className="hidden lg:block">{bellButton}</span>
          <button onClick={() => setOpen(false)} aria-label="Close menu"
            className="text-white/60 hover:text-white lg:hidden">✕</button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-3">
          {entries.map((e) => isGroup(e) ? groupRow(e) : itemLink(e, false))}
        </nav>
        {bottom.length > 0 && (
          <div className="space-y-0.5 border-t border-white/10 px-3 py-2">
            {bottom.map((i) => itemLink(i, false))}
          </div>
        )}
        <div className={`border-t border-white/10 p-4 text-sm ${mode === "icons" ? "lg:px-2" : ""}`}>
          <div className={mode === "icons" ? "lg:hidden" : ""}>
            <div className="mb-2 truncate text-white/70">{profile?.full_name}{isStaff && <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-300">staff</span>}</div>
            {isTeacher && (
              <Link to="/teacher" onClick={() => setOpen(false)}
                className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-white/25 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                <ArrowLeftRight size={14} /> Switch to teacher app
              </Link>
            )}
            <button onClick={signOut} className="text-white/60 underline hover:text-white">Sign out</button>
          </div>
          {/* icons only: compact footer */}
          <div className={`hidden flex-col items-center gap-3 ${mode === "icons" ? "lg:flex" : ""}`}>
            {isTeacher && <Link to="/teacher" title="Switch to teacher app" className="text-white/70 hover:text-white"><ArrowLeftRight size={18} /></Link>}
            <button onClick={signOut} title="Sign out" className="text-white/60 hover:text-white"><LogOut size={18} /></button>
          </div>
          {/* stage switch (desktop) */}
          <div className={`mt-3 hidden gap-1 border-t border-white/10 pt-3 text-xs lg:flex ${mode === "icons" ? "flex-col items-center" : "items-center"}`}>
            {mode === "full" ? (
              <button onClick={() => setMode("icons")} title="Show icons only" className="flex items-center gap-1 rounded-md px-2 py-1 text-white/60 hover:bg-white/10 hover:text-white"><ChevronsLeft size={15} /> Icons only</button>
            ) : (
              <button onClick={() => setMode("full")} title="Show full menu" className="rounded-md p-1.5 text-white/60 hover:bg-white/10 hover:text-white"><PanelLeftOpen size={17} /></button>
            )}
            <button onClick={() => setMode("hidden")} title="Hide menu (☰ brings it back)" className={`flex items-center gap-1 rounded-md text-white/60 hover:bg-white/10 hover:text-white ${mode === "icons" ? "p-1.5" : "ml-auto px-2 py-1"}`}>
              <PanelLeftClose size={mode === "icons" ? 17 : 15} />{mode === "full" && " Hide"}
            </button>
          </div>
        </div>
      </aside>

      {/* A group's items pop out to the right of the menu (computer) */}
      {fly && mode !== "hidden" && (() => {
        const g = entries.find((e) => isGroup(e) && e.group === fly.group) as Group | undefined;
        if (!g) return null;
        return (
          <div onMouseEnter={() => enter(g.group)} onMouseLeave={leave}
            style={{ top: fly.top }}
            className={`fixed z-[60] hidden w-56 rounded-xl bg-navy p-2 text-white shadow-2xl ring-1 ring-white/10 lg:block ${mode === "icons" ? "left-16" : "left-60"}`}>
            <div className="px-2 pb-1 pt-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">{g.label}</div>
            {g.items.map((i) => itemLink(i, true, true))}
          </div>
        );
      })()}

      <main className={`min-w-0 flex-1 overflow-x-auto p-4 lg:p-8 ${mode === "hidden" ? "lg:pt-16" : ""}`}>
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
