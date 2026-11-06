// Teacher requests (phase 35, TODO #163): shared types and helpers for the teacher app tab
// and Admin → Teacher requests. All reads come from teacher_requests_feed(); all writes go
// through the database functions, which enforce who may do what.
import { supabase } from "./supabase";
import { monthLabel } from "./calendar";
import { academicYearOf, ymOf, type Level } from "../components/GroupedArchive";

export const REQ_TYPES = ["Supplies", "Classroom/facility", "Curriculum", "Student matter", "IT/portal", "Schedule/leave", "Other"] as const;
export type ReqStatus = "submitted" | "discussing" | "approved" | "in_progress" | "done" | "declined";

export interface ReqNote { id: number; kind: "note" | "status"; internal: boolean; body: string; created_at: string; author: string; mine: boolean }
export interface Req {
  id: number; title: string; details: string | null; type: string; urgency: "normal" | "urgent";
  status: ReqStatus; decline_reason: string | null; due_date: string | null; task_code: string | null;
  photo_path: string | null; created_at: string; updated_at: string; archived_at: string | null; decided_at: string | null;
  mine: boolean; requester: string; student_id: string | null; student: string | null; notes: ReqNote[];
}

export const STATUS_LABEL: Record<ReqStatus, string> = {
  submitted: "Submitted", discussing: "Under discussion", approved: "Approved", in_progress: "In progress", done: "Resolved", declined: "Declined",
};
export const STATUS_CLS: Record<ReqStatus, string> = {
  submitted: "bg-gray-100 text-gray-600", discussing: "bg-sky-100 text-sky-700", approved: "bg-emerald-50 text-emerald-deep",
  in_progress: "bg-blue-100 text-blue-700", done: "bg-green-100 text-green-700", declined: "bg-red-100 text-red-700",
};
export const isOpen = (r: Req) => r.status !== "done" && r.status !== "declined";
export const canTeacherEdit = (r: Req) => r.mine && (r.status === "submitted" || r.status === "discussing");

export async function loadRequests(): Promise<{ data: Req[]; error: string | null }> {
  const { data, error } = await supabase.rpc("teacher_requests_feed");
  if (error) return { data: [], error: error.message.includes("teacher_requests_feed") ? "Teacher requests are not set up on this project yet (phase 35)." : error.message };
  return { data: (data as Req[]) ?? [], error: null };
}

export async function photoUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from("teacher-requests").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

// Archive levels (President 2026-11-05): current year Approved/Declined → Type → Month;
// admins also see past years first: Year → Approved/Declined → Type → Month.
const outcome = (r: Req) => (r.status === "declined" ? "Declined" : "Approved");
const doneAt = (r: Req) => r.archived_at ?? r.updated_at;
export const archiveLevels = (withYear: boolean): Level<Req>[] => [
  ...(withYear ? [{ key: (r: Req) => academicYearOf(r.created_at), label: (k: string) => `${k} school year` }] : []),
  { key: outcome, order: (a, b) => (a === b ? 0 : a === "Approved" ? -1 : 1) },
  { key: (r) => r.type, order: (a, b) => a.localeCompare(b) },
  { key: (r) => ymOf(doneAt(r)), label: monthLabel },
];

export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
export const shortDateTime = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
