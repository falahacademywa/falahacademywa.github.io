import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Year { id: number; label: string; is_current: boolean }
interface Grade { id: number; name: string; level_order: number; is_active: boolean }
interface DocType { id: number; name: string; sort: number; active: boolean }

export default function Settings() {
  const [years, setYears] = useState<Year[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [newYear, setNewYear] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [newDocType, setNewDocType] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: y }, { data: g }, { data: d }] = await Promise.all([
      supabase.from("school_years").select("*").order("label"),
      supabase.from("grades").select("*").order("level_order"),
      supabase.from("document_types").select("*").order("sort"),
    ]);
    setYears(y ?? []);
    setGrades(g ?? []);
    setDocTypes(d ?? []);
  }
  useEffect(() => { load(); }, []);

  async function addDocType(e: React.FormEvent) {
    e.preventDefault();
    const maxSort = Math.max(0, ...docTypes.map((d) => d.sort));
    const { error } = await supabase.from("document_types").insert({ name: newDocType.trim(), sort: maxSort + 1 });
    if (error) return setMsg(error.message);
    setNewDocType(""); setMsg(null); load();
  }

  async function toggleDocType(d: DocType) {
    await supabase.from("document_types").update({ active: !d.active }).eq("id", d.id);
    load();
  }

  async function addYear(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{4}$/.test(newYear)) return setMsg("Year format: 2027-2028");
    const { error } = await supabase.from("school_years").insert({ label: newYear });
    if (error) return setMsg(error.message);
    setNewYear(""); setMsg(null); load();
  }

  async function setCurrent(id: number) {
    await supabase.from("school_years").update({ is_current: false }).neq("id", id);
    await supabase.from("school_years").update({ is_current: true }).eq("id", id);
    load();
  }

  async function addGrade(e: React.FormEvent) {
    e.preventDefault();
    const maxOrder = Math.max(0, ...grades.map((g) => g.level_order));
    const { error } = await supabase.from("grades").insert({ name: newGrade, level_order: maxOrder + 1 });
    if (error) return setMsg(error.message);
    setNewGrade(""); setMsg(null); load();
  }

  async function toggleGrade(g: Grade) {
    await supabase.from("grades").update({ is_active: !g.is_active }).eq("id", g.id);
    load();
  }

  return (
    <div className="max-w-3xl">
      <h1 className="mb-6 font-display text-2xl font-semibold text-navy">School Configuration</h1>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage configuration.</p>}

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Academic Years</h2>
        {years.map((y) => (
          <div key={y.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
            <span className="font-semibold text-navy">{y.label}</span>
            {y.is_current ? (
              <span className="rounded-full bg-green-100 px-3 py-0.5 text-xs font-semibold text-green-700">Current</span>
            ) : (
              <button onClick={() => setCurrent(y.id)}
                className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">
                Make current
              </button>
            )}
          </div>
        ))}
        <form onSubmit={addYear} className="mt-3 flex gap-2">
          <input placeholder="2027-2028" value={newYear} onChange={(e) => setNewYear(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
          <button className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Add year</button>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-400">Grades</h2>
        {grades.map((g) => (
          <div key={g.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
            <span className={`font-semibold ${g.is_active ? "text-navy" : "text-gray-400 line-through"}`}>{g.name}</span>
            <button onClick={() => toggleGrade(g)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">
              {g.is_active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
        <form onSubmit={addGrade} className="mt-3 flex gap-2">
          <input required placeholder="Grade 2" value={newGrade} onChange={(e) => setNewGrade(e.target.value)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm" />
          <button className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Add grade</button>
        </form>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-1 text-sm font-bold uppercase tracking-wide text-gray-400">Required Documents</h2>
        <p className="mb-3 text-xs text-gray-500">
          The per-student forms checklist. Track and upload submissions on each student's profile; parents see the checklist in their portal.
        </p>
        {docTypes.map((d) => (
          <div key={d.id} className="flex items-center justify-between border-b py-2 text-sm last:border-0">
            <span className={`font-semibold ${d.active ? "text-navy" : "text-gray-400 line-through"}`}>{d.name}</span>
            <button onClick={() => toggleDocType(d)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-silver">
              {d.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        ))}
        {!docTypes.length && <p className="py-2 text-sm text-gray-400">No document types yet — run the phase 11 schema, then add forms here.</p>}
        <form onSubmit={addDocType} className="mt-3 flex gap-2">
          <input required placeholder="e.g. Immunization Record" value={newDocType} onChange={(e) => setNewDocType(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm" />
          <button className="rounded-lg bg-navy px-4 py-1.5 text-sm font-semibold text-white hover:bg-royal">Add form</button>
        </form>
      </section>
    </div>
  );
}
