// "Your family profile is 70% complete" on the parent home page (President 2026-11-22).
// Counts only what a parent can do online, so reaching 100% is in the family's own hands:
// their mobile number, a phone number for each parent/guardian, an emergency contact per child,
// the three school forms per child and a photo per child. Paper documents handed in at the
// office (birth certificate, immunization record) are not counted here; they are listed under
// Family information → Documents. Each missing item is a button that opens the place to fix it.
import { useEffect, useState } from "react";
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
  const ids = kids.map((k) => k.id).join(",");

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

  if (!todo.length) return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
      <span className="font-display text-base font-semibold">100%</span> Your family profile is complete. Thank you!
    </div>
  );
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 sm:px-5">
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
          <button key={i.key} onClick={i.fix}
            className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">
            {i.label} →
          </button>
        ))}
      </div>
      {formsMissing && <div className="mt-1.5 text-[11px] text-amber-700">Already handed in a paper form? It may not be entered yet — filling it in here takes precedence and the office is notified.</div>}
    </div>
  );
}
