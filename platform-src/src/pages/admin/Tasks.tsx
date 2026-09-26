import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

// The school's working to-do list (mirror of the hub's TODO.md, phase 15).
// Read-only grid: sort on any column, filter box, "x out of y items" counter.

interface Task {
  code: string;
  task_no: number | null;
  is_done: boolean;
  category: string;
  task: string;
  assigned_to: string;
  due_text: string;
  due_date: string | null;
  status: string;
  done_on: string | null;
  updated_at: string;
}

type SortKey = "urgency" | "code" | "category" | "task" | "assigned_to" | "due" | "status";

const DAY = 86400000;

// Same rules as TODO.md: 🔴 ≤7 days or overdue · 🟠 ≤3 weeks · 🟡 ≤6 weeks · 🟢 later · 🔵 waiting · ⚪ parked · ✅ done
function urgency(t: Task): { icon: string; rank: number; label: string } {
  if (t.is_done) return { icon: "✅", rank: 9, label: "Done" };
  const st = t.status.toLowerCase();
  if (st === "parked" || st === "on hold") return { icon: "⚪", rank: 8, label: "Parked" };
  if (st === "waiting") return { icon: "🔵", rank: 7, label: "Waiting on someone else" };
  if (!t.due_date) return { icon: "🟢", rank: 4, label: "No fixed date" };
  const days = Math.round((new Date(t.due_date + "T12:00:00").getTime() - Date.now()) / DAY);
  if (days <= 7) return { icon: "🔴", rank: 1, label: days < 0 ? `${-days} days overdue` : `due in ${days} days` };
  if (days <= 21) return { icon: "🟠", rank: 2, label: `due in ${days} days` };
  if (days <= 45) return { icon: "🟡", rank: 3, label: `due in ${days} days` };
  return { icon: "🟢", rank: 4, label: `due in ${days} days` };
}

// TODO.md uses **bold** and `code`; render them lightly instead of showing the markers.
function renderTask(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) =>
    p.startsWith("**") ? <strong key={i} className="font-semibold text-navy">{p.slice(2, -2)}</strong>
    : p.startsWith("`") ? <code key={i} className="rounded bg-gray-100 px-1 text-[11px]">{p.slice(1, -1)}</code>
    : <span key={i}>{p}</span>);
}

const statusStyles: Record<string, string> = {
  "not started": "bg-gray-100 text-gray-600",
  "in progress": "bg-blue-100 text-blue-700",
  ready: "bg-emerald-50 text-emerald-deep",
  waiting: "bg-sky-100 text-sky-700",
  parked: "bg-gray-200 text-gray-500",
  "on hold": "bg-gray-200 text-gray-500",
  done: "bg-green-100 text-green-700",
};

export default function Tasks() {
  const [rows, setRows] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [asc, setAsc] = useState(true);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);   // row expanded for details

  useEffect(() => {
    if (configMissing) return;
    supabase.from("admin_tasks").select("*").then(({ data }) => {
      const list = (data as Task[]) ?? [];
      setRows(list);
      const latest = list.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
      setLoaded(latest ? new Date(latest).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null);
    });
  }, []);

  // Column filters (dropdowns under Category / Assigned to / Status); "" = all.
  const [catF, setCatF] = useState("");
  const [whoF, setWhoF] = useState("");
  const [statF, setStatF] = useState("");

  const pool = useMemo(() => rows.filter((r) => showDone || !r.is_done), [rows, showDone]);
  const distinct = (pick: (r: Task) => string) => [...new Set(pool.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categories = useMemo(() => distinct((r) => r.category), [pool]);
  const assignees = useMemo(() => distinct((r) => r.assigned_to), [pool]);
  const statuses = useMemo(() => distinct((r) => r.status), [pool]);
  const anyFilter = Boolean(filter || catF || whoF || statF);
  const clearAll = () => { setFilter(""); setCatF(""); setWhoF(""); setStatF(""); };

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const hit = pool.filter((r) =>
      (!catF || r.category === catF) && (!whoF || r.assigned_to === whoF) && (!statF || r.status === statF) &&
      (!needle || [r.code, r.category, r.task, r.assigned_to, r.due_text, r.status, urgency(r).icon, urgency(r).label]
        .join(" ").toLowerCase().includes(needle)));
    const dir = asc ? 1 : -1;
    const cmp = (a: Task, b: Task): number => {
      switch (sortKey) {
        case "urgency": {
          const d = urgency(a).rank - urgency(b).rank;
          if (d) return d;
          return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || (a.task_no ?? 0) - (b.task_no ?? 0);
        }
        case "code": return (a.is_done ? 1 : 0) - (b.is_done ? 1 : 0) || (a.task_no ?? 0) - (b.task_no ?? 0);
        case "due": return (a.due_date ?? (a.is_done ? "9998" : "9999")).localeCompare(b.due_date ?? (b.is_done ? "9998" : "9999")) || a.due_text.localeCompare(b.due_text);
        case "category": return a.category.localeCompare(b.category) || (a.task_no ?? 0) - (b.task_no ?? 0);
        case "task": return a.task.localeCompare(b.task);
        case "assigned_to": return a.assigned_to.localeCompare(b.assigned_to) || (a.task_no ?? 0) - (b.task_no ?? 0);
        case "status": return a.status.localeCompare(b.status) || (a.task_no ?? 0) - (b.task_no ?? 0);
      }
    };
    return [...hit].sort((a, b) => cmp(a, b) * dir);
  }, [pool, filter, catF, whoF, statF, sortKey, asc]);

  function sortBy(k: SortKey) {
    if (k === sortKey) setAsc(!asc);
    else { setSortKey(k); setAsc(true); }
  }

  const Th = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-navy ${className}`}
      onClick={() => sortBy(k)} title="Click to sort">
      {children}{sortKey === k ? <span className="ml-1 text-navy">{asc ? "▲" : "▼"}</span> : <span className="ml-1 text-gray-300">↕</span>}
    </th>
  );

  const total = pool.length, shown = visible.length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Tasks</h1>
          <p className="text-xs text-gray-500">The school's working to-do list. Read-only here; it is maintained in the office records{loaded ? ` · last updated ${loaded}` : ""}.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          Show done
        </label>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by any word: payroll, Claude, President, 🔴, waiting…"
          className="w-full max-w-md rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-royal focus:outline-none" />
        <span className="text-sm font-medium text-gray-600">
          ({shown} out of {total} items{shown === total ? " displayed" : ""})
        </span>
        {anyFilter && <button onClick={clearAll} className="text-xs text-royal hover:underline">Clear filters</button>}
      </div>

      {configMissing && <p className="text-sm text-gray-500">Connect the database to see the task list.</p>}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-silver/60">
            <tr>
              <Th k="code" className="w-12">#</Th>
              <Th k="urgency" className="w-10">⏰</Th>
              <Th k="category" className="w-40">Category</Th>
              <Th k="task">Task</Th>
              <Th k="assigned_to" className="w-44">Assigned to</Th>
              <Th k="due" className="w-28">Due</Th>
              <Th k="status" className="w-28">Status</Th>
            </tr>
            <tr className="border-t border-gray-200 bg-white">
              <td colSpan={3} className="px-3 pb-2 pt-1">
                <select value={catF} onChange={(e) => setCatF(e.target.value)} title="Filter by category"
                  className="w-full max-w-[13rem] rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td className="px-3 pb-2 pt-1" />
              <td className="px-3 pb-2 pt-1">
                <select value={whoF} onChange={(e) => setWhoF(e.target.value)} title="Filter by assignee"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
                  <option value="">Everyone</option>
                  {assignees.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
              <td className="px-3 pb-2 pt-1" />
              <td className="px-3 pb-2 pt-1">
                <select value={statF} onChange={(e) => setStatF(e.target.value)} title="Filter by status"
                  className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
                  <option value="">Any status</option>
                  {statuses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </td>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const u = urgency(r);
              const isOpen = openCode === r.code;
              return (
                <Fragment key={r.code}>
                  <tr onClick={() => setOpenCode(isOpen ? null : r.code)} title="Click for details"
                    className={`cursor-pointer border-t border-gray-100 align-top hover:bg-silver/40 ${r.is_done ? "text-gray-400" : "text-gray-700"} ${isOpen ? "bg-silver/40" : ""}`}>
                    <td className="px-3 py-2 font-semibold text-navy">{r.code}</td>
                    <td className="px-3 py-2" title={u.label}>{u.icon}</td>
                    <td className="px-3 py-2 text-xs">{r.category}</td>
                    <td className="px-3 py-2 leading-snug">
                      <div className={isOpen ? "" : "line-clamp-3"}>{renderTask(r.task)}</div>
                      {!isOpen && r.task.length > 160 && <div className="mt-0.5 text-[11px] text-royal">click for full text</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.assigned_to}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{r.is_done ? r.done_on : r.due_text}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyles[r.status.toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-gray-100 bg-silver/20">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Urgency</div><div>{u.icon} {u.label}</div></div>
                          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Assigned to</div><div>{r.assigned_to || "—"}</div></div>
                          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{r.is_done ? "Done on" : "Due"}</div><div>{r.is_done ? r.done_on ?? "—" : r.due_text || "—"}</div></div>
                          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Last synced</div><div>{new Date(r.updated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div></div>
                        </div>
                        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Full task</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{renderTask(r.task)}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!visible.length && !configMissing && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                {rows.length ? "No tasks match the filter." : "No tasks loaded yet — run the sync SQL to fill the list."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">🔴 due within 7 days or overdue · 🟠 within 3 weeks · 🟡 within 6 weeks · 🟢 later · 🔵 waiting on someone else · ⚪ parked · ✅ done</p>
    </div>
  );
}
