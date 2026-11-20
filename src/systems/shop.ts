/**
 * 商店与流浪商人「交换」（v5 P0-a）：
 * - 货架（4 格）：1 格角色专武升级 + 1 格金币训练 + 2~3 张三档道具卡/消耗品。
 * - 道具卡出货规则（§2.2）：
 *   1. 只出货「比当前持有高一档」的卡（未持有→蓝，持蓝→紫，持紫→金）；满金退池。
 *   2. 允许跳级（+2 档：未持有→紫，持蓝→金），但跳级概率压低并随层数温和抬升。
 *   3. 随层数升高，已持有卡的升档权重提高，保证一局能拿到 1–2 张金卡 + 数张散卡。
 * - 流浪商人「交换」：同档不同名三选一；价格 0 / 15 / 25 / 40 / 65（之后 ×1.6），
 *   同一房间内累计递增，离开房间重置；池内无合法目标时置灰、不扣钱。
 * 纯数据层：不 import three.js、不碰 DOM；随机走传入的 Rng。
 */
import type { CardStat, CharacterId, InventoryItem, ShopOffer } from '../types'
import type { Rng } from '../core/rng'
import type { CardTierNum, ItemCardDef } from '../data/cards'
import { BALANCE } from '../data/balance'
import { MAX_WEAPON_LV } from '../data/characterRuntime'
import { ITEM_CARDS, cardBasePrice, cardIdOfItem, nextTierNum } from '../data/cards'
import { makeCardItem, priceOf, tierPriceMul } from './economy'
import type { Inventory } from './inventory'

interface ConsumableCfg {
  name: string
  price: number
  healRatio?: number
  desc: string
}

interface TrainingStatCfg {
  stat: CardStat
  name: string
  value: number
}

interface TrainingCfg {
  basePrice: number
  priceGrowth: number
  layerGrowth: number
  valueGrowth: number
  stats: TrainingStatCfg[]
}

interface ShopCfg {
  slots: number
  priceGrowthPerLayer: number
  rerollCost: number
  training: TrainingCfg
  consumables: { heal: ConsumableCfg; charge: ConsumableCfg }
}

interface WeaponLite {
  name: string
  tiers: { lv: number; desc: string; price?: number }[]
}

export type HeldCardsInput =
  | Inventory
  | Partial<Record<string, 1 | 2 | 3>>
  | readonly InventoryItem[]

const SHOP = (BALANCE as unknown as { shop: ShopCfg }).shop
const WEAPONS = (BALANCE as unknown as { weapons: Record<CharacterId, WeaponLite> }).weapons

/** 商店重掷费用（balance.shop.rerollCost） */
export const REFRESH_COST: number = SHOP.rerollCost

/** 2 张道具卡保底后，后续格子按此概率出消耗品 */
const CONSUMABLE_CHANCE = 0.35
const CONSUMABLE_SLOTS = 2

/** 商人「交换」阶梯价：前 5 次 0 / 15 / 25 / 40 / 65，之后每次 ×1.6 */
export const EXCHANGE_BASE_PRICES: readonly number[] = [0, 15, 25, 40, 65]
export const EXCHANGE_PRICE_GROWTH = 1.6
export const EXCHANGE_CHOICE_COUNT = 3

function clampLayer(layer: number): number {
  return Math.max(1, Math.round(layer))
}

function rollPrice(base: number, layer: number, qualityMul = 1): number {
  return priceOf(base, clampLayer(layer), qualityMul)
}

const TRAINING = SHOP.training

function tidy(value: number): number {
  return Number(value.toFixed(3))
}

function formatTrainingValue(stat: CardStat, value: number): string {
  if (stat === 'armor' || stat === 'dodge' || stat === 'chargeGain' || stat === 'crit') {
    return `${(value * 100).toFixed(1)}%`
  }
  if (stat === 'moveSpeed') return value.toFixed(2)
  return String(Math.round(value))
}

function normalizeHeldTiers(held?: HeldCardsInput): Record<string, 1 | 2 | 3> {
  const out: Record<string, 1 | 2 | 3> = {}
  if (!held) return out
  if (Array.isArray(held)) {
    for (const item of held) {
      if (item.kind !== 'buff-card') continue
      const id = cardIdOfItem(item)
      if (id) out[id] = item.tier
    }
    return out
  }
  if (typeof (held as Inventory).heldTiers === 'function') {
    const map = (held as Inventory).heldTiers()
    for (const [k, v] of Object.entries(map)) {
      if (v === 1 || v === 2 || v === 3) out[k] = v
    }
    return out
  }
  for (const [k, v] of Object.entries(held as Partial<Record<string, 1 | 2 | 3>>)) {
    if (v === 1 || v === 2 || v === 3) out[k] = v
  }
  return out
}

/**
 * 跳级概率（压低口径，按层数温和抬升）：
 * - 未持有（0→紫）：前 3 层 0%，第 4 层起每层 +1.5%，封顶 12%。
 * - 持蓝（1→金）：前 6 层 0%，第 7 层起每层 +1.0%，封顶 8%。
 * - 持紫（2→金）：本身已直达金档，无跳级空间。
 */
export function jumpTierChance(layer: number, currentTier: 0 | 1 | 2): number {
  const lv = clampLayer(layer)
  if (currentTier === 0) return lv >= 5 ? Math.min(0.08, (lv - 4) * 0.01) : 0
  if (currentTier === 1) return lv >= 8 ? Math.min(0.05, (lv - 7) * 0.008) : 0
  return 0
}

/** 根据当前持有档位与层数，决定商店这张卡的出货档位（必高于当前持有，允许低概率 +2 跳级） */
export function rollOfferTier(layer: number, currentTier: 0 | 1 | 2, rng: Rng): CardTierNum {
  const baseTier = nextTierNum(currentTier) ?? 3
  const jumpChance = jumpTierChance(layer, currentTier)
  if (jumpChance > 0 && baseTier < 3 && rng.chance(jumpChance)) {
    return Math.min(3, baseTier + 1) as CardTierNum
  }
  return baseTier
}

/** 候选项抽取权重：层数越高，已持有卡的升档（紫/金）权重温和升高，保证一局 1–2 金 + 数张散卡 */
function candidateWeight(layer: number, baseTier: CardTierNum): number {
  const lv = clampLayer(layer)
  if (baseTier === 2) return 0.45 + Math.min(0.55, Math.max(0, lv - 3) * 0.07)
  if (baseTier === 3) return 0.08 + Math.min(0.24, Math.max(0, lv - 8) * 0.04)
  return 1
}

function pickWeightedCard(
  candidates: { def: ItemCardDef; curTier: 0 | 1 | 2; baseTier: CardTierNum }[],
  layer: number,
  rng: Rng,
): { def: ItemCardDef; curTier: 0 | 1 | 2; baseTier: CardTierNum } {
  let total = 0
  const weights = candidates.map((c) => {
    const w = candidateWeight(layer, c.baseTier)
    total += w
    return w
  })
  let roll = rng.next() * total
  for (let i = 0; i < candidates.length; i += 1) {
    roll -= weights[i]
    if (roll <= 0) return candidates[i]
  }
  return candidates[candidates.length - 1]
}

/** 金币训练价格：层数越深基础价越高，购买次数越多越贵。 */
export function trainingPriceFor(layer: number, buys: number): number {
  const n = Math.max(0, Math.round(buys))
  const base = TRAINING.basePrice * (1 + TRAINING.layerGrowth * (clampLayer(layer) - 1))
  return Math.max(1, Math.round(base * Math.pow(TRAINING.priceGrowth, n)))
}

/** 金币训练的永久属性成长；同一次商店内重复购买价格会涨，但单次收益固定。 */
function makeTrainingOffer(layer: number, rng: Rng, seq: number, buys: number): ShopOffer | null {
  if (!TRAINING.stats || TRAINING.stats.length === 0) return null
  const def = rng.pick(TRAINING.stats)
  const value = tidy(def.value * (1 + TRAINING.valueGrowth * (clampLayer(layer) - 1)))
  const label = def.name.replace('特训', '')
  return {
    id: `training-${seq}-${def.stat}`,
    kind: 'training',
    name: `${def.name} +${formatTrainingValue(def.stat, value)}`,
    desc: `永久 ${label} +${formatTrainingValue(def.stat, value)}，不占背包；可重复购买（已训练 ${buys} 次）`,
    icon: '📈',
    price: trainingPriceFor(layer, buys),
    tier: 1,
    stat: def.stat,
    value,
    repeatable: true,
    trainingLabel: label,
  }
}

function makeWeaponUpgradeOffer(charId: CharacterId, weaponLv: number): ShopOffer | null {
  const current = Math.round(weaponLv)
  const next = current + 1
  if (next > MAX_WEAPON_LV || next < 2) return null
  const weapon = WEAPONS[charId]
  const def = weapon.tiers[next - 1]
  if (!def) return null
  return {
    id: `weapon-${charId}-${next}`,
    kind: 'weapon',
    name: `${weapon.name}·Lv${next}`,
    desc: def.desc,
    icon: '⚔️',
    // 专武价格 = balance.weapons.<char>.tiers[level].price，不随层数涨价
    price: Math.max(1, Math.round(def.price ?? 0)),
    tier: next <= 2 ? 1 : next === 3 ? 2 : 3,
    weaponLevel: next,
  }
}

function makeBuffOffer(
  layer: number,
  rng: Rng,
  seq: number,
  usedIds: Set<string>,
  held: Record<string, 1 | 2 | 3>,
): ShopOffer | null {
  const candidates: { def: ItemCardDef; curTier: 0 | 1 | 2; baseTier: CardTierNum }[] = []
  for (const def of ITEM_CARDS) {
    if (usedIds.has(def.id)) continue
    const cur = held[def.id] ?? 0
    // 满金退池
    if (cur >= 3) continue
    const baseTier = nextTierNum(cur)
    if (!baseTier) continue
    candidates.push({ def, curTier: cur as 0 | 1 | 2, baseTier })
  }
  if (candidates.length === 0) return null

  const picked = pickWeightedCard(candidates, layer, rng)
  const offerTier = rollOfferTier(layer, picked.curTier, rng)
  const item = makeCardItem(picked.def.id, offerTier)
  usedIds.add(picked.def.id)
  return {
    id: `card-${seq}-${picked.def.id}-t${offerTier}`,
    kind: 'buff-card',
    name: item.name,
    desc: item.desc,
    icon: item.icon,
    price: rollPrice(cardBasePrice(picked.def), layer, tierPriceMul(offerTier)),
    tier: offerTier,
    stat: item.stat,
    value: item.value,
  }
}

function makeConsumableOffer(layer: number, rng: Rng, seq: number): ShopOffer {
  const kind: 'heal' | 'charge' = rng.chance(0.5) ? 'heal' : 'charge'
  const def = SHOP.consumables[kind]
  const price = rollPrice(def.price, layer)
  if (kind === 'heal') {
    return {
      id: `consumable-${seq}-heal`,
      kind: 'consumable',
      name: def.name,
      desc: def.desc,
      icon: '🧪',
      price,
      tier: 1,
      value: def.healRatio ?? 0.35,
    }
  }
  return {
    id: `consumable-${seq}-charge`,
    kind: 'consumable',
    name: def.name,
    desc: def.desc,
    icon: '🔋',
    price,
    tier: 1,
    value: 1,
  }
}

/**
 * 生成货架。gold 不筛货（只用于 HUD 是否买得起）；weaponLv 为角色当前专武等级，
 * trainingBuys 为已购买训练次数，held 为玩家当前已持有的道具卡档位（不传则按未持有处理）。
 */
export function generateOffers(
  layer: number,
  charId: CharacterId,
  gold: number,
  rng: Rng,
  count: number = SHOP.slots,
  weaponLv = 1,
  trainingBuys = 0,
  held?: HeldCardsInput,
): ShopOffer[] {
  void gold
  const total = Math.max(0, Math.round(count))
  const offers: ShopOffer[] = []
  if (total === 0) return offers

  const weaponOffer = makeWeaponUpgradeOffer(charId, weaponLv)
  if (weaponOffer) offers.push(weaponOffer)

  // 固定塞一格金币训练：不占背包，是后期金币的主要去向。
  const trainingOffer = makeTrainingOffer(clampLayer(layer), rng, offers.length, trainingBuys)
  if (trainingOffer && offers.length < total) offers.push(trainingOffer)

  const heldMap = normalizeHeldTiers(held)
  const usedIds = new Set<string>()
  while (offers.length < total) {
    const cardCount = offers.filter((offer) => offer.kind === 'buff-card').length
    const useConsumable = cardCount >= CONSUMABLE_SLOTS && rng.chance(CONSUMABLE_CHANCE)
    if (useConsumable) {
      offers.push(makeConsumableOffer(clampLayer(layer), rng, offers.length))
      continue
    }
    const buffOffer = makeBuffOffer(clampLayer(layer), rng, offers.length, usedIds, heldMap)
    if (buffOffer) {
      offers.push(buffOffer)
    } else {
      // 合法卡池已耗尽（如全部满金），用消耗品补齐货架
      offers.push(makeConsumableOffer(clampLayer(layer), rng, offers.length))
    }
  }
  return offers
}

/** 花 25 金重掷整架（调用方负责扣钱） */
export function refreshOffers(
  layer: number,
  charId: CharacterId,
  rng: Rng,
  weaponLv = 1,
  trainingBuys = 0,
  held?: HeldCardsInput,
): ShopOffer[] {
  return generateOffers(layer, charId, 0, rng, SHOP.slots, weaponLv, trainingBuys, held)
}

/* ================================================================== */
/* 流浪商人「交换」：同档不同名三选一，房间内累计递增，离开房间重置    */
/* ================================================================== */

export interface ExchangeOffer {
  sourceUid: string
  sourceCardId: string
  tier: CardTierNum
  price: number
  /** 1..3 张同档、不同名且当前未持有的候选卡 */
  choices: InventoryItem[]
}

export interface ExchangeCommitResult {
  ok: boolean
  cost: number
  goldAfter: number
  received?: InventoryItem
  reason?: 'not-found' | 'no-target' | 'invalid-choice' | 'poor'
}

/** 第 usesInRoom 次交换（0 起）的价格：0 / 15 / 25 / 40 / 65，之后每次 ×1.6 */
export function exchangePriceFor(usesInRoom: number): number {
  const n = Math.max(0, Math.floor(usesInRoom))
  if (n < EXCHANGE_BASE_PRICES.length) return EXCHANGE_BASE_PRICES[n]
  const last = EXCHANGE_BASE_PRICES[EXCHANGE_BASE_PRICES.length - 1]
  return Math.round(last * Math.pow(EXCHANGE_PRICE_GROWTH, n - (EXCHANGE_BASE_PRICES.length - 1)))
}

/**
 * 返回某张卡在商人「交换」中的全部合法目标定义：
 * - 不同名（id !== sourceCardId）
 * - 且当前背包中未持有（保证同名唯一不变式）
 */
export function legalExchangePool(
  sourceItem: InventoryItem,
  held?: HeldCardsInput,
): ItemCardDef[] {
  if (sourceItem.kind !== 'buff-card') return []
  const sourceId = cardIdOfItem(sourceItem)
  if (!sourceId) return []
  const heldMap = normalizeHeldTiers(held)
  return ITEM_CARDS.filter((def) => def.id !== sourceId && !(def.id in heldMap))
}

/** 池内是否存在合法交换目标（false 时 UI 按钮应置灰、不扣钱） */
export function canExchangeCard(sourceItem: InventoryItem, held?: HeldCardsInput): boolean {
  return legalExchangePool(sourceItem, held).length > 0
}

/**
 * 单个商人房间内的「交换」状态机。
 * 每次成功交换后 `usesInRoom += 1`，价格按 0/15/25/40/65（×1.6）递增；
 * 离开房间时调用 `reset()` 归零。
 */
export class MerchantExchange {
  usesInRoom = 0

  get currentPrice(): number {
    return exchangePriceFor(this.usesInRoom)
  }

  /** 离开商人房间时重置计数 */
  reset(): void {
    this.usesInRoom = 0
  }

  canExchange(sourceItem: InventoryItem, held: HeldCardsInput): boolean {
    return canExchangeCard(sourceItem, held)
  }

  /**
   * 为指定持卡生成同档不同名三选一报价。
   * 池内无合法目标时返回 null（按钮置灰，不扣钱）。
   */
  rollChoices(
    sourceItem: InventoryItem,
    held: HeldCardsInput,
    rng: Rng,
  ): ExchangeOffer | null {
    const pool = legalExchangePool(sourceItem, held)
    if (pool.length === 0) return null
    const sourceCardId = cardIdOfItem(sourceItem)
    if (!sourceCardId) return null

    const copy = [...pool]
    const picked: ItemCardDef[] = []
    const take = Math.min(EXCHANGE_CHOICE_COUNT, copy.length)
    for (let i = 0; i < take; i += 1) {
      const idx = rng.int(0, copy.length - 1)
      picked.push(copy.splice(idx, 1)[0])
    }

    return {
      sourceUid: sourceItem.uid,
      sourceCardId,
      tier: sourceItem.tier,
      price: this.currentPrice,
      choices: picked.map((def) => makeCardItem(def.id, sourceItem.tier)),
    }
  }

  /**
   * 执行交换：校验合法目标与金币，原地替换为同档不同名新卡，递增本房间计数。
   * 无合法目标或金币不足时均不扣钱、不递增计数。
   */
  commitExchange(
    sourceUid: string,
    chosenCardId: string,
    inventory: Inventory,
    gold: number,
  ): ExchangeCommitResult {
    const sourceItem = inventory.get(sourceUid)
    if (!sourceItem || sourceItem.kind !== 'buff-card') {
      return { ok: false, cost: 0, goldAfter: gold, reason: 'not-found' }
    }
    const pool = legalExchangePool(sourceItem, inventory)
    if (pool.length === 0) {
      return { ok: false, cost: 0, goldAfter: gold, reason: 'no-target' }
    }
    const targetDef = pool.find((def) => def.id === chosenCardId)
    if (!targetDef) {
      return { ok: false, cost: 0, goldAfter: gold, reason: 'invalid-choice' }
    }
    const cost = this.currentPrice
    if (gold < cost) {
      return { ok: false, cost: 0, goldAfter: gold, reason: 'poor' }
    }
    const nextItem = makeCardItem(targetDef.id, sourceItem.tier)
    if (!inventory.replaceCard(sourceUid, nextItem)) {
      return { ok: false, cost: 0, goldAfter: gold, reason: 'invalid-choice' }
    }
    this.usesInRoom += 1
    const received = inventory.get(sourceUid) ?? nextItem
    return { ok: true, cost, goldAfter: gold - cost, received }
  }
}
