// Admin → Donors (phase 51, President 2026-11-26). FULL ADMINS ONLY: the database refuses every
// other login, and the module is never offered on Staff & Permissions.
//   /admin/donors      the list: totals, search, filters; a click opens the donor
//   /admin/donors/:id  the donor's profile (name, e-mail, phone, address, city, company,
//                      designation, notes) and their gifts: amount, pledged or donated, one-time or
//                      monthly, method (cash, Zelle, employee matching, Fidelity, other)
// Add / edit / delete for donors and gifts. A pledge becomes a donation with "Mark donated".
// Zelle (phase 52): fees are matched first; a known donor's Zelle is recorded here by itself, and
// any other gift is matched by hand on Admin -> Fees ("Donation…"), which can create the donor.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { usDate, usPhone } from "../../lib/format";
import { todayStr } from "../../lib/dates";
import BackLink from "../../components/BackLink";

type Status = "pledged" | "donated";
type Freq = "one_time" | "monthly";
type Method = "cash" | "zelle" | "employee_matching" | "fidelity" | "other";
interface Gift {
  id: string; donor_id: string; amount: number; status: Status; frequency: Freq; method: Method;
  method_other: string | null; pledged_on: string | null; donated_on: string | null; note: string | null; created_at: string;
}
interface Donor {
  id: string; name: string; email: string | null; phone: string | null; address: string | null; city: string | null;
  company: string | null; designation: string | null; notes: string | null; created_at: string; updated_at: string;
  donations: Gift[];
}
type DonorDraft = Pick<Donor, "name" | "email" | "phone" | "address" | "city" | "company" | "designation" | "notes">;
type GiftDraft = { amount: string; status: Status; frequency: Freq; method: Method; method_other: string; date: string; note: string };

const METHODS: [Method, string][] = [
  ["cash", "Cash"], ["zelle", "Zelle"], ["employee_matching", "Employee Matching"], ["fidelity", "Fidelity"], ["other", "Other"],
];
const methodLabel = (g: Pick<Gift, "method" | "method_other">) =>
  g.method === "other" && g.method_other?.trim() ? g.method_other.trim() : METHODS.find(([k]) => k === g.method)?.[1] ?? g.method;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 });
const blankDonor: DonorDraft = { name: "", email: "", phone: "", address: "", city: "", company: "", designation: "", notes: "" };
const blankGift = (): GiftDraft => ({ amount: "", status: "pledged", frequency: "one_time", method: "zelle", method_other: "", date: todayStr(), note: "" });
const nul = (s: string | null | undefined) => (s ?? "").trim() || null;

// one-time and monthly kept apart: $500 pledged once is not the same as $50 a month
function totals(gs: Gift[]) {
  const t = { pledged: 0, pledgedMo: 0, donated: 0, donatedMo: 0 };
  for (const g of gs) {
    const a = Number(g.amount) || 0;
    if (g.status === "pledged") { if (g.frequency === "monthly") t.pledgedMo += a; else t.pledged += a; }
    else if (g.frequency === "monthly") t.donatedMo += a; else t.donated += a;
  }
  return t;
}
// "Last donated" column (President 2026-11-26): month and year of the latest gift actually received, "Mon YYYY"
function lastDonated(gs: Gift[]): string | null {
  const days = gs.filter((g) => g.status === "donated").map((g) => g.donated_on ?? g.created_at.slice(0, 10)).sort();
  const d = days[days.length - 1];
  return d ? new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null;
}
function amountText(once: number, monthly: number) {
  if (!once && !monthly) return "—";
  return [once ? money(once) : "", monthly ? `${money(monthly)}/mo` : ""].filter(Boolean).join(" + ");
}

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-royal focus:outline-none focus:ring-2 focus:ring-royal/20";
const chip = (on: boolean) => `rounded-full px-3 py-1 text-xs font-semibold transition ${on ? "bg-navy text-white" : "border border-gray-300 bg-white text-gray-600 hover:border-navy"}`;

export default function Donors() {
  const { profile } = useAuth();
  const { id } = useParams();
  const nav = useNavigate();
  const [donors, setDonors] = useState<Donor[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [zWaiting, setZWaiting] = useState(0);   // Zelle alerts still to match (fees or donation), phase 52

  async function load() {
    if (configMissing) { setDonors([]); return; }
    supabase.from("zelle_inbox").select("id", { count: "exact", head: true }).eq("status", "pending")
      .then(({ count }) => setZWaiting(count ?? 0));
    const { data, error } = await supabase.from("donors")
      .select("id, name, email, phone, address, city, company, designation, notes, created_at, updated_at, donations ( id, donor_id, amount, status, frequency, method, method_other, pledged_on, donated_on, note, created_at )")
      .order("name");
    if (error) { setErr(error.message.includes("donors") ? "The Donors table is not set up in this database yet (phase 51)." : error.message); setDonors([]); return; }
    setErr(null);
    setDonors(((data as unknown as Donor[]) ?? []).map((d) => ({ ...d, donations: [...(d.donations ?? [])].sort((a, b) => (b.donated_on ?? b.pledged_on ?? b.created_at).localeCompare(a.donated_on ?? a.pledged_on ?? a.created_at)) })));
  }
  useEffect(() => { load(); }, []);

  if (profile?.role !== "admin") {
    return <div className="rounded-xl bg-white p-6 text-sm text-gray-500 shadow-sm">Donors is open to full admins only.</div>;
  }
  const current = id ? donors?.find((d) => d.id === id) : undefined;
  return (
    <div className="space-y-5">
      {err && <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{err}</div>}
      {id
        ? (donors === null ? <p className="text-sm text-gray-400">Loading…</p>
          : current ? <DonorProfile donor={current} reload={load} onDeleted={() => { nav("/admin/donors", { replace: true }); load(); }} />
          : <div className="space-y-3"><BackLink to="/admin/donors" label="Donors" /><p className="text-sm text-gray-500">This donor is not on file (deleted?).</p></div>)
        : <>
            {zWaiting > 0 && (
              <button onClick={() => nav("/admin/fees")}
                className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800 hover:bg-amber-100">
                💸 <b>{zWaiting} Zelle payment{zWaiting === 1 ? "" : "s"}</b> waiting for a match: fees or a donation.
                <span className="ml-auto font-semibold underline">Open Fees →</span>
              </button>
            )}
            <DonorList donors={donors} onAdd={() => setAdding(true)} onOpen={(d) => nav(`/admin/donors/${d}`)} />
          </>}
      {adding && <AddDonor onClose={() => setAdding(false)} onSaved={async (newId) => { setAdding(false); await load(); nav(`/admin/donors/${newId}`); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- list
function DonorList({ donors, onAdd, onOpen }: { donors: Donor[] | null; onAdd: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [st, setSt] = useState<"all" | "pledged" | "donated">("all");
  const [fr, setFr] = useState<"all" | Freq>("all");
  const [me, setMe] = useState<"all" | Method>("all");
  const all = donors ?? [];
  const sum = useMemo(() => totals(all.flatMap((d) => d.donations)), [all]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((d) => {
      if (s && ![d.name, d.email, d.phone, d.company, d.designation, d.city].some((x) => (x ?? "").toLowerCase().includes(s))) return false;
      if (st !== "all" && !d.donations.some((g) => g.status === st)) return false;
      if (fr !== "all" && !d.donations.some((g) => g.frequency === fr)) return false;
      if (me !== "all" && !d.donations.some((g) => g.method === me)) return false;
      return true;
    });
  }, [all, q, st, fr, me]);

  const tiles: [string, string, string, string][] = [
    ["Donors", String(all.length), `${all.filter((d) => d.donations.length).length} with a gift on file`, "text-navy"],
    ["Pledged", money(sum.pledged), sum.pledgedMo ? `+ ${money(sum.pledgedMo)} a month` : "not yet received", "text-amber-700"],
    ["Donated", money(sum.donated), sum.donatedMo ? `+ ${money(sum.donatedMo)} a month` : "received", "text-emerald-deep"],
    ["Monthly", `${money(sum.pledgedMo + sum.donatedMo)}/mo`, `${all.filter((d) => d.donations.some((g) => g.frequency === "monthly")).length} monthly donor(s)`, "text-royal"],
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-navy">Donors</h1>
          <p className="text-xs text-gray-500">🔒 Only full admins can open this page. Staff never see it.</p>
        </div>
        <button onClick={onAdd} className="ml-auto rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-royal">+ Add donor</button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(([label, value, sub, tone]) => (
          <div key={label} className="rounded-xl bg-white p-4 shadow-sm">
            <div className={`font-display text-2xl font-semibold ${tone}`}>{value}</div>
            <div className="text-sm font-semibold text-gray-700">{label}</div>
            <div className="text-xs text-gray-400">{sub}</div>
          </div>
        ))}
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, e-mail, phone, city…"
            className={`${inputCls} min-w-0 flex-1 basis-60`} />
          <select value={st} onChange={(e) => setSt(e.target.value as typeof st)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
            <option value="all">Pledged or donated</option><option value="pledged">Has a pledge</option><option value="donated">Has donated</option>
          </select>
          <select value={fr} onChange={(e) => setFr(e.target.value as typeof fr)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
            <option value="all">Monthly or one-time</option><option value="monthly">Monthly</option><option value="one_time">One-time</option>
          </select>
          <select value={me} onChange={(e) => setMe(e.target.value as typeof me)} className="rounded-lg border border-gray-300 px-2 py-2 text-sm">
            <option value="all">Any method</option>
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {donors === null ? <p className="mt-4 text-sm text-gray-400">Loading…</p>
          : !shown.length ? <p className="mt-4 text-sm text-gray-400">{all.length ? "No donor matches." : "No donors yet. Add the first one with “+ Add donor”."}</p>
          : (
            <div className="mt-4 divide-y divide-gray-100">
              <div className="hidden grid-cols-[2fr_1fr_1fr_0.9fr_1fr_1.2fr] gap-3 px-2 pb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400 md:grid">
                <span>Donor</span><span>Pledged</span><span>Donated</span><span>Last donated</span><span>Type</span><span>Method</span>
              </div>
              {shown.map((d) => {
                const t = totals(d.donations);
                const last = lastDonated(d.donations);
                const freqs = [...new Set(d.donations.map((g) => g.frequency))];
                const methods = [...new Set(d.donations.map((g) => methodLabel(g)))];
                return (
                  <button key={d.id} onClick={() => onOpen(d.id)}
                    className="grid w-full grid-cols-2 gap-x-3 gap-y-1 rounded-lg px-2 py-3 text-left text-sm hover:bg-silver/60 md:grid-cols-[2fr_1fr_1fr_0.9fr_1fr_1.2fr] md:items-center">
                    <span className="col-span-2 min-w-0 md:col-span-1">
                      <span className="block truncate font-semibold text-navy">{d.name}</span>
                      <span className="block truncate text-xs text-gray-500">{[d.designation, d.company].filter(Boolean).join(", ") || d.city || d.email || ""}</span>
                    </span>
                    <span className={t.pledged || t.pledgedMo ? "font-semibold text-amber-700" : "text-gray-300"}>
                      <span className="text-[10px] font-normal text-gray-400 md:hidden">Pledged </span>{amountText(t.pledged, t.pledgedMo)}
                    </span>
                    <span className={t.donated || t.donatedMo ? "font-semibold text-emerald-deep" : "text-gray-300"}>
                      <span className="text-[10px] font-normal text-gray-400 md:hidden">Donated </span>{amountText(t.donated, t.donatedMo)}
                    </span>
                    <span className={last ? "text-gray-700" : "text-gray-300"}>
                      <span className="text-[10px] font-normal text-gray-400 md:hidden">Last donated </span>{last ?? "—"}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {freqs.map((f) => <span key={f} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${f === "monthly" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{f === "monthly" ? "Monthly" : "One-time"}</span>)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {methods.map((m) => <span key={m} className="rounded-full bg-silver px-2 py-0.5 text-[11px] font-semibold text-gray-700">{m}</span>)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- donor fields (add + edit)
function DonorFields({ v, set }: { v: DonorDraft; set: (v: DonorDraft) => void }) {
  const f = (k: keyof DonorDraft, label: string, opts: { type?: string; placeholder?: string; wide?: boolean; required?: boolean } = {}) => (
    <label className={`block text-xs font-semibold text-gray-500 ${opts.wide ? "sm:col-span-2" : ""}`}>
      {label}{opts.required && <span className="text-red-500"> *</span>}
      <input type={opts.type ?? "text"} value={v[k] ?? ""} placeholder={opts.placeholder} onChange={(e) => set({ ...v, [k]: e.target.value })}
        className={`${inputCls} mt-1 font-normal text-gray-800`} />
    </label>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {f("name", "Name", { required: true, wide: true })}
      {f("email", "E-mail", { type: "email" })}
      {f("phone", "Phone", { type: "tel" })}
      {f("address", "Address", { wide: true, placeholder: "Street" })}
      {f("city", "City")}
      {f("company", "Company")}
      {f("designation", "Designation", { placeholder: "e.g. Engineering Manager" })}
      <label className="block text-xs font-semibold text-gray-500 sm:col-span-2">Notes
        <textarea rows={2} value={v.notes ?? ""} onChange={(e) => set({ ...v, notes: e.target.value })} className={`${inputCls} mt-1 font-normal text-gray-800`} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- gift fields (add + edit)
function GiftFields({ v, set }: { v: GiftDraft; set: (v: GiftDraft) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-semibold text-gray-500">Amount (USD) <span className="text-red-500">*</span>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => set({ ...v, amount: e.target.value })}
            placeholder="0" className={`${inputCls} mt-1 w-36 font-normal text-gray-800`} />
        </label>
        <div className="text-xs font-semibold text-gray-500">Status
          <div className="mt-1 flex gap-1.5">
            <button type="button" onClick={() => set({ ...v, status: "pledged" })} className={chip(v.status === "pledged")}>Pledged</button>
            <button type="button" onClick={() => set({ ...v, status: "donated" })} className={chip(v.status === "donated")}>Donated</button>
          </div>
        </div>
        <div className="text-xs font-semibold text-gray-500">Type
          <div className="mt-1 flex gap-1.5">
            <button type="button" onClick={() => set({ ...v, frequency: "one_time" })} className={chip(v.frequency === "one_time")}>One-time</button>
            <button type="button" onClick={() => set({ ...v, frequency: "monthly" })} className={chip(v.frequency === "monthly")}>Monthly</button>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs font-semibold text-gray-500">Method
          <select value={v.method} onChange={(e) => set({ ...v, method: e.target.value as Method })} className={`${inputCls} mt-1 w-48 font-normal text-gray-800`}>
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {v.method === "other" && (
          <label className="block text-xs font-semibold text-gray-500">Which?
            <input value={v.method_other} onChange={(e) => set({ ...v, method_other: e.target.value })} placeholder="e.g. Check, bank transfer"
              className={`${inputCls} mt-1 w-48 font-normal text-gray-800`} />
          </label>
        )}
        <label className="block text-xs font-semibold text-gray-500">{v.status === "donated" ? "Date received" : "Date pledged"}
          <input type="date" value={v.date} onChange={(e) => set({ ...v, date: e.target.value })} className={`${inputCls} mt-1 w-44 font-normal text-gray-800`} />
        </label>
      </div>
      <label className="block text-xs font-semibold text-gray-500">Note
        <input value={v.note} onChange={(e) => set({ ...v, note: e.target.value })} placeholder="e.g. Fundraiser 2026, matched by employer"
          className={`${inputCls} mt-1 font-normal text-gray-800`} />
      </label>
    </div>
  );
}
function giftRow(donorId: string, g: GiftDraft, keep?: Gift) {
  // keep the pledge date when a pledge is marked donated, and the other way round
  return {
    donor_id: donorId, amount: Number(g.amount), status: g.status, frequency: g.frequency, method: g.method,
    method_other: g.method === "other" ? nul(g.method_other) : null, note: nul(g.note),
    pledged_on: g.status === "pledged" ? (g.date || null) : (keep?.pledged_on ?? null),
    donated_on: g.status === "donated" ? (g.date || null) : null,
  };
}
const giftOk = (g: GiftDraft) => g.amount.trim() !== "" && Number(g.amount) >= 0 && !Number.isNaN(Number(g.amount));

// ---------------------------------------------------------------- add donor (dialog)
function AddDonor({ onClose, onSaved }: { onClose: () => void; onSaved: (id: string) => void }) {
  const [d, setD] = useState<DonorDraft>({ ...blankDonor });
  const [withGift, setWithGift] = useState(true);
  const [g, setG] = useState<GiftDraft>(blankGift());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  async function save() {
    if (!d.name.trim()) return setMsg("Please enter the donor's name.");
    if (withGift && g.amount.trim() && !giftOk(g)) return setMsg("Please enter a valid amount.");
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.from("donors").insert({
      name: d.name.trim(), email: nul(d.email), phone: nul(d.phone), address: nul(d.address), city: nul(d.city),
      company: nul(d.company), designation: nul(d.designation), notes: nul(d.notes),
    }).select("id").single();
    if (error || !data) { setBusy(false); return setMsg("Could not save: " + (error?.message ?? "unknown error")); }
    if (withGift && g.amount.trim()) {
      const { error: e2 } = await supabase.from("donations").insert(giftRow(data.id, g));
      if (e2) { setBusy(false); setMsg("The donor was saved, but the gift was not: " + e2.message); return; }
    }
    onSaved(data.id);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-6 w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy">Add donor</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-navy" aria-label="Close">✕</button>
        </div>
        <DonorFields v={d} set={setD} />
        <label className="mt-5 flex items-center gap-2 text-sm font-semibold text-navy">
          <input type="checkbox" checked={withGift} onChange={(e) => setWithGift(e.target.checked)} /> Add a pledge or donation now
        </label>
        {withGift && <div className="mt-3 rounded-xl bg-silver/60 p-3"><GiftFields v={g} set={setG} /></div>}
        {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
        <div className="mt-5 flex gap-2">
          <button onClick={save} disabled={busy} className="rounded-lg bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">{busy ? "Saving…" : "Save donor"}</button>
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- profile
function DonorProfile({ donor, reload, onDeleted }: { donor: Donor; reload: () => Promise<void>; onDeleted: () => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState<DonorDraft>({ ...donor });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const [newGift, setNewGift] = useState<GiftDraft | null>(null);
  const [editGift, setEditGift] = useState<{ id: string; v: GiftDraft } | null>(null);
  const [askGift, setAskGift] = useState<string | null>(null);
  useEffect(() => { if (!edit) setD({ ...donor }); }, [donor, edit]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (askDelete) setAskDelete(false); else if (askGift) setAskGift(null);
      else if (editGift) setEditGift(null); else if (newGift) setNewGift(null); else if (edit) setEdit(false);
    };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, [askDelete, askGift, editGift, newGift, edit]);

  const t = totals(donor.donations);
  async function run(p: PromiseLike<{ error: { message: string } | null }>, after?: () => void) {
    setBusy(true); setMsg(null);
    const { error } = await p;
    setBusy(false);
    if (error) { setMsg("Could not save: " + error.message); return false; }
    after?.(); await reload(); return true;
  }
  const saveDonor = () => {
    if (!d.name.trim()) { setMsg("The name cannot be empty."); return; }
    run(supabase.from("donors").update({
      name: d.name.trim(), email: nul(d.email), phone: nul(d.phone), address: nul(d.address), city: nul(d.city),
      company: nul(d.company), designation: nul(d.designation), notes: nul(d.notes),
    }).eq("id", donor.id), () => setEdit(false));
  };
  async function deleteDonor() {
    setBusy(true);
    const { error } = await supabase.from("donors").delete().eq("id", donor.id);
    setBusy(false);
    if (error) { setMsg("Could not delete: " + error.message); setAskDelete(false); return; }
    onDeleted();
  }
  const draftOf = (g: Gift): GiftDraft => ({
    amount: String(Number(g.amount)), status: g.status, frequency: g.frequency, method: g.method, method_other: g.method_other ?? "",
    date: (g.status === "donated" ? g.donated_on : g.pledged_on) ?? "", note: g.note ?? "",
  });
  const field = (label: string, value: string | null, href?: string) => (
    <div className="min-w-0">
      <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</div>
      {value ? (href ? <a href={href} className="break-words text-sm font-semibold text-royal hover:underline">{value}</a>
        : <div className="whitespace-pre-wrap break-words text-sm text-gray-800">{value}</div>) : <div className="text-sm text-gray-300">—</div>}
    </div>
  );

  return (
    <>
      <BackLink to="/admin/donors" label="Donors" />

      {/* the donor */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl font-semibold text-navy">{donor.name}</h1>
            <p className="text-sm text-gray-500">{[donor.designation, donor.company].filter(Boolean).join(", ") || "Donor"}</p>
          </div>
          {!edit && (
            <div className="flex gap-2">
              <button onClick={() => { setEdit(true); setMsg(null); }} className="rounded-full border-2 border-royal px-3 py-1 text-xs font-bold text-royal hover:bg-royal hover:text-white">✏️ Edit</button>
              <button onClick={() => setAskDelete(true)} className="rounded-full border border-red-300 px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50">🗑 Delete</button>
            </div>
          )}
        </div>

        {edit ? (
          <div className="mt-4">
            <DonorFields v={d} set={setD} />
            <div className="mt-4 flex gap-2">
              <button onClick={saveDonor} disabled={busy} className="rounded-lg bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-royal disabled:opacity-50">{busy ? "Saving…" : "Save changes"}</button>
              <button onClick={() => { setEdit(false); setMsg(null); }} className="rounded-lg border border-gray-300 px-5 py-2 text-sm font-semibold text-gray-600 hover:bg-silver">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field("E-mail", donor.email, donor.email ? `mailto:${donor.email}` : undefined)}
            {field("Phone", donor.phone ? usPhone(donor.phone) : null, donor.phone ? `tel:${donor.phone.replace(/[^\d+]/g, "")}` : undefined)}
            {field("Address", donor.address)}
            {field("City", donor.city)}
            {field("Company", donor.company)}
            {field("Designation", donor.designation)}
            {donor.notes && <div className="sm:col-span-2 lg:col-span-3">{field("Notes", donor.notes)}</div>}
          </div>
        )}
        {askDelete && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Delete <b>{donor.name}</b> and {donor.donations.length ? `all ${donor.donations.length} gift(s) on file` : "this profile"}? This cannot be undone.
            <div className="mt-2 flex gap-2">
              <button onClick={deleteDonor} disabled={busy} className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">Yes, delete</button>
              <button onClick={() => setAskDelete(false)} className="rounded-lg border border-gray-300 bg-white px-4 py-1.5 text-xs font-semibold text-gray-600">Keep</button>
            </div>
          </div>
        )}
        {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}
        <p className="mt-4 text-[11px] text-gray-400">Added {usDate(donor.created_at.slice(0, 10))} · last changed {usDate(donor.updated_at.slice(0, 10))}</p>
      </section>

      {/* the gifts */}
      <section className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-navy">Pledges &amp; donations</h2>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pledged {amountText(t.pledged, t.pledgedMo)}</span>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Donated {amountText(t.donated, t.donatedMo)}</span>
          {!newGift && <button onClick={() => { setNewGift(blankGift()); setEditGift(null); }} className="ml-auto rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-royal">+ Add pledge / donation</button>}
        </div>

        {newGift && (
          <div className="mt-4 rounded-xl border-2 border-royal/30 p-3">
            <GiftFields v={newGift} set={setNewGift} />
            <div className="mt-3 flex gap-2">
              <button disabled={busy || !giftOk(newGift)} onClick={() => run(supabase.from("donations").insert(giftRow(donor.id, newGift)), () => setNewGift(null))}
                className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">Save</button>
              <button onClick={() => setNewGift(null)} className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        <div className="mt-3 divide-y divide-gray-100">
          {!donor.donations.length && !newGift && <p className="py-3 text-sm text-gray-400">No pledge or donation on file yet.</p>}
          {donor.donations.map((g) => editGift?.id === g.id ? (
            <div key={g.id} className="py-3">
              <div className="rounded-xl border-2 border-royal/30 p-3">
                <GiftFields v={editGift.v} set={(v) => setEditGift({ id: g.id, v })} />
                <div className="mt-3 flex gap-2">
                  <button disabled={busy || !giftOk(editGift.v)} onClick={() => run(supabase.from("donations").update(giftRow(donor.id, editGift.v, g)).eq("id", g.id), () => setEditGift(null))}
                    className="rounded-lg bg-navy px-4 py-1.5 text-xs font-semibold text-white hover:bg-royal disabled:opacity-40">Save</button>
                  <button onClick={() => setEditGift(null)} className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-semibold text-gray-600">Cancel</button>
                </div>
              </div>
            </div>
          ) : (
            <div key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3">
              <span className="font-display text-lg font-semibold text-navy">{money(Number(g.amount))}{g.frequency === "monthly" && <span className="text-sm font-normal text-gray-500">/month</span>}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${g.status === "donated" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                {g.status === "donated" ? "Donated ✓" : "Pledged"}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${g.frequency === "monthly" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{g.frequency === "monthly" ? "Monthly" : "One-time"}</span>
              <span className="rounded-full bg-silver px-2.5 py-0.5 text-xs font-semibold text-gray-700">{methodLabel(g)}</span>
              <span className="text-xs text-gray-500">
                {[g.pledged_on && `pledged ${usDate(g.pledged_on)}`, g.donated_on && `received ${usDate(g.donated_on)}`].filter(Boolean).join(" · ")}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {g.status === "pledged" && (
                  <button disabled={busy} onClick={() => run(supabase.from("donations").update({ status: "donated", donated_on: todayStr() }).eq("id", g.id))}
                    className="rounded-lg bg-emerald-brand px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-deep disabled:opacity-50">Mark donated</button>
                )}
                <button onClick={() => { setEditGift({ id: g.id, v: draftOf(g) }); setNewGift(null); }} className="text-xs font-semibold text-royal hover:underline">Edit</button>
                <button onClick={() => setAskGift(g.id)} className="text-xs font-semibold text-red-600 hover:underline">Delete</button>
              </span>
              {g.note && <p className="basis-full text-sm text-gray-600">{g.note}</p>}
              {askGift === g.id && (
                <div className="basis-full rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
                  Delete this {g.status === "donated" ? "donation" : "pledge"} of {money(Number(g.amount))}? This cannot be undone.
                  <span className="ml-2 inline-flex gap-2">
                    <button disabled={busy} onClick={() => run(supabase.from("donations").delete().eq("id", g.id), () => setAskGift(null))}
                      className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">Yes, delete</button>
                    <button onClick={() => setAskGift(null)} className="rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-600">Keep</button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-gray-400">Monthly amounts are per month. “Mark donated” records today as the date received; use Edit to change the amount, date or method.</p>
      </section>
    </>
  );
}
