const CACHE_NAME = "staff-planner-v20260812-5";
const APP_FILES = ["./", "./index.html", "./dashboard.html", "./produktion.html", "./rast.html", "./personal.html", "./testresultat.html", "./maskiner.html", "./bedomning.html", "./todo.html", "./add.html", "./installningar.html", "./hjalp.html", "./style.css", "./app.js", "./manifest.webmanifest", "./app-icon.svg"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(async () => {
    const exactMatch = await caches.match(event.request);
    if (exactMatch) return exactMatch;

    // App assets are precached without their cache-busting query string.
    const requestUrl = new URL(event.request.url);
    const assetMatch = await caches.match(requestUrl.pathname.split("/").pop());
    if (assetMatch) return assetMatch;

    // HTML is a valid fallback only for page navigations, never for JS/CSS.
    if (event.request.mode === "navigate") return caches.match("./index.html");
    return Response.error();
  }));
});
