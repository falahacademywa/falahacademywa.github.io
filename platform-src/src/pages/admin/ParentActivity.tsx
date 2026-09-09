import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, configMissing } from "../../lib/supabase";

interface Summary { user_id: string; full_name: string; events_count: number; days_active: number; last_event_at: string | null }
interface Event { id: number; event: string; detail: string | null; occurred_at: string }

// Friendly labels for the tracked event keys
const LABELS: Record<string, string> = {
  open_portal: "Opened the portal",
  view_child: "Viewed a child",
  open_calendar: "Opened the full calendar",
  open_family_info: "Opened Family Information",
  open_feedback: "Opened Feedback",
  open_how_to_pay: "Opened How to pay",
  view_document: "Viewed a document",
};
const label = (e: string) => LABELS[e] ?? e.replace(/_/g, " ");

export default function ParentActivity() {
  const [rows, setRows] = useState<Summary[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Event[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (configMissing) return;
    supabase.rpc("admin_parent_activity").then(({ data }) => {
      const list = ((data as Summary[]) ?? []).sort((a, b) =>
        (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""));
      setRows(list);
    });
  }, []);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id); setLoadingDetail(true); setDetail([]);
    const { data } = await supabase.from("portal_events")
      .select("id, event, detail, occurred_at")
      .eq("user_id", id).order("occurred_at", { ascending: false }).limit(300);
    setDetail((data as Event[]) ?? []);
    setLoadingDetail(false);
  }

  const rel = (iso: string | null) => {
    if (!iso) return "never";
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  };

  return (
    <div className="max-w-3xl">
      <Link to="/admin/reports" className="text-sm text-royal hover:underline">← Reports</Link>
      <h1 className="mb-1 mt-2 font-display text-2xl font-semibold text-navy">Parent Portal Activity</h1>
      <p className="mb-5 text-sm text-gray-500">
        What each family does in the portal. Click a parent to see their detailed history. Activity is
        recorded from the day this feature went live; earlier visits are not shown.
      </p>
      {configMissing && <p className="text-sm text-gray-500">Connect the database first.</p>}

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-silver text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-4 py-3">Parent</th>
              <th className="px-4 py-3 text-right">Actions</th>
              <th className="px-4 py-3 text-right">Days Active</th>
              <th className="px-4 py-3">Last Activity</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <>
                <tr key={r.user_id} onClick={() => toggle(r.user_id)}
                  className="cursor-pointer border-b last:border-0 hover:bg-silver/60">
                  <td className="px-4 py-2.5 font-semibold text-navy">{r.full_name}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{r.events_count}</td>
                  <td className="px-4 py-2.5 text-right text-gray-600">{r.days_active}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {r.last_event_at ? <span title={new Date(r.last_event_at).toLocaleString()}>{rel(r.last_event_at)}</span>
                      : <span className="text-gray-400">never signed in</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right text-royal">{openId === r.user_id ? "▲" : "▼"}</td>
                </tr>
                {openId === r.user_id && (
                  <tr className="border-b bg-silver/30">
                    <td colSpan={5} className="px-4 py-3">
                      {loadingDetail ? <p className="text-sm text-gray-400">Loading…</p>
                        : !detail.length ? <p className="text-sm text-gray-400">No recorded activity yet.</p>
                        : (
                          <ol className="space-y-1.5">
                            {detail.map((e) => (
                              <li key={e.id} className="flex items-baseline justify-between gap-4 text-sm">
                                <span className="text-gray-700">
                                  {label(e.event)}{e.detail ? <span className="text-gray-500"> — {e.detail}</span> : ""}
                                </span>
                                <span className="shrink-0 text-xs text-gray-400">{new Date(e.occurred_at).toLocaleString()}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!rows.length && !configMissing && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No parent activity recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
