import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { usDate, usPhone, ageYears } from "../../lib/format";

// `details` is the free-form block the website admission form sends
// (js/popup.js): address, mother + phone, emergency contact, etc.
interface ApplicantDetails {
  address?: string;
  mother?: string;
  mother_phone?: string;
  emergency?: string;
  heard_about?: string;
  special_needs?: string;
  comments?: string;
  documents?: string | string[];
}
interface Applicant {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  current_school: string | null;
  parent_name: string | null;
  parent_email: string | null;
  parent_phone: string | null;
  application_date: string;
  status: string;
  notes: string | null;
  applied_grade_id: number | null;
  applied_grade_text: string | null;
  details: ApplicantDetails | null;
  grades: { name: string } | null;
}
// One row per enrolled student + guardian, used to spot siblings already here.
interface GuardianRow {
  name: string;
  relationship: string;
  phone: string | null;
  email: string | null;
  students: {
    student_no: number; first_name: string; last_name: string;
    enrollments: { grade_name: string; status: string }[];
  };
}
interface Sibling { student_no: number; name: string; grade: string; via: string }

const STATUSES = [
  ["under_review", "Under Review"],
  ["accepted", "Accepted"],
  ["waitlisted", "Waitlisted"],
  ["not_accepted", "Not Accepted"],
  ["deferred", "Deferred"],
] as const;

const statusStyles: Record<string, string> = {
  under_review: "bg-amber-100 text-amber-800",
  accepted: "bg-green-100 text-green-700",
  waitlisted: "bg-blue-100 text-blue-700",
  not_accepted: "bg-red-100 text-red-700",
  deferred: "bg-gray-200 text-gray-600",
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export default function Admissions() {
  const [rows, setRows] = useState<Applicant[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [filter, setFilter] = useState<string>("under_review");
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Applicant | null>(null);
  // Monthly fee typed on each applicant card before Accept → Enroll ($300 default;
  // $200 for a second child of the same family; 0 = no fee).
  const [fees, setFees] = useState<Record<string, string>>({});
  const feeFor = (a: Applicant) => fees[a.id] ?? "300";

  async function load() {
    if (configMissing) return;
    const [{ data }, { data: g }, { data: gu }] = await Promise.all([
      supabase
        .from("applicants")
        .select("*, grades ( name )")
        .order("application_date", { ascending: false }),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
      supabase.from("guardians")
        .select("name, relationship, phone, email, students ( student_no, first_name, last_name, enrollments ( grade_name, status ) )"),
    ]);
    setRows((data as unknown as Applicant[]) ?? []);
    setGrades(g ?? []);
    setGuardians((gu as unknown as GuardianRow[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  // Siblings = enrolled students whose guardian matches the applicant's
  // father (email or phone) or mother (phone, or name). Matched by contact
  // details rather than surname so different-surname families still link.
  const siblingsFor = useMemo(() => {
    return (a: Applicant): Sibling[] => {
      const fEmail = norm(a.parent_email), fPhone = digits(a.parent_phone);
      const mPhone = digits(a.details?.mother_phone), mName = norm(a.details?.mother);
      const seen = new Map<number, Sibling>();
      for (const g of guardians) {
        const s = g.students; if (!s) continue;
        const active = s.enrollments?.find((e) => e.status === "active");
        if (!active) continue;
        let via: string | null = null;
        if (fEmail && norm(g.email) === fEmail) via = "father's email";
        else if (fPhone && digits(g.phone) === fPhone) via = "father's phone";
        else if (mPhone && digits(g.phone) === mPhone) via = "mother's phone";
        else if (mName && norm(g.name) === mName) via = "mother's name";
        if (via && !seen.has(s.student_no))
          seen.set(s.student_no, { student_no: s.student_no, name: `${s.first_name} ${s.last_name}`, grade: active.grade_name, via });
      }
      return [...seen.values()];
    };
  }, [guardians]);

  async function setStatus(a: Applicant, status: string) {
    setMsg(null);
    if (status === "accepted") {
      // Accept → Enroll creates the student, the enrollment in the current school
      // year AND the fee plan in one transaction (phase 14). The grade must be
      // chosen first; the fee defaults to the standard $300/month.
      if (!a.applied_grade_id) return setMsg("Choose the recommended grade before accepting.");
      const fee = Number(feeFor(a));
      if (!Number.isFinite(fee) || fee < 0) return setMsg("Monthly fee must be a number, 0 or more.");
      const { data, error } = await supabase.rpc("accept_applicant", { p_applicant: a.id, p_monthly_fee: fee });
      if (error) return setMsg("Accept failed: " + error.message);
      const r = (data ?? {}) as { student_no?: number; grade?: string; school_year?: string; monthly_fee?: number; already_accepted?: boolean };
      setMsg(r.already_accepted
        ? `${a.first_name} ${a.last_name} was already accepted (student #${r.student_no}).`
        : `${a.first_name} ${a.last_name} accepted — student #${r.student_no} enrolled in ${r.grade} for ${r.school_year} with a $${Number(r.monthly_fee ?? fee).toFixed(0)}/month fee plan.`);
    } else {
      const { error } = await supabase.from("applicants").update({ status }).eq("id", a.id);
      if (error) return setMsg("Update failed: " + error.message);
    }
    setOpen(null);
    load();
  }

  async function setGrade(a: Applicant, gradeId: number) {
    const { error } = await supabase.from("applicants").update({ applied_grade_id: gradeId }).eq("id", a.id);
    if (error) setMsg("Grade change failed: " + error.message);
    load();
  }

  const filtered = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const genderLabel = (g: string | null) => (g === "M" ? "Male" : g === "F" ? "Female" : g ?? "—");

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Admissions</h1>
        <div className="flex gap-1.5">
          <button onClick={() => setFilter("all")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === "all" ? "bg-navy text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
            All ({rows.length})
          </button>
          {STATUSES.map(([v, label]) => (
            <button key={v} onClick={() => setFilter(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === v ? "bg-navy text-white" : "bg-white text-gray-600 border border-gray-300"}`}>
              {label} ({rows.filter((r) => r.status === v).length})
            </button>
          ))}
        </div>
      </div>

      {msg && <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage admissions.</p>}

      <div className="space-y-3">
        {filtered.map((a) => {
          const sibs = siblingsFor(a);
          const age = ageYears(a.date_of_birth);
          return (
            <div key={a.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setOpen(a)} title="Open full application"
                    className="font-semibold text-navy hover:text-royal hover:underline">
                    {a.first_name} {a.last_name}
                  </button>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusStyles[a.status]}`}>
                    {STATUSES.find(([v]) => v === a.status)?.[1] ?? a.status}
                  </span>
                  {sibs.length > 0 && (
                    <span className="rounded-full bg-royal/10 px-2.5 py-0.5 text-xs font-semibold text-royal" title={sibs.map((s) => `${s.name} (${s.grade})`).join(", ")}>
                      Sibling enrolled: {sibs.map((s) => s.name.split(" ")[0]).join(", ")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400">Applied {usDate(a.application_date)}</div>
              </div>
              <div className="mt-2 grid gap-x-8 gap-y-1 text-sm text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
                <div>DOB: {usDate(a.date_of_birth)}{age != null ? <span className="text-gray-400"> · {age} yrs</span> : null}{a.gender ? <span className="text-gray-400"> · {genderLabel(a.gender)}</span> : null}</div>
                <div>Father: {a.parent_name ?? "—"}{a.parent_phone ? ` · ${usPhone(a.parent_phone)}` : ""}</div>
                <div>Mother: {a.details?.mother || "—"}{a.details?.mother_phone ? ` · ${usPhone(a.details.mother_phone)}` : ""}</div>
                <div>Email: {a.parent_email ?? "—"}</div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
                <label className="flex items-center gap-2 text-xs text-gray-500">
                  Recommended grade:
                  <select value={a.applied_grade_id ?? ""} onChange={(e) => setGrade(a, Number(e.target.value))}
                    className="rounded border border-gray-300 px-2 py-1 text-sm">
                    <option value="" disabled>—</option>
                    {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {a.applied_grade_text && <span className="text-gray-400">(applied for: {a.applied_grade_text})</span>}
                </label>
                {a.status !== "accepted" && (
                  <label className="flex items-center gap-2 text-xs text-gray-500" title="$300 one child · $200 second child of the same family · 0 = no fee">
                    Monthly fee: $
                    <input type="number" min={0} step={50} value={feeFor(a)}
                      onChange={(e) => setFees({ ...fees, [a.id]: e.target.value })}
                      className="w-20 rounded border border-gray-300 px-2 py-1 text-sm" />
                  </label>
                )}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => setOpen(a)}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-navy hover:bg-silver">Details</button>
                  {a.status !== "accepted" && (
                    <>
                      <button onClick={() => setStatus(a, "accepted")}
                        className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">
                        Accept → Enroll
                      </button>
                      <button onClick={() => setStatus(a, "waitlisted")}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Waitlist</button>
                      <button onClick={() => setStatus(a, "deferred")}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Defer</button>
                      <button onClick={() => setStatus(a, "not_accepted")}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Decline</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {!configMissing && !filtered.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No applicants in this view. New submissions from the website admission form will appear here automatically once form intake is connected.
          </p>
        )}
      </div>

      {open && (
        <ApplicantDialog a={open} siblings={siblingsFor(open)} grades={grades}
          onClose={() => setOpen(null)} onStatus={(s) => setStatus(open, s)} genderLabel={genderLabel} />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-sm text-gray-800">{children ?? "—"}</div>
    </div>
  );
}

function ApplicantDialog({ a, siblings, grades, onClose, onStatus, genderLabel }: {
  a: Applicant; siblings: Sibling[]; grades: { id: number; name: string }[];
  onClose: () => void; onStatus: (s: string) => void; genderLabel: (g: string | null) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const d = a.details ?? {};
  const age = ageYears(a.date_of_birth);
  // The website form sends `documents` as one newline-joined string: Drive links
  // for the uploaded files, plus optional notes such as "No files uploaded" or
  // "Parent will provide the missing document(s)…". Only real URLs become links.
  const docLines = (Array.isArray(d.documents) ? d.documents : d.documents ? String(d.documents).split(/\r?\n/) : [])
    .map((s) => String(s).trim()).filter(Boolean);
  const docs = docLines.filter((s) => /^https?:\/\//i.test(s));
  const docNotes = docLines.filter((s) => !/^https?:\/\//i.test(s) && !/^no files uploaded$/i.test(s));
  const recommended = grades.find((g) => g.id === a.applied_grade_id)?.name;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-navy">{a.first_name} {a.last_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className={`rounded-full px-2.5 py-0.5 font-semibold ${statusStyles[a.status]}`}>
                {STATUSES.find(([v]) => v === a.status)?.[1] ?? a.status}
              </span>
              <span>Applied {usDate(a.application_date)}</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-gray-400 hover:bg-silver hover:text-navy">✕</button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-navy">Student</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date of birth">{usDate(a.date_of_birth)}{age != null ? ` (${age} yrs)` : ""}</Field>
              <Field label="Gender">{genderLabel(a.gender)}</Field>
              <Field label="Applied for">{a.applied_grade_text ?? "—"}{recommended ? <span className="text-gray-400"> · recommended {recommended}</span> : null}</Field>
              <Field label="Previous school">{a.current_school || "—"}</Field>
              <Field label="Heard about us">{d.heard_about || "—"}</Field>
              <Field label="Special needs">{d.special_needs || "None noted"}</Field>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-navy">Parents</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-gray-100 bg-silver/40 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Father</div>
                <div className="font-medium text-gray-800">{a.parent_name || "—"}</div>
                <div className="text-sm text-gray-600">{usPhone(a.parent_phone)}</div>
                <div className="text-sm text-gray-600">{a.parent_email || "—"}</div>
              </div>
              <div className="rounded-lg border border-gray-100 bg-silver/40 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Mother</div>
                <div className="font-medium text-gray-800">{d.mother || "—"}</div>
                <div className="text-sm text-gray-600">{usPhone(d.mother_phone)}</div>
              </div>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Address">{d.address || "—"}</Field>
              <Field label="Emergency contact">{d.emergency || "—"}</Field>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-navy">Siblings already at Falah</h3>
            {siblings.length ? (
              <ul className="space-y-1">
                {siblings.map((s) => (
                  <li key={s.student_no} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full bg-royal/10 px-2 py-0.5 text-xs font-semibold text-royal">#{String(s.student_no).padStart(5, "0")}</span>
                    <span className="font-medium text-gray-800">{s.name}</span>
                    <span className="text-gray-500">· {s.grade}</span>
                    <span className="text-xs text-gray-400">matched by {s.via}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-gray-500">None found — no enrolled student shares this family's phone, email or mother's name.</p>}
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-navy">Notes &amp; documents</h3>
            {d.comments && <p className="mb-2 whitespace-pre-line text-sm text-gray-700">{d.comments}</p>}
            {a.notes && <p className="mb-2 whitespace-pre-line text-sm text-gray-700">{a.notes}</p>}
            {docNotes.map((n, i) => <p key={i} className="mb-2 text-sm text-amber-700">{n}</p>)}
            {docs.length > 0 ? (
              <ul className="list-inside list-disc text-sm">
                {docs.map((u, i) => <li key={i}><a href={u} target="_blank" rel="noopener" className="text-royal hover:underline">Uploaded document {i + 1}</a></li>)}
              </ul>
            ) : <p className="text-sm text-gray-500">No documents uploaded.</p>}
          </section>
        </div>

        {a.status !== "accepted" && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 px-6 py-4">
            <button onClick={() => onStatus("accepted")} className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">Accept → Enroll</button>
            <button onClick={() => onStatus("waitlisted")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Waitlist</button>
            <button onClick={() => onStatus("deferred")} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">Defer</button>
            <button onClick={() => onStatus("not_accepted")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Decline</button>
          </div>
        )}
      </div>
    </div>
  );
}
