import type { CharacterId } from '../types'

/**
 * 角色运行时基础参数（原专武等级表已彻底退役，仅保留角色受击倍率）。
 */
const TAKE_DAMAGE_MUL: Record<CharacterId, number> = {
  mutsumi: 1,
  murasame: 1.05,
  fish: 0.85,
}

export function charTakeDamageMul(charId: CharacterId): number {
  return TAKE_DAMAGE_MUL[charId] ?? 1
}
