// Old (archived) announcements (phase 34): one collapsed section, grouped by the month the
// announcement was published, newest month first; every month starts collapsed too.
// Used on the admin Announcements page and on the parent home.
import { useState, type ReactNode } from "react";
import { monthLabel } from "../lib/calendar";

interface Item { id: string; publish_date: string | null; created_at?: string }

const ymOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };

export default function OldAnnouncements<T extends Item>({ items, render, note }: { items: T[]; render: (a: T) => ReactNode; note?: string }) {
  const [open, setOpen] = useState(false);
  const [months, setMonths] = useState<Record<string, boolean>>({});
  if (!items.length) return null;

  const when = (a: T) => a.publish_date ?? a.created_at ?? "";
  const groups = new Map<string, T[]>();
  for (const a of [...items].sort((x, y) => (when(x) < when(y) ? 1 : -1))) {
    const k = when(a) ? ymOf(when(a)) : "undated";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left shadow-sm hover:bg-silver/60">
        <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-base font-bold text-navy">Old announcements</span>
        <span className="text-xs text-gray-400">{items.length} announcement{items.length === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="mt-2">
          {note && <p className="mb-2 ml-4 text-xs text-gray-400 sm:ml-6">{note}</p>}
          {[...groups].map(([k, list]) => {
            const o = !!months[k];
            return (
              <div key={k} className="ml-4 mt-1.5 sm:ml-6">
                <button onClick={() => setMonths((m) => ({ ...m, [k]: !o }))} aria-expanded={o}
                  className="flex w-full items-center gap-2 rounded-lg border border-transparent bg-white/70 px-3 py-2 text-left hover:bg-silver/60">
                  <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${o ? "rotate-90" : ""}`}>▶</span>
                  <span className="text-sm font-semibold text-navy">{k === "undated" ? "Not published" : monthLabel(k)}</span>
                  <span className="text-xs text-gray-400">{list.length} announcement{list.length === 1 ? "" : "s"}</span>
                </button>
                {o && <div className="ml-6 mt-2 space-y-3 sm:ml-8">{list.map((a) => <div key={a.id}>{render(a)}</div>)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
