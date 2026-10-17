import type { PlayerStats, UpgradeDef } from '../types'
import { UPGRADES } from '../data/upgrades'

/** 基础面板 + 已选升级 → 当前面板（先加后乘） */
export function computeStats(base: PlayerStats, stacks: Map<string, number>): PlayerStats {
  const s: PlayerStats = { ...base }
  for (const u of UPGRADES) {
    const n = stacks.get(u.id) ?? 0
    if (!n) continue
    if (u.add) {
      for (const key of Object.keys(u.add) as (keyof PlayerStats)[]) {
        s[key] = s[key] + (u.add[key] as number) * n
      }
    }
    if (u.mul) {
      for (const key of Object.keys(u.mul) as (keyof PlayerStats)[]) {
        s[key] = s[key] * Math.pow(1 + (u.mul[key] as number), n)
      }
    }
  }
  s.critChance = Math.min(0.85, Math.max(0, s.critChance))
  s.attackSpeed = Math.max(0.3, s.attackSpeed)
  s.moveSpeed = Math.max(2, s.moveSpeed)
  s.dashCooldown = Math.max(0.35, s.dashCooldown)
  s.damage = Math.max(1, s.damage)
  return s
}

/** 加权随机抽取 count 个未满层的升级 */
export function rollUpgradeChoices(
  stacks: Map<string, number>,
  count: number,
  random: () => number,
): UpgradeDef[] {
  const pool = UPGRADES.filter((u) => (stacks.get(u.id) ?? 0) < u.maxStacks)
  const picked: UpgradeDef[] = []
  while (picked.length < count && pool.length > 0) {
    let total = 0
    for (const u of pool) total += u.weight
    let r = random() * total
    let idx = 0
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].weight
      if (r <= 0) {
        idx = i
        break
      }
    }
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}
