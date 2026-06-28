// GymOS service worker — installable PWA + offline shell.
// Strategy: network-first for same-origin GET (so deploys are picked up
// immediately), with a cache fallback when offline. The API (gym-os-back) and
// CDN libraries are cross-origin and are NEVER intercepted/cached — auth and
// per-user data always go to the network.

// JS/CSS are content-hashed by the Vite build (e.g. /assets/index-ABC123.js), so
// their URLs are immutable: a new deploy = a new filename. Those are served
// cache-first (instant on repeat visits); everything else stays network-first so
// deploys (index.html) are picked up immediately. Offline still works either way.
const CACHE = "gymos-shell-v4";
const SHELL = [
    "/",
    "/index.html",
    "/manifest.json",
    "/favicon.ico",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }
    const url = new URL(request.url);
    // Only handle our own static origin; let API + CDN requests pass through.
    if (url.origin !== self.location.origin) {
        return;
    }

    // Hashed build assets are immutable — serve from cache first (instant), only
    // hitting the network on a cache miss (first load after a new deploy).
    if (url.pathname.startsWith("/assets/")) {
        event.respondWith(
            caches.match(request).then((cached) => cached || fetch(request).then((response) => {
                if (response && response.ok && response.type === "basic") {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
                }
                return response;
            }))
        );
        return;
    }

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.ok && response.type === "basic") {
                    const copy = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
                }
                return response;
            })
            .catch(() => caches.match(request).then((cached) => {
                if (cached) {
                    return cached;
                }
                if (request.mode === "navigate") {
                    return caches.match("/index.html");
                }
                return Response.error();
            }))
    );
});
