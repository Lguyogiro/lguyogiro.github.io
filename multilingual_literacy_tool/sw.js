// Offline support: cache the app shell, serve from cache, refresh in the background.
// Bump VERSION when files change so tablets pick up the new version.
const VERSION = "v14";
const FILES = [
  "./", "index.html", "css/style.css", "manifest.webmanifest", "icons/icon.svg", "audio.txt",
  "js/pictures.js", "js/languages.js", "js/i18n.js", "js/generators.js", "js/math.js", "js/numbers.js", "js/tts.js", "js/sfx.js", "js/asr.js", "js/app.js",
  "corpus/en.js", "corpus/es.js", "corpus/nah.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Settings files are read from the network first, so a change applies on the next load
// (the cached copy is only used offline).
const NETWORK_FIRST = ["audio.txt"];

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  if (NETWORK_FIRST.some((f) => new URL(e.request.url).pathname.endsWith("/" + f))) {
    e.respondWith(caches.open(VERSION).then((cache) => fetch(e.request)
      .then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; })
      .catch(() => cache.match(e.request))));
    return;
  }
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => { if (res.ok || res.type === "opaque") cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
