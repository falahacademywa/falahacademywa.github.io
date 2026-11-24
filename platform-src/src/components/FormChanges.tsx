// "What did the parent change?" (President 2026-11-23). On the student profile, for full admins and
// staff with the Health & consent permission: every change to the health form (allergy + medical)
// and the photo-consent form since it was last reviewed, field by field, with who and when, and a
// "Mark reviewed" button. Data: form_changes() / form_mark_reviewed() (phase 50), read from the audit trail.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { FormKind, MedicalRow, ConsentRow } from "./StudentForms";

interface Change { form: "medical" | "consent"; changed_at: string; changed_by: string; changed_by_role: string; kind: string;
  changes: { field: string; old: unknown; new: unknown }[] }

export const needsReview = (row: { updated_at: string | null; reviewed_at: string | null } | null | undefined) =>
  !!row?.updated_at && (!row.reviewed_at || row.reviewed_at < row.updated_at);

const LABEL: Record<string, string> = {
  has_allergies: "Known allergies", allergy_food: "Food allergy", allergy_medication: "Medication allergy", allergy_other: "Other allergy",
  allergy_reaction: "Reaction and treatment", dietary_restrictions: "Dietary restrictions", medical_conditions: "Medical conditions",
  medications: "Medication during school hours", emergency_medication: "Emergency medication (inhaler, EpiPen)",
  physician_name: "Doctor", physician_phone: "Doctor's phone", emergency_care_authorized: "Emergency care authorised",
  allergy_signed_by: "Allergy form signed by", allergy_signed_date: "Allergy form date", medical_signed_by: "Medical form signed by",
  medical_signed_date: "Medical form date", notes: "Notes",
  internal_use: "Internal school use", parent_comms: "Private parent communication", website_print: "Website and printed materials",
  social_media: "Official social media", external_media: "External / news media", name_preference: "Public name",
  signed_by: "Signed by", signed_date: "Date signed",
};
// safety-relevant answers are shown first and in red
const SAFETY = new Set(["has_allergies", "allergy_food", "allergy_medication", "allergy_other", "allergy_reaction", "medical_conditions",
  "medications", "emergency_medication", "dietary_restrictions"]);
const ORDER = Object.keys(LABEL);

function show(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (field === "name_preference") return v === "none" ? "Do not use the name" : v === "first_name" ? "First name only" : v === "full_name" ? "Full name" : String(v);
  if (typeof v === "string" && v.trim().toLowerCase() === "none") return "No";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return String(v);
}
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const ROLE: Record<string, string> = { parent: "parent", admin: "office", staff: "office", teacher: "teacher", system: "system" };

export default function FormChanges({ studentId, firstName, med, consent, canEdit, onOpen, onReviewed }: {
  studentId: string; firstName: string; med: MedicalRow | null; consent: ConsentRow | null; canEdit: boolean;
  onOpen: (k: FormKind) => void; onReviewed: () => void;
}) {
  const due = { medical: needsReview(med), consent: needsReview(consent) };
  const [rows, setRows] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!due.medical && !due.consent) { setRows([]); return; }
    supabase.rpc("form_changes", { p_student: studentId }).then(({ data, error }) => {
      if (error) { setErr(error.message.includes("form_changes") ? "The change history needs a database update (phase 50)." : error.message); setRows([]); return; }
      setRows((data as Change[]) ?? []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, med?.updated_at, med?.reviewed_at, consent?.updated_at, consent?.reviewed_at]);

  if (!due.medical && !due.consent) return null;

  async function reviewed(form: "medical" | "consent") {
    setBusy(form); setErr(null);
    const { error } = await supabase.rpc("form_mark_reviewed", { p_student: studentId, p_form: form });
    setBusy(null);
    if (error) return setErr("Could not mark reviewed: " + error.message);
    onReviewed();
  }

  const forms = (["medical", "consent"] as const).filter((f) => due[f]);
  return (
    <section className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
      <h2 className="font-display text-lg font-semibold text-amber-900">⚠ Changed by a parent — please review</h2>
      <p className="mt-0.5 text-xs text-amber-800">Everything changed in {firstName}'s forms since they were last reviewed. Answers that matter for safety are in red.</p>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {forms.map((f) => {
        const list = (rows ?? []).filter((r) => r.form === f);
        return (
          <div key={f} className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-semibold text-navy">{f === "medical" ? "Health form (allergy and medical)" : "Photo, video and media consent"}</div>
              <span className="ml-auto flex gap-2">
                {(f === "medical" ? [["allergy", "Allergy form"], ["medical", "Medical form"]] as const : [["consent", "Open form"]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => onOpen(k)}
                    className="rounded-full border border-royal px-3 py-1 text-xs font-semibold text-royal hover:bg-royal hover:text-white">{l}</button>
                ))}
                {canEdit && <button onClick={() => reviewed(f)} disabled={busy === f}
                  className="rounded-full bg-emerald-brand px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-deep disabled:opacity-50">{busy === f ? "Saving…" : "✓ Mark reviewed"}</button>}
              </span>
            </div>
            {rows === null && <p className="mt-2 text-xs text-gray-400">Loading the changes…</p>}
            {rows !== null && !list.length && <p className="mt-2 text-xs text-gray-500">No field-by-field record of this change (it was made before the change history started). Open the form to see the answers.</p>}
            {list.map((c, i) => {
              const ch = [...c.changes].sort((a, b) => (SAFETY.has(b.field) ? 1 : 0) - (SAFETY.has(a.field) ? 1 : 0) || ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
              return (
                <div key={i} className="mt-2 border-t pt-2 first:border-0 first:pt-0">
                  <div className="text-xs text-gray-500">
                    {c.kind === "insert" ? "Filled in" : c.kind === "delete" ? "Removed" : "Changed"} by <b className="text-gray-700">{c.changed_by}</b>
                    {ROLE[c.changed_by_role] ? ` (${ROLE[c.changed_by_role]})` : ""} · {when(c.changed_at)}
                  </div>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {ch.map((x) => (
                      <li key={x.field} className={SAFETY.has(x.field) && show(x.field, x.new) !== "No" && show(x.field, x.new) !== "—" ? "text-red-700" : "text-gray-800"}>
                        <span className="font-semibold">{LABEL[x.field] ?? x.field}:</span>{" "}
                        {c.kind === "insert" ? show(x.field, x.new) : <>{show(x.field, x.old)} <span className="text-gray-400">→</span> <b>{show(x.field, x.new)}</b></>}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
