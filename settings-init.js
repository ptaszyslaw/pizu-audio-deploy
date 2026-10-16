/*
 * Applies the saved appearance settings before the page is first painted
 * (no flash of the light theme in dark mode). Loaded as a classic blocking
 * script from <head>. Keep in sync with src/lib/settings.tsx.
 */
;(function () {
  try {
    var s = JSON.parse(localStorage.getItem('pizu-audio-settings') || '{}')
    var root = document.documentElement
    var theme = s.theme || 'auto'
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
