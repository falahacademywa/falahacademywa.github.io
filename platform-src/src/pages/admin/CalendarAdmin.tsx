import { useEffect, useMemo, useState } from "react";
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
const dotColors: Record<string, string> = {
  academic: "bg-blue-500", event: "bg-purple-500", holiday: "bg-amber-500", exam: "bg-red-500",
};

const emptyForm = { title: "", event_type: "event", start_date: "", end_date: "", location: "", description: "", grade_id: "", rsvp_enabled: false };

function ym(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

export default function CalendarAdmin() {
  const [rows, setRows] = useState<Ev[]>([]);
  const [grades, setGrades] = useState<{ id: number; name: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });
  const [msg, setMsg] = useState<string | null>(null);
  const [month, setMonth] = useState(() => ym(new Date()));

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

  // events spanning a given ISO date
  const eventsOn = (iso: string) =>
    rows.filter((e) => e.start_date <= iso && iso <= (e.end_date ?? e.start_date));

  // School year months: Aug -> Jul
  const yearMonths = useMemo(() => {
    const now = new Date();
    const startYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return Array.from({ length: 12 }, (_, i) => ym(new Date(startYear, 7 + i, 1)));
  }, []);

  const grid = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
    return cells;
  }, [month, rows]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("calendar_events").insert({
      title: form.title, event_type: form.event_type, start_date: form.start_date,
      end_date: form.end_date || null, location: form.location || null,
      description: form.description || null,
      grade_id: form.grade_id ? Number(form.grade_id) : null,
      rsvp_enabled: form.rsvp_enabled,
    });
    if (error) return setMsg("Save failed: " + error.message);
    setForm({ ...emptyForm }); setShowForm(false); setMsg(null); load();
  }

  async function remove(ev: Ev) {
    if (!confirm(`Delete "${ev.title}" (${ev.start_date})?`)) return;
    await supabase.from("calendar_events").delete().eq("id", ev.id);
    load();
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = new Date(month + "-15").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Calendar</h1>
        <button onClick={() => setShowForm(!showForm)}
          className="rounded-lg bg-emerald-brand px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-deep">
          {showForm ? "Cancel" : "+ Add Event"}
        </button>
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
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={form.rsvp_enabled} onChange={(e) => setForm({ ...form, rsvp_enabled: e.target.checked })} />
            Enable RSVP
          </label>
          <button type="submit" className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">Save event</button>
        </form>
      )}

      {/* Zoomed current month */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => { const [y, m] = month.split("-").map(Number); setMonth(ym(new Date(y, m - 2, 1))); }}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-silver">←</button>
          <h2 className="font-display text-xl font-semibold text-navy">{monthLabel}</h2>
          <button onClick={() => { const [y, m] = month.split("-").map(Number); setMonth(ym(new Date(y, m, 1))); }}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm hover:bg-silver">→</button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
            <div key={d} className="py-1 text-center text-xs font-bold text-gray-400">{d}</div>
          ))}
          {grid.map((iso, i) => (
            <div key={i} className={`min-h-20 rounded-lg border p-1 ${
              iso == null ? "border-transparent" :
              iso === today ? "border-emerald-brand bg-emerald-50" : "border-gray-100 bg-white"}`}>
              {iso && (
                <>
                  <div className={`text-right text-xs ${iso === today ? "font-bold text-emerald-deep" : "text-gray-400"}`}>
                    {Number(iso.slice(-2))}
                  </div>
                  {eventsOn(iso).map((e) => (
                    <button key={e.id + iso} onClick={() => remove(e)} title={`${e.title} — click to delete`}
                      className={`mb-0.5 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-semibold ${typeStyles[e.event_type] ?? "bg-gray-100 text-gray-600"}`}>
                      {e.title}{e.grade_id ? ` (${e.grades?.name})` : ""}
                    </button>
                  ))}
                </>
              )}
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-400">Click an event to delete it. Green cell = today.</p>
      </section>

      {/* Full school year */}
      <h2 className="mb-3 font-display text-lg font-semibold text-navy">School Year at a Glance</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {yearMonths.map((m) => {
          const [y, mo] = m.split("-").map(Number);
          const days = new Date(y, mo, 0).getDate();
          const firstDow = new Date(y, mo - 1, 1).getDay();
          const cells: (string | null)[] = [];
          for (let i = 0; i < firstDow; i++) cells.push(null);
          for (let d = 1; d <= days; d++) cells.push(`${m}-${String(d).padStart(2, "0")}`);
          return (
            <button key={m} onClick={() => setMonth(m)}
              className={`rounded-xl border p-2 text-left shadow-sm transition hover:border-royal ${m === month ? "border-emerald-brand bg-emerald-50" : "border-gray-200 bg-white"}`}>
              <div className="mb-1 text-center text-xs font-bold text-navy">
                {new Date(m + "-15").toLocaleDateString("en-US", { month: "short", year: "2-digit" })}
              </div>
              <div className="grid grid-cols-7 gap-px">
                {cells.map((iso, i) => {
                  const evs = iso ? eventsOn(iso) : [];
                  return (
                    <div key={i} className="flex h-4 flex-col items-center justify-center">
                      {iso && (
                        <>
                          <span className={`text-[8px] leading-none ${evs.length ? "font-bold text-navy" : "text-gray-400"}`}>
                            {Number(iso.slice(-2))}
                          </span>
                          {evs.length > 0 && (
                            <span className={`mt-px h-1 w-1 rounded-full ${dotColors[evs[0].event_type] ?? "bg-gray-400"}`} />
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
        {TYPES.map((t) => (
          <span key={t} className="flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${dotColors[t]}`} /> {t}
          </span>
        ))}
        <span className="ml-auto">Click a month to zoom it.</span>
      </div>
    </div>
  );
}
