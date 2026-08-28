import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Ev {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  end_date: string | null;
  location: string | null;
  description: string | null;
  grade_id: number | null;
  grades: { name: string } | null;
  rsvp_enabled: boolean;
}

const TYPES = ["academic", "event", "holiday", "exam"] as const;
const typeStyles: Record<string, string> = {
  academic: "bg-blue-100 text-blue-700",
  event: "bg-purple-100 text-purple-700",
  holiday: "bg-amber-100 text-amber-800",
  exam: "bg-red-100 text-red-700",
};

const emptyForm = { title: "", event_type: "event", start_date: "", end_date: "", location: "", description: "", grade_id: "", rsvp_enabled: false };

export default function CalendarAdmin() {
  const [rows, setRows] = useState<Ev[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [msg, setMsg] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  async function load() {
    if (configMissing) return;
    const [{ data }, { data: g }] = await Promise.all([
      supabase.from("calendar_events").select("*, grades ( name )").order("start_date"),
      supabase.from("grades").select("id, name").eq("is_active", true).order("level_order"),
    ]);
    setRows((data as unknown as Ev[]) ?? []);
    setGrades(g ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      title: form.title,
      event_type: form.event_type,
      start_date: form.start_date,
      end_date: form.end_date || null,
      location: form.location || null,
      description: form.description || null,
      grade_id: form.grade_id ? Number(form.grade_id) : null,
      rsvp_enabled: form.rsvp_enabled,
    };
    const { error } = await supabase.from("calendar_events").insert(payload);
    if (error) return setMsg("Save failed: " + error.message);
    setForm({ ...emptyForm });
    setShowForm(false);
    setMsg(null);
    load();
  }

  async function remove(id: string) {
    const { error } = await supabase.from("calendar_events").delete().eq("id", id);
    if (error) setMsg("Delete failed: " + error.message);
    load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const visible = showPast ? rows : rows.filter((r) => (r.end_date ?? r.start_date) >= today);

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Calendar</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} />
            Show past events
          </label>
          <button onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-emerald-brand px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-deep">
            {showForm ? "Cancel" : "+ Add Event"}
          </button>
        </div>
      </div>
      {msg && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{msg}</div>}
      {configMissing && <p className="text-sm text-gray-500">Connect the database to manage the calendar.</p>}

      {showForm && (
        <form onSubmit={save} className="mb-6 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <input required placeholder="Event title" className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
            value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm">
            {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
          </select>
          <select value={form.grade_id} onChange={(e) => setForm({ ...form, grade_id: e.target.value })}
            className="rounded border border-gray-300 px-3 py-2 text-sm">
            <option value="">School-wide</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name} only</option>)}
          </select>
          <label className="text-xs text-gray-500">Start date
            <input required type="date" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </label>
          <label className="text-xs text-gray-500">End date (optional)
            <input type="date" className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </label>
          <input placeholder="Location" className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
            value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <textarea placeholder="Description" rows={2} className="rounded border border-gray-300 px-3 py-2 text-sm sm:col-span-2"
            value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.rsvp_enabled} onChange={(e) => setForm({ ...form, rsvp_enabled: e.target.checked })} />
            Enable RSVP
          </label>
          <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Save event</button>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {visible.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 border-b px-4 py-3 last:border-0 hover:bg-silver/50">
            <div className="w-28 shrink-0 text-sm font-semibold text-navy">
              {new Date(r.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              {r.end_date && <div className="text-xs font-normal text-gray-400">→ {new Date(r.end_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>}
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${typeStyles[r.event_type] ?? "bg-gray-100 text-gray-600"}`}>{r.event_type}</span>
            <span className="flex-1 text-sm font-semibold text-gray-800">{r.title}</span>
            {r.grade_id && <span className="rounded-full bg-navy/10 px-2.5 py-0.5 text-xs text-navy">{r.grades?.name}</span>}
            {r.rsvp_enabled && <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-xs text-navy">RSVP</span>}
            <button onClick={() => remove(r.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
          </div>
        ))}
        {!configMissing && !visible.length && (
          <p className="p-8 text-center text-sm text-gray-400">No upcoming events.</p>
        )}
      </div>
    </div>
  );
}
