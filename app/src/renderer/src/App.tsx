/** 微风之声 BreezeVoice — 应用外壳：状态编排与生成流程 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SERVER_BASE,
  deleteRef as apiDeleteRef,
  fetchHealth,
  fetchHistory,
  fetchRefs,
  historyAudioUrl,
  updateRef as apiUpdateRef,
  type EngineStatus,
  type HistoryEntry,
  type RefAudio
} from './lib/api'
import { StreamPlayer } from './lib/player'
import { presetInstruction, VOICE_PRESETS } from './lib/presets'
import { GenSession, type GenStats } from './lib/ws'
import { Editor } from './components/Editor'
import { HistoryList } from './components/HistoryList'
import { ModePanel, type GenParams, type Mode } from './components/ModePanel'
import { SettingsModal } from './components/SettingsModal'
import { TopBar } from './components/TopBar'
import { SparkIcon, StopSquareIcon } from './components/icons'
import { WavePlayer } from './components/WavePlayer'

type Phase =
  'idle' | 'connecting' | 'model_loading' | 'queued' | 'generating' | 'done' | 'cancelled' | 'error'

const ACTIVE: Phase[] = ['connecting', 'model_loading', 'queued', 'generating']

export default function App(): React.JSX.Element {
  // 输入
  const [text, setText] = useState('')
  const [mode, setMode] = useState<Mode>('preset')
  const [instruct, setInstruct] = useState('')
  const [refText, setRefText] = useState('')
  const [refAudio, setRefAudio] = useState<RefAudio | null>(null)
  const [presetId, setPresetId] = useState<string | null>(null)
  const [params, setParams] = useState<GenParams>({
    cfgScale: 4,
    temperature: 0.9,
    topP: 1.0,
    seed: ''
  })

  // 服务与生成
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  const [online, setOnline] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [stats, setStats] = useState<GenStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [savedRefs, setSavedRefs] = useState<RefAudio[]>([])
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [hasAudio, setHasAudio] = useState(false)
  const [playerExists, setPlayerExists] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const playerRef = useRef<StreamPlayer | null>(null)
  const sessionRef = useRef<GenSession | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const busy = ACTIVE.includes(phase)

  // ---- 服务状态轮询 ----
  useEffect(() => {
    let stop = false
    const poll = async (): Promise<void> => {
      try {
        const h = await fetchHealth()
        if (stop) return
        setOnline(true)
        setEngine(h.engine)
      } catch {
        if (!stop) setOnline(false)
      }
    }
    void poll()
    const t = window.setInterval(poll, 3000)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [])

  const refreshHistory = useCallback(() => {
    fetchHistory()
      .then(setHistory)
      .catch(() => undefined)
  }, [])

  useEffect(refreshHistory, [refreshHistory])

  // 我的音色库：启动即加载，重启后仍可一键选用
  useEffect(() => {
    fetchRefs()
      .then(setSavedRefs)
      .catch(() => undefined)
  }, [])

  // 新上传/录制的参考音频自动入库
  const handleRefAudio = useCallback((r: RefAudio | null): void => {
    setRefAudio(r)
    if (r) setSavedRefs((list) => (list.some((x) => x.id === r.id) ? list : [r, ...list]))
  }, [])

  // 从音色库选用：音频与参考文字一起回填（重复点击不重置已改的文字）
  const handleSelectRef = useCallback(
    (r: RefAudio): void => {
      if (refAudio?.id === r.id) return
      setRefAudio(r)
      setRefText(r.ref_text ?? '')
    },
    [refAudio]
  )

  const handleRenameRef = useCallback((id: string, name: string): void => {
    apiUpdateRef(id, { name })
      .then((updated) => {
        setSavedRefs((list) => list.map((x) => (x.id === id ? updated : x)))
        setRefAudio((cur) => (cur?.id === id ? updated : cur))
      })
      .catch((e) => setError(e instanceof Error ? e.message : '改名失败'))
  }, [])

  const handleDeleteRef = useCallback((id: string): void => {
    apiDeleteRef(id)
      .then(() => {
        setSavedRefs((list) => list.filter((x) => x.id !== id))
        setRefAudio((cur) => {
          if (cur?.id !== id) return cur
          setRefText('')
          return null
        })
      })
      .catch((e) => setError(e instanceof Error ? e.message : '删除失败'))
  }, [])

  useEffect(
    () => () => {
      sessionRef.current?.dispose()
      playerRef.current?.destroy()
    },
    []
  )

  // ---- 生成 ----
  const validate = (): string | null => {
    if (!text.trim()) return '请先输入要合成的文字'
    if (mode === 'preset') {
      if (!presetId) return '请选择一个预置音色，或切换到「音色设计」自由描述'
      return null
    }
    if (mode === 'design' && !instruct.trim()) return '音色设计需要先描述你想要的声音'
    if (mode === 'clone' || mode === 'direction') {
      if (!refAudio) return '请先提供参考音频（上传或录制）'
      if (!refText.trim()) return '请填写参考音频的完整文字内容'
      if (mode === 'direction' && !instruct.trim()) return '语气控制需要填写语气指令'
    }
    return null
  }

  /** 预置音色：按文本语言取对应语言的描述，保证指令与文本语言一致 */
  const effectiveInstruct = (): string | undefined => {
    if (mode === 'clone') return undefined
    if (mode === 'preset') {
      const p = VOICE_PRESETS.find((x) => x.id === presetId)
      return p ? presetInstruction(p, text) : undefined
    }
    return instruct.trim() || undefined
  }

  const handleGenerate = (): void => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setError(null)
    setStats(null)

    // AudioContext 需要用户手势后创建
    if (!playerRef.current) {
      playerRef.current = new StreamPlayer()
      setPlayerExists(true)
    }
    const player = playerRef.current
    player.reset()
    setHasAudio(false)

    audioRef.current?.pause()
    setPlayingId(null)

    const request = {
      text: text.trim(),
      instruct: effectiveInstruct(),
      ref_id: mode === 'clone' || mode === 'direction' ? refAudio?.id : undefined,
      ref_text: mode === 'clone' || mode === 'direction' ? refText.trim() : undefined,
      preset: mode === 'preset' ? (presetId ?? undefined) : undefined,
      cfg_scale: mode === 'clone' ? undefined : params.cfgScale,
      temperature: params.temperature,
      top_p: params.topP,
      seed: params.seed === '' ? null : Number(params.seed)
    }

    // 参考文字随手存进音色库，下次选用该音色自动带上
    if ((mode === 'clone' || mode === 'direction') && refAudio && refText.trim()) {
      const refId = refAudio.id
      const transcript = refText.trim()
      void apiUpdateRef(refId, { refText: transcript })
        .then((updated) => {
          setSavedRefs((list) => list.map((x) => (x.id === refId ? updated : x)))
          setRefAudio((cur) => (cur?.id === refId ? updated : cur))
        })
        .catch(() => undefined)
    }

    setPhase('connecting')
    sessionRef.current = new GenSession(request, {
      onMessage: (m) => {
        switch (m.type) {
          case 'meta':
          case 'model_ready':
            setPhase((p) => (p === 'connecting' || p === 'model_loading' ? 'generating' : p))
            break
          case 'model_loading':
            setPhase('model_loading')
            break
          case 'queued':
            setPhase('queued')
            break
          case 'progress':
            setPhase('generating')
            setStats(m.stats)
            break
          case 'done':
            setPhase('done')
            setStats(m.stats)
            refreshHistory()
            break
          case 'cancelled':
            setPhase('cancelled')
            refreshHistory()
            break
          case 'error':
            setPhase('error')
            setError(m.message)
            break
        }
      },
      onAudio: (pcm) => {
        if (!playerRef.current) return
        setHasAudio(true)
        // 只累积不播放：生成完成后由用户点击播放
        playerRef.current.buffer(pcm)
      },
      onClose: () => {
        setPhase((p) => {
          if (ACTIVE.includes(p)) {
            setError('与服务器的连接中断，请重试')
            return 'error'
          }
          return p
        })
      }
    })
  }

  const handleStop = (): void => {
    sessionRef.current?.cancel()
  }

  // ---- 历史播放 ----
  const playHistory = (e: HistoryEntry): void => {
    const el = audioRef.current
    if (!el) return
    if (playingId === e.id) {
      el.pause()
      setPlayingId(null)
      return
    }
    el.src = historyAudioUrl(e)
    void el.play()
    setPlayingId(e.id)
  }

  // ---- 状态文案 ----
  const statusText = (): { text: string; live?: boolean } => {
    const dur = playerRef.current?.duration ?? 0
    switch (phase) {
      case 'connecting':
        return { text: '连接服务…' }
      case 'model_loading':
        return { text: '模型加载中，首次约需 20 秒…', live: true }
      case 'queued':
        return { text: '排队中（有生成正在进行）…', live: true }
      case 'generating':
        return { text: `正在生成 · 已生成 ${dur.toFixed(1)} 秒音频`, live: true }
      case 'done':
        return { text: `完成 · 共 ${dur.toFixed(1)} 秒，点击播放试听` }
      case 'cancelled':
        return { text: `已停止 · 保留 ${dur.toFixed(1)} 秒片段` }
      case 'error':
        return { text: '生成失败' }
      default:
        return { text: '' }
    }
  }

  const st = statusText()
  const canGenerate = !busy && online && engine?.state !== 'error'

  return (
    <div className="app-grid">
      <TopBar
        engine={engine}
        online={online}
        base={SERVER_BASE}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <aside className="left">
        <ModePanel
          mode={mode}
          onMode={setMode}
          instruct={instruct}
          onInstruct={setInstruct}
          refText={refText}
          onRefText={setRefText}
          refAudio={refAudio}
          onRefAudio={handleRefAudio}
          savedRefs={savedRefs}
          onSelectRef={handleSelectRef}
          onRenameRef={handleRenameRef}
          onDeleteRef={handleDeleteRef}
          presetId={presetId}
          onPreset={(p) => setPresetId(p?.id ?? null)}
          text={text}
          params={params}
          onParams={(p) => setParams((old) => ({ ...old, ...p }))}
          disabled={busy}
          onError={setError}
        />
      </aside>

      <main className="main">
        <Editor value={text} onChange={setText} disabled={busy} />

        <div className="genbar">
          {busy ? (
            <button type="button" className="btn-primary stop" onClick={handleStop}>
              <StopSquareIcon /> 停止生成
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={handleGenerate}
              disabled={!canGenerate}
            >
              <SparkIcon /> 生成语音
            </button>
          )}
          <div className="gen-status">
            {st.text && (
              <span className={st.live ? 'live' : undefined}>
                {st.live ? '● ' : ''}
                {st.text}
              </span>
            )}
            {stats && (phase === 'generating' || phase === 'done') && (
              <span className="gen-stats">
                {stats.tokens_per_sec ? `${stats.tokens_per_sec.toFixed(1)} tok/s` : ''}
                {stats.rtf ? ` · 实时率 ${stats.rtf.toFixed(2)}` : ''}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {playerExists && playerRef.current && (
          <WavePlayer
            player={playerRef.current}
            active={busy || phase === 'done' || phase === 'cancelled'}
            hasAudio={hasAudio}
            generating={busy}
          />
        )}
      </main>

      <aside className="right">
        <div className="right-head">
          <span className="label" style={{ marginBottom: 0 }}>
            生成历史
          </span>
          <span className="count">{history.length} 条</span>
        </div>
        <HistoryList
          items={history}
          playingId={playingId}
          onPlay={playHistory}
          onDelete={(id) => setHistory((h) => h.filter((x) => x.id !== id))}
        />
      </aside>

      <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onError={setError}
      />
    </div>
  )
}
