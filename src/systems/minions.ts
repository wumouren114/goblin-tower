import * as THREE from 'three'
import { getBillboardYaw } from '../art/sprites'
import { createMinionMesh } from '../art/minions'
import { nearestEnemy } from './attack'
import type { ProjectileSystem } from './projectiles'
import type { CombatWorld, Hittable } from './combat'

/** 召唤物参数由 Combat 按 balance 面板换算后传入 */
export interface MinionSpec {
  x: number
  z: number
  hp: number
  damage: number
  /** 攻击间隔（秒） */
  interval: number
  speed: number
  /** 跟随玩家的最大距离，超过则回追（默认 5） */
  followRange?: number
  /** 索敌/射击距离（默认 7） */
  range?: number
  /** 存活时间（默认 10s） */
  duration?: number
  bubbleSpeed?: number
  bubbleRange?: number
  bubbleHitRadius?: number
  scale?: number
  /** 会吸引哥布林仇恨（lv2 起） */
  taunt?: boolean
  /** 命中减速比例（lv4 起 0.2） */
  slow?: number
}

/**
 * 小肥鱼召唤物：会被哥布林打（game.ts 通过 minions 列表索敌），独立血量，死亡/到期消失。
 */
export class Minion {
  readonly mesh: THREE.Mesh
  readonly radius = 0.34
  readonly maxHp: number
  x: number
  z: number
  hp: number
  alive = true
  readonly damage: number
  readonly interval: number
  readonly speed: number
  readonly followRange: number
  readonly range: number
  readonly duration: number
  readonly bubbleSpeed: number
  readonly bubbleRange: number
  readonly bubbleHitRadius: number
  readonly taunt: boolean
  readonly slow?: number
  life: number
  nextShot: number
  orbit: number

  constructor(scene: THREE.Scene, spec: MinionSpec, index: number) {
    this.x = spec.x
    this.z = spec.z
    this.maxHp = spec.hp
    this.hp = spec.hp
    this.damage = spec.damage
    this.interval = spec.interval
    this.speed = spec.speed
    this.followRange = spec.followRange ?? 5
    this.range = spec.range ?? 7
    this.duration = spec.duration ?? 10
    this.bubbleSpeed = spec.bubbleSpeed ?? 9
    this.bubbleRange = spec.bubbleRange ?? 9
    this.bubbleHitRadius = spec.bubbleHitRadius ?? 0.3
    this.taunt = spec.taunt ?? false
    this.slow = spec.slow
    this.life = this.duration
    this.nextShot = this.interval * (0.4 + 0.2 * index)
    this.orbit = index * 1.7
    this.mesh = createMinionMesh(spec.scale ?? 1)
    this.mesh.position.set(this.x, 0, this.z)
    this.mesh.rotation.set(0, getBillboardYaw() + Math.PI / 2, 0)
    scene.add(this.mesh)
  }

  /** 被哥布林打；返回是否死亡 */
  hit(amount: number, kx = 0, kz = 0): boolean {
    if (!this.alive) return false
    this.hp -= Math.max(0, amount)
    this.x += kx * 0.18
    this.z += kz * 0.18
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      return true
    }
    return false
  }
}

export interface MinionHooks {
  burst(x: number, z: number, color: number, count?: number): void
}

export class MinionSystem {
  private readonly scene: THREE.Scene
  private readonly projectiles: ProjectileSystem
  private readonly hooks: MinionHooks
  private readonly items: Minion[] = []

  constructor(scene: THREE.Scene, projectiles: ProjectileSystem, hooks: MinionHooks) {
    this.scene = scene
    this.projectiles = projectiles
    this.hooks = hooks
  }

  get count(): number {
    return this.items.length
  }

  /** 供 game.ts 让哥布林索敌 */
  get minions(): readonly Minion[] {
    return this.items
  }

  spawn(specs: MinionSpec[]): void {
    this.clear()
    specs.forEach((spec, i) => this.items.push(new Minion(this.scene, spec, i)))
  }

  /** 主动伤害某只召唤物（哥布林攻击） */
  damageAt(target: Minion, amount: number, kx = 0, kz = 0): boolean {
    const died = target.hit(amount, kx, kz)
    if (died) this.remove(target)
    return died
  }

  update(dt: number, px: number, pz: number, world: CombatWorld): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i]
      m.life -= dt
      if (m.life <= 0 || !m.alive) {
        this.remove(m)
        continue
      }
      // 离玩家太远就回追，否则围绕玩家游动
      const dxp = px - m.x
      const dzp = pz - m.z
      const dp = Math.hypot(dxp, dzp)
      if (dp > m.followRange) {
        const step = Math.min(m.speed * 1.25 * dt, dp)
        m.x += (dxp / Math.max(1e-4, dp)) * step
        m.z += (dzp / Math.max(1e-4, dp)) * step
      } else {
        // 保持 2.2m 左右的环绕，不挡玩家路
        m.orbit += dt * 1.6
        const ox = px + Math.cos(m.orbit) * 2.2
        const oz = pz + Math.sin(m.orbit) * 2.2
        const dx = ox - m.x
        const dz = oz - m.z
        const d = Math.hypot(dx, dz)
        if (d > 0.25) {
          const step = Math.min(m.speed * 0.7 * dt, d)
          m.x += (dx / d) * step
          m.z += (dz / d) * step
        }
      }
      const c = world.clamp(m.x, m.z)
      m.x = c.x
      m.z = c.z

      // 射击：优先打最近的、玩家 5m 内的敌人
      m.nextShot -= dt
      if (m.nextShot <= 0) {
        const target = nearestEnemy(world.enemies, m.x, m.z, m.range)
        const withinPlayer = target ? Math.hypot(target.x - px, target.z - pz) <= m.range + 2 : false
        if (target && withinPlayer) {
          const dx = target.x - m.x
          const dz = target.z - m.z
          const d = Math.hypot(dx, dz) || 1
          this.projectiles.spawn({
            kind: 'bubble',
            x: m.x,
            z: m.z,
            y: 0.6,
            dirX: dx / d,
            dirZ: dz / d,
            speed: m.bubbleSpeed,
            damage: m.damage,
            range: Math.min(m.bubbleRange, d + 1),
            hitRadius: m.bubbleHitRadius,
            scale: 0.8,
            color: 0x9fe8ff,
            canCrit: false,
            slow: m.slow,
          })
          m.nextShot = m.interval
        } else {
          m.nextShot = 0.2
        }
      }

      m.mesh.position.set(m.x, Math.sin((m.duration - m.life) * 7) * 0.04, m.z)
      m.mesh.rotation.set(0, getBillboardYaw() + Math.PI / 2, 0)
    }
  }

  clear(): void {
    for (let i = this.items.length - 1; i >= 0; i--) this.remove(this.items[i])
  }

  dispose(): void {
    this.clear()
  }

  private remove(m: Minion): void {
    const idx = this.items.indexOf(m)
    if (idx < 0) return
    this.items.splice(idx, 1)
    this.scene.remove(m.mesh)
    m.mesh.geometry.dispose()
    ;(m.mesh.material as THREE.Material).dispose()
    this.hooks.burst(m.x, m.z, 0x9fe8ff, 10)
  }
}
