// Offline support: the app itself is cached on first visit; your data lives in IndexedDB + Google Drive.
const VERSION = "collabdesk-v1";
const SHELL = ["./", "index.html", "sync.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png", "jszip.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // Google sign-in and Drive calls always go to the network.
  if (/(^|\.)googleapis\.com$/.test(url.hostname) && !/^fonts\./.test(url.hostname)) return;
  if (url.hostname === "accounts.google.com") return;
  const sameOrigin = url.origin === location.origin;
  const cdn = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)$/.test(url.hostname);
  if (!sameOrigin && !cdn) return;
  // Stale-while-revalidate: open instantly from cache, refresh the copy in the background.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const key = req.mode === "navigate" ? "index.html" : req;
    const hit = await cache.match(key, {ignoreSearch: req.mode === "navigate"});
    const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(key, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
