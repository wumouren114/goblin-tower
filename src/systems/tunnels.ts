/**
 * 层末「时空隧道」：3 扇门（reward/trade/battle/rest，权重取 balance.portals）。
 * 类别可重复，但同一轮不会出现两间完全相同的房；Boss 层三门全为 battle（boss 房）。
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
import { BALANCE, DIFFICULTIES, quotaFor, type DifficultyId } from '../data/balance'
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
/** 休憩房收益：回血按最大生命比例，充能按风格槽比例 */
const REST_HEAL_RATIO = 0.28
const REST_CHARGE_RATIO = 0.5
/** 精英房后置：前 3 层不出；4–6 层 1 精英，7 层起 2 精英 */
const ELITE_FIGHT_MIN_LAYER = 4
const ELITE_FIGHT_DOUBLE_LAYER = 7
const ELITE_GUARDS_EARLY = 6
const ELITE_GUARDS_LATE = 8
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

/** 奖励房金币（免费收益，全层深递增；难度金币倍率与清层/模拟器同口径） */
function chestGold(layer: number, difficulty: DifficultyId = 'normal'): number {
  const base = PORTALS.chestGoldBase + PORTALS.chestGoldPerLayer * (layer - 1)
  return Math.round(base * DIFFICULTIES[difficulty].goldMul)
}

/** 对战房金币：奖励房基准 × 0.6 × mobWave/eliteFight 倍率 × 难度金币倍率 */
function battleGold(layer: number, elite: boolean, difficulty: DifficultyId = 'normal'): number {
  const base = (PORTALS.chestGoldBase + PORTALS.chestGoldPerLayer * (layer - 1)) * BATTLE_GOLD_RATIO
  return Math.round(
    base * (elite ? PORTALS.eliteFightGoldMul : PORTALS.mobWaveGoldMul) * DIFFICULTIES[difficulty].goldMul,
  )
}

function altarCost(layer: number): number {
  return Math.round(PORTALS.altarBaseCost + PORTALS.altarCostStep * (layer - 1))
}

function mobWaveCount(layer: number, difficulty: DifficultyId = 'normal'): number {
  return Math.max(6, Math.round(quotaFor(difficulty, layer) * MOB_WAVE_QUOTA_RATIO))
}

/** 精英房随层数的固定编成：先压早期压力，再在深层的 7 层后恢复双精英 */
function eliteFightComposition(layer: number): { elite: number; count: number } {
  const current = clampLayer(layer)
  const late = current >= ELITE_FIGHT_DOUBLE_LAYER
  const elite = late ? 2 : 1
  const guards = late ? ELITE_GUARDS_LATE : ELITE_GUARDS_EARLY
  return { elite, count: elite + guards }
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

/** 一个门类别在当前层可能出现的房间（顺序即展示/兜底顺序） */
function roomsOfKind(kind: TunnelType, layer: number): TunnelRoom[] {
  switch (kind) {
    case 'reward':
      return ['chest', 'skill-card']
    case 'trade':
      return ['merchant', 'altar']
    case 'battle':
      return clampLayer(layer) >= ELITE_FIGHT_MIN_LAYER ? ['mob-wave', 'elite-fight'] : ['mob-wave']
    default:
      return ['rest']
  }
}

/** 只从还有空房的类别里按原权重掷类别；保证不会掷到已经用光的类别 */
function rollKind(rng: Rng, available: TunnelType[]): TunnelType {
  const weights = PORTALS.weights
  let total = 0
  for (const kind of available) total += weights[kind]
  if (total <= 0) return available[0] ?? 'reward'
  let roll = rng.next() * total
  for (const kind of available) {
    roll -= weights[kind]
    if (roll <= 0) return kind
  }
  return available[available.length - 1] ?? 'reward'
}

/**
 * 同一轮 3 扇门不出现完全相同的房间：
 * 类别仍按 balance.portals.weights 掷，但同类别内做无放回选择；
 * 若该类别的房间都已出现（如低层精英未解锁、rest 只有一种），重掷类别。
 */
function rollRoomType(rng: Rng, layer: number, used: Set<TunnelRoom>): TunnelRoom {
  const allKinds: TunnelType[] = ['reward', 'trade', 'battle', 'rest']
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const kinds = allKinds.filter((kind) => roomsOfKind(kind, layer).some((room) => !used.has(room)))
    if (kinds.length === 0) break
    const kind = rollKind(rng, kinds)
    const candidates = roomsOfKind(kind, layer).filter((room) => !used.has(room))
    if (candidates.length === 0) continue
    if (kind === 'reward') {
      const prefer = rng.chance(PORTALS.reward.chest) ? 'chest' : 'skill-card'
      return candidates.includes(prefer) ? prefer : candidates[0]
    }
    if (kind === 'trade') {
      const prefer = rng.chance(PORTALS.trade.merchant) ? 'merchant' : 'altar'
      return candidates.includes(prefer) ? prefer : candidates[0]
    }
    if (kind === 'battle') {
      const prefer = rng.chance(PORTALS.battle.mobWave) ? 'mob-wave' : 'elite-fight'
      return candidates.includes(prefer) ? prefer : candidates[0]
    }
    return 'rest'
  }
  // 理论兜底：所有房间都已出现时退化为普通怪潮
  return 'mob-wave'
}

function makePayload(
  room: TunnelRoom,
  layer: number,
  charId: CharacterId,
  rng: Rng,
  weaponLv: number,
  trainingBuys: number,
  difficulty: DifficultyId,
): TunnelPayload {
  switch (room) {
    case 'chest': {
      const gold = chestGold(layer, difficulty)
      const wantCard = rng.chance(PORTALS.chestCardChance)
      const card = wantCard
        ? makeCardItem(rng.pick(BUFF_CARDS).id, qualityFor(layer, rng).tier)
        : undefined
      return { gold, card }
    }
    case 'skill-card':
      return { skillCard: rollSkillCard(rng) }
    case 'merchant':
      return { shopOffers: generateOffers(layer, charId, 0, rng, undefined, weaponLv, trainingBuys) }
    case 'altar':
      return { altarCost: altarCost(layer), altarReward: rollAltarReward(layer, rng) }
    case 'mob-wave':
      return { gold: battleGold(layer, false, difficulty), enemyCount: mobWaveCount(layer, difficulty) }
    case 'elite-fight': {
      const comp = eliteFightComposition(layer)
      return { gold: battleGold(layer, true, difficulty), enemyCount: comp.count, eliteCount: comp.elite }
    }
    case 'boss':
      return { gold: battleGold(layer, true, difficulty), enemyCount: 1, bossLayer: true }
    case 'rest':
      return { rest: { healRatio: REST_HEAL_RATIO, chargeRatio: REST_CHARGE_RATIO } }
    default:
      return {}
  }
}

function describePayload(room: TunnelRoom, payload: TunnelPayload): { title: string; desc: string } {
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
        desc: skill ? `获得技能卡：${skill.name}` : '获得一张技能卡',
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
    case 'elite-fight': {
      const elite = payload.eliteCount ?? 0
      const guards = Math.max(0, (payload.enemyCount ?? elite) - elite)
      return {
        title: '精英伏击',
        desc: `${elite} 精英 + ${guards} 随从，金币 +${payload.gold ?? 0}`,
      }
    }
    case 'boss':
      return { title: 'Boss 房间', desc: '正面击破最终阶段 Boss，锁定通关' }
    case 'rest':
      return {
        title: '休憩营地',
        desc: `回血 ${Math.round(REST_HEAL_RATIO * 100)}%、充能 +${Math.round(REST_CHARGE_RATIO * 100)}%，安全但没金币`,
      }
    default:
      return { title: '未知房间', desc: '' }
  }
}

/**
 * 掷 3 扇门。isBossLayer 为 true（或即将进入最后一层）时三门全为 boss 房；
 * weaponLv 为角色当前专武等级（商人房货架需要），trainingBuys 为已购训练次数，
 * 两者不传时分别按 1 级 / 0 次算。
 */
export function rollTunnels(
  layer: number,
  totalLayers: number,
  isBossLayer: boolean,
  charId: CharacterId,
  rng: Rng,
  weaponLv = 1,
  trainingBuys = 0,
  difficulty: DifficultyId = 'normal',
): TunnelOffer[] {
  const current = clampLayer(layer)
  const bossDoor = isBossLayer || (totalLayers > 0 && current >= Math.round(totalLayers))
  const count = Math.max(1, Math.round(PORTALS.count))
  const offers: TunnelOffer[] = []
  const usedRooms = new Set<TunnelRoom>()
  for (let index = 0; index < count; index += 1) {
    const room: TunnelRoom = bossDoor ? 'boss' : rollRoomType(rng, current, usedRooms)
    usedRooms.add(room)
    const payload = makePayload(room, current, charId, rng, weaponLv, trainingBuys, difficulty)
    const text = describePayload(room, payload)
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
  trainingBuys = 0,
  difficulty: DifficultyId = 'normal',
): RoomResolution {
  const current = clampLayer(layer)
  const payload = offer.payload
  switch (offer.room) {
    case 'chest': {
      // 预览与结算必须同一次掷骰：payload.card 为 undefined 就是没出卡，
      // 不能在这里再掷一次 chestCardChance（否则实际出卡率会被抬高）。
      const card = payload.card
      return { gold: payload.gold ?? chestGold(current, difficulty), card }
    }
    case 'skill-card': {
      const skill = payload.skillCard ?? rollSkillCard(rng)
      return { card: skillCardToItem(skill) }
    }
    case 'merchant':
      return { shopOffers: payload.shopOffers ?? generateOffers(current, charId, 0, rng, undefined, 1, trainingBuys) }
    case 'altar':
      return {
        altarCost: payload.altarCost ?? altarCost(current),
        altarReward: payload.altarReward ?? rollAltarReward(current, rng),
      }
    case 'mob-wave':
      return {
        gold: payload.gold ?? battleGold(current, false, difficulty),
        enemies: {
          count: payload.enemyCount ?? mobWaveCount(current, difficulty),
          elite: 0,
        },
      }
    case 'elite-fight': {
      const comp = eliteFightComposition(current)
      return {
        gold: payload.gold ?? battleGold(current, true, difficulty),
        enemies: {
          count: payload.enemyCount ?? comp.count,
          elite: payload.eliteCount ?? comp.elite,
        },
      }
    }
    case 'boss':
      return {
        gold: payload.gold ?? battleGold(current, true, difficulty),
        enemies: { count: payload.enemyCount ?? 1, elite: 0 },
        bossLayer: true,
      }
    case 'rest':
      return { rest: { healRatio: REST_HEAL_RATIO, chargeRatio: REST_CHARGE_RATIO } }
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
