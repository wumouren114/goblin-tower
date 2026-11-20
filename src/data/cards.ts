/**
 * 数值道具卡（原「增益卡」）数据表 —— P0-a 落地版（已接入商店 / 背包 / 商人交换）。
 *
 * 口径（与旧版本最大的差别）：
 * - **一张卡 = 一个名字 + 3 个档位（蓝 / 紫 / 金）**，不再是"同名可叠 N 张 + 二合一"。
 * - 背包内同名卡**只有一张实例**；再拿到同名卡 = 原地升一档。
 * - 池子里永远只出"比当前持有高一档"的那一档；满金后该名字**退出池子**。
 * - 因此卡池会随局内进度自我收窄，天然堵死"堆同一张"。
 * - 出档概率按层数升高，允许跳级（+2 档），但跳级概率要压低。
 *
 * 分工：**道具 = 纯数值，机制全在潜能**。所以这里只有 `stat + tiers`，没有 trigger/condition。
 */
import type { CardStat } from '../types'

/**
 * 卡的属性键。`hpRegen` 是本次新增的键，尚未并入 `CardStat`——
 * 并入需要同时改 6 处 `Record<CardStat, …>` 字面量和存档校验，
 * 等潜能/道具真正接入战斗时一起做，避免这一版把老存档打挂。
 */
export type ItemCardStat = CardStat | 'hpRegen'

export type CardTier = 'blue' | 'purple' | 'gold'

export type CardTierNum = 1 | 2 | 3

export const CARD_TIERS: readonly CardTier[] = ['blue', 'purple', 'gold']

export const CARD_TIER_LABEL: Record<CardTier, string> = {
  blue: '蓝',
  purple: '紫',
  gold: '金',
}

export interface ItemCardDef {
  id: string
  name: string
  stat: ItemCardStat
  /** 蓝 / 紫 / 金 三档数值。percent 用百分点存（18 = 18%），flat 存原值 */
  tiers: readonly [number, number, number]
  format: 'percent' | 'flat'
  /** 数值上限（percent 类），超出部分不生效 */
  cap?: number
  /** 词条模板，`{v}` 替换为当前档位数值 */
  text: string
  /** 补充说明（界面小字） */
  note?: string
}

export const ITEM_CARDS: readonly ItemCardDef[] = [
  { id: 'magic', name: '魔力药剂', stat: 'magic', tiers: [18, 36, 66], format: 'percent', text: '伤害 +{v}%' },
  { id: 'stamina', name: '耐力药剂', stat: 'stamina', tiers: [16, 32, 58], format: 'flat', text: '攻速 +{v}' },
  { id: 'intelligence', name: '智力药剂', stat: 'intelligence', tiers: [12, 24, 44], format: 'percent', text: '范围 +{v}%' },
  { id: 'hp', name: '生命结晶', stat: 'hp', tiers: [25, 50, 90], format: 'flat', text: '生命上限 +{v}' },
  { id: 'moveSpeed', name: '疾风之靴', stat: 'moveSpeed', tiers: [0.25, 0.5, 0.9], format: 'flat', text: '移速 +{v}' },
  {
    id: 'armor',
    name: '铁鳞甲片',
    stat: 'armor',
    tiers: [5, 10, 18],
    format: 'percent',
    cap: 35,
    text: '受到伤害 −{v}%',
    note: '上限 35%',
  },
  {
    id: 'dodge',
    name: '疾影护符',
    stat: 'dodge',
    tiers: [6, 12, 22],
    format: 'percent',
    cap: 40,
    text: '闪避率 +{v}%',
    note: '上限 40%',
  },
  { id: 'chargeGain', name: '猎手徽记', stat: 'chargeGain', tiers: [8, 16, 30], format: 'percent', text: '击杀获得充能 +{v}%' },
  {
    id: 'crit',
    name: '锐利符石',
    stat: 'crit',
    tiers: [4, 8, 15],
    format: 'percent',
    cap: 60,
    text: '暴击率 +{v}%',
    note: '基础 8%，暴击伤害固定 ×2.0',
  },
  {
    id: 'hpRegen',
    name: '生命之源',
    stat: 'hpRegen',
    tiers: [2.5, 5, 9],
    format: 'percent',
    text: '每 5 秒回复 {v}% 最大生命',
  },
]

/** 各卡商店蓝卡基准价（与 balance.json.buffCards 对齐） */
export const CARD_BASE_PRICE: Record<string, number> = {
  magic: 55,
  stamina: 50,
  intelligence: 40,
  hp: 45,
  moveSpeed: 40,
  armor: 55,
  dodge: 60,
  chargeGain: 45,
  crit: 60,
  hpRegen: 50,
}

/** 面板/战斗口径中以 0..1 小数存储的百分比属性（magic/intelligence 以 100 基准整数存） */
const RATIO_STATS: ReadonlySet<ItemCardStat> = new Set([
  'armor',
  'dodge',
  'chargeGain',
  'crit',
  'hpRegen',
])

const CARD_STAT_SET: ReadonlySet<string> = new Set<CardStat>([
  'magic',
  'stamina',
  'intelligence',
  'hp',
  'moveSpeed',
  'chargeMax',
  'chargeGain',
  'dodge',
  'armor',
  'crit',
])

const LEGACY_ID_ALIAS: Record<string, string> = {
  critRate: 'crit',
}

const TIER_NAME_PREFIX = /^(?:蓝·|紫·|金·|精制|臻品)/

/** 每张卡的可获取档位数量（= 该名字最多被拿到几次） */
export const CARD_MAX_TIER = CARD_TIERS.length

export function tierFromNum(tier: number): CardTier {
  if (tier >= 3) return 'gold'
  if (tier === 2) return 'purple'
  return 'blue'
}

export function tierToNum(tier: CardTier): CardTierNum {
  if (tier === 'gold') return 3
  if (tier === 'purple') return 2
  return 1
}

/** 数字档位的下一档（0→1, 1→2, 2→3, >=3→null） */
export function nextTierNum(tier: number): CardTierNum | null {
  if (tier <= 0) return 1
  if (tier === 1) return 2
  if (tier === 2) return 3
  return null
}

export function isCardStat(stat: ItemCardStat): stat is CardStat {
  return CARD_STAT_SET.has(stat)
}

export function cardOf(id: string): ItemCardDef | undefined {
  return ITEM_CARDS.find((c) => c.id === id)
}

/** 按 id / stat / 旧别名 / 带档位前缀的卡名解析标准卡定义 */
export function resolveCardDef(key: string): ItemCardDef | undefined {
  if (!key) return undefined
  const aliased = LEGACY_ID_ALIAS[key] ?? key
  const byId = ITEM_CARDS.find((c) => c.id === aliased || c.stat === aliased)
  if (byId) return byId
  const stripped = aliased.replace(TIER_NAME_PREFIX, '').trim()
  return ITEM_CARDS.find((c) => c.name === stripped || c.id === stripped)
}

/** 从背包物品反查标准卡 id（同名唯一 / 商店池过滤 / 商人交换共用） */
export function cardIdOfItem(item: { kind?: string; stat?: string; name?: string }): string | null {
  if (item.kind && item.kind !== 'buff-card') return null
  if (item.stat) {
    const byStat = resolveCardDef(item.stat)
    if (byStat) return byStat.id
  }
  if (item.name) {
    const byName = resolveCardDef(item.name)
    if (byName) return byName.id
  }
  return null
}

/** 取某档展示数值（纯由 tier 推导，不乘任何倍率）；tier 越界时收敛到合法范围 */
export function cardValueAt(card: ItemCardDef, tier: CardTier): number {
  const index = Math.max(0, CARD_TIERS.indexOf(tier))
  const value = card.tiers[Math.min(CARD_TIERS.length - 1, index)]
  return typeof card.cap === 'number' ? Math.min(card.cap, value) : value
}

/** 取某档运行时数值（纯由 tier 推导：比例类属性转为 0..1 小数，其余返回原值） */
export function cardRuntimeValueAt(card: ItemCardDef, tier: CardTier | CardTierNum): number {
  const cardTier: CardTier = typeof tier === 'number' ? tierFromNum(tier) : tier
  const raw = cardValueAt(card, cardTier)
  return RATIO_STATS.has(card.stat) ? Number((raw / 100).toFixed(4)) : raw
}

export function cardBasePrice(card: ItemCardDef): number {
  return CARD_BASE_PRICE[card.id] ?? 50
}

/** 生成带数值的词条文案 */
export function cardTextAt(card: ItemCardDef, tier: CardTier): string {
  return card.text.replace('{v}', String(cardValueAt(card, tier)))
}

/** 下一档；已是金卡返回 null（该名字应退出池子） */
export function nextTier(tier: CardTier): CardTier | null {
  const index = CARD_TIERS.indexOf(tier)
  return index >= 0 && index < CARD_TIERS.length - 1 ? CARD_TIERS[index + 1] : null
}
