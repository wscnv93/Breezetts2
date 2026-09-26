/** WebSocket 生成会话：发请求，收二进制 PCM 帧与 JSON 状态 */
import { WS_URL } from './api'

export interface GenerateParams {
  text: string
  instruct?: string
  ref_id?: string
  ref_text?: string
  preset?: string
  cfg_scale?: number
  temperature?: number
  top_p?: number
  top_k?: number
  seed?: number | null
  max_tokens?: number
}

export interface GenStats {
  rtf?: number
  tokens_per_sec?: number
  peak_memory_gb?: number
  tokens?: number
}

export interface GenHistory {
  id: string
  duration: number
  peaks: number[]
  file: string
  partial?: boolean
}

export type GenMessage =
  | { type: 'meta'; sample_rate: number; mode: string }
  | { type: 'model_loading' }
  | { type: 'model_ready'; load_seconds: number }
  | { type: 'queued' }
  | { type: 'progress'; samples: number; is_final: boolean; stats: GenStats }
  | { type: 'done'; history: GenHistory; stats: GenStats }
  | { type: 'cancelled'; history?: GenHistory; stats?: GenStats }
  | { type: 'error'; message: string }

export interface SessionCallbacks {
  onMessage: (m: GenMessage) => void
  onAudio: (pcm: ArrayBuffer) => void
  onClose: (ev: CloseEvent) => void
}

export class GenSession {
  private ws: WebSocket
  private closed = false

  constructor(params: GenerateParams, cb: SessionCallbacks) {
    this.ws = new WebSocket(WS_URL)
    this.ws.binaryType = 'arraybuffer'
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ action: 'generate', request: params }))
    }
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        cb.onMessage(JSON.parse(ev.data) as GenMessage)
      } else {
        cb.onAudio(ev.data as ArrayBuffer)
      }
    }
    this.ws.onclose = (ev) => {
      if (!this.closed) cb.onClose(ev)
    }
    this.ws.onerror = () => {
      /* onclose 会跟着触发 */
    }
  }

  cancel(): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'cancel' }))
    }
  }

  dispose(): void {
    this.closed = true
    this.cancel()
    try {
      this.ws.close()
    } catch {
      /* noop */
    }
  }
}
