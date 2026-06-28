// GymOS service worker — installable PWA + offline shell.
// Strategy: network-first for same-origin GET (so deploys are picked up
// immediately), with a cache fallback when offline. The API (gym-os-back) and
// CDN libraries are cross-origin and are NEVER intercepted/cached — auth and
// per-user data always go to the network.

// JS/CSS are now hashed by the Vite build, so they are NOT precached by name —
// the network-first handler runtime-caches them on first load (offline still works).
const CACHE = "gymos-shell-v3";
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
