/** 后端 HTTP API 客户端 */

export const SERVER_BASE: string = window.api?.serverBase ?? 'http://127.0.0.1:8765'
export const WS_URL = SERVER_BASE.replace(/^http/, 'ws') + '/ws/tts'

export interface EngineStatus {
  state: 'not_loaded' | 'loading' | 'ready' | 'error'
  error: string | null
  model_path: string
  model_exists: boolean
  load_seconds: number | null
  sample_rate: number
}

export interface HistoryEntry {
  id: string
  created_at: number
  duration: number
  peaks: number[]
  file: string
  mode: 'design' | 'clone' | 'direction' | 'builtin' | 'tts'
  text: string
  instruct?: string | null
  ref_text?: string | null
  voice?: string
  preset?: string | null
  params: Record<string, unknown>
  stats?: Record<string, number>
  partial?: boolean
}

export interface RefAudio {
  id: string
  duration: number
  sample_rate: number
  peaks: number[]
  file: string
  /** 音色库中的显示名称 */
  name?: string | null
  /** 已保存的参考文字（生成时会回填） */
  ref_text?: string | null
  created_at?: number
}

export async function fetchHealth(): Promise<{ ok: boolean; engine: EngineStatus }> {
  const r = await fetch(`${SERVER_BASE}/api/health`)
  if (!r.ok) throw new Error(`health ${r.status}`)
  return r.json()
}

export async function fetchHistory(limit = 200): Promise<HistoryEntry[]> {
  const r = await fetch(`${SERVER_BASE}/api/history?limit=${limit}`)
  if (!r.ok) throw new Error(`history ${r.status}`)
  return r.json()
}

export async function deleteHistory(id: string): Promise<void> {
  await fetch(`${SERVER_BASE}/api/history/${id}`, { method: 'DELETE' })
}

export async function uploadRefAudio(
  file: File,
  meta?: { name?: string; refText?: string }
): Promise<RefAudio> {
  const form = new FormData()
  form.append('file', file)
  if (meta?.name) form.append('name', meta.name)
  if (meta?.refText) form.append('ref_text', meta.refText)
  const r = await fetch(`${SERVER_BASE}/api/ref_audio`, { method: 'POST', body: form })
  if (!r.ok) {
    const detail = await r.json().catch(() => null)
    throw new Error(detail?.detail ?? `上传失败 (${r.status})`)
  }
  return r.json()
}

/** 我的音色库：已保存的克隆参考音频 */
export async function fetchRefs(limit = 100): Promise<RefAudio[]> {
  const r = await fetch(`${SERVER_BASE}/api/ref_audio?limit=${limit}`)
  if (!r.ok) throw new Error(`refs ${r.status}`)
  return r.json()
}

/** 更新音色名称 / 参考文字；字段传 undefined 表示不修改 */
export async function updateRef(
  id: string,
  meta: { name?: string; refText?: string }
): Promise<RefAudio> {
  const body: Record<string, string> = {}
  if (meta.name !== undefined) body.name = meta.name
  if (meta.refText !== undefined) body.ref_text = meta.refText
  const r = await fetch(`${SERVER_BASE}/api/ref_audio/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => null)
    throw new Error(detail?.detail ?? `更新失败 (${r.status})`)
  }
  return r.json()
}

export async function deleteRef(id: string): Promise<void> {
  const r = await fetch(`${SERVER_BASE}/api/ref_audio/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`删除失败 (${r.status})`)
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  url: string | null
  notes: string | null
  error: string | null
}

// ---- 模型管理与下载 ----

export interface DownloadStatus {
  active: boolean
  source?: 'modelscope' | 'huggingface'
  phase?: 'running' | 'done' | 'error' | 'cancelled'
  target?: string
  file?: string | null
  percent?: number | null
  downloaded_bytes?: number | null
  total_bytes?: number | null
  speed?: number | null
  error?: string | null
  started_at?: number
  finished_at?: number | null
}

export interface ModelInfo {
  model_path: string
  model_exists: boolean
  model_complete: boolean
  engine_state: EngineStatus['state']
  engine_error: string | null
  load_seconds: number | null
  sample_rate: number
  download_dir: string
  download_target: string
  download: DownloadStatus
}

export async function fetchModelInfo(): Promise<ModelInfo> {
  const r = await fetch(`${SERVER_BASE}/api/model`)
  if (!r.ok) throw new Error(`model ${r.status}`)
  return r.json()
}

export async function setModelPath(path: string): Promise<ModelInfo> {
  const r = await fetch(`${SERVER_BASE}/api/model/path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path })
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => null)
    throw new Error(detail?.detail ?? `设置失败 (${r.status})`)
  }
  return r.json()
}

export async function startModelDownload(source: 'modelscope' | 'huggingface'): Promise<ModelInfo> {
  const r = await fetch(`${SERVER_BASE}/api/model/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source })
  })
  if (!r.ok) {
    const detail = await r.json().catch(() => null)
    throw new Error(detail?.detail ?? `下载启动失败 (${r.status})`)
  }
  return r.json()
}

export async function cancelModelDownload(): Promise<void> {
  const r = await fetch(`${SERVER_BASE}/api/model/cancel`, { method: 'POST' })
  if (!r.ok) throw new Error(`取消失败 (${r.status})`)
}

export function historyAudioUrl(entry: HistoryEntry): string {
  return `${SERVER_BASE}/outputs/history/${entry.file}`
}

export function refAudioUrl(ref: RefAudio): string {
  return `${SERVER_BASE}/outputs/refs/${ref.file}`
}
