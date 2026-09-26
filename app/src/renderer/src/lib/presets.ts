/** 预置音色：经由官方支持的 Voice Design 路径实现。
 *
 * 说明：Breeze TTS 2 官方只提供三种范式——声音克隆、音色设计、语气控制，
 * 并没有可直接点选的预置说话人。模型词表里虽存在 [S0]–[S9] 占位 token
 * （架构继承自 Qwen3-TTS 一类骨干），但未经训练、无说话人条件时输出会漂移。
 * 因此这里的"预置音色"是十个精心调校的声音描述，指令语言与文本语言保持一致。
 */

export interface VoicePreset {
  id: string
  name: string
  zh: string
  en: string
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'gentle_f',
    name: '温柔女声',
    zh: '一位温柔的年轻女性，声音清澈柔和，语速平缓，语气亲切自然，像在耳边轻声说话。',
    en: 'A gentle young woman with a clear, soft voice, speaking slowly and warmly.'
  },
  {
    id: 'wise_f',
    name: '知性女声',
    zh: '一位成熟知性的女性，声音沉稳清晰，语调平和从容，有书卷气。',
    en: 'A mature, intellectual woman with a calm, clear and composed voice.'
  },
  {
    id: 'lively_f',
    name: '活泼少女',
    zh: '一位年轻女孩，声音明亮清脆，语速偏快，充满元气和活力。',
    en: 'A young girl with a bright, crisp and energetic voice, speaking fairly fast.'
  },
  {
    id: 'steady_m',
    name: '沉稳男声',
    zh: '一位成熟男性，声音低沉浑厚，字正腔圆，语速稳健有力。',
    en: 'A mature man with a deep, rich and steady voice, speaking clearly and firmly.'
  },
  {
    id: 'magnetic_m',
    name: '磁性男声',
    zh: '一位中年男性，声音醇厚有磁性，娓娓道来，节奏舒缓。',
    en: 'A middle-aged man with a deep, magnetic and mellow voice, speaking slowly.'
  },
  {
    id: 'news',
    name: '新闻播报',
    zh: '一位专业的新闻播音员，发音标准清晰，语调平稳有力，节奏规整。',
    en: 'A professional news anchor with precise pronunciation and a steady, authoritative delivery.'
  },
  {
    id: 'docu',
    name: '纪录片旁白',
    zh: '一位纪录片解说员，声音沉稳大气，节奏舒缓，富有画面感和叙事感。',
    en: 'A documentary narrator with a deep, composed voice and a slow, evocative delivery.'
  },
  {
    id: 'kids',
    name: '儿童故事',
    zh: '一位给孩子讲故事的温柔声音，语气生动亲切，节奏轻快，富有表情。',
    en: 'A warm storyteller for children, expressive and lively, with a gentle tone.'
  },
  {
    id: 'night_radio',
    name: '深夜电台',
    zh: '一位深夜电台主持人，声音温柔低缓，气息柔和，贴近耳边。',
    en: 'A late-night radio host with a soft, low and intimate voice, speaking slowly.'
  },
  {
    id: 'ad',
    name: '广告活力',
    zh: '一位广告配音员，年轻有活力，语调上扬，节奏明快，充满感染力。',
    en: 'An energetic young advertising voice actor with an upbeat, bright delivery.'
  }
]

/** 文本以中文为主时用中文指令（官方建议指令语言与文本语言一致） */
export function isMostlyChinese(text: string): boolean {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (cjk === 0) return false
  return cjk >= latin
}

export function presetInstruction(preset: VoicePreset, text: string): string {
  return isMostlyChinese(text) ? preset.zh : preset.en
}
