/* sw.js — lets the station app install to a phone's home screen.

   The WMS is online-only on purpose: a scan must reach the ledger, and a stale
   screen would be worse than a clear "not connected". So this worker caches
   nothing and passes every request straight to the network.
*/
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request)); });
