/* eslint-disable react-refresh/only-export-components */
// Digital admission forms (phase 18): Allergy Information, Medical
// Information and Photo/Video/Media Consent. One dialog component serves the
// admin Student Profile and the parent portal — read-only until "Edit", the
// signer types their name and the save is dated. RLS decides who may write.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { todayStr } from "../lib/dates";
import { usDate } from "../lib/format";

export type FormKind = "allergy" | "medical" | "consent";
export const FORM_TITLE: Record<FormKind, string> = {
  allergy: "Allergy Information",
  medical: "Medical Information",
  consent: "Photo, Video & Media Consent",
};
export const FORM_SHORT: Record<FormKind, string> = { allergy: "Allergy form", medical: "Medical form", consent: "Photo consent" };
// document_types rows that a completed digital form satisfies
export const FORM_DOC_TYPE: Record<string, FormKind[]> = {
  "Medical/Allergies Form": ["allergy", "medical"],
  "Photo, Video & Media Consent Form": ["consent"],
};

export interface MedicalRow {
  student_id: string;
  has_allergies: boolean | null; allergy_food: string | null; allergy_medication: string | null; allergy_other: string | null;
  allergy_reaction: string | null; dietary_restrictions: string | null;
  medical_conditions: string | null; medications: string | null; emergency_medication: string | null;
  physician_name: string | null; physician_phone: string | null; emergency_care_authorized: boolean | null;
  allergy_signed_by: string | null; allergy_signed_date: string | null;
  medical_signed_by: string | null; medical_signed_date: string | null;
  notes: string | null; updated_by: string | null; updated_at: string | null; reviewed_at: string | null;
}
export interface ConsentRow {
  student_id: string;
  internal_use: boolean | null; parent_comms: boolean | null; website_print: boolean | null;
  social_media: boolean | null; external_media: boolean | null;
  name_preference: string | null; signed_by: string | null; signed_date: string | null; notes: string | null;
  updated_by: string | null; updated_at: string | null; reviewed_at: string | null;
}
export const MEDICAL_COLS = "student_id, has_allergies, allergy_food, allergy_medication, allergy_other, allergy_reaction, dietary_restrictions, medical_conditions, medications, emergency_medication, physician_name, physician_phone, emergency_care_authorized, allergy_signed_by, allergy_signed_date, medical_signed_by, medical_signed_date, notes, updated_by, updated_at, reviewed_at";
export const CONSENT_COLS = "student_id, internal_use, parent_comms, website_print, social_media, external_media, name_preference, signed_by, signed_date, notes, updated_by, updated_at, reviewed_at";

const CONSENT_ITEMS: [keyof ConsentRow & ("internal_use" | "parent_comms" | "website_print" | "social_media" | "external_media"), string, string][] = [
  ["internal_use", "Internal school use", "classroom displays, student projects, internal presentations, staff use"],
  ["parent_comms", "Private parent communication", "school email, Family Portal, official class or announcement WhatsApp groups"],
  ["website_print", "Website & printed materials", "falahacademywa.org, newsletters, brochures, flyers, posters, event programs"],
  ["social_media", "Official social media", "Falah Academy Facebook, Instagram, YouTube or other official accounts"],
  ["external_media", "External community or news media", "community partners, newspapers, television, other news outlets"],
];

// ---------- status helpers ----------
export interface FormStatus { done: boolean; date: string | null; by: string | null; needsReview: boolean }
export function formStatus(kind: FormKind, med: MedicalRow | null | undefined, con: ConsentRow | null | undefined): FormStatus {
  const row = kind === "consent" ? con : med;
  const date = kind === "allergy" ? med?.allergy_signed_date : kind === "medical" ? med?.medical_signed_date : con?.signed_date;
  const by = kind === "allergy" ? med?.allergy_signed_by : kind === "medical" ? med?.medical_signed_by : con?.signed_by;
  const needsReview = !!row?.updated_at && (!row.reviewed_at || row.reviewed_at < row.updated_at);
  return { done: !!date, date: date ?? null, by: by ?? null, needsReview };
}
export function missingForms(med: MedicalRow | null | undefined, con: ConsentRow | null | undefined): FormKind[] {
  return (["allergy", "medical", "consent"] as FormKind[]).filter((k) => !formStatus(k, med, con).done);
}

// One-line verdict for the media-consent badge: what may staff do with this child's picture?
export function consentBadge(c: ConsentRow | null | undefined): { label: string; cls: string; title: string } {
  if (!c || !c.signed_date) return { label: "Media consent: not on file", cls: "bg-gray-200 text-gray-600", title: "No consent form recorded — treat as no permission." };
  const pub = [c.website_print, c.social_media, c.external_media];
  const allowed = CONSENT_ITEMS.filter(([k]) => c[k] === true).map(([, l]) => l);
  const title = allowed.length ? "Allowed: " + allowed.join(", ") : "No photo or video use permitted.";
  if (pub.every((v) => v === true)) return { label: "Photos OK: public", cls: "bg-green-100 text-green-700", title };
  if (pub.every((v) => v !== true)) {
    return c.internal_use || c.parent_comms
      ? { label: "No public photos", cls: "bg-red-100 text-red-700", title }
      : { label: "No photos at all", cls: "bg-red-100 text-red-700", title };
  }
  return { label: "Limited photo consent", cls: "bg-amber-100 text-amber-800", title };
}

// Short human summaries for cards
export function allergySummary(m: MedicalRow | null | undefined): string {
  if (!m || m.has_allergies == null) return "Not on file";
  if (!m.has_allergies) return "No known allergies" + (isYes(m.dietary_restrictions) ? ` · Dietary: ${m.dietary_restrictions}` : "");
  const parts = [m.allergy_food && `Food: ${m.allergy_food}`, m.allergy_medication && `Medication: ${m.allergy_medication}`, m.allergy_other && `Other: ${m.allergy_other}`].filter(Boolean);
  return (parts.join(" · ") || "Allergies: yes (not specified)") + (isYes(m.dietary_restrictions) ? ` · Dietary: ${m.dietary_restrictions}` : "");
}
export function medicalSummary(m: MedicalRow | null | undefined): string {
  if (!m || !m.medical_signed_date) return "Not on file";
  const parts = [
    isYes(m.medical_conditions) ? `Conditions: ${m.medical_conditions}` : "No medical conditions",
    isYes(m.medications) ? `School-hours medication: ${m.medications}` : "No school-hours medication",
    isYes(m.emergency_medication) ? `Emergency medication: ${m.emergency_medication}` : "No inhaler/EpiPen",
    m.physician_name ? `Physician: ${m.physician_name}${m.physician_phone ? " " + m.physician_phone : ""}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

// Yes/No-with-detail fields are stored as text: null = unanswered, "None" = No, anything else = Yes + detail
const NONE = "None";
function isYes(v: string | null | undefined) { return !!v && v.trim() !== "" && v.trim().toLowerCase() !== "none"; }
function yesNoOf(v: string | null | undefined): boolean | null { return v == null || v === "" ? null : isYes(v); }
function detailOf(v: string | null | undefined): string { return isYes(v) ? (v as string) : ""; }

// ---------- small inputs ----------
function YesNo({ value, onChange, disabled }: { value: boolean | null; onChange: (v: boolean) => void; disabled: boolean }) {
  const btn = (v: boolean, label: string) => (
    <button type="button" disabled={disabled} onClick={() => onChange(v)}
      className={`rounded-full px-3.5 py-1 text-xs font-bold transition ${
        value === v
          ? v ? "bg-emerald-brand text-white" : "bg-red-600 text-white"
          : "border border-gray-300 bg-white text-gray-500"} disabled:cursor-default disabled:opacity-80`}>
      {label}
    </button>
  );
  return <span className="inline-flex gap-1.5">{btn(true, "Yes")}{btn(false, "No")}</span>;
}
function Text({ value, onChange, disabled, placeholder, rows }: { value: string; onChange: (v: string) => void; disabled: boolean; placeholder?: string; rows?: number }) {
  const cls = "mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800 disabled:border-gray-200 disabled:bg-silver/40 disabled:text-gray-600";
  return rows
    ? <textarea disabled={disabled} rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />
    : <input disabled={disabled} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={cls} />;
}
function Q({ n, label, hint, children }: { n?: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-silver/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-navy">{n && <span className="mr-1.5 text-gray-400">{n}.</span>}{label}</div>
        {children}
      </div>
      {hint && <div className="mt-0.5 text-xs text-gray-400">{hint}</div>}
    </div>
  );
}

// ---------- the dialog ----------
export function StudentFormDialog({ kind, studentId, studentName, isAdmin, signerName, onClose, onSaved }: {
  kind: FormKind; studentId: string; studentName: string; isAdmin: boolean; signerName: string;
  onClose: () => void; onSaved?: () => void;
}) {
  const [med, setMed] = useState<MedicalRow | null>(null);
  const [con, setCon] = useState<ConsentRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // drafts (kept as simple local fields so the paper-form wording maps 1:1)
  const [hasAllergies, setHasAllergies] = useState<boolean | null>(null);
  const [food, setFood] = useState(""); const [medAllergy, setMedAllergy] = useState(""); const [other, setOther] = useState("");
  const [reaction, setReaction] = useState("");
  const [dietYes, setDietYes] = useState<boolean | null>(null); const [diet, setDiet] = useState("");
  const [condYes, setCondYes] = useState<boolean | null>(null); const [cond, setCond] = useState("");
  const [medsYes, setMedsYes] = useState<boolean | null>(null); const [meds, setMeds] = useState("");
  const [emYes, setEmYes] = useState<boolean | null>(null); const [em, setEm] = useState("");
  const [physName, setPhysName] = useState(""); const [physPhone, setPhysPhone] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [consent, setConsent] = useState<Record<string, boolean | null>>({});
  const [namePref, setNamePref] = useState("");
  const [notes, setNotes] = useState("");
  const [signedBy, setSignedBy] = useState(""); const [signedDate, setSignedDate] = useState("");

  async function load() {
    const [{ data: m }, { data: c }] = await Promise.all([
      supabase.from("medical_info").select(MEDICAL_COLS).eq("student_id", studentId).maybeSingle(),
      supabase.from("media_consent").select(CONSENT_COLS).eq("student_id", studentId).maybeSingle(),
    ]);
    const mr = (m as unknown as MedicalRow | null) ?? null, cr = (c as unknown as ConsentRow | null) ?? null;
    setMed(mr); setCon(cr);
    // fill drafts from the saved row
    setHasAllergies(mr?.has_allergies ?? null);
    setFood(mr?.allergy_food ?? ""); setMedAllergy(mr?.allergy_medication ?? ""); setOther(mr?.allergy_other ?? "");
    setReaction(mr?.allergy_reaction ?? "");
    setDietYes(yesNoOf(mr?.dietary_restrictions)); setDiet(detailOf(mr?.dietary_restrictions));
    setCondYes(yesNoOf(mr?.medical_conditions)); setCond(detailOf(mr?.medical_conditions));
    setMedsYes(yesNoOf(mr?.medications)); setMeds(detailOf(mr?.medications));
    setEmYes(yesNoOf(mr?.emergency_medication)); setEm(detailOf(mr?.emergency_medication));
    setPhysName(mr?.physician_name ?? ""); setPhysPhone(mr?.physician_phone ?? "");
    setAuthorized(mr?.emergency_care_authorized ?? false);
    setConsent({ internal_use: cr?.internal_use ?? null, parent_comms: cr?.parent_comms ?? null, website_print: cr?.website_print ?? null, social_media: cr?.social_media ?? null, external_media: cr?.external_media ?? null });
    setNamePref(cr?.name_preference ?? "");
    setNotes(kind === "consent" ? cr?.notes ?? "" : mr?.notes ?? "");
    const st = formStatus(kind, mr, cr);
    setSignedBy(st.by ?? (isAdmin ? "" : signerName));
    setSignedDate(st.date ?? todayStr());
    setEdit(!st.done);             // a blank form opens ready to fill
    setLoaded(true);
  }
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [studentId, kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const status = formStatus(kind, med, con);
  const yn = (yes: boolean | null, detail: string) => yes == null ? null : yes ? (detail.trim() || "Yes") : NONE;

  async function save() {
    if (busy) return;
    setBusy(true);
    try { await doSave(); } finally { setBusy(false); }
  }
  async function doSave() {
    setMsg(null);
    if (!signedBy.trim()) return setMsg("Please type the parent/guardian name as signature.");
    const date = isAdmin ? (signedDate || todayStr()) : todayStr();
    let error: { message: string } | null = null;
    if (kind === "consent") {
      if (Object.values(consent).some((v) => v == null)) return setMsg("Please answer Yes or No in every row.");
      if (!namePref) return setMsg("Please choose the public name preference.");
      const row = { student_id: studentId, ...consent, name_preference: namePref, notes: notes.trim() || null,
        signed_by: signedBy.trim(), signed_date: date, ...(isAdmin ? { reviewed_at: new Date().toISOString() } : {}) };
      ({ error } = await supabase.from("media_consent").upsert(row, { onConflict: "student_id" }));
    } else {
      const row: Record<string, unknown> = { student_id: studentId, notes: notes.trim() || null };
      if (kind === "allergy") {
        if (hasAllergies == null) return setMsg("Please answer whether your child has any known allergies.");
        if (hasAllergies && !food.trim() && !medAllergy.trim() && !other.trim()) return setMsg("Please list the allergy (food, medication or other).");
        if (dietYes == null) return setMsg("Please answer the dietary restrictions question.");
        Object.assign(row, {
          has_allergies: hasAllergies,
          allergy_food: hasAllergies ? food.trim() || null : null,
          allergy_medication: hasAllergies ? medAllergy.trim() || null : null,
          allergy_other: hasAllergies ? other.trim() || null : null,
          allergy_reaction: hasAllergies ? reaction.trim() || null : null,
          dietary_restrictions: yn(dietYes, diet),
          allergy_signed_by: signedBy.trim(), allergy_signed_date: date,
        });
      } else {
        if (condYes == null || medsYes == null || emYes == null) return setMsg("Please answer Yes or No to questions 1–3.");
        if (!isAdmin && !authorized) return setMsg("Please tick the emergency-care authorization to submit.");
        Object.assign(row, {
          medical_conditions: yn(condYes, cond), medications: yn(medsYes, meds), emergency_medication: yn(emYes, em),
          physician_name: physName.trim() || null, physician_phone: physPhone.trim() || null,
          emergency_care_authorized: authorized,
          medical_signed_by: signedBy.trim(), medical_signed_date: date,
        });
      }
      if (isAdmin) row.reviewed_at = new Date().toISOString();
      ({ error } = await supabase.from("medical_info").upsert(row, { onConflict: "student_id" }));
    }
    if (error) return setMsg("Could not save: " + error.message);
    await load();
    setMsg("Saved.");
    onSaved?.();
  }

  async function markReviewed() {
    const table = kind === "consent" ? "media_consent" : "medical_info";
    await supabase.from(table).update({ reviewed_at: new Date().toISOString() }).eq("student_id", studentId);
    await load(); onSaved?.();
  }

  const dis = !edit;
  const label = "block text-xs font-semibold uppercase tracking-wide text-gray-400";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h3 className="font-display text-lg font-semibold text-navy">{FORM_TITLE[kind]}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>{studentName} · Academic year 2026–2027</span>
              {status.done
                ? <span className="rounded-full bg-green-100 px-2 py-0.5 font-semibold text-green-700">Completed {usDate(status.date)}{status.by ? ` · ${status.by}` : ""}</span>
                : <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">Not completed</span>}
              {isAdmin && status.done && status.needsReview && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-700">Updated by parent — review</span>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-gray-400 hover:bg-silver hover:text-navy">✕</button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {!loaded && <p className="text-gray-400">Loading…</p>}

          {loaded && kind === "allergy" && (
            <>
              <Q n="1" label="Does your child have any known allergies?"><YesNo value={hasAllergies} onChange={setHasAllergies} disabled={dis} /></Q>
              {hasAllergies && (
                <div className="space-y-2 rounded-xl border border-red-100 bg-red-50/40 p-3">
                  <label className={label}>Food allergy — list specific foods<Text disabled={dis} value={food} onChange={setFood} placeholder="e.g. peanuts, eggs" /></label>
                  <label className={label}>Medication allergy<Text disabled={dis} value={medAllergy} onChange={setMedAllergy} placeholder="e.g. penicillin" /></label>
                  <label className={label}>Other allergy<Text disabled={dis} value={other} onChange={setOther} placeholder="e.g. bee stings, latex" /></label>
                  <label className={label}>Reaction and necessary treatment<Text disabled={dis} rows={2} value={reaction} onChange={setReaction} placeholder="What happens and what should staff do" /></label>
                </div>
              )}
              <Q n="2" label="Dietary restrictions or food sensitivities?"><YesNo value={dietYes} onChange={setDietYes} disabled={dis} /></Q>
              {dietYes && <label className={label}>Please specify<Text disabled={dis} value={diet} onChange={setDiet} placeholder="e.g. no pork gelatin, lactose intolerant" /></label>}
            </>
          )}

          {loaded && kind === "medical" && (
            <>
              <Q n="1" label="Any medical conditions we should be aware of?"><YesNo value={condYes} onChange={setCondYes} disabled={dis} /></Q>
              {condYes && <label className={label}>Please describe<Text disabled={dis} rows={2} value={cond} onChange={setCond} /></label>}
              <Q n="2" label="Does your child require medication during school hours?"><YesNo value={medsYes} onChange={setMedsYes} disabled={dis} /></Q>
              {medsYes && <label className={label}>Medication and instructions<Text disabled={dis} rows={2} value={meds} onChange={setMeds} /></label>}
              <Q n="3" label="Emergency medication such as an inhaler or EpiPen?"><YesNo value={emYes} onChange={setEmYes} disabled={dis} /></Q>
              {emYes && <label className={label}>Details and instructions<Text disabled={dis} rows={2} value={em} onChange={setEm} /></label>}
              <div className="grid gap-2 sm:grid-cols-2">
                <label className={label}>Physician / doctor<Text disabled={dis} value={physName} onChange={setPhysName} placeholder="Clinic or doctor's name" /></label>
                <label className={label}>Physician phone<Text disabled={dis} value={physPhone} onChange={setPhysPhone} placeholder="(555) 123-4567" /></label>
              </div>
              <label className="flex items-start gap-2 rounded-xl border border-gold/40 bg-gold/10 p-3 text-xs text-gray-700">
                <input type="checkbox" disabled={dis} checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-0.5" />
                <span>I certify that this information is accurate and complete and that it is my responsibility to update Falah Academy with any changes. <b>In the event of a medical emergency, I authorize Falah Academy staff to seek appropriate medical care for my child if I cannot be reached immediately.</b></span>
              </label>
            </>
          )}

          {loaded && kind === "consent" && (
            <>
              <p className="text-xs text-gray-500">Falah Academy may photograph or record students during classroom activities, presentations, Islamic programs, celebrations, field trips, graduation and other school events. This also covers student artwork, projects and short quotations. Check one answer in each row.</p>
              {CONSENT_ITEMS.map(([k, l, hint]) => (
                <Q key={k} label={l} hint={hint}>
                  <YesNo value={consent[k] ?? null} onChange={(v) => setConsent({ ...consent, [k]: v })} disabled={dis} />
                </Q>
              ))}
              <div className="rounded-xl border border-royal/30 bg-royal/5 p-3">
                <div className="text-sm font-semibold text-navy">Public name preference</div>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                  {[["none", "Do not use the student's name"], ["first_name", "First name only"]].map(([v, l]) => (
                    <label key={v} className="flex items-center gap-1.5">
                      <input type="radio" name="namepref" disabled={dis} checked={namePref === v} onChange={() => setNamePref(v)} /> {l}
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-gray-400">Falah Academy will not publish a student's full name together with a recognizable image in public materials.</div>
              </div>
              <p className="text-[11px] text-gray-400">Permission is voluntary and does not affect enrollment. Consent is valid for the 2026–2027 academic year unless withdrawn here or in writing at falahacademywa@gmail.com. Withdrawal applies to future use.</p>
            </>
          )}

          {loaded && (
            <>
              {(isAdmin || notes) && <label className={label}>Notes{isAdmin ? " (office)" : ""}<Text disabled={dis || !isAdmin} value={notes} onChange={setNotes} /></label>}
              <div className="grid gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-2">
                <label className={label}>Parent / guardian signature (type full name)<Text disabled={dis} value={signedBy} onChange={setSignedBy} placeholder="Full name" /></label>
                <label className={label}>Date
                  {isAdmin
                    ? <input type="date" disabled={dis} value={signedDate} onChange={(e) => setSignedDate(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm text-gray-800 disabled:border-gray-200 disabled:bg-silver/40 disabled:text-gray-600" />
                    : <div className="mt-1 rounded-lg border border-gray-200 bg-silver/40 p-2 text-sm text-gray-600">{usDate(edit ? todayStr() : (status.date ?? todayStr()))}</div>}
                </label>
              </div>
              {med?.updated_at && kind !== "consent" && <p className="text-[11px] text-gray-400">Last updated {new Date(med.updated_at).toLocaleString()}</p>}
              {con?.updated_at && kind === "consent" && <p className="text-[11px] text-gray-400">Last updated {new Date(con.updated_at).toLocaleString()}</p>}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
          {edit ? (
            <>
              <button onClick={save} disabled={busy}
                className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-40">
                {busy ? "Saving…" : status.done ? "Save changes" : "Submit form"}
              </button>
              {status.done && <button onClick={() => { load(); setMsg(null); }} className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>}
            </>
          ) : (
            <button onClick={() => { setEdit(true); setMsg(null); }}
              className="flex items-center gap-1 rounded-full border-2 border-royal px-4 py-1.5 text-sm font-bold text-royal hover:bg-royal hover:text-white">✏️ Edit</button>
          )}
          {isAdmin && status.done && status.needsReview && !edit && (
            <button onClick={markReviewed} className="rounded-full border border-emerald-brand px-4 py-1.5 text-sm font-semibold text-emerald-deep hover:bg-emerald-brand hover:text-white">✓ Mark reviewed</button>
          )}
          {msg && <span className={`text-xs ${msg.startsWith("Saved") ? "font-semibold text-emerald-deep" : "text-red-600"}`}>{msg}</span>}
          <button onClick={onClose} className="ml-auto text-sm text-gray-400 hover:text-navy">Close</button>
        </div>
      </div>
    </div>
  );
}
