/** 底部流式播放器：实时波形 + 播放控制 + 导出 */
import { useEffect, useState } from 'react'
import type { StreamPlayer } from '../lib/player'
import { DownloadIcon, PauseIcon, PlayIcon } from './icons'
import { LiveWave } from './Waveform'

interface Props {
  player: StreamPlayer
  active: boolean
  hasAudio: boolean
  generating: boolean
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function WavePlayer({ player, active, hasAudio, generating }: Props): React.JSX.Element {
  const [, tick] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => {
      tick((n) => n + 1)
      setPlaying(player.playing)
    }, 150)
    return () => window.clearInterval(t)
  }, [player, active])

  const toggle = (): void => {
    if (player.playing) {
      player.pause()
      setPlaying(false)
    } else if (player.started && player.position < player.duration - 0.05) {
      // 中途暂停过：从暂停处继续
      player.resume()
      setPlaying(true)
    } else {
      // 首次播放或播完：从头（或重）播
      player.replay()
      setPlaying(true)
    }
  }

  const download = (): void => {
    const url = URL.createObjectURL(player.exportWav())
    const a = document.createElement('a')
    a.href = url
    a.download = `微风之声-${new Date().toISOString().slice(11, 19).replaceAll(':', '')}.wav`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="wave-panel">
      <LiveWave player={player} active={active} generating={generating} />
      <div className="wave-controls">
        <button
          type="button"
          className="wave-btn"
          onClick={toggle}
          disabled={!hasAudio || generating}
          aria-label={playing ? '暂停' : '播放'}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className="wave-time">
          {fmt(player.position)} / {fmt(player.duration)}
        </span>
        <span className="wave-spacer" />
        <button
          type="button"
          className="wave-download"
          onClick={download}
          disabled={!hasAudio}
        >
          <DownloadIcon /> 保存 WAV
        </button>
      </div>
    </div>
  )
}
