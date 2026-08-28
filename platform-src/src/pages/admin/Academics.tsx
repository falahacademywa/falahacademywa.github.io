import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

interface EnrRow {
  id: string;
  grade_id: number;
  grade_name: string;
  students: { first_name: string; last_name: string };
}
interface QuranRow {
  id: number; assessment_date: string; category: string; surah_topic: string;
  ayah_from: number | null; ayah_to: number | null; memorization_level: string | null;
  teacher_comment: string | null; revision: string | null;
}
interface AcadRow {
  id: number; assessment_date: string; subject: string; assessment_type: string;
  score: number | null; max_score: number | null; notes: string | null;
}

const emptyQuran = { category: "quran", surah_topic: "", ayah_from: "", ayah_to: "", memorization_level: "practicing", teacher_comment: "", revision: "" };
const emptyAcad = { subject: "", assessment_type: "progress", score: "", max_score: "", notes: "" };

export default function Academics() {
  const { profile } = useAuth();
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [gradeId, setGradeId] = useState<number | null>(null);
  const [enrollments, setEnrollments] = useState<EnrRow[]>([]);
  const [selected, setSelected] = useState<EnrRow | null>(null);
  const [tab, setTab] = useState<"quran" | "academic">("quran");
  const [quran, setQuran] = useState<QuranRow[]>([]);
  const [acad, setAcad] = useState<AcadRow[]>([]);
  const [qForm, setQForm] = useState({ ...emptyQuran });
  const [aForm, setAForm] = useState({ ...emptyAcad });
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (configMissing) return;
    supabase.from("grades").select("id, name").eq("is_active", true).order("level_order")
      .then(({ data }) => { setGrades(data ?? []); if (data?.length) setGradeId(data[0].id); });
  }, []);

  useEffect(() => {
    if (configMissing || gradeId == null) return;
    supabase.from("enrollments")
      .select("id, grade_id, grade_name, students ( first_name, last_name )")
      .eq("status", "active").eq("grade_id", gradeId)
      .then(({ data }) => {
        const rows = (data as unknown as EnrRow[]) ?? [];
        rows.sort((a, b) => a.students.last_name.localeCompare(b.students.last_name));
        setEnrollments(rows);
        setSelected(rows[0] ?? null);
      });
  }, [gradeId]);

  useEffect(() => {
    if (configMissing || !selected) { setQuran([]); setAcad([]); return; }
    supabase.from("quran_progress").select("*").eq("enrollment_id", selected.id)
      .order("assessment_date", { ascending: false }).limit(30)
      .then(({ data }) => setQuran((data as QuranRow[]) ?? []));
    supabase.from("academic_progress").select("*").eq("enrollment_id", selected.id)
      .order("assessment_date", { ascending: false }).limit(30)
      .then(({ data }) => setAcad((data as AcadRow[]) ?? []));
  }, [selected]);

  async function saveQuran(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const { error } = await supabase.from("quran_progress").insert({
      enrollment_id: selected.id,
      category: qForm.category,
      surah_topic: qForm.surah_topic,
      ayah_from: qForm.ayah_from ? Number(qForm.ayah_from) : null,
      ayah_to: qForm.ayah_to ? Number(qForm.ayah_to) : null,
      memorization_level: qForm.memorization_level || null,
      teacher_comment: qForm.teacher_comment || null,
      revision: qForm.revision || null,
      recorded_by: profile?.id,
    });
    if (error) return setMsg("Save failed: " + error.message);
    setQForm({ ...emptyQuran }); setMsg(null);
    setSelected({ ...selected });
  }

  async function saveAcad(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    const { error } = await supabase.from("academic_progress").insert({
      enrollment_id: selected.id,
      subject: aForm.subject,
      assessment_type: aForm.assessment_type,
      score: aForm.score ? Number(aForm.score) : null,
      max_score: aForm.max_score ? Number(aForm.max_score) : null,
      notes: aForm.notes || null,
      recorded_by: profile?.id,
    });
    if (error) return setMsg("Save failed: " + error.message);
    setAForm({ ...emptyAcad }); setMsg(null);
    setSelected({ ...selected });
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-2 font-display text-2xl font-semibold text-navy">Academics &amp; Qur'an</h1>
      <p className="mb-6 text-sm text-gray-500">
        Qur'an entries with a comment or revision automatically notify the family.
        Academic entries mirror Red Comet manually in Version 1.
      </p>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="mb-4 flex flex-wrap gap-3">
        <select value={gradeId ?? ""} onChange={(e) => setGradeId(Number(e.target.value))}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={selected?.id ?? ""} onChange={(e) => setSelected(enrollments.find((x) => x.id === e.target.value) ?? null)}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm">
          {enrollments.map((en) => (
            <option key={en.id} value={en.id}>{en.students.first_name} {en.students.last_name}</option>
          ))}
        </select>
        <div className="ml-auto flex overflow-hidden rounded-lg border border-gray-300">
          <button onClick={() => setTab("quran")}
            className={`px-4 py-1.5 text-sm font-semibold ${tab === "quran" ? "bg-emerald-brand text-white" : "bg-white text-gray-600"}`}>Qur'an</button>
          <button onClick={() => setTab("academic")}
            className={`px-4 py-1.5 text-sm font-semibold ${tab === "academic" ? "bg-emerald-brand text-white" : "bg-white text-gray-600"}`}>Academic</button>
        </div>
      </div>

      {selected && tab === "quran" && (
        <>
          <form onSubmit={saveQuran} className="mb-5 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-3">
            <select value={qForm.category} onChange={(e) => setQForm({ ...qForm, category: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              <option value="quran">Qur'an</option>
              <option value="qaida">Qaida</option>
              <option value="dua">Dua</option>
              <option value="tajweed">Tajweed</option>
            </select>
            <input required placeholder="Surah / Qaida page / Dua" value={qForm.surah_topic}
              onChange={(e) => setQForm({ ...qForm, surah_topic: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
            <div className="flex gap-2">
              <input type="number" placeholder="Ayah from" value={qForm.ayah_from}
                onChange={(e) => setQForm({ ...qForm, ayah_from: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              <input type="number" placeholder="to" value={qForm.ayah_to}
                onChange={(e) => setQForm({ ...qForm, ayah_to: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <select value={qForm.memorization_level} onChange={(e) => setQForm({ ...qForm, memorization_level: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              {["introduced", "practicing", "memorized", "mastered"].map((l) => (
                <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>
              ))}
            </select>
            <input placeholder="Teacher comment (notifies parents)" value={qForm.teacher_comment}
              onChange={(e) => setQForm({ ...qForm, teacher_comment: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm" />
            <input placeholder="Revision / practice at home" value={qForm.revision}
              onChange={(e) => setQForm({ ...qForm, revision: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
            <button className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Add entry</button>
          </form>
          <div className="space-y-2">
            {quran.map((q) => (
              <div key={q.id} className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-deep">{q.category}</span>
                  <span className="font-semibold text-navy">{q.surah_topic}</span>
                  {q.ayah_from && <span className="text-gray-500">ayah {q.ayah_from}{q.ayah_to ? `–${q.ayah_to}` : ""}</span>}
                  {q.memorization_level && <span className="rounded-full bg-silver px-2 py-0.5 text-xs text-gray-600">{q.memorization_level}</span>}
                  <span className="ml-auto text-xs text-gray-400">{q.assessment_date}</span>
                </div>
                {(q.teacher_comment || q.revision) && (
                  <p className="mt-1 text-xs text-gray-500">
                    {q.teacher_comment && <>💬 {q.teacher_comment} </>}
                    {q.revision && <>📖 Revision: {q.revision}</>}
                  </p>
                )}
              </div>
            ))}
            {!quran.length && <p className="text-sm text-gray-400">No Qur'an entries yet for this student.</p>}
          </div>
        </>
      )}

      {selected && tab === "academic" && (
        <>
          <form onSubmit={saveAcad} className="mb-5 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-3">
            <input required placeholder="Subject (Math, English…)" value={aForm.subject}
              onChange={(e) => setAForm({ ...aForm, subject: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm" />
            <select value={aForm.assessment_type} onChange={(e) => setAForm({ ...aForm, assessment_type: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm">
              {["progress", "quiz", "test", "report"].map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
            <div className="flex gap-2">
              <input type="number" step="0.1" placeholder="Score" value={aForm.score}
                onChange={(e) => setAForm({ ...aForm, score: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
              <input type="number" step="0.1" placeholder="out of" value={aForm.max_score}
                onChange={(e) => setAForm({ ...aForm, max_score: e.target.value })}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <input placeholder="Notes" value={aForm.notes}
              onChange={(e) => setAForm({ ...aForm, notes: e.target.value })}
              className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2" />
            <button className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Add entry</button>
          </form>
          <div className="space-y-2">
            {acad.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm shadow-sm">
                <span className="font-semibold text-navy">{a.subject}</span>
                <span className="rounded-full bg-silver px-2 py-0.5 text-xs text-gray-600">{a.assessment_type}</span>
                {a.score != null && (
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    {a.score}{a.max_score ? ` / ${a.max_score}` : ""}
                  </span>
                )}
                {a.notes && <span className="text-xs text-gray-500">{a.notes}</span>}
                <span className="ml-auto text-xs text-gray-400">{a.assessment_date}</span>
              </div>
            ))}
            {!acad.length && <p className="text-sm text-gray-400">No academic entries yet for this student.</p>}
          </div>
        </>
      )}
    </div>
  );
}
