/** 参考音频输入：文件拖放/选择 + 麦克风录制，上传后显示波形预览 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { refAudioUrl, uploadRefAudio, type RefAudio } from '../lib/api'
import { PauseIcon, PlayIcon } from './icons'
import { StaticWave } from './Waveform'

interface Props {
  refAudio: RefAudio | null
  onChange: (r: RefAudio | null) => void
  disabled: boolean
  onError: (msg: string) => void
}

const MAX_REC_SECONDS = 20
const MIN_REC_SECONDS = 3
/** 每 250ms 交付一次数据，保证 stop 前已有可用分片 */
const REC_TIMESLICE_MS = 250
/** 低于此 RMS 视为没有收到有效人声 */
const SILENCE_RMS = 0.004
/** 偏小但仍可用，给出提醒 */
const QUIET_RMS = 0.02

/** 解码录音并测量电平，用于识别"录到的是静音"这种静默失败 */
async function measureLevel(blob: Blob): Promise<{ rms: number; peak: number }> {
  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer())
    const data = decoded.getChannelData(0)
    let sum = 0
    let peak = 0
    for (let i = 0; i < data.length; i++) {
      const v = data[i]
      sum += v * v
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    return { rms: Math.sqrt(sum / Math.max(1, data.length)), peak }
  } finally {
    void ctx.close()
  }
}

function db(rms: number): string {
  return rms <= 0 ? '-∞ dB' : `${(20 * Math.log10(rms)).toFixed(1)} dB`
}

export function RefAudioInput({ refAudio, onChange, disabled, onError }: Props): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const [deviceLabel, setDeviceLabel] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const previewRef = useRef<HTMLAudioElement | null>(null)
  /** 录制起始时刻；用时间戳算时长，避免读到闭包里的旧 state */
  const startedAtRef = useRef(0)

  useEffect(
    () => () => {
      stopTimer()
      recRef.current?.stream.getTracks().forEach((t) => t.stop())
    },
    []
  )

  const doUpload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        // 默认音色名：文件名去扩展名；录音则用时间
        const r = await uploadRefAudio(file, {
          name:
            file.name && !file.name.startsWith('recording.')
              ? file.name.replace(/\.[^.]+$/, '').slice(0, 60)
              : `录音 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
        })
        onChange(r)
      } catch (e) {
        onError(e instanceof Error ? e.message : '上传失败')
      } finally {
        setUploading(false)
      }
    },
    [onChange, onError]
  )

  const pickFile = (f: File | undefined): void => {
    if (!f) return
    if (!/audio|video/.test(f.type) && !/\.(wav|mp3|m4a|aac|ogg|flac|webm)$/i.test(f.name)) {
      onError('请选择音频文件（wav / mp3 / m4a / webm）')
      return
    }
    void doUpload(f)
  }

  const stopTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startRecord = async (): Promise<void> => {
    if (disabled || uploading || recording) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      onError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? '麦克风权限被拒绝。请在「系统设置 → 隐私与安全性 → 麦克风」中允许本应用，然后重试。'
          : name === 'NotFoundError'
            ? '没有找到可用的麦克风设备。'
            : '无法访问麦克风，请检查系统隐私设置中的麦克风权限。'
      )
      return
    }

    const parts: Blob[] = []
    let mime = ''
    setDeviceLabel(stream.getAudioTracks()[0]?.label ?? '未知输入设备')
    // 优先选浏览器明确支持的编码
    for (const candidate of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported(candidate)) {
        mime = candidate
        break
      }
    }
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    recRef.current = rec

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) parts.push(e.data)
    }

    rec.onerror = () => {
      stopTimer()
      setRecording(false)
      stream.getTracks().forEach((t) => t.stop())
      onError('录音过程中出错，请重试。')
    }

    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      stopTimer()
      setRecording(false)
      setRecSecs(0)

      // 用时间戳算实际时长（早前版本读 state 会拿到闭包旧值 0）
      const dur = (Date.now() - startedAtRef.current) / 1000

      if (parts.length === 0) {
        onError('没有收到录音数据，请检查麦克风是否被其他应用占用，然后重试。')
        return
      }
      const blob = new Blob(parts, { type: rec.mimeType || mime || 'audio/webm' })
      if (blob.size === 0) {
        onError('录音数据为空，请确认麦克风有输入后重试。')
        return
      }
      if (dur < MIN_REC_SECONDS - 0.5) {
        onError(`录制太短（${dur.toFixed(1)} 秒），请至少录 ${MIN_REC_SECONDS} 秒。`)
        return
      }

      // 静默失败检测：系统未授权时 Chromium 会给出静音轨道而不报错
      void (async () => {
        let level: { rms: number; peak: number } | null = null
        try {
          level = await measureLevel(blob)
        } catch {
          level = null // 解码失败就直接交给后端，不阻断流程
        }
        if (level && level.rms < SILENCE_RMS) {
          onError(
            `录到的音频是静音（${db(level.rms)}，时长 ${dur.toFixed(1)} 秒）。` +
              `请到「系统设置 → 隐私与安全性 → 麦克风」确认本应用已获授权，` +
              `并检查输入设备不是静音。`
          )
          return
        }
        if (level && level.rms < QUIET_RMS) {
          onError(`录音电平偏低（${db(level.rms)}），克隆效果可能不理想，建议靠近麦克风重录。`)
        }
        const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
        void doUpload(new File([blob], `recording.${ext}`, { type: blob.type }))
      })()
    }

    startedAtRef.current = Date.now()
    rec.start(REC_TIMESLICE_MS)
    setRecording(true)
    setRecSecs(0)
    timerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
      setRecSecs(elapsed)
      if (elapsed >= MAX_REC_SECONDS) {
        recRef.current?.stop()
      }
    }, 200)
  }

  return (
    <div>
      {refAudio && (
        <div className="ref-preview">
          <StaticWave peaks={refAudio.peaks} height={34} />
          <div className="meta">
            <span>{refAudio.duration.toFixed(1)}s · 24kHz</span>
            <span style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="mini-btn"
                disabled={disabled}
                onClick={() => {
                  const el = previewRef.current
                  if (!el) return
                  if (previewing) {
                    el.pause()
                    setPreviewing(false)
                  } else {
                    el.src = refAudioUrl(refAudio)
                    void el.play()
                    setPreviewing(true)
                  }
                }}
              >
                {previewing ? (
                  <>
                    <PauseIcon size={10} /> 停止
                  </>
                ) : (
                  <>
                    <PlayIcon size={10} /> 试听
                  </>
                )}
              </button>
              <button
                type="button"
                className="mini-btn danger"
                disabled={disabled}
                onClick={() => {
                  previewRef.current?.pause()
                  setPreviewing(false)
                  onChange(null)
                }}
              >
                取消选择
              </button>
            </span>
          </div>
        </div>
      )}
      <div
        className={`ref-zone${dragover ? ' dragover' : ''}${refAudio ? ' compact' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragover(true)
        }}
        onDragLeave={() => setDragover(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragover(false)
          pickFile(e.dataTransfer.files[0])
        }}
        onClick={() => !disabled && fileRef.current?.click()}
        role="button"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click()
        }}
      >
        {refAudio && <div className="ref-zone-title">新增参考音频</div>}
        {uploading
          ? '正在处理音频…'
          : recording
            ? `正在录制 ${recSecs}s / ${MIN_REC_SECONDS}s 起可用（${MAX_REC_SECONDS}s 自动停止）`
            : '拖入音频到此处，或用下方按钮录制 / 选择文件'}
        {recording && deviceLabel && (
          <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
            输入设备：{deviceLabel}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/webm"
          onChange={(e) => {
            pickFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <div className="ref-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="btn-ghost"
            disabled={disabled || uploading}
            onClick={() => fileRef.current?.click()}
          >
            选择文件
          </button>
          <button
            type="button"
            className={`btn-record${recording ? ' recording' : ''}`}
            disabled={disabled || uploading}
            onClick={() => (recording ? recRef.current?.stop() : void startRecord())}
          >
            {recording ? (
              <>
                <span className="rec-dot" /> 停止 · {recSecs}s
              </>
            ) : (
              <>
                <span className="rec-dot" /> 麦克风录制
              </>
            )}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 8 }}>
          {refAudio
            ? '新录制 / 上传会作为新音色加入列表，不影响已选中的音色'
            : '建议 3–15 秒干净人声，参考文字会自动保存'}
        </div>
      </div>
      <audio ref={previewRef} onEnded={() => setPreviewing(false)} style={{ display: 'none' }} />
    </div>
  )
}
