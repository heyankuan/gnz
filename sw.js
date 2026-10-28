// 离线缓存：程序存到手机上，网不好也能打开、查看上次同步的数据。
const VERSION = 'gnz-v4';
// 只预存程序本身；识别模型（约 22MB）在第一次识别时才下载并存下，只查看的手机不用下
const FILES = ['./', 'index.html', 'app.js', 'ocr.js', 'sync.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'vendor/ort.wasm.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.endsWith('data.enc.json')) return; // 数据文件永远走网络，不用缓存
  // 程序页面：先联网取最新，失败用缓存；大文件（模型等）：先用缓存
  const isShell = /\/(index\.html)?$|\.js$|\.webmanifest$/.test(url.pathname) && !/vendor\//.test(url.pathname);
  if (isShell) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return r; })));
  }
});
