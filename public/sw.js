self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("weather-ping-v1").then((cache) =>
      cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/favicon.svg"]),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open("weather-ping-v1").then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match("/"))),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "天气提醒", body: event.data ? event.data.text() : "有新的天气建议。" };
  }

  const title = payload.title || "天气提醒";
  const options = {
    body: payload.body || "打开查看最新天气建议。",
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: payload.tag || "weather-ping-server",
    data: { url: payload.url || "/" }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});
