// Teacher app (phase 26): shared types, roster hook and small helpers.
// Everything here reads the limited views the database exposes to teachers
// (teacher_students, teacher_student_contacts); nothing reaches the base
// tables' hidden columns.
import { useEffect, useState } from "react";
import { supabase, configMissing } from "./supabase";

export interface RosterRow {
  student_id: string; enrollment_id: string; student_no: number; first_name: string; last_name: string;
  profile_photo_url: string | null; grade_id: number; grade_name: string;
  has_allergies: boolean; allergies: string | null; medical_conditions: string | null; medications: string | null;
  emergency_medication: string | null; dietary_restrictions: string | null; physician_name: string | null; physician_phone: string | null;
  allergy_form_done: boolean; medical_form_done: boolean;
  consent_status: "public" | "limited" | "none" | "not_on_file"; name_preference: string | null;
}
export interface Contact { student_id: string; kind: "guardian" | "emergency"; name: string; relationship: string | null; phone: string | null; sort_order: number; is_primary: boolean }
export interface MyTeacher { id: string; first_name: string; last_name: string; email: string | null; phone: string | null; qualification: string | null; photo_url: string | null; bio: string | null;
  address: string | null; emergency_name: string | null; emergency_phone: string | null;
  teacher_grades: { id: number; role: string; grade_id: number; grades: { name: string } }[] }

export const SUBJECTS = ["English", "Mathematics", "Science", "Islamic Education", "Qur'an", "Arabic", "Art", "PE", "General"];

export function useRoster() {
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    if (configMissing) return;
    setLoading(true);
    const { data, error } = await supabase.from("teacher_students").select("*").order("grade_id").order("first_name");
    if (error) setError(error.message.includes("teacher_students") ? "The teacher app is not set up on this project yet (phase 26)." : error.message);
    setRoster((data as RosterRow[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  const grades = Array.from(new Map(roster.map((r) => [r.grade_id, r.grade_name])).entries())
    .map(([id, name]) => ({ id, name }));
  return { roster, grades, loading, error, reload: load };
}

export function useMyTeacher() {
  const [me, setMe] = useState<MyTeacher | null>(null);
  async function load() {
    if (configMissing) return;
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;
    // teachers rows are readable by every login (parents see teacher names), so filter by my link
    const { data } = await supabase.from("teachers")
      .select("id, first_name, last_name, email, phone, qualification, photo_url, bio, address, emergency_name, emergency_phone, teacher_grades ( id, role, grade_id, grades ( name ) )")
      .eq("user_id", uid).limit(1).maybeSingle();
    setMe((data as unknown as MyTeacher) ?? null);
  }
  useEffect(() => { load(); }, []);
  return { me, reload: load };
}

export const consentBadge = (s: RosterRow["consent_status"]) =>
  s === "public" ? { label: "Photos OK: public", cls: "bg-emerald-50 text-emerald-deep" }
  : s === "limited" ? { label: "Limited photo consent", cls: "bg-amber-100 text-amber-800" }
  : s === "none" ? { label: "No photos", cls: "bg-red-100 text-red-700" }
  : { label: "Consent not on file", cls: "bg-gray-100 text-gray-500" };

export const medicalFlag = (r: RosterRow) => r.has_allergies || !!r.medical_conditions || !!r.medications || !!r.emergency_medication;

/** Shrink a camera photo in the browser before upload (keeps storage small). */
export async function compressImage(file: File, maxSide = 1600, quality = 0.82): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", quality));
}

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const telHref = (p: string | null) => (p ? `tel:${p.replace(/[^\d+]/g, "")}` : undefined);
