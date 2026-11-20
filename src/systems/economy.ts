/**
 * 经济纯数据层（v5 P0-a）：击杀/通关金币、品质与定价、三档卡物品生成、五维汇总。
 * 不 import three.js、不碰 DOM；所有随机数走传入的 Rng（可复现）。
 * 道具卡数值完全由 `src/data/cards.ts` 按档位（蓝/紫/金）推导，不再乘旧版 quality.valueMul。
 */
import type { CardStat, CharacterId, DifficultyId, InventoryItem } from '../types'
import type { Rng } from '../core/rng'
import type { QualityRoll } from '../data/balance'
import type { ItemCardStat } from '../data/cards'
import { BALANCE, clearGoldFor, goldPerKillFor, rollQuality, shopPriceFor } from '../data/balance'
import {
  CARD_TIER_LABEL,
  ITEM_CARDS,
  cardBasePrice,
  cardIdOfItem,
  cardRuntimeValueAt,
  cardTextAt,
  isCardStat,
  resolveCardDef,
  tierFromNum,
} from '../data/cards'
import { CHARACTERS, GOLD_PER_KILL } from '../data/characters'

interface QualityCfg {
  tier2: { valueMul: number; priceMul: number; name: string }
  tier3: { valueMul: number; priceMul: number; name: string }
}

interface EconomyData {
  shop: { quality: QualityCfg; slots: number; priceGrowthPerLayer: number }
}

const DATA = BALANCE as unknown as EconomyData
const QUALITY = DATA.shop.quality

const CARD_ICONS: Record<ItemCardStat, string> = {
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
  hpRegen: '🌿',
}

let uidSeq = 0
/** uid 只用于背包寻址，不参与数值；时间戳前缀防读档后与旧 uid 撞车 */
function nextUid(): string {
  uidSeq += 1
  return `it-${Date.now().toString(36)}-${uidSeq}`
}

/** 保留 3 位小数，避免浮点噪声进存档 */
function tidy(v: number): number {
  return Number(v.toFixed(3))
}

function clampTier(tier: number): 1 | 2 | 3 {
  if (tier >= 3) return 3
  if (tier === 2) return 2
  return 1
}

export function tierPriceMul(tier: 1 | 2 | 3): number {
  if (tier === 2) return QUALITY.tier2.priceMul
  if (tier === 3) return QUALITY.tier3.priceMul
  return 1
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

/** 商店/掉落品质：层数越深越容易出高档 */
export function qualityFor(layer: number, rng: Rng): QualityRoll {
  return rollQuality(Math.max(1, Math.round(layer)), () => rng.next())
}

/** 实际价格 = 基准价 × (1 + 每层涨幅 × (层 - 1)) × 品质倍率（保底 1 金） */
export function priceOf(base: number, layer: number, qualityMul = 1): number {
  return Math.max(1, shopPriceFor(base, Math.max(1, Math.round(layer)), qualityMul))
}

/** 奖励卡折价：当前层商店价的一半，至少 1 金 */
export function salvageGold(item: InventoryItem, layer: number): number {
  if (item.kind !== 'buff-card') return 1
  const cardId = cardIdOfItem(item)
  const def = (cardId ? resolveCardDef(cardId) : undefined) ?? ITEM_CARDS[0]
  const qualityMul = tierPriceMul(clampTier(item.tier))
  return Math.max(1, Math.round(priceOf(cardBasePrice(def), layer, qualityMul) * 0.5))
}

/**
 * 三档道具卡物品：数值与词条完全由 `cards.ts` 按 tier（1=蓝 / 2=紫 / 3=金）推导。
 * `hpRegen` 暂未并入 `CardStat`，其 `stat` 置为 undefined 以兼容旧存档校验，
 * 卡身份通过 `cardIdOfItem(item)` 统一识别。
 */
export function makeCardItem(cardId: string, tier: 1 | 2 | 3): InventoryItem {
  const def = resolveCardDef(cardId) ?? ITEM_CARDS[0]
  const clamped = clampTier(tier)
  const cardTier = tierFromNum(clamped)
  return {
    uid: nextUid(),
    kind: 'buff-card',
    name: `${CARD_TIER_LABEL[cardTier]}·${def.name}`,
    desc: cardTextAt(def, cardTier),
    icon: CARD_ICONS[def.stat] ?? '🎴',
    tier: clamped,
    stat: isCardStat(def.stat) ? def.stat : undefined,
    value: cardRuntimeValueAt(def, cardTier),
  }
}

/** 卡片进/出背包时增减五维（dir=-1 为移除） */
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

/** 生命上限 = 角色基础生命 + 生命结晶数值 */
export function recomputeMaxHp(charId: CharacterId, cards: Record<CardStat, number>): number {
  return Math.max(1, Math.round(CHARACTERS[charId].base.hp + (cards.hp ?? 0)))
}

export { cardIdOfItem }
