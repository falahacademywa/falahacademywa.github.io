/* Falah Academy portal — service worker (phase 23).
   Keeps the app shell available offline and lets the phone install it.
   Data always goes to the network; only built assets and icons are cached.
   The cache name carries the build date so a new deploy replaces it. */
const CACHE = "falah-shell-" + new URL(self.location).searchParams.get("v");
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;   // Supabase etc. untouched
  // navigation: network first, shell as fallback (offline start)
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("./index.html")));
    return;
  }
  // hashed build assets + icons: cache first
  if (url.pathname.includes("/assets/") || url.pathname.includes("/icons/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
    })));
  }
});

/* Phone notifications (phase 48). The server sends each portal notification here even when the
   portal is closed; the text arrives encrypted for this one browser. iPhone requires that every
   push is shown, so one always is. */
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Falah Academy", {
    body: d.body || "",
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    tag: d.id ? "n" + d.id : undefined,
    data: { path: d.url || "" },
  }));
});

/* A tap opens the portal on the page the alert is about: the open window if there is one,
   otherwise a new one. */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const path = (e.notification.data && e.notification.data.path) || "";
  const scope = self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.indexOf(scope) === 0 && "focus" in c) {
        c.postMessage({ type: "open", path: path });
        return c.focus();
      }
    }
    return self.clients.openWindow(scope + (path ? "#" + path : ""));
  }));
});
