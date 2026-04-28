const CACHE_NAME = "lean-journal-pwa-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./vendor/echarts.min.js",
  "./vendor/supabase.min.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
];
const APP_SHELL_URLS = APP_SHELL.map((path) => new URL(path, self.registration.scope).href);
const OFFLINE_FALLBACK_URL = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          const cacheTarget =
            request.mode === "navigate"
              ? OFFLINE_FALLBACK_URL
              : APP_SHELL_URLS.includes(request.url)
                ? request.url
                : request;
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheTarget, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);

        if (cached) {
          return cached;
        }

        if (request.mode === "navigate") {
          return caches.match(OFFLINE_FALLBACK_URL);
        }

        throw new Error(`Network request failed for ${request.url}`);
      }),
  );
});
