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
interface Upload { id: number; taken_at: string; note: string | null; status: string; path: string; created_at: string }
const STATUS: Record<string, string> = { new: "sent", drafted: "received by office", confirmed: "entered in Red Comet", rejected: "not used" };

export default function Progress() {
  const { roster } = useRoster();
  const { session } = useAuth();
  const [sp] = useSearchParams();
  const [enr, setEnr] = useState(sp.get("student") ?? "");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [recent, setRecent] = useState<Upload[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => { if (!enr && roster.length) setEnr(roster[0].enrollment_id); }, [roster]);
  const student = useMemo(() => roster.find((r) => r.enrollment_id === enr), [roster, enr]);

  async function loadRecent(e = enr) {
    if (!e) return;
    const { data } = await supabase.from("work_uploads").select("id, taken_at, note, status, path, created_at")
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

  function pick(files: FileList | null) {
    if (!files) return;
    const add = Array.from(files).filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPicked((p) => [...p, ...add]);
    setMsg(null);
  }
  function unpick(i: number) { setPicked((p) => { URL.revokeObjectURL(p[i].url); return p.filter((_, j) => j !== i); }); }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!enr) return setMsg("Choose a student first.");
    if (!picked.length) return setMsg("Add at least one photo of the workbook.");
    setMsg(null);
    const day = todayISO(); let done = 0;
    for (const p of picked) {
      setBusy(`Uploading ${done + 1} of ${picked.length}…`);
      const blob = await compressImage(p.file);
      const path = `${enr}/${day}/${crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from("student-work").upload(path, blob, { contentType: "image/jpeg" });
      if (up.error) { setBusy(null); return setMsg(`Photo ${done + 1} failed: ${up.error.message}. ${done} uploaded.`); }
      const { error } = await supabase.from("work_uploads").insert({ enrollment_id: enr, path, subject: "Red Comet", note: note.trim() || null, uploaded_by: session?.user.id ?? null });
      if (error) { setBusy(null); return setMsg(`Photo ${done + 1} stored but not recorded: ${error.message}`); }
      done++;
    }
    picked.forEach((p) => URL.revokeObjectURL(p.url));
    setPicked([]); setNote(""); setBusy(null);
    setMsg(`${done} photo${done === 1 ? "" : "s"} sent for ${student?.first_name ?? "the student"}. The office enters them in Red Comet; the status below changes as that happens.`);
    loadRecent();
  }

  const inp = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  return (
    <div>
      <h1 className="mb-1 font-display text-xl font-semibold text-navy">Red Comet Progress</h1>
      <p className="mb-3 text-xs text-gray-500">Photograph the pages the student completed in the Red Comet workbook. You can select several photos at once.</p>

      <form onSubmit={upload} className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        <label className="block text-xs font-semibold text-gray-500">Student
          <select value={enr} onChange={(e) => setEnr(e.target.value)} className={inp}>
            {roster.map((r) => <option key={r.enrollment_id} value={r.enrollment_id}>{r.first_name} {r.last_name} · {r.grade_name}</option>)}
          </select>
        </label>

        <div>
          <div className="text-xs font-semibold text-gray-500">Workbook photos</div>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {picked.map((p, i) => (
              <div key={p.url} className="relative aspect-[3/4] overflow-hidden rounded-lg border border-gray-200 bg-silver">
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button type="button" onClick={() => unpick(i)} aria-label="Remove" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white">✕</button>
              </div>
            ))}
            <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 active:bg-silver">
              <span className="text-2xl leading-none">＋</span>
              <span className="mt-1 text-[11px] font-semibold">Camera</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            </label>
            <label className="flex aspect-[3/4] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 active:bg-silver">
              <span className="text-2xl leading-none">🖼</span>
              <span className="mt-1 text-[11px] font-semibold">Gallery (multi)</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
            </label>
          </div>
          {picked.length > 0 && <div className="mt-1 text-[11px] text-gray-400">{picked.length} photo{picked.length === 1 ? "" : "s"} selected</div>}
        </div>

        <label className="block text-xs font-semibold text-gray-500">Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Math unit 3, pages 12–15" className={inp} />
        </label>

        {msg && <div className={`rounded-lg p-2 text-sm ${/sent for/.test(msg) ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg}</div>}
        <button type="submit" disabled={!!busy || !enr} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy ?? `Send ${picked.length || ""} photo${picked.length === 1 ? "" : "s"}`}
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
                  <div className="text-gray-500">{usDate(u.taken_at)}</div>
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
