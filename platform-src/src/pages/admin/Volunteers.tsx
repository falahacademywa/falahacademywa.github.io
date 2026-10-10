// Admin → Volunteers (phase 22). Applications arrive from volunteer.html on the
// public website; the office works each one through references, the WATCH
// check, the registry check, orientation and the signed agreement, then
// approves or declines. Every admin is alerted when a new one lands.
import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { usDate, usPhone } from "../../lib/format";
import { localDateStr } from "../../lib/dates";

interface Ref { name: string; relationship: string; phone: string; email: string }
interface Row {
  id: string; full_name: string; preferred_name: string | null; gender: "male" | "female" | null; email: string; phone: string | null;
  address: string | null; city: string | null; state: string | null; zip: string | null;
  date_of_birth: string | null; under_18: boolean; guardian_name: string | null; guardian_phone: string | null;
  availability: Record<string, string[] | boolean>; start_date: string | null; hours_per_week: string | null;
  interests: string[]; experience: string | null; languages: string | null; first_aid: boolean | null; prior_volunteering: string | null;
  references_info: Ref[]; disclosures: { convicted?: boolean; abuse_finding?: boolean; registry?: boolean; explanation?: string | null };
  status: string; checks: Record<string, string>; assigned_grade_id: number | null; notes: string | null;
  resume_path: string | null; created_at: string; resolved_at: string | null;
}

// private bucket: a short-lived signed link, opened in a new tab
async function openResume(path: string, onErr: (m: string) => void) {
  const { data, error } = await supabase.storage.from("volunteer-docs").createSignedUrl(path, 600);
  if (error || !data?.signedUrl) return onErr("Could not open the résumé: " + (error?.message ?? "no link"));
  window.open(data.signedUrl, "_blank", "noopener");
}
interface Grade { id: number; name: string }

const STATUSES: [string, string][] = [
  ["new", "New"], ["contacted", "Contacted"], ["screening", "Screening"], ["approved", "Approved"],
  ["active", "Active"], ["declined", "Declined"], ["withdrawn", "Withdrawn"],
];
const statusStyles: Record<string, string> = {
  new: "bg-amber-100 text-amber-800", contacted: "bg-blue-100 text-blue-700", screening: "bg-violet-100 text-violet-700",
  approved: "bg-emerald-100 text-emerald-deep", active: "bg-emerald-brand text-white", declined: "bg-red-100 text-red-700",
  withdrawn: "bg-gray-200 text-gray-600",
};
// the screening steps from the Volunteer Background Check Procedure; each holds the date it was done
const CHECKS: [string, string][] = [
  ["ref1", "Reference 1 spoken to"], ["ref2", "Reference 2 spoken to"], ["watch", "WATCH check saved"],
  ["registry", "nsopw.gov search saved"], ["orientation", "Orientation done"], ["agreement", "Volunteer Agreement signed"],
];
const DAYS: [string, string][] = [["mon", "Mon"], ["tue", "Tue"], ["wed", "Wed"], ["thu", "Thu"]];

function availText(a: Row["availability"]) {
  const parts = DAYS.map(([k, l]) => { const v = a?.[k]; return Array.isArray(v) && v.length ? `${l} ${v.map((x) => x.toUpperCase()).join("/")}` : null; }).filter(Boolean);
  if (a?.events) parts.push("Events");
  return parts.length ? parts.join(" · ") : "not given";
}
function ageYears(dob: string | null) {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00"), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}

export default function Volunteers() {
  const { can, session } = useAuth();
  const editable = can("volunteers", "edit");
  const [rows, setRows] = useState<Row[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [filter, setFilter] = useState<string>("open");
  const [open, setOpen] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data, error }, { data: g }] = await Promise.all([
      supabase.from("volunteer_applications").select("*").order("created_at", { ascending: false }),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
    ]);
    if (error) setMsg("Could not load: " + error.message + (error.message.includes("volunteer_applications") ? " — run platform_schema_phase22.sql" : ""));
    setRows((data as Row[]) ?? []);
    setGrades((g as Grade[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) =>
    filter === "all" ? true : filter === "open" ? !["declined", "withdrawn", "active"].includes(r.status) : r.status === filter), [rows, filter]);

  async function setStatus(r: Row, status: string) {
    const done = ["approved", "active", "declined", "withdrawn"].includes(status);
    const { error } = await supabase.from("volunteer_applications")
      .update({ status, ...(done ? { resolved_at: new Date().toISOString(), resolved_by: session?.user.id ?? null } : {}) }).eq("id", r.id);
    if (error) return setMsg("Could not update: " + error.message);
    setMsg(`${r.full_name} → ${STATUSES.find(([v]) => v === status)?.[1]}`);
    if (open?.id === r.id) setOpen({ ...open, status });
    load();
  }

  async function saveDetails(r: Row, patch: Partial<Row>) {
    const { error } = await supabase.from("volunteer_applications").update(patch).eq("id", r.id);
    if (error) return setMsg("Save failed: " + error.message);
    setMsg("Saved."); load();
  }

  async function remove(r: Row) {
    if (!confirm(`Delete the application from ${r.full_name}? This cannot be undone.`)) return;
    const { error } = await supabase.from("volunteer_applications").delete().eq("id", r.id);
    if (error) return setMsg("Delete failed: " + error.message);
    setOpen(null); load();
  }

  const checksDone = (r: Row) => CHECKS.filter(([k]) => r.checks?.[k]).length;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Volunteers</h1>
        <div className="flex flex-wrap gap-1.5">
          {[["open", "Open"], ["all", "All"], ...STATUSES].map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === v ? "bg-navy text-white" : "border border-gray-300 bg-white text-gray-600"}`}>
              {label} ({v === "all" ? rows.length : v === "open" ? rows.filter((r) => !["declined", "withdrawn", "active"].includes(r.status)).length : rows.filter((r) => r.status === v).length})
            </button>
          ))}
        </div>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Applications from <b>falahacademywa.org/volunteer.html</b>. Work each one through the six screening steps (Background Check Procedure), then Approve.
        A volunteer is never alone with a student; the checks are the second safeguard.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-silver p-3 text-sm text-gray-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="space-y-3">
        {filtered.map((r) => {
          const age = ageYears(r.date_of_birth);
          const flagged = r.disclosures?.convicted || r.disclosures?.abuse_finding || r.disclosures?.registry;
          return (
            <div key={r.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setOpen(r)} className="font-semibold text-navy hover:text-royal hover:underline">{r.full_name}</button>
                  {r.preferred_name && <span className="text-sm text-gray-400">“{r.preferred_name}”</span>}
                  {r.gender && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.gender === "female" ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700"}`}>{r.gender === "female" ? "F" : "M"}</span>}
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[r.status] ?? "bg-gray-100"}`}>{STATUSES.find(([v]) => v === r.status)?.[1] ?? r.status}</span>
                  {r.under_18 && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Under 18 · parent consent</span>}
                  {flagged && <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Disclosure — read before contacting</span>}
                  {r.resume_path && (
                    <button onClick={() => openResume(r.resume_path!, setMsg)} title="Open the attached résumé"
                      className="inline-flex items-center gap-1 rounded-full bg-royal/10 px-2.5 py-0.5 text-xs font-semibold text-royal hover:bg-royal/20">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                      Résumé
                    </button>
                  )}
                  {!["declined", "withdrawn"].includes(r.status) && (
                    <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs text-navy" title={CHECKS.map(([k, l]) => `${r.checks?.[k] ? "✓" : "○"} ${l}`).join("\n")}>
                      {checksDone(r)}/{CHECKS.length} checks
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400">Applied {usDate(localDateStr(r.created_at))}</div>
              </div>
              <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
                <div>{r.phone ? usPhone(r.phone) : "—"} · {r.email}</div>
                <div>{r.city ?? "—"}{age != null ? <span className="text-gray-400"> · {age} yrs</span> : null}</div>
                <div className="lg:col-span-2">Available: {availText(r.availability)}{r.hours_per_week ? ` · ${r.hours_per_week}` : ""}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {r.interests.map((i) => <span key={i} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-deep">{i}</span>)}
              </div>
              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                  <button onClick={() => setOpen(r)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-silver">Details & checks</button>
                  <div className="ml-auto flex flex-wrap gap-2">
                    {r.status === "new" && <button onClick={() => setStatus(r, "contacted")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Contacted</button>}
                    {["new", "contacted"].includes(r.status) && <button onClick={() => setStatus(r, "screening")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Screening</button>}
                    {["new", "contacted", "screening"].includes(r.status) && (
                      <button onClick={() => { if (checksDone(r) < CHECKS.length && !confirm(`Only ${checksDone(r)} of ${CHECKS.length} checks are dated. Approve anyway?`)) return; setStatus(r, "approved"); }}
                        className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">Approve</button>
                    )}
                    {r.status === "approved" && <button onClick={() => setStatus(r, "active")} className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">Started → Active</button>}
                    {!["declined", "withdrawn"].includes(r.status) && <button onClick={() => setStatus(r, "declined")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Decline</button>}
                    {["declined", "withdrawn"].includes(r.status) && <button onClick={() => setStatus(r, "new")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Reopen</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {!configMissing && !filtered.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No volunteer applications in this view. New ones from the website appear here and alert every admin.
          </p>
        )}
      </div>

      {open && <VolunteerDialog r={open} grades={grades} editable={editable} onClose={() => setOpen(null)}
        onSave={(patch) => saveDetails(open, patch)} onStatus={(s) => setStatus(open, s)} onDelete={() => remove(open)} onErr={setMsg} />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-gray-800">{children ?? "—"}</div>
    </div>
  );
}

function VolunteerDialog({ r, grades, editable, onClose, onSave, onStatus, onDelete, onErr }: {
  r: Row; grades: Grade[]; editable: boolean; onClose: () => void;
  onSave: (patch: Partial<Row>) => void; onStatus: (s: string) => void; onDelete: () => void; onErr: (m: string) => void;
}) {
  const [checks, setChecks] = useState<Record<string, string>>(r.checks ?? {});
  const [notes, setNotes] = useState(r.notes ?? "");
  const [grade, setGrade] = useState<number | "">(r.assigned_grade_id ?? "");
  const d = r.disclosures ?? {};
  const yn = (b: boolean | undefined) => (b ? <span className="font-semibold text-red-700">Yes</span> : "No");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-navy">{r.full_name}</h2>
            <div className="text-xs text-gray-400">Applied {usDate(localDateStr(r.created_at))} · {r.email} · {r.phone ? usPhone(r.phone) : "no phone"}</div>
          </div>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[r.status] ?? ""}`}>{STATUSES.find(([v]) => v === r.status)?.[1]}</span>
        </div>

        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Field label="Preferred name">{r.preferred_name}</Field>
          <Field label="Gender">{r.gender ? (r.gender === "female" ? "Female" : "Male") : null}</Field>
          <Field label="Date of birth">{r.date_of_birth ? `${usDate(r.date_of_birth)} (${ageYears(r.date_of_birth)} yrs)` : null}</Field>
          <Field label="Address">{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || null}</Field>
          <Field label="Availability">{availText(r.availability)}{r.start_date ? ` · from ${usDate(r.start_date)}` : ""}{r.hours_per_week ? ` · ${r.hours_per_week}` : ""}</Field>
          {r.under_18 && <Field label="Parent / guardian">{r.guardian_name} · {r.guardian_phone ? usPhone(r.guardian_phone) : "—"}</Field>}
          <Field label="Interests">{r.interests.join(", ") || null}</Field>
          <div className="sm:col-span-2"><Field label="Experience">{r.experience}</Field></div>
          <Field label="Languages">{r.languages}</Field>
          <Field label="First aid / CPR">{r.first_aid == null ? null : r.first_aid ? "Yes" : "No"}</Field>
          <div className="sm:col-span-2"><Field label="Other schools or masjids">{r.prior_volunteering}</Field></div>
          {(r.references_info ?? []).map((ref, i) => (
            <Field key={i} label={`Reference ${i + 1}`}>{ref.name}{ref.relationship ? ` (${ref.relationship})` : ""}{ref.phone ? ` · ${usPhone(ref.phone)}` : ""}{ref.email ? ` · ${ref.email}` : ""}</Field>
          ))}
          <div className="sm:col-span-2 rounded-lg bg-silver p-3 text-sm">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Disclosures</div>
            <div className="grid gap-1 sm:grid-cols-3">
              <div>Convicted: {yn(d.convicted)}</div><div>Abuse finding: {yn(d.abuse_finding)}</div><div>Registry: {yn(d.registry)}</div>
            </div>
            {d.explanation && <p className="mt-1 whitespace-pre-wrap text-gray-700">{d.explanation}</p>}
          </div>
        </div>

        <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-gray-400">Screening checks (date done)</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {CHECKS.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm">
              <span className={checks[k] ? "text-emerald-deep" : "text-gray-700"}>{checks[k] ? "✓ " : ""}{label}</span>
              <input type="date" value={checks[k] ?? ""} disabled={!editable}
                onChange={(e) => setChecks({ ...checks, [k]: e.target.value })} className="rounded border border-gray-300 px-2 py-0.5 text-xs" />
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr]">
          <label className="text-xs text-gray-500">Assigned class
            <select value={grade} disabled={!editable} onChange={(e) => setGrade(e.target.value === "" ? "" : Number(e.target.value))} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm">
              <option value="">—</option>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Office notes (reference answers, decision reasoning)
            <textarea value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm" />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">WATCH result, registry screenshot and the signed agreement go in the volunteer's folder on OneDrive (16_Employees / 00. Volunteers), not here.</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {editable && (
            <button onClick={() => onSave({ checks, notes: notes.trim() || null, assigned_grade_id: grade === "" ? null : grade })}
              className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Save</button>
          )}
          {editable && ["new", "contacted", "screening"].includes(r.status) && (
            <button onClick={() => onStatus("approved")} className="rounded-lg bg-emerald-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-deep">Approve</button>
          )}
          {editable && r.status === "approved" && (
            <button onClick={() => onStatus("active")} className="rounded-lg bg-emerald-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-deep">Started → Active</button>
          )}
          {editable && <button onClick={() => onStatus("withdrawn")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-silver">Withdrawn</button>}
          <a href={`mailto:${r.email}`} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-navy hover:bg-silver">E-mail</a>
          {r.resume_path && (
            <button onClick={() => openResume(r.resume_path!, onErr)} className="inline-flex items-center gap-1.5 rounded-lg border border-royal/40 px-3 py-1.5 text-sm font-semibold text-royal hover:bg-royal/10">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
              Open résumé
            </button>
          )}
          <div className="ml-auto flex gap-2">
            {editable && <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-600">Delete</button>}
            <button onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-silver">Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
