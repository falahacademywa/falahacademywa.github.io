import { useEffect, useMemo, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { todayStr, monthStr } from "../../lib/dates";
import { useAuth } from "../../lib/auth";

interface Child {
  student_id: string;
  students: {
    id: string;
    first_name: string;
    last_name: string;
    profile_photo_url: string | null;
    photo_pending_url: string | null;
    enrollments: { id: string; grade_name: string; school_year: string; status: string }[];
  };
}
interface AttRow { date: string; status: "present" | "late" | "absent" }
interface QuranRow {
  id: number; assessment_date: string; category: string; surah_topic: string;
  ayah_from: number | null; ayah_to: number | null; memorization_level: string | null;
  teacher_comment: string | null; revision: string | null;
}
interface AcadRow { id: number; assessment_date: string; subject: string; assessment_type: string; score: number | null; max_score: number | null; notes: string | null }
interface FeePlan { id: string; total_amount: number; billing_frequency: string; start_date: string | null; payments: { payment_date: string; amount: number; payment_method: string }[] }
interface Notif { id: number; title: string; message: string; priority: string; is_read: boolean; created_at: string }

// Payment channels shown in the "How to pay" dialog. Bank account details are
// deliberately NOT here — this bundle is publicly readable; the office shares
// them directly with families who ask.
const PAY_INFO = {
  zelle: { name: "Falah Academy", contact: "falahacademywa@gmail.com" },
  note: "Please include your child's name in the payment memo.",
};
interface Asg { id: string; subject: string; title: string; instructions: string | null; file_url: string | null; assigned_date: string; due_date: string | null }
interface Update {
  id: string; subject: string; note: string; update_date: string; homework_due: string | null;
  attachment_url: string | null; attachment_thumb: string | null;
  grade_id: number | null; enrollment_id: string | null; grades: { name: string } | null;
}
interface Ev { id: string; title: string; event_type: string; start_date: string; end_date: string | null; location: string | null; rsvp_enabled: boolean }
interface EcRow { id: string | null; student_id: string; name: string; phone: string; relationship: string; del?: boolean }
interface Ann { id: string; title: string; content: string; category: string; is_pinned: boolean; requires_ack: boolean; publish_date: string | null; announcement_acks: { parent_id: string }[] }

export default function ParentHome() {
  const { profile, session, signOut } = useAuth();
  const [children, setChildren] = useState<Child[]>([]);
  const [active, setActive] = useState<Child | null>(null);
  const [month, setMonth] = useState(() => monthStr());
  const [att, setAtt] = useState<AttRow[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [anns, setAnns] = useState<Ann[]>([]);
  const [quran, setQuran] = useState<QuranRow[]>([]);
  const [acad, setAcad] = useState<AcadRow[]>([]);
  const [fee, setFee] = useState<FeePlan | null>(null);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [asgs, setAsgs] = useState<Asg[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [feeSummary, setFeeSummary] = useState<{ due: number; anyStarted: boolean; futureStart: string | null; hasPaidPlans: boolean } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [calModalOpen, setCalModalOpen] = useState(false);
  const [allEvents, setAllEvents] = useState<Ev[] | null>(null);
  const [fbOpen, setFbOpen] = useState(false);
  const [fbCategory, setFbCategory] = useState("general");
  const [fbMessage, setFbMessage] = useState("");
  const [fbState, setFbState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [myOpen, setMyOpen] = useState(false);
  const [famTab, setFamTab] = useState<"students" | "parents" | "contacts">("students");
  const [famEdit, setFamEdit] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState<(() => void) | null>(null);
  const [myPhone, setMyPhone] = useState("");
  const [myAddress, setMyAddress] = useState("");
  const [mySaved, setMySaved] = useState({ phone: "", address: "" });
  const [myState, setMyState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [addrReady, setAddrReady] = useState(true);
  const [famGuardians, setFamGuardians] = useState<{ name: string; relationship: string; phone: string | null; email: string | null }[]>([]);
  const [ecOrig, setEcOrig] = useState<EcRow[]>([]);
  const [ecDraft, setEcDraft] = useState<EcRow[]>([]);

  const ICS_URL = "https://falahacademywa.org/falah-academy-2026-2027.ics";

  async function openFullCalendar() {
    setCalModalOpen(true);
    if (allEvents === null && !configMissing) {
      const { data } = await supabase
        .from("calendar_events")
        .select("id, title, event_type, start_date, end_date, location, rsvp_enabled")
        .order("start_date");
      setAllEvents((data as Ev[]) ?? []);
    }
  }

  // Family-wide amount due: for every child's plan, each month since the plan
  // started (through the current month) with no recorded payment adds one
  // monthly amount. $0 plans and not-yet-started plans contribute nothing.
  useEffect(() => {
    if (configMissing || !children.length) { setFeeSummary(null); return; }
    const enrIds = children
      .map((c) => (c.students.enrollments.find((e) => e.status === "active") ?? c.students.enrollments[0])?.id)
      .filter(Boolean) as string[];
    if (!enrIds.length) return;
    supabase.from("fee_plans")
      .select("total_amount, billing_frequency, start_date, enrollment_id, payments ( payment_date )")
      .in("enrollment_id", enrIds)
      .then(({ data }) => {
        const today = new Date();
        const todayIso = todayStr();
        const curKey = todayIso.slice(0, 7);
        let due = 0, anyStarted = false, hasPaidPlans = false;
        let futureStart: string | null = null;
        ((data as any[]) ?? []).forEach((p) => {
          const amt = Number(p.total_amount);
          if (!amt || p.billing_frequency !== "monthly") return;
          hasPaidPlans = true;
          if (p.start_date && p.start_date > todayIso) {
            if (!futureStart || p.start_date < futureStart) futureStart = p.start_date;
            return; // not started: contributes nothing yet
          }
          anyStarted = true;
          const start = p.start_date ? new Date(p.start_date + "T12:00:00") : today;
          const paidMonths = new Set((p.payments ?? []).map((x: { payment_date: string }) => x.payment_date.slice(0, 7)));
          const d = new Date(start.getFullYear(), start.getMonth(), 1);
          while (true) {
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            if (key > curKey) break;
            if (!paidMonths.has(key)) due += amt;
            d.setMonth(d.getMonth() + 1);
          }
        });
        setFeeSummary({ due, anyStarted, futureStart, hasPaidPlans });
      });
  }, [children]);

  useEffect(() => {
    if (configMissing) return;
    (async () => {
      const today = todayStr();
      const [{ data: kids }, { data: evs }, { data: as }] = await Promise.all([
        supabase.from("parent_students")
          .select("student_id, students ( id, first_name, last_name, profile_photo_url, photo_pending_url, enrollments ( id, grade_name, school_year, status ) )")
          .order("student_id"),
        supabase.from("calendar_events").select("id, title, event_type, start_date, end_date, location, rsvp_enabled")
          .gte("start_date", today).order("start_date").limit(6),
        supabase.from("announcements")
          .select("id, title, content, category, is_pinned, requires_ack, publish_date, announcement_acks ( parent_id )")
          .eq("status", "published")
          .order("is_pinned", { ascending: false })
          .order("publish_date", { ascending: false })
          .limit(10),
      ]);
      const c = (kids as unknown as Child[]) ?? [];
      setChildren(c);
      setActive(c[0] ?? null);
      setEvents(evs ?? []);
      setAnns((as as unknown as Ann[]) ?? []);
      const { data: n } = await supabase.from("notifications")
        .select("id, title, message, priority, is_read, created_at")
        .order("created_at", { ascending: false }).limit(20);
      setNotifs((n as Notif[]) ?? []);
    })();
  }, []);

  // Per-child data: Qur'an, academics, fees
  useEffect(() => {
    if (configMissing || !active) { setQuran([]); setAcad([]); setFee(null); return; }
    const enr = active.students.enrollments.find((e) => e.status === "active") ?? active.students.enrollments[0];
    if (!enr) return;
    supabase.from("quran_progress").select("*").eq("enrollment_id", enr.id)
      .order("assessment_date", { ascending: false }).limit(8)
      .then(({ data }) => setQuran((data as QuranRow[]) ?? []));
    supabase.from("academic_progress").select("*").eq("enrollment_id", enr.id)
      .order("assessment_date", { ascending: false }).limit(40)
      .then(({ data }) => setAcad((data as AcadRow[]) ?? []));
    supabase.from("fee_plans")
      .select("id, total_amount, billing_frequency, start_date, payments ( payment_date, amount, payment_method )")
      .eq("enrollment_id", enr.id).maybeSingle()
      .then(({ data }) => setFee((data as unknown as FeePlan) ?? null));
    // Assignments: grade-wide for this child's grade + individual ones.
    // RLS already limits rows to this family; filter client-side per child.
    supabase.from("assignments")
      .select("id, subject, title, instructions, file_url, assigned_date, due_date, grade_id, enrollment_id, grades ( name )")
      .order("assigned_date", { ascending: false }).limit(30)
      .then(({ data }) => {
        const rows = ((data as any[]) ?? []).filter((a) =>
          a.enrollment_id === enr.id ||
          (a.grade_id != null && a.grades?.name === (active.students.enrollments.find((e) => e.status === "active")?.grade_name ?? "")));
        setAsgs(rows as Asg[]);
      });
    // Class updates feed: teacher notes for this child's grade + individual ones
    supabase.from("class_updates")
      .select("id, subject, note, update_date, homework_due, attachment_url, attachment_thumb, grade_id, enrollment_id, grades ( name )")
      .order("created_at", { ascending: false }).limit(20)
      .then(({ data }) => {
        const gradeName = active.students.enrollments.find((e) => e.status === "active")?.grade_name ?? "";
        const rows = ((data as unknown as Update[]) ?? []).filter((u) =>
          u.enrollment_id === enr.id || (u.grade_id != null && u.grades?.name === gradeName));
        setUpdates(rows);
      });
  }, [active]);

  async function uploadPhoto(file: File) {
    if (!active) return;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${active.students.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("student-photos").upload(path, file);
    if (error) { alert("Upload failed: " + error.message); return; }
    const { data } = supabase.storage.from("student-photos").getPublicUrl(path);
    const { error: e2 } = await supabase.rpc("request_student_photo", { sid: active.students.id, url: data.publicUrl });
    if (e2) { alert("Request failed: " + e2.message); return; }
    setChildren((prev) => prev.map((c) => c.student_id === active.student_id
      ? { ...c, students: { ...c.students, photo_pending_url: data.publicUrl } } : c));
    setActive((prev) => prev
      ? { ...prev, students: { ...prev.students, photo_pending_url: data.publicUrl } } : prev);
    alert("Photo submitted! It will appear once the school approves it.");
  }

  async function openMyInfo() {
    setMyOpen(true);
    setMyState("idle");
    if (!session || configMissing) return;
    // address ships ahead of the phase-10 column in some environments —
    // fall back to phone-only if the column isn't there yet.
    const r = await supabase.from("profiles").select("phone, address").eq("id", session.user.id).single();
    let row: { phone?: string | null; address?: string | null } | null = r.data;
    if (r.error) {
      setAddrReady(false);
      const r2 = await supabase.from("profiles").select("phone").eq("id", session.user.id).single();
      row = r2.data;
    }
    setMyPhone(row?.phone ?? "");
    setMyAddress(row?.address ?? "");
    setMySaved({ phone: row?.phone ?? "", address: row?.address ?? "" });
    // Family review: both parents (guardians registry) and emergency contacts
    // for this family's children. RLS limits both to the parent's own kids.
    const sids = children.map((c) => c.students.id);
    if (sids.length) {
      const [{ data: g }, { data: ec }] = await Promise.all([
        supabase.from("guardians").select("name, relationship, phone, email, sort").in("student_id", sids).order("sort"),
        supabase.from("emergency_contacts").select("id, student_id, name, phone, relationship").in("student_id", sids),
      ]);
      const seen = new Map<string, { name: string; relationship: string; phone: string | null; email: string | null }>();
      ((g as { name: string; relationship: string; phone: string | null; email: string | null }[]) ?? [])
        .forEach((x) => { const k = (x.email ?? x.name).toLowerCase(); if (!seen.has(k)) seen.set(k, x); });
      setFamGuardians([...seen.values()]);
      const rows = ((ec as { id: string; student_id: string; name: string; phone: string; relationship: string | null }[]) ?? [])
        .map((x) => ({ id: x.id, student_id: x.student_id, name: x.name, phone: x.phone, relationship: x.relationship ?? "" }));
      setEcOrig(rows);
      setEcDraft(rows.map((x) => ({ ...x })));
    }
  }

  // Unsaved edits on the current Family Information tab?
  const famDirty = famEdit && (
    famTab === "parents" ? myPhone !== mySaved.phone || myAddress !== mySaved.address
      : famTab === "contacts" ? JSON.stringify(ecDraft) !== JSON.stringify(ecOrig)
        : false);

  function closeFamily() {
    setMyOpen(false); setFamEdit(false); setConfirmDiscard(null);
    setMyPhone(mySaved.phone); setMyAddress(mySaved.address);
    setEcDraft(ecOrig.map((x) => ({ ...x })));
  }
  function requestCloseFamily() {
    if (famDirty) setConfirmDiscard(() => closeFamily);
    else closeFamily();
  }
  function switchFamTab(t: "students" | "parents" | "contacts") {
    if (t === famTab) return;
    const go = () => {
      setFamEdit(false); setMyState("idle"); setConfirmDiscard(null);
      setMyPhone(mySaved.phone); setMyAddress(mySaved.address);
      setEcDraft(ecOrig.map((x) => ({ ...x })));
      setFamTab(t);
    };
    if (famDirty) setConfirmDiscard(() => go);
    else go();
  }
  function cancelFamEdit() {
    setMyPhone(mySaved.phone); setMyAddress(mySaved.address);
    setEcDraft(ecOrig.map((x) => ({ ...x })));
    setFamEdit(false); setMyState("idle");
  }

  async function saveFamily() {
    if (!session || myState === "saving") return;
    setMyState("saving");
    let failed = false;
    if (famTab === "parents") {
      const patch: Record<string, string | null> = { phone: myPhone.trim() || null };
      if (addrReady) patch.address = myAddress.trim() || null;
      const { error } = await supabase.from("profiles").update(patch).eq("id", session.user.id);
      failed = !!error;
      if (!failed) {
        setMySaved({ phone: myPhone.trim(), address: addrReady ? myAddress.trim() : mySaved.address });
        setMyPhone(myPhone.trim());
        setMyAddress(addrReady ? myAddress.trim() : mySaved.address);
      }
    } else if (famTab === "contacts") {
      for (const c of ecDraft) {
        if (c.del) {
          if (c.id) { const { error } = await supabase.from("emergency_contacts").delete().eq("id", c.id); failed = failed || !!error; }
          continue;
        }
        if (!c.name.trim() || !c.phone.trim()) continue; // ignore incomplete rows
        const vals = { name: c.name.trim(), phone: c.phone.trim(), relationship: c.relationship.trim() || null };
        if (c.id) {
          const orig = ecOrig.find((o) => o.id === c.id);
          if (orig && (orig.name !== c.name || orig.phone !== c.phone || orig.relationship !== c.relationship)) {
            const { error } = await supabase.from("emergency_contacts").update(vals).eq("id", c.id);
            failed = failed || !!error;
          }
        } else {
          const { error } = await supabase.from("emergency_contacts").insert({ student_id: c.student_id, ...vals });
          failed = failed || !!error;
        }
      }
      const sids = children.map((c) => c.students.id);
      const { data: ec } = await supabase.from("emergency_contacts")
        .select("id, student_id, name, phone, relationship").in("student_id", sids);
      const rows = ((ec as { id: string; student_id: string; name: string; phone: string; relationship: string | null }[]) ?? [])
        .map((x) => ({ id: x.id, student_id: x.student_id, name: x.name, phone: x.phone, relationship: x.relationship ?? "" }));
      setEcOrig(rows);
      setEcDraft(rows.map((x) => ({ ...x })));
    }
    setMyState(failed ? "error" : "saved");
    if (!failed) setFamEdit(false);
  }

  async function sendFeedback() {
    if (!session || !fbMessage.trim() || fbState === "sending") return;
    setFbState("sending");
    const { error } = await supabase.from("feedback")
      .insert({ parent_id: session.user.id, category: fbCategory, message: fbMessage.trim() });
    if (error) { setFbState("error"); return; }
    setFbState("sent");
    setFbMessage("");
  }

  // Escape closes whichever popup is on top; Family Information asks before
  // dropping unsaved edits. Re-registered every render so closures stay fresh.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (confirmDiscard) { setConfirmDiscard(null); return; }
      if (myOpen) { requestCloseFamily(); return; }
      if (fbOpen) { setFbOpen(false); return; }
      if (payOpen) { setPayOpen(false); return; }
      if (calModalOpen) { setCalModalOpen(false); return; }
      if (bellOpen) setBellOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function markAllRead() {
    const unread = notifs.filter((n) => !n.is_read).map((n) => n.id);
    if (unread.length) {
      await supabase.from("notifications").update({ is_read: true }).in("id", unread);
      setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
    }
  }

  useEffect(() => {
    if (configMissing || !active) return;
    const enrollment = active.students.enrollments.find((e) => e.status === "active") ?? active.students.enrollments[0];
    if (!enrollment) { setAtt([]); return; }
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    supabase.from("attendance")
      .select("date, status")
      .eq("enrollment_id", enrollment.id)
      .gte("date", `${month}-01`)
      .lte("date", `${month}-${String(last).padStart(2, "0")}`)
      .then(({ data }) => setAtt((data as AttRow[]) ?? []));
  }, [active, month]);

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
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      cells.push({ day: d, status: map.get(key) });
    }
    return cells;
  }, [month, att]);

  async function ack(a: Ann) {
    if (!session) return;
    await supabase.from("announcement_acks").insert({ announcement_id: a.id, parent_id: session.user.id });
    setAnns((prev) => prev.map((x) => x.id === a.id
      ? { ...x, announcement_acks: [...x.announcement_acks, { parent_id: session.user.id }] } : x));
  }

  const activeEnrollment = active?.students.enrollments.find((e) => e.status === "active") ?? active?.students.enrollments[0];
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

  return (
    <div className="min-h-screen bg-silver">
      <header className="bg-navy px-4 py-3 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="../images/logo.jpg" alt="" className="h-9 w-9 rounded-full object-cover" />
            <div>
              <div className="font-display text-sm font-semibold leading-tight">Falah Academy</div>
              <div className="text-[11px] text-gold-light">Family Portal</div>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="relative">
              <button onClick={() => { setBellOpen(!bellOpen); if (!bellOpen) markAllRead(); }}
                className="relative text-xl" aria-label="Notifications">
                🔔
                {notifs.some((n) => !n.is_read) && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {notifs.filter((n) => !n.is_read).length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 z-20 mt-2 max-h-96 w-80 overflow-y-auto rounded-xl bg-white p-2 text-gray-800 shadow-2xl">
                  {notifs.map((n) => (
                    <div key={n.id} className="border-b p-2.5 text-sm last:border-0">
                      <div className="flex items-center gap-1.5 font-semibold text-navy">
                        {n.priority === "action" ? "🔴" : n.priority === "important" ? "🟡" : "🔵"} {n.title}
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">{n.message}</p>
                      <p className="mt-0.5 text-[10px] text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
                    </div>
                  ))}
                  {!notifs.length && <p className="p-3 text-sm text-gray-400">No notifications.</p>}
                </div>
              )}
            </div>
            <button onClick={openMyInfo} className="hidden text-white/70 underline hover:text-white sm:inline">{profile?.full_name}</button>
            <button onClick={openMyInfo} className="text-white/70 underline hover:text-white sm:hidden">My Info</button>
            <button onClick={signOut} className="text-white/70 underline hover:text-white">Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-5 p-4 lg:p-6">
        {configMissing && <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">Platform is not connected to a database yet.</div>}

        {/* Child switcher */}
        {children.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {children.map((c) => (
              <button key={c.student_id} onClick={() => setActive(c)}
                className={`flex items-center gap-2.5 rounded-full py-1.5 pl-1.5 pr-5 text-base font-semibold transition ${
                  active?.student_id === c.student_id ? "bg-navy text-white shadow-md" : "border border-gray-300 bg-white text-gray-600 hover:bg-white/60"}`}>
                {c.students.profile_photo_url ? (
                  <img src={c.students.profile_photo_url} alt=""
                    className={`h-12 w-12 rounded-full object-cover ${active?.student_id === c.student_id ? "border-2 border-gold" : "border border-gray-200"}`} />
                ) : (
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full text-lg font-bold ${
                    active?.student_id === c.student_id ? "bg-white/20 text-white" : "bg-navy/10 text-navy"}`}>
                    {c.students.first_name[0]}
                  </span>
                )}
                {c.students.first_name}
                {c.students.enrollments[0] && <span className="text-sm opacity-70">· {c.students.enrollments.find((e) => e.status === "active")?.grade_name ?? c.students.enrollments[0].grade_name}</span>}
              </button>
            ))}
            {active && (
              active.students.photo_pending_url ? (
                <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">⏳ Photo pending approval</span>
              ) : (
                <label className="cursor-pointer rounded-full border-2 border-royal bg-white px-4 py-2 text-sm font-semibold text-royal transition hover:bg-royal hover:text-white">
                  📷 {active.students.profile_photo_url ? `Change ${active.students.first_name}'s photo` : `Add ${active.students.first_name}'s photo`}
                  <input type="file" accept="image/*" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                </label>
              )
            )}
            <button onClick={() => { setFbOpen(true); setFbState("idle"); }}
              className="ml-auto rounded-full border-2 border-emerald-brand bg-white px-4 py-2 text-sm font-semibold text-emerald-deep transition hover:bg-emerald-brand hover:text-white">
              💬 Feedback
            </button>
          </div>
        )}
        {!configMissing && !children.length && (
          <div className="rounded-xl bg-white p-6 text-sm text-gray-500 shadow-sm">
            Assalamu Alaikum{profile ? `, ${profile.full_name}` : ""} — no students are linked to your account yet. Please contact the school office.
          </div>
        )}

        {/* Family fees banner: shown ONLY when something is due */}
        {feeSummary && feeSummary.due > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-3">
            <span className="text-sm font-semibold text-red-700">
              Fees due: <span className="font-display text-lg">${feeSummary.due.toFixed(0)}</span>
            </span>
            <span className="text-xs text-red-600">Due by the 5th of the month.</span>
            <button onClick={() => setPayOpen(true)}
              className="ml-auto rounded-full bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700">
              How to pay
            </button>
          </div>
        )}

        {/* How-to-pay dialog */}
        {payOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPayOpen(false)}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-navy">How to pay</h3>
                <button onClick={() => setPayOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
              </div>
              <div className="space-y-4 text-sm">
                <div className="rounded-xl bg-silver p-4">
                  <div className="mb-1 font-bold text-navy">Zelle (preferred)</div>
                  <div className="text-gray-700">Recipient: {PAY_INFO.zelle.name}</div>
                  <div className="text-gray-700">Send to: <span className="font-semibold">{PAY_INFO.zelle.contact}</span></div>
                </div>
                <div className="rounded-xl bg-silver p-4">
                  <div className="mb-1 font-bold text-navy">Bank transfer</div>
                  <div className="text-gray-700">Contact the school office for account-transfer details.</div>
                </div>
                <p className="text-xs text-gray-500">{PAY_INFO.note} Cash and check are also accepted at the school office. Your payment appears here once the office records it.</p>
              </div>
            </div>
          </div>
        )}

        {/* Family Information dialog: side tabs, read-only until ✏️ Edit */}
        {myOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={requestCloseFamily}>
            <div className="flex max-h-[85vh] min-h-[26rem] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              {/* Side tabs */}
              <div className="flex w-28 shrink-0 flex-col gap-1 border-r bg-silver/60 p-2 sm:w-44 sm:p-3">
                <div className="hidden px-2 pb-3 pt-1 font-display text-sm font-semibold leading-tight text-navy sm:block">Family Information</div>
                {([["students", "🎓", "Students"], ["parents", "👤", "Parents"], ["contacts", "🚑", "Emergency"]] as const).map(([key, icon, label]) => (
                  <button key={key} onClick={() => switchFamTab(key)}
                    className={`rounded-lg px-2 py-2 text-left text-xs font-semibold transition sm:px-3 sm:text-sm ${
                      famTab === key ? "bg-navy text-white shadow" : "text-gray-600 hover:bg-white"}`}>
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold text-navy">
                    {famTab === "students" ? "Student Information" : famTab === "parents" ? "Parents" : "Emergency Contacts"}
                  </h3>
                  <div className="flex items-center gap-2">
                    {famTab !== "students" && !famEdit && (
                      <button onClick={() => { setFamEdit(true); setMyState("idle"); }}
                        className="flex items-center gap-1 rounded-full border-2 border-royal px-3 py-1 text-xs font-bold text-royal transition hover:bg-royal hover:text-white">
                        ✏️ Edit
                      </button>
                    )}
                    <button onClick={requestCloseFamily} className="px-1 text-gray-400 hover:text-navy">✕</button>
                  </div>
                </div>

                {famTab === "students" && (
                  <div className="space-y-2 text-sm">
                    {children.map((c) => (
                      <div key={c.student_id} className="rounded-xl bg-silver/60 p-3">
                        <span className="font-semibold text-navy">{c.students.first_name} {c.students.last_name}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          {c.students.enrollments.find((e) => e.status === "active")?.grade_name ?? c.students.enrollments[0]?.grade_name}
                        </span>
                        {addrReady && mySaved.address.trim() && (
                          <div className="mt-1 text-xs text-gray-600">🏠 {mySaved.address.trim()}</div>
                        )}
                      </div>
                    ))}
                    <p className="pt-1 text-[11px] text-gray-400">
                      Student names and grades are managed by the school office. The home address can be updated under the Parents tab.
                    </p>
                  </div>
                )}

                {famTab === "parents" && (
                  <div className="space-y-3 text-sm">
                    <div className={`rounded-xl p-3 ${famEdit ? "border-2 border-royal/40" : "bg-silver/60"}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-navy">{profile?.full_name}</span>
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-deep">you</span>
                      </div>
                      <div className="mt-1 text-xs text-gray-500">✉️ {session?.user.email} <span className="text-gray-400">· login email — office-managed</span></div>
                      <div className="mt-3 space-y-2.5">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Phone
                          <input disabled={!famEdit} value={myPhone}
                            onChange={(e) => { setMyPhone(e.target.value); setMyState("idle"); }}
                            placeholder="(555) 123-4567"
                            className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm font-normal normal-case tracking-normal text-gray-800 disabled:border-gray-200 disabled:bg-white/60 disabled:text-gray-500" />
                        </label>
                        {addrReady && (
                          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-400">Home address
                            <textarea disabled={!famEdit} rows={2} value={myAddress}
                              onChange={(e) => { setMyAddress(e.target.value); setMyState("idle"); }}
                              placeholder="Street, City, State ZIP"
                              className="mt-1 w-full rounded-lg border border-gray-300 p-2 text-sm font-normal normal-case tracking-normal text-gray-800 disabled:border-gray-200 disabled:bg-white/60 disabled:text-gray-500" />
                          </label>
                        )}
                      </div>
                    </div>
                    {famGuardians
                      .filter((g) => (g.email ?? "").toLowerCase() !== (session?.user.email ?? "").toLowerCase())
                      .map((g, i) => (
                        <div key={i} className="rounded-xl bg-silver/60 p-3">
                          <span className="font-semibold text-navy">{g.name}</span>
                          <span className="ml-2 text-xs capitalize text-gray-400">({g.relationship})</span>
                          <div className="mt-0.5 text-xs text-gray-600">
                            {g.phone && <span className="mr-3">📞 {g.phone}</span>}
                            {g.email && <span>✉️ {g.email}</span>}
                          </div>
                        </div>
                      ))}
                    <p className="pt-1 text-[11px] text-gray-400">
                      Names, login emails, and the other parent's details are updated by the school office.
                    </p>
                  </div>
                )}

                {famTab === "contacts" && (
                  <div className="space-y-4 text-sm">
                    {children.map((c) => {
                      const rows = ecDraft.filter((x) => x.student_id === c.students.id && !x.del);
                      return (
                        <div key={c.student_id}>
                          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">For {c.students.first_name}</div>
                          {!rows.length && !famEdit && (
                            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                              ⚠ No emergency contact on file — tap ✏️ Edit to add one.
                            </p>
                          )}
                          {rows.map((r) => {
                            const idx = ecDraft.indexOf(r);
                            const upd = (patch: Partial<EcRow>) =>
                              setEcDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
                            return famEdit ? (
                              <div key={idx} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 p-2.5">
                                <input value={r.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Full name"
                                  className="min-w-0 flex-1 basis-36 rounded-lg border border-gray-300 p-2 text-sm" />
                                <input value={r.phone} onChange={(e) => upd({ phone: e.target.value })} placeholder="Phone"
                                  className="min-w-0 flex-1 basis-28 rounded-lg border border-gray-300 p-2 text-sm" />
                                <input value={r.relationship} onChange={(e) => upd({ relationship: e.target.value })} placeholder="Relationship"
                                  className="min-w-0 flex-1 basis-28 rounded-lg border border-gray-300 p-2 text-sm" />
                                <button onClick={() => upd({ del: true })} title="Remove this contact"
                                  className="px-1 text-red-400 hover:text-red-600">🗑</button>
                              </div>
                            ) : (
                              <div key={idx} className="mb-2 rounded-xl bg-silver/60 p-3">
                                <span className="font-semibold text-navy">{r.name}</span>
                                {r.relationship && <span className="ml-2 text-xs capitalize text-gray-400">({r.relationship})</span>}
                                <div className="mt-0.5 text-xs text-gray-600">📞 {r.phone}</div>
                              </div>
                            );
                          })}
                          {famEdit && (
                            <button onClick={() => setEcDraft((prev) => [...prev, { id: null, student_id: c.students.id, name: "", phone: "", relationship: "" }])}
                              className="rounded-full border border-dashed border-gray-400 px-3 py-1 text-xs font-semibold text-gray-500 hover:border-navy hover:text-navy">
                              + Add contact
                            </button>
                          )}
                        </div>
                      );
                    })}
                    <p className="pt-1 text-[11px] text-gray-400">
                      Please keep at least one emergency contact per child up to date.
                    </p>
                  </div>
                )}

                {famEdit && (
                  <div className="mt-4 flex gap-2 border-t pt-3">
                    <button onClick={saveFamily} disabled={myState === "saving"}
                      className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white transition hover:bg-royal disabled:opacity-40">
                      {myState === "saving" ? "Saving..." : "Save changes"}
                    </button>
                    <button onClick={cancelFamEdit}
                      className="rounded-full border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">
                      Cancel
                    </button>
                  </div>
                )}
                {myState === "saved" && !famEdit && (
                  <p className="mt-3 text-xs font-semibold text-emerald-deep">✓ Saved — the school sees the update right away.</p>
                )}
                {myState === "error" && (
                  <p className="mt-3 text-xs text-red-600">Could not save — please try again, or contact the school office.</p>
                )}
              </div>
            </div>

            {/* Unsaved-changes confirmation */}
            {confirmDiscard && (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={(e) => e.stopPropagation()}>
                <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center shadow-2xl">
                  <p className="text-sm text-gray-700">You have unsaved changes.<br />Leave without saving?</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <button onClick={() => { const go = confirmDiscard; setConfirmDiscard(null); go(); }}
                      className="rounded-full bg-red-600 px-6 py-2 text-sm font-semibold text-white hover:bg-red-700">Sure</button>
                    <button onClick={() => setConfirmDiscard(null)}
                      className="rounded-full border border-gray-300 px-6 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Feedback dialog */}
        {fbOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setFbOpen(false)}>
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-navy">💬 Feedback</h3>
                <button onClick={() => setFbOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
              </div>
              {fbState === "sent" ? (
                <div className="space-y-4 text-center">
                  <p className="text-3xl">✅</p>
                  <p className="text-sm text-gray-700">JazakAllah Khair! Your feedback has been sent to the school.</p>
                  <button onClick={() => setFbOpen(false)}
                    className="rounded-full bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal">Close</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">Questions, concerns, or suggestions — we read every message.</p>
                  <select value={fbCategory} onChange={(e) => setFbCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm">
                    <option value="general">General</option>
                    <option value="attendance">Attendance</option>
                    <option value="fees">Fees</option>
                    <option value="class">Class / Teacher</option>
                    <option value="portal">Portal issue</option>
                    <option value="other">Other</option>
                  </select>
                  <textarea value={fbMessage} onChange={(e) => setFbMessage(e.target.value)} rows={5}
                    placeholder="Write your feedback here..."
                    className="w-full rounded-lg border border-gray-300 p-2.5 text-sm" />
                  {fbState === "error" && <p className="text-xs text-red-600">Could not send — please try again, or email falahacademywa@gmail.com.</p>}
                  <button onClick={sendFeedback} disabled={!fbMessage.trim() || fbState === "sending"}
                    className="w-full rounded-full bg-emerald-brand py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-deep disabled:opacity-40">
                    {fbState === "sending" ? "Sending..." : "Send feedback"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Full academic calendar dialog */}
        {calModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCalModalOpen(false)}>
            <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between border-b p-5 pb-3">
                <h3 className="font-display text-lg font-semibold text-navy">Academic Calendar 2026–2027</h3>
                <button onClick={() => setCalModalOpen(false)} className="text-gray-400 hover:text-navy">✕</button>
              </div>
              <div className="flex flex-wrap gap-2 border-b bg-silver/50 px-5 py-3">
                <a href={`https://calendar.google.com/calendar/render?cid=${encodeURIComponent(ICS_URL.replace("https://", "webcal://"))}`}
                  target="_blank" rel="noreferrer"
                  className="rounded-full bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-royal">
                  Add to Google Calendar
                </a>
                <a href={ICS_URL.replace("https://", "webcal://")}
                  className="rounded-full border border-navy px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy hover:text-white">
                  Apple / Outlook
                </a>
                <a href={ICS_URL} download
                  className="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-silver">
                  Download .ics
                </a>
              </div>
              <div className="flex-1 overflow-y-auto p-5">
                {allEvents === null && <p className="text-sm text-gray-400">Loading…</p>}
                {allEvents && (() => {
                  const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
                    new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
                  const groups = new Map<string, Ev[]>();
                  allEvents.forEach((e) => {
                    const key = e.start_date.slice(0, 7);
                    groups.set(key, [...(groups.get(key) ?? []), e]);
                  });
                  const chip: Record<string, string> = {
                    academic: "bg-blue-100 text-blue-700", event: "bg-purple-100 text-purple-700",
                    holiday: "bg-amber-100 text-amber-800", exam: "bg-red-100 text-red-700",
                  };
                  const today = todayStr();
                  return [...groups.entries()].map(([month, evs]) => (
                    <div key={month} className="mb-4">
                      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
                        {fmt(month + "-15", { month: "long", year: "numeric" })}
                      </h4>
                      {evs.map((e) => (
                        <div key={e.id} className={`mb-1.5 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                          (e.end_date ?? e.start_date) < today ? "bg-silver/40 opacity-60" : "bg-silver/70"}`}>
                          <span className="w-24 shrink-0 text-xs font-semibold text-navy">
                            {fmt(e.start_date, { month: "short", day: "numeric" })}
                            {e.end_date && e.end_date !== e.start_date && <> – {fmt(e.end_date, { month: "short", day: "numeric" })}</>}
                          </span>
                          <span className="font-semibold text-gray-800">{e.title}</span>
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip[e.event_type] ?? "bg-gray-100 text-gray-600"}`}>
                            {e.event_type}
                          </span>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Attendance — one-line summary bar; calendar expands only on demand */}
        <section className="rounded-xl bg-white px-5 py-3.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="font-display text-lg font-semibold text-navy">
              Attendance{active ? ` — ${active.students.first_name}` : ""}
            </h2>
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-semibold text-green-700">{counts.present} present</span>
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-semibold text-amber-800">{counts.late} late</span>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">{counts.absent} absent</span>
            <div className="ml-auto flex items-center gap-3">
              <select value={month} onChange={(e) => setMonth(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm">
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {new Date(m + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </option>
                ))}
              </select>
              <button onClick={() => setCalOpen(!calOpen)}
                className="whitespace-nowrap text-sm font-semibold text-royal hover:underline">
                {calOpen ? "▴ Hide calendar" : "▾ Calendar"}
              </button>
            </div>
          </div>
            {calOpen && (
              <>
                <div className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <div key={i} className="py-1 font-bold text-gray-400">{d}</div>
                  ))}
                  {monthGrid.map((c, i) => (
                    <div key={i} className={`flex h-9 items-center justify-center rounded ${
                      c.day == null ? "" :
                      c.status === "present" ? "bg-green-100 font-semibold text-green-700" :
                      c.status === "late" ? "bg-amber-100 font-semibold text-amber-800" :
                      c.status === "absent" ? "bg-red-100 font-semibold text-red-700" :
                      "bg-silver text-gray-400"}`}>
                      {c.day ?? ""}
                    </div>
                  ))}
                </div>
                {activeEnrollment && (
                  <p className="mt-3 text-xs text-gray-400">
                    {activeEnrollment.grade_name} · {activeEnrollment.school_year}. Green = present, amber = late, red = absent.
                  </p>
                )}
              </>
            )}
        </section>

        {/* Class Updates feed */}
        {updates.length > 0 && (
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-display text-lg font-semibold text-navy">
              Class Updates{active ? ` — ${active.students.first_name}` : ""}
            </h2>
            <div className="space-y-4">
              {updates.map((u) => (
                <div key={u.id} className="border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-deep">{u.subject}</span>
                    {u.enrollment_id && (
                      <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs font-semibold text-navy">Just for {active?.students.first_name}</span>
                    )}
                    {u.homework_due && (
                      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Homework due {u.homework_due}</span>
                    )}
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(u.update_date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-gray-700">{u.note}</p>
                  {u.attachment_thumb && (
                    <a href={u.attachment_url ?? "#"} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                      <img src={u.attachment_thumb} alt="Attached photo" loading="lazy"
                        className="max-h-48 rounded-lg border border-gray-200 object-cover" />
                    </a>
                  )}
                  {!u.attachment_thumb && u.attachment_url && (
                    <a href={u.attachment_url} target="_blank" rel="noreferrer"
                      className="mt-2 inline-block text-xs font-semibold text-royal hover:underline">View attachment ↗</a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Assignments */}
        {asgs.length > 0 && (
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="mb-3 font-display text-lg font-semibold text-navy">
              Assignments{active ? ` — ${active.students.first_name}` : ""}
            </h2>
            <div className="space-y-2">
              {asgs.map((a) => {
                const overdue = a.due_date && a.due_date < todayStr();
                return (
                  <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-silver/60 px-3 py-2 text-sm">
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-navy">{a.subject}</span>
                    <span className="font-semibold text-gray-800">{a.title}</span>
                    {a.due_date && (
                      <span className={`text-xs font-semibold ${overdue ? "text-red-600" : "text-gray-500"}`}>
                        due {a.due_date}
                      </span>
                    )}
                    {a.instructions && <span className="text-xs text-gray-500">{a.instructions}</span>}
                    {a.file_url && (
                      <a href={a.file_url} target="_blank" rel="noreferrer"
                        className="ml-auto text-xs font-semibold text-royal hover:underline">Open ↗</a>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Qur'an + Fees */}
        <div className="grid gap-5 lg:grid-cols-5">
          <section className="rounded-xl bg-white p-5 shadow-sm lg:col-span-3">
            <h2 className="mb-4 font-display text-lg font-semibold text-navy">
              Qur'an Learning{active ? ` — ${active.students.first_name}` : ""}
            </h2>
            {quran.length ? (
              <div className="space-y-3">
                {quran.map((q, i) => (
                  <div key={q.id} className={`rounded-lg p-3 ${i === 0 ? "bg-emerald-50" : "bg-silver/60"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {i === 0 && <span className="rounded-full bg-emerald-brand px-2 py-0.5 text-[10px] font-bold uppercase text-white">Current</span>}
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-emerald-deep">{q.category}</span>
                      <span className="font-semibold text-navy">{q.surah_topic}</span>
                      {q.ayah_from && <span className="text-gray-500">ayah {q.ayah_from}{q.ayah_to ? `–${q.ayah_to}` : ""}</span>}
                      {q.memorization_level && <span className="text-xs text-gray-500">({q.memorization_level})</span>}
                      <span className="ml-auto text-xs text-gray-400">{q.assessment_date}</span>
                    </div>
                    {q.teacher_comment && <p className="mt-1 text-sm text-gray-600">💬 {q.teacher_comment}</p>}
                    {q.revision && <p className="mt-1 text-sm font-semibold text-emerald-deep">📖 Practice at home: {q.revision}</p>}
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-gray-400">No Qur'an progress recorded yet.</p>}
            {acad.length > 0 && (() => {
              const gradeName = active?.students.enrollments.find((e) => e.status === "active")?.grade_name ?? "";
              const isPreK = gradeName === "Pre-K";
              const row = (a: AcadRow) => (
                <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-silver/60 px-3 py-2 text-sm">
                  {isPreK && <span className="font-semibold text-navy">{a.subject}</span>}
                  <span className="text-xs text-gray-500">{a.assessment_type}</span>
                  {a.score != null && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      {a.score}{a.max_score ? ` / ${a.max_score}` : ""}
                    </span>
                  )}
                  {a.notes && <span className="text-xs text-gray-600">{a.notes}</span>}
                  <span className="ml-auto text-xs text-gray-400">{a.assessment_date}</span>
                </div>
              );
              if (isPreK) {
                return (
                  <>
                    <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-gray-400">Learning Progress</h3>
                    <div className="space-y-1.5">{acad.map(row)}</div>
                  </>
                );
              }
              const ORDER = ["English", "Mathematics", "Science", "Islamic Education"];
              const groups = new Map<string, AcadRow[]>();
              acad.forEach((a) => groups.set(a.subject, [...(groups.get(a.subject) ?? []), a]));
              const keys = [...groups.keys()].sort((a, b) => {
                const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
              });
              return keys.map((subj) => (
                <div key={subj}>
                  <h3 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-gray-400">
                    {subj} — {active?.students.first_name}
                  </h3>
                  <div className="space-y-1.5">{groups.get(subj)!.slice(0, 5).map(row)}</div>
                </div>
              ));
            })()}
          </section>

          <section className="rounded-xl bg-white p-5 shadow-sm lg:col-span-2">
            <h2 className="mb-4 font-display text-lg font-semibold text-navy">Fees</h2>
            {fee ? (
              Number(fee.total_amount) === 0 ? (
                <p className="text-sm text-gray-500">No fees apply for this enrollment.</p>
              ) : (
                <>
                  <div className="mb-3 flex items-center justify-between rounded-lg bg-silver p-3">
                    <div>
                      <div className="font-display text-xl font-semibold text-navy">${Number(fee.total_amount).toFixed(0)}</div>
                      <div className="text-xs text-gray-500">per {fee.billing_frequency.replace("ly", "")}</div>
                    </div>
                    {fee.start_date && fee.start_date > todayStr() ? (
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                        Starts {new Date(fee.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    ) : fee.payments.some((p) => p.payment_date.startsWith(monthStr())) ? (
                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">Paid this month ✓</span>
                    ) : (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Due by the 5th</span>
                    )}
                  </div>
                  <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">Monthly status</h3>
                  <div className="space-y-1 text-sm">
                    {(() => {
                      const today = new Date();
                      const curKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
                      const start = fee.start_date ? new Date(fee.start_date + "T12:00:00") : today;
                      const months: { key: string; label: string; payment?: { amount: number; payment_date: string } }[] = [];
                      const d = new Date(start.getFullYear(), start.getMonth(), 1);
                      while (true) {
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                        if (key > curKey) break;
                        months.push({
                          key,
                          label: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
                          payment: fee.payments.find((p) => p.payment_date.startsWith(key)),
                        });
                        d.setMonth(d.getMonth() + 1);
                      }
                      if (!months.length) return <p className="text-xs text-gray-400">First month begins {fee.start_date ? new Date(fee.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" }) : "soon"}.</p>;
                      return months.reverse().map((m) => (
                        <div key={m.key} className="flex items-center justify-between border-b py-1.5 last:border-0">
                          <span className="text-gray-600">{m.label}</span>
                          {m.payment ? (
                            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                              Fees Paid ✓ <span className="font-normal text-green-600">(${Number(m.payment.amount).toFixed(0)} · {m.payment.payment_date.slice(5)})</span>
                            </span>
                          ) : (
                            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Fees Due</span>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )
            ) : <p className="text-sm text-gray-400">No fee plan set for this enrollment yet.</p>}
          </section>
        </div>

        <div className="grid gap-5 lg:grid-cols-5">
        {/* Announcements */}
        <section className="rounded-xl bg-white p-5 shadow-sm lg:col-span-3">
          <h2 className="mb-4 font-display text-lg font-semibold text-navy">Announcements</h2>
          <div className="space-y-4">
            {anns.map((a) => {
              const acked = a.announcement_acks.some((x) => x.parent_id === session?.user.id);
              return (
                <div key={a.id} className="border-b pb-4 last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.is_pinned && <span title="Pinned">📌</span>}
                    <span className="font-semibold text-navy">{a.title}</span>
                    <span className="rounded-full bg-silver px-2.5 py-0.5 text-xs text-gray-500">{a.category}</span>
                    <span className="ml-auto text-xs text-gray-400">
                      {a.publish_date ? new Date(a.publish_date).toLocaleDateString() : ""}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{a.content}</p>
                  {a.requires_ack && (
                    acked ? (
                      <p className="mt-2 text-xs font-semibold text-green-600">✓ Acknowledged</p>
                    ) : (
                      <button onClick={() => ack(a)}
                        className="mt-2 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-navy-dark hover:bg-gold-light">
                        Acknowledge
                      </button>
                    )
                  )}
                </div>
              );
            })}
            {!anns.length && !configMissing && <p className="text-sm text-gray-400">No announcements yet.</p>}
          </div>
        </section>

        {/* Upcoming events */}
        <section className="rounded-xl bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-navy">Upcoming</h2>
            <button onClick={openFullCalendar}
              className="rounded-full border border-royal px-3 py-1 text-xs font-semibold text-royal hover:bg-royal hover:text-white">
              📅 Full Academic Calendar
            </button>
          </div>
          <div className="space-y-3">
            {events.map((e) => (
              <div key={e.id} className="flex gap-3">
                <div className="w-14 shrink-0 rounded-lg bg-silver py-1 text-center">
                  <div className="text-[10px] font-bold uppercase text-gray-400">
                    {new Date(e.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short" })}
                  </div>
                  <div className="font-display text-lg font-semibold text-navy">
                    {new Date(e.start_date + "T12:00:00").getDate()}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-gray-800">{e.title}</div>
                  <div className="text-xs text-gray-400">
                    {e.end_date && e.end_date !== e.start_date && (
                      <span className="mr-1.5 font-semibold text-navy">
                        {new Date(e.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" – "}
                        {new Date(e.end_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        {" ·"}
                      </span>
                    )}
                    {e.event_type}{e.location ? ` · ${e.location}` : ""}
                  </div>
                </div>
              </div>
            ))}
            {!events.length && !configMissing && <p className="text-sm text-gray-400">No upcoming events.</p>}
          </div>
        </section>
        </div>
      </main>
    </div>
  );
}
