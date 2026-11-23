// The portal is one long-lived page: a tab, or the app on a phone's Home Screen, keeps running the
// build it started with until it is reloaded. After the 2026-11-22 update the President was still
// shown the old screens (no Repeat option, the old Back link) while the new build was live.
// This looks for a newer build when the portal comes back into view and every 15 minutes while it
// is open, and switches to it at the next page change, where nothing is half-typed. Until then a
// small bar offers "Update now".
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// the build this page is running: the hashed bundle named in its own <script> (none in `npm run dev`)
function running(): string | null {
  const s = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/index-"]');
  return s ? (s.src.split("/").pop() ?? "").split("?")[0] || null : null;
}
// the build the server has now; the query string gets past the browser's and the CDN's 10-minute copy
async function published(): Promise<string | null> {
  try {
    const r = await fetch(`./index.html?fresh=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.text()).match(/assets\/(index-[\w-]+\.js)/)?.[1] ?? null;
  } catch { return null; }                                   // offline: ask again later
}
const TRIED = "falah-update-tried";                           // the build we already reloaded for, this tab

export default function UpdateWatcher() {
  const loc = useLocation();
  const [newer, setNewer] = useState<string | null>(null);
  const lastCheck = useRef(0);
  const firstPage = useRef(true);

  useEffect(() => {
    const mine = running();
    if (!mine) return;
    let alive = true;
    const check = async () => {
      if (Date.now() - lastCheck.current < 60_000) return;    // at most once a minute
      lastCheck.current = Date.now();
      const p = await published();
      if (alive && p && p !== mine) setNewer(p);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    const first = window.setTimeout(() => { lastCheck.current = 0; void check(); }, 15_000);
    const every = window.setInterval(() => void check(), 15 * 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      alive = false; window.clearTimeout(first); window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, []);

  const update = () => {
    try { sessionStorage.setItem(TRIED, newer ?? ""); } catch { /* private mode: reload anyway */ }
    window.location.reload();
  };

  // a page change is the safe moment: the new page starts on the new build
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    if (!newer) return;
    let tried = "";
    try { tried = sessionStorage.getItem(TRIED) ?? ""; } catch { /* ignore */ }
    if (tried === newer) return;        // reloaded for it already and the old build came back (server lag): no loop, the bar stays
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.pathname]);

  if (!newer) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[80] flex justify-center px-3 sm:bottom-4" role="status">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-gold/60 bg-white px-4 py-2 text-sm text-navy shadow-lg">
        <span>🔄 A newer version of the portal is ready.</span>
        <button onClick={update} className="rounded-full bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-royal">Update now</button>
      </div>
    </div>
  );
}
