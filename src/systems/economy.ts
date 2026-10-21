/**
 * 经济纯数据层（v3）：击杀/通关金币、品质与定价、背包物品生成、五维汇总。
 * 不 import three.js、不碰 DOM；所有随机数走传入的 Rng（可复现）。
 * 数值只从 balance.json（经 balance.ts 访问器）与 characters.ts 读。
 */
import type { CardStat, CharacterId, DifficultyId, InventoryItem } from '../types'
import type { Rng } from '../core/rng'
import type { QualityRoll } from '../data/balance'
import { BALANCE, clearGoldFor, goldPerKillFor, rollQuality, shopPriceFor } from '../data/balance'
import { CHARACTERS, GOLD_PER_KILL } from '../data/characters'

// ── balance.json 里 balance.ts 尚未声明类型的段落（本模块只读，不改数据）──
interface BuffCardDef {
  id: string
  name: string
  stat: CardStat
  value: number
  basePrice: number
  maxStacks: number
  desc: string
}

interface QualityCfg {
  tier2: { valueMul: number; priceMul: number; name: string }
  tier3: { valueMul: number; priceMul: number; name: string }
}

interface EconomyData {
  buffCards: BuffCardDef[]
  shop: { quality: QualityCfg; slots: number; priceGrowthPerLayer: number }
}

const DATA = BALANCE as unknown as EconomyData
const BUFF_CARDS = DATA.buffCards
const QUALITY = DATA.shop.quality

const CARD_ICONS: Record<CardStat, string> = {
  magic: '✨',
  stamina: '⚡',
  intelligence: '🧠',
  hp: '❤️',
  moveSpeed: '👟',
  chargeMax: '🔋',
  chargeGain: '🎯',
  dodge: '💨',
  armor: '🛡️',
  crit: '💥',
}

let uidSeq = 0
/** uid 只用于背包寻址，不参与数值；时间戳前缀防读档后与旧 uid 撞车 */
function nextUid(): string {
  uidSeq += 1
  return `it-${Date.now().toString(36)}-${uidSeq}`
}

/** 保留 3 位小数，避免 0.25*1.9=0.47500000000000003 这类浮点噪声进存档 */
function tidy(v: number): number {
  return Number(v.toFixed(3))
}

function tierValueMul(tier: 1 | 2 | 3): number {
  if (tier === 2) return QUALITY.tier2.valueMul
  if (tier === 3) return QUALITY.tier3.valueMul
  return 1
}

function tierLabel(tier: 1 | 2 | 3): string {
  if (tier === 2) return QUALITY.tier2.name
  if (tier === 3) return QUALITY.tier3.name
  return ''
}

function cardDefOf(cardId: string): BuffCardDef {
  return (
    BUFF_CARDS.find((c) => c.id === cardId) ??
    BUFF_CARDS.find((c) => c.stat === cardId) ??
    BUFF_CARDS[0]
  )
}

/** 单只敌人的击杀金币：本层基准 × GOLD_PER_KILL 比例（small=1 为基准） */
export function killGold(layer: number, kind: 'small' | 'brute' | 'elite' | 'boss'): number {
  const base = goldPerKillFor(Math.max(1, Math.round(layer)))
  const ratio = GOLD_PER_KILL[kind] / GOLD_PER_KILL.small
  return Math.max(1, Math.round(base * ratio))
}

/** 本层通关奖励金币（含难度 goldMul，由 balance.clearGoldFor 提供） */
export function clearGold(id: DifficultyId, layer: number): number {
  return clearGoldFor(id, Math.max(1, Math.round(layer)))
}

/** 商店/掉落品质：层数越深越容易出精制(tier2)/臻品(tier3) */
export function qualityFor(layer: number, rng: Rng): QualityRoll {
  return rollQuality(Math.max(1, Math.round(layer)), () => rng.next())
}

/** 实际价格 = 基准价 × (1 + 每层涨幅 × (层 - 1)) × 品质倍率（保底 1 金） */
export function priceOf(base: number, layer: number, qualityMul = 1): number {
  return Math.max(1, shopPriceFor(base, Math.max(1, Math.round(layer)), qualityMul))
}

/** 背包满时奖励卡的折价：当前层商店价的一半，至少 1 金 */
export function salvageGold(item: InventoryItem, layer: number): number {
  if (item.kind !== 'buff-card') return 1
  const def = cardDefOf(item.stat ?? '')
  const qualityMul =
    item.tier === 2 ? QUALITY.tier2.priceMul : item.tier === 3 ? QUALITY.tier3.priceMul : 1
  return Math.max(1, Math.round(priceOf(def.basePrice, layer, qualityMul) * 0.5))
}

/** 增益卡物品：value 已按品质档放大（tier 倍率见 balance.shop.quality.*.valueMul） */
export function makeCardItem(cardId: string, tier: 1 | 2 | 3): InventoryItem {
  const def = cardDefOf(cardId)
  const label = tierLabel(tier)
  return {
    uid: nextUid(),
    kind: 'buff-card',
    name: label ? `${label}${def.name}` : def.name,
    desc: def.desc,
    icon: CARD_ICONS[def.stat] ?? '🎴',
    tier,
    stat: def.stat,
    value: tidy(def.value * tierValueMul(tier)),
  }
}

/** 卡片进/出背包时增减五维（dir=-1 为取出/合成消耗） */
export function applyItemToCards(
  cards: Record<CardStat, number>,
  item: InventoryItem,
  dir: 1 | -1,
): void {
  if (item.kind !== 'buff-card' || !item.stat || typeof item.value !== 'number') return
  cards[item.stat] = tidy((cards[item.stat] ?? 0) + item.value * dir)
}

export function emptyCards(): Record<CardStat, number> {
  return {
    magic: 0,
    stamina: 0,
    intelligence: 0,
    hp: 0,
    moveSpeed: 0,
    chargeMax: 0,
    chargeGain: 0,
    dodge: 0,
    armor: 0,
    crit: 0,
  }
}

/** 生命上限 = 角色基础生命 + 所有生命结晶累计 */
export function recomputeMaxHp(charId: CharacterId, cards: Record<CardStat, number>): number {
  return Math.max(1, Math.round(CHARACTERS[charId].base.hp + (cards.hp ?? 0)))
}
