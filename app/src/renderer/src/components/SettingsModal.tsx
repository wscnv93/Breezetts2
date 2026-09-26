/** 设置面板：模型路径 + 在线下载（ModelScope / HuggingFace）+ 关于与更新 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelModelDownload,
  fetchModelInfo,
  setModelPath,
  startModelDownload,
  type ModelInfo,
  type UpdateInfo
} from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onError: (msg: string) => void
}

function gb(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  return `${(bytes / 1e9).toFixed(2)} GB`
}

function speedText(bps: number | null | undefined): string {
  if (!bps) return ''
  return `${(bps / 1e6).toFixed(1)} MB/s`
}

export function SettingsModal({ open, onClose, onError }: Props): React.JSX.Element | null {
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [source, setSource] = useState<'modelscope' | 'huggingface'>('modelscope')
  const [savingPath, setSavingPath] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback((): Promise<ModelInfo | null> => {
    return fetchModelInfo()
      .then((m) => {
        setInfo(m)
        return m
      })
      .catch(() => null)
  }, [])

  // 打开期间每秒轮询模型与下载状态
  useEffect(() => {
    if (!open) return
    void refresh()
    timerRef.current = window.setInterval(() => void refresh(), 1000)
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [open, refresh])

  // 路径草稿在打开时清零一次，避免轮询覆盖用户输入（effect 内同步 setState 会引发级联渲染告警）
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => setPathDraft(''), 0)
    return () => window.clearTimeout(t)
  }, [open])

  if (!open) return null

  const dl = info?.download
  const downloading = !!dl?.active

  const applyPath = async (): Promise<void> => {
    const p = pathDraft.trim()
    if (!p) return
    setSavingPath(true)
    try {
      setInfo(await setModelPath(p))
      setPathDraft('')
    } catch (e) {
      onError(e instanceof Error ? e.message : '设置失败')
    } finally {
      setSavingPath(false)
    }
  }

  const startDownload = async (): Promise<void> => {
    try {
      setInfo(await startModelDownload(source))
    } catch (e) {
      onError(e instanceof Error ? e.message : '下载启动失败')
    }
  }

  const checkUpdate = async (): Promise<void> => {
    setChecking(true)
    try {
      const res = await window.api?.checkUpdate()
      if (res) setUpdate(res)
    } finally {
      setChecking(false)
    }
  }

  const updateText = (): string => {
    if (checking) return '检查中…'
    if (!update) return ''
    if (update.error) return `检查失败：${update.error}`
    if (update.hasUpdate)
      return `发现新版本 v${update.latestVersion}（当前 v${update.currentVersion}）`
    return `已是最新版本（v${update.currentVersion}）`
  }

  const modelStatusText = (): string => {
    if (!info) return '连接服务中…'
    if (!info.model_exists) return '目录不存在 — 可通过下方下载获取模型'
    if (!info.model_complete) return '目录存在但缺少模型文件（config.json / 权重）'
    switch (info.engine_state) {
      case 'ready':
        return `就绪 · 首次加载耗时 ${info.load_seconds ?? '—'}s`
      case 'loading':
        return '模型加载中…'
      case 'error':
        return `异常：${info.engine_error ?? ''}`
      default:
        return '有效 · 首次生成时自动加载'
    }
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title">设置</span>
          <button type="button" className="mini-btn" onClick={onClose} aria-label="关闭设置">
            关闭
          </button>
        </div>

        <section className="field">
          <label className="label" htmlFor="model-path">
            模型路径
          </label>
          <div className="modal-path-row">
            <input
              id="model-path"
              type="text"
              className="mono"
              value={pathDraft || info?.model_path || ''}
              onChange={(e) => setPathDraft(e.target.value)}
              placeholder="/Users/you/.downloadmodels/Breeze-TTS-2-mlx"
              spellCheck={false}
            />
            <button
              type="button"
              className="btn-ghost"
              disabled={savingPath || downloading || !pathDraft.trim()}
              onClick={() => void applyPath()}
            >
              应用
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>{modelStatusText()}</span>
        </section>

        <section className="field">
          <span className="label">下载模型（约 7.1GB，支持断点续传）</span>
          <div className="dl-sources" role="radiogroup" aria-label="下载源">
            <button
              type="button"
              role="radio"
              aria-checked={source === 'modelscope'}
              className={`dl-source${source === 'modelscope' ? ' active' : ''}`}
              disabled={downloading}
              onClick={() => setSource('modelscope')}
            >
              <span className="dl-name">ModelScope 魔搭</span>
              <span className="dl-desc">国内直连快</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === 'huggingface'}
              className={`dl-source${source === 'huggingface' ? ' active' : ''}`}
              disabled={downloading}
              onClick={() => setSource('huggingface')}
            >
              <span className="dl-name">HuggingFace</span>
              <span className="dl-desc">需可访问 hf.co</span>
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            下载到 {info?.download_target ?? '~/.downloadmodels/Breeze-TTS-2-mlx'}，完成后自动启用
          </span>

          {downloading && (
            <div className="dl-progress">
              <div className="dl-bar">
                <div className="dl-bar-fill" style={{ width: `${dl?.percent ?? 0}%` }} />
              </div>
              <div className="dl-row">
                <span className="mono">
                  {dl?.percent != null ? `${dl.percent.toFixed(1)}%` : '准备中…'}
                  {` · ${gb(dl?.downloaded_bytes)}${dl?.total_bytes ? ` / ${gb(dl.total_bytes)}` : ''}`}
                  {dl?.speed ? ` · ${speedText(dl.speed)}` : ''}
                </span>
                <button
                  type="button"
                  className="mini-btn danger"
                  onClick={() => void cancelModelDownload()}
                >
                  取消
                </button>
              </div>
              {dl?.file && <div className="dl-file mono">{dl.file}</div>}
            </div>
          )}

          {!downloading && dl?.phase === 'done' && (
            <span className="dl-done">下载完成，模型已启用 ✓</span>
          )}
          {!downloading && dl?.phase === 'cancelled' && (
            <span className="dl-note">已取消 · 已下载部分保留，再次下载会续传</span>
          )}
          {!downloading && dl?.phase === 'error' && (
            <span className="dl-note" style={{ color: 'var(--seal)' }}>
              下载失败：{dl?.error ?? '未知错误'}
            </span>
          )}

          <button
            type="button"
            className="btn-ghost"
            disabled={downloading}
            onClick={() => void startDownload()}
          >
            {downloading ? '下载中…' : '开始下载'}
          </button>
        </section>

        <section className="field">
          <span className="label">关于与更新</span>
          <div className="update-row">
            <span style={{ fontSize: 12, color: 'var(--ink-mist)' }}>{updateText()}</span>
            <span style={{ display: 'flex', gap: 6 }}>
              {update?.hasUpdate && update.url && (
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => window.open(update.url ?? undefined, '_blank')}
                >
                  前往下载
                </button>
              )}
              <button
                type="button"
                className="mini-btn"
                disabled={checking}
                onClick={() => void checkUpdate()}
              >
                检查更新
              </button>
            </span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
            微风之声 BreezeVoice · 本地语音合成，模型与数据全部留在本机
          </span>
        </section>
      </div>
    </div>
  )
}
