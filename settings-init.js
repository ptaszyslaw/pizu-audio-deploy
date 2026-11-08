/*
 * Applies the saved appearance settings before the page is first painted
 * (no flash of the light theme in dark mode). Loaded as a classic blocking
 * script from <head>. Keep in sync with src/lib/settings-storage.ts:
 * pizu-settings is shared with pizu.pl, the pre-move pizu-audio-settings key
 * is migrated once (field by field, invalid values replaced by defaults).
 */
;(function () {
  try {
    var raw = localStorage.getItem('pizu-settings')
    var legacy = raw === null ? localStorage.getItem('pizu-audio-settings') : null
    var value
    try { value = JSON.parse(raw === null ? legacy || '{}' : raw) } catch (e) { value = {} }
    value = value && typeof value === 'object' ? value : {}
    var s = {
      theme: ['light', 'dark', 'auto'].indexOf(value.theme) >= 0 ? value.theme : 'auto',
      contrast: ['normal', 'high'].indexOf(value.contrast) >= 0 ? value.contrast : 'normal',
      textScale: [100, 115, 130, 150].indexOf(value.textScale) >= 0 ? value.textScale : 100,
      motion: ['system', 'reduced', 'full'].indexOf(value.motion) >= 0 ? value.motion : 'system'
    }
    if (legacy !== null) {
      try {
        localStorage.setItem('pizu-settings', JSON.stringify(s))
        localStorage.removeItem('pizu-audio-settings')
      } catch (e) { /* Blocked writes must not prevent applying the appearance. */ }
    }
    var root = document.documentElement
    var theme = s.theme
    var dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) root.classList.add('dark')
    if (s.contrast === 'high') root.classList.add('contrast-high')
    if (s.motion === 'reduced') root.classList.add('reduce-motion')
    if (s.motion === 'full') root.classList.add('motion-full')
    if ([115, 130, 150].indexOf(s.textScale) >= 0) root.style.fontSize = s.textScale + '%'
  } catch (e) {
    // storage blocked: defaults (auto theme via the class set by React later)
  }
})()
