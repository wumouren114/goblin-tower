import * as THREE from 'three'

type TextureKind = 'glow' | 'ring' | 'shard' | 'spark'

interface Particle {
  sprite: THREE.Sprite
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size0: number
  size1: number
  gravity: number
  fadeIn: number
  active: boolean
  drag: number
}

interface RingFx {
  sprite: THREE.Sprite
  life: number
  maxLife: number
  radius: number
  active: boolean
  grow: number
}

function makeTexture(kind: TextureKind): THREE.CanvasTexture {
  const size = 96
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2

  if (kind === 'glow') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.65)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
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
  } else if (kind === 'shard') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(size * 0.36, size * 0.36, size * 0.28, size * 0.28)
    ctx.globalAlpha = 0.4
    ctx.fillRect(size * 0.28, size * 0.28, size * 0.44, size * 0.44)
  } else {
    // 四角星光
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.9)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.15)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(cx, 4)
    ctx.lineTo(cx + 7, cy - 8)
    ctx.lineTo(cx + 7, cy - 8)
    ctx.lineTo(size - 4, cy)
    ctx.lineTo(cx + 7, cy + 8)
    ctx.lineTo(cx, size - 4)
    ctx.lineTo(cx - 7, cy + 8)
    ctx.lineTo(4, cy)
    ctx.lineTo(cx - 7, cy - 8)
    ctx.closePath()
    ctx.fill()
  }

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

/** 轻量粒子/光环特效池，全部走 Sprite，零 GC 压力 */
export class Vfx {
  private scene: THREE.Scene
  private textures: Record<TextureKind, THREE.CanvasTexture>
  private particles: Particle[] = []
  private rings: RingFx[] = []
  private particleIndex = 0
  private ringIndex = 0

  constructor(scene: THREE.Scene, particleCount = 320, ringCount = 28) {
    this.scene = scene
    this.textures = {
      glow: makeTexture('glow'),
      ring: makeTexture('ring'),
      shard: makeTexture('shard'),
      spark: makeTexture('spark'),
    }
    for (let i = 0; i < particleCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures.spark,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.visible = false
      sprite.frustumCulled = false
      scene.add(sprite)
      this.particles.push({
        sprite,
        vx: 0,
        vy: 0,
        vz: 0,
        life: 0,
        maxLife: 1,
        size0: 0.3,
        size1: 0.05,
        gravity: 0,
        fadeIn: 0,
        active: false,
        drag: 1,
      })
    }
    for (let i = 0; i < ringCount; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.textures.ring,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.visible = false
      sprite.frustumCulled = false
      mat.rotation = Math.PI / 4
      scene.add(sprite)
      this.rings.push({ sprite, life: 0, maxLife: 1, radius: 1, active: false, grow: 2 })
    }
  }

  private nextParticle(): Particle {
    const p = this.particles[this.particleIndex]
    this.particleIndex = (this.particleIndex + 1) % this.particles.length
    return p
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
    for (let i = 0; i < count; i++) {
      const p = this.nextParticle()
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.45 + Math.random() * 0.85)
      p.sprite.material.map = this.textures[texture]
      p.sprite.material.color.setHex(color)
      p.sprite.material.opacity = 1
      p.sprite.visible = true
      p.sprite.position.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.25, z + (Math.random() - 0.5) * 0.3)
      p.size0 = size * (0.6 + Math.random() * 0.7)
      p.size1 = p.size0 * 0.15
      p.sprite.scale.setScalar(p.size0)
      p.vx = Math.cos(a) * s * spread
      p.vz = Math.sin(a) * s * spread
      p.vy = 1.6 + Math.random() * 3.2
      p.life = p.maxLife = life * (0.7 + Math.random() * 0.6)
      p.gravity = gravity
      p.drag = 7
      p.fadeIn = 0
      p.active = true
    }
  }

  /** 平面扩散光环（砸地预警/升级/拾取） */
  ring(x: number, z: number, opts: { color?: number; radius?: number; life?: number; y?: number; grow?: number } = {}): void {
    const { color = 0xffffff, radius = 3, life = 0.5, y = 0.06, grow = 2.2 } = opts
    const r = this.rings[this.ringIndex]
    this.ringIndex = (this.ringIndex + 1) % this.rings.length
    r.sprite.material.color.setHex(color)
    r.sprite.material.opacity = 0.9
    r.sprite.visible = true
    r.sprite.position.set(x, y, z)
    r.sprite.scale.set(radius * 0.35, radius * 0.35, 1)
    r.radius = radius
    r.life = r.maxLife = life
    r.grow = grow
    r.active = true
  }

  /** Boss 砸地预警：红色收缩圈 + 光柱闪一下 */
  telegraph(x: number, z: number, radius: number, duration: number): void {
    const r = this.rings[this.ringIndex]
    this.ringIndex = (this.ringIndex + 1) % this.rings.length
    r.sprite.material.color.setHex(0xff2a2a)
    r.sprite.material.opacity = 0.55
    r.sprite.visible = true
    r.sprite.position.set(x, 0.05, z)
    r.sprite.scale.set(radius * 2.05, radius * 2.05, 1)
    r.radius = radius
    r.life = r.maxLife = duration
    r.grow = 0.001
    r.active = true
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
        p.sprite.visible = false
        continue
      }
      const t = p.life / p.maxLife
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vz *= drag
      p.vy += p.gravity * dt
      p.sprite.position.x += p.vx * dt
      p.sprite.position.y += p.vy * dt
      p.sprite.position.z += p.vz * dt
      if (p.sprite.position.y < 0.05) {
        p.sprite.position.y = 0.05
        p.vy *= -0.25
      }
      p.sprite.scale.setScalar(p.size1 + (p.size0 - p.size1) * t)
      p.sprite.material.opacity = Math.min(1, t * 2.2)
    }

    for (const r of this.rings) {
      if (!r.active) continue
      r.life -= dt
      if (r.life <= 0) {
        r.active = false
        r.sprite.visible = false
        continue
      }
      const t = 1 - r.life / r.maxLife
      const s = r.radius * 0.35 + r.radius * r.grow * t
      r.sprite.scale.set(s, s, 1)
      r.sprite.material.opacity = Math.max(0, 1 - t) * 0.9
    }
  }

  clear(): void {
    for (const p of this.particles) {
      p.active = false
      p.sprite.visible = false
    }
    for (const r of this.rings) {
      r.active = false
      r.sprite.visible = false
    }
  }

  dispose(): void {
    for (const p of this.particles) {
      this.scene.remove(p.sprite)
      p.sprite.material.dispose()
    }
    for (const r of this.rings) {
      this.scene.remove(r.sprite)
      r.sprite.material.dispose()
    }
    for (const key of Object.keys(this.textures) as TextureKind[]) this.textures[key].dispose()
    this.particles.length = 0
    this.rings.length = 0
  }
}
