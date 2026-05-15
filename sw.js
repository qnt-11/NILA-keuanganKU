const APP_VERSION = '5.8';
const CACHE_PREFIX = 'uang-fambarla-';
const CACHE_STATIC = CACHE_PREFIX + 'static-v' + APP_VERSION;
const CACHE_DYNAMIC = CACHE_PREFIX + 'dynamic-v' + APP_VERSION;

// Daftar aset inti yang wajib tersedia saat Offline
const staticAssets = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

// =========================================================
// 1. MANAJEMEN MEMORI (GARBAGE COLLECTOR)
// =========================================================
let gcQueue = Promise.resolve();

// Membatasi ukuran cache dinamis agar memori HP tidak penuh
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
  }).catch(err => console.warn('[SW] Pembersihan Memori Gagal:', err));
};

// =========================================================
// 2. FASE INSTALASI (PRE-CACHING)
// =========================================================
self.addEventListener('install', event => {
  self.skipWaiting(); // Memaksa SW baru untuk segera mengambil alih
  event.waitUntil(
    caches.open(CACHE_STATIC).then(cache => {
      console.log('[SW] Menyimpan aset statis...');
      return Promise.all(
        staticAssets.map(asset => {
          // Menangani masalah CORS pada CDN (Chart.js & SheetJS)
          const reqOpt = asset.startsWith('http') ? { mode: 'cors', credentials: 'omit' } : {};
          return fetch(asset, reqOpt)
            .then(response => {
              if (response.ok && response.type !== 'opaque') {
                return cache.put(asset, response);
              }
              throw new Error("Respons Opaque atau Non-OK");
            })
            .catch(() => {
              // Mode darurat (no-cors) jika CDN memblokir, agar app tetap bisa offline
              if (asset.startsWith('http')) {
                return fetch(asset, { mode: 'no-cors' })
                  .then(fallbackRes => cache.put(asset, fallbackRes))
                  .catch(() => console.warn('[SW] Aset CDN gagal di-cache:', asset));
              }
            });
        })
      );
    })
  );
});

// =========================================================
// 3. FASE AKTIVASI (MENGHAPUS CACHE VERSI LAMA)
// =========================================================
self.addEventListener('activate', event => {
  self.clients.claim();
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          // Hapus cache yang depannya 'uang-fambarla-' tapi bukan versi saat ini
          if (key.startsWith(CACHE_PREFIX) && key !== CACHE_STATIC && key !== CACHE_DYNAMIC) {
            console.log('[SW] Menghapus cache versi lama:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// Mendengarkan sinyal hapus semua data dari index.html (Prompt Clear Data)
self.addEventListener('message', event => {
  if (event.data && event.data.action === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then(keys => {
        return Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX)).map(key => caches.delete(key)));
      })
    );
  }
});

// =========================================================
// 4. INTERSEPTOR JARINGAN (STRATEGI PENGAMBILAN DATA)
// =========================================================
self.addEventListener('fetch', event => {
  const req = event.request;
  const reqUrl = new URL(req.url);

  // Abaikan permintaan yang bukan GET atau bukan protokol HTTP/HTTPS
  if (req.method !== 'GET' || !reqUrl.protocol.startsWith('http') || reqUrl.pathname.endsWith('sw.js')) return;

  // STRATEGI 1: BYPASS GOOGLE CLOUD (Wajib Network-Only)
  // Mencegah error gagal sinkronisasi saat Load/Upload Cloud
  if (reqUrl.hostname.includes('script.google.com')) {
    event.respondWith(fetch(req).catch(() => Response.error()));
    return;
  }

  const isHtmlRequest = req.mode === 'navigate' || (req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
  const cacheKey = isHtmlRequest ? './index.html' : req;

  // STRATEGI 2: STALE-WHILE-REVALIDATE UNTUK HTML (Offline-First Sejati)
  if (isHtmlRequest) {
    event.respondWith(
      caches.match(cacheKey, { ignoreSearch: true }).then(cachedResponse => {
        // Ambil pembaruan dari internet secara diam-diam di latar belakang
        const networkFetch = fetch(req).then(networkResponse => {
          if (networkResponse && networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(CACHE_STATIC).then(cache => cache.put(cacheKey, clone));
          }
          return networkResponse;
        }).catch(() => {
          console.log('[SW] Anda sedang Offline. Menggunakan HTML dari Cache.');
        });

        // Mengunci proses agar Service Worker tidak mati sebelum fetch selesai
        event.waitUntil(networkFetch);

        // Langsung tampilkan cache jika ada, jika tidak, tunggu hasil download dari internet
        return cachedResponse || networkFetch || caches.match('./', { ignoreSearch: true });
      })
    );
    return;
  }

  // STRATEGI 3: CACHE-FIRST UNTUK GOOGLE FONTS
  if (reqUrl.hostname === 'fonts.gstatic.com' || reqUrl.hostname === 'fonts.googleapis.com') {
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

  // Identifikasi aset statis yang didaftarkan di atas
  const isLocalStatic = staticAssets.some(asset => {
    if (asset.startsWith('http')) return false;
    return reqUrl.pathname === new URL(asset, self.location.href).pathname;
  });
  const isCDNStatic = staticAssets.some(asset => asset.startsWith('http') && reqUrl.href === asset);

  // STRATEGI 4: CACHE-FIRST UNTUK ASET STATIS (Gambar, JS, CSS Utama)
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

  // STRATEGI 5: STALE-WHILE-REVALIDATE UNTUK ASET DINAMIS LAINNYA
  const cachedResPromise = caches.match(req, { ignoreSearch: true });
  const networkResPromise = fetch(req).then(networkResponse => {
    if (networkResponse && networkResponse.ok && networkResponse.type !== 'opaque') {
      const clone = networkResponse.clone();
      event.waitUntil(
        caches.open(CACHE_DYNAMIC).then(cache => {
          return cache.put(req, clone).then(() => limitCacheSize(CACHE_DYNAMIC, 50));
        })
      );
    }
    return networkResponse;
  }).catch(() => Response.error());

  event.waitUntil(networkResPromise);

  event.respondWith(
    cachedResPromise.then(cachedResponse => {
      return cachedResponse || networkResPromise;
    }).catch(() => Response.error())
  );
});
