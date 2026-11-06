// Collapsible, multi-level archive (phase 35), in the same style as Old announcements and Red Comet:
// one collapsed header with a count, then nested groups (e.g. Year → Approved/Declined → Type → Month),
// every level collapsed by default. Used by Teacher requests (admin + teacher app) and Social posts.
import { useState, type ReactNode } from "react";

export interface Level<T> {
  key: (x: T) => string;              // group key at this level
  label?: (k: string) => string;      // shown text (defaults to the key)
  order?: (a: string, b: string) => number; // default: newest/largest first (descending)
}

const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

function Group<T extends { id: string | number }>({ items, levels, depth, render, noun, path, focus }: {
  items: T[]; levels: Level<T>[]; depth: number; render: (x: T) => ReactNode; noun: string; path: string; focus?: string | number | null;
}) {
  // groups that hold the focused item (e.g. opened from a notification) start open
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const f = focus != null ? items.find((x) => x.id === focus) : undefined;
    return f && depth < levels.length ? { [levels[depth].key(f)]: true } : {};
  });
  if (depth >= levels.length) return <div className="ml-6 mt-2 space-y-3 sm:ml-8">{items.map((x) => <div key={x.id}>{render(x)}</div>)}</div>;
  const lv = levels[depth];
  const groups = new Map<string, T[]>();
  for (const x of items) { const k = lv.key(x); groups.set(k, [...(groups.get(k) ?? []), x]); }
  const keys = [...groups.keys()].sort(lv.order ?? desc);
  return (
    <>
      {keys.map((k) => {
        const list = groups.get(k)!; const o = !!open[k];
        return (
          <div key={path + k} className="ml-4 mt-1.5 sm:ml-6">
            <button onClick={() => setOpen((m) => ({ ...m, [k]: !o }))} aria-expanded={o}
              className="flex w-full items-center gap-2 rounded-lg border border-transparent bg-white/70 px-3 py-2 text-left hover:bg-silver/60">
              <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${o ? "rotate-90" : ""}`}>▶</span>
              <span className="text-sm font-semibold text-navy">{lv.label ? lv.label(k) : k}</span>
              <span className="text-xs text-gray-400">{list.length} {noun}{list.length === 1 ? "" : "s"}</span>
            </button>
            {o && <Group items={list} levels={levels} depth={depth + 1} render={render} noun={noun} path={path + k + "/"} focus={focus} />}
          </div>
        );
      })}
    </>
  );
}

export default function GroupedArchive<T extends { id: string | number }>({ title = "Archive", items, levels, render, noun = "item", note, focus }: {
  title?: string; items: T[]; levels: Level<T>[]; render: (x: T) => ReactNode; noun?: string; note?: string;
  /** id of an item to reveal: its groups start open (remount with key={focus} when it changes) */
  focus?: string | number | null;
}) {
  const [open, setOpen] = useState(() => focus != null && items.some((x) => x.id === focus));
  if (!items.length) return null;
  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-left shadow-sm hover:bg-silver/60">
        <span className={`w-4 text-center text-xs text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
        <span className="text-base font-bold text-navy">{title}</span>
        <span className="text-xs text-gray-400">{items.length} {noun}{items.length === 1 ? "" : "s"}</span>
      </button>
      {open && (
        <div className="mt-2">
          {note && <p className="mb-2 ml-4 text-xs text-gray-400 sm:ml-6">{note}</p>}
          <Group items={items} levels={levels} depth={0} render={render} noun={noun} path="" focus={focus} />
        </div>
      )}
    </div>
  );
}

// helpers shared by the archives
export const ymOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
/** Academic year label (1 July – 30 June) for a timestamp, e.g. "2026–27". */
export const academicYearOf = (iso: string) => {
  const d = new Date(iso); const y = d.getMonth() < 6 ? d.getFullYear() - 1 : d.getFullYear();
  return `${y}–${String((y + 1) % 100).padStart(2, "0")}`;
};
