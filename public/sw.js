const CACHE_NAME = 'tms-cache-v1';
const PRECACHE_URLS = [
    '/', '/app.html', '/login.html', '/manifest.json', '/css/app.css',
    '/js/app.js', '/js/login.js',
    '/js/lib/sb.js', '/js/lib/ui.js', '/js/lib/forms.js', '/js/lib/validate.js', '/js/lib/utils.js', '/js/lib/format.js',
    '/js/lib/nigeria.js', '/js/lib/lifecycle.js', '/js/lib/permissions.js', '/js/lib/errors.js', '/js/lib/state.js',
    '/js/lib/router.js', '/js/lib/entity.js',
    '/js/pages/dashboard.js', '/js/pages/trips.js', '/js/pages/trip.js', '/js/pages/waybill.js',
    '/js/pages/vehicles.js', '/js/pages/drivers.js', '/js/pages/customers.js', '/js/pages/team.js', '/js/pages/settings.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
    self.skipWaiting();
});
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))));
    self.clients.claim();
});
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    // Only same-origin GETs. Supabase (cross-origin) and Netlify Functions always hit the network so
    // auth and data are never served stale. config.js is generated per deploy, so never cache it.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/.netlify/') || url.pathname === '/js/config.js') return;
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request).then((res) => {
                if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)); }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});
