import * as THREE from 'three'
import { projectileArtInfo, type ProjectileArtKind } from '../art/projectiles'
import { BillboardBatch } from '../art/billboardBatch'
import { nearestEnemy } from './attack'
import type { Hittable } from './combat'

/** 单发弹道参数：伤害已在 Combat 里按面板换算好 */
export interface ProjectileSpec {
  kind: ProjectileArtKind
  x: number
  z: number
  /** 离地高度，默认 0.75 */
  y?: number
  dirX: number
  dirZ: number
  speed: number
  damage: number
  /** 飞行距离（米） */
  range: number
  hitRadius: number
  pierce?: number
  bounce?: number
  bounceMul?: number
  bounceRange?: number
  scale?: number
  color?: number
  additive?: boolean
  spin?: number
  canCrit?: boolean
  /** 命中减速（0..1），敌人实现可选的 slow(mul, duration) */
  slow?: number
  /** v4.6：伤害来源；召唤物弹道不产生玩家资源 */
  source?: 'player' | 'minion'
  /** v4.6：睦的穿透和弦 */
  chord?: boolean
  /** v4.6：肥鱼的大泡泡 */
  big?: boolean
}

export interface ProjectileHitContext {
  kind: ProjectileArtKind
  dirX: number
  dirZ: number
  canCrit: boolean
  slow?: number
  source: 'player' | 'minion'
  chord?: boolean
  big?: boolean
}

export interface ProjectileBurstContext {
  kind: ProjectileArtKind
  source: 'player' | 'minion'
  chord: boolean
  big: boolean
}

export interface ProjectileHooks {
  /** Combat 负责暴击、hit()、onHit 回调；返回后弹道决定穿透/弹射/消失 */
  resolveHit(t: Hittable, damage: number, ctx: ProjectileHitContext): void
  burst(x: number, z: number, color: number, count?: number, ctx?: ProjectileBurstContext): void
}

interface Projectile {
  batch: BillboardBatch
  index: number
  /** 合批实例尺寸（已乘 spec.scale） */
  worldW: number
  worldH: number
  /** 原画 flipY=false：实例 UV 需要翻转 v */
  art: boolean
  kind: ProjectileArtKind
  x: number
  z: number
  y: number
  dirX: number
  dirZ: number
  speed: number
  damage: number
  range: number
  traveled: number
  hitRadius: number
  pierce: number
  bounce: number
  bounceMul: number
  bounceRange: number
  canCrit: boolean
  slow?: number
  source: 'player' | 'minion'
  chord: boolean
  big: boolean
  color: number
  spin: number
  spinSpeed: number
  hit: Set<Hittable>
  alive: boolean
}

const DEFAULT_COLOR: Record<ProjectileArtKind, number> = {
  cucumber: 0xb7f28a,
  bubble: 0x9fe8ff,
  wave: 0xd7b6ff,
  rice: 0xffffff,
  slash: 0xbffcf0,
}

/** 弹道系统的纯逻辑 + billboard 表现；命中结算回调解给 Combat */
export class ProjectileSystem {
  private readonly scene: THREE.Scene
  private readonly hooks: ProjectileHooks
  private readonly items: Projectile[] = []
  /** 每种「弹道贴图 + 混合方式」一个批，单 drawcall */
  private readonly batches = new Map<string, BillboardBatch>()

  constructor(scene: THREE.Scene, hooks: ProjectileHooks) {
    this.scene = scene
    this.hooks = hooks
  }

  get count(): number {
    return this.items.length
  }

  spawn(spec: ProjectileSpec): void {
    const len = Math.hypot(spec.dirX, spec.dirZ)
    if (len < 1e-5 || spec.speed <= 0 || spec.range <= 0) return
    const dirX = spec.dirX / len
    const dirZ = spec.dirZ / len
    const kind = spec.kind
    const color = spec.color ?? DEFAULT_COLOR[kind]
    const additive = spec.additive ?? (kind === 'wave' || kind === 'slash')
    const info = projectileArtInfo(kind)
    const batch = this.batchFor(kind, additive, info.texture)
    const index = batch.acquire()
    const scale = spec.scale ?? 1
    const worldW = info.worldW * scale
    const worldH = info.worldH * scale
    const y = spec.y ?? 0.75
    batch.set(index, spec.x, y, spec.z, worldW, worldH, color, 1, 0, info.art ? 1 : 0, 1, info.art ? -1 : 1, 0)
    this.items.push({
      batch,
      index,
      worldW,
      worldH,
      art: info.art,
      kind,
      x: spec.x,
      z: spec.z,
      y,
      dirX,
      dirZ,
      speed: spec.speed,
      damage: spec.damage,
      range: spec.range,
      traveled: 0,
      hitRadius: Math.max(0.05, spec.hitRadius),
      pierce: Math.max(0, Math.floor(spec.pierce ?? 0)),
      bounce: Math.max(0, Math.floor(spec.bounce ?? 0)),
      bounceMul: spec.bounceMul ?? 0.6,
      bounceRange: spec.bounceRange ?? 4.5,
      canCrit: spec.canCrit ?? true,
      slow: spec.slow,
      source: spec.source ?? 'player',
      chord: spec.chord ?? false,
      big: spec.big ?? false,
      color,
      spin: spec.spin ?? 0,
      spinSpeed: spec.spin ?? 0,
      hit: new Set<Hittable>(),
      alive: true,
    })
  }

  update(dt: number, enemies: Hittable[], halfSize: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i]
      if (!p.alive) {
        this.remove(i)
        continue
      }
      const dist = p.speed * dt
      const steps = Math.max(1, Math.ceil(dist / 0.12))
      const stepLen = dist / steps
      for (let s = 0; s < steps && p.alive; s++) {
        p.x += p.dirX * stepLen
        p.z += p.dirZ * stepLen
        p.traveled += stepLen
        if (this.hitSomething(p, enemies)) break
        if (p.traveled >= p.range || Math.abs(p.x) > halfSize + 2 || Math.abs(p.z) > halfSize + 2) {
          p.alive = false
        }
      }
      if (p.alive) {
        p.spin += p.spinSpeed * dt
        p.batch.set(
          p.index,
          p.x,
          p.y + Math.sin(p.traveled * 3) * 0.03,
          p.z,
          p.worldW,
          p.worldH,
          p.color,
          1,
          0,
          p.art ? 1 : 0,
          1,
          p.art ? -1 : 1,
          p.spin,
        )
      }
      if (!p.alive) this.remove(i)
    }
    for (const batch of this.batches.values()) batch.flush()
  }

  /** 返回 true 表示这一小步撞到目标（不再继续推进本帧） */
  private hitSomething(p: Projectile, enemies: Hittable[]): boolean {
    let consumed = false
    for (const t of enemies) {
      if (!t.alive || p.hit.has(t)) continue
      const rr = p.hitRadius + t.radius
      const dx = t.x - p.x
      const dz = t.z - p.z
      if (dx * dx + dz * dz > rr * rr) continue
      p.hit.add(t)
      this.hooks.resolveHit(t, p.damage, {
        kind: p.kind,
        dirX: p.dirX,
        dirZ: p.dirZ,
        canCrit: p.canCrit,
        slow: p.slow,
        source: p.source,
        chord: p.chord,
        big: p.big,
      })
      this.hooks.burst(t.x, t.z, p.color, p.kind === 'wave' ? 14 : 7, {
        kind: p.kind,
        source: p.source,
        chord: p.chord,
        big: p.big,
      })
      if (p.pierce > 0) {
        p.pierce--
        continue
      }
      if (p.bounce > 0) {
        const next = nearestEnemy(enemies, p.x, p.z, p.bounceRange, p.hit)
        if (next) {
          const nx = next.x - p.x
          const nz = next.z - p.z
          const nl = Math.hypot(nx, nz) || 1
          p.dirX = nx / nl
          p.dirZ = nz / nl
          p.damage *= p.bounceMul
          p.bounce--
          p.traveled = Math.max(0, p.range - p.bounceRange * 2)
          consumed = true
          break
        }
      }
      p.alive = false
      consumed = true
      break
    }
    return consumed
  }

  clear(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(i)
  }

  dispose(): void {
    this.clear()
    for (const batch of this.batches.values()) batch.dispose()
    this.batches.clear()
  }

  private batchFor(kind: ProjectileArtKind, additive: boolean, texture: THREE.Texture): BillboardBatch {
    const key = `${kind}:${additive ? 1 : 0}`
    let batch = this.batches.get(key)
    if (!batch) {
      batch = new BillboardBatch(this.scene, texture, 64, {
        renderOrder: 4,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      this.batches.set(key, batch)
    }
    return batch
  }

  private remove(index: number): void {
    const p = this.items[index]
    if (!p) return
    p.batch.release(p.index)
    this.items.splice(index, 1)
  }
}
