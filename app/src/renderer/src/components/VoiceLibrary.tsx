/** 我的音色库：已保存的克隆声音，点选即用（自动回填参考文字），支持试听/改名/删除 */
import { useEffect, useRef, useState } from 'react'
import { refAudioUrl, type RefAudio } from '../lib/api'
import { PauseIcon, PencilIcon, PlayIcon, TrashIcon } from './icons'

interface Props {
  items: RefAudio[]
  selectedId: string | null
  disabled: boolean
  onSelect: (r: RefAudio) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

export function VoiceLibrary({
  items,
  selectedId,
  disabled,
  onSelect,
  onRename,
  onDelete
}: Props): React.JSX.Element | null {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  if (items.length === 0) return null

  const togglePlay = (r: RefAudio): void => {
    const el = audioRef.current
    if (!el) return
    if (playingId === r.id) {
      el.pause()
      setPlayingId(null)
      return
    }
    el.src = refAudioUrl(r)
    void el.play()
    setPlayingId(r.id)
  }

  const startRename = (r: RefAudio): void => {
    setEditingId(r.id)
    setDraft(r.name ?? '')
    // 等输入框渲染出来后聚焦并全选
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }

  const commitRename = (): void => {
    if (editingId) {
      const name = draft.trim()
      if (name) onRename(editingId, name)
    }
    setEditingId(null)
  }

  return (
    <div className="voice-lib">
      {items.map((r) => {
        const selected = selectedId === r.id
        return (
          <div key={r.id} className={`voice-cell${selected ? ' active' : ''}`}>
            {editingId === r.id ? (
              <input
                ref={inputRef}
                className="voice-rename"
                value={draft}
                maxLength={60}
                disabled={disabled}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename()
                  if (e.key === 'Escape') setEditingId(null)
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="音色名称"
              />
            ) : (
              <button
                type="button"
                className="voice-main"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onSelect(r)}
                onDoubleClick={() => !disabled && startRename(r)}
                title={r.ref_text ? `参考文字：${r.ref_text}` : '点击选用；双击改名'}
              >
                <span className="voice-name">{r.name ?? r.id}</span>
                <span className="voice-meta">
                  {r.duration.toFixed(1)}s{r.ref_text ? ' · 已存文字' : ''}
                </span>
              </button>
            )}
            <span className="voice-acts" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="voice-act"
                disabled={disabled}
                onClick={() => togglePlay(r)}
                aria-label={playingId === r.id ? '停止试听' : '试听'}
              >
                {playingId === r.id ? <PauseIcon size={11} /> : <PlayIcon size={11} />}
              </button>
              <button
                type="button"
                className="voice-act"
                disabled={disabled}
                onClick={() => startRename(r)}
                aria-label="改名"
              >
                <PencilIcon size={11} />
              </button>
              <button
                type="button"
                className="voice-act danger"
                disabled={disabled}
                onClick={() => onDelete(r.id)}
                aria-label="删除音色"
              >
                <TrashIcon size={11} />
              </button>
            </span>
          </div>
        )
      })}
      <audio ref={audioRef} onEnded={() => setPlayingId(null)} style={{ display: 'none' }} />
    </div>
  )
}
