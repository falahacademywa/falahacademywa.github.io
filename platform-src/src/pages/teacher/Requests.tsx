// Teacher app — Requests (phase 35, TODO #163): every teacher sees every request of this school
// year; "+ New request" opens the form; own requests can be edited or deleted until the
// President or an admin decides. Resolved and declined ones move to the Archive
// (Approved/Declined → Type → Month, all collapsed).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RequestCard from "../../components/RequestCard";
import RequestForm from "../../components/RequestForm";
import GroupedArchive from "../../components/GroupedArchive";
import { archiveLevels, isOpen, loadRequests, type Req } from "../../lib/requests";

export default function Requests() {
  const [sp] = useSearchParams();
  const focus = Number(sp.get("r")) || null;
  const [rows, setRows] = useState<Req[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState<{ edit: Req | null } | null>(null);
  const [mineOnly, setMineOnly] = useState(false);

  async function load() { const r = await loadRequests(); setErr(r.error); setRows(r.data); }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (focus && rows) document.getElementById(`r${focus}`)?.scrollIntoView({ block: "center" }); }, [focus, rows]);

  if (err) return <p className="rounded-xl bg-white p-4 text-sm text-red-700 shadow-sm">{err}</p>;
  if (!rows) return <p className="p-4 text-sm text-gray-500">Loading…</p>;

  const list = mineOnly ? rows.filter((r) => r.mine) : rows;
  const open = list.filter(isOpen).sort((a, b) => (a.urgency === b.urgency ? (a.created_at < b.created_at ? 1 : -1) : a.urgency === "urgent" ? -1 : 1));
  const old = list.filter((r) => !isOpen(r));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <h1 className="flex-1 font-display text-lg font-semibold text-navy">
          Requests <span title="active / total this school year" className="ml-1 rounded-full bg-white px-2 py-0.5 align-middle font-sans text-xs font-bold text-navy shadow-sm">{open.length} / {list.length}</span>
        </h1>
        {!form && <button onClick={() => setForm({ edit: null })} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white">+ New request</button>}
      </div>
      {form && <RequestForm edit={form.edit} onCancel={() => setForm(null)} onDone={() => { setForm(null); load(); }} />}
      <label className="flex items-center gap-2 px-1 text-xs text-gray-600">
        <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> Only my requests
      </label>
      {open.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">No open requests. Tap “+ New request” to ask for something.</p>}
      {open.map((r) => <RequestCard key={`${r.id}-${r.id === focus}`} r={r} admin={false} startOpen={r.id === focus} onChanged={load} onEdit={(x) => { setForm({ edit: x }); window.scrollTo({ top: 0 }); }} />)}
      <GroupedArchive key={`a${focus}`} focus={focus} items={old} levels={archiveLevels(false)} noun="request" note="Resolved and declined requests of this school year."
        render={(r) => <RequestCard r={r} admin={false} startOpen={r.id === focus} onChanged={load} />} />
    </div>
  );
}
