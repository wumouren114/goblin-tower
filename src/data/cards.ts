/**
 * 数值道具卡（原「增益卡」）数据表 —— 落地版 v0（只有数据，未接入商店/背包）。
 *
 * 口径（与现版本最大的差别）：
 * - **一张卡 = 一个名字 + 3 个档位（蓝 / 紫 / 金）**，不再是"同名可叠 N 张 + 二合一"。
 * - 背包内同名卡**只有一张实例**；再拿到同名卡 = 原地升一档。
 * - 池子里永远只出"比当前持有高一档"的那一档；满金后该名字**退出池子**。
 * - 因此卡池会随局内进度自我收窄，天然堵死"堆同一张"。
 * - 出档概率按层数升高，允许跳级（+2 档），但跳级概率要压低。
 *
 * 分工：**道具 = 纯数值，机制全在潜能**。所以这里只有 `stat + tiers`，没有 trigger/condition。
 * 旧 `balance.json` 的 `buffCards`（含 maxStacks）在新系统接入后整体作废。
 */
import type { CardStat } from '../types'

/**
 * 卡的属性键。`hpRegen` 是本次新增的键，尚未并入 `CardStat`——
 * 并入需要同时改 6 处 `Record<CardStat, …>` 字面量和存档校验，
 * 等潜能/道具真正接入战斗时一起做，避免这一版把老存档打挂。
 */
export type ItemCardStat = CardStat | 'hpRegen'

export type CardTier = 'blue' | 'purple' | 'gold'

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

/** 每张卡的可获取档位数量（= 该名字最多被拿到几次） */
export const CARD_MAX_TIER = CARD_TIERS.length

export function cardOf(id: string): ItemCardDef | undefined {
  return ITEM_CARDS.find((c) => c.id === id)
}

/** 取某档数值；tier 越界时收敛到合法范围 */
export function cardValueAt(card: ItemCardDef, tier: CardTier): number {
  const index = Math.max(0, CARD_TIERS.indexOf(tier))
  const value = card.tiers[Math.min(CARD_TIERS.length - 1, index)]
  return typeof card.cap === 'number' ? Math.min(card.cap, value) : value
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
