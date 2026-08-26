// sw.js — Ketchup Files / Interfaz Studio
//
// Its only real job is to exist: Chrome and other Android browsers
// require an active, registered service worker before they'll offer the
// native "Install app" prompt at all -- this is a platform requirement,
// not a design choice on our part. This one deliberately does the
// simplest thing that satisfies that requirement without changing how
// the site behaves: it lets every request pass straight through to the
// network, so nothing is cached, nothing works offline, and nothing
// about the live site's behavior changes. If real offline support is
// wanted later, this is the file to expand -- for now it exists purely
// to unlock the install prompt.

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  // Pass-through only -- no caching, no offline behavior.
  event.respondWith(fetch(event.request));
});
