import * as THREE from 'three'
import type { Circle, EnemyDef, Facing } from '../types'
import { rotateInput } from '../core/math'
import { goblinSprite } from '../art/sprites'
import {
  createShadowMesh,
  createSpriteMesh,
  getBillboardYaw,
  particleTexture,
  setSpriteFrame,
  type SpriteAnim,
} from '../art/sprites'

const RUN_FPS = 9
const FLASH_TIME = 0.08
const DEATH_TIME = 0.3

/**
 * 普通哥布林（small / brute / elite）。
 *
 * x/z 是权威坐标：Lead 会在外部（分离解算）直接改 x/z，
 * 所以 update 开头必须先把 group.position 同步成 (x, 0, z)，再叠加自身移动。
 */
export class Goblin {
  readonly group: THREE.Group
  x: number
  z: number
  hp: number
  maxHp: number
  radius: number
  damage: number
  speed: number
  xpValue: number
  goldChance: number
  alive = true
  elite: boolean

  private readonly scene: THREE.Scene
  private readonly anim: SpriteAnim
  private readonly sprite: THREE.Mesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  private readonly eliteRing: THREE.Mesh | null

  private readonly scale: number
  private readonly phase: number
  private animClock = 0
  private flash = 0
  private deadTimer = -1
  private kbx = 0
  private kbz = 0

  constructor(
    scene: THREE.Scene,
    def: EnemyDef,
    x: number,
    z: number,
    mul: { hp: number; damage: number; speed: number; scale: number; layerSpeed?: number },
    elite = false,
  ) {
    this.scene = scene
    this.x = x
    this.z = z
    this.elite = elite
    this.maxHp = Math.max(1, def.hp * mul.hp)
    this.hp = this.maxHp
    this.radius = def.radius
    this.damage = def.damage * mul.damage
    // 层数移速压力：layerSpeed 来自 balance.layerCurve.mobSpeed*（mobSpeedMulFor），老调用缺省 = 1
    this.speed = def.speed * mul.speed * (mul.layerSpeed ?? 1)
    this.xpValue = def.xp
    this.goldChance = def.goldChance
    this.scale = def.scale * mul.scale
    this.phase = Math.random() * Math.PI * 2

    const kind = elite ? 'elite' : def.model === 'goblin-big' ? 'brute' : def.model === 'caster' ? 'caster' : 'small'
    this.anim = goblinSprite(kind)
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    this.sprite = createSpriteMesh(this.anim)
    this.sprite.scale.setScalar(this.scale)
    this.mat = this.sprite.material as THREE.MeshBasicMaterial
    this.group.add(this.sprite)

    this.shadow = createShadowMesh(Math.max(0.55, this.radius * 2.3))
    this.shadow.scale.setScalar(this.scale)
    this.group.add(this.shadow)

    if (elite) {
      const ringGeo = new THREE.PlaneGeometry(1, 1)
      const ringMat = new THREE.MeshBasicMaterial({
        map: particleTexture('ring'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffcf5a,
        toneMapped: false,
      })
      this.eliteRing = new THREE.Mesh(ringGeo, ringMat)
      this.eliteRing.rotation.x = -Math.PI / 2
      this.eliteRing.position.y = 0.035
      this.eliteRing.scale.setScalar(this.radius * 3.4)
      this.eliteRing.renderOrder = 1
      this.group.add(this.eliteRing)
    } else {
      this.eliteRing = null
    }
  }

  /** 受伤：返还是否致死；带击退与 0.08s 闪白 */
  hit(amount: number, kx: number, kz: number): boolean {
    if (!this.alive) return false
    this.hp -= amount
    this.flash = FLASH_TIME
    // 立刻位移一小步 + 余下的惯性速度，击退感更干脆
    this.x += kx * 0.15
    this.z += kz * 0.15
    this.kbx += kx * 1.4
    this.kbz += kz * 1.4
    if (this.hp <= 0) {
      this.kill()
      return true
    }
    return false
  }

  /** 直接击杀（掉落由外部处理） */
  kill(): void {
    if (!this.alive) return
    this.hp = 0
    this.alive = false
    this.deadTimer = DEATH_TIME
    if (this.eliteRing) this.eliteRing.visible = false
  }

  get canRemove(): boolean {
    return !this.alive && this.deadTimer <= 0
  }

  update(dt: number, targetX: number, targetZ: number, colliders: Circle[], bounds: number): void {
    // 权威坐标回写（外部可能已经改过 x/z）
    this.group.position.set(this.x, 0, this.z)

    if (!this.alive) {
      this.updateDeath(dt)
      return
    }

    this.animClock += dt
    this.flash = Math.max(0, this.flash - dt)

    let dx = targetX - this.x
    let dz = targetZ - this.z
    const dist = Math.hypot(dx, dz)
    let moving = false

    if (dist > 0.001) {
      dx /= dist
      dz /= dist
      // 小碎步的横向摆动，让追击不是一条直线
      const wobble = Math.sin(this.animClock * 4 + this.phase) * 0.18
      const px = -dz
      const pz = dx
      const mx = dx + px * wobble
      const mz = dz + pz * wobble
      const ml = Math.hypot(mx, mz) || 1
      this.x += (mx / ml) * this.speed * dt
      this.z += (mz / ml) * this.speed * dt
      moving = true
    }

    // 击退惯性
    this.x += this.kbx * dt
    this.z += this.kbz * dt
    const decay = Math.exp(-14 * dt)
    this.kbx *= decay
    this.kbz *= decay

    // 道具碰撞
    for (const c of colliders) {
      const ox = this.x - c.x
      const oz = this.z - c.z
      const rr = c.r + this.radius
      const d2 = ox * ox + oz * oz
      if (d2 >= rr * rr) continue
      const d = Math.sqrt(d2)
      if (d < 1e-4) {
        this.x += rr
        continue
      }
      const push = rr - d
      this.x += (ox / d) * push
      this.z += (oz / d) * push
    }

    const limit = bounds - this.radius
    this.x = Math.max(-limit, Math.min(limit, this.x))
    this.z = Math.max(-limit, Math.min(limit, this.z))
    this.group.position.set(this.x, 0, this.z)

    // 朝向按相机 yaw 转成屏幕系
    const screen = rotateInput(dx, dz, getBillboardYaw())
    this.facing = facingOf(screen.x, screen.z, this.facing)

    // 动画：追击时交替跑步帧，被击退到静止时回到 idle
    const frame = moving
      ? 2 + (Math.floor(this.animClock * RUN_FPS) % 2)
      : Math.floor(this.animClock * 3) % 2
    setSpriteFrame(this.sprite, this.anim, this.facing, frame)
    this.sprite.rotation.y = getBillboardYaw()

    // 小碎步的上下弹跳
    this.sprite.position.y = Math.abs(Math.sin(this.animClock * 8 + this.phase)) * 0.03

    // 受击闪白
    this.mat.color.setScalar(1 + (this.flash / FLASH_TIME) * 2.6)

    if (this.eliteRing) {
      const ringMat = this.eliteRing.material as THREE.MeshBasicMaterial
      ringMat.opacity = 0.42 + 0.22 * Math.sin(this.animClock * 2.6 + this.phase)
    }
  }

  private facing: Facing = 'down'

  private updateDeath(dt: number): void {
    this.deadTimer -= dt
    const t = Math.max(0, this.deadTimer / DEATH_TIME)
    // 缩小 + 旋转 + 淡出
    const s = this.scale * (0.25 + 0.75 * t)
    this.sprite.scale.setScalar(s)
    this.sprite.rotation.z += dt * 4
    this.sprite.rotation.y = getBillboardYaw()
    this.mat.opacity = t
    this.mat.color.setScalar(1)
    this.shadow.scale.setScalar(this.scale * t)
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = t
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.group.clear()
    this.sprite.geometry.dispose()
    this.mat.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    if (this.eliteRing) {
      this.eliteRing.geometry.dispose()
      ;(this.eliteRing.material as THREE.Material).dispose()
    }
  }
}

function facingOf(x: number, z: number, fallback: Facing): Facing {
  if (Math.abs(x) < 0.001 && Math.abs(z) < 0.001) return fallback
  if (Math.abs(x) > Math.abs(z)) return x > 0 ? 'right' : 'left'
  return z > 0 ? 'down' : 'up'
}
