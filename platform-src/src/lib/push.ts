// Phone notifications (phase 48, President 2026-11-22): a notification reaches this device even
// when the portal is closed. $0: the browser's own push service. Each person switches it on once
// per device (the browser insists on asking them). On iPhone and iPad it only works after the
// portal has been added to the Home Screen: that is Apple's rule, not ours.
import { supabase } from "./supabase";

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

const toBytes = (b64url: string) => {
  const t = b64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const toB64url = (buf: ArrayBuffer) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iphone/i.test(ua) ? "iPhone" : /ipad/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "iPad"
    : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : "Device";
  const br = /edg\//i.test(ua) ? "Edge" : /crios|chrome/i.test(ua) ? "Chrome" : /fxios|firefox/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "browser";
  return `${os} · ${br}`;
}

/** The server's key for subscribing, or null while phone notifications are not set up on this project. */
export async function pushKey(): Promise<string | null> {
  const { data, error } = await supabase.rpc("push_public_key");
  return error ? null : (data as string | null) ?? null;
}

/** Make sure this device is registered for the signed-in person. Call on every load once permission is granted. */
export async function syncSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const key = await pushKey();
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // subscribed with a key the server no longer uses: that subscription is dead, start again
  if (sub && sub.options.applicationServerKey && toB64url(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  const j = sub.toJSON();
  if (!j.keys?.p256dh || !j.keys?.auth) return false;
  const { error } = await supabase.rpc("push_subscribe", { p_endpoint: sub.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_device: deviceLabel() });
  return !error;
}

/** Ask the person (must run inside their tap) and register the device. */
export async function enablePush(): Promise<"on" | "denied" | "unsupported" | "failed"> {
  if (!pushSupported()) return "unsupported";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "denied";
  try { return (await syncSubscription()) ? "on" : "failed"; } catch { return "failed"; }
}

/** Signing out: this device stops receiving that person's notifications. Never blocks the sign-out. */
export async function dropSubscription(): Promise<void> {
  try {
    if (!pushSupported()) return;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 1500))]);
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await supabase.rpc("push_unsubscribe", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  } catch { /* best effort */ }
}
