/** 左栏：模式切换 + 各模式专属输入 + 高级参数 */
import { useState } from 'react'
import type { RefAudio } from '../lib/api'
import { VOICE_PRESETS, presetInstruction, type VoicePreset } from '../lib/presets'
import { PersonGlyph, SparkIcon, TunerGlyph, WaveGlyph } from './icons'
import { RefAudioInput } from './RefAudioInput'
import { VoiceLibrary } from './VoiceLibrary'

export type Mode = 'preset' | 'design' | 'clone' | 'direction'

export interface GenParams {
  cfgScale: number
  temperature: number
  topP: number
  seed: string
}

interface Props {
  mode: Mode
  onMode: (m: Mode) => void
  instruct: string
  onInstruct: (v: string) => void
  refText: string
  onRefText: (v: string) => void
  refAudio: RefAudio | null
  onRefAudio: (r: RefAudio | null) => void
  savedRefs: RefAudio[]
  onSelectRef: (r: RefAudio) => void
  onRenameRef: (id: string, name: string) => void
  onDeleteRef: (id: string) => void
  presetId: string | null
  onPreset: (p: VoicePreset | null) => void
  text: string
  params: GenParams
  onParams: (p: Partial<GenParams>) => void
  disabled: boolean
  onError: (msg: string) => void
}

const MODES: {
  id: Mode
  name: string
  desc: string
  Glyph: (p: { size?: number }) => React.JSX.Element
}[] = [
  { id: 'preset', name: '预置音色', desc: '十个精选音色，直接选用', Glyph: SparkIcon },
  { id: 'design', name: '音色设计', desc: '自由描述你想要的任何声音', Glyph: WaveGlyph },
  { id: 'clone', name: '声音克隆', desc: '提供一段音频，复刻这个声音', Glyph: PersonGlyph },
  { id: 'direction', name: '语气控制', desc: '克隆声音并用指令控制语气', Glyph: TunerGlyph }
]

export function ModePanel(props: Props): React.JSX.Element {
  const {
    mode,
    onMode,
    instruct,
    onInstruct,
    refText,
    onRefText,
    refAudio,
    onRefAudio,
    savedRefs,
    onSelectRef,
    onRenameRef,
    onDeleteRef,
    presetId,
    onPreset,
    text,
    params,
    onParams,
    disabled,
    onError
  } = props
  const [advOpen, setAdvOpen] = useState(false)
  const needRef = mode === 'clone' || mode === 'direction'
  const showInstruct = mode === 'preset' || mode === 'design' || mode === 'direction'

  return (
    <>
      <section>
        <span className="label">生成模式</span>
        <div className="mode-tabs" role="radiogroup" aria-label="生成模式">
          {MODES.map(({ id, name, desc, Glyph }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={`mode-tab${mode === id ? ' active' : ''}`}
              onClick={() => onMode(id)}
            >
              <span className="mode-glyph">
                <Glyph />
              </span>
              <span>
                <span className="mode-name">{name}</span>
                <br />
                <span className="mode-desc">{desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {mode === 'preset' && (
        <section>
          <span className="label">选择音色</span>
          <div className="preset-grid" role="radiogroup" aria-label="预置音色">
            {VOICE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={presetId === p.id}
                className={`preset-cell${presetId === p.id ? ' active' : ''}`}
                onClick={() => {
                  onPreset(presetId === p.id ? null : p)
                  onInstruct(presetId === p.id ? '' : presetInstruction(p, text))
                }}
                disabled={disabled}
              >
                {p.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {showInstruct && (
        <section className="field">
          <label className="label" htmlFor="instruct">
            {mode === 'direction' ? '语气指令' : '声音描述'}
            {mode === 'preset' && presetId && '（可微调）'}
          </label>
          <textarea
            id="instruct"
            value={instruct}
            disabled={disabled}
            onChange={(e) => {
              // 手动编辑后不再绑定预置音色
              if (presetId) onPreset(null)
              onInstruct(e.target.value)
            }}
            placeholder={
              mode === 'direction'
                ? '例如：语速加快，语气兴奋，带着抑制不住的喜悦。'
                : '例如：一位温柔的年轻女性，声音清澈明亮，语速平缓，像清晨的电台主播。'
            }
            maxLength={800}
          />
        </section>
      )}

      {needRef && (
        <>
          {savedRefs.length > 0 && (
            <section className="field">
              <span className="label">我的音色（点击选用）</span>
              <VoiceLibrary
                items={savedRefs}
                selectedId={refAudio?.id ?? null}
                disabled={disabled}
                onSelect={onSelectRef}
                onRename={onRenameRef}
                onDelete={onDeleteRef}
              />
            </section>
          )}
          <section className="field">
            <span className="label">参考音频</span>
            <RefAudioInput
              refAudio={refAudio}
              onChange={onRefAudio}
              disabled={disabled}
              onError={onError}
            />
          </section>
          <section className="field">
            <label className="label" htmlFor="reftext">
              参考音频的文字
            </label>
            <textarea
              id="reftext"
              value={refText}
              disabled={disabled}
              onChange={(e) => onRefText(e.target.value)}
              placeholder="逐字写下参考音频里说的话（必须完全一致，包括语气词）"
              maxLength={2000}
            />
          </section>
        </>
      )}

      {(mode === 'preset' || mode === 'design' || mode === 'direction') && (
        <section>
          <span className="label">指令强度（cfg）</span>
          <div className="slider-row">
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={params.cfgScale}
              disabled={disabled}
              onChange={(e) => onParams({ cfgScale: Number(e.target.value) })}
              aria-label="指令强度"
            />
            <span className="val">{params.cfgScale.toFixed(1)}</span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>数值越大，声音越贴近描述</span>
        </section>
      )}

      <section>
        <button
          type="button"
          className="adv-toggle"
          onClick={() => setAdvOpen(!advOpen)}
          aria-expanded={advOpen}
        >
          {advOpen ? '收起' : '展开'}高级参数
        </button>
        {advOpen && (
          <div className="adv-body">
            <div className="slider-row">
              <div>
                <span className="label" style={{ marginBottom: 0 }}>
                  采样温度
                </span>
              </div>
              <span className="val">{params.temperature.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={params.temperature}
              disabled={disabled}
              onChange={(e) => onParams({ temperature: Number(e.target.value) })}
              aria-label="采样温度"
            />
            <div className="slider-row" style={{ marginTop: 10 }}>
              <div>
                <span className="label" style={{ marginBottom: 0 }}>
                  核采样 top_p
                </span>
              </div>
              <span className="val">{params.topP.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1}
              step={0.01}
              value={params.topP}
              disabled={disabled}
              onChange={(e) => onParams({ topP: Number(e.target.value) })}
              aria-label="top_p"
            />
            <div className="field" style={{ marginTop: 10 }}>
              <label className="label" htmlFor="seed">
                随机种子（留空则每次不同）
              </label>
              <input
                id="seed"
                type="text"
                className="mono"
                value={params.seed}
                disabled={disabled}
                onChange={(e) => onParams({ seed: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="如 42"
                maxLength={10}
              />
            </div>
          </div>
        )}
      </section>
    </>
  )
}
