import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { type Task, urgency, PRIORITIES } from "../../lib/tasks";
import { useAuth } from "../../lib/auth";
import { todayStr } from "../../lib/dates";
import { usDate } from "../../lib/format";

const ASSIGNEES = ["Muneeb (President)", "Muneeb (accountant)", "Muneeb (Principal)", "Claude", "Nuruddin (Treasurer)"];
const CATEGORIES = ["Portal", "Website", "Records", "Bookkeeping", "Compliance", "Governance", "Marketing", "Admissions", "W-2 payroll", "Operations"];

// The school's working to-do list (mirror of the hub's TODO.md, phase 15).
// Read-only grid: sort on any column, filter box, "x out of y items" counter.

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

export default function Tasks() {
  const { can, session } = useAuth();
  const [rows, setRows] = useState<Task[]>([]);
  const [filter, setFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("urgency");
  const [asc, setAsc] = useState(true);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [openCode, setOpenCode] = useState<string | null>(null);   // row expanded for details
  // "+ New task" (phase 20): saved with source = 'portal' and a P-code, pulled into the office records within the hour
  const [newOpen, setNewOpen] = useState(false);
  const [nText, setNText] = useState("");
  const [nCat, setNCat] = useState("Operations");
  const [nCatOther, setNCatOther] = useState("");
  const [nWho, setNWho] = useState(ASSIGNEES[0]);
  const [nWhoOther, setNWhoOther] = useState("");
  const [nPrio, setNPrio] = useState("week");
  const [nDate, setNDate] = useState("");
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
      setLoaded(latest ? new Date(latest).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null);
    });
  }
  useEffect(() => { load(); }, []);

  async function saveNew() {
    setNMsg(null);
    const text = nText.trim();
    if (!text) return setNMsg("Describe the task first.");
    const category = nCat === "Other" ? nCatOther.trim() || "Operations" : nCat;
    const who = nWho === "Other" ? nWhoOther.trim() || "Muneeb (President)" : nWho;
    let due_date: string | null = null, due_text = "someday", status = "Not started";
    if (nPrio === "date") {
      if (!nDate) return setNMsg("Pick the due date.");
      due_date = nDate; due_text = nDate;
    } else {
      const p = PRIORITIES.find((x) => x.key === nPrio)!;
      if (p.days == null) { status = "Parked"; }
      else { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + p.days); due_date = d.toISOString().slice(0, 10); due_text = due_date; }
    }
    for (const f of nFiles) if (f.size > 25 * 1024 * 1024) return setNMsg(`${f.name} is over 25 MB.`);
    setNBusy(true);
    try {
      const { data: code, error: e1 } = await supabase.rpc("next_portal_task_code");
      if (e1 || !code) throw new Error(e1?.message ?? "no code");
      const attachments: { name: string; path: string; size: number }[] = [];
      for (const f of nFiles) {
        const key = f.name.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "file";
        const path = `inbox/${code}/${key}`;
        const { error: e2 } = await supabase.storage.from("task-docs").upload(path, f, { upsert: true });
        if (e2) throw new Error("Upload failed for " + f.name + ": " + e2.message);
        attachments.push({ name: f.name, path, size: f.size });
      }
      const { error: e3 } = await supabase.from("admin_tasks").insert({
        code, task_no: null, is_done: false, category, task: text, assigned_to: who,
        due_text, due_date, status, done_on: null, source: "portal",
        notes: nNotes.trim() || null, created_by: session?.user.id ?? null, attachments,
      });
      if (e3) throw new Error(e3.message);
      setNewOpen(false); setNText(""); setNNotes(""); setNFiles([]); setNPrio("week"); setNDate("");
      load();
    } catch (err) {
      setNMsg(String((err as Error).message ?? err));
    } finally {
      setNBusy(false);
    }
  }

  async function deletePortalTask(t: Task) {
    if (!confirm(`Delete task ${t.code}? (Only tasks not yet pulled into the records can be deleted here.)`)) return;
    const paths = (t.attachments ?? []).map((d) => d.path);
    if (paths.length) await supabase.storage.from("task-docs").remove(paths);
    await supabase.from("admin_tasks").delete().eq("code", t.code);
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

  // Attachments live in the private "task-docs" bucket; open through a 10-minute signed URL.
  async function openDoc(path: string) {
    const { data, error } = await supabase.storage.from("task-docs").createSignedUrl(path, 600);
    if (error || !data?.signedUrl) { alert("Could not open the document: " + (error?.message ?? "no URL")); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  }

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
          <p className="text-xs text-gray-500">The school's working to-do list, maintained in the office records{loaded ? ` · last updated ${loaded}` : ""}. Tasks added here (P-numbers) are pulled into the records within the hour and get their real number.</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Show done
          </label>
          {can("tasks", "edit") && (
            <button onClick={() => { setNewOpen(true); setNMsg(null); }}
              className="rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">+ New task</button>
          )}
        </div>
      </div>

      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={() => !nBusy && setNewOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-navy">New task</h2>
              <button onClick={() => setNewOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
            </div>
            <div className="space-y-3 text-sm">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">What needs doing
                <textarea autoFocus rows={3} value={nText} onChange={(e) => setNText(e.target.value)} placeholder="e.g. Pay the ESD late fee · Reply to the parent about pickup · File the letter that came today"
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Category
                  <select value={nCat} onChange={(e) => setNCat(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}<option>Other</option>
                  </select>
                  {nCat === "Other" && <input value={nCatOther} onChange={(e) => setNCatOther(e.target.value)} placeholder="Category" className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800" />}
                </label>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">For
                  <select value={nWho} onChange={(e) => setNWho(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800">
                    {ASSIGNEES.map((c) => <option key={c}>{c}</option>)}<option>Other</option>
                  </select>
                  {nWho === "Other" && <input value={nWhoOther} onChange={(e) => setNWhoOther(e.target.value)} placeholder="Name (role)" className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800" />}
                </label>
              </div>
              <div className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Priority
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {PRIORITIES.map((p) => (
                    <button key={p.key} type="button" onClick={() => setNPrio(p.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-semibold normal-case tracking-normal ${nPrio === p.key ? "border-navy bg-navy text-white" : "border-gray-300 bg-white text-gray-600"}`}>{p.label}</button>
                  ))}
                  <button type="button" onClick={() => setNPrio("date")}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold normal-case tracking-normal ${nPrio === "date" ? "border-navy bg-navy text-white" : "border-gray-300 bg-white text-gray-600"}`}>📅 Exact date</button>
                </div>
                {nPrio === "date" && <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} min={todayStr()} className="mt-2 rounded-lg border border-gray-300 p-2 text-sm text-gray-800" />}
              </div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Notes (optional)
                <textarea rows={2} value={nNotes} onChange={(e) => setNNotes(e.target.value)} placeholder="Where the paper is, who to call, anything Claude should know"
                  className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm font-normal normal-case tracking-normal text-gray-800" />
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Photo or file (optional)
                <input type="file" multiple accept="image/*,application/pdf" onChange={(e) => setNFiles(Array.from(e.target.files ?? []))}
                  className="mt-1 block w-full text-sm text-gray-700 file:mr-3 file:rounded-full file:border-0 file:bg-silver file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-navy" />
                {nFiles.length > 0 && <div className="mt-1 text-[11px] font-normal normal-case tracking-normal text-gray-500">{nFiles.map((f) => `${f.name} (${(f.size / 1024).toFixed(0)} KB)`).join(" · ")}</div>}
              </label>
              {nMsg && <p className="text-xs text-red-600">{nMsg}</p>}
              <div className="flex gap-2 pt-1">
                <button onClick={saveNew} disabled={nBusy} className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-40">{nBusy ? "Saving…" : "Add task"}</button>
                <button onClick={() => setNewOpen(false)} disabled={nBusy} className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
              </div>
              <p className="text-[11px] font-normal normal-case tracking-normal text-gray-400">Files land in the office's OneDrive Inbox within the hour and are filed from there; the portal copy is removed once filed.</p>
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
                    <td className="px-3 py-2 whitespace-nowrap text-xs">{r.is_done ? r.done_on : (r.due_date ? usDate(r.due_date) : r.due_text)}</td>
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
                          <div><div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{r.source === "portal" ? "Added here" : "Last synced"}</div><div>{new Date(r.source === "portal" && r.created_at ? r.created_at : r.updated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</div></div>
                        </div>
                        {r.source === "portal" && (
                          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            📱 Added from the portal. It keeps the code {r.code} until the office pull copies it into the records (hourly) and gives it a real number.
                            {can("tasks", "edit") && <button onClick={(e) => { e.stopPropagation(); deletePortalTask(r); }} className="ml-3 font-semibold text-red-600 hover:underline">Delete</button>}
                          </div>
                        )}
                        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Full task</div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{renderTask(r.task)}</p>
                        {r.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600"><span className="font-semibold">Notes:</span> {r.notes}</p>}
                        {(r.attachments?.length ?? 0) > 0 && (
                          <div className="mt-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Documents</div>
                            <ul className="mt-1 flex flex-wrap gap-2">
                              {r.attachments!.map((d) => (
                                <li key={d.path}>
                                  <button onClick={(e) => { e.stopPropagation(); openDoc(d.path); }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:border-royal hover:text-royal">
                                    📎 {d.name}{d.size ? <span className="font-normal text-gray-400">· {(d.size / 1024).toFixed(0)} KB</span> : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
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
