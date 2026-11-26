// "Install the app" with one tap (President 2026-11-26). Chrome and Edge on Android (and on a computer)
// offer an install prompt for the portal; we catch it at start-up and show our own Install button,
// which opens the phone's real install dialog. iPhone has no such prompt (Apple's rule): there the
// portal shows the Share → Add to Home Screen steps instead.
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Call once, as early as possible: the browser fires the event soon after the page loads. */
export function initInstall() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallPrompt; changed(); });
  window.addEventListener("appinstalled", () => { deferred = null; changed(); });
}
export const canInstall = () => deferred !== null;
export function onInstallChange(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }

/** Opens the browser's own install dialog. True when the person installed it. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const p = deferred;
  await p.prompt();
  const { outcome } = await p.userChoice;
  deferred = null; changed();
  return outcome === "accepted";
}
