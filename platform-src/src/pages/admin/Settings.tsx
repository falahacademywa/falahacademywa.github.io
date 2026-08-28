import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Year { id: number; label: string; is_current: boolean }
interface Grade { id: number; name: string; level_order: number; is_active: boolean }

export default function Settings() {
  const [years, setYears] = useState<Year[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [newYear, setNewYear] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    if (configMissing) return;
    const [{ data: y }, { data: g }] = await Promise.all([
      supabase.from("school_years").select("*").order("label"),
      supabase.from("grades").select("*").order("level_order"),
    ]);
    setYears(y ?? []);
    setGrades(g ?? []);
  }
  useEffect(() => { load(); }, []);

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
    </div>
  );
}
