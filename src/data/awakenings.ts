/**
 * v4.6 角色觉醒：战斗风格 + 专属觉醒。
 *
 * 设计口径：
 * - 每个角色 3 个风格，每个风格 2 个觉醒；层末 3/6/9 各做一次二选一。
 * - 第一次选一个觉醒（Lv1）；后续可以「深化」已有觉醒（Lv2/Lv3），
 *   也可以补拿另一个觉醒。最多同时拥有 2 个觉醒，单个最高 Lv3。
 * - 资源是战斗中的短循环：普攻/脉冲积累，满了自动强化下一发，不新增按键。
 * - 这里只放数据，具体效果在 combat.ts 中按等级读取。
 */
import type { CharacterId } from '../types'

export type StyleId =
  | 'mutsumi-solo'
  | 'mutsumi-duet'
  | 'mutsumi-requiem'
  | 'murasame-iai'
  | 'murasame-blood'
  | 'murasame-guard'
  | 'fish-school'
  | 'fish-burst'
  | 'fish-whale'

export type AwakeningId =
  | 'mutsumi-solo-resonance'
  | 'mutsumi-solo-aftertone'
  | 'mutsumi-duet-encore'
  | 'mutsumi-duet-curtain'
  | 'mutsumi-requiem-funeral'
  | 'mutsumi-requiem-echo'
  | 'murasame-iai-bleed'
  | 'murasame-iai-mind'
  | 'murasame-blood-price'
  | 'murasame-blood-lust'
  | 'murasame-guard-wall'
  | 'murasame-guard-aftershock'
  | 'fish-school-tactics'
  | 'fish-school-mark'
  | 'fish-burst-radius'
  | 'fish-burst-shield'
  | 'fish-whale-fall'
  | 'fish-whale-echo'

export interface AwakeningDef {
  id: AwakeningId
  styleId: StyleId
  name: string
  icon: string
  /** 三个等级的效果描述；0 级未拥有 */
  levels: [string, string, string]
}

export interface StyleDef {
  id: StyleId
  character: CharacterId
  name: string
  icon: string
  /** 一句话玩法定位 */
  tagline: string
  /** 完整机制说明 */
  desc: string
  /** 明确的代价 */
  tradeoff: string
  resourceName: string
  resourceMax: number
  resourceHint: string
  awakenings: [AwakeningDef, AwakeningDef]
}

const mutsumiSoloResonance: AwakeningDef = {
  id: 'mutsumi-solo-resonance',
  styleId: 'mutsumi-solo',
  name: '共鸣',
  icon: '🔔',
  levels: [
    '和弦命中后标记目标 3 秒，其受到睦的伤害 +8%。',
    '标记延长至 3.5 秒，易伤提升至 +12%。',
    '标记延长至 4 秒，易伤提升至 +18%。',
  ],
}

const mutsumiSoloAftertone: AwakeningDef = {
  id: 'mutsumi-solo-aftertone',
  styleId: 'mutsumi-solo',
  name: '余音',
  icon: '🌊',
  levels: [
    '和弦落点留下 2 秒音场，每 0.5 秒造成和弦 20% 伤害并减速 20%。',
    '音场持续 2.5 秒，每跳 30% 伤害，减速 25%。',
    '音场持续 3 秒，每跳 45% 伤害，减速 30%。',
  ],
}

const mutsumiDuetEncore: AwakeningDef = {
  id: 'mutsumi-duet-encore',
  styleId: 'mutsumi-duet',
  name: '安可',
  icon: '🎶',
  levels: [
    'Mortis 期间击杀有 25% 概率回复 8 充能并延长 0.25 秒（每次变身最多 +2 秒）。',
    '概率提升至 35%，回复 12 充能并延长 0.3 秒。',
    '概率提升至 45%，回复 16 充能并延长 0.35 秒。',
  ],
}

const mutsumiDuetCurtain: AwakeningDef = {
  id: 'mutsumi-duet-curtain',
  styleId: 'mutsumi-duet',
  name: '谢幕',
  icon: '🌙',
  levels: [
    'Mortis 结束时，每层剩余节拍回复 2% 最大生命，并让 4m 内敌人减速 30% 持续 1.5 秒。',
    '每层节拍回复 3% 最大生命，减速 35% 持续 2 秒。',
    '每层节拍回复 4% 最大生命，减速 40% 持续 2.5 秒。',
  ],
}

const mutsumiRequiemFuneral: AwakeningDef = {
  id: 'mutsumi-requiem-funeral',
  styleId: 'mutsumi-requiem',
  name: '葬送',
  icon: '💀',
  levels: [
    '和弦击杀目标时，在目标处产生 3m 爆炸，造成和弦 40% 伤害。',
    '爆炸范围 3.4m，伤害提升至 60%。',
    '爆炸范围 3.8m，伤害提升至 85%。',
  ],
}

const mutsumiRequiemEcho: AwakeningDef = {
  id: 'mutsumi-requiem-echo',
  styleId: 'mutsumi-requiem',
  name: '残响',
  icon: '🕯️',
  levels: [
    '和弦对精英/首领伤害 +15%；和弦击杀返还 2 层节拍。',
    '对精英/首领伤害 +25%；击杀返还 3 层节拍。',
    '对精英/首领伤害 +40%；击杀返还 4 层节拍并回复 8 充能。',
  ],
}

const murasameIaiBleed: AwakeningDef = {
  id: 'murasame-iai-bleed',
  styleId: 'murasame-iai',
  name: '拔刀术',
  icon: '🩸',
  levels: [
    '居合命中附加 3 秒流血，每秒造成本次攻击 18% 的伤害。',
    '流血持续 3.5 秒，每秒伤害提升至 26%。',
    '流血持续 4 秒，每秒伤害提升至 36%。',
  ],
}

const murasameIaiMind: AwakeningDef = {
  id: 'murasame-iai-mind',
  styleId: 'murasame-iai',
  name: '心眼',
  icon: '👁️',
  levels: [
    '居合命中额外获得 1 层剑意，并回复 4 充能。',
    '额外获得 1 层剑意，并回复 7 充能。',
    '额外获得 2 层剑意，并回复 10 充能。',
  ],
}

const murasameBloodPrice: AwakeningDef = {
  id: 'murasame-blood-price',
  styleId: 'murasame-blood',
  name: '血偿',
  icon: '❤️‍🔥',
  levels: [
    '吸血额外 +3%；生命低于 40% 时伤害 +8%。',
    '吸血额外 +5%；生命低于 40% 时伤害 +12%。',
    '吸血额外 +8%；生命低于 40% 时伤害 +18%。',
  ],
}

const murasameBloodLust: AwakeningDef = {
  id: 'murasame-blood-lust',
  styleId: 'murasame-blood',
  name: '狂血',
  icon: '🔥',
  levels: [
    '击杀回复 1.5% 最大生命，并获得 1 层剑意（0.4 秒冷却）。',
    '击杀回复 2.5% 最大生命，并获得 1 层剑意。',
    '击杀回复 4% 最大生命，获得 1 层剑意并回复 5 充能。',
  ],
}

const murasameGuardWall: AwakeningDef = {
  id: 'murasame-guard-wall',
  styleId: 'murasame-guard',
  name: '铁壁',
  icon: '🛡️',
  levels: [
    '突进护盾额外 +6% 最大生命，护盾持续 +1 秒。',
    '突进护盾额外 +10% 最大生命，护盾持续 +1.5 秒。',
    '突进护盾额外 +15% 最大生命，护盾持续 +2 秒。',
  ],
}

const murasameGuardAftershock: AwakeningDef = {
  id: 'murasame-guard-aftershock',
  styleId: 'murasame-guard',
  name: '余震',
  icon: '💥',
  levels: [
    '突进落点产生 3m 冲击波，造成本次突进 40% 伤害。',
    '冲击波范围 3.4m，伤害提升至 60%。',
    '冲击波范围 3.8m，伤害提升至 85%，并击退敌人。',
  ],
}

const fishSchoolTactics: AwakeningDef = {
  id: 'fish-school-tactics',
  styleId: 'fish-school',
  name: '鱼群战术',
  icon: '🐟',
  levels: [
    '召唤物集火你最近命中的目标，攻击速度 +5%。',
    '集火目标不变，召唤物攻击速度 +10%。',
    '召唤物攻击速度 +15%，并且召唤数量 +1。',
  ],
}

const fishSchoolMark: AwakeningDef = {
  id: 'fish-school-mark',
  styleId: 'fish-school',
  name: '泡沫标记',
  icon: '🫧',
  levels: [
    '普攻命中标记目标 3 秒，其受到的所有伤害 +8%。',
    '标记持续 3.5 秒，易伤提升至 +12%。',
    '标记持续 4 秒，易伤提升至 +18%。',
  ],
}

const fishBurstRadius: AwakeningDef = {
  id: 'fish-burst-radius',
  styleId: 'fish-burst',
  name: '爆裂强化',
  icon: '🧨',
  levels: [
    '大泡泡爆炸范围 +15%，爆炸伤害 +10%。',
    '大泡泡爆炸范围 +25%，爆炸伤害 +20%。',
    '大泡泡爆炸范围 +40%，爆炸伤害 +35%。',
  ],
}

const fishBurstShield: AwakeningDef = {
  id: 'fish-burst-shield',
  styleId: 'fish-burst',
  name: '泡沫护盾',
  icon: '🫧',
  levels: [
    '大泡泡命中时获得 5% 最大生命护盾，持续 4 秒。',
    '护盾提升至 8% 最大生命，持续 4.5 秒。',
    '护盾提升至 12% 最大生命，持续 5 秒。',
  ],
}

const fishWhaleFall: AwakeningDef = {
  id: 'fish-whale-fall',
  styleId: 'fish-whale',
  name: '鲸落',
  icon: '🐋',
  levels: [
    '召唤物消失爆炸伤害 +40%，范围 +0.8m。',
    '爆炸伤害 +70%，范围 +1.2m。',
    '爆炸伤害 +110%，范围 +1.6m。',
  ],
}

const fishWhaleEcho: AwakeningDef = {
  id: 'fish-whale-echo',
  styleId: 'fish-whale',
  name: '深海回响',
  icon: '🌊',
  levels: [
    '召唤物消失时回复 1.5% 最大生命，并回复 5 充能。',
    '回复 2.5% 最大生命，并回复 8 充能。',
    '回复 4% 最大生命，并回复 12 充能。',
  ],
}

export const STYLES: Record<StyleId, StyleDef> = {
  'mutsumi-solo': {
    id: 'mutsumi-solo',
    character: 'mutsumi',
    name: '独奏',
    icon: '🎻',
    tagline: '单体叠奏 · 越打越痛',
    desc: '同一目标连续命中时，每次 +6% 伤害，最多 +30%；切换目标清空。和弦拥有 3 次穿透。',
    tradeoff: 'Mortis 变身时间 -2 秒。',
    resourceName: '节拍',
    resourceMax: 4,
    resourceHint: '普攻命中 +1；满 4 层后下一发普攻/脉冲变为穿透和弦。',
    awakenings: [mutsumiSoloResonance, mutsumiSoloAftertone],
  },
  'mutsumi-duet': {
    id: 'mutsumi-duet',
    character: 'mutsumi',
    name: '双重人格',
    icon: '🎭',
    tagline: '变身特化 · 节拍翻倍',
    desc: 'Mortis 期间节拍获取翻倍，脉冲更快打出和弦；击杀可延长变身。',
    tradeoff: '非变身期普攻伤害 -10%。',
    resourceName: '节拍',
    resourceMax: 4,
    resourceHint: '变身期每次脉冲命中 +2 节拍；满 4 层后下一次脉冲变为大范围和弦。',
    awakenings: [mutsumiDuetEncore, mutsumiDuetCurtain],
  },
  'mutsumi-requiem': {
    id: 'mutsumi-requiem',
    character: 'mutsumi',
    name: '安魂曲',
    icon: '🕯️',
    tagline: '六拍大和弦 · 慢而重',
    desc: '节拍上限提高到 6；和弦伤害 +120%、范围 +40%，穿透 5 个目标。',
    tradeoff: '普攻间隔 +10%。',
    resourceName: '节拍',
    resourceMax: 6,
    resourceHint: '普攻/脉冲命中 +1；满 6 层后下一发变为超强和弦。',
    awakenings: [mutsumiRequiemFuneral, mutsumiRequiemEcho],
  },
  'murasame-iai': {
    id: 'murasame-iai',
    character: 'murasame',
    name: '居合',
    icon: '🌸',
    tagline: '第三刀 · 长线拔刀',
    desc: '每第 3 次普攻变为 6m 直线居合，伤害 +40%，可命中路径上的多个敌人。',
    tradeoff: '普通拔刀范围 -10%。',
    resourceName: '剑意',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一次突进变为燕返，范围与伤害提升。',
    awakenings: [murasameIaiBleed, murasameIaiMind],
  },
  'murasame-blood': {
    id: 'murasame-blood',
    character: 'murasame',
    name: '血刃',
    icon: '🩸',
    tagline: '以血换血 · 残血爆发',
    desc: '造成伤害吸血 6%；生命越低伤害越高，最多 +20%。',
    tradeoff: '最大生命 -10%。',
    resourceName: '剑意',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一次突进变为燕返。',
    awakenings: [murasameBloodPrice, murasameBloodLust],
  },
  'murasame-guard': {
    id: 'murasame-guard',
    character: 'murasame',
    name: '守护',
    icon: '🛡️',
    tagline: '突进护盾 · 稳中求胜',
    desc: '突进获得 12% 最大生命护盾，持续 4 秒；受到伤害 -10%。',
    tradeoff: '普攻间隔 +8%。',
    resourceName: '剑意',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一次突进变为燕返。',
    awakenings: [murasameGuardWall, murasameGuardAftershock],
  },
  'fish-school': {
    id: 'fish-school',
    character: 'fish',
    name: '鱼群',
    icon: '🐟',
    tagline: '多召一只 · 集火标记',
    desc: '召唤物 +1，并集火你最近命中的目标。',
    tradeoff: '召唤物生命 -15%。',
    resourceName: '泡泡',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一发泡泡变为大泡泡，命中爆炸。',
    awakenings: [fishSchoolTactics, fishSchoolMark],
  },
  'fish-burst': {
    id: 'fish-burst',
    character: 'fish',
    name: '爆破',
    icon: '💥',
    tagline: '大泡爆炸 · 清群特化',
    desc: '大泡泡爆炸范围 +30%，爆炸对周围敌人造成范围伤害。',
    tradeoff: '召唤物数量 -1。',
    resourceName: '泡泡',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一发泡泡变为大泡泡。',
    awakenings: [fishBurstRadius, fishBurstShield],
  },
  'fish-whale': {
    id: 'fish-whale',
    character: 'fish',
    name: '鲸落',
    icon: '🐋',
    tagline: '巨型召唤 · 消失爆炸',
    desc: '召唤物生命 +30%、伤害 +20%；消失时爆炸并回复少量生命。',
    tradeoff: '召唤物数量 -1。',
    resourceName: '泡泡',
    resourceMax: 3,
    resourceHint: '普攻命中 +1；满 3 层后下一发泡泡变为大泡泡。',
    awakenings: [fishWhaleFall, fishWhaleEcho],
  },
}

export const STYLES_BY_CHARACTER: Record<CharacterId, StyleDef[]> = {
  mutsumi: [STYLES['mutsumi-solo'], STYLES['mutsumi-duet'], STYLES['mutsumi-requiem']],
  murasame: [STYLES['murasame-iai'], STYLES['murasame-blood'], STYLES['murasame-guard']],
  fish: [STYLES['fish-school'], STYLES['fish-burst'], STYLES['fish-whale']],
}

export const AWAKENINGS: Record<AwakeningId, AwakeningDef> = Object.values(STYLES).reduce(
  (acc, style) => {
    for (const awakening of style.awakenings) acc[awakening.id] = awakening
    return acc
  },
  {} as Record<AwakeningId, AwakeningDef>,
)

export function defaultStyle(character: CharacterId): StyleDef {
  return STYLES_BY_CHARACTER[character][0] ?? STYLES['mutsumi-solo']
}

export function styleForCharacter(character: CharacterId, styleId: string | undefined): StyleDef {
  const found = STYLES_BY_CHARACTER[character].find((style) => style.id === styleId)
  return found ?? defaultStyle(character)
}

export function awakeningLevel(map: Partial<Record<AwakeningId, number>> | undefined, id: AwakeningId): number {
  const raw = map?.[id] ?? 0
  return Number.isFinite(raw) ? Math.max(0, Math.min(3, Math.round(raw))) : 0
}

export function normalizeAwakenings(
  styleId: StyleId,
  raw: unknown,
): Partial<Record<AwakeningId, number>> {
  const style = STYLES[styleId]
  if (!style || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const next: Partial<Record<AwakeningId, number>> = {}
  for (const awakening of style.awakenings) {
    const level = source[awakening.id]
    if (typeof level !== 'number' || !Number.isFinite(level)) continue
    const clamped = Math.max(1, Math.min(3, Math.round(level)))
    next[awakening.id] = clamped
  }
  return next
}

export function normalizeAwakeningLayers(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  const valid = new Set([3, 6, 9])
  return [...new Set(raw.filter((n): n is number => typeof n === 'number' && valid.has(n)))].sort((a, b) => a - b)
}
