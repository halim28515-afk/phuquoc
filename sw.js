/* 여행 플래너 – 서비스워커 (오프라인 실행) */
'use strict';

// 앱 파일을 바꿔 배포할 때 이 버전을 올리면 새 캐시로 교체돼요
const VERSION = 'v5';
const SHELL = `shell-${VERSION}`;   // 앱 파일
const LIBS = 'libs-v1';             // CDN 라이브러리 (주소에 버전이 있어 바뀌지 않음)
const TILES = 'tiles-v1';           // 지도 타일 (본 곳만)
const MAX_TILES = 400;

const SHELL_FILES = [
  './', './index.html', './style.css', './manifest.webmanifest',
  './trips.js', './app.js', './map.js', './fx.js', './settle.js', './import.js', './flight.js', './trips-ui.js', './pwa.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
];
const LIB_FILES = [
  'https://cdnjs.cloudflare.com/ajax/libs/Sortable/1.15.2/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES);
    // 라이브러리는 받을 수 있으면 미리 받음 (실패해도 설치는 계속, 처음 쓸 때 다시 시도)
    const libs = await caches.open(LIBS);
    await Promise.all(LIB_FILES.map(u => libs.match(u).then(hit => hit || libs.add(u)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = [SHELL, LIBS, TILES];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// 저장된 것을 바로 주고, 뒤에서 새로 받아 다음 실행 때 반영
async function staleWhileRevalidate(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreSearch: true }) || (fallbackUrl && await cache.match(fallbackUrl));
  const fresh = fetch(req).then(res => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await fresh) || new Response('오프라인이에요', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 앱 화면 열기: 오프라인이면 저장된 index.html
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL, './index.html'));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, SHELL));
    return;
  }
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(req, LIBS));
    return;
  }
  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tile(req));
    return;
  }
  // 환율·경로·장소 검색 API는 그대로 네트워크 (앱이 자체 캐시와 대체값을 가짐)
});
