/** 中央文本编辑器 + 事件标记快捷插入 */
import { useRef } from 'react'

/** 模型支持的内联事件标记：中文方括号 / 英文圆括号 */
const MARKS = ['[笑]', '[叹气]', '(laugh)', '(sigh)', '(cough)']

interface Props {
  value: string
  onChange: (v: string) => void
  disabled: boolean
}

export function Editor({ value, onChange, disabled }: Props): React.JSX.Element {
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const insertMark = (mark: string): void => {
    const el = areaRef.current
    if (!el || disabled) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = value.slice(0, start) + mark + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + mark.length
      el.setSelectionRange(pos, pos)
    })
  }

  const count = value.length

  return (
    <div className="editor-wrap">
      <textarea
        ref={areaRef}
        className="editor"
        value={value}
        disabled={disabled}
        placeholder={'输入要变成声音的文字…\n例如：今天的风很温柔，适合把这句话读给你听。'}
        onChange={(e) => onChange(e.target.value)}
        maxLength={5000}
        spellCheck={false}
      />
      <div className="chip-row">
        <span className="hint">插入情感标记</span>
        {MARKS.map((m) => (
          <button key={m} type="button" className="chip mono" onClick={() => insertMark(m)} disabled={disabled}>
            {m}
          </button>
        ))}
        <span className="hint" style={{ marginLeft: 'auto' }}>
          {count}/5000
        </span>
      </div>
    </div>
  )
}
