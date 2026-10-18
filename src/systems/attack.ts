import type { Hittable } from './combat'

/**
 * 近战/突进的几何判定（纯函数，方便冒烟测试）。
 * 所有坐标都是世界系：x 右、z 后，单位米。
 */

export function distanceToSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0
  const dz = z1 - z0
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-8) return Math.hypot(px - x0, pz - z0)
  let t = ((px - x0) * dx + (pz - z0) * dz) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = x0 + dx * t
  const cz = z0 + dz * t
  return Math.hypot(px - cx, pz - cz)
}

/** 扇形（cone）目标：包含目标半径，最多 maxTargets 个，按距离从近到远 */
export function pickConeTargets(
  enemies: Hittable[],
  px: number,
  pz: number,
  dirX: number,
  dirZ: number,
  range: number,
  angleDeg: number,
  maxTargets = 8,
): Hittable[] {
  const len = Math.hypot(dirX, dirZ)
  if (len < 1e-5 || range <= 0) return []
  const ax = dirX / len
  const az = dirZ / len
  const cosHalf = Math.cos((Math.max(1, Math.min(360, angleDeg)) * Math.PI) / 180 / 2)
  const found: { t: Hittable; d: number }[] = []
  for (const t of enemies) {
    if (!t.alive) continue
    const dx = t.x - px
    const dz = t.z - pz
    const d = Math.hypot(dx, dz)
    if (d > range + t.radius) continue
    if (d > 1e-4) {
      const dot = (dx * ax + dz * az) / d
      if (dot < cosHalf) continue
    }
    found.push({ t, d })
  }
  found.sort((a, b) => a.d - b.d)
  return found.slice(0, Math.max(0, maxTargets)).map((f) => f.t)
}

/** 突进路径命中：线段周围 width/2 内的敌人 */
export function pickLineTargets(
  enemies: Hittable[],
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  width: number,
): Hittable[] {
  const half = Math.max(0.05, width / 2)
  const out: Hittable[] = []
  for (const t of enemies) {
    if (!t.alive) continue
    if (distanceToSegment(t.x, t.z, x0, z0, x1, z1) <= half + t.radius) out.push(t)
  }
  return out
}

/** 最近敌人（可排除集合），供弹射/召唤物索敌 */
export function nearestEnemy(
  enemies: Hittable[],
  x: number,
  z: number,
  maxDist: number,
  exclude?: Set<Hittable>,
): Hittable | null {
  let best: Hittable | null = null
  let bestD = maxDist
  for (const t of enemies) {
    if (!t.alive) continue
    if (exclude && exclude.has(t)) continue
    const d = Math.hypot(t.x - x, t.z - z)
    if (d <= bestD) {
      bestD = d
      best = t
    }
  }
  return best
}

/** 把敌人朝 (tx,tz) 拉近 distance 米（不会穿过目标点） */
export function pullToward(t: Hittable, tx: number, tz: number, distance: number): void {
  if (!t.alive || distance <= 0) return
  const dx = tx - t.x
  const dz = tz - t.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-4) return
  const step = Math.min(distance, Math.max(0, d - 0.35))
  t.x += (dx / d) * step
  t.z += (dz / d) * step
}

/** 把敌人收到距 (cx,cz) 的 standoff 处（突进终点聚怪） */
export function gatherTo(t: Hittable, cx: number, cz: number, standoff: number): void {
  if (!t.alive) return
  const dx = t.x - cx
  const dz = t.z - cz
  const d = Math.hypot(dx, dz)
  if (d <= standoff || d < 1e-4) return
  t.x = cx + (dx / d) * standoff
  t.z = cz + (dz / d) * standoff
}
