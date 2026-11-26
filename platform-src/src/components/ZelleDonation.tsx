// "Donation…" on a Zelle alert (phase 52, President 2026-11-26): fees are matched first; money that
// is a gift is recorded here under a donor: one already on file, a new one, or an anonymous profile
// ("Anonymous donor 1", 2, ...). The sender is remembered, so their next Zelle is recorded by itself.
// Full admins only (the donor tables are private to them).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

export interface ZelleForDonation { id: number; payer: string; amount: number; memo: string | null; received_at: string }
interface DonorOpt { id: string; name: string; company: string | null }
type Mode = "existing" | "new" | "anonymous";

// same idea as the database's payer_key(): letters only, lower case, words sorted
const key = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
const words = (s: string) => new Set(key(s).split(" ").filter((w) => w.length >= 3));

export default function ZelleDonation({ z, onClose, onDone }: { z: ZelleForDonation; onClose: () => void; onDone: (donorId: string | null) => void }) {
  const [donors, setDonors] = useState<DonorOpt[] | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [pick, setPick] = useState("");
  const [q, setQ] = useState("");
  const [name, setName] = useState(z.payer);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("donors").select("id, name, company").order("name").then(({ data, error }) => {
      if (error) { setMsg("Donors could not be loaded: " + error.message); setDonors([]); return; }
      const list = (data as DonorOpt[]) ?? [];
      setDonors(list);
      const exact = list.find((d) => key(d.name) === key(z.payer));
      if (exact) { setMode("existing"); setPick(exact.id); }
    });
  }, [z.payer]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // donors sharing a name with the sender first, then the rest, filtered by the search box
  const options = useMemo(() => {
    const pw = words(z.payer);
    const s = q.trim().toLowerCase();
    return (donors ?? [])
      .map((d) => ({ ...d, close: [...words(d.name)].some((w) => pw.has(w)) }))
      .filter((d) => !s || d.name.toLowerCase().includes(s) || (d.company ?? "").toLowerCase().includes(s))
      .sort((a, b) => Number(b.close) - Number(a.close) || a.name.localeCompare(b.name));
  }, [donors, q, z.payer]);

  async function save() {
    if (mode === "existing" && !pick) return setMsg("Pick the donor.");
    if (mode === "new" && !name.trim()) return setMsg("Enter the new donor's name.");
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("record_zelle_donation", {
      p_inbox: z.id, p_donor: mode === "existing" ? pick : null,
      p_new_name: mode === "new" ? name.trim() : null, p_remember: remember,
    });
    if (error) { setBusy(false); setMsg("Could not record it: " + error.message + (error.message.includes("record_zelle_donation") ? " (run platform_schema_phase52.sql)" : "")); return; }
    const { data: g } = await supabase.from("donations").select("donor_id").eq("id", data as string).maybeSingle();
    setBusy(false);
    onDone((g as { donor_id: string } | null)?.donor_id ?? null);
  }

  const radio = (m: Mode, label: string, hint: string) => (
    <label className={`flex cursor-pointer items-start gap-2 rounded-lg border-2 p-2.5 ${mode === m ? "border-royal bg-blue-50/50" : "border-gray-200"}`}>
      <input type="radio" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5" />
      <span><span className="block text-sm font-semibold text-navy">{label}</span><span className="block text-xs text-gray-500">{hint}</span></span>
    </label>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">🎁 Record as a donation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy" aria-label="Close">✕</button>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          <b>${Number(z.amount).toFixed(2)}</b> by Zelle from <b>{z.payer}</b>
          {z.memo && <> · “{z.memo}”</>} · {new Date(z.received_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </p>

        <div className="space-y-2">
          {radio("existing", "A donor already on file", "Adds it to their pledges & donations.")}
          {mode === "existing" && (
            <div className="ml-6 space-y-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search donors…"
                className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
              <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-200">
                {donors === null && <p className="p-2 text-xs text-gray-400">Loading…</p>}
                {donors && !options.length && <p className="p-2 text-xs text-gray-400">No donor found.</p>}
                {options.map((d) => (
                  <button key={d.id} type="button" onClick={() => setPick(d.id)}
                    className={`flex w-full items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-left text-sm last:border-0 ${pick === d.id ? "bg-navy text-white" : "hover:bg-silver"}`}>
                    <span className="font-semibold">{d.name}</span>
                    {d.company && <span className={`text-xs ${pick === d.id ? "text-white/70" : "text-gray-400"}`}>{d.company}</span>}
                    {d.close && <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${pick === d.id ? "bg-white/20" : "bg-amber-100 text-amber-800"}`}>same name</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {radio("new", "A new donor", "Creates their profile; add e-mail, company and the rest later in Donors.")}
          {mode === "new" && (
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Donor's name"
              className="ml-6 w-[calc(100%-1.5rem)] rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
          )}
          {radio("anonymous", "Anonymous", "Creates “Anonymous donor N”. The Zelle sender's name is kept in the profile's notes, visible to you only; rename it if the donor becomes known.")}
        </div>

        <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5" />
          <span>Remember “{z.payer}”: their next Zelle that is not fees is recorded under this donor by itself.</span>
        </label>
        {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className="rounded-lg bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">
            {busy ? "Recording…" : `Record $${Number(z.amount).toFixed(0)} as a donation`}
          </button>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
        </div>
      </div>
    </div>
  );
}
