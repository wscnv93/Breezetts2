/** 右栏历史：条目回放（点击播/停）、下载、删除 */
import { deleteHistory, historyAudioUrl, type HistoryEntry } from '../lib/api'
import { VOICE_PRESETS } from '../lib/presets'
import { StaticWave } from './Waveform'

const MODE_NAME: Record<HistoryEntry['mode'], string> = {
  design: '设计',
  clone: '克隆',
  direction: '语气',
  builtin: '内置',
  tts: '内置'
}

/** 有预置音色标签时优先显示音色名 */
function tagOf(e: HistoryEntry): string {
  const preset = VOICE_PRESETS.find((p) => p.id === e.preset)
  if (preset) return preset.name
  return MODE_NAME[e.mode]
}

interface Props {
  items: HistoryEntry[]
  playingId: string | null
  onPlay: (e: HistoryEntry) => void
  onDelete: (id: string) => void
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}

export function HistoryList({ items, playingId, onPlay, onDelete }: Props): React.JSX.Element {
  return (
    <div className="history-list">
      {items.length === 0 && (
        <div className="empty-hint">
          还没有生成记录
          <br />
          在左侧选好模式，写下文字，按下生成
        </div>
      )}
      {items.map((e) => (
        <div key={e.id} className="history-item">
          <div className="row1">
            <span className={`mode-tag${e.partial ? ' partial' : ''}`}>
              {tagOf(e)}
              {e.partial ? '·中断' : ''}
            </span>
            <span className="dur">{e.duration.toFixed(1)}s</span>
            <span style={{ flex: 1 }} />
            <span className="when">{timeAgo(e.created_at)}</span>
          </div>
          <div className="text">{e.text}</div>
          <StaticWave peaks={e.peaks} progress={playingId === e.id ? 1 : 1} />
          <div className="row3">
            <button type="button" className="mini-btn" onClick={() => onPlay(e)}>
              {playingId === e.id ? '停止' : '播放'}
            </button>
            <a
              className="mini-btn"
              style={{ textDecoration: 'none', display: 'inline-block' }}
              href={historyAudioUrl(e)}
              download={e.file}
            >
              下载
            </a>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className="mini-btn danger"
              onClick={() => {
                void deleteHistory(e.id).then(() => onDelete(e.id))
              }}
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
