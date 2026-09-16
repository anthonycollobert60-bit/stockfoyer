const CACHE_NAME = "stockfoyer-v2";
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

// Network-first pour TOUT (sauf Supabase / Open Food Facts, laissés en direct) :
// on essaie toujours de récupérer la dernière version en ligne, et on ne se
// rabat sur le cache que si le téléphone est hors-ligne. Ça évite qu'une
// icône, un fichier app.js ou un manifest modifié reste bloqué en cache.
self.addEventListener("fetch", (event) => {
  const url = event.request.url;
  if (url.includes("supabase.co") || url.includes("openfoodfacts.org")) {
    return; // laisser passer directement au réseau
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
