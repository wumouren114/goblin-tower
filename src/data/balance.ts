import raw from './balance.json'

/** 难度标识（与 balance.json 的 difficulties 键一致） */
export type DifficultyId = 'easy' | 'normal' | 'hard'

export interface DifficultyDef {
  name: string
  stages: number[]
  countMul: number
  hpMul: number
  damageMul: number
  spawnMul: number
  goldMul: number
  xpMul: number
  timerMul: number
  note: string
}

interface LayerCurve {
  mobHpBase: number
  mobHpPerLayer: number
  mobDamageBase: number
  mobDamagePerLayer: number
  quotaBase: number
  quotaPerLayer: number
  spawnIntervalBase: number
  spawnIntervalDecay: number
  spawnIntervalMin: number
  spawnBatchBase: number
  maxAliveBase: number
  maxAlivePerLayer: number
  maxAliveCap: number
  /** 小怪移速：base + perLayer × (层-1)，封顶 cap */
  mobSpeedBase: number
  mobSpeedPerLayer: number
  mobSpeedCap: number
  clearGoldBase: number
  clearGoldPerLayer: number
  goldPerKillBase: number
  goldPerKillEveryLayers: number
  xpPerKillBase: number
  xpPerKillPerLayer: number
  bossHpBase: number
  bossHpPerLayer: number
  timeoutHpPenaltyRatio: number
  timeoutSkipsReward: boolean
}

export interface WarmupStep {
  hpMul: number
  damageMul: number
  spawnMul: number
  timerBonus: number
  maxAliveMul: number
}

export interface BuffCardDef {
  id: string
  name: string
  stat: string
  value: number
  basePrice: number
  maxStacks: number
  desc: string
}

interface BalanceShape {
  meta: { version: number; layerTimerSeconds: number; bossTimerSeconds: number }
  difficulties: Record<DifficultyId, DifficultyDef>
  layerCurve: LayerCurve
  portals: Record<string, unknown>
  shop: Record<string, unknown>
  buffCards: BuffCardDef[]
  warmup: { note: string; easyNormal: WarmupStep[]; hard: WarmupStep[] }
}

export const BALANCE = raw as unknown as BalanceShape
export const LAYER_CURVE: LayerCurve = BALANCE.layerCurve
export const DIFFICULTIES = BALANCE.difficulties

export const DIFFICULTY_IDS: DifficultyId[] = ['easy', 'normal', 'hard']

/** 一局总层数 */
export function layerCount(id: DifficultyId): number {
  return DIFFICULTIES[id].stages.reduce((a, b) => a + b, 0)
}

/** 第 layer 层（1 起）是否阶段 Boss 层 */
export function isBossLayer(id: DifficultyId, layer: number): boolean {
  let acc = 0
  for (const size of DIFFICULTIES[id].stages) {
    acc += size
    if (layer === acc) return true
  }
  return false
}

/** 第 layer 层属于第几个阶段（1 起） */
export function stageOfLayer(id: DifficultyId, layer: number): number {
  let acc = 0
  const stages = DIFFICULTIES[id].stages
  for (let i = 0; i < stages.length; i += 1) {
    acc += stages[i]
    if (layer <= acc) return i + 1
  }
  return stages.length
}

/** Boss 层以外的阶段首层 = 小怪层入口（阶段第一层） */
export function isStageFirstLayer(id: DifficultyId, layer: number): boolean {
  let prev = 0
  for (const size of DIFFICULTIES[id].stages) {
    if (layer === prev + 1) return true
    prev += size
  }
  return false
}

export function warmupFor(id: DifficultyId, layer: number): WarmupStep | null {
  const table = id === 'hard' ? BALANCE.warmup.hard : BALANCE.warmup.easyNormal
  return table[layer - 1] ?? null
}

export function mobHpFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  const w = warmupFor(id, layer)
  return Math.round(c.mobHpBase * (1 + c.mobHpPerLayer * (layer - 1)) * DIFFICULTIES[id].hpMul * (w?.hpMul ?? 1))
}

export function mobDamageFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  const w = warmupFor(id, layer)
  return c.mobDamageBase * (1 + c.mobDamagePerLayer * (layer - 1)) * DIFFICULTIES[id].damageMul * (w?.damageMul ?? 1)
}

/**
 * 第 layer 层小怪移速倍率（数据驱动：layerCurve.mobSpeed*）。
 * 只作用于小怪（由 game.ts 传入 Goblin.mul.layerSpeed），不影响玩家与 Boss。
 */
export function mobSpeedMulFor(layer: number): number {
  const c = LAYER_CURVE
  const lv = Math.max(1, Math.round(layer))
  return Math.min(c.mobSpeedCap, c.mobSpeedBase + c.mobSpeedPerLayer * (lv - 1))
}

export function quotaFor(id: DifficultyId, layer: number): number
export function quotaFor(layer: number): number
export function quotaFor(idOrLayer: DifficultyId | number, layer?: number): number {
  const diffId = typeof idOrLayer === 'number' ? null : idOrLayer
  const lv = typeof idOrLayer === 'number' ? idOrLayer : (layer ?? 1)
  const base = LAYER_CURVE.quotaBase + LAYER_CURVE.quotaPerLayer * (lv - 1)
  const mul = diffId ? (DIFFICULTIES[diffId].countMul ?? 1) : 1
  return Math.round(base * mul)
}

export function spawnIntervalFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  const w = warmupFor(id, layer)
  return (Math.max(c.spawnIntervalMin, c.spawnIntervalBase - c.spawnIntervalDecay * (layer - 1)) / DIFFICULTIES[id].spawnMul) * (w?.spawnMul ?? 1)
}

export function maxAliveFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  const w = warmupFor(id, layer)
  return Math.min(c.maxAliveCap, Math.round((c.maxAliveBase + c.maxAlivePerLayer * (layer - 1)) * (w?.maxAliveMul ?? 1)))
}

export function clearGoldFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  return Math.round((c.clearGoldBase + c.clearGoldPerLayer * (layer - 1)) * DIFFICULTIES[id].goldMul)
}

export function goldPerKillFor(layer: number): number {
  return LAYER_CURVE.goldPerKillBase + Math.floor((layer - 1) / LAYER_CURVE.goldPerKillEveryLayers)
}

export function xpPerKillFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  return (c.xpPerKillBase + c.xpPerKillPerLayer * (layer - 1)) * DIFFICULTIES[id].xpMul
}

export function bossHpFor(id: DifficultyId, layer: number): number {
  const c = LAYER_CURVE
  return Math.round(c.bossHpBase * (1 + c.bossHpPerLayer * (layer - 1)) * DIFFICULTIES[id].hpMul)
}

export function layerTimerFor(id: DifficultyId, boss: boolean, layer = 1): number {
  const base = boss ? BALANCE.meta.bossTimerSeconds : BALANCE.meta.layerTimerSeconds
  const w = boss ? null : warmupFor(id, layer)
  return base * DIFFICULTIES[id].timerMul + (w?.timerBonus ?? 0)
}

/** 商店实际价格：基准价 × (1 + 每层涨幅 × (层 - 1)) × 品质倍率 */
export function shopPriceFor(base: number, layer: number, qualityMul = 1): number {
  const growth = (BALANCE.shop.priceGrowthPerLayer as number) * (layer - 1)
  return Math.round(base * (1 + growth) * qualityMul)
}

export interface QualityRoll {
  tier: 1 | 2 | 3
  valueMul: number
  priceMul: number
}

/** 按层数掷商店品质：层越深越容易出精制/臻品 */
export function rollQuality(layer: number, random: () => number = Math.random): QualityRoll {
  const q = BALANCE.shop.quality as
    | {
        tierUpStartLayer: number
        tier2: { chancePerLayer: number; chanceCap: number; valueMul: number; priceMul: number }
        tier3: { startLayer: number; chancePerLayer: number; chanceCap: number; valueMul: number; priceMul: number }
      }
    | undefined
  if (!q) return { tier: 1, valueMul: 1, priceMul: 1 }
  const t2 = Math.min(q.tier2.chanceCap, q.tier2.chancePerLayer * Math.max(0, layer - q.tierUpStartLayer + 1))
  const t3 = Math.min(q.tier3.chanceCap, q.tier3.chancePerLayer * Math.max(0, layer - q.tier3.startLayer + 1))
  const r = random()
  if (r < t3) return { tier: 3, valueMul: q.tier3.valueMul, priceMul: q.tier3.priceMul }
  if (r < t3 + t2) return { tier: 2, valueMul: q.tier2.valueMul, priceMul: q.tier2.priceMul }
  return { tier: 1, valueMul: 1, priceMul: 1 }
}
