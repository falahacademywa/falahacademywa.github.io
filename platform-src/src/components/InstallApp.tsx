// One-tap install of the portal as a phone app (President 2026-11-26).
//   InstallBanner: top of the parent / admin / teacher pages (through NotifyPrompt), until installed or "Not now" (a week).
//   InstallHint:   one line under the sign-in form, so a family can install before signing in.
// Android / Chrome / Edge: our button opens the browser's own install dialog.
// iPhone / iPad in Safari: Apple has no install button for web apps, so the steps are shown.
// Already opened from the Home Screen: nothing is shown.
import { useEffect, useState } from "react";
import { canInstall, onInstallChange, promptInstall } from "../lib/install";
import { isIOS, isStandalone } from "../lib/push";

const WEEK = 7 * 86400000;
export const installSnoozed = () => { try { return Date.now() - Number(localStorage.getItem("falah-nudge-appinstall") ?? 0) < WEEK; } catch { return false; } };
const snooze = () => { try { localStorage.setItem("falah-nudge-appinstall", String(Date.now())); } catch { /* private mode */ } };

export function useInstallable() {
  const [can, setCan] = useState(canInstall());
  useEffect(() => onInstallChange(() => setCan(canInstall())), []);
  return can && !isStandalone();
}

/** Shown by NotifyPrompt ahead of the notifications banner while the phone can install the app. */
export function InstallBanner({ className = "", onClose }: { className?: string; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-royal/30 bg-blue-50 px-3 py-2.5 text-sm text-navy shadow-sm ${className}`}>
      <div className="min-w-0 flex-1 basis-56">
        <div className="font-semibold">📲 Install the Falah Academy app</div>
        <p className="text-[13px] leading-snug text-gray-700">Adds Falah to your Home Screen like any other app: one tap to open, and school alerts on your phone.</p>
      </div>
      <div className="flex gap-2">
        <button disabled={busy} onClick={async () => { setBusy(true); await promptInstall().catch(() => false); setBusy(false); }}
          className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? "Opening…" : "Install"}</button>
        <button onClick={() => { snooze(); onClose(); }} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">Not now</button>
      </div>
    </div>
  );
}

export function InstallHint() {
  const can = useInstallable();
  if (isStandalone()) return null;
  if (can) return (
    <button type="button" onClick={() => { void promptInstall(); }}
      className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-royal bg-white py-2 text-sm font-semibold text-royal hover:bg-royal hover:text-white">
      📲 Install the Falah app on this phone
    </button>
  );
  if (isIOS()) return (
    <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-center text-xs leading-snug text-navy">
      📲 <b>Put Falah on your iPhone:</b> in Safari tap <b>Share</b> (the square with an arrow ⬆), then <b>Add to Home Screen</b>.
    </p>
  );
  return null;
}
