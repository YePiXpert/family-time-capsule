// 极简离线壳（Issue #016）：
// - 只缓存离线提示页本身；
// - 导航请求失败时回退到该页；
// - 绝不缓存 /api/**（私有媒体与数据不做离线存储——PRD #016 明确禁止离线缓存媒体库）。
const CACHE = "ftc-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(OFFLINE_URL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // 私人媒体/数据：永远直连
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then(
        (cached) =>
          cached ??
          new Response("离线中", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    ),
  );
});
