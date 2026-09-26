/** Web Audio 流式播放器：PCM16 帧到达即排队无缝播放，支持暂停/重播 */

function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const src = new Int16Array(pcm)
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 32768
  return out
}

export class StreamPlayer {
  readonly sampleRate = 24000
  private ctx: AudioContext
  private gain: GainNode
  private chunks: Float32Array[] = []
  private sources: AudioBufferSourceNode[] = []
  private nextStart = 0
  private originTime = 0
  private totalSamples = 0
  private _playing = false
  onEnded: (() => void) | null = null
  private endedTimer: number | null = null

  constructor() {
    this.ctx = new AudioContext()
    this.gain = this.ctx.createGain()
    this.gain.connect(this.ctx.destination)
  }

  get duration(): number {
    return this.totalSamples / this.sampleRate
  }

  get position(): number {
    if (this.totalSamples === 0 || !this._playing) return this._positionFrozen
    return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.originTime))
  }

  private _positionFrozen = 0

  get playing(): boolean {
    return this._playing
  }

  /** 追加一帧 PCM16LE 单声道数据：只累积，不播放（生成期间调用） */
  buffer(pcm: ArrayBuffer): void {
    const samples = pcm16ToFloat32(pcm)
    if (samples.length === 0) return
    this.chunks.push(samples)
    this.totalSamples += samples.length
    this.merged = null
  }

  private _started = false

  get started(): boolean {
    return this._started
  }

  /** 追加一帧 PCM16LE 单声道数据，立即排入播放队列（流式边生成边播） */
  append(pcm: ArrayBuffer): void {
    this.buffer(pcm)
    if (this.totalSamples === 0) return
    const last = this.chunks[this.chunks.length - 1]
    if (!this._playing) {
      this.startPlayback()
    } else {
      this.scheduleChunk(last, this.nextStart)
    }
  }

  private startPlayback(): void {
    void this.ctx.resume()
    this.originTime = this.ctx.currentTime + 0.06
    this.nextStart = this.originTime
    for (const c of this.chunks) this.scheduleChunk(c, this.nextStart)
    this._playing = true
    this._started = true
    this.watchEnded()
  }

  private scheduleChunk(samples: Float32Array, when: number): void {
    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate)
    buffer.copyToChannel(new Float32Array(samples), 0)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.gain)
    src.start(Math.max(when, this.ctx.currentTime))
    this.nextStart = Math.max(when, this.ctx.currentTime) + buffer.duration
    this.sources.push(src)
  }

  /** 从头重播已收到的全部音频 */
  replay(): void {
    this.stopSources()
    void this.ctx.resume()
    this.originTime = this.ctx.currentTime + 0.05
    this.nextStart = this.originTime
    for (const c of this.chunks) this.scheduleChunk(c, this.nextStart)
    this._playing = true
    this._started = true
    this._positionFrozen = 0
    this.watchEnded()
  }

  pause(): void {
    if (!this._playing) return
    this._positionFrozen = this.position
    this._playing = false
    void this.ctx.suspend()
  }

  resume(): void {
    if (this._playing || this.totalSamples === 0) return
    this._playing = true
    void this.ctx.resume()
  }

  /** 停止播放（保留数据，可 replay） */
  stop(): void {
    this._positionFrozen = 0
    this._playing = false
    this._started = false
    this.stopSources()
    void this.ctx.suspend()
  }

  /** 清空全部数据，回到初始状态（新一次生成前调用） */
  reset(): void {
    if (this.endedTimer !== null) {
      window.clearInterval(this.endedTimer)
      this.endedTimer = null
    }
    this.stopSources()
    this.chunks = []
    this.merged = null
    this.totalSamples = 0
    this._playing = false
    this._started = false
    this._positionFrozen = 0
    void this.ctx.suspend()
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.stop()
        s.disconnect()
      } catch {
        /* noop */
      }
    }
    this.sources = []
    this.nextStart = 0
  }

  private watchEnded(): void {
    if (this.endedTimer !== null) window.clearInterval(this.endedTimer)
    this.endedTimer = window.setInterval(() => {
      if (this._playing && this.position >= this.duration - 0.02) {
        // 播完：停表但保留数据
        this._positionFrozen = this.duration
        this._playing = false
        this.stopSources()
        void this.ctx.suspend()
        if (this.endedTimer !== null) window.clearInterval(this.endedTimer)
        this.endedTimer = null
        this.onEnded?.()
      }
    }, 120)
  }

  private merged: Float32Array | null = null

  /** 合并所有已收到的音频（带缓存） */
  private mergedAll(): Float32Array {
    if (!this.merged || this.merged.length !== this.totalSamples) {
      const data = new Float32Array(this.totalSamples)
      let off = 0
      for (const c of this.chunks) {
        data.set(c, off)
        off += c.length
      }
      this.merged = data
    }
    return this.merged
  }

  /** 导出 WAV Blob（含 44 字节头） */
  exportWav(): Blob {
    const data = this.mergedAll()
    const buf = new ArrayBuffer(44 + data.length * 2)
    const v = new DataView(buf)
    const w = (off2: number, s: string): void => {
      for (let i = 0; i < s.length; i++) v.setUint8(off2 + i, s.charCodeAt(i))
    }
    w(0, 'RIFF')
    v.setUint32(4, 36 + data.length * 2, true)
    w(8, 'WAVE')
    w(12, 'fmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, this.sampleRate, true)
    v.setUint32(28, this.sampleRate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    w(36, 'data')
    v.setUint32(40, data.length * 2, true)
    let o = 44
    for (let i = 0; i < data.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, data[i]))
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    }
    return new Blob([buf], { type: 'audio/wav' })
  }

  /** 已接收音频的峰值缩略（用于波形绘制） */
  peaks(buckets: number): number[] {
    const data = this.mergedAll()
    if (data.length === 0) return []
    const step = Math.max(1, Math.floor(data.length / buckets))
    const out: number[] = []
    for (let i = 0; i < data.length; i += step) {
      let m = 0
      const end = Math.min(i + step, data.length)
      for (let j = i; j < end; j++) {
        const a = Math.abs(data[j])
        if (a > m) m = a
      }
      out.push(m)
    }
    const mx = Math.max(...out, 0.01)
    return out.map((x) => x / mx)
  }

  destroy(): void {
    if (this.endedTimer !== null) window.clearInterval(this.endedTimer)
    this.stopSources()
    void this.ctx.close()
  }
}
