import { BALANCE } from './balance'
import type { CharacterId } from '../types'

/**
 * 角色专武运行时数据：只从 balance.json 的 weapons 段读，禁止在代码里写死。
 * balance.ts 的 BalanceShape 没有声明 weapons，这里做一次窄化 cast。
 */
export interface WeaponTier {
  lv: number
  damage: number
  desc?: string
  /** balance 里各等级的附加字段（projectiles/bounce/skillHeal/...） */
  [key: string]: number | string | undefined
}

interface WeaponDef {
  name?: string
  tiers?: WeaponTier[]
}

const WEAPONS = ((BALANCE as unknown as { weapons?: Record<string, WeaponDef> }).weapons ?? {}) as Record<string, WeaponDef>

/**
 * 专武最高等级：由 balance.json 各角色 tiers 的 lv 推出（当前 7 档），
 * 不再写死数字——以后加专武等级只改数据，代码自动跟上。
 */
export const MAX_WEAPON_LV = Math.max(
  1,
  ...Object.values(WEAPONS).flatMap((w) => (w.tiers ?? []).map((t) => t.lv)),
)

/** 取角色专武某一档；level 自动夹在 1..MAX，找不到时退回最近一档 */
export function getWeaponTier(charId: CharacterId, level: number): WeaponTier {
  const tiers = WEAPONS[charId]?.tiers ?? []
  const lv = Math.max(1, Math.min(MAX_WEAPON_LV, Math.round(level) || 1))
  const tier = tiers.find((t) => t.lv === lv) ?? tiers[Math.min(tiers.length - 1, lv - 1)]
  return tier ?? { lv, damage: 0 }
}

/** 读 tier 上的数值字段，缺失时用 fallback（balance 的老等级会省略字段） */
export function tierNum(tier: WeaponTier, key: string, fallback = 0): number {
  const v = tier[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 受击倍率：丛雨近战吃亏、肥鱼血薄，与模拟器口径一致（丛雨 1.45） */
const TAKE_DAMAGE_MUL: Record<CharacterId, number> = {
  mutsumi: 1,
  murasame: 1.05,
  fish: 0.85,
}

export function charTakeDamageMul(charId: CharacterId): number {
  return TAKE_DAMAGE_MUL[charId] ?? 1
}
