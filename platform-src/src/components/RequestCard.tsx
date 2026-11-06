// One teacher request (phase 35): summary line, and when opened the details, photo, full history
// and the actions the viewer is allowed (teacher: edit/delete own until decided, add a note;
// admin: discuss / approve / decline / progress / resolve, notes visible or internal).
// Phase 37: resolved and declined requests are closed: history only, no notes (admin can Reopen).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { type Req, STATUS_LABEL, STATUS_CLS, canTeacherEdit, photoUrl, shortDate, shortDateTime } from "../lib/requests";

export default function RequestCard({ r, admin, onChanged, onEdit, startOpen = false }: {
  r: Req; admin: boolean; onChanged: () => void; onEdit?: (r: Req) => void; startOpen?: boolean;
}) {
  const { profile, can } = useAuth();
  const isAdminRole = profile?.role === "admin";
  const canProgress = admin && can("teacher_requests", "edit");
  const closed = r.status === "done" || r.status === "declined";
  const [open, setOpen] = useState(startOpen);
  const [img, setImg] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(false);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState(r.due_date ?? "");
  const [mode, setMode] = useState<"" | "approve" | "decline">("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (open && r.photo_path && !img) photoUrl(r.photo_path).then(setImg); }, [open, r.photo_path]);
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setErr(null); setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    onChanged(); return true;
  }
  const setStatus = (status: string, extra: { p_reason?: string; p_due?: string | null } = {}) =>
    run(() => supabase.rpc("teacher_request_set_status", { p_id: r.id, p_status: status, p_reason: extra.p_reason ?? null, p_due: extra.p_due ?? null }))
      .then((ok) => { if (ok) { setMode(""); setReason(""); } });
  async function addNote() {
    if (!note.trim()) return;
    if (await run(() => supabase.rpc("teacher_request_add_note", { p_id: r.id, p_body: note.trim(), p_internal: admin && internal }))) { setNote(""); setInternal(false); }
  }
  async function del() {
    if (!window.confirm(`Delete request R${r.id} "${r.title}"? This cannot be undone.`)) return;
    setErr(null); setBusy(true);
    const { data, error } = await supabase.rpc("teacher_request_delete", { p_id: r.id });
    setBusy(false);
    if (error) return setErr(error.message);
    if (data) await supabase.storage.from("teacher-requests").remove([data as string]);
    onChanged();
  }

  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50";
  return (
    <div id={`r${r.id}`} className={`rounded-xl bg-white p-3 shadow-sm ${r.urgency === "urgent" && r.status !== "done" && r.status !== "declined" ? "border-l-4 border-red-400" : ""}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-2 text-left">
        <span className="mt-0.5 shrink-0 rounded bg-silver px-1.5 py-0.5 text-[11px] font-bold text-navy">R{r.id}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-800">{r.title}</span>
          <span className="block text-[11px] text-gray-500">
            {r.requester} · {r.type}{r.student ? ` · ${r.student}` : ""} · {shortDate(r.created_at)}
            {r.due_date && r.status !== "done" && r.status !== "declined" ? ` · due ${shortDate(r.due_date + "T12:00:00")}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
          {r.urgency === "urgent" && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">Urgent</span>}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3 text-sm">
          {r.details && <p className="whitespace-pre-wrap text-gray-700">{r.details}</p>}
          {r.photo_path && (img ? <a href={img} target="_blank" rel="noreferrer"><img src={img} alt="Request photo" className="max-h-56 rounded-lg border border-gray-200" /></a> : <p className="text-xs text-gray-400">Loading photo…</p>)}
          {r.status === "declined" && r.decline_reason && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700"><b>Declined:</b> {r.decline_reason}</p>}
          {admin && r.task_code && <p className="text-xs text-gray-500">Task <a className="font-semibold text-navy underline" href={`#/admin/tasks?task=${r.task_code}`}>{r.task_code}</a> in Admin → Tasks follows this request.</p>}

          {/* history */}
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">History</div>
            <ol className="space-y-1.5 border-l-2 border-gray-100 pl-3">
              <li className="text-xs text-gray-500">{shortDateTime(r.created_at)} · asked by {r.requester}</li>
              {r.notes.map((n) => (
                <li key={n.id} className={`text-xs ${n.kind === "status" ? "font-semibold text-navy" : "text-gray-700"}`}>
                  <span className="text-gray-400">{shortDateTime(n.created_at)} · {n.author}{n.internal ? " · internal" : ""}</span>
                  <div className={`whitespace-pre-wrap ${n.internal ? "rounded bg-amber-50 px-1.5 py-1" : ""}`}>{n.body}</div>
                </li>
              ))}
            </ol>
          </div>

          {/* add a note: open requests only; resolved and declined ones are closed (phase 37) */}
          {closed ? (
            <p className="rounded-lg bg-silver/60 px-2.5 py-1.5 text-xs text-gray-500">
              This request is closed{admin && isAdminRole ? ". Reopen it to add a note." : ", so no more notes or changes."}
            </p>
          ) : <div className="space-y-1.5">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={admin ? "Add a note…" : "Add a note or reply…"}
              className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm" />
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={addNote} disabled={busy || !note.trim()} className={`${btn} bg-navy text-white`}>Add note</button>
              {admin && <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal (teachers don't see it)</label>}
            </div>
          </div>}

          {/* teacher actions */}
          {!admin && canTeacherEdit(r) && (
            <div className="flex gap-2">
              <button onClick={() => onEdit?.(r)} disabled={busy} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Edit</button>
              <button onClick={del} disabled={busy} className={`${btn} border border-red-200 bg-white text-red-700`}>Delete</button>
            </div>
          )}

          {/* admin actions */}
          {admin && (
            <div className="space-y-2 rounded-lg bg-silver/60 p-2.5">
              <div className="flex flex-wrap gap-2">
                {isAdminRole && r.status === "submitted" && <button onClick={() => setStatus("discussing")} disabled={busy} className={`${btn} bg-sky-600 text-white`}>Under discussion</button>}
                {isAdminRole && (r.status === "submitted" || r.status === "discussing") && <>
                  <button onClick={() => setMode(mode === "approve" ? "" : "approve")} disabled={busy} className={`${btn} bg-emerald-600 text-white`}>Approve…</button>
                  <button onClick={() => setMode(mode === "decline" ? "" : "decline")} disabled={busy} className={`${btn} bg-red-600 text-white`}>Decline…</button>
                </>}
                {canProgress && r.status === "approved" && <button onClick={() => setStatus("in_progress")} disabled={busy} className={`${btn} bg-blue-600 text-white`}>Start (In progress)</button>}
                {canProgress && (r.status === "approved" || r.status === "in_progress") && <button onClick={() => setStatus("done")} disabled={busy} className={`${btn} bg-green-700 text-white`}>Mark resolved</button>}
                {isAdminRole && (r.status === "done" || r.status === "declined") && <button onClick={() => setStatus(r.status === "done" ? "in_progress" : "submitted")} disabled={busy} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Reopen</button>}
                {admin && !isAdminRole && (r.status === "submitted" || r.status === "discussing") && <span className="text-xs text-gray-500">Waiting for the President or an admin to approve or decline.</span>}
              </div>
              {canProgress && (r.status === "approved" || r.status === "in_progress") && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-600">Due date</span>
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
                  <button onClick={() => setStatus(r.status, { p_due: due || null })} disabled={busy || !due || due === r.due_date} className={`${btn} border border-gray-300 bg-white text-gray-700`}>Save date</button>
                </div>
              )}
              {mode === "approve" && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-gray-600">Due date (optional)</span>
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded border border-gray-300 px-2 py-1" />
                  <button onClick={() => setStatus("approved", { p_due: due || null })} disabled={busy} className={`${btn} bg-emerald-600 text-white`}>Approve → add to my tasks</button>
                </div>
              )}
              {mode === "decline" && (
                <div className="space-y-1.5 text-xs">
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Short reason (teachers see it)" className="w-full rounded border border-gray-300 px-2 py-1.5" />
                  <button onClick={() => setStatus("declined", { p_reason: reason })} disabled={busy || !reason.trim()} className={`${btn} bg-red-600 text-white`}>Decline</button>
                </div>
              )}
            </div>
          )}
          {err && <p className="text-xs text-red-700">{err}</p>}
        </div>
      )}
    </div>
  );
}
