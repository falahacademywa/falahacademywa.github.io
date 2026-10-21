// Teacher app — one student's limited profile: contacts (tap to call),
// allergy/medical summary, photo-consent status. Nothing else leaves the server.
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useRoster, consentBadge, telHref, type Contact } from "../../lib/teacher";
import { usPhone } from "../../lib/format";

export default function StudentDetail() {
  const { id } = useParams();
  const { roster } = useRoster();
  const r = roster.find((x) => x.student_id === id);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recent, setRecent] = useState<{ date: string; status: string }[]>([]);

  useEffect(() => {
    if (!id) return;
    supabase.from("teacher_student_contacts").select("*").eq("student_id", id).order("kind").order("sort_order")
      .then(({ data }) => setContacts((data as Contact[]) ?? []));
  }, [id]);
  useEffect(() => {
    if (!r) return;
    supabase.from("attendance").select("date, status").eq("enrollment_id", r.enrollment_id).order("date", { ascending: false }).limit(10)
      .then(({ data }) => setRecent((data as { date: string; status: string }[]) ?? []));
  }, [r?.enrollment_id]);

  if (!r) return <p className="text-sm text-gray-400">Loading…</p>;
  const b = consentBadge(r.consent_status);
  const guardians = contacts.filter((c) => c.kind === "guardian");
  const emergency = contacts.filter((c) => c.kind === "emergency");
  const Row = ({ c }: { c: Contact }) => (
    <a href={telHref(c.phone)} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 px-3 py-2 active:bg-silver">
      <div><div className="text-sm font-semibold text-navy">{c.name}{c.is_primary && <span className="ml-2 rounded-full bg-gold/20 px-1.5 text-[10px] text-navy">primary</span>}</div>
        <div className="text-[11px] text-gray-400">{c.relationship ?? ""}</div></div>
      <span className="text-sm font-semibold text-royal">{c.phone ? usPhone(c.phone) : "—"} 📞</span>
    </a>
  );
  return (
    <div>
      <Link to="/teacher" className="text-sm text-royal">‹ Attendance</Link>
      <div className="mt-2 flex items-center gap-3">
        {r.profile_photo_url ? <img src={r.profile_photo_url} alt="" className="h-16 w-16 rounded-full object-cover" />
          : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-navy/10 text-lg font-bold text-navy">{r.first_name[0]}{r.last_name[0]}</div>}
        <div>
          <h1 className="font-display text-xl font-semibold text-navy">{r.first_name} {r.last_name}</h1>
          <div className="text-xs text-gray-500">{r.grade_name}</div>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${b.cls}`}>📷 {b.label}{r.name_preference === "none" ? " · no name" : r.name_preference === "first_name" ? " · first name only" : ""}</span>
        </div>
      </div>

      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Parents</h2>
        <div className="space-y-1.5">{guardians.map((c, i) => <Row key={i} c={c} />)}{!guardians.length && <p className="text-sm text-gray-400">None on file.</p>}</div>
      </section>
      <section className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Emergency contacts</h2>
        <div className="space-y-1.5">{emergency.map((c, i) => <Row key={i} c={c} />)}{!emergency.length && <p className="text-sm text-gray-400">None on file.</p>}</div>
      </section>
      <section className={`mt-3 rounded-xl border p-3 shadow-sm ${r.has_allergies || r.medical_conditions || r.emergency_medication ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"}`}>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Health</h2>
        <dl className="space-y-1 text-sm">
          <div><dt className="inline font-semibold text-navy">Allergies: </dt><dd className="inline">{r.has_allergies ? (r.allergies || "yes, see office") : r.allergy_form_done ? "none" : "form not on file"}</dd></div>
          <div><dt className="inline font-semibold text-navy">Conditions: </dt><dd className="inline">{r.medical_conditions ?? (r.medical_form_done ? "none" : "form not on file")}</dd></div>
          <div><dt className="inline font-semibold text-navy">Medication at school: </dt><dd className="inline">{r.medications ?? "none"}</dd></div>
          <div><dt className="inline font-semibold text-navy">Inhaler / EpiPen: </dt><dd className="inline">{r.emergency_medication ?? "none"}</dd></div>
          {r.dietary_restrictions && <div><dt className="inline font-semibold text-navy">Dietary: </dt><dd className="inline">{r.dietary_restrictions}</dd></div>}
          {r.physician_name && <div><dt className="inline font-semibold text-navy">Physician: </dt><dd className="inline">{r.physician_name}{r.physician_phone ? <> · <a className="text-royal" href={telHref(r.physician_phone)}>{usPhone(r.physician_phone)}</a></> : null}</dd></div>}
        </dl>
      </section>
      <section className="mt-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">Last 10 school days</h2>
        <div className="flex flex-wrap gap-1">
          {recent.map((a) => <span key={a.date} title={a.date} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${a.status === "present" ? "bg-green-100 text-green-700" : a.status === "late" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>{a.date.slice(5)} {a.status[0].toUpperCase()}</span>)}
          {!recent.length && <span className="text-sm text-gray-400">No attendance yet.</span>}
        </div>
      </section>
      <div className="mt-3">
        <Link to={`/teacher/update?student=${r.enrollment_id}`} className="block rounded-lg bg-navy py-2 text-center text-sm font-semibold text-white">Post an update for {r.first_name}</Link>
      </div>
    </div>
  );
}
