// Admin → Teacher requests (phase 35, TODO #163). Requests from the teacher app: discuss,
// approve (creates task T<n> in Admin → Tasks) or decline with a reason; then In progress →
// Resolved. Notes are visible to teachers unless marked internal. Resolved and declined
// requests sit in the Archive: this year Approved/Declined → Type → Month; earlier years
// Year → Approved/Declined → Type → Month. Kept for good (nothing is deleted).
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RequestCard from "../../components/RequestCard";
import GroupedArchive, { academicYearOf } from "../../components/GroupedArchive";
import { archiveLevels, isOpen, loadRequests, type Req, type ReqStatus } from "../../lib/requests";

const ORDER: ReqStatus[] = ["submitted", "discussing", "approved", "in_progress"];
const HEAD: Record<string, string> = { submitted: "New — waiting for a decision", discussing: "Under discussion", approved: "Approved — not started", in_progress: "In progress" };

export default function TeacherRequests() {
  const [sp] = useSearchParams();
  const focus = Number(sp.get("r")) || null;
  const [rows, setRows] = useState<Req[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() { const r = await loadRequests(); setErr(r.error); setRows(r.data); }
  useEffect(() => { load(); }, []);
  useEffect(() => { if (focus && rows) document.getElementById(`r${focus}`)?.scrollIntoView({ block: "center" }); }, [focus, rows]);

  if (err) return <div className="p-6"><p className="rounded-xl bg-white p-4 text-sm text-red-700 shadow-sm">{err}</p></div>;
  if (!rows) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  const open = rows.filter(isOpen);
  const old = rows.filter((r) => !isOpen(r));
  const thisYear = academicYearOf(new Date().toISOString());
  const oldNow = old.filter((r) => academicYearOf(r.created_at) === thisYear);
  const oldPast = old.filter((r) => academicYearOf(r.created_at) !== thisYear);
  const byUrgency = (a: Req, b: Req) => (a.urgency === b.urgency ? (a.created_at < b.created_at ? 1 : -1) : a.urgency === "urgent" ? -1 : 1);

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-navy">
          Teacher requests <span title="active / total this school year" className="ml-1 rounded-full bg-white px-2.5 py-0.5 align-middle font-sans text-sm font-bold text-navy shadow-sm">{open.length} / {open.length + oldNow.length}</span>
        </h1>
        <p className="mt-1 text-sm text-gray-500">Requests and topics from the teacher app. Approve to add one to your task list (code T + the request number); teachers see every status change and every note not marked internal.</p>
      </div>
      {open.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-gray-500 shadow-sm">No open requests.</p>}
      {ORDER.map((s) => {
        const list = open.filter((r) => r.status === s).sort(byUrgency);
        if (!list.length) return null;
        return (
          <section key={s} className="space-y-2">
            <h2 className="text-xs font-bold uppercase tracking-wide text-gray-400">{HEAD[s]} ({list.length})</h2>
            {list.map((r) => <RequestCard key={`${r.id}-${r.id === focus}`} r={r} admin startOpen={r.id === focus} onChanged={load} />)}
          </section>
        );
      })}
      <GroupedArchive key={`a${focus}`} focus={focus} items={oldNow} levels={archiveLevels(false)} noun="request" note="Resolved and declined requests of this school year."
        render={(r) => <RequestCard r={r} admin startOpen={r.id === focus} onChanged={load} />} />
      <GroupedArchive key={`p${focus}`} focus={focus} title="Earlier school years" items={oldPast} levels={archiveLevels(true)} noun="request" note="Kept for good; teachers no longer see these."
        render={(r) => <RequestCard r={r} admin onChanged={load} />} />
    </div>
  );
}
