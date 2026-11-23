// Which electronic forms each active student has (President 2026-11-22). "Missing forms" on the
// Dashboard and Students → Forms count what is on file in the portal, filled in by the parent or
// entered by the office from the paper form. Paper documents (birth certificate, immunization,
// choice transfer) are no longer counted: almost no student has a scan of those, so the old count
// was simply "every student".
import { supabase } from "./supabase";

export type EKey = "primary" | "emergency" | "allergy" | "medical" | "consent";
// `paper` = the required-document type this replaces; `health` = needs the Health & consent permission
export const E_FORMS: { key: EKey; label: string; title: string; health: boolean; paper: string }[] = [
  { key: "primary", label: "Primary contact", title: "A parent or guardian with a phone number is on file", health: false, paper: "Primary Contact Information" },
  { key: "emergency", label: "Emergency contact", title: "At least one emergency contact is on file", health: false, paper: "Emergency Contact Information" },
  { key: "allergy", label: "Allergy form", title: "Allergy Information form completed", health: true, paper: "Medical/Allergies Form" },
  { key: "medical", label: "Medical form", title: "Medical Information form completed", health: true, paper: "Medical/Allergies Form" },
  { key: "consent", label: "Photo consent", title: "Photo, Video & Media Consent form completed", health: true, paper: "Photo, Video & Media Consent Form" },
];
export const PAPER_WITH_FORM = new Set(E_FORMS.map((f) => f.paper));

export interface FormStudent {
  id: string; student_no: number; first_name: string; last_name: string; grade: string;
  docs: { document_type: string; storage_path: string | null; file_url: string | null }[];
  has: Record<EKey, boolean>;
}
// a login without the Health & consent permission cannot read those three forms, so they are left out for it
export const formsFor = (canHealth: boolean) => E_FORMS.filter((f) => canHealth || !f.health);
export const missingOf = (s: FormStudent, canHealth: boolean) => formsFor(canHealth).filter((f) => !s.has[f.key]);

// every student who is not archived and has an active enrolment
export async function loadFormStudents(canHealth: boolean): Promise<FormStudent[]> {
  const [{ data: st }, med, con] = await Promise.all([
    supabase.from("students")
      .select("id, student_no, first_name, last_name, enrollments!inner ( grade_name, status ), document_references ( document_type, storage_path, file_url ), guardians ( phone ), emergency_contacts ( id )")
      .eq("archived", false).eq("enrollments.status", "active"),
    canHealth ? supabase.from("medical_info").select("student_id, allergy_signed_date, medical_signed_date") : Promise.resolve({ data: [] }),
    canHealth ? supabase.from("media_consent").select("student_id, signed_date") : Promise.resolve({ data: [] }),
  ]);
  const m = new Map(((med.data as { student_id: string; allergy_signed_date: string | null; medical_signed_date: string | null }[] | null) ?? []).map((r) => [r.student_id, r]));
  const c = new Map(((con.data as { student_id: string; signed_date: string | null }[] | null) ?? []).map((r) => [r.student_id, r]));
  type Raw = Omit<FormStudent, "grade" | "docs" | "has"> & {
    enrollments: { grade_name: string }[]; document_references: FormStudent["docs"] | null;
    guardians: { phone: string | null }[] | null; emergency_contacts: { id: string }[] | null;
  };
  return ((st as unknown as Raw[]) ?? []).map((x) => ({
    id: x.id, student_no: x.student_no, first_name: x.first_name, last_name: x.last_name,
    grade: x.enrollments[0]?.grade_name ?? "—",
    docs: x.document_references ?? [],
    has: {
      primary: (x.guardians ?? []).some((g) => (g.phone ?? "").trim() !== ""),
      emergency: (x.emergency_contacts ?? []).length > 0,
      allergy: !!m.get(x.id)?.allergy_signed_date,
      medical: !!m.get(x.id)?.medical_signed_date,
      consent: !!c.get(x.id)?.signed_date,
    },
  }));
}
