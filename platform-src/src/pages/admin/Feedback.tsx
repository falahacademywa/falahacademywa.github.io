import { useEffect, useState } from "react";
import { supabase, configMissing } from "../../lib/supabase";

interface Row {
  id: string;
  category: string;
  message: string;
  resolved: boolean;
  created_at: string;
  profiles: { full_name: string; email: string | null; phone: string | null };
}

const catStyles: Record<string, string> = {
  general: "bg-gray-100 text-gray-600", attendance: "bg-blue-100 text-blue-700",
  fees: "bg-amber-100 text-amber-800", class: "bg-purple-100 text-purple-700",
  portal: "bg-emerald-50 text-emerald-deep", other: "bg-gray-100 text-gray-600",
};

export default function Feedback() {
  const [rows, setRows] = useState<Row[]>([]);
  const [showResolved, setShowResolved] = useState(false);

  async function load() {
    if (configMissing) return;
    const { data } = await supabase.from("feedback")
      .select("id, category, message, resolved, created_at, profiles ( full_name, email, phone )")
      .order("created_at", { ascending: false }).limit(200);
    setRows((data as unknown as Row[]) ?? []);
  }
  useEffect(() => { load(); }, []);

  async function toggle(r: Row) {
    await supabase.from("feedback").update({ resolved: !r.resolved }).eq("id", r.id);
    load();
  }

  const visible = rows.filter((r) => showResolved || !r.resolved);

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-navy">Parent Feedback</h1>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}
      <div className="space-y-3">
        {visible.map((r) => (
          <div key={r.id} className={`rounded-xl border bg-white p-4 shadow-sm ${r.resolved ? "border-gray-100 opacity-60" : "border-gray-200"}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-navy">{r.profiles.full_name}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${catStyles[r.category]}`}>{r.category}</span>
              <span className="ml-auto text-xs text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{r.message}</p>
            <div className="mt-3 flex items-center gap-3 border-t border-gray-100 pt-2 text-xs text-gray-500">
              {r.profiles.email && <span>✉️ {r.profiles.email}</span>}
              {r.profiles.phone && <span>📞 {r.profiles.phone}</span>}
              <button onClick={() => toggle(r)}
                className={`ml-auto rounded-lg px-3 py-1 font-semibold ${r.resolved ? "border border-gray-300 text-gray-600 hover:bg-silver" : "bg-emerald-brand text-white hover:bg-emerald-deep"}`}>
                {r.resolved ? "Reopen" : "Mark resolved"}
              </button>
            </div>
          </div>
        ))}
        {!configMissing && !visible.length && (
          <p className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-400">
            No {showResolved ? "" : "open "}feedback. Parents submit it from the 💬 button on their dashboard.
          </p>
        )}
      </div>
    </div>
  );
}
