import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr, monthStr } from "../../lib/dates";

interface AttRow { date: string; status: "present" | "late" | "absent" }
interface FeeInfo { total_amount: number; billing_frequency: string; start_date: string | null; payments: { payment_date: string; amount: number; payment_method: string }[] }
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
  enrollments: { id: string; school_year: string; grade_name: string; status: string; enrollment_date: string }[];
  parent_students: { profiles: { full_name: string; email: string | null; phone: string | null; must_change_password: boolean } }[];
  guardians: { id: string; name: string; relationship: string; phone: string | null; email: string | null; sort: number }[];
  emergency_contacts: { id: string; name: string; phone: string; relationship: string | null; is_primary: boolean }[];
  medical_info: { allergies: string | null; medical_conditions: string | null; medications: string | null } | null;
  document_references: { id: string; document_type: string; file_url: string; uploaded_date: string }[];
}

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
        enrollments ( id, school_year, grade_name, status, enrollment_date ),
        parent_students ( profiles ( full_name, email, phone, must_change_password ) ),
        guardians ( id, name, relationship, phone, email, sort ),
        emergency_contacts ( id, name, phone, relationship, is_primary ),
        medical_info ( allergies, medical_conditions, medications ),
        document_references ( id, document_type, file_url, uploaded_date )`)
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
      .select("total_amount, billing_frequency, start_date, payments ( payment_date, amount, payment_method )")
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
            {s.date_of_birth && <> · DOB {s.date_of_birth}</>}
            {s.gender && <> · {s.gender}</>}
            {s.archived && <span className="ml-2 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-600">Archived</span>}
          </div>
        </div>
        </div>
        <button onClick={toggleArchive}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
          {s.archived ? "Restore" : "Archive"}
        </button>
      </div>

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
                  ) : feeInfo.payments.some((p) => p.payment_date.startsWith(monthStr())) ? (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Paid this month ✓</span>
                  ) : (
                    <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">Not paid (due by the 5th)</span>
                  )}
                </div>
                {[...feeInfo.payments].sort((a, b) => b.payment_date.localeCompare(a.payment_date)).slice(0, 5).map((p, i) => (
                  <div key={i} className="flex justify-between border-b py-1 text-sm last:border-0">
                    <span className="text-gray-500">{p.payment_date}</span>
                    <span className="font-semibold text-navy">${Number(p.amount).toFixed(2)}</span>
                    <span className="text-xs text-gray-400">{p.payment_method}</span>
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
                    <td className="py-2 text-gray-500">{e.status}</td>
                    <td className="py-2 text-gray-400">{e.enrollment_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-sm text-gray-400">No enrollments.</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Parents &amp; Guardians</h2>
          {(() => {
            const accounts = s.parent_students.map((ps) => ps.profiles);
            const badge = (email: string | null) => {
              const acc = email ? accounts.find((a) => a.email?.toLowerCase() === email.toLowerCase()) : undefined;
              if (!acc) return <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">no portal account</span>;
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
                  <div key={g.id} className="border-b py-2 text-sm last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy">{g.name}</span>
                      <span className="text-xs capitalize text-gray-400">({g.relationship})</span>
                      {badge(g.email)}
                    </div>
                    <div className="mt-0.5 text-gray-600">
                      {g.phone && <span className="mr-3">📞 {g.phone}</span>}
                      {g.email && <span>✉️ {g.email}</span>}
                    </div>
                    {g.email && addrMap[g.email.toLowerCase()] && (
                      <div className="mt-0.5 text-xs text-gray-500">🏠 {addrMap[g.email.toLowerCase()]}</div>
                    )}
                  </div>
                ))}
                {/* accounts that exist but aren't in the guardians registry */}
                {accounts.filter((a) => !rows.some((g) => g.email?.toLowerCase() === a.email?.toLowerCase())).map((a, i) => (
                  <div key={"acc" + i} className="border-b py-2 text-sm last:border-0">
                    <span className="font-semibold text-navy">{a.full_name}</span>
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">portal account</span>
                    <div className="mt-0.5 text-gray-600">
                      {a.phone && <span className="mr-3">📞 {a.phone}</span>}
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
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Emergency Contacts</h2>
          {s.emergency_contacts.length ? s.emergency_contacts.map((c) => (
            <div key={c.id} className="py-1 text-sm">
              <span className="font-semibold text-navy">{c.name}</span>
              <span className="ml-2 text-gray-500">{c.phone}</span>
              {c.relationship && <span className="ml-2 text-gray-400">({c.relationship})</span>}
              {c.is_primary && <span className="ml-2 rounded-full bg-gold/20 px-2 py-0.5 text-xs text-navy">Primary</span>}
            </div>
          )) : <p className="text-sm font-semibold text-red-500">⚠ No emergency contact on file (BR-007).</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Medical Information</h2>
          {s.medical_info ? (
            <dl className="space-y-1 text-sm">
              <div><dt className="inline font-semibold text-navy">Allergies: </dt><dd className="inline text-gray-600">{s.medical_info.allergies || "None recorded"}</dd></div>
              <div><dt className="inline font-semibold text-navy">Conditions: </dt><dd className="inline text-gray-600">{s.medical_info.medical_conditions || "None recorded"}</dd></div>
              <div><dt className="inline font-semibold text-navy">Medications: </dt><dd className="inline text-gray-600">{s.medical_info.medications || "None recorded"}</dd></div>
            </dl>
          ) : <p className="text-sm text-gray-400">No medical information recorded.</p>}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Documents (stored in Google Drive)</h2>
          {s.document_references.length ? s.document_references.map((d) => (
            <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
              <a href={d.file_url} target="_blank" rel="noreferrer" className="font-semibold text-royal hover:underline">{d.document_type}</a>
              <span className="text-xs text-gray-400">{new Date(d.uploaded_date).toLocaleDateString()}</span>
            </div>
          )) : <p className="text-sm text-gray-400">No documents referenced.</p>}
        </section>
      </div>
    </div>
  );
}
