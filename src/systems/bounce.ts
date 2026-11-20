/**
 * 交响·折射 —— 弹道撞圆形障碍物的法线镜像反射纯函数。
 * 零外部依赖，供 ProjectileSystem 与离线冒烟/预览脚本共用。
 */

export interface Obstacle {
  x: number
  z: number
  r: number
}

export interface BounceResult {
  dirX: number
  dirZ: number
  x: number
  z: number
}

/** 命中障碍则返回镜像反射后的方向与位置；未命中返回 null */
export function reflectOffObstacle(
  dirX: number,
  dirZ: number,
  px: number,
  pz: number,
  ob: Obstacle,
): BounceResult | null {
  const dx = px - ob.x
  const dz = pz - ob.z
  const dist = Math.hypot(dx, dz)
  if (dist > ob.r + 0.25 || dist < 1e-4) return null
  const nx = dx / dist
  const nz = dz / dist
  const dot = dirX * nx + dirZ * nz
  if (dot >= 0) return null
  return {
    dirX: dirX - 2 * dot * nx,
    dirZ: dirZ - 2 * dot * nz,
    x: ob.x + nx * (ob.r + 0.3),
    z: ob.z + nz * (ob.r + 0.3),
  }
}
