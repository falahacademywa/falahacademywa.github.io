import { type ReactNode, useEffect, useRef, useState } from "react";
import { PRESETS, presetRange, type Preset, type Period } from "../lib/reports";

export function RangePicker({ preset, from, to, onChange, presets = PRESETS, monthOnly = false }: {
  preset: Preset; from: string; to: string;
  onChange: (v: { preset: Preset; from: string; to: string }) => void;
  presets?: [Preset, string][]; monthOnly?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map(([p, label]) => (
        <button key={p} onClick={() => onChange(p === "custom" ? { preset: p, from, to } : { preset: p, ...presetRange(p) })}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${preset === p ? "bg-navy text-white" : "bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-silver"}`}>
          {label}
        </button>
      ))}
      {preset === "custom" && (
        <span className="ml-1 flex items-center gap-1 text-xs text-gray-500">
          {monthOnly ? (
            <>
              <input type="month" value={from.slice(0, 7)} onChange={(e) => onChange({ preset, from: e.target.value + "-01", to })} className="rounded border border-gray-300 px-2 py-1 text-xs" />
              to
              <input type="month" value={to.slice(0, 7)} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); onChange({ preset, from, to: `${e.target.value}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}` }); }} className="rounded border border-gray-300 px-2 py-1 text-xs" />
            </>
          ) : (
            <>
              <input type="date" value={from} onChange={(e) => onChange({ preset, from: e.target.value, to })} className="rounded border border-gray-300 px-2 py-1 text-xs" />
              to
              <input type="date" value={to} onChange={(e) => onChange({ preset, from, to: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-xs" />
            </>
          )}
        </span>
      )}
    </div>
  );
}

export function Chips<T extends string>({ label, options, value, onChange }: {
  label: string; options: { key: T; label: string; cls?: string }[]; value: T[]; onChange: (v: T[]) => void;
}) {
  const all = value.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      <button onClick={() => onChange([])} className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${all ? "bg-navy text-white" : "bg-white text-gray-500 ring-1 ring-gray-300 hover:bg-silver"}`}>All</button>
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button key={o.key} onClick={() => onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key])}
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${on ? (o.cls ?? "bg-navy text-white") : "bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-silver"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PeriodToggle({ value, onChange, options = ["day", "month", "year"] }: { value: Period; onChange: (p: Period) => void; options?: Period[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">By</span>
      {options.map((p) => (
        <button key={p} onClick={() => onChange(p)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${value === p ? "bg-emerald-brand text-white" : "bg-white text-gray-600 ring-1 ring-gray-300 hover:bg-silver"}`}>{p}</button>
      ))}
    </div>
  );
}

export function Tile({ label, value, sub, tone = "navy" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "navy" | "green" | "amber" | "red" | "gray" }) {
  const c = { navy: "text-navy", green: "text-emerald-deep", amber: "text-amber-700", red: "text-red-700", gray: "text-gray-600" }[tone];
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-0.5 font-display text-2xl font-semibold ${c}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

/** One expandable row of a drill-down table. */
export function DrillRow({ depth, open, onToggle, cells, canOpen = true }: { depth: number; open?: boolean; onToggle?: () => void; cells: ReactNode[]; canOpen?: boolean }) {
  const bg = depth === 0 ? "bg-white font-semibold text-navy" : depth === 1 ? "bg-gray-50/70 text-gray-800" : "bg-white text-gray-600";
  return (
    <tr className={`border-b border-gray-100 ${bg} ${canOpen && onToggle ? "cursor-pointer hover:bg-silver/60" : ""}`} onClick={canOpen ? onToggle : undefined}>
      <td className="py-1.5 pr-2" style={{ paddingLeft: 8 + depth * 18 }}>
        <span className="inline-flex items-center gap-1.5">
          {canOpen && onToggle ? <span className="w-3 text-gray-400">{open ? "▾" : "▸"}</span> : <span className="w-3" />}
          {cells[0]}
        </span>
      </td>
      {cells.slice(1).map((c, i) => <td key={i} className="py-1.5 pr-3 text-right tabular-nums">{c}</td>)}
    </tr>
  );
}


// ---------------------------------------------------------------------------------------------
// Compact filter bar (President 2026-11-10: "modern and easy to use"): one row of dropdowns, the
// active filters as removable tags under it. Shared by the three reports.
// ---------------------------------------------------------------------------------------------
const ctl = "inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:border-gray-400";

/** Date range as one dropdown (presets) — "Custom dates" shows two date (or month) boxes. */
export function DateMenu({ preset, from, to, onChange, presets = PRESETS, monthOnly = false }: {
  preset: Preset; from: string; to: string; onChange: (v: { preset: Preset; from: string; to: string }) => void;
  presets?: [Preset, string][]; monthOnly?: boolean;
}) {
  const lastDay = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="relative inline-flex">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden>📅</span>
        <select value={preset} onChange={(e) => { const p = e.target.value as Preset; onChange(p === "custom" ? { preset: p, from, to } : { preset: p, ...presetRange(p) }); }}
          aria-label="Dates" className={`${ctl} cursor-pointer appearance-none pl-9 pr-8 outline-none`}>
          {presets.map(([p, l]) => <option key={p} value={p}>{l === "Custom" ? "Custom dates" : l}</option>)}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>▾</span>
      </span>
      {preset === "custom" && (monthOnly ? (
        <>
          <input type="month" value={from.slice(0, 7)} onChange={(e) => onChange({ preset, from: e.target.value + "-01", to })} className={ctl} />
          <span className="text-xs text-gray-400">to</span>
          <input type="month" value={to.slice(0, 7)} onChange={(e) => onChange({ preset, from, to: lastDay(e.target.value) })} className={ctl} />
        </>
      ) : (
        <>
          <input type="date" value={from} onChange={(e) => onChange({ preset, from: e.target.value, to })} className={ctl} />
          <span className="text-xs text-gray-400">to</span>
          <input type="date" value={to} onChange={(e) => onChange({ preset, from, to: e.target.value })} className={ctl} />
        </>
      ))}
    </span>
  );
}

/** A dropdown with check boxes: "Grade: All ▾", "Grade: KG, Pre-K ▾". */
export function MultiSelect<T extends string>({ label, options, value, onChange }: {
  label: string; options: { key: T; label: string; dot?: string }[]; value: T[]; onChange: (v: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = value.length === 0 ? "All" : value.length <= 2 ? value.map((v) => options.find((o) => o.key === v)?.label ?? v).join(", ") : `${value.length} selected`;
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen(!open)} className={`${ctl} ${value.length ? "border-navy/40 bg-navy/5" : ""}`} aria-expanded={open}>
        <span className="text-gray-500">{label}:</span> <span className="max-w-[10rem] truncate font-semibold text-navy">{shown}</span> <span className="text-gray-400" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 min-w-[13rem] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          {options.map((o) => {
            const on = value.includes(o.key);
            return (
              <label key={o.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-silver/70">
                <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((v) => v !== o.key) : [...value, o.key])} />
                {o.dot && <span className={`h-2 w-2 rounded-full ${o.dot}`} aria-hidden />}
                <span>{o.label}</span>
              </label>
            );
          })}
          {!options.length && <p className="px-2 py-1.5 text-sm text-gray-400">Nothing to choose yet.</p>}
          <div className="mt-1 flex justify-between border-t border-gray-100 px-2 pt-1.5 text-xs">
            <button type="button" onClick={() => onChange([])} className="text-gray-500 hover:text-navy">Show all</button>
            <button type="button" onClick={() => setOpen(false)} className="font-semibold text-navy">Done</button>
          </div>
        </div>
      )}
    </span>
  );
}

/** Student picker grouped by grade. */
export function StudentSelect({ value, onChange, groups, label = "All students" }: {
  value: string; onChange: (v: string) => void; groups: [string, [string, string][]][]; label?: string;
}) {
  return (
    <span className="relative inline-flex">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" aria-hidden>👤</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className={`${ctl} max-w-[15rem] cursor-pointer appearance-none truncate pl-9 pr-8 outline-none ${value ? "border-navy/40 bg-navy/5 font-semibold text-navy" : ""}`}>
        <option value="">{label}</option>
        {groups.map(([g, list]) => <optgroup key={g} label={g}>{list.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</optgroup>)}
      </select>
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden>▾</span>
    </span>
  );
}

/** Day / Month / Year switch. */
export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { key: T; label: string }[]; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      {label && <span className="text-xs text-gray-500">{label}</span>}
      <span className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5">
        {options.map((o) => (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            className={`rounded-md px-3 py-1 text-xs font-semibold ${value === o.key ? "bg-navy text-white" : "text-gray-600 hover:bg-silver"}`}>{o.label}</button>
        ))}
      </span>
    </span>
  );
}

/** The active filters as tags you can remove, plus "Clear all". */
export function FilterTags({ tags }: { tags: { label: string; clear: () => void }[] }) {
  if (!tags.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <button key={t.label} type="button" onClick={t.clear} className="inline-flex items-center gap-1 rounded-full bg-navy/10 px-2.5 py-0.5 text-xs font-semibold text-navy hover:bg-navy/20">
          {t.label} <span aria-hidden>✕</span>
        </button>
      ))}
      <button type="button" onClick={() => tags.forEach((t) => t.clear())} className="text-xs text-gray-500 hover:text-navy">Clear all</button>
    </div>
  );
}

/** Search box with an icon. */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className={`${ctl} min-w-[14rem] flex-1 cursor-text`}>
      <span className="text-gray-400" aria-hidden>🔍</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-transparent outline-none" />
      {value && <button type="button" onClick={() => onChange("")} className="text-gray-400 hover:text-navy" aria-label="Clear search">✕</button>}
    </label>
  );
}
