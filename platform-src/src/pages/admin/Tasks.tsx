import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { openLater } from "../../lib/openFile";
import { useSearchParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { type Task, type TaskNote, type Repeat, urgency, PRIORITIES, REPEATS, STATUSES, repeatLabel } from "../../lib/tasks";
import { useAuth } from "../../lib/auth";
import { todayStr } from "../../lib/dates";
import { usDate } from "../../lib/format";

const ASSIGNEES = ["Muneeb (President)", "Muneeb (accountant)", "Muneeb (Principal)", "Claude", "Nuruddin (Treasurer)"];
// Delegation (phase 31, President 2026-10-31): any admin or staff login can be given a task.
// Staff see only the tasks assigned to them or created by them (enforced in the database);
// teachers are not assignable for now.
interface Person { id: string; full_name: string; title: string | null; role: string }
const personLabel = (p: Person) => `${p.full_name.trim()} (${p.title?.trim() || (p.role === "admin" ? "Admin" : "Office Staff")})`;
// Departments (President, 2026-10-14) — the same ten as TODO.md; every task belongs to exactly one.
const CATEGORIES = ["Executive Office", "Academics", "Students & Families", "HR", "Finance", "Development", "Marketing", "Operations", "IT", "Legal & Compliance"];

// The school's working to-do list (phase 15), worked in the portal since phase 47 (President
// 2026-11-22): every task has one permanent number from the moment it is created; admins edit
// everything, staff move the status of their tasks and close them; every task carries comments
// and a change history; a task can repeat (the next one appears when this one is closed).
// The office records (TODO.md) stay in step through the hourly sync, in both directions.

type SortKey = "urgency" | "code" | "category" | "task" | "assigned_to" | "due" | "status";

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

const label = "text-[11px] font-semibold uppercase tracking-wide text-gray-400";
const input = "mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm font-normal normal-case tracking-normal text-gray-800";
const when = (ts: string) => new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export default function Tasks() {
  const { can, session, profile } = useAuth();
  const isStaff = profile?.role === "staff";
  const isAdmin = profile?.role === "admin";
  const canEdit = can("tasks", "edit");
  const [sp] = useSearchParams();
  const [people, setPeople] = useState<Person[]>([]);
  const [rows, setRows] = useState<Task[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});   // comments per task
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [asc, setAsc] = useState(true);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);   // row expanded for details
  const linkTarget = useRef<string | null>(null);                  // ?task= from a notification, until it has been shown
  // The grid scrolls sideways on a phone; an open task's panel must not. It is kept as wide as the
  // visible part of the grid and pinned to its left edge.
  const gridRef = useRef<HTMLDivElement>(null);
  const [gridW, setGridW] = useState<number | null>(null);
  useEffect(() => {
    const el = gridRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setGridW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [linkMissing, setLinkMissing] = useState<string | null>(null);
  // "+ New task": saved with its permanent number at once (phase 47)
  const [newOpen, setNewOpen] = useState(false);
  const [nText, setNText] = useState("");
  const [nCat, setNCat] = useState("Operations");
  const [nWho, setNWho] = useState(ASSIGNEES[0]);
  const [nWhoOther, setNWhoOther] = useState("");
  const [nPrio, setNPrio] = useState("week");
  const [nDate, setNDate] = useState("");
  const [nRepeat, setNRepeat] = useState<"" | Repeat>("");
  const [nNotes, setNNotes] = useState("");
  const [nFiles, setNFiles] = useState<File[]>([]);
  const [nBusy, setNBusy] = useState(false);
  const [nMsg, setNMsg] = useState<string | null>(null);

  function load() {
    if (configMissing) return;
    supabase.from("admin_tasks").select("*").then(({ data }) => {
      const list = (data as Task[]) ?? [];
      setRows(list);
      const latest = list.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), "");
      setLoaded(latest ? when(latest) : null);
    });
    supabase.from("task_notes").select("task_code").eq("kind", "comment").then(({ data }) => {
      const c: Record<string, number> = {};
      for (const n of (data as { task_code: string }[] | null) ?? []) c[n.task_code] = (c[n.task_code] ?? 0) + 1;
      setCounts(c);
    });
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (configMissing) return;
    supabase.rpc("task_assignees").then(({ data }) => setPeople((data as Person[]) ?? []));
  }, []);
  // staff file new tasks for themselves by default
  useEffect(() => { if (isStaff && profile) setNWho(`u:${profile.id}`); }, [isStaff, profile?.id]);
  // "u:<id>" = a login, anything else = a plain name from ASSIGNEES / Other
  const resolveWho = (v: string, other = ""): { assigned_to: string; assigned_user: string | null } => {
    if (v.startsWith("u:")) {
      const p = people.find((x) => x.id === v.slice(2));
      return { assigned_to: p ? personLabel(p) : "Muneeb (President)", assigned_user: p?.id ?? null };
    }
    return { assigned_to: v === "Other" ? other.trim() || "Muneeb (President)" : v, assigned_user: null };
  };
  const whoOptions = (
    <>
      <optgroup label="Office">{ASSIGNEES.map((c) => <option key={c} value={c}>{c}</option>)}</optgroup>
      {people.length > 0 && <optgroup label="Portal logins (get a notification)">{people.map((p) => <option key={p.id} value={`u:${p.id}`}>{personLabel(p)}</option>)}</optgroup>}
    </>
  );
  const nameOf = (id?: string | null) => { const p = people.find((x) => x.id === id); return p ? p.full_name.trim() : null; };

  async function saveNew() {
    setNMsg(null);
    const text = nText.trim();
    if (!text) return setNMsg("Describe the task first.");
    const category = nCat;
    const { assigned_to: who, assigned_user } = resolveWho(nWho, nWhoOther);
    let due_date: string | null = null, due_text = "someday", status = "Not started";
    if (nPrio === "date") {
      if (!nDate) return setNMsg("Pick the due date.");
      due_date = nDate; due_text = nDate;
    } else {
      const p = PRIORITIES.find((x) => x.key === nPrio)!;
      if (p.days == null) { status = "Parked"; }
      else { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + p.days); due_date = d.toISOString().slice(0, 10); due_text = due_date; }
    }
    if (nRepeat && !due_date) return setNMsg("A repeating task needs a due date: pick a priority with a date, or an exact date.");
    for (const f of nFiles) if (f.size > 25 * 1024 * 1024) return setNMsg(`${f.name} is over 25 MB.`);
    setNBusy(true);
    try {
      // the permanent number, from the one counter the office records use too
      const { data: no, error: e1 } = await supabase.rpc("next_task_no");
      if (e1 || !no) throw new Error(e1?.message ?? "no task number");
      const code = String(no);
      const attachments: { name: string; path: string; size: number }[] = [];
      for (const f of nFiles) {
        const key = f.name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "file";
        const path = `inbox/${code}/${key}`;
        const { error: e2 } = await supabase.storage.from("task-docs").upload(path, f, { upsert: true });
        if (e2) throw new Error("Upload failed for " + f.name + ": " + e2.message);
        attachments.push({ name: f.name, path, size: f.size });
      }
      const { error: e3 } = await supabase.from("admin_tasks").insert({
        code, task_no: no, is_done: false, category, task: text, assigned_to: who, assigned_user,
        due_text, due_date, status, done_on: null, source: nRepeat ? "recurring" : "portal", repeat_every: nRepeat || null,
        notes: nNotes.trim() || null, created_by: session?.user.id ?? null, attachments,
      });
      if (e3) throw new Error(e3.message);
      setNewOpen(false); setNText(""); setNNotes(""); setNFiles([]); setNPrio("week"); setNDate(""); setNRepeat("");
      setNWho(isStaff && profile ? `u:${profile.id}` : ASSIGNEES[0]);
      setOpenCode(code);
      load();
    } catch (err) {
      setNMsg(String((err as Error).message ?? err));
    } finally {
      setNBusy(false);
    }
  }

  async function deleteTask(t: Task) {
    if (!confirm(`Delete task ${t.code}? This cannot be undone.`)) return;
    const paths = (t.attachments ?? []).map((d) => d.path);
    if (paths.length) await supabase.storage.from("task-docs").remove(paths);
    const { error } = await supabase.from("admin_tasks").delete().eq("code", t.code);
    if (error) { alert("Could not delete: " + error.message); return; }
    setOpenCode(null); load();
  }

  // Column filters (dropdowns under Category / Assigned to / Status); "" = all.
  const [catF, setCatF] = useState("");
  const [whoF, setWhoF] = useState("");
  const [statF, setStatF] = useState("");

  const pool = useMemo(() => rows.filter((r) => showDone || !r.is_done), [rows, showDone]);
  const distinct = (pick: (r: Task) => string) => [...new Set(pool.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const categories = useMemo(() => distinct((r) => r.category), [pool]);
  const assignees = useMemo(() => distinct((r) => r.assigned_to), [pool]);
  const statuses = useMemo(() => distinct((r) => r.status), [pool]);
  // A chosen filter value that is no longer an option (e.g. Status "Done" after unticking Show done)
  // would keep filtering while the dropdown shows "All" — drop it instead (#113). Wait for rows first.
  useEffect(() => {
    if (!rows.length) return;
    if (catF && !categories.includes(catF)) setCatF("");
    if (whoF && !assignees.includes(whoF)) setWhoF("");
    if (statF && !statuses.includes(statF)) setStatF("");
  }, [rows.length, categories, assignees, statuses, catF, whoF, statF]);
  const anyFilter = Boolean(filter || catF || whoF || statF);
  const clearAll = () => { setFilter(""); setCatF(""); setWhoF(""); setStatF(""); };

  // ?task=<number> from a notification: open that task. The link may arrive while this page is
  // already showing (a second notification), so it is read on every change, not only on first load.
  const linked = sp.get("task");
  useEffect(() => {
    if (!linked) return;
    linkTarget.current = linked;
    setLinkMissing(null); setOpenCode(linked); clearAll();
  }, [linked]);
  useEffect(() => {
    const code = linkTarget.current;
    if (!code || !rows.length) return;
    const r = rows.find((x) => x.code === code);
    if (!r) { linkTarget.current = null; setLinkMissing(code); return; }
    if (r.is_done && !showDone) { setShowDone(true); return; }   // runs again once the done rows are in the grid
    linkTarget.current = null;
    requestAnimationFrame(() => document.getElementById(`task-${code}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [rows, showDone, linked]);

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
          <p className="text-xs text-gray-500">{isStaff
            ? "The tasks given to you and the ones you added. Open a task to change its status, close it or leave a comment."
            : <>The school's working to-do list{loaded ? ` · last updated ${loaded}` : ""}. Open a task to edit it, close it or comment. Changes made here reach the office records within the hour. Give a task to a staff login and only they (and admins) see it.</>}</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done
          </label>
          {canEdit && (
            <button onClick={() => { setNewOpen(true); setNMsg(null); }}
              className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">+ New task</button>
          )}
        </div>
      </div>

      {linkMissing && (
        <div className="mb-3 flex items-start justify-between gap-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>Task {linkMissing} is not in your list any more. It may have been deleted, given to someone else, or (for an older alert with a P-number) renumbered: look for it by its text below.</span>
          <button onClick={() => setLinkMissing(null)} className="font-semibold">✕</button>
        </div>
      )}

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !nBusy && setNewOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-navy">New task</h2>
              <button onClick={() => setNewOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <label className={`block ${label}`}>What needs doing
                <textarea autoFocus rows={3} value={nText} onChange={(e) => setNText(e.target.value)} placeholder="e.g. Pay the ESD late fee · Reply to the parent about pickup · File the letter that came today"
                  className={input} />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={`block ${label}`}>Department
                  <select value={nCat} onChange={(e) => setNCat(e.target.value)} className={input}>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className={`block ${label}`}>For
                  <select value={nWho} onChange={(e) => setNWho(e.target.value)} className={input}>
                    {whoOptions}<option value="Other">Other</option>
                  </select>
                  {nWho === "Other" && <input value={nWhoOther} onChange={(e) => setNWhoOther(e.target.value)} placeholder="Name (role)" className={input} />}
                </label>
              </div>
              <div className={`block ${label}`}>Priority
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button key={p.key} type="button" onClick={() => setNPrio(p.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold normal-case tracking-normal ${nPrio === p.key ? "border-navy bg-navy text-white" : "border-gray-300 bg-white text-gray-600"}`}>{p.label}</button>
                  ))}
                  <button type="button" onClick={() => setNPrio("date")}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold normal-case tracking-normal ${nPrio === "date" ? "border-navy bg-navy text-white" : "border-gray-300 bg-white text-gray-600"}`}>📅 Exact date</button>
                </div>
                {nPrio === "date" && <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} min={todayStr()} className="mt-2 rounded-lg border border-gray-300 p-2 text-sm font-normal text-gray-800" />}
              </div>
              <label className={`block ${label}`}>Repeat
                <select value={nRepeat} onChange={(e) => setNRepeat(e.target.value as "" | Repeat)} className={input}>
                  <option value="">Does not repeat</option>
                  {REPEATS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
                {nRepeat && <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-gray-500">🔁 The next one is created when this one is closed{nRepeat === "daily" ? " (school days only: Monday–Thursday, holidays skipped)" : ""}. Repeating tasks stay in the portal.</span>}
              </label>
              <label className={`block ${label}`}>Notes (optional)
                <textarea rows={2} value={nNotes} onChange={(e) => setNNotes(e.target.value)} placeholder="Where the paper is, who to call, anything Claude should know"
                  className={input} />
              </label>
              <label className={`block ${label}`}>Photo or file (optional)
                <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setNFiles(Array.from(e.target.files ?? []))}
                  className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-full file:border-0 file:bg-silver file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-navy" />
                {nFiles.length > 0 && <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-gray-500">{nFiles.map((f) => `${f.name} (${(f.size / 1024).toFixed(0)} KB)`).join(" · ")}</div>}
              </label>
              {nMsg && <p className="text-xs text-red-600">{nMsg}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={saveNew} disabled={nBusy} className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-40">{nBusy ? "Saving…" : "Add task"}</button>
                <button onClick={() => setNewOpen(false)} disabled={nBusy} className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
              </div>
              {!nRepeat && <p className="text-[11px] font-normal normal-case tracking-normal text-gray-400">The task gets its permanent number at once. Files land in the office's OneDrive Inbox within the hour and are filed from there.</p>}
            </div>
          </div>
        </div>
      )}

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

      <div ref={gridRef} className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-silver/60">
            <tr>
              <Th k="code" className="w-14">#</Th>
              <Th k="urgency" className="w-10">⏰</Th>
              <Th k="category" className="w-40">Department</Th>
              <Th k="task">Task</Th>
              <Th k="assigned_to" className="w-44">Assigned to</Th>
              <Th k="due" className="w-28">Due</Th>
              <Th k="status" className="w-28">Status</Th>
            </tr>
            <tr className="border-t border-gray-200 bg-white">
              <td colSpan={3} className="px-3 pb-2 pt-1">
                <select value={catF} onChange={(e) => setCatF(e.target.value)} title="Filter by department"
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
                  <tr id={`task-${r.code}`} onClick={() => setOpenCode(isOpen ? null : r.code)} title="Click for details"
                    className={`cursor-pointer scroll-mt-16 border-t border-gray-100 align-top hover:bg-silver/40 ${r.is_done ? "text-gray-400" : "text-gray-700"} ${isOpen ? "bg-silver/40" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-semibold text-navy">{r.code}</td>
                    <td className="px-3 py-2" title={u.label}>{u.icon}</td>
                    <td className="px-3 py-2 text-xs">{r.category}</td>
                    <td className="px-3 py-2 leading-snug">
                      <div className={isOpen ? "" : "line-clamp-3"}>{renderTask(r.task)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px]">
                        {!isOpen && r.task.length > 160 && <span className="text-royal">click for full text</span>}
                        {r.repeat_every && <span className="text-gray-500" title="The next one is created when this one is closed">🔁 {repeatLabel(r.repeat_every)}</span>}
                        {counts[r.code] ? <span className="text-gray-500">💬 {counts[r.code]}</span> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.assigned_to}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{r.is_done ? r.done_on : (r.due_date ? usDate(r.due_date) : r.due_text)}</td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyles[r.status.toLowerCase()] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-gray-100 bg-silver/20">
                      <td colSpan={7} className="p-0">
                        <div className="sticky left-0 px-3 py-4 sm:px-6" style={gridW ? { width: gridW } : undefined}>
                        <TaskDetail task={r} u={u} isAdmin={isAdmin} canEdit={canEdit} myId={profile?.id ?? null}
                          addedBy={nameOf(r.created_by)} whoOptions={whoOptions} resolveWho={resolveWho}
                          onChanged={load} onDelete={() => deleteTask(r)} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!visible.length && !configMissing && (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-400">
                {rows.length ? "No tasks match the filter." : isStaff ? "No tasks for you right now." : "No tasks loaded yet."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">🔴 due within 7 days or overdue · 🟠 within 3 weeks · 🟡 within 6 weeks · 🟢 later · 🔵 waiting on someone else · ⚪ parked · ✅ done · 🔁 repeats · 💬 comments</p>
    </div>
  );
}

// ---------------- one open task: status, edit, reassign, comments, history ----------------
function TaskDetail({ task: r, u, isAdmin, canEdit, myId, addedBy, whoOptions, resolveWho, onChanged, onDelete }: {
  task: Task; u: { icon: string; label: string }; isAdmin: boolean; canEdit: boolean; myId: string | null; addedBy: string | null;
  whoOptions: React.ReactNode; resolveWho: (v: string, other?: string) => { assigned_to: string; assigned_user: string | null };
  onChanged: () => void; onDelete: () => void;
}) {
  const [notes, setNotes] = useState<TaskNote[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [eText, setEText] = useState(r.task);
  const [eCat, setECat] = useState(r.category);
  const [eDue, setEDue] = useState(r.due_date ?? "");
  const [eRepeat, setERepeat] = useState<string>(r.repeat_every ?? "");
  const [eNotes, setENotes] = useState(r.notes ?? "");
  const [reWho, setReWho] = useState("");

  const fromTeacher = r.source === "teacher";
  const mine = isAdmin || (r.created_by != null && r.created_by === myId);   // may change more than the status
  const legacyDone = /^D/.test(r.code);        // closed under the old D-numbering: read-only (comments still work)
  const mayStatus = canEdit && !fromTeacher && !legacyDone;
  const mayEdit = canEdit && mine && !fromTeacher;
  const mayDelete = canEdit && (r.source === "portal" || r.source === "recurring") && mine;

  function loadNotes() {
    supabase.from("task_notes").select("*").eq("task_code", r.code).order("created_at").then(({ data }) => setNotes((data as TaskNote[]) ?? []));
  }
  useEffect(() => { loadNotes(); }, [r.code]);

  async function edit(patch: Record<string, unknown>, done?: () => void) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("task_edit", { p_code: r.code, p: patch });
    setBusy(false);
    if (error) return setMsg(error.message);
    done?.(); loadNotes(); onChanged();
  }
  async function addComment() {
    const body = comment.trim();
    if (!body) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("task_comment", { p_code: r.code, p_body: body });
    setBusy(false);
    if (error) return setMsg(error.message);
    setComment(""); loadNotes(); onChanged();
  }
  function startEdit() {
    setEText(r.task); setECat(r.category); setEDue(r.due_date ?? ""); setERepeat(r.repeat_every ?? ""); setENotes(r.notes ?? "");
    setEditing(true); setMsg(null);
  }
  function saveEdit() {
    const patch: Record<string, unknown> = { task: eText, category: eCat, due_date: eDue || null, notes: eNotes };
    if (r.source !== "TODO.md") patch.repeat_every = eRepeat || null;
    if (eRepeat && !eDue) return setMsg("A repeating task needs a due date.");
    edit(patch, () => setEditing(false));
  }
  // Attachments live in the private "task-docs" bucket; open through a 10-minute signed URL.
  async function openDoc(path: string) {
    const go = openLater();
    const { data, error } = await supabase.storage.from("task-docs").createSignedUrl(path, 600);
    if (error || !data?.signedUrl) { go(null); alert("Could not open the document: " + (error?.message ?? "no URL")); return; }
    go(data.signedUrl);
  }

  const pending = r.edit_pending || r.assign_pending;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="font-display text-lg font-semibold text-navy">Task {r.code}</div>
        {r.repeat_every && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">🔁 Repeats {repeatLabel(r.repeat_every)}</span>}
        {pending && <span className="text-[11px] text-amber-700" title="Changed here; the office records update within the hour">updating the office records…</span>}
      </div>
      <div className="mt-2 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><div className={label}>Urgency</div><div>{u.icon} {u.label}</div></div>
        <div><div className={label}>Assigned to</div><div>{r.assigned_to || "—"}</div></div>
        <div><div className={label}>{r.is_done ? "Done on" : "Due"}</div><div>{r.is_done ? (r.done_on ? usDate(r.done_on) : "—") : (r.due_date ? usDate(r.due_date) : r.due_text || "—")}</div></div>
        <div><div className={label}>Added</div><div>{r.created_at ? when(r.created_at) : "—"}{addedBy ? ` · ${addedBy}` : r.source === "TODO.md" ? " · office records" : ""}</div></div>
      </div>

      {/* status + actions */}
      {mayStatus && !editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={label}>Status</span>
          <select value={STATUSES.includes(r.status) ? r.status : ""} disabled={busy} onChange={(e) => e.target.value && edit({ status: e.target.value })}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
            {!STATUSES.includes(r.status) && <option value="">{r.status || "—"}</option>}
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {!r.is_done && <button onClick={() => edit({ status: "Done" })} disabled={busy}
            className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">✓ Mark done</button>}
          {mayEdit && !r.is_done && <button onClick={startEdit} disabled={busy}
            className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-navy hover:border-royal">✎ Edit</button>}
          {isAdmin && !r.is_done && (
            <span className="flex flex-wrap items-center gap-2 sm:ml-3">
              <span className={label}>Reassign</span>
              <select value={reWho} onChange={(e) => setReWho(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700">
                <option value="">Choose a person…</option>
                {whoOptions}
              </select>
              <button onClick={() => edit(resolveWho(reWho), () => setReWho(""))} disabled={!reWho || busy}
                className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">Assign</button>
            </span>
          )}
          {mayDelete && <button onClick={onDelete} disabled={busy} className="ml-auto text-xs font-semibold text-red-600 hover:underline">Delete</button>}
        </div>
      )}
      {fromTeacher && <p className="mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">This came from a teacher request: its status is managed on the Teacher requests page. Comments can be left here.</p>}
      {r.is_done && r.repeat_every && <p className="mt-2 text-xs text-gray-500">🔁 The next one was created when this was closed.</p>}

      {editing ? (
        <div className="mt-3 space-y-3 rounded-lg border border-gray-200 bg-white p-3">
          <label className={`block ${label}`}>Task
            <textarea rows={4} value={eText} onChange={(e) => setEText(e.target.value)} className={input} />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={`block ${label}`}>Department
              <select value={eCat} onChange={(e) => setECat(e.target.value)} className={input}>
                {!CATEGORIES.includes(eCat) && <option value={eCat}>{eCat}</option>}
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className={`block ${label}`}>Due date
              <input type="date" value={eDue} onChange={(e) => setEDue(e.target.value)} className={input} />
            </label>
            {r.source !== "TODO.md" && (
              <label className={`block ${label}`}>Repeat
                <select value={eRepeat} onChange={(e) => setERepeat(e.target.value)} className={input}>
                  <option value="">Does not repeat</option>
                  {REPEATS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <label className={`block ${label}`}>Notes
            <textarea rows={2} value={eNotes} onChange={(e) => setENotes(e.target.value)} className={input} />
          </label>
          <div className="flex gap-2">
            <button onClick={saveEdit} disabled={busy} className="rounded-full bg-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">{busy ? "Saving…" : "Save"}</button>
            <button onClick={() => { setEditing(false); setMsg(null); }} disabled={busy} className="rounded-full border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className={`mt-3 ${label}`}>Full task</div>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{renderTask(r.task)}</p>
          {r.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600"><span className="font-semibold">Notes:</span> {r.notes}</p>}
        </>
      )}
      {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}

      {(r.attachments?.length ?? 0) > 0 && (
        <div className="mt-3">
          <div className={label}>Documents</div>
          <ul className="mt-1 flex flex-wrap gap-2">
            {r.attachments!.map((d) => (
              <li key={d.path}>
                <button onClick={() => openDoc(d.path)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-royal hover:text-royal">
                  📎 {d.name}{d.size ? <span className="font-normal text-gray-400">· {(d.size / 1024).toFixed(0)} KB</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* comments + change history: kept for good, nobody can edit or delete a line */}
      <div className="mt-4 border-t border-gray-200 pt-3">
        <div className={label}>Comments and history</div>
        <ul className="mt-2 space-y-2">
          {notes.map((n) => n.kind === "comment" ? (
            <li key={n.id} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
              <div className="text-[11px] text-gray-500"><span className="font-semibold text-navy">💬 {n.author_name || "—"}</span> · {when(n.created_at)}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-800">{n.body}</p>
            </li>
          ) : (
            <li key={n.id} className="px-1 text-[11px] text-gray-500">✎ {n.body} — {n.author_name || "—"}, {when(n.created_at)}</li>
          ))}
          {!notes.length && <li className="text-xs text-gray-400">No comments yet.</li>}
        </ul>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment: what was done, what is blocking, a question…"
            className="w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800" />
          <button onClick={addComment} disabled={busy || !comment.trim()}
            className="shrink-0 rounded-full bg-navy px-4 py-2 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">Add comment</button>
        </div>
      </div>
    </div>
  );
}
