import * as THREE from 'three'
import { BillboardBatch } from '../art/billboardBatch'

type TextureKind = 'glow' | 'ring' | 'shard' | 'spark'

interface Particle {
  index: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size0: number
  size1: number
  gravity: number
  active: boolean
  drag: number
  color: number
  u0: number
  v0: number
}

interface RingFx {
  index: number
  x: number
  y: number
  z: number
  life: number
  maxLife: number
  scale0: number
  scale1: number
  active: boolean
  color: number
  alpha0: number
}

const ATLAS_SIZE = 96
const ATLAS_COLS = 2
const ATLAS_ROWS = 2

/** 2×2 图集：左上 glow、右上 ring、左下 shard、右下 spark */
const UV_OFFSET: Record<TextureKind, [number, number]> = {
  glow: [0, 0.5],
  ring: [0.5, 0.5],
  shard: [0, 0],
  spark: [0.5, 0],
}

function paintTexture(ctx: CanvasRenderingContext2D, kind: TextureKind, ox: number, oy: number): void {
  const size = ATLAS_SIZE
  const cx = ox + size / 2
  const cy = oy + size / 2
  if (kind === 'glow') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(ox, oy, size, size)
  } else if (kind === 'ring') {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = size * 0.09
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.38, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 0.35
    ctx.lineWidth = size * 0.04
    ctx.beginPath()
    ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  } else if (kind === 'shard') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(ox + size * 0.36, oy + size * 0.36, size * 0.28, size * 0.28)
    ctx.globalAlpha = 0.4
    ctx.fillRect(ox + size * 0.28, oy + size * 0.28, size * 0.44, size * 0.44)
    ctx.globalAlpha = 1
  } else {
    // 四角星光
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(ox, oy, size, size)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(cx, oy + 4)
    ctx.lineTo(cx + 7, cy - 8)
    ctx.lineTo(ox + size - 4, cy)
    ctx.lineTo(cx + 7, cy + 8)
    ctx.lineTo(cx, oy + size - 4)
    ctx.lineTo(cx - 7, cy + 8)
    ctx.lineTo(ox + 4, cy)
    ctx.lineTo(cx - 7, cy - 8)
    ctx.closePath()
    ctx.fill()
  }
}

function makeAtlas(): THREE.CanvasTexture {
  const size = ATLAS_SIZE * ATLAS_COLS
  const c = document.createElement('canvas')
  c.width = size
  c.height = ATLAS_SIZE * ATLAS_ROWS
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  paintTexture(ctx, 'glow', 0, 0)
  paintTexture(ctx, 'ring', ATLAS_SIZE, 0)
  paintTexture(ctx, 'shard', 0, ATLAS_SIZE)
  paintTexture(ctx, 'spark', ATLAS_SIZE, ATLAS_SIZE)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

export interface BurstOptions {
  color?: number
  count?: number
  speed?: number
  life?: number
  size?: number
  gravity?: number
  y?: number
  spread?: number
  texture?: TextureKind
}

/** 轻量粒子/光环特效池：全部合批进 1 个 InstancedMesh（1 drawcall） */
export class Vfx {
  private readonly atlas: THREE.CanvasTexture
  private readonly batch: BillboardBatch
  private readonly particles: Particle[] = []
  private readonly rings: RingFx[] = []
  private particleIndex = 0
  private ringIndex = 0

  constructor(parent: THREE.Object3D, particleCount = 320, ringCount = 28) {
    this.atlas = makeAtlas()
    this.batch = new BillboardBatch(parent, this.atlas, particleCount + ringCount, { renderOrder: 5 })

    for (let i = 0; i < particleCount; i++) {
      this.particles.push({
        index: i,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size0: 0.3,
        size1: 0.05,
        gravity: 0,
        active: false,
        drag: 1,
        color: 0xffffff,
        u0: 0,
        v0: 0,
      })
    }
    for (let i = 0; i < ringCount; i++) {
      this.rings.push({
        index: particleCount + i,
        x: 0,
        y: 0,
        z: 0,
        life: 0,
        maxLife: 1,
        scale0: 1,
        scale1: 1,
        active: false,
        color: 0xffffff,
        alpha0: 0.9,
      })
    }
    this.batch.flush()
  }

  private nextParticle(): Particle {
    const p = this.particles[this.particleIndex]
    this.particleIndex = (this.particleIndex + 1) % this.particles.length
    return p
  }

  private writeParticle(p: Particle, alpha: number): void {
    this.batch.set(
      p.index,
      p.x,
      p.y,
      p.z,
      p.size0,
      p.size0,
      p.color,
      alpha,
      p.u0,
      p.v0,
      1 / ATLAS_COLS,
      1 / ATLAS_ROWS,
    )
  }

  burst(x: number, z: number, opts: BurstOptions = {}): void {
    const {
      color = 0xffffff,
      count = 8,
      speed = 3.4,
      life = 0.4,
      size = 0.34,
      gravity = -6,
      y = 0.8,
      spread = 1,
      texture = 'spark',
    } = opts
    const [u0, v0] = UV_OFFSET[texture]
    for (let i = 0; i < count; i++) {
      const p = this.nextParticle()
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.45 + Math.random() * 0.85)
      p.color = color
      p.u0 = u0
      p.v0 = v0
      p.x = x + (Math.random() - 0.5) * 0.3
      p.y = y + (Math.random() - 0.5) * 0.25
      p.z = z + (Math.random() - 0.5) * 0.3
      p.size0 = size * (0.6 + Math.random() * 0.7)
      p.size1 = p.size0 * 0.15
      p.vx = Math.cos(a) * s * spread
      p.vz = Math.sin(a) * s * spread
      p.vy = 1.6 + Math.random() * 3.2
      p.life = p.maxLife = life * (0.7 + Math.random() * 0.6)
      p.gravity = gravity
      p.drag = 7
      p.active = true
      this.writeParticle(p, 1)
    }
  }

  /** 平面扩散光环（砸地预警/升级/拾取） */
  ring(x: number, z: number, opts: { color?: number; radius?: number; life?: number; y?: number; grow?: number } = {}): void {
    const { color = 0xffffff, radius = 3, life = 0.5, y = 0.06, grow = 2.2 } = opts
    const r = this.rings[this.ringIndex]
    this.ringIndex = (this.ringIndex + 1) % this.rings.length
    r.color = color
    r.x = x
    r.y = y
    r.z = z
    r.scale0 = radius * 0.35
    r.scale1 = radius * (0.35 + grow)
    r.life = r.maxLife = life
    r.active = true
    r.alpha0 = 0.9
    this.writeRing(r, 0.9)
  }

  /** Boss 砸地预警：红色收缩圈 + 光柱闪一下 */
  telegraph(x: number, z: number, radius: number, duration: number): void {
    const r = this.rings[this.ringIndex]
    this.ringIndex = (this.ringIndex + 1) % this.rings.length
    r.color = 0xff2a2a
    r.x = x
    r.y = 0.05
    r.z = z
    r.scale0 = radius * 0.35
    r.scale1 = radius * 0.35
    r.life = r.maxLife = duration
    r.active = true
    r.alpha0 = 0.55
    this.writeRing(r, 0.55)
  }

  /** 升级时从角色脚下扩散的金色光波 */
  levelUpBurst(x: number, z: number): void {
    this.ring(x, z, { color: 0xffd76a, radius: 5.5, life: 0.75, grow: 3 })
    this.ring(x, z, { color: 0x7fffd4, radius: 3.4, life: 0.6, grow: 2.4 })
    this.burst(x, z, { color: 0xffe9a8, count: 26, speed: 6, life: 0.8, size: 0.32, gravity: -2, y: 1 })
  }

  update(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        this.batch.setAlpha(p.index, 0)
        continue
      }
      const t = p.life / p.maxLife
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vz *= drag
      p.vy += p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.05) {
        p.y = 0.05
        p.vy *= -0.25
      }
      const shownSize = p.size1 + (p.size0 - p.size1) * t
      this.batch.set(
        p.index,
        p.x,
        p.y,
        p.z,
        shownSize,
        shownSize,
        p.color,
        Math.min(1, t * 2.2),
        p.u0,
        p.v0,
        1 / ATLAS_COLS,
        1 / ATLAS_ROWS,
      )
    }

    for (const r of this.rings) {
      if (!r.active) continue
      r.life -= dt
      if (r.life <= 0) {
        r.active = false
        this.batch.setAlpha(r.index, 0)
        continue
      }
      const t = 1 - r.life / r.maxLife
      this.writeRing(r, r.alpha0 * (1 - t))
    }

    this.batch.flush()
  }

  clear(): void {
    for (const p of this.particles) {
      p.active = false
      this.batch.setAlpha(p.index, 0)
    }
    for (const r of this.rings) {
      r.active = false
      this.batch.setAlpha(r.index, 0)
    }
    this.batch.flush()
  }

  dispose(): void {
    this.batch.dispose()
    this.atlas.dispose()
    this.particles.length = 0
    this.rings.length = 0
  }

  private writeRing(r: RingFx, alpha: number): void {
    const t = 1 - Math.max(0, r.life) / Math.max(1e-5, r.maxLife)
    const s = r.scale0 + (r.scale1 - r.scale0) * t
    const [u0, v0] = UV_OFFSET.ring
    this.batch.set(r.index, r.x, r.y, r.z, s, s, r.color, alpha, u0, v0, 1 / ATLAS_COLS, 1 / ATLAS_ROWS)
  }
}
