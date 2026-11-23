// Parent home (phase 33): the parent-teacher meeting for the selected child — the booked
// time, and afterwards the class teacher's and the Qur'an teacher's remarks.
import { useEffect, useState } from "react";
import { supabase, configMissing } from "../lib/supabase";
import { ampm, longDate, KIND_LABEL } from "../lib/meetings";
import { todayStr } from "../lib/dates";

// After the meeting day the card goes away (President 2026-11-22: "the meeting is done, this should
// have been dismissed"). If the teachers wrote remarks it stays for 30 days so the family can read them.
const KEEP_REMARKS_DAYS = 30;
const plusDays = (iso: string, n: number) => {
  const d = new Date(iso.slice(0, 10) + "T12:00:00"); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Row { student_id: string; class: string; title: string; date: string; minutes: number; slot: string | null;
  remarks: { kind: string; body: string; by: string | null; at: string }[] }

export default function MeetingCard({ studentId, firstName }: { studentId: string | undefined; firstName: string | undefined }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (configMissing) return;
    supabase.rpc("ptm_parent_view").then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  const today = todayStr();
  const past = (r: Row) => r.date.slice(0, 10) < today;
  const mine = rows.filter((r) => r.student_id === studentId
    && (!past(r) || (r.remarks.length > 0 && plusDays(r.date, KEEP_REMARKS_DAYS) >= today)));
  if (!mine.length) return null;
  return (
    <>
      {mine.map((m) => (
        <section key={m.date + m.class} className="rounded-xl bg-white p-5 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-navy">{m.title}{firstName ? ` — ${firstName}` : ""}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {longDate(m.date)} · {m.class} ·{" "}
            {past(m) ? <span className="text-gray-500">the teachers' remarks</span>
              : m.slot ? <span className="font-semibold text-emerald-deep">your time: {ampm(m.slot)}</span>
              : <span className="font-semibold text-amber-700">no time booked — please use the booking link the school sent on WhatsApp, or call the office</span>}
          </p>
          {m.remarks.length > 0 && (
            <div className="mt-3 space-y-3">
              {m.remarks.map((r) => (
                <div key={r.kind} className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
                  <div className="mb-1 text-xs font-bold text-emerald-deep">
                    {KIND_LABEL[r.kind] ?? r.kind}{r.by ? ` · ${r.by}` : ""}
                    <span className="font-normal text-gray-400"> · {new Date(r.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{r.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}
