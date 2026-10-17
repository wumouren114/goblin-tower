import { CONFIG } from '../data/gameConfig'
import type { PlayerStats } from '../types'
import * as THREE from 'three'

/** 回旋刃可命中的目标（哥布林 / Boss 都满足这个结构） */
export interface BladeTarget {
  x: number
  z: number
  radius: number
  alive: boolean
  hit(amount: number, kx: number, kz: number): boolean
}

function makeBladeTexture(): THREE.CanvasTexture {
  const size = 64
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  ctx.translate(size / 2, size / 2)
  ctx.rotate(-Math.PI / 5)
  const g = ctx.createLinearGradient(-18, 0, 18, 0)
  g.addColorStop(0, 'rgba(160,255,240,0)')
  g.addColorStop(0.45, 'rgba(170,255,245,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,1)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.moveTo(-20, -9)
  ctx.quadraticCurveTo(2, -16, 22, 0)
  ctx.quadraticCurveTo(2, 16, -20, 9)
  ctx.quadraticCurveTo(-6, 0, -20, -9)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/**
 * 回旋刃：本作第一版自动武器（不需要瞄准，符合幸存者类手感）。
 * 数值全部来自 PlayerStats，方便后续做武器树/超武。
 */
export class Blades {
  readonly group = new THREE.Group()
  private sprites: THREE.Sprite[] = []
  private texture: THREE.CanvasTexture
  private angle = 0
  private cooldowns = new WeakMap<object, number>()
  private scratch = new THREE.Vector3()

  constructor(scene: THREE.Scene) {
    this.texture = makeBladeTexture()
    scene.add(this.group)
    this.setCount(2)
  }

  setCount(n: number): void {
    while (this.sprites.length < n) {
      const mat = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xcffff9,
      })
      const s = new THREE.Sprite(mat)
      s.scale.set(1.05, 1.05, 1)
      s.frustumCulled = false
      this.sprites.push(s)
      this.group.add(s)
    }
    for (let i = 0; i < this.sprites.length; i++) this.sprites[i].visible = i < n
  }

  get hitRadius(): number {
    return 0.62
  }

  positions(stats: PlayerStats, px: number, pz: number): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = []
    const n = Math.max(1, Math.round(stats.blades))
    for (let i = 0; i < n; i++) {
      const a = this.angle + (i * Math.PI * 2) / n
      out.push({ x: px + Math.cos(a) * stats.attackRadius, z: pz + Math.sin(a) * stats.attackRadius })
    }
    return out
  }

  /**
   * 推进回旋刃并结算命中。
   * 每把刃对同一目标有独立冷却，避免每帧无限伤害。
   */
  update(
    dt: number,
    px: number,
    pz: number,
    stats: PlayerStats,
    targets: BladeTarget[],
    onHit: (target: BladeTarget, amount: number, crit: boolean, killed: boolean) => void,
  ): void {
    this.angle += dt * CONFIG.blade.spin * stats.attackSpeed
    const n = Math.max(1, Math.round(stats.blades))
    this.setCount(n)
    const positions = this.positions(stats, px, pz)

    for (let i = 0; i < this.sprites.length; i++) {
      const p = positions[i]
      const s = this.sprites[i]
      s.visible = true
      s.position.set(p.x, 0.95, p.z)
      s.material.rotation = this.angle * 2.2 + i
    }

    const cooldown = CONFIG.blade.hitCooldown / stats.attackSpeed
    for (const target of targets) {
      if (!target.alive) continue
      let cd = this.cooldowns.get(target) ?? 0
      cd -= dt
      if (cd > 0) {
        this.cooldowns.set(target, cd)
        continue
      }
      let hit = false
      for (const p of positions) {
        const dx = target.x - p.x
        const dz = target.z - p.z
        const rr = target.radius + this.hitRadius
        if (dx * dx + dz * dz <= rr * rr) {
          hit = true
          break
        }
      }
      if (!hit) {
        this.cooldowns.set(target, 0)
        continue
      }
      const crit = Math.random() < stats.critChance
      const amount = stats.damage * (crit ? stats.critMultiplier : 1)
      const kx = target.x - px
      const kz = target.z - pz
      const len = Math.hypot(kx, kz) || 1
      const killed = target.hit(amount, (kx / len) * CONFIG.blade.knockback, (kz / len) * CONFIG.blade.knockback)
      this.cooldowns.set(target, cooldown)
      onHit(target, amount, crit, killed)
    }
  }

  dispose(): void {
    for (const s of this.sprites) {
      this.group.remove(s)
      s.material.dispose()
    }
    this.sprites.length = 0
    this.texture.dispose()
    this.group.parent?.remove(this.group)
  }
}
