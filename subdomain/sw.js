/**
 * PizuAudio moved to https://pizu.pl/audio/ — this service worker only moves
 * the installed PWA there: clear the caches, unregister, navigate every window
 * (path and query kept). No fetch handler — nothing is served from here anymore.
 */
self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) await caches.delete(name)
      await self.registration.unregister()
      const windows = await self.clients.matchAll({ type: 'window' })
      for (const client of windows) {
        const url = new URL(client.url)
        client.navigate('https://pizu.pl' + '/audio' + url.pathname + url.search + url.hash).catch(() => {})
      }
    })()
  )
})
