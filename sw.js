/**
 * SERVICE WORKER uang famBARLA (ENTERPRISE SECURITY & SMART CACHE)
 * Versi 4.0.1 (MASTERPIECE EDITION - ENTERPRISE PATCHED)
 * Arsitektur: Synchronous WaitUntil SWR, Promise-Queued Garbage Collector, & Anti-Opaque
 */

const APP_VERSION = '4.0.1'; 
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// Antrean Promise Absolut untuk mematikan Creeping Cache Leak
let gcQueue = Promise.resolve();

const limitCacheSize = (name, size) => {
  gcQueue = gcQueue.then(() => {
    return caches.open(name).then(cache => {
      return cache.keys().then(keys => {
        if (keys.length > size) {
          const keysToDelete = keys.slice(0, keys.length - size);
          return Promise.all(keysToDelete.map(key => cache.delete(key)));
        }
      });
    });
  }).catch(err => console.warn('[SW] GC Terganggu:', err));
};

self.addEventListener('install', event => {
  self.skipWaiting(); 
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      return Promise.all(
        staticAssets.map(asset => {
          // Fallback ke no-cors jika CORS ketat ditolak oleh CDN untuk mencegah Offline DoS
          const reqOpt = asset.startsWith('http') ? { mode: 'cors', credentials: 'omit' } : {};
          return fetch(asset, reqOpt)
            .then(response => {
              if (response.ok && response.type !== 'opaque') {
                return cache.put(asset, response); 
              }
              throw new Error("Opaque atau Non-OK");
            })
            .catch(() => {
              // Jika CORS gagal, coba bypass agar aplikasi tetap bisa offline (tanpa cache dinamis)
              if (asset.startsWith('http')) {
                return fetch(asset, { mode: 'no-cors' })
                  .then(fallbackRes => cache.put(asset, fallbackRes))
                  .catch(() => console.warn('[SW] Aset statis gagal di-cache:', asset));
              }
            });
        })
      );
    })
  );
});

self.addEventListener('activate', event => {
  self.clients.claim(); 
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            console.log('[SW] Melakukan Garbage Collection (Purge):', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.action === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
      })
    );
  }
});

self.addEventListener('sync', event => {
  if (event.tag === 'sync-cloud-upload') {
    console.log('[SW] Sinyal internet terdeteksi. Memulai Background Sync ke Cloud...');
    event.waitUntil(Promise.resolve()); // Placeholder Enterprise Phase 2
  }
});

// =========================================================
// INTERCEPTOR JARINGAN & CACHE STRATEGY (DEADLOCK FREE)
// =========================================================
self.addEventListener('fetch', event => {
  const req = event.request;
  const reqUrl = new URL(req.url);

  if (req.method !== 'GET' || !reqUrl.protocol.startsWith('http') || reqUrl.pathname.endsWith('sw.js')) return;

  // Zero-Cache untuk Database Engine Cloud
  if (reqUrl.hostname.includes('script.google')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  // 1. STRATEGI NETWORK-FIRST UNTUK HTML
  if (isHtmlRequest) {
    event.respondWith(
      fetch(req).then(networkResponse => {
        if (networkResponse && networkResponse.ok) {
          const clone = networkResponse.clone();
          caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, clone));
        }
        return networkResponse;
      }).catch(() => {
        // ignoreSearch: true memastikan PWA membuka versi offline meski ada parameter URL
        return caches.match(cacheKey, { ignoreSearch: true })
          .then(cachedRes => cachedRes || caches.match('./', { ignoreSearch: true }))
          .then(res => res || Response.error());
      })
    );
    return;
  }

  // 2. STRATEGI CACHE-FIRST UNTUK FONT WOFF2
  if (reqUrl.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req).then(cachedRes => {
        return cachedRes || fetch(req).then(networkRes => {
          if (networkRes && networkRes.ok && networkRes.type !== 'opaque') {
            const clone = networkRes.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(req, clone));
          }
          return networkRes;
        }).catch(() => Response.error());
      })
    );
    return;
  }

  // Identifikasi Aset
  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    return reqUrl.pathname === new URL(asset, self.location.href).pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

  // 3. STRATEGI CACHE-FIRST UNTUK STATIC ASSETS
  if (isLocalStatic || isCDNStatic) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        return cachedResponse || fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
            const clone = networkResponse.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, clone));
          }
          return networkResponse;
        }).catch(() => Response.error());
      })
    );
    return;
  } 

  // 4. STRATEGI STALE-WHILE-REVALIDATE UNTUK DYNAMIC/CSS (ANTI-PREMATURE TERMINATION)
  const cachedResPromise = caches.match(req, { ignoreSearch: true });
  
  const networkResPromise = fetch(req).then(networkResponse => {
    if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
      const clone = networkResponse.clone();
      
      // [FIX] INJEKSI LIFECYCLE: Mengunci cache.put dan GC agar SW tidak mati prematur
      event.waitUntil(
        caches.open(CACHE_DYNAMIC).then(cache => {
          return cache.put(req, clone).then(() => limitCacheSize(CACHE_DYNAMIC, 60));
        })
      );
    }
    return networkResponse;
  }).catch(() => Response.error());

  // Kunci utama untuk memastikan network request selesai
  event.waitUntil(networkResPromise);

  event.respondWith(
    cachedResPromise.then(cachedResponse => {
      return cachedResponse || networkResPromise;
    }).catch(() => Response.error())
  );
});
