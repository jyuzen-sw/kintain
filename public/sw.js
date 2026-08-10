const CACHE_NAME = "kintain-static-v3";
const OFFLINE_URL = "/offline.html";
const APP_SHELL_URL = "/app-shell.html";
const PRECACHE = [
  OFFLINE_URL,
  APP_SHELL_URL,
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];
const workerScope = globalThis.self;
const cacheStorage = globalThis.caches;

workerScope.addEventListener("install", (event) => {
  event.waitUntil(cacheStorage.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)));
});

workerScope.addEventListener("activate", (event) => {
  event.waitUntil(
    cacheStorage
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => cacheStorage.delete(key))),
      )
      .then(() => workerScope.clients.claim()),
  );
});

workerScope.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") workerScope.skipWaiting();
});

workerScope.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new globalThis.URL(request.url);
  if (url.origin !== workerScope.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(globalThis.fetch(request).catch(() => cacheStorage.match(APP_SHELL_URL)));
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/icon-192.png" ||
    url.pathname === "/icon-512.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === APP_SHELL_URL ||
    url.pathname === OFFLINE_URL ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      cacheStorage.match(request).then((cached) => {
        if (cached) return cached;
        return globalThis.fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void cacheStorage.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});
