// Opening a private file in a new tab (President 2026-11-22: "cannot open on iPhone").
// Every stored file needs a signed link first, which is a network round trip. Safari on iPhone/iPad
// only lets a page open a tab during the tap itself, so a window.open() made after that wait was
// silently blocked: nothing happened. openLater() opens the tab at once, inside the tap, and points
// it at the link when it arrives. If even that is refused (some in-app browsers), the file opens in
// the current tab instead, so a tap always does something.
export function openLater(): (url: string | null | undefined) => void {
  let w: Window | null = null;
  try { w = window.open("", "_blank"); } catch { w = null; }
  if (w) { try { w.opener = null; } catch { /* cross-origin guard, nothing to do */ } }
  return (url) => {
    if (!url) { try { w?.close(); } catch { /* already closed */ } return; }
    if (w && !w.closed) w.location.replace(url);
    else window.location.assign(url);
  };
}
