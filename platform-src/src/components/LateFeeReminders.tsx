import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { monthStr } from "../lib/dates";

// Phase 41 (President 2026-11-10): tuition e-mails are never automatic. The office opens this
// panel, sees the families still owing for a month (only after the 5th), ticks who should get a
// reminder, edits the wording and clicks Send. The family's primary contact is e-mailed at once
// and every linked parent gets the same note in the portal. Receipts stay automatic.

interface LateRow {
  family_key: string; parent_id: string | null; to_name: string | null; to_email: string | null;
  student_ids: string[]; children: string; due: number; paid: number; balance: number;
  last_reminded: string | null; reminders_sent: number;
}

const money = (n: number) => "$" + Number(n).toFixed(0);
const monthLabel = (ym: string) => new Date(ym + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

function fill(t: string, r: LateRow, ym: string) {
  return t.replaceAll("{month}", monthLabel(ym)).replaceAll("{amount}", money(r.balance))
    .replaceAll("{children}", r.children).replaceAll("{parent}", r.to_name ?? "Parent");
}

export default function LateFeeReminders({ canSend }: { canSend: boolean }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStr());
  const [rows, setRows] = useState<LateRow[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState({ subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const day = new Date().getDate();
  const isCurrent = month === monthStr();
  const notLateYet = isCurrent && day <= 5;

  async function loadTemplate() {
    const { data } = await supabase.from("app_settings").select("key, value").in("key", ["fee_reminder_subject", "fee_reminder_message"]);
    const m = Object.fromEntries(((data as { key: string; value: string }[]) ?? []).map((x) => [x.key, x.value]));
    const s = { subject: m.fee_reminder_subject ?? "", message: m.fee_reminder_message ?? "" };
    setSaved(s); setSubject(s.subject); setMessage(s.message);
  }
  async function loadRows() {
    setRows(null);
    const { data, error } = await supabase.rpc("fee_late_families", { p_month: month + "-01" });
    if (error) { setNote({ ok: false, text: "Could not load: " + error.message + (error.message.includes("fee_late_families") ? " - run platform_schema_phase41.sql" : "") }); setRows([]); return; }
    const r = (data as LateRow[]) ?? [];
    setRows(r);
    setPick(r.map((x) => x.family_key));   // everyone who owes is ticked; untick to leave someone out
  }
  useEffect(() => { if (open) { loadTemplate(); } }, [open]);
  useEffect(() => { if (open) { setNote(null); loadRows(); } }, [open, month]);

  const chosen = useMemo(() => (rows ?? []).filter((r) => pick.includes(r.family_key)), [rows, pick]);
  const preview = chosen[0] ?? (rows ?? [])[0];
  const dirty = subject !== saved.subject || message !== saved.message;

  async function saveWording() {
    const { error } = await supabase.from("app_settings").upsert([
      { key: "fee_reminder_subject", value: subject }, { key: "fee_reminder_message", value: message }]);
    if (error) return setNote({ ok: false, text: "Could not save the wording: " + error.message });
    setSaved({ subject, message });
    setNote({ ok: true, text: "Saved as the default wording for next time." });
  }

  async function send() {
    if (!chosen.length) return;
    const total = chosen.reduce((s, r) => s + Number(r.balance), 0);
    if (!confirm(`Send the late-fee reminder for ${monthLabel(month)} to ${chosen.length} famil${chosen.length === 1 ? "y" : "ies"} (${money(total)} outstanding) now?\n\nThe primary contact of each family is e-mailed immediately; every linked parent also sees it in the portal.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("send_fee_reminders", {
      p_month: month + "-01", p_families: chosen.map((r) => r.family_key), p_subject: subject, p_message: message });
    setBusy(false);
    if (error) return setNote({ ok: false, text: "Not sent: " + error.message });
    const d = data as { families: number; emailed: number; in_app: number };
    setNote({ ok: true, text: `Reminder sent to ${d.families} famil${d.families === 1 ? "y" : "ies"}: ${d.emailed} e-mail${d.emailed === 1 ? "" : "s"}, ${d.in_app} portal notification${d.in_app === 1 ? "" : "s"}.` +
      (d.emailed < d.families ? ` ${d.families - d.emailed} famil${d.families - d.emailed === 1 ? "y was" : "ies were"} not e-mailed (no usable address, or e-mail is switched off here); families with a portal login still see the note there.` : "") });
    loadRows();
  }

  return (
    <section className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left">
        <span className="text-sm font-bold text-navy">✉️ Late-fee reminders</span>
        <span className="text-xs text-gray-500">— nothing is sent automatically; you choose who and when</span>
        <span className="ml-auto text-xs text-gray-400">{open ? "Hide" : "Open"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-gray-500">Tuition month<br />
              <input type="month" value={month} max={monthStr()} onChange={(e) => setMonth(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
            </label>
            <p className="text-xs text-gray-500">Tuition is due by the 5th. A family shows here only when part of that month is still unpaid (a waived month counts as covered).</p>
          </div>
          {note && <div className={`rounded-lg p-2.5 text-sm ${note.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{note.text}</div>}

          {notLateYet ? (
            <p className="rounded-lg bg-silver p-3 text-sm text-gray-600">{monthLabel(month)} tuition is not late yet — reminders open on the 6th.</p>
          ) : rows === null ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Every family is paid up for {monthLabel(month)}. 🎉</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-400">
                    <th className="py-1 pr-2"><input type="checkbox" checked={pick.length === rows.length} onChange={(e) => setPick(e.target.checked ? rows.map((r) => r.family_key) : [])} /></th>
                    <th className="py-1 pr-2">Family (children)</th>
                    <th className="py-1 pr-2">Sent to</th>
                    <th className="py-1 pr-2 text-right">Still due</th>
                    <th className="py-1">Last reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.family_key} className="border-b last:border-0">
                      <td className="py-1.5 pr-2"><input type="checkbox" checked={pick.includes(r.family_key)}
                        onChange={(e) => setPick(e.target.checked ? [...pick, r.family_key] : pick.filter((k) => k !== r.family_key))} /></td>
                      <td className="py-1.5 pr-2 font-semibold text-navy">{r.children}</td>
                      <td className="py-1.5 pr-2 text-xs text-gray-500">{r.to_name ?? r.to_email ?? "—"}{!r.to_email && <span className="ml-1 text-amber-700">(no e-mail: portal only)</span>}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold text-red-700">{money(r.balance)}<span className="ml-1 text-xs font-normal text-gray-400">of {money(r.due)}</span></td>
                      <td className="py-1.5 text-xs text-gray-500">{r.last_reminded ? `${new Date(r.last_reminded).toLocaleDateString("en-US", { month: "short", day: "numeric" })} (${r.reminders_sent}×)` : "never"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="grid gap-2">
                <label className="text-xs font-semibold text-gray-500">Subject
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!canSend} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-normal text-gray-800" />
                </label>
                <label className="text-xs font-semibold text-gray-500">Message
                  <textarea rows={7} value={message} onChange={(e) => setMessage(e.target.value)} disabled={!canSend} className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-normal text-gray-800" />
                </label>
                <p className="text-[11px] text-gray-400">Fill-ins: <code>{"{parent}"}</code> <code>{"{children}"}</code> <code>{"{month}"}</code> <code>{"{amount}"}</code>. The e-mail starts with "Assalamu Alaikum &lt;parent name&gt;," and ends with a link to the Family Portal.</p>
              </div>

              {preview && (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-sm">
                  <div className="mb-1 text-xs font-semibold text-gray-400">Preview — {preview.children}</div>
                  <div className="font-semibold text-navy">Falah Academy: {fill(subject, preview, month)}</div>
                  <div className="mt-1 text-gray-600">Assalamu Alaikum {preview.to_name ?? "Parent"},</div>
                  <div className="mt-1 whitespace-pre-wrap text-gray-700">{fill(message, preview, month)}</div>
                </div>
              )}

              {canSend ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={send} disabled={busy || !chosen.length || !subject.trim() || !message.trim()}
                    className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50">
                    {busy ? "Sending…" : `Send reminder to ${chosen.length} famil${chosen.length === 1 ? "y" : "ies"}`}
                  </button>
                  <button onClick={saveWording} disabled={!dirty} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-silver disabled:opacity-40">Save wording as default</button>
                  {dirty && <button onClick={() => { setSubject(saved.subject); setMessage(saved.message); }} className="text-xs text-gray-500 hover:text-navy">Undo changes</button>}
                </div>
              ) : (
                <p className="text-xs text-gray-500">Sending needs Fees: edit permission.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
