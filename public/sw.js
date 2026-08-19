// GymOS service worker — installable PWA + offline shell.
// Strategy: network-first for same-origin GET (so deploys are picked up
// immediately), with a cache fallback when offline. The API (gym-os-back) and
// CDN libraries are cross-origin and are NEVER intercepted/cached — auth and
// per-user data always go to the network.

// JS/CSS are content-hashed by the Vite build (e.g. /assets/index-ABC123.js), so
// their URLs are immutable: a new deploy = a new filename. Those are served
// cache-first (instant on repeat visits); everything else stays network-first so
// deploys (index.html) are picked up immediately. Offline still works either way.
const CACHE = "gymos-shell-v5";
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

// ---- Web Push -------------------------------------------------------------
// The server sends a JSON body ({title, body, url, type}); anything unparseable
// still shows a generic notification rather than nothing, because a push that
// arrives and renders nothing looks like a broken app.
self.addEventListener("push", (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        payload = { body: event.data ? event.data.text() : "" };
    }
    const title = payload.title || "GymOS";
    const options = {
        body: payload.body || "Нова активність у стрічці",
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        // Same tag per category collapses a burst of likes into one line instead of
        // stacking twenty notifications on the lock screen.
        tag: payload.type || "gymos",
        renotify: false,
        data: { url: payload.url || "#/feed" }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

// Focus an existing tab when there is one — opening a second copy of a PWA is
// disorienting — and only fall back to opening a window.
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || "#/feed";
    event.waitUntil((async () => {
        const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clientList) {
            if ("focus" in client) {
                await client.focus();
                if ("navigate" in client) {
                    try {
                        await client.navigate(`/${target}`);
                    } catch (error) {
                        // cross-origin or unsupported — the focused tab is enough
                    }
                }
                return;
            }
        }
        if (self.clients.openWindow) {
            await self.clients.openWindow(`/${target}`);
        }
    })());
});
