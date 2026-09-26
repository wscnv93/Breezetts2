/** 波形画布：静态峰值图（历史/参考）与实时跟随播放器的活动波形 */
import { useEffect, useRef } from 'react'
import type { StreamPlayer } from '../lib/player'

const BAR_W = 2
const GAP = 2

function drawPeaks(
  ctx: CanvasRenderingContext2D,
  peaks: number[],
  progress: number,
  live: boolean,
  playing: boolean,
  dpr: number,
  generating = false
): void {
  const { width, height } = ctx.canvas
  ctx.clearRect(0, 0, width, height)
  const n = peaks.length
  if (n === 0) return
  const step = (BAR_W + GAP) * dpr
  const bars = Math.max(1, Math.floor(width / step))
  const mid = height / 2
  const playedX = progress * width

  for (let i = 0; i < bars; i++) {
    // 均匀取样
    const idx = Math.floor((i / bars) * n)
    const h = Math.max(2 * dpr, peaks[idx] * (height * 0.86))
    const x = i * step + BAR_W * dpr * 0.5
    if (generating) {
      // 生成中：浅琥珀，提示"声音正在生长"，等待用户点播
      ctx.strokeStyle = 'rgba(229, 165, 75, 0.55)'
    } else if (x <= playedX) {
      // 已播过：琥珀（声音的颜色）
      const t = playedX <= 0 ? 0 : Math.min(1, x / Math.max(playedX, 1))
      const r = Math.round(229 + (217 - 229) * t)
      const g = Math.round(165 + (108 - 165) * t)
      const b = Math.round(75 + (58 - 75) * t)
      ctx.strokeStyle = `rgb(${r},${g},${b})`
    } else {
      ctx.strokeStyle = live && playing ? '#b9ccc5' : '#c9d8d2'
    }
    ctx.lineWidth = BAR_W * dpr
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x, mid - h / 2)
    ctx.lineTo(x, mid + h / 2)
    ctx.stroke()
  }

  // 播放中：前沿一道琥珀光标
  if (live && playing && progress > 0 && progress < 1) {
    ctx.fillStyle = 'rgba(217, 108, 58, 0.9)'
    ctx.fillRect(playedX - dpr, height * 0.08, 2 * dpr, height * 0.84)
  }
}

interface StaticWaveProps {
  peaks: number[]
  progress?: number
  height?: number
}

/** 静态波形（历史条目、参考音频预览） */
export function StaticWave({ peaks, progress = 1, height = 26 }: StaticWaveProps): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cvs = ref.current
    if (!cvs) return
    const dpr = window.devicePixelRatio || 1
    const w = cvs.clientWidth
    cvs.width = w * dpr
    cvs.height = height * dpr
    const ctx = cvs.getContext('2d')
    if (ctx) drawPeaks(ctx, peaks, progress, false, false, dpr)
  }, [peaks, progress, height])
  return <canvas ref={ref} style={{ height }} />
}

interface LiveWaveProps {
  player: StreamPlayer | null
  active: boolean
  generating?: boolean
  height?: number
}

/** 实时波形：跟随流式播放器，rAF 驱动 */
export function LiveWave({ player, active, generating = false, height = 72 }: LiveWaveProps): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const genRef = useRef(generating)
  genRef.current = generating

  useEffect(() => {
    if (!player || !active) return
    let raf = 0
    const render = (): void => {
      const cvs = ref.current
      if (cvs) {
        const dpr = window.devicePixelRatio || 1
        const w = cvs.clientWidth
        if (cvs.width !== w * dpr || cvs.height !== height * dpr) {
          cvs.width = w * dpr
          cvs.height = height * dpr
        }
        const ctx = cvs.getContext('2d')
        if (ctx) {
          const dur = player.duration
          const pos = player.position
          const peaks = player.peaks(600)
          drawPeaks(
            ctx,
            peaks,
            dur > 0 ? Math.min(1, pos / dur) : 0,
            true,
            player.playing,
            dpr,
            genRef.current
          )
        }
      }
      raf = requestAnimationFrame(render)
    }
    raf = requestAnimationFrame(render)
    return () => {
      cancelAnimationFrame(raf)
    }
  }, [player, active, height])

  return <canvas ref={ref} className="wave-canvas" style={{ height }} />
}
