/*
 * MP3 encoder worker for Pizu Audio.
 * Uses lamejs (LGPL-3.0), loaded as a separate, unmodified file:
 * vendor/lamejs/lame.min.js — https://github.com/zhuker/lamejs
 *
 * in:  { left: Float32Array, right: Float32Array, sampleRate, kbps, mono }
 * out: { type: 'progress', fraction } … { type: 'done', data: ArrayBuffer }
 */
/* global lamejs */
importScripts('../vendor/lamejs/lame.min.js')

const CHUNK = 1152 * 20

function toInt16(src, from, to) {
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, src[i]))
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

self.onmessage = (e) => {
  try {
    const { left, right, sampleRate, kbps, mono } = e.data
    const channels = mono ? 1 : 2
    const encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps)
    let source = left
    if (mono) {
      source = new Float32Array(left.length)
      for (let i = 0; i < left.length; i++) source[i] = (left[i] + right[i]) / 2
    }
    const parts = []
    let size = 0
    const total = left.length
    for (let i = 0; i < total; i += CHUNK) {
      const end = Math.min(total, i + CHUNK)
      const buf = mono
        ? encoder.encodeBuffer(toInt16(source, i, end))
        : encoder.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end))
      if (buf.length) {
        parts.push(buf)
        size += buf.length
      }
      if ((i / CHUNK) % 20 === 0) self.postMessage({ type: 'progress', fraction: end / total })
    }
    const tail = encoder.flush()
    if (tail.length) {
      parts.push(tail)
      size += tail.length
    }
    const out = new Uint8Array(size)
    let off = 0
    for (const p of parts) {
      out.set(new Uint8Array(p.buffer, p.byteOffset, p.length), off)
      off += p.length
    }
    self.postMessage({ type: 'done', data: out.buffer }, [out.buffer])
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) })
  }
}
