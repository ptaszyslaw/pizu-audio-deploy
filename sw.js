/**
 * PizuAudio service worker — scripts/pwa.mjs copies it into the build as /sw.js and puts the
 * build's file list in place of __BUILD__; never deploy this file as is.
 *
 * - On install: every page (/, /oddziel-wokal/ …) and every file the app needs (/assets, the MP3
 *   encoder in /workers and /vendor, icons…) goes into one cache per version, each checked
 *   against its SHA-256 from the build — a half-copied deployment fails the install and the
 *   previous version stays.
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
const BUILD = {"app":"0.9.0","version":"175773dfd11a","hashLength":16,"pages":["/","/oddziel-wokal/","/przytnij-mp3/"],"offlinePage":"/404.html","precache":[["/","414a91da6eb207ba"],["/oddziel-wokal/","3add88d1be5b74fa"],["/przytnij-mp3/","cd07374fa7e2594a"],["/favicon.png","15d2d5483e8a543a"],["/settings-init.js","6f96924bc4d8d3df"],["/404.html","0f5b351e38f1d755"],["/404.css","3c181cf453dbda73"],["/vendor/lamejs/lame.min.js","15d285e2587b3bdb"],["/manifest.webmanifest","924af06b5e116696"],["/icon-192.png","d272381bb7b21923"],["/icon-512.png","dc556f95fe75af39"],["/icon-maskable-512.png","3c59c519cc25ab56"],["/apple-touch-icon.png","e8590d3f9b5516bb"],["/assets/SeparateVocals-Bs6MLYkq.js","d5aed9e19a081299"],["/assets/TrimConvert-BUZGZLIN.js","771f9fb90486fef1"],["/assets/analysis.worker-BxrKhHWS.js","76b8e5c329125295"],["/assets/index-Cy7Ef9zP.css","90047f65c78611ef"],["/assets/index-jfk56XvZ.js","39062a6f2da0d8e5"],["/assets/licenses-DWr_rjhu.js","b28a3b6670ab5fc7"],["/assets/loudness-client-Yj37RhdS.js","f480227f62e00c6e"],["/assets/loudness.worker-DIa6BqF6.js","8bc7b97ef55235f5"],["/assets/separator.worker-nQAfchPb.js","f1fbf53f1d1872ab"],["/assets/soundtouch-processor-BKTidsbT.js","59635b112697ad40"],["/workers/mp3-encoder.js","036208ea440effe8"],["/workers/recorder-worklet.js","33059b311fba20c7"]],"lazy":[{"cache":"pizuaudio-ort-edf75b6d3f46","prefix":"/ort-"},{"cache":"pizuaudio-demo-44b4ba7e5dc8","prefix":"/demo/"}],"shareAction":"/udostepnij","shareField":"audio"}
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
          const response = await fetch(path, { cache: path.startsWith('/assets/') ? 'default' : 'no-cache' })
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
        cache.put(`/udostepnione/${i}`, new Response(file, {
          headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        }))
      )
    )
  } catch (error) {
    console.error('PizuAudio: nie udało się przyjąć udostępnionych plików', error)
  }
  return Response.redirect(`${self.location.origin}/?udostepnione`, 303)
}
