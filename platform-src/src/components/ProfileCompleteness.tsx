// "Your family profile is 70% complete" on the parent home page (President 2026-11-22).
// Counts only what a parent can do online, so reaching 100% is in the family's own hands:
// their mobile number, a phone number for each parent/guardian, an emergency contact per child,
// the three school forms per child and a photo per child. Paper documents handed in at the
// office (birth certificate, immunization record) are not counted here; they are listed under
// Family information → Documents. Each missing item is a button that opens the place to fix it.
// Shown as a small ring with the % beside the Feedback button (President 2026-11-22); hovering it
// (mouse) or tapping it opens a panel like the notification panel with the details and the buttons.
import { useEffect, useRef, useState } from "react";
import { supabase, configMissing } from "../lib/supabase";
import { formStatus, FORM_SHORT } from "./StudentForms";
import type { FormKind, MedicalRow, ConsentRow } from "./StudentForms";

interface Kid { id: string; first_name: string; hasPhoto: boolean }
interface Item { key: string; label: string; done: boolean; fix: () => void }

export default function ProfileCompleteness({ userId, kids, formRows, refresh, onFamily, onForm, onPhoto }: {
  userId: string | undefined;
  kids: Kid[];
  formRows: Record<string, { med: MedicalRow | null; con: ConsentRow | null }>;
  refresh: unknown;                                     // changes when family information may have been edited
  onFamily: (tab: "parents" | "contacts") => void;
  onForm: (kind: FormKind, kidId: string) => void;
  onPhoto: (kidId: string) => void;
}) {
  const [phone, setPhone] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<{ student_id: string; phone: string | null }[]>([]);
  const [ec, setEc] = useState<{ student_id: string }[]>([]);
  const [ready, setReady] = useState(false);
  // the panel: opened by hover (mouse only, closes when the pointer leaves) or by a tap/click (stays until closed)
  const [open, setOpen] = useState<false | "hover" | "click">(false);
  const leaveTimer = useRef<number | undefined>(undefined);
  const ids = kids.map((k) => k.id).join(",");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  const enter = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(leaveTimer.current);
    setOpen((o) => o || "hover");
  };
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setOpen((o) => (o === "hover" ? false : o)), 250);
  };

  useEffect(() => {
    if (configMissing || !userId || !ids) return;
    let alive = true;
    const sids = ids.split(",");
    Promise.all([
      supabase.from("profiles").select("phone").eq("id", userId).maybeSingle(),
      supabase.from("guardians").select("student_id, phone").in("student_id", sids),
      supabase.from("emergency_contacts").select("student_id").in("student_id", sids),
    ]).then(([p, g, e]) => {
      if (!alive) return;
      setPhone((p.data as { phone: string | null } | null)?.phone ?? "");
      setGuardians((g.data as { student_id: string; phone: string | null }[] | null) ?? []);
      setEc((e.data as { student_id: string }[] | null) ?? []);
      setReady(true);
    });
    return () => { alive = false; };
  }, [userId, ids, refresh]);

  if (!ready || !kids.length) return null;

  const items: Item[] = [
    { key: "phone", label: "Your mobile number", done: !!phone?.trim(), fix: () => onFamily("parents") },
    { key: "gphone", label: "A phone number for each parent or guardian",
      done: guardians.length > 0 && guardians.every((g) => !!g.phone?.trim()), fix: () => onFamily("parents") },
  ];
  for (const k of kids) {
    items.push({ key: `ec:${k.id}`, label: `An emergency contact for ${k.first_name}`,
      done: ec.some((x) => x.student_id === k.id), fix: () => onFamily("contacts") });
    for (const f of ["allergy", "medical", "consent"] as FormKind[]) {
      items.push({ key: `${f}:${k.id}`, label: `${FORM_SHORT[f]} for ${k.first_name}`,
        done: formStatus(f, formRows[k.id]?.med, formRows[k.id]?.con).done, fix: () => onForm(f, k.id) });
    }
    items.push({ key: `photo:${k.id}`, label: `A photo of ${k.first_name}`, done: k.hasPhoto, fix: () => onPhoto(k.id) });
  }
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  const todo = items.filter((i) => !i.done);
  const formsMissing = todo.some((i) => /^(allergy|medical|consent):/.test(i.key));
  const pick = (fix: () => void) => { setOpen(false); fix(); };

  const panel = !todo.length ? (
    <div className="text-sm text-emerald-800">
      <span className="font-display text-base font-semibold">100%</span> Your family profile is complete. Thank you!
    </div>
  ) : (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="text-sm font-semibold text-amber-900">Your family profile is <span className="font-display text-xl">{pct}%</span> complete</div>
        <div className="text-[11px] text-amber-700">{done} of {items.length} done</div>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-amber-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-2 text-xs font-semibold text-amber-800">Still needed (each takes about two minutes):</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {todo.map((i) => (
          <button key={i.key} onClick={() => pick(i.fix)}
            className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
            {i.label} →
          </button>
        ))}
      </div>
      {formsMissing && <div className="mt-1.5 text-[11px] text-amber-700">Already handed in a paper form? It may not be entered yet — filling it in here takes precedence and the office is notified.</div>}
    </div>
  );

  // the ring: red below half, amber below 80%, green from 80%; a tick at 100%
  const R = 17, C = 2 * Math.PI * R;
  const tone = !todo.length || pct >= 80 ? "emerald" : pct >= 50 ? "amber" : "red";
  const ring = { emerald: "stroke-emerald-500", amber: "stroke-amber-500", red: "stroke-red-500" }[tone];
  const text = { emerald: "text-emerald-700", amber: "text-amber-700", red: "text-red-600" }[tone];
  return (
    <>
      <button type="button" onPointerEnter={enter} onPointerLeave={leave}
        onClick={() => setOpen((o) => (o === "click" ? false : "click"))}
        aria-expanded={!!open} aria-label={`Family profile ${pct}% complete${todo.length ? `, ${todo.length} still needed` : ""}. Show details`}
        title={todo.length ? `Family profile ${pct}% complete` : "Family profile complete"}
        className="relative z-30 h-11 w-11 shrink-0 rounded-full bg-white shadow-sm transition hover:shadow-md">
        <svg viewBox="0 0 44 44" className="h-11 w-11 -rotate-90" aria-hidden="true">
          <circle cx="22" cy="22" r={R} fill="none" strokeWidth="4" className="stroke-gray-200" />
          <circle cx="22" cy="22" r={R} fill="none" strokeWidth="4" strokeLinecap="round" className={ring}
            strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} />
        </svg>
        <span className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold ${text}`}>{todo.length ? `${pct}%` : "✓"}</span>
      </button>
      {open === "click" && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />}
      {open && (
        // anchored to the right edge of the Feedback group, as wide as the screen allows
        <div onPointerEnter={enter} onPointerLeave={leave} role="dialog" aria-label="Family profile"
          className={`absolute right-0 top-full z-30 mt-2 w-[min(26rem,calc(100vw-2rem))] rounded-xl border p-4 shadow-2xl ${
            todo.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          {panel}
        </div>
      )}
    </>
  );
}
