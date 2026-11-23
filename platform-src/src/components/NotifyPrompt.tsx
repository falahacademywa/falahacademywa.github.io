// "Turn on notifications" and, on iPhone, "add the portal to your Home Screen first"
// (phase 48, President 2026-11-22). Shown to everyone: admins, staff, teachers, parents.
//
//   iPhone / iPad, opened in the browser  -> how to install (Apple gives web apps no Install
//                                            button and only lets an installed one notify)
//   any device that can notify, not asked -> a one-tap "Turn on" (the browser then asks Allow)
//   already allowed                       -> nothing to show; the device is re-registered quietly
//   blocked by the person                 -> PushStatusRow says how to undo it
// "Not now" hides the banner for a week on this device.
import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase, configMissing } from "../lib/supabase";
import { enablePush, isIOS, isStandalone, pushKey, pushSupported, syncSubscription } from "../lib/push";

type State = "none" | "install" | "ask" | "busy" | "done" | "blocked" | "failed";
const WEEK = 7 * 86400000;
const snoozed = (k: string) => { try { return Date.now() - Number(localStorage.getItem("falah-nudge-" + k) ?? 0) < WEEK; } catch { return false; } };
const snooze = (k: string) => { try { localStorage.setItem("falah-nudge-" + k, String(Date.now())); } catch { /* private mode */ } };

function usePushState(ignoreSnooze: boolean) {
  const { profile } = useAuth();
  const [state, setState] = useState<State>("none");
  useEffect(() => {
    if (configMissing || !profile?.id) return;
    let alive = true;
    (async () => {
      if (isIOS() && !isStandalone()) { if (alive && (ignoreSnooze || !snoozed("install"))) setState("install"); return; }
      if (!pushSupported()) return;
      if (Notification.permission === "granted") { const ok = await syncSubscription().catch(() => false); if (alive && ok) setState("done"); return; }
      if (Notification.permission === "denied") { if (alive) setState("blocked"); return; }
      if (!(await pushKey())) return;                       // not set up on this project yet
      if (alive && (ignoreSnooze || !snoozed("ask"))) setState("ask");
    })();
    return () => { alive = false; };
  }, [profile?.id, ignoreSnooze]);
  async function turnOn() {
    setState("busy");
    const r = await enablePush();                           // the browser's own "Allow notifications?" appears here
    if (r === "on") { setState("done"); void supabase.rpc("push_test"); }
    else setState(r === "denied" ? "blocked" : "failed");
  }
  return { state, setState, turnOn };
}

const HOW_INSTALL = <>tap the <b>Share</b> button <span aria-hidden="true">(the square with an arrow ⬆)</span>, then <b>Add to Home Screen</b>. Open Falah from the Home Screen after that.</>;
const HOW_UNBLOCK = "Notifications are blocked for this site on this device. Allow them in the browser's site settings (on iPhone: Settings → Notifications → Falah), then reopen the portal.";

/** Banner at the top of a page. */
export default function NotifyPrompt({ className = "" }: { className?: string }) {
  const { state, setState, turnOn } = usePushState(false);
  const [closed, setClosed] = useState(false);
  if (closed || state === "none" || state === "blocked") return null;
  if (state === "done") return null;
  const box = `rounded-xl border px-3 py-2.5 text-sm shadow-sm ${className}`;
  if (state === "install") return (
    <div className={`${box} border-royal/30 bg-blue-50 text-navy`}>
      <div className="font-semibold">📲 Install Falah Academy on this iPhone</div>
      <p className="mt-0.5 text-[13px] leading-snug text-gray-700">In Safari, {HOW_INSTALL} It then works like an app and can send you notifications.</p>
      <button onClick={() => { snooze("install"); setClosed(true); }} className="mt-2 rounded-lg border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-600">Got it</button>
    </div>
  );
  if (state === "failed") return (
    <div className={`${box} border-amber-300 bg-amber-50 text-amber-800`}>
      Notifications could not be switched on just now. Please try again in a minute.
      <button onClick={() => setState("ask")} className="ml-2 font-semibold underline">Try again</button>
    </div>
  );
  return (
    <div className={`${box} flex flex-wrap items-center gap-x-3 gap-y-2 border-gold/60 bg-gold/10 text-navy`}>
      <div className="min-w-0 flex-1 basis-56">
        <div className="font-semibold">🔔 Turn on notifications</div>
        <p className="text-[13px] leading-snug text-gray-700">Get school alerts on this device right away, even when the portal is closed.</p>
      </div>
      <div className="flex gap-2">
        <button onClick={turnOn} disabled={state === "busy"} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{state === "busy" ? "Turning on…" : "Turn on"}</button>
        <button onClick={() => { snooze("ask"); setClosed(true); }} disabled={state === "busy"} className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">Not now</button>
      </div>
    </div>
  );
}

/** One line for a notifications panel or a profile page: is this device switched on, and the way to switch it. */
export function PushStatusRow({ className = "" }: { className?: string }) {
  const { state, turnOn } = usePushState(true);
  const base = `text-[11px] leading-snug ${className}`;
  if (state === "done") return <p className={`${base} text-emerald-700`}>🔔 Notifications are on for this device.</p>;
  if (state === "install") return <p className={`${base} text-gray-500`}>📲 To get notifications on this iPhone: in Safari, {HOW_INSTALL}</p>;
  if (state === "blocked") return <p className={`${base} text-amber-700`}>🔕 {HOW_UNBLOCK}</p>;
  if (state === "ask" || state === "busy" || state === "failed") return (
    <p className={`${base} text-gray-600`}>
      🔔 Notifications are off for this device.{" "}
      <button onClick={turnOn} disabled={state === "busy"} className="font-semibold text-royal underline disabled:opacity-50">{state === "busy" ? "Turning on…" : state === "failed" ? "Try again" : "Turn on"}</button>
    </p>
  );
  return null;
}
