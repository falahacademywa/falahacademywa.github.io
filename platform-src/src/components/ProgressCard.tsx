// "How is my child doing?" on the parent home page (President 2026-11-26): this month's attendance,
// the latest Qur'an note and the latest note from each class subject, from what teachers already post.
// Red Comet workbook pages are NOT shown to parents (President's decision 2026-11-26).
import { useMemo } from "react";

interface Upd { id: string; subject: string; note: string; update_date: string; homework_due: string | null }

const day = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const isQuran = (s: string) => /qur'?an|quran|hifz|qaida|tajw/i.test(s);

export default function ProgressCard({ firstName, monthLabel, counts, updates, onSeeFeed, showAttendance = true }: {
  firstName: string; monthLabel: string; counts: { present: number; late: number; absent: number };
  updates: Upd[]; onSeeFeed: () => void;
  showAttendance?: boolean;   // off on the parent Progress tab, where the Attendance card sits just above
}) {
  const marked = counts.present + counts.late + counts.absent;
  const inClass = counts.present + counts.late;
  const pct = marked ? Math.round((inClass / marked) * 100) : null;
  const { quran, latest } = useMemo(() => {
    const sorted = [...updates].sort((a, b) => b.update_date.localeCompare(a.update_date));
    const q = sorted.filter((u) => isQuran(u.subject)).slice(0, 2);
    const seen = new Set<string>(); const l: Upd[] = [];
    for (const u of sorted) {
      if (isQuran(u.subject) || seen.has(u.subject)) continue;
      seen.add(u.subject); l.push(u);
      if (l.length === 4) break;
    }
    return { quran: q, latest: l };
  }, [updates]);

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="font-display text-lg font-semibold text-navy">{showAttendance ? "Progress" : "Teachers' notes"} — {firstName}</h2>
        {showAttendance && <span title={marked ? `${inClass} of ${marked} school days marked${counts.late ? `, ${counts.late} late` : ""}${counts.absent ? `, ${counts.absent} absent` : ""}` : undefined}
          className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${pct == null ? "bg-silver text-gray-500" : pct >= 90 ? "bg-green-100 text-green-700" : pct >= 75 ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700"}`}>
          {pct == null ? `No attendance yet in ${monthLabel}` : `${pct}% in class · ${monthLabel}`}
        </span>}
      </div>

      <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-gray-400">Qur'an</h3>
      {quran.length ? quran.map((u) => (
        <div key={u.id} className="mt-1.5 rounded-lg border-l-4 border-emerald-brand bg-emerald-50/50 px-3 py-2">
          <div className="text-[11px] font-semibold text-emerald-deep">{day(u.update_date)}</div>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-gray-800">{u.note}</p>
        </div>
      )) : <p className="mt-1 text-sm text-gray-400">No Qur'an note from the teacher yet.</p>}

      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-400">Latest from class</h3>
      {latest.length ? (
        <div className="mt-1 divide-y">
          {latest.map((u) => (
            <div key={u.id} className="py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-royal/10 px-2.5 py-0.5 text-xs font-semibold text-navy">{u.subject}</span>
                <span className="text-[11px] text-gray-400">{day(u.update_date)}</span>
                {u.homework_due && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Homework due {day(u.homework_due)}</span>}
              </div>
              <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-sm text-gray-700">{u.note}</p>
            </div>
          ))}
        </div>
      ) : <p className="mt-1 text-sm text-gray-400">No class updates yet.</p>}

      <button onClick={onSeeFeed} className="mt-2 text-xs font-semibold text-royal hover:underline">All class updates in the Feed on Home →</button>
    </section>
  );
}
