/**
 * PizuAudio service worker — scripts/pwa.mjs copies it into the build as sw.js and puts the
 * build's file list in place of __BUILD__; never deploy this file as is. Every path in BUILD
 * carries the application base (https://pizu.pl/audio/) and the worker registers with that
 * scope (lib/pwa.ts), so it serves only PizuAudio, never the whole pizu.pl site.
 *
 * - On install: every page (BUILD.base, the tool pages …) and every file the app needs
 *   (/assets, the MP3 encoder in /workers and /vendor, icons…) goes into one cache per version,
 *   each checked against its SHA-256 from the build — a half-copied deployment fails the
 *   install and the previous version stays.
 * - Heavy files only some visitors need are cached the first time a browser fetches them, each
 *   group in its own cache per content revision: ONNX Runtime (/ort-*, 27 MB, vocal separation)
 *   and the demo song (/demo, 3 MB).
 * - The AI model comes from Hugging Face (another origin): this worker never touches it.
 *   separator.worker.ts keeps it in its own cache (pizu-audio-models-*), which stays across versions.
 * - Audio files shared to the installed app (Android „Udostępnij”, manifest share_target) are
 *   kept in their own cache until the page takes them (lib/pwa.ts).
 * - A new version installs in the background and waits; the page shows „Jest nowa wersja”
 *   (lib/pwa.ts) and switches only when the visitor clicks „Odśwież” (or closes every tab).
 */
const BUILD = {"app":"0.11.0","version":"a2f9fa844d1b","hashLength":16,"base":"/audio/","pages":["/audio/","/audio/oddziel-wokal/","/audio/przytnij-mp3/"],"offlinePage":"/audio/404.html","precache":[["/audio/","074566a084b6974f"],["/audio/oddziel-wokal/","fc870ceca1634fde"],["/audio/przytnij-mp3/","4615e1f2bb7dbea1"],["/audio/favicon.png","15d2d5483e8a543a"],["/audio/settings-init.js","ddb1e3b919a885b2"],["/audio/404.html","3a8f0b0a0b63234f"],["/audio/404.css","3c181cf453dbda73"],["/audio/vendor/lamejs/lame.min.js","15d285e2587b3bdb"],["/audio/manifest.webmanifest","2e84816d37d9128a"],["/audio/icon-192.png","d272381bb7b21923"],["/audio/icon-512.png","dc556f95fe75af39"],["/audio/icon-maskable-512.png","3c59c519cc25ab56"],["/audio/apple-touch-icon.png","e8590d3f9b5516bb"],["/audio/assets/SeparateVocals-C-IL4db2.js","479465cab64e180f"],["/audio/assets/TrimConvert-ChEuCa0A.js","138b48cf63915eb1"],["/audio/assets/analysis.worker-BxrKhHWS.js","76b8e5c329125295"],["/audio/assets/index-BYTq2mfL.js","b6a32ad35a2c2a8c"],["/audio/assets/index-Cy7Ef9zP.css","90047f65c78611ef"],["/audio/assets/licenses-BHHZdih8.js","3a039f4b47b094d4"],["/audio/assets/loudness-client-DAxJi5ZU.js","bf71fca250bd1352"],["/audio/assets/loudness.worker-DIa6BqF6.js","8bc7b97ef55235f5"],["/audio/assets/separator.worker-nQAfchPb.js","f1fbf53f1d1872ab"],["/audio/assets/soundtouch-processor-BKTidsbT.js","59635b112697ad40"],["/audio/workers/mp3-encoder.js","036208ea440effe8"],["/audio/workers/recorder-worklet.js","33059b311fba20c7"]],"lazy":[{"cache":"pizuaudio-ort-0ab4b6bfde7d","prefix":"/audio/ort-"},{"cache":"pizuaudio-demo-132c55ccb42d","prefix":"/audio/demo/"}],"shareAction":"/audio/udostepnij","shareField":"audio"}
const APP_CACHE = `pizuaudio-app-${BUILD.version}`
const SHARE_CACHE = 'pizuaudio-share'
const PRECACHED = new Set(BUILD.precache.map(([path]) => path))
const PAGES = new Set(BUILD.pages)

async function sha256(body) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, BUILD.hashLength)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE)
      await Promise.all(
        BUILD.precache.map(async ([path, hash]) => {
          // a hashed name never changes its content, so the HTTP cache may answer; the rest is revalidated
          const response = await fetch(path, { cache: path.startsWith(BUILD.base + 'assets/') ? 'default' : 'no-cache' })
          if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
          const body = await response.clone().arrayBuffer()
          if ((await sha256(body)) !== hash) throw new Error(`${path}: treść inna niż w wersji ${BUILD.version}`)
          // a redirected response cannot answer a navigation — store a plain copy
          await cache.put(path, response.redirected ? new Response(body, response) : response)
        })
      )
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = new Set([APP_CACHE, SHARE_CACHE, ...BUILD.lazy.map((group) => group.cache)])
      for (const name of await caches.keys()) {
        if (name.startsWith('pizuaudio-') && !current.has(name)) await caches.delete(name)
      }
      // The first install takes over the page that registered it, so files a tool fetches
      // during that first visit are cached too. Later versions get here only after „Odśwież”.
      await self.clients.claim()
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (request.method === 'POST' && path === BUILD.shareAction) return event.respondWith(receiveShare(request))
  if (request.method !== 'GET' || request.headers.has('range')) return
  if (request.mode === 'navigate') {
    event.respondWith(page(path, url, request))
  } else if (PRECACHED.has(path)) {
    event.respondWith(fromCache(path, request))
  } else {
    const group = BUILD.lazy.find((entry) => path.startsWith(entry.prefix))
    if (group) event.respondWith(onFirstUse(event, group.cache, path, request))
  }
  // anything else (sitemap.xml, og-image.png, licenses …) goes to the server as usual
})

// Query strings (?demo, ?v=0.9.0 …) do not change a file, so /x?y and /x share one copy
async function fromCache(path, request) {
  return (await caches.match(path, { cacheName: APP_CACHE })) ?? fetch(request)
}

async function page(path, url, request) {
  if (PAGES.has(path)) return fromCache(path, request)
  // /oddziel-wokal → /oddziel-wokal/, as the server does — offline too
  if (PAGES.has(`${path}/`)) return Response.redirect(`${url.origin}${path}/${url.search}`, 301)
  try {
    return await fetch(request)
  } catch {
    return (await caches.match(BUILD.offlinePage, { cacheName: APP_CACHE })) ?? Response.error()
  }
}

async function onFirstUse(event, cacheName, path, request) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(path)
  if (hit) return hit
  const response = await fetch(request)
  if (response.status === 200 && response.type === 'basic') event.waitUntil(cache.put(path, response.clone()))
  return response
}

// The files go into SHARE_CACHE (replacing anything never taken), then the app opens with
// ?udostepnione and lib/pwa.ts takes them out. Never an error page: at worst the app opens empty.
async function receiveShare(request) {
  try {
    const form = await request.formData()
    const files = form.getAll(BUILD.shareField).filter((entry) => typeof entry !== 'string')
    await caches.delete(SHARE_CACHE)
    const cache = await caches.open(SHARE_CACHE)
    await Promise.all(
      files.map((file, i) =>
        cache.put(`${BUILD.base}udostepnione/${i}`, new Response(file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        }))
      )
    )
  } catch (error) {
    console.error('PizuAudio: nie udało się przyjąć udostępnionych plików', error)
  }
  return Response.redirect(`${self.location.origin}${BUILD.base}?udostepnione`, 303)
}
