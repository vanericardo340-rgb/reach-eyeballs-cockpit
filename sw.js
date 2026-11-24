// Cockpit service worker: makes the app installable and shows a friendly
// screen when there's no connection. It never caches your data or API calls:
// everything else goes straight to the network.
const CACHE = "cockpit-shell-v1";
const SHELL = ["/offline.html", "/favicon.svg", "/icon-192.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return; // assets, APIs and data: untouched
  e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html")));
});
