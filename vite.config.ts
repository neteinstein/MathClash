import { defineConfig, type Plugin } from 'vite';

/** Static files from /public that the offline cache should also hold. */
const PUBLIC_ASSETS = [
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

/**
 * Emits a tiny service worker that precaches every file of the build, so the
 * web version keeps working offline (handy in a waiting room with bad Wi-Fi).
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'mathclash-offline-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const assets = ['./', ...files, ...PUBLIC_ASSETS].map((f) => (f.startsWith('./') ? f : `./${f}`));
      const version = Date.now().toString(36);
      const source = `/* MathClash offline service worker — generated at build time */
const CACHE = 'mathclash-${version}';
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative paths so the same build works on GitHub Pages, any static host and inside Capacitor.
  base: './',
  plugins: [offlineServiceWorker()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
  },
});
