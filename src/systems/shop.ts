/**
 * 商店（4 格）：1 格角色专武升级（当前等级 +1）+ 1 格金币训练
 * + 2~3 张增益卡/消耗品。金币训练直接写入 RunState.training，不占背包，
 * 每次购买后按 priceGrowth 涨价，给后期金币提供持续提升渠道。
 * 品质与增价随层数上涨（rollQuality / shopPriceFor），重掷 25 金。
 * 纯数据层：不 import three.js、不碰 DOM；随机走传入的 Rng。
 */
import type { CardStat, CharacterId, ShopOffer } from '../types'
import type { Rng } from '../core/rng'
import { BALANCE } from '../data/balance'
import { MAX_WEAPON_LV } from '../data/characterRuntime'
import { makeCardItem, priceOf, qualityFor } from './economy'

interface BuffCardLite {
  id: string
  name: string
  stat: CardStat
  basePrice: number
}

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

const SHOP = (BALANCE as unknown as { shop: ShopCfg }).shop
const BUFF_CARDS = (BALANCE as unknown as { buffCards: BuffCardLite[] }).buffCards
const WEAPONS = (BALANCE as unknown as { weapons: Record<CharacterId, WeaponLite> }).weapons

/** 商店重掷费用（balance.shop.rerollCost） */
export const REFRESH_COST: number = SHOP.rerollCost

/** 2 张增益卡保底后，后续格子按此概率出消耗品 */
const CONSUMABLE_CHANCE = 0.35
const CONSUMABLE_SLOTS = 2

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

function makeBuffOffer(layer: number, rng: Rng, seq: number, usedStats: CardStat[]): ShopOffer {
  const fresh = BUFF_CARDS.filter((card) => !usedStats.includes(card.stat))
  const def = rng.pick(fresh.length > 0 ? fresh : BUFF_CARDS)
  const quality = qualityFor(layer, rng)
  const item = makeCardItem(def.id, quality.tier)
  usedStats.push(def.stat)
  return {
    id: `card-${seq}-${def.id}-t${quality.tier}`,
    kind: 'buff-card',
    name: item.name,
    desc: item.desc,
    icon: item.icon,
    price: rollPrice(def.basePrice, layer, quality.priceMul),
    tier: quality.tier,
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
 * 传入后专武升级 = 当前等级 +1（不传按 1 级算）。
 * trainingBuys 为已购买训练次数，用于金币训练的累计涨价。
 */
export function generateOffers(
  layer: number,
  charId: CharacterId,
  gold: number,
  rng: Rng,
  count: number = SHOP.slots,
  weaponLv = 1,
  trainingBuys = 0,
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

  const usedStats: CardStat[] = []
  while (offers.length < total) {
    const cardCount = offers.filter((offer) => offer.kind === 'buff-card').length
    const useConsumable = cardCount >= CONSUMABLE_SLOTS && rng.chance(CONSUMABLE_CHANCE)
    offers.push(
      useConsumable
        ? makeConsumableOffer(clampLayer(layer), rng, offers.length)
        : makeBuffOffer(clampLayer(layer), rng, offers.length, usedStats),
    )
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
): ShopOffer[] {
  return generateOffers(layer, charId, 0, rng, SHOP.slots, weaponLv, trainingBuys)
}
