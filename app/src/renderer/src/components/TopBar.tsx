/** 顶栏：标识 + 引擎状态 + 服务地址 + 设置入口 */
import type { EngineStatus } from '../lib/api'
import { GearIcon } from './icons'

interface Props {
  engine: EngineStatus | null
  online: boolean
  base: string
  onOpenSettings: () => void
}

const STATE_TEXT: Record<EngineStatus['state'], string> = {
  not_loaded: '模型未加载',
  loading: '模型加载中',
  ready: '模型就绪',
  error: '模型异常'
}

export function TopBar({ engine, online, base, onOpenSettings }: Props): React.JSX.Element {
  const state = !online ? 'loading' : (engine?.state ?? 'loading')
  const text = !online ? '连接服务中' : STATE_TEXT[engine?.state ?? 'loading']
  return (
    <header className="topbar">
      <div className="wordmark">
        <span className="cn">微风之声</span>
        <span className="en">BREEZE&nbsp;VOICE</span>
      </div>
      <div className="spacer" />
      <div className="engine-status" title={engine?.error ?? undefined}>
        <span className={`status-dot ${state}`} />
        <span>{text}</span>
        {engine?.state === 'ready' && (
          <span className="mono" style={{ color: 'var(--ink-faint)' }}>
            24kHz
          </span>
        )}
      </div>
      <span className="mono" style={{ fontSize: 10.5, color: 'var(--ink-faint)' }}>
        {base.replace('http://', '')}
      </span>
      <button
        type="button"
        className="topbar-btn"
        onClick={onOpenSettings}
        aria-label="设置"
        title="设置（模型路径 / 下载）"
      >
        <GearIcon />
      </button>
    </header>
  )
}
