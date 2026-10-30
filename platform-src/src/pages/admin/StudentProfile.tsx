import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr, monthStr } from "../../lib/dates";
import { usDate, usPhone } from "../../lib/format";
import { RelBadge } from "./ParentProfile";
import { useAuth } from "../../lib/auth";
import { StudentFormDialog, consentBadge, formStatus, allergySummary, medicalSummary, MEDICAL_COLS, CONSENT_COLS, FORM_TITLE, FORM_DOC_TYPE } from "../../components/StudentForms";
import type { FormKind, MedicalRow, ConsentRow } from "../../components/StudentForms";

interface AttRow { date: string; status: "present" | "late" | "absent" }
interface FeeInfo { total_amount: number; billing_frequency: string; start_date: string | null; payments: { payment_date: string; period_month: string | null; amount: number; payment_method: string }[] }
interface QuranRow { id: number; assessment_date: string; category: string; surah_topic: string; memorization_level: string | null; teacher_comment: string | null; revision: string | null }
interface AcadRow { id: number; assessment_date: string; subject: string; assessment_type: string; score: number | null; max_score: number | null; notes: string | null }

interface Student {
  id: string;
  student_no: number;
  first_name: string;
  last_name: string;
  date_of_birth: string | null;
  gender: string | null;
  archived: boolean;
  notes: string | null;
  profile_photo_url: string | null;
  photo_pending_url: string | null;
  enrollments: { id: string; school_year: string; grade_name: string; status: string; enrollment_date: string; exit_date: string | null; exit_reason: string | null }[];
  parent_students: { profiles: { full_name: string; email: string | null; phone: string | null; must_change_password: boolean } }[];
  guardians: { id: string; name: string; relationship: string; phone: string | null; email: string | null; sort: number }[];
  emergency_contacts: { id: string; name: string; phone: string; relationship: string | null; is_primary: boolean }[];
  document_references: { id: string; document_type: string; file_url: string | null; storage_path: string | null; uploaded_date: string }[];
}
type DocRef = Student["document_references"][number];

export default function StudentProfile() {
  const { id } = useParams();
  const [s, setS] = useState<Student | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [month, setMonth] = useState(() => monthStr());
  const [att, setAtt] = useState<AttRow[]>([]);
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);
  const [quran, setQuran] = useState<QuranRow[]>([]);
  const [acad, setAcad] = useState<AcadRow[]>([]);
  const [siblings, setSiblings] = useState<{ id: string; first_name: string; last_name: string }[]>([]);
  const [addrMap, setAddrMap] = useState<Record<string, string>>({});
  const [docTypes, setDocTypes] = useState<{ id: number; name: string }[]>([]);
  const nav = useNavigate();
  const { can } = useAuth();   // staff need the "health" module for the forms below (phase 19)
  // Digital forms (phase 18): allergy + medical live in medical_info, consent in media_consent
  const [med, setMed] = useState<MedicalRow | null>(null);
  const [consent, setConsent] = useState<ConsentRow | null>(null);
  const [formOpen, setFormOpen] = useState<FormKind | null>(null);
  // Right-click menu on a guardian row (make primary contact / open profile)
  const [menu, setMenu] = useState<{ x: number; y: number; g: Student["guardians"][number] } | null>(null);
  // Suspend / Withdraw / Reinstate dialog (phase 30)
  const [statusDlg, setStatusDlg] = useState<"suspend" | "withdraw" | "reinstate" | null>(null);
  const [statusForm, setStatusForm] = useState({ date: todayStr(), reason: "", closeFee: true, suspendLogins: true });
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  // Guardian / emergency-contact editors (#138)
  const [gForm, setGForm] = useState<{ id: string | null; name: string; relationship: string; phone: string; email: string } | null>(null);
  const [cForm, setCForm] = useState<{ id: string | null; name: string; phone: string; relationship: string; is_primary: boolean } | null>(null);
  async function makePrimary(g: Student["guardians"][number]) {
    if (!s) return;
    await supabase.from("guardians").update({ sort: 2 }).eq("student_id", s.id).neq("id", g.id);
    await supabase.from("guardians").update({ sort: 1 }).eq("id", g.id);
    setMenu(null); load();
  }

  useEffect(() => {
    if (configMissing) return;
    supabase.from("document_types").select("id, name").eq("active", true).order("sort")
      .then(({ data }) => setDocTypes(data ?? []));
  }, []);

  async function uploadDoc(typeName: string, file: File) {
    if (!s) return;
    const path = `${s.id}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("student-documents").upload(path, file);
    if (error) { alert("Upload failed: " + error.message); return; }
    const existing = s.document_references.find((d) => d.document_type === typeName);
    if (existing) {
      if (existing.storage_path) await supabase.storage.from("student-documents").remove([existing.storage_path]);
      await supabase.from("document_references").update({ storage_path: path, uploaded_date: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("document_references").insert({ student_id: s.id, document_type: typeName, storage_path: path });
    }
    load();
  }

  // Admin override: mark received (no file), or clear the submission entirely
  async function markDoc(typeName: string) {
    if (!s) return;
    await supabase.from("document_references").insert({ student_id: s.id, document_type: typeName });
    load();
  }
  async function clearDoc(d: DocRef) {
    if (d.storage_path) await supabase.storage.from("student-documents").remove([d.storage_path]);
    await supabase.from("document_references").delete().eq("id", d.id);
    load();
  }
  async function viewDoc(d: DocRef) {
    if (d.storage_path) {
      const { data } = await supabase.storage.from("student-documents").createSignedUrl(d.storage_path, 3600);
      if (data?.signedUrl) { window.open(data.signedUrl, "_blank"); return; }
      const dl = await supabase.storage.from("student-documents").download(d.storage_path);
      if (dl.data) window.open(URL.createObjectURL(dl.data), "_blank");
    } else if (d.file_url) window.open(d.file_url, "_blank");
  }

  // Siblings: students sharing a guardian email with this one (parent-portal-style switcher)
  useEffect(() => {
    if (configMissing || !id) { setSiblings([]); return; }
    (async () => {
      const { data: mine } = await supabase.from("guardians").select("email").eq("student_id", id).not("email", "is", null);
      const emails = [...new Set((mine ?? []).map((g: { email: string }) => g.email.toLowerCase()))];
      if (!emails.length) { setSiblings([]); return; }
      const { data: sibs } = await supabase.from("guardians")
        .select("student_id, email, students ( id, first_name, last_name, archived )")
        .in("email", emails).neq("student_id", id);
      const seen = new Map<string, { id: string; first_name: string; last_name: string }>();
      (sibs as any[] ?? []).forEach((g) => {
        if (g.students && !g.students.archived) seen.set(g.students.id, g.students);
      });
      setSiblings([...seen.values()]);
    })();
  }, [id]);

  async function load() {
    if (configMissing || !id) return;
    const { data, error } = await supabase
      .from("students")
      .select(`id, student_no, first_name, last_name, date_of_birth, gender, archived, notes, profile_photo_url, photo_pending_url,
        enrollments ( id, school_year, grade_name, status, enrollment_date, exit_date, exit_reason ),
        parent_students ( profiles ( full_name, email, phone, must_change_password ) ),
        guardians ( id, name, relationship, phone, email, sort ),
        emergency_contacts ( id, name, phone, relationship, is_primary ),
        document_references ( id, document_type, file_url, storage_path, uploaded_date )`)
      .eq("id", id)
      .single();
    if (error) setErr(error.message);
    setS(data as unknown as Student);
    // Home addresses live on profiles.address (phase 10). Fetched separately
    // and guarded so environments without the column still render the page.
    const { data: addr } = await supabase.from("parent_students")
      .select("profiles ( email, address )").eq("student_id", id);
    const m: Record<string, string> = {};
    ((addr as unknown as { profiles: { email: string | null; address: string | null } }[]) ?? [])
      .forEach((r) => { if (r.profiles?.email && r.profiles.address) m[r.profiles.email.toLowerCase()] = r.profiles.address; });
    setAddrMap(m);
    // Digital forms (phases 17–18). Guarded: a project without the tables still renders.
    const [{ data: mi }, { data: mc }] = await Promise.all([
      supabase.from("medical_info").select(MEDICAL_COLS).eq("student_id", id).maybeSingle(),
      supabase.from("media_consent").select(CONSENT_COLS).eq("student_id", id).maybeSingle(),
    ]);
    setMed((mi as unknown as MedicalRow | null) ?? null);
    setConsent((mc as unknown as ConsentRow | null) ?? null);
  }
  useEffect(() => { load(); }, [id]);

  const activeEnr = s?.enrollments.find((e) => e.status === "active") ?? s?.enrollments[0];

  // Attendance for selected month
  useEffect(() => {
    if (configMissing || !activeEnr) { setAtt([]); return; }
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    supabase.from("attendance").select("date, status")
      .eq("enrollment_id", activeEnr.id)
      .gte("date", `${month}-01`).lte("date", `${month}-${String(last).padStart(2, "0")}`)
      .then(({ data }) => setAtt((data as AttRow[]) ?? []));
  }, [activeEnr?.id, month]);

  // Fees + progress
  useEffect(() => {
    if (configMissing || !activeEnr) return;
    supabase.from("fee_plans")
      .select("total_amount, billing_frequency, start_date, payments ( payment_date, period_month, amount, payment_method )")
      .eq("enrollment_id", activeEnr.id).maybeSingle()
      .then(({ data }) => setFeeInfo((data as unknown as FeeInfo) ?? null));
    supabase.from("quran_progress").select("id, assessment_date, category, surah_topic, memorization_level, teacher_comment, revision")
      .eq("enrollment_id", activeEnr.id).order("assessment_date", { ascending: false }).limit(5)
      .then(({ data }) => setQuran((data as QuranRow[]) ?? []));
    supabase.from("academic_progress").select("id, assessment_date, subject, assessment_type, score, max_score, notes")
      .eq("enrollment_id", activeEnr.id).order("assessment_date", { ascending: false }).limit(5)
      .then(({ data }) => setAcad((data as AcadRow[]) ?? []));
  }, [activeEnr?.id]);

  const counts = useMemo(() => {
    const c = { present: 0, late: 0, absent: 0 };
    att.forEach((a) => c[a.status]++);
    return c;
  }, [att]);

  const monthGrid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const map = new Map(att.map((a) => [a.date, a.status]));
    const cells: { day: number | null; status?: string }[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push({ day: null });
    for (let d = 1; d <= days; d++) cells.push({ day: d, status: map.get(`${month}-${String(d).padStart(2, "0")}`) });
    return cells;
  }, [month, att]);

  // Months of the current school year only (Aug -> now), newest first
  const monthOptions = useMemo(() => {
    const now = new Date();
    const startYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    const opts: string[] = [];
    const d = new Date(startYear, 7, 1);
    while (d <= now) {
      opts.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      d.setMonth(d.getMonth() + 1);
    }
    return opts.reverse();
  }, []);

  async function photoDecision(approve: boolean) {
    if (!s) return;
    await supabase.from("students").update(
      approve ? { profile_photo_url: s.photo_pending_url, photo_pending_url: null }
              : { photo_pending_url: null }
    ).eq("id", s.id);
    load();
  }

  async function toggleArchive() {
    if (!s) return;
    await supabase.from("students").update({ archived: !s.archived }).eq("id", s.id);
    load();
  }

  // Suspend / Withdraw / Reinstate (phase 30, #112): one RPC does enrollment status, archive,
  // fee plan, parent logins and the audit row in a single transaction.
  async function submitStatus() {
    if (!s || !statusDlg) return;
    setStatusBusy(true);
    const { data, error } = await supabase.rpc("set_student_status", {
      p_student: s.id, p_action: statusDlg, p_date: statusForm.date || null, p_reason: statusForm.reason.trim() || null,
      p_close_fee: statusForm.closeFee, p_suspend_logins: statusForm.suspendLogins });
    setStatusBusy(false);
    if (error) { alert("Could not update the status: " + error.message + (error.message.includes("set_student_status") ? " (run platform_schema_phase30.sql)" : "")); return; }
    const r = (data ?? {}) as { fee_plans_closed?: number; parents_suspended?: number; fee_plans_reopened?: number; parents_unsuspended?: number };
    setStatusDlg(null);
    setStatusMsg(statusDlg === "reinstate"
      ? `Reinstated. Fee plans re-opened: ${r.fee_plans_reopened ?? 0} · parent logins restored: ${r.parents_unsuspended ?? 0}.`
      : `${statusDlg === "suspend" ? "Suspended" : "Withdrawn"}. Fee plans closed: ${r.fee_plans_closed ?? 0} · parent logins suspended: ${r.parents_suspended ?? 0}. The attendance sheet and class-update roster update within the hour.`);
    load();
  }

  // Guardians and emergency contacts: office edits (phase 30 day, #138). Admin policies existed already;
  // the protect_guardian_columns trigger lets a signed-in admin change e-mails (SQL-editor edits are reverted).
  async function saveGuardian() {
    if (!s || !gForm) return;
    const row = { name: gForm.name.trim(), relationship: gForm.relationship, phone: gForm.phone.trim() || null, email: gForm.email.trim().toLowerCase() || null };
    if (!row.name) return alert("Name is required.");
    const { error } = gForm.id
      ? await supabase.from("guardians").update(row).eq("id", gForm.id)
      : await supabase.from("guardians").insert({ ...row, student_id: s.id, sort: s.guardians.length ? Math.max(...s.guardians.map((g) => g.sort)) + 1 : 1 });
    if (error) return alert("Save failed: " + error.message);
    setGForm(null); load();
  }
  async function removeGuardian(g: Student["guardians"][number]) {
    if (!confirm(`Remove ${g.name} from ${s?.first_name}'s guardians? Their portal login (if any) is not deleted.`)) return;
    const { error } = await supabase.from("guardians").delete().eq("id", g.id);
    if (error) return alert("Remove failed: " + error.message);
    setMenu(null); load();
  }
  async function saveContact() {
    if (!s || !cForm) return;
    const row = { name: cForm.name.trim(), phone: cForm.phone.trim(), relationship: cForm.relationship.trim() || null, is_primary: cForm.is_primary };
    if (!row.name || !row.phone) return alert("Name and phone are required.");
    if (row.is_primary) await supabase.from("emergency_contacts").update({ is_primary: false }).eq("student_id", s.id);
    const { error } = cForm.id
      ? await supabase.from("emergency_contacts").update(row).eq("id", cForm.id)
      : await supabase.from("emergency_contacts").insert({ ...row, student_id: s.id });
    if (error) return alert("Save failed: " + error.message);
    setCForm(null); load();
  }
  async function removeContact(c: Student["emergency_contacts"][number]) {
    if (!confirm(`Remove emergency contact ${c.name}?`)) return;
    const { error } = await supabase.from("emergency_contacts").delete().eq("id", c.id);
    if (error) return alert("Remove failed: " + error.message);
    load();
  }

  if (configMissing) return <p className="text-sm text-gray-500">Connect the database to view student profiles.</p>;
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!s) return <p className="text-sm text-gray-500">Loading…</p>;

  return (
    <div className="max-w-4xl">
      <Link to="/admin/students" className="text-sm text-royal hover:underline">← Students</Link>
      <div className="mt-2 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {s.profile_photo_url ? (
            <img src={s.profile_photo_url} alt={s.first_name}
              className="h-16 w-16 rounded-full border-2 border-gold object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-navy/10 font-display text-xl font-semibold text-navy">
              {s.first_name[0]}{s.last_name[0]}
            </div>
          )}
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">{s.first_name} {s.last_name}</h1>
          <div className="mt-1 text-sm text-gray-500">
            Student ID <span className="font-mono font-semibold">{String(s.student_no).padStart(5, "0")}</span>
            {s.date_of_birth && <> · DOB {usDate(s.date_of_birth)}</>}
            {s.gender && <> · {s.gender}</>}
            {(() => {
              const e = s.enrollments.find((x) => x.status === "suspended") ?? s.enrollments.find((x) => x.status === "withdrawn");
              if (e && !s.enrollments.some((x) => x.status === "active")) return (
                <span title={e.exit_reason ?? ""} className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-semibold ${e.status === "suspended" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
                  {e.status === "suspended" ? "Suspended" : "Withdrawn"}{e.exit_date ? ` since ${usDate(e.exit_date)}` : ""}
                </span>
              );
              return s.archived ? <span className="ml-2 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Archived</span> : null;
            })()}
          </div>
          {(() => { const b = consentBadge(consent); return (
            <button onClick={() => setFormOpen("consent")} title={b.title + " — click to open the consent form"}
              className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold hover:ring-2 hover:ring-royal/40 ${b.cls}`}>
              📷 {b.label}
            </button>
          ); })()}
        </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.enrollments.some((e) => e.status === "active") ? (
            <>
              <button onClick={() => { setStatusForm({ date: todayStr(), reason: "", closeFee: true, suspendLogins: true }); setStatusDlg("suspend"); }}
                className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50">Suspend</button>
              <button onClick={() => { setStatusForm({ date: todayStr(), reason: "", closeFee: true, suspendLogins: true }); setStatusDlg("withdraw"); }}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50">Withdraw</button>
            </>
          ) : s.enrollments.some((e) => e.status === "suspended" || e.status === "withdrawn") ? (
            <button onClick={() => { setStatusForm({ date: todayStr(), reason: "", closeFee: true, suspendLogins: true }); setStatusDlg("reinstate"); }}
              className="rounded-lg bg-emerald-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-deep">Reinstate</button>
          ) : (
            <button onClick={toggleArchive}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
              {s.archived ? "Restore" : "Archive"}
            </button>
          )}
        </div>
      </div>
      {statusMsg && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg(null)} className="text-xs font-semibold text-green-700 hover:underline">Dismiss</button>
        </div>
      )}

      {statusDlg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !statusBusy && setStatusDlg(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-lg font-semibold text-navy">
              {statusDlg === "suspend" ? "Suspend" : statusDlg === "withdraw" ? "Withdraw" : "Reinstate"} {s.first_name} {s.last_name}
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              {statusDlg === "suspend" && "Suspended = may return. The enrollment is paused from the date below, the student leaves the attendance sheet and the class-update roster within the hour, and fee reminders stop."}
              {statusDlg === "withdraw" && "Withdrawn = has left the school. The enrollment is closed from the date below, the student leaves the attendance sheet and the class-update roster within the hour, and fee reminders stop."}
              {statusDlg === "reinstate" && "The enrollment becomes active again, the student returns to the attendance sheet and roster within the hour, closed fee plans re-open and the family's portal logins are restored."}
            </p>
            {statusDlg !== "reinstate" && (
              <label className="mt-3 block text-xs font-semibold text-gray-600">Type
                <div className="mt-1 flex gap-2">
                  {(["suspend", "withdraw"] as const).map((k) => (
                    <button key={k} onClick={() => setStatusDlg(k)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${statusDlg === k ? (k === "suspend" ? "border-amber-500 bg-amber-100 text-amber-900" : "border-red-400 bg-red-100 text-red-800") : "border-gray-300 text-gray-600 hover:bg-silver"}`}>
                      {k === "suspend" ? "Suspended (may return)" : "Withdrawn (left)"}
                    </button>
                  ))}
                </div>
              </label>
            )}
            <label className="mt-3 block text-xs font-semibold text-gray-600">Effective date
              <input type="date" value={statusForm.date} onChange={(e) => setStatusForm({ ...statusForm, date: e.target.value })}
                className="mt-1 block rounded border border-gray-300 px-2 py-1.5 text-sm font-normal" />
            </label>
            <label className="mt-3 block text-xs font-semibold text-gray-600">Reason{statusDlg === "reinstate" ? " (optional)" : " (required)"}
              <textarea rows={2} value={statusForm.reason} onChange={(e) => setStatusForm({ ...statusForm, reason: e.target.value })}
                placeholder={statusDlg === "reinstate" ? "e.g. family back from travel" : "e.g. family relocated · too young for the class · not attending since 09-15"}
                className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm font-normal" />
            </label>
            {statusDlg !== "reinstate" && (
              <div className="mt-3 space-y-1.5 text-sm text-gray-700">
                <label className="flex items-center gap-2"><input type="checkbox" checked={statusForm.closeFee} onChange={(e) => setStatusForm({ ...statusForm, closeFee: e.target.checked })} /> Close the fee plan (no more invoices or reminders)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={statusForm.suspendLogins} onChange={(e) => setStatusForm({ ...statusForm, suspendLogins: e.target.checked })} /> Suspend the parent login if the family has no other active child</label>
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setStatusDlg(null)} disabled={statusBusy} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
              <button onClick={submitStatus} disabled={statusBusy || (statusDlg !== "reinstate" && !statusForm.reason.trim()) || !statusForm.date}
                className={`rounded-lg px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${statusDlg === "suspend" ? "bg-amber-600 hover:bg-amber-700" : statusDlg === "withdraw" ? "bg-red-600 hover:bg-red-700" : "bg-emerald-brand hover:bg-emerald-deep"}`}>
                {statusBusy ? "Saving…" : statusDlg === "suspend" ? "Suspend" : statusDlg === "withdraw" ? "Withdraw" : "Reinstate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {siblings.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-gray-400">Family:</span>
          <span className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white">{s.first_name}</span>
          {siblings.map((sib) => (
            <Link key={sib.id} to={`/admin/students/${sib.id}`}
              className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:border-navy hover:text-navy">
              {sib.first_name} {sib.last_name}
            </Link>
          ))}
        </div>
      )}

      {s.photo_pending_url && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <img src={s.photo_pending_url} alt="Pending" className="h-20 w-20 rounded-lg object-cover" />
          <div className="flex-1 text-sm text-amber-800">
            <strong>Photo awaiting approval</strong> — a parent uploaded this picture for {s.first_name}.
          </div>
          <div className="flex gap-2">
            <button onClick={() => photoDecision(true)}
              className="rounded-lg bg-emerald-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-deep">Approve</button>
            <button onClick={() => photoDecision(false)}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-600 hover:bg-white">Reject</button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Attendance — full color calendar */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Attendance</h2>
            <select value={month} onChange={(e) => setMonth(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm">
              {monthOptions.map((m) => (
                <option key={m} value={m}>{new Date(m + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>
              ))}
            </select>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-green-100 p-2 text-center text-green-700"><b>{counts.present}</b> <span className="text-xs">present</span></div>
            <div className="rounded-lg bg-amber-100 p-2 text-center text-amber-800"><b>{counts.late}</b> <span className="text-xs">late</span></div>
            <div className="rounded-lg bg-red-100 p-2 text-center text-red-700"><b>{counts.absent}</b> <span className="text-xs">absent</span></div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {["S","M","T","W","T","F","S"].map((d, i) => <div key={i} className="py-1 font-bold text-gray-400">{d}</div>)}
            {monthGrid.map((c, i) => (
              <div key={i} className={`flex h-8 items-center justify-center rounded ${
                c.day == null ? "" :
                c.status === "present" ? "bg-green-100 font-semibold text-green-700" :
                c.status === "late" ? "bg-amber-100 font-semibold text-amber-800" :
                c.status === "absent" ? "bg-red-100 font-semibold text-red-700" :
                "bg-silver text-gray-400"}`}>{c.day ?? ""}</div>
            ))}
          </div>
        </section>

        {/* Fees */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Fees</h2>
          {feeInfo ? (
            Number(feeInfo.total_amount) === 0 ? (
              <p className="text-sm text-gray-500">No fee applies to this enrollment ($0 plan — no reminders sent).</p>
            ) : (
              <>
                <div className="mb-3 flex items-center justify-between rounded-lg bg-silver p-3">
                  <div>
                    <div className="font-display text-xl font-semibold text-navy">${Number(feeInfo.total_amount).toFixed(0)}</div>
                    <div className="text-xs text-gray-500">per {feeInfo.billing_frequency.replace("ly", "")}</div>
                  </div>
                  {feeInfo.start_date && feeInfo.start_date > todayStr() ? (
                    <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                      Starts {new Date(feeInfo.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ) : feeInfo.payments.some((p) => (p.period_month ?? p.payment_date).startsWith(monthStr()) && p.payment_method !== "waived") ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Paid this month ✓</span>
                  ) : feeInfo.payments.some((p) => (p.period_month ?? p.payment_date).startsWith(monthStr())) ? (
                    <span className="rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-700">Waived this month</span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Not paid (due by the 5th)</span>
                  )}
                </div>
                {[...feeInfo.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between border-b py-1 text-sm last:border-0">
                    <span className="text-gray-500">{p.payment_date}</span>
                    <span className={`font-semibold ${p.payment_method === "waived" ? "text-gray-400 line-through" : "text-navy"}`}>${Number(p.amount).toFixed(2)}</span>
                    {p.payment_method === "waived"
                      ? <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-700">Waived</span>
                      : <span className="text-xs text-gray-400">{p.payment_method}</span>}
                  </div>
                ))}
                {!feeInfo.payments.length && <p className="text-xs text-gray-400">No payments recorded yet.</p>}
              </>
            )
          ) : <p className="text-sm text-gray-400">No fee plan for this enrollment.</p>}
        </section>

        {/* Progress */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Qur'an &amp; Academic Progress</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              {quran.map((q, i) => (
                <div key={q.id} className={`mb-2 rounded-lg p-2.5 text-sm ${i === 0 ? "bg-emerald-50" : "bg-silver/60"}`}>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-emerald-deep">{q.category}</span>
                  <span className="ml-2 font-semibold text-navy">{q.surah_topic}</span>
                  {q.memorization_level && <span className="ml-2 text-xs text-gray-500">({q.memorization_level})</span>}
                  <span className="float-right text-xs text-gray-400">{q.assessment_date}</span>
                  {(q.teacher_comment || q.revision) && (
                    <p className="mt-1 text-xs text-gray-500">{q.teacher_comment}{q.revision ? ` · Revision: ${q.revision}` : ""}</p>
                  )}
                </div>
              ))}
              {!quran.length && <p className="text-sm text-gray-400">No Qur'an entries yet.</p>}
            </div>
            <div>
              {acad.map((a) => (
                <div key={a.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-silver/60 p-2.5 text-sm">
                  <span className="font-semibold text-navy">{a.subject}</span>
                  <span className="text-xs text-gray-500">{a.assessment_type}</span>
                  {a.score != null && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">{a.score}{a.max_score ? `/${a.max_score}` : ""}</span>}
                  {a.notes && <span className="text-xs text-gray-500">{a.notes}</span>}
                  <span className="ml-auto text-xs text-gray-400">{a.assessment_date}</span>
                </div>
              ))}
              {!acad.length && <p className="text-sm text-gray-400">No academic entries yet.</p>}
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Enrollment History</h2>
          {s.enrollments.length ? (
            <table className="w-full text-sm">
              <tbody>
                {s.enrollments.map((e) => (
                  <tr key={e.id} className="border-b last:border-0">
                    <td className="py-2 font-semibold text-navy">{e.school_year}</td>
                    <td className="py-2">{e.grade_name}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        e.status === "active" ? "bg-green-100 text-green-700" : e.status === "suspended" ? "bg-amber-100 text-amber-800"
                        : e.status === "withdrawn" ? "bg-red-100 text-red-700" : "bg-gray-200 text-gray-600"}`}>{e.status}</span>
                      {e.exit_date && <span className="ml-2 text-xs text-gray-500">{usDate(e.exit_date)}</span>}
                      {e.exit_reason && <div className="mt-0.5 text-xs text-gray-400">{e.exit_reason}</div>}
                    </td>
                    <td className="py-2 text-gray-400">{e.enrollment_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-400">No enrollments.</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Parents &amp; Guardians</h2>
            <button onClick={() => setGForm({ id: null, name: "", relationship: "father", phone: "", email: "" })}
              className="text-xs font-semibold text-royal hover:underline">+ Add parent / guardian</button>
          </div>
          {gForm && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-silver/50 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input placeholder="Full name" value={gForm.name} onChange={(e) => setGForm({ ...gForm, name: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <select value={gForm.relationship} onChange={(e) => setGForm({ ...gForm, relationship: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
                  {["father", "mother", "guardian"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input placeholder="Phone" value={gForm.phone} onChange={(e) => setGForm({ ...gForm, phone: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input placeholder="E-mail (links the portal login)" type="email" value={gForm.email} onChange={(e) => setGForm({ ...gForm, email: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500">The e-mail is what ties this parent to a Family Portal login and to their other children. Changing it here does not change the login itself.</p>
              <div className="mt-2 flex gap-2">
                <button onClick={saveGuardian} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-royal">{gForm.id ? "Save changes" : "Add"}</button>
                <button onClick={() => setGForm(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white">Cancel</button>
              </div>
            </div>
          )}
          {(() => {
            const accounts = s.parent_students.map((ps) => ps.profiles);
            const accOf = (email: string | null) => email ? accounts.find((a) => a.email?.toLowerCase() === email.toLowerCase()) : undefined;
            // "no portal account" is only worth saying when NO parent in the
            // family has one; if one parent holds the login, stay quiet on the other.
            const familyHasAccount = s.guardians.some((g) => accOf(g.email));
            const badge = (email: string | null) => {
              const acc = accOf(email);
              if (!acc) return familyHasAccount ? null
                : <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">no portal account</span>;
              return acc.must_change_password
                ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">invited — hasn't signed in</span>
                : <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">account active</span>;
            };
            const rows = [...s.guardians].sort((a, b) => a.sort - b.sort);
            if (!rows.length && !accounts.length)
              return <p className="text-sm text-gray-400">No parents on file yet.</p>;
            return (
              <>
                {rows.map((g) => (
                  <div key={g.id} className="border-b py-2 text-sm last:border-0"
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, g }); }}
                    title="Right-click for options">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/admin/parents/${g.id}`} className="font-semibold text-navy hover:text-royal hover:underline">{g.name}</Link>
                          <span className="text-xs capitalize text-gray-400">({g.relationship})</span>
                          {g.sort === 1 && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-navy">Primary contact</span>}
                          {badge(g.email)}
                        </div>
                        <div className="mt-0.5 text-gray-600">
                          {g.phone && <span className="mr-3">📞 {usPhone(g.phone)}</span>}
                          {g.email && <span>✉️ {g.email}</span>}
                        </div>
                        {g.email && addrMap[g.email.toLowerCase()] && (
                          <div className="mt-0.5 text-xs text-gray-500">🏠 {addrMap[g.email.toLowerCase()]}</div>
                        )}
                      </div>
                      <RelBadge r={g.relationship} size="lg" />
                    </div>
                  </div>
                ))}
                {/* accounts that exist but aren't in the guardians registry */}
                {accounts.filter((a) => !rows.some((g) => g.email?.toLowerCase() === a.email?.toLowerCase())).map((a, i) => (
                  <div key={"acc" + i} className="border-b py-2 text-sm last:border-0">
                    <span className="font-semibold text-navy">{a.full_name}</span>
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">portal account</span>
                    <div className="mt-0.5 text-gray-600">
                      {a.phone && <span className="mr-3">📞 {usPhone(a.phone)}</span>}
                      {a.email && <span>✉️ {a.email}</span>}
                    </div>
                    {a.email && addrMap[a.email.toLowerCase()] && (
                      <div className="mt-0.5 text-xs text-gray-500">🏠 {addrMap[a.email.toLowerCase()]}</div>
                    )}
                  </div>
                ))}
              </>
            );
          })()}
          {s.notes && (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-silver/60 p-3 text-xs text-gray-600">{s.notes}</p>
          )}
          {menu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
              <div className="fixed z-50 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-xl"
                style={{ left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 100) }}>
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{menu.g.name}</div>
                <button onClick={() => makePrimary(menu.g)} disabled={menu.g.sort === 1}
                  className="block w-full px-3 py-2 text-left hover:bg-silver disabled:cursor-default disabled:text-gray-400">
                  {menu.g.sort === 1 ? "✓ Already the primary contact" : "Make primary contact"}
                </button>
                <button onClick={() => { setMenu(null); nav(`/admin/parents/${menu.g.id}`); }}
                  className="block w-full px-3 py-2 text-left hover:bg-silver">Open parent profile</button>
                <button onClick={() => { setGForm({ id: menu.g.id, name: menu.g.name, relationship: menu.g.relationship, phone: menu.g.phone ?? "", email: menu.g.email ?? "" }); setMenu(null); }}
                  className="block w-full px-3 py-2 text-left hover:bg-silver">Edit details</button>
                <button onClick={() => removeGuardian(menu.g)}
                  className="block w-full px-3 py-2 text-left text-red-600 hover:bg-red-50">Remove from this student</button>
              </div>
            </>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-400">Emergency Contacts</h2>
            <button onClick={() => setCForm({ id: null, name: "", phone: "", relationship: "", is_primary: !s.emergency_contacts.length })}
              className="text-xs font-semibold text-royal hover:underline">+ Add contact</button>
          </div>
          {cForm && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-silver/50 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <input placeholder="Full name" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input placeholder="Phone" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <input placeholder="Relationship (aunt, neighbour …)" value={cForm.relationship} onChange={(e) => setCForm({ ...cForm, relationship: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={cForm.is_primary} onChange={(e) => setCForm({ ...cForm, is_primary: e.target.checked })} /> Primary contact</label>
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={saveContact} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-royal">{cForm.id ? "Save changes" : "Add"}</button>
                <button onClick={() => setCForm(null)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-white">Cancel</button>
              </div>
            </div>
          )}
          {s.emergency_contacts.length ? s.emergency_contacts.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-2 py-1 text-sm">
              <span className="font-semibold text-navy">{c.name}</span>
              <span className="text-gray-500">{usPhone(c.phone)}</span>
              {c.relationship && <span className="text-gray-400">({c.relationship})</span>}
              {c.is_primary && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-xs text-navy">Primary</span>}
              <span className="ml-auto whitespace-nowrap">
                <button onClick={() => setCForm({ id: c.id, name: c.name, phone: c.phone, relationship: c.relationship ?? "", is_primary: c.is_primary })} className="text-xs font-semibold text-royal hover:underline">Edit</button>
                <button onClick={() => removeContact(c)} className="ml-3 text-xs text-red-600 hover:underline">Remove</button>
              </span>
            </div>
          )) : <p className="text-sm font-semibold text-red-500">⚠ No emergency contact on file (BR-007).</p>}
        </section>

        {/* Digital forms: Allergy, Medical, Media consent — open in the shared dialog */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Health &amp; Consent Forms</h2>
          {!can("health") && <p className="text-sm text-gray-400">Health and consent forms are not part of your access.</p>}
          {can("health") && (["allergy", "medical", "consent"] as FormKind[]).map((k) => {
            const st = formStatus(k, med, consent);
            const summary = k === "allergy" ? allergySummary(med) : k === "medical" ? medicalSummary(med) : consentBadge(consent).title;
            return (
              <div key={k} className="border-b py-2 text-sm last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => setFormOpen(k)} className="font-semibold text-navy hover:text-royal hover:underline">{FORM_TITLE[k]}</button>
                  {st.done
                    ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">Completed {usDate(st.date)}</span>
                    : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">Not on file</span>}
                  {st.done && st.needsReview && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Updated by parent — review</span>}
                  {k === "consent" && st.done && (() => { const b = consentBadge(consent); return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${b.cls}`}>📷 {b.label}</span>; })()}
                  <button onClick={() => setFormOpen(k)}
                    className="ml-auto rounded-full border border-royal px-2.5 py-0.5 text-xs font-semibold text-royal hover:bg-royal hover:text-white">
                    {st.done ? "View / edit" : "Fill in"}
                  </button>
                </div>
                <div className={`mt-0.5 text-xs ${st.done ? "text-gray-600" : "text-gray-400"}`}>{st.done ? summary : "Parents are reminded on their portal home page until this is completed."}</div>
              </div>
            );
          })}
          <p className="mt-2 text-[11px] text-gray-400">Parents fill these in the Family Portal (Family Information → Forms). When a parent changes a medical answer every admin is notified; allergies, conditions or medication trigger an immediate e-mail.</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Required Documents</h2>
          {docTypes.map((t) => {
            const sub = s.document_references.find((d) => d.document_type === t.name);
            // a completed digital form satisfies its paper counterpart
            const kinds = FORM_DOC_TYPE[t.name] ?? [];
            const online = kinds.length > 0 && kinds.every((k) => formStatus(k, med, consent).done)
              ? kinds.map((k) => formStatus(k, med, consent).date!).sort().pop()! : null;
            const ok = !!sub || !!online;
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2.5 border-b py-2 text-sm last:border-0">
                <span className={ok ? "text-emerald-deep" : "text-gray-300"}>{ok ? "✅" : "⬜"}</span>
                <span className={ok ? "font-semibold text-navy" : "text-gray-500"}>{t.name}</span>
                {sub && <span className="text-xs text-gray-400">{new Date(sub.uploaded_date).toLocaleDateString()}</span>}
                {!sub && online && <span className="text-xs text-emerald-deep">completed online {usDate(online)}</span>}
                <span className="ml-auto flex items-center gap-2">
                  {sub && (sub.storage_path || sub.file_url) && (
                    <button onClick={() => viewDoc(sub)}
                      className="rounded-full border border-royal px-2.5 py-0.5 text-xs font-semibold text-royal hover:bg-royal hover:text-white">View</button>
                  )}
                  <label className="cursor-pointer rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                    {sub?.storage_path ? "Replace file" : "Upload scan"}
                    <input type="file" accept="application/pdf,image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadDoc(t.name, f); e.target.value = ""; }} />
                  </label>
                  {!sub && online ? null : !sub ? (
                    <button onClick={() => markDoc(t.name)}
                      className="rounded-full border border-gray-300 px-2.5 py-0.5 text-xs font-semibold text-gray-600 hover:bg-silver">Mark received</button>
                  ) : (
                    <button onClick={() => clearDoc(sub)}
                      className="rounded-full border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-500 hover:bg-red-50">Clear</button>
                  )}
                </span>
              </div>
            );
          })}
          {/* legacy rows whose type is not in the registry */}
          {s.document_references.filter((d) => !docTypes.some((t) => t.name === d.document_type)).map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <button onClick={() => viewDoc(d)} className="font-semibold text-royal hover:underline">{d.document_type}</button>
              <span className="text-xs text-gray-400">{new Date(d.uploaded_date).toLocaleDateString()}</span>
            </div>
          ))}
          <p className="mt-2 text-[11px] text-gray-400">Manage the required-forms list in Settings. Parents see this checklist (and any uploaded scans) in their portal.</p>
        </section>
      </div>

      {formOpen && (
        <StudentFormDialog kind={formOpen} studentId={s.id} studentName={`${s.first_name} ${s.last_name}`} isAdmin={can("health", "edit")} signerName=""
          onClose={() => setFormOpen(null)} onSaved={load} />
      )}
    </div>
  );
}
