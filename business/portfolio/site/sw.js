// 포트폴리오 서비스 워커 (PWA) — 2026-11-19
// - 페이지(HTML): 인터넷 먼저 → 안 되면 저장해 둔 것 (그래서 고친 내용이 바로 보임)
// - 그림·글꼴·아이콘: 저장해 둔 것 먼저 보여 주고 뒤에서 새로 받아 둠
// - 영상(mp4)·구간 요청은 저장하지 않음 (용량 큼)
// 저장 방식을 바꿀 때만 VERSION 을 올린다 (올리면 예전 저장분은 지워짐)
const VERSION = "v1";
const CACHE = `portfolio-${VERSION}`;
const CORE = [
  "./",
  "manifest.webmanifest",
  "pwa.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("portfolio-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !FONT_HOSTS.includes(url.hostname)) return; // 구글 폼 등 바깥 주소는 건드리지 않음
  if (url.pathname.endsWith(".mp4")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("./", copy)); }
          return res;
        })
        .catch(() =>
          caches.match("./").then((hit) => hit || new Response(
            "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'><title>오프라인</title>" +
            "<p style='font:16px sans-serif;padding:24px'>인터넷이 연결되지 않았어요. 연결되면 다시 열어 주세요.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          ))
        )
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => { if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});
