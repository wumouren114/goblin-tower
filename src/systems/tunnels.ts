/**
 * 层末「时空隧道」：3 扇门（reward/trade/battle，权重取 balance.portals，类别可重复）。
 * Boss 层三门全为 battle（boss 房）；resolveRoom 产出可直接结算的结果。
 * 纯数据层：不 import three.js、不碰 DOM；随机走传入的 Rng。
 */
import type {
  CardStat,
  CharacterId,
  InventoryItem,
  ShopOffer,
  TunnelOffer,
  TunnelPayload,
  TunnelRoom,
  TunnelType,
} from '../types'
import type { Rng } from '../core/rng'
import { BALANCE, quotaFor } from '../data/balance'
import { makeCardItem, qualityFor } from './economy'
import { generateOffers } from './shop'

// ── balance.json 段落（balance.ts 未声明类型，本模块只读）──
interface PortalsCfg {
  count: number
  weights: { reward: number; trade: number; battle: number; rest: number }
  reward: { chest: number; skillCard: number }
  trade: { merchant: number; altar: number }
  battle: { mobWave: number; eliteFight: number }
  lastLayerOfStageBossChance: number
  otherBattleBossChance: number
  chestGoldBase: number
  chestGoldPerLayer: number
  chestCardChance: number
  mobWaveGoldMul: number
  eliteFightGoldMul: number
  altarBaseCost: number
  altarCostStep: number
}

interface BuffCardLite {
  id: string
  name: string
  stat: CardStat
  value: number
  desc: string
}

interface SkillCardDef {
  id: string
  name: string
  desc: string
  weight: number
}

const PORTALS = (BALANCE as unknown as { portals: PortalsCfg }).portals
const BUFF_CARDS = (BALANCE as unknown as { buffCards: BuffCardLite[] }).buffCards
const SKILL_CARDS = (BALANCE as unknown as { skillCards: SkillCardDef[] }).skillCards

/** 对战房金币按奖励房金币的 60% 起步，再乘 mobWave/eliteFight 倍率（与 sim/simulate.mjs 同口径） */
const BATTLE_GOLD_RATIO = 0.6
/** balance 没有「房间怪量」字段：本层配额 × 比例派生（改这里即可调难度） */
const MOB_WAVE_QUOTA_RATIO = 0.6
const ELITE_GUARD_QUOTA_RATIO = 0.3
const ELITE_COUNT = 2
/** 技能卡折算成五维卡片的数值口径（sim 同口径：crit/lifesteal→magic，其他→stamina，值 8） */
const SKILL_CARD_STAT_VALUE = 8

const CARD_LABEL: Record<CardStat, string> = {
  magic: '魔力',
  stamina: '耐力',
  intelligence: '智力',
  hp: '生命',
  moveSpeed: '移速',
  chargeMax: '充能需求',
  chargeGain: '充能获取',
  dodge: '闪避',
  armor: '减伤',
  crit: '暴击率',
}

const ROOM_ICON: Record<TunnelRoom, string> = {
  chest: '🎁',
  'skill-card': '🃏',
  merchant: '🛒',
  altar: '🔮',
  'mob-wave': '👹',
  'elite-fight': '💀',
  boss: '👑',
  rest: '⛺',
}

const ROOM_KIND: Record<TunnelRoom, TunnelType> = {
  chest: 'reward',
  'skill-card': 'reward',
  merchant: 'trade',
  altar: 'trade',
  'mob-wave': 'battle',
  'elite-fight': 'battle',
  boss: 'battle',
  rest: 'rest',
}

export interface RoomResolution {
  gold?: number
  card?: InventoryItem
  shopOffers?: ShopOffer[]
  altarCost?: number
  altarReward?: { stat: CardStat; value: number }
  enemies?: { count: number; elite: number }
  bossLayer?: boolean
  rest?: { healRatio: number; chargeRatio: number }
}

/** 技能卡三选一的结果条目（TunnelPayload.skillCard 的非空形状） */
type SkillCardPayload = NonNullable<TunnelPayload['skillCard']>

function clampLayer(layer: number): number {
  return Math.max(1, Math.round(layer))
}

/** 奖励房金币（免费收益，全层深递增） */
function chestGold(layer: number): number {
  return Math.round(PORTALS.chestGoldBase + PORTALS.chestGoldPerLayer * (layer - 1))
}

/** 对战房金币：奖励房基准 × 0.6 × mobWave/eliteFight 倍率 */
function battleGold(layer: number, elite: boolean): number {
  const base = (PORTALS.chestGoldBase + PORTALS.chestGoldPerLayer * (layer - 1)) * BATTLE_GOLD_RATIO
  return Math.round(base * (elite ? PORTALS.eliteFightGoldMul : PORTALS.mobWaveGoldMul))
}

function altarCost(layer: number): number {
  return Math.round(PORTALS.altarBaseCost + PORTALS.altarCostStep * (layer - 1))
}

function mobWaveCount(layer: number): number {
  return Math.max(6, Math.round(quotaFor(layer) * MOB_WAVE_QUOTA_RATIO))
}

function eliteFightCount(layer: number): number {
  return ELITE_COUNT + Math.max(2, Math.round(quotaFor(layer) * ELITE_GUARD_QUOTA_RATIO))
}

function pickSkillCard(rng: Rng): SkillCardDef {
  const total = SKILL_CARDS.reduce((sum, card) => sum + card.weight, 0)
  let roll = rng.next() * total
  for (const card of SKILL_CARDS) {
    roll -= card.weight
    if (roll <= 0) return card
  }
  return SKILL_CARDS[SKILL_CARDS.length - 1]
}

function skillCardStat(id: string): CardStat {
  return id === 'crit' || id === 'lifesteal' ? 'magic' : 'stamina'
}

function rollSkillCard(rng: Rng): SkillCardPayload {
  const def = pickSkillCard(rng)
  return {
    id: def.id,
    name: def.name,
    desc: def.desc,
    stat: skillCardStat(def.id),
    value: SKILL_CARD_STAT_VALUE,
  }
}

function rollAltarReward(layer: number, rng: Rng): { stat: CardStat; value: number } {
  const def = rng.pick(BUFF_CARDS)
  const quality = qualityFor(layer, rng)
  return { stat: def.stat, value: Number((def.value * quality.valueMul).toFixed(3)) }
}

function rollRoomType(rng: Rng): TunnelRoom {
  const weights = PORTALS.weights
  const roll = rng.next()
  const rewardEnd = weights.reward
  const tradeEnd = rewardEnd + weights.trade
  const battleEnd = tradeEnd + weights.battle
  const kind: TunnelType = roll < rewardEnd ? 'reward' : roll < tradeEnd ? 'trade' : roll < battleEnd ? 'battle' : 'rest'
  if (kind === 'rest') return 'rest'
  if (kind === 'reward') return rng.chance(PORTALS.reward.chest) ? 'chest' : 'skill-card'
  if (kind === 'trade') return rng.chance(PORTALS.trade.merchant) ? 'merchant' : 'altar'
  return rng.chance(PORTALS.battle.mobWave) ? 'mob-wave' : 'elite-fight'
}

function makePayload(
  room: TunnelRoom,
  layer: number,
  charId: CharacterId,
  rng: Rng,
  weaponLv: number,
): TunnelPayload {
  switch (room) {
    case 'chest': {
      const gold = chestGold(layer)
      const wantCard = rng.chance(PORTALS.chestCardChance)
      const card = wantCard
        ? makeCardItem(rng.pick(BUFF_CARDS).id, qualityFor(layer, rng).tier)
        : undefined
      return { gold, card }
    }
    case 'skill-card':
      return { skillCard: rollSkillCard(rng) }
    case 'merchant':
      return { shopOffers: generateOffers(layer, charId, 0, rng, undefined, weaponLv) }
    case 'altar':
      return { altarCost: altarCost(layer), altarReward: rollAltarReward(layer, rng) }
    case 'mob-wave':
      return { gold: battleGold(layer, false), enemyCount: mobWaveCount(layer) }
    case 'elite-fight':
      return { gold: battleGold(layer, true), enemyCount: eliteFightCount(layer) }
    case 'boss':
      return { gold: battleGold(layer, true), enemyCount: 1, bossLayer: true }
    case 'rest':
      return { rest: { healRatio: 0.28, chargeRatio: 0.5 } }
    default:
      return {}
  }
}

function describePayload(
  room: TunnelRoom,
  payload: TunnelPayload,
  extra: { eliteCount: number },
): { title: string; desc: string } {
  switch (room) {
    case 'chest': {
      const gold = payload.gold ?? 0
      const cardText = payload.card ? `，获得「${payload.card.name}」` : ''
      return { title: '宝藏密室', desc: `打开宝箱：金币 +${gold}${cardText}` }
    }
    case 'skill-card': {
      const skill = payload.skillCard
      return {
        title: '技能祭坛',
        desc: skill ? `三选一技能卡：${skill.name} — ${skill.desc}` : '三选一技能卡',
      }
    }
    case 'merchant':
      return { title: '流浪商人', desc: '4 件货随意选购，可花 25 金重掷' }
    case 'altar': {
      const reward = payload.altarReward
      const statText = reward ? `${CARD_LABEL[reward.stat]} +${reward.value}` : '永久祝福'
      return {
        title: '古老祭坛',
        desc: `${payload.altarCost ?? 0} 金换永久祝福（${statText}）`,
      }
    }
    case 'mob-wave':
      return {
        title: '怪潮',
        desc: `${payload.enemyCount ?? 0} 只哥布林涌来，金币 +${payload.gold ?? 0}`,
      }
    case 'elite-fight':
      return {
        title: '精英伏击',
        desc: `${extra.eliteCount} 精英 + ${(payload.enemyCount ?? extra.eliteCount) - extra.eliteCount} 随从，金币 +${payload.gold ?? 0}`,
      }
    case 'boss':
      return { title: 'Boss 房间', desc: '正面击破最终阶段 Boss，锁定通关' }
    case 'rest':
      return { title: '休憩营地', desc: '回血 28%、充能 +50%，安全但没金币' }
    default:
      return { title: '未知房间', desc: '' }
  }
}

/**
 * 掷 3 扇门。isBossLayer 为 true（或即将进入最后一层）时三门全为 boss 房；
 * weaponLv 为角色当前专武等级（商人房货架需要），不传按 1 级算。
 */
export function rollTunnels(
  layer: number,
  totalLayers: number,
  isBossLayer: boolean,
  charId: CharacterId,
  rng: Rng,
  weaponLv = 1,
): TunnelOffer[] {
  const current = clampLayer(layer)
  const bossDoor = isBossLayer || (totalLayers > 0 && current >= Math.round(totalLayers))
  const count = Math.max(1, Math.round(PORTALS.count))
  const offers: TunnelOffer[] = []
  for (let index = 0; index < count; index += 1) {
    const room: TunnelRoom = bossDoor ? 'boss' : rollRoomType(rng)
    const payload = makePayload(room, current, charId, rng, weaponLv)
    const text = describePayload(room, payload, { eliteCount: ELITE_COUNT })
    offers.push({
      id: `tunnel-${current}-${index}-${room}`,
      kind: ROOM_KIND[room],
      room,
      title: text.title,
      desc: text.desc,
      icon: ROOM_ICON[room],
      payload,
    })
  }
  return offers
}

/** 结算选中的门：金币/卡片/货架/祭坛报价/敌人数量，game.ts 可直接执行 */
export function resolveRoom(
  offer: TunnelOffer,
  layer: number,
  charId: CharacterId,
  rng: Rng,
): RoomResolution {
  const current = clampLayer(layer)
  const payload = offer.payload
  switch (offer.room) {
    case 'chest': {
      const card =
        payload.card ??
        (rng.chance(PORTALS.chestCardChance)
          ? makeCardItem(rng.pick(BUFF_CARDS).id, qualityFor(current, rng).tier)
          : undefined)
      return { gold: payload.gold ?? chestGold(current), card }
    }
    case 'skill-card': {
      const skill = payload.skillCard ?? rollSkillCard(rng)
      return { card: skillCardToItem(skill) }
    }
    case 'merchant':
      return { shopOffers: payload.shopOffers ?? generateOffers(current, charId, 0, rng) }
    case 'altar':
      return {
        altarCost: payload.altarCost ?? altarCost(current),
        altarReward: payload.altarReward ?? rollAltarReward(current, rng),
      }
    case 'mob-wave':
    case 'elite-fight':
      return {
        gold: payload.gold ?? battleGold(current, offer.room === 'elite-fight'),
        enemies: {
          count: payload.enemyCount ?? (offer.room === 'mob-wave' ? mobWaveCount(current) : eliteFightCount(current)),
          elite: offer.room === 'elite-fight' ? ELITE_COUNT : 0,
        },
      }
    case 'boss':
      return {
        gold: payload.gold ?? battleGold(current, true),
        enemies: { count: payload.enemyCount ?? 1, elite: 0 },
        bossLayer: true,
      }
    default:
      return {}
  }
}

/** 技能卡三选一结果落成背包卡片（走 makeCardItem 拿 uid/品质字段，再覆盖成技能卡展示） */
function skillCardToItem(skill: SkillCardPayload): InventoryItem {
  const item = makeCardItem(skill.stat, 1)
  return {
    ...item,
    name: skill.name,
    desc: skill.desc,
    icon: '🃏',
    value: skill.value,
  }
}
