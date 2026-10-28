// Offline-Betrieb. Alle App-Dateien werden beim Installieren gemeinsam geladen und danach aus dem Speicher geliefert.
// Bei jeder Änderung an einer Datei CACHE hochzählen: dann lädt die App den neuen Satz komplett und zeigt „Neue Version“.
// Open Food Facts läuft immer übers Netz und landet nie im Speicher.
const CACHE = "ek-1.4.1";
const DATEIEN = [
  "./", "./index.html", "./app.js", "./data.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png",
  "./fonts/atkinson-400.woff2", "./fonts/atkinson-400i.woff2", "./fonts/atkinson-700.woff2", "./fonts/bricolage-var.woff2", "./fonts/jetbrains-500.woff2",
  "./vendor/barcode-detector-2.3.1.min.js", "./vendor/zxing_reader.wasm"
];
// Groß oder noch nicht immer vorhanden: werden mitgenommen, wenn es sie gibt
const OPTIONAL = ["./basis-naehrwerte.json", "./bls.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(DATEIEN.map(u => new Request(u, { cache: "reload" })));
    await Promise.all(OPTIONAL.map(u => fetch(u, { cache: "reload" }).then(r => r.ok ? c.put(u, r) : null).catch(() => null)));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(n => n.startsWith("ek-") && n !== CACHE).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const treffer = await c.match(req, { ignoreSearch: true });
    if (treffer) return treffer;
    try {
      const r = await fetch(req);
      if (r.ok && r.type === "basic") c.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === "navigate") { const start = await c.match("./index.html"); if (start) return start; }
      throw err;
    }
  }));
});
