const CACHE_NAME = "stockfoyer-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first pour tout ce qui touche Supabase / Open Food Facts (données live),
// cache-first pour les fichiers statiques de l'app.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("supabase.co") || url.includes("openfoodfacts.org")) {
    return; // laisser passer directement au réseau
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
