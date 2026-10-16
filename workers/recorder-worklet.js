/**
 * Microphone capture inside the AudioContext (AudioWorklet). Posts mono
 * chunks tagged with the context frame of their first sample, so the page
 * can line the voice up with the music sample-accurately. Plain JS in
 * public/ (served as a file, like mp3-encoder.js): Vite would inline a file
 * this small as a data: URL, which the site's Content-Security-Policy blocks
 * for audioWorklet.addModule. See karaoke.ts.
 */
const CHUNK = 2048 // ~46 ms at 44.1 kHz

class PizuRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.active = true
    this.buf = new Float32Array(CHUNK)
    this.fill = 0
    this.startFrame = 0
    this.nextFrame = 0
    this.peak = 0
    this.port.onmessage = (e) => {
      if (e.data === 'stop') {
        this.flush()
        this.active = false
        this.port.postMessage({ type: 'stopped' })
      }
    }
  }

  flush() {
    if (this.fill === 0) return
    const samples = this.buf.slice(0, this.fill)
    this.port.postMessage({ type: 'data', frame: this.startFrame, samples, peak: this.peak }, [samples.buffer])
    this.fill = 0
    this.peak = 0
  }

  process(inputs) {
    if (!this.active) return false
    const channels = inputs[0]
    if (!channels || channels.length === 0) return true
    // a gap in the input (no data for some render quanta): the open chunk
    // must not run across it, or later samples would get the wrong frame
    if (this.fill > 0 && currentFrame !== this.nextFrame) this.flush()
    const n = channels[0].length
    this.nextFrame = currentFrame + n
    for (let i = 0; i < n; i++) {
      if (this.fill === 0) this.startFrame = currentFrame + i
      let v = 0
      for (let c = 0; c < channels.length; c++) v += channels[c][i]
      v /= channels.length
      this.buf[this.fill++] = v
      const a = v < 0 ? -v : v
      if (a > this.peak) this.peak = a
      if (this.fill === CHUNK) this.flush()
    }
    return true
  }
}

registerProcessor('pizu-recorder', PizuRecorder)
