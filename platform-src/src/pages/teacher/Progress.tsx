// Teacher app — Red Comet Progress: photograph a student's Red Comet workbook
// pages (several at once). The images go to the private `student-work` bucket
// with one `work_uploads` row each; scripts/redcomet-pull.py (hourly on the
// President's PC) copies them into the student's OneDrive inbox folder, where
// the Buzz transcription agent works from, and moves the status along.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useRoster, compressImage, todayISO } from "../../lib/teacher";
import { usDate } from "../../lib/format";

interface Picked { file: File; url: string }
interface Upload { id: number; taken_at: string; note: string | null; status: string; path: string; created_at: string; subject: string | null }
const RC_SUBJECTS = ["English", "Maths", "Science"] as const;   // Red Comet courses the school uses (2026-10-22)
const STATUS: Record<string, string> = { new: "sent", drafted: "received by office", confirmed: "entered in Red Comet", rejected: "not used" };

export default function Progress() {
  const { roster } = useRoster();
  const { session } = useAuth();
  const [sp] = useSearchParams();
  const [enr, setEnr] = useState(sp.get("student") ?? "");
  type Subject = (typeof RC_SUBJECTS)[number];
  const empty = () => ({ English: [], Maths: [], Science: [] }) as Record<Subject, Picked[]>;
  const [picked, setPicked] = useState<Record<Subject, Picked[]>>(empty());
  const [notes, setNotes] = useState<Record<Subject, string>>({ English: "", Maths: "", Science: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [recent, setRecent] = useState<Upload[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // no default student: the teacher must pick the child every time, so pages
  // cannot land under the first name in the list by accident (2026-10-22)
  const student = useMemo(() => roster.find((r) => r.enrollment_id === enr), [roster, enr]);
  const total = RC_SUBJECTS.reduce((n, sb) => n + picked[sb].length, 0);
  const summary = RC_SUBJECTS.filter((sb) => picked[sb].length).map((sb) => `${sb} ${picked[sb].length}`).join(" · ");

  async function loadRecent(e = enr) {
    if (!e) return;
    const { data } = await supabase.from("work_uploads").select("id, taken_at, note, status, path, created_at, subject")
      .eq("enrollment_id", e).order("created_at", { ascending: false }).limit(12);
    const rows = (data as Upload[]) ?? [];
    setRecent(rows);
    const missing = rows.filter((r) => !thumbs[r.path]).map((r) => r.path);
    if (missing.length) {
      const { data: signed } = await supabase.storage.from("student-work").createSignedUrls(missing, 600);
      const add: Record<string, string> = {};
      (signed ?? []).forEach((s, i) => { if (s.signedUrl) add[missing[i]] = s.signedUrl; });
      setThumbs((t) => ({ ...t, ...add }));
    }
  }
  useEffect(() => { loadRecent(); }, [enr]);

  function pick(sb: Subject, files: FileList | null) {
    if (!files) return;
    const add = Array.from(files).filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPicked((p) => ({ ...p, [sb]: [...p[sb], ...add] }));
    setMsg(null);
  }
  function unpick(sb: Subject, i: number) {
    setPicked((p) => { URL.revokeObjectURL(p[sb][i].url); return { ...p, [sb]: p[sb].filter((_, j) => j !== i) }; });
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!enr) return setMsg("Choose a student first.");
    if (!total) return setMsg("Add at least one photo under a subject.");
    setMsg(null);
    const day = todayISO(); let done = 0;
    for (const sb of RC_SUBJECTS) {
      for (const p of picked[sb]) {
        setBusy(`Uploading ${done + 1} of ${total} (${sb})…`);
        const blob = await compressImage(p.file);
        const path = `${enr}/${day}/${crypto.randomUUID()}.jpg`;
        const up = await supabase.storage.from("student-work").upload(path, blob, { contentType: "image/jpeg" });
        if (up.error) { setBusy(null); return setMsg(`${sb} photo failed: ${up.error.message}. ${done} uploaded so far — the rest are still selected, tap Send again.`); }
        const { error } = await supabase.from("work_uploads").insert({ enrollment_id: enr, path, subject: sb, note: notes[sb].trim() || null, uploaded_by: session?.user.id ?? null });
        if (error) { setBusy(null); return setMsg(`${sb} photo stored but not recorded: ${error.message}`); }
        done++;
        setPicked((prev) => ({ ...prev, [sb]: prev[sb].filter((x) => x !== p) }));   // drop as we go, so a retry only resends what failed
        URL.revokeObjectURL(p.url);
      }
    }
    setPicked(empty()); setNotes({ English: "", Maths: "", Science: "" }); setBusy(null);
    setMsg(`${done} photo${done === 1 ? "" : "s"} sent for ${student?.first_name ?? "the student"} (${summary}). The office enters them in Red Comet; the status below changes as that happens.`);
    loadRecent();
  }

  const inp = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  const tile = "flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 active:bg-silver";
  return (
    <div>
      <h1 className="mb-1 font-display text-xl font-semibold text-navy">Red Comet Progress</h1>
      <p className="mb-3 text-xs text-gray-500">Choose the student, then add the workbook photos under each subject. One tap on Send uploads them all.</p>

      <form onSubmit={upload} className="space-y-3">
        <label className="block rounded-xl border border-gray-200 bg-white p-3 text-xs font-semibold text-gray-500 shadow-sm">Student
          <select value={enr} onChange={(e) => { setEnr(e.target.value); setMsg(null); }} className={`${inp} ${!enr ? "border-amber-400 bg-amber-50" : ""}`}>
            <option value="">Choose the student…</option>
            {roster.map((r) => <option key={r.enrollment_id} value={r.enrollment_id}>{r.first_name} {r.last_name} · {r.grade_name}</option>)}
          </select>
        </label>

        {RC_SUBJECTS.map((sb) => (
          <div key={sb} className={`rounded-xl border bg-white p-3 shadow-sm ${picked[sb].length ? "border-navy/40" : "border-gray-200"}`}>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-navy">{sb}</div>
              <div className="text-[11px] text-gray-400">{picked[sb].length ? `${picked[sb].length} photo${picked[sb].length === 1 ? "" : "s"}` : "no photos yet"}</div>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {picked[sb].map((p, i) => (
                <div key={p.url} className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-silver">
                  <img src={p.url} alt="" className="h-full w-full object-cover" />
                  <button type="button" onClick={() => unpick(sb, i)} aria-label="Remove" className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">✕</button>
                </div>
              ))}
              <label className={tile}>
                <span className="text-xl leading-none">＋</span>
                <span className="mt-0.5 text-[10px] font-semibold">Camera</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(sb, e.target.files); e.target.value = ""; }} />
              </label>
              <label className={tile}>
                <span className="text-xl leading-none">🖼</span>
                <span className="mt-0.5 text-[10px] font-semibold">Gallery</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(sb, e.target.files); e.target.value = ""; }} />
              </label>
            </div>
            {picked[sb].length > 0 && (
              <input value={notes[sb]} onChange={(e) => setNotes({ ...notes, [sb]: e.target.value })} placeholder={`${sb} note, e.g. unit 3 pages 12–15 (optional)`} className={inp} />
            )}
          </div>
        ))}

        {msg && <div className={`rounded-lg p-2 text-sm ${/sent for/.test(msg) ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg}</div>}
        <button type="submit" disabled={!!busy || !enr || !total} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ?? (!enr ? "Choose the student first" : !total ? "Add photos under a subject" : `Send ${total} photo${total === 1 ? "" : "s"} for ${student?.first_name ?? ""} (${summary})`)}
        </button>
      </form>

      {student && (
        <>
          <h2 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">Sent for {student.first_name}</h2>
          <div className="grid grid-cols-3 gap-2">
            {recent.map((u) => (
              <div key={u.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <div className="aspect-[3/4] bg-silver">{thumbs[u.path] && <img src={thumbs[u.path]} alt="" className="h-full w-full object-cover" />}</div>
                <div className="px-1.5 py-1 text-[10px] leading-tight">
                  <div className="text-gray-500">{usDate(u.taken_at)}{u.subject && u.subject !== "Red Comet" ? ` · ${u.subject}` : ""}</div>
                  <div className={`font-semibold ${u.status === "confirmed" ? "text-emerald-deep" : u.status === "rejected" ? "text-red-600" : "text-amber-700"}`}>{STATUS[u.status] ?? u.status}</div>
                </div>
              </div>
            ))}
          </div>
          {!recent.length && <p className="text-sm text-gray-400">No photos sent yet.</p>}
        </>
      )}
    </div>
  );
}
