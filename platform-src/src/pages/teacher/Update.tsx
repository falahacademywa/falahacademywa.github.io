// Teacher app — weekly class update. One screen posts up to four subject
// updates (English, Mathematics, Science, Islamic Education) for a grade or
// one student, each with optional homework date and photos, plus a Qur'an
// update for one student at the bottom. Each filled box becomes its own
// class_updates row, like the Google Form did; the insert fires the admin
// alert and the parents' evening digest. Photos go to the public
// `class-updates` bucket; the first is also attachment_url/_thumb.
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { useRoster, compressImage, todayISO } from "../../lib/teacher";
import { usDate } from "../../lib/format";

const CLASS_SUBJECTS = ["English", "Mathematics", "Science", "Islamic Education"] as const;
interface Picked { file: File; url: string }
interface Box { note: string; due: string; photos: Picked[] }
const emptyBox = (): Box => ({ note: "", due: "", photos: [] });
interface Post { id: string; subject: string; note: string; update_date: string; homework_due: string | null; attachment_urls: string[] | null; grade_id: number | null; enrollment_id: string | null; created_at: string }

const inp = "mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm";
const addPhotos = (files: FileList | null): Picked[] =>
  Array.from(files ?? []).filter((f) => f.type.startsWith("image/")).map((file) => ({ file, url: URL.createObjectURL(file) }));

/** one subject box: textarea, photo icon (multi), thumbnails, homework date */
function SubjectBox({ title, box, onChange, accent }: { title: string; box: Box; onChange: (patch: Partial<Box>) => void; accent?: string }) {
  return (
    <div className={`rounded-xl border bg-white p-3 shadow-sm ${accent ?? "border-gray-200"}`}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-navy">{title}</div>
        <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-600 active:bg-silver" title="Add photos">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9a2 2 0 012-2h2l2-3h6l2 3h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><circle cx="12" cy="13" r="3.5" /></svg>
          {box.photos.length ? box.photos.length : ""}
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onChange({ photos: [...box.photos, ...addPhotos(e.target.files)] }); e.target.value = ""; }} />
        </label>
      </div>
      <textarea value={box.note} onChange={(e) => onChange({ note: e.target.value })} rows={3} placeholder={`What did the class do in ${title} this week?`} className={inp} />
      {box.photos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {box.photos.map((p, i) => (
            <div key={p.url} className="relative h-14 w-14 overflow-hidden rounded-md border border-gray-200">
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button type="button" aria-label="Remove" onClick={() => { URL.revokeObjectURL(p.url); onChange({ photos: box.photos.filter((_, j) => j !== i) }); }}
                className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-md bg-black/60 text-[10px] text-white">✕</button>
            </div>
          ))}
        </div>
      )}
      <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-gray-500">Homework due
        <input type="date" value={box.due} min={todayISO()} onChange={(e) => onChange({ due: e.target.value })} className="rounded-lg border border-gray-300 px-2 py-1 text-xs font-normal" />
        {box.due && <button type="button" onClick={() => onChange({ due: "" })} className="text-gray-400">clear</button>}
      </label>
    </div>
  );
}

export default function Update() {
  const { roster, grades } = useRoster();
  const { session } = useAuth();
  const [sp] = useSearchParams();
  const presetEnr = sp.get("student");
  const [gradeId, setGradeId] = useState<number | "">("");
  const [studentEnr, setStudentEnr] = useState<string>("");          // "" = whole class
  const [boxes, setBoxes] = useState<Record<string, Box>>(Object.fromEntries(CLASS_SUBJECTS.map((s) => [s, emptyBox()])));
  const [quran, setQuran] = useState<Box & { enrs: string[] }>({ ...emptyBox(), enrs: [] });   // several students, one row each
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    if (gradeId !== "" || !grades.length) return;
    const pre = presetEnr ? roster.find((r) => r.enrollment_id === presetEnr) : undefined;
    setGradeId(pre?.grade_id ?? grades[0].id);
    if (pre) { setStudentEnr(pre.enrollment_id); setQuran((q) => ({ ...q, enrs: [pre.enrollment_id] })); }
  }, [grades, roster]);

  const students = useMemo(() => roster.filter((r) => r.grade_id === gradeId), [roster, gradeId]);
  useEffect(() => {
    if (studentEnr && !students.some((s) => s.enrollment_id === studentEnr)) setStudentEnr("");
    setQuran((q) => ({ ...q, enrs: q.enrs.filter((e) => students.some((s) => s.enrollment_id === e)) }));
  }, [students]);
  const toggleQuran = (e: string) => setQuran((q) => ({ ...q, enrs: q.enrs.includes(e) ? q.enrs.filter((x) => x !== e) : [...q.enrs, e] }));

  async function loadPosts() {
    const { data } = await supabase.from("class_updates").select("id, subject, note, update_date, homework_due, attachment_urls, grade_id, enrollment_id, created_at")
      .order("created_at", { ascending: false }).limit(30);
    setPosts((data as Post[]) ?? []);
  }
  useEffect(() => { loadPosts(); }, []);

  const setBox = (s: string, patch: Partial<Box>) => setBoxes((b) => ({ ...b, [s]: { ...b[s], ...patch } }));

  async function uploadAll(photos: Picked[]): Promise<string[]> {
    const urls: string[] = [];
    for (const p of photos) {
      const blob = await compressImage(p.file);
      const path = `${todayISO()}/${crypto.randomUUID()}.jpg`;
      const { error } = await supabase.storage.from("class-updates").upload(path, blob, { contentType: "image/jpeg" });
      if (error) throw new Error("Photo upload failed: " + error.message);
      urls.push(supabase.storage.from("class-updates").getPublicUrl(path).data.publicUrl);
    }
    return urls;
  }
  async function postOne(subject: string, box: Box, target: { grade_id: number | null; enrollment_id: string | null }, ready?: string[]) {
    const urls = ready ?? await uploadAll(box.photos);
    const row = { ...target, subject, note: box.note.trim(), homework_due: box.due || null, update_date: todayISO(),
      attachment_url: urls[0] ?? null, attachment_thumb: urls[0] ?? null, attachment_urls: urls };
    const { error } = await supabase.from("class_updates").insert(row);
    if (error) throw new Error(`${subject}: ${error.message}`);
    if (box.due) {
      await supabase.from("assignments").insert({ ...target, subject, title: box.note.trim().slice(0, 80), instructions: box.note.trim(),
        due_date: box.due, assigned_date: todayISO(), created_by: session?.user.id ?? null });   // Pacific date, not the UTC default
    }
    if (!ready) box.photos.forEach((p) => URL.revokeObjectURL(p.url));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (gradeId === "") return setMsg({ ok: false, text: "Choose a grade first." });
    const filled = CLASS_SUBJECTS.filter((s) => boxes[s].note.trim().length >= 3);
    const quranFilled = quran.note.trim().length >= 3;
    if (!filled.length && !quranFilled) return setMsg({ ok: false, text: "Write at least one update." });
    if (quranFilled && !quran.enrs.length) return setMsg({ ok: false, text: "Tick at least one student for the Qur'an update." });
    const target = studentEnr ? { grade_id: null, enrollment_id: studentEnr } : { grade_id: gradeId, enrollment_id: null };
    let done = 0;
    try {
      for (const s of filled) { setBusy(`Posting ${s}…`); await postOne(s, boxes[s], target); done++; }
      if (quranFilled) {
        setBusy("Posting Qur'an…");
        const urls = await uploadAll(quran.photos);            // upload once, reuse for every student
        for (const enr of quran.enrs) { await postOne("Qur'an", quran, { grade_id: null, enrollment_id: enr }, urls); done++; }
        quran.photos.forEach((p) => URL.revokeObjectURL(p.url));
      }
      setBoxes(Object.fromEntries(CLASS_SUBJECTS.map((s) => [s, emptyBox()])));
      setQuran({ ...emptyBox(), enrs: [] });
      setMsg({ ok: true, text: `${done} update${done === 1 ? "" : "s"} posted. Parents see them in their feed; the office has been notified.` });
    } catch (err) {
      setMsg({ ok: false, text: `${(err as Error).message}${done ? ` (${done} posted before the error)` : ""}` });
    }
    setBusy(null); loadPosts();
  }
  async function remove(p: Post) {
    if (!confirm("Delete this update?")) return;
    const { error } = await supabase.from("class_updates").delete().eq("id", p.id);
    if (error) setMsg({ ok: false, text: "Could not delete (only your own posts, same day): " + error.message });
    loadPosts();
  }
  const nameOf = (p: Post) => p.enrollment_id ? (roster.find((r) => r.enrollment_id === p.enrollment_id)?.first_name ?? "one student") : (grades.find((g) => g.id === p.grade_id)?.name ?? "class");

  return (
    <div>
      <h1 className="mb-1 font-display text-xl font-semibold text-navy">Weekly class update</h1>
      <p className="mb-3 text-xs text-gray-500">Fill the subjects you taught this week; empty boxes are skipped. Posted {usDate(todayISO())}.</p>

      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <label className="block text-xs font-semibold text-gray-500">Grade
            <select value={gradeId} onChange={(e) => setGradeId(Number(e.target.value))} className={inp}>
              {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-gray-500">Student (optional)
            <select value={studentEnr} onChange={(e) => setStudentEnr(e.target.value)} className={inp}>
              <option value="">Whole class</option>
              {students.map((r) => <option key={r.enrollment_id} value={r.enrollment_id}>{r.first_name} {r.last_name}</option>)}
            </select>
          </label>
        </div>

        {CLASS_SUBJECTS.map((s) => <SubjectBox key={s} title={s} box={boxes[s]} onChange={(patch) => setBox(s, patch)} />)}

        <div className="rounded-xl border border-emerald-brand/40 bg-emerald-50/40 p-3 shadow-sm">
          <div className="mb-2 text-sm font-semibold text-emerald-deep">Qur'an update · by student</div>
          <div className="flex flex-wrap gap-1.5">
            {students.map((r) => { const on = quran.enrs.includes(r.enrollment_id); return (
              <button type="button" key={r.enrollment_id} onClick={() => toggleQuran(r.enrollment_id)} aria-pressed={on}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-emerald-brand text-white" : "border border-gray-300 bg-white text-gray-600"}`}>
                {on ? "✓ " : ""}{r.first_name}
              </button>
            ); })}
            {students.length > 1 && (
              <button type="button" onClick={() => setQuran((q) => ({ ...q, enrs: q.enrs.length === students.length ? [] : students.map((s) => s.enrollment_id) }))}
                className="rounded-full px-3 py-1 text-xs font-semibold text-emerald-deep underline">{quran.enrs.length === students.length ? "None" : "All"}</button>
            )}
          </div>
          <div className="mt-1 text-[11px] text-gray-500">{quran.enrs.length ? `${quran.enrs.length} student${quran.enrs.length === 1 ? "" : "s"} selected — each gets the same post` : "Tap the students this Qur'an update is for"}</div>
          <div className="mt-2">
            <SubjectBox title="Qur'an" box={quran} onChange={(patch) => setQuran({ ...quran, ...patch })} accent="border-emerald-brand/30" />
          </div>
        </div>

        {msg && <div className={`rounded-lg p-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{msg.text}</div>}
        <button type="submit" disabled={!!busy} className="w-full rounded-lg bg-navy py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ?? "Post updates"}</button>
      </form>

      <h2 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-gray-400">Recent posts</h2>
      <div className="space-y-2">
        {posts.map((p) => (
          <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-deep">{p.subject}</span>
              <span className="rounded-full bg-silver px-2 py-0.5 text-navy">{nameOf(p)}</span>
              {p.homework_due && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">due {usDate(p.homework_due)}</span>}
              <span className="ml-auto text-gray-400">{usDate(p.update_date)}</span>
              {Date.now() - new Date(p.created_at).getTime() < 86400000 && <button onClick={() => remove(p)} className="text-gray-400">✕</button>}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{p.note}</p>
            {(p.attachment_urls?.length ?? 0) > 0 && (
              <div className="mt-1.5 flex gap-1.5">{p.attachment_urls!.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="h-12 w-12 rounded-md border border-gray-200 object-cover" /></a>)}</div>
            )}
          </div>
        ))}
        {!posts.length && <p className="text-sm text-gray-400">No posts yet.</p>}
      </div>
    </div>
  );
}
