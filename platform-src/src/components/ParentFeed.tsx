// Parent page feed (phase 46, President 2026-11-14): announcements, class updates and the school's
// notices in ONE list, newest first, with a search box and type filters. Pinned announcements and
// announcements still waiting for the parent's Acknowledge stay on top. Attendance, fees, forms,
// meetings and the calendar keep their own cards on the page.
import { useMemo, useState, type ReactNode } from "react";

export type FeedKind = "announcement" | "update" | "notice";
export interface FeedItem {
  key: string;
  kind: FeedKind;
  date: string;          // ISO date or timestamp, used for ordering and the date label
  top?: boolean;         // pinned / needs acknowledging: shown above the rest
  text: string;          // everything searchable (title, body, subject, …)
  node: ReactNode;       // the rendered card body
}

const KIND_LABEL: Record<FeedKind, string> = { announcement: "Announcements", update: "Class updates", notice: "Notices" };
const PAGE = 15;

export default function ParentFeed({ items, title = "Feed", empty }: { items: FeedItem[]; title?: string; empty?: string }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<FeedKind | "all">("all");
  const [shown, setShown] = useState(PAGE);

  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items
      .filter((i) => kind === "all" || i.kind === kind)
      .filter((i) => { const t = i.text.toLowerCase(); return words.every((w) => t.includes(w)); })
      .sort((a, b) => (!!a.top !== !!b.top ? (a.top ? -1 : 1) : a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [items, q, kind]);

  const counts = useMemo(() => {
    const c: Record<FeedKind, number> = { announcement: 0, update: 0, notice: 0 };
    items.forEach((i) => c[i.kind]++);
    return c;
  }, [items]);

  const chip = (k: FeedKind | "all", label: string, n: number) => (
    <button key={k} onClick={() => { setKind(k); setShown(PAGE); }}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${kind === k ? "bg-navy text-white" : "bg-silver text-gray-600 hover:bg-gray-200"}`}>
      {label} <span className="opacity-70">{n}</span>
    </button>
  );

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-display text-lg font-semibold text-navy">{title}</h2>
        <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          placeholder="Search announcements, class updates, notices…" aria-label="Search the feed"
          className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:w-72" />
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {chip("all", "All", items.length)}
        {(Object.keys(KIND_LABEL) as FeedKind[]).filter((k) => counts[k] > 0).map((k) => chip(k, KIND_LABEL[k], counts[k]))}
      </div>
      <div className="space-y-4">
        {list.slice(0, shown).map((i) => (
          <div key={i.key} className={`border-b pb-4 last:border-0 last:pb-0 ${i.top ? "-mx-2 rounded-lg bg-gold/10 px-2 pt-2" : ""}`}>{i.node}</div>
        ))}
        {!list.length && (
          <p className="text-sm text-gray-400">{q || kind !== "all" ? "Nothing matches your search." : empty ?? "Nothing here yet."}</p>
        )}
      </div>
      {list.length > shown && (
        <button onClick={() => setShown(shown + PAGE)}
          className="mt-4 w-full rounded-lg border border-gray-200 py-2 text-sm font-semibold text-royal hover:bg-silver/60">
          Show more ({list.length - shown} older)
        </button>
      )}
    </section>
  );
}
