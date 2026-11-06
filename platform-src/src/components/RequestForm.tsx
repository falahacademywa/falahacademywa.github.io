// New / edit teacher request (phase 35). Photo is shrunk in the browser (~200 KB) and stored in the
// private teacher-requests bucket under <my uid>/. The student picker lists the teacher's roster;
// the request stores the student ID (names never leave the portal: the hub sees IDs only).
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { compressImage, useRoster } from "../lib/teacher";
import { REQ_TYPES, type Req } from "../lib/requests";

export default function RequestForm({ edit, onDone, onCancel }: { edit?: Req | null; onDone: (id: number) => void; onCancel: () => void }) {
  const { session } = useAuth();
  const { roster } = useRoster();
  const [title, setTitle] = useState(edit?.title ?? "");
  const [details, setDetails] = useState(edit?.details ?? "");
  const [type, setType] = useState<string>(edit?.type ?? "Supplies");
  const [urgent, setUrgent] = useState(edit?.urgency === "urgent");
  const [student, setStudent] = useState(edit?.student_id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!title.trim()) return setErr("Give the request a short title.");
    setBusy(true);
    let photo: string | null = dropPhoto ? null : edit?.photo_path ?? null;
    try {
      if (file) {
        const blob = await compressImage(file, 1280, 0.8);
        const path = `${session?.user.id}/${Date.now()}.jpg`;
        const { error } = await supabase.storage.from("teacher-requests").upload(path, blob, { contentType: "image/jpeg" });
        if (error) throw new Error("Photo upload failed: " + error.message);
        photo = path;
      }
      const { data, error } = await supabase.rpc("teacher_request_save", {
        p_id: edit?.id ?? null, p_title: title.trim(), p_details: details.trim() || null, p_type: type,
        p_urgency: urgent ? "urgent" : "normal", p_student: student || null, p_photo: photo,
      });
      if (error) throw new Error(error.message);
      // tidy the replaced/removed photo
      if (edit?.photo_path && edit.photo_path !== photo) await supabase.storage.from("teacher-requests").remove([edit.photo_path]);
      onDone(data as number);
    } catch (e) {
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }

  const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
  return (
    <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="font-display text-base font-semibold text-navy">{edit ? `Edit request R${edit.id}` : "New request"}</h2>
      <label className="block text-xs font-semibold text-gray-600">Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Glue sticks for Pre-K" className={input + " mt-1 font-normal"} />
      </label>
      <label className="block text-xs font-semibold text-gray-600">Details
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={4} placeholder="What do you need, and why?" className={input + " mt-1 font-normal"} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs font-semibold text-gray-600">Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={input + " mt-1 font-normal"}>
            {REQ_TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-gray-600">Urgency
          <select value={urgent ? "urgent" : "normal"} onChange={(e) => setUrgent(e.target.value === "urgent")} className={input + " mt-1 font-normal"}>
            <option value="normal">Normal</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>
      <label className="block text-xs font-semibold text-gray-600">About a student (optional)
        <select value={student} onChange={(e) => setStudent(e.target.value)} className={input + " mt-1 font-normal"}>
          <option value="">— none —</option>
          {roster.map((s) => <option key={s.student_id} value={s.student_id}>{s.first_name} {s.last_name} · {s.grade_name} ({s.student_no})</option>)}
        </select>
      </label>
      <div className="text-xs font-semibold text-gray-600">Photo (optional)
        {edit?.photo_path && !file && !dropPhoto && (
          <div className="mt-1 flex items-center gap-2 font-normal text-gray-500">A photo is attached. <button onClick={() => setDropPhoto(true)} className="text-red-700 underline">Remove</button></div>
        )}
        <input type="file" accept="image/*" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setDropPhoto(false); }} className="mt-1 block w-full text-sm font-normal" />
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button onClick={save} disabled={busy} className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : edit ? "Save changes" : "Send request"}</button>
        <button onClick={onCancel} disabled={busy} className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-600">Cancel</button>
      </div>
    </div>
  );
}
