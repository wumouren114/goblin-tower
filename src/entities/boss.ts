import * as THREE from 'three'
import type { BossKind, EnemyKind, Facing } from '../types'
import { rotateInput } from '../core/math'
import { kingSprite } from '../art/sprites'
import {
  createShadowMesh,
  createSpriteMesh,
  getBillboardYaw,
  particleTexture,
  setSpriteFrame,
  type SpriteAnim,
} from '../art/sprites'

export interface BossCallbacks {
  onSlam(x: number, z: number, radius: number, damage: number): void
  onSummon(count: number, kind: EnemyKind): void
  onRoar(): void
}

type BossState = 'chase' | 'windup' | 'recover' | 'charge'

export interface BossTuning {
  hp: number
  damage: number
  speed: number
  radius: number
  slamRadius: number
  slamWindup: number
  slamCooldown: number
  summonCount: number
  summonEvery: number
  chargeSpeed: number
  chargeDuration: number
  chargeCooldown: number
  phase2At: number
  barrageEvery: number
  barrageCount: number
  summonKind: EnemyKind
}

/** 兼容旧导出：默认王的数值；实际按 kind 从 BOSS_VARIANTS 取。 */
export const BOSS_TUNING = {
  hp: 2600,
  damage: 18,
  speed: 2.5,
  radius: 1.5,
  slamRadius: 4.6,
  slamWindup: 0.85,
  summonCount: 5,
  summonEvery: 9,
  chargeSpeed: 11,
  phase2At: 0.55,
} as const

const BOSS_VARIANTS: Record<BossKind, BossTuning> = {
  king: {
    ...BOSS_TUNING,
    slamCooldown: 3.4,
    chargeDuration: 0.75,
    chargeCooldown: 4.5,
    barrageEvery: 6.5,
    barrageCount: 12,
    summonKind: 'small',
  },
  warlord: {
    hp: 3200,
    damage: 22,
    speed: 2.9,
    radius: 1.62,
    slamRadius: 5.1,
    slamWindup: 0.7,
    slamCooldown: 2.7,
    summonCount: 3,
    summonEvery: 8,
    chargeSpeed: 13.5,
    chargeDuration: 0.85,
    chargeCooldown: 3.2,
    phase2At: 0.6,
    barrageEvery: 9,
    barrageCount: 8,
    summonKind: 'brute',
  },
  witch: {
    hp: 2800,
    damage: 16,
    speed: 2.15,
    radius: 1.45,
    slamRadius: 4.3,
    slamWindup: 1.0,
    slamCooldown: 3.9,
    summonCount: 4,
    summonEvery: 7,
    chargeSpeed: 9.5,
    chargeDuration: 0.65,
    chargeCooldown: 5.5,
    phase2At: 0.62,
    barrageEvery: 4.6,
    barrageCount: 16,
    summonKind: 'caster',
  },
}

export const BOSS_TITLES: Record<BossKind, string> = {
  king: '哥布林之王',
  warlord: '哥布林督军',
  witch: '哥布林巫王',
}

/** 二阶段身体色调偏移（按 kind 分化：王暖金 / 督军炽橙 / 巫王幽紫） */
const PHASE2_BODY_TINT: Record<BossKind, number> = {
  king: 0xffdf8a,
  warlord: 0xff9b5e,
  witch: 0xd08cff,
}

/** 二阶段脚下持续旋转暗色光环基色 */
const PHASE2_AURA_COLOR: Record<BossKind, number> = {
  king: 0xa0731e,
  warlord: 0xb8461a,
  witch: 0x6d2ca8,
}

const ENRAGED_AURA_COLOR = 0xff2238
const ENRAGED_BODY_TINT = 0xff5a4a
const EMBER_COUNT = 12
const EMBER_COLORS = [0xff3322, 0xff6e26, 0xffbe4a]

interface EmberSeed {
  angle: number
  radiusMul: number
  speed: number
  phase: number
  swirl: number
  size: number
}

/**
 * 程序化生成 64×64 像素风脚底符文光环贴图（DataTexture，无 DOM 依赖）：
 * 外圈实环 + 内圈细环 + 8 处旋转刻度缺口，旋转时视觉可读性强。
 */
function createBossAuraTexture(): THREE.DataTexture {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const half = (size - 1) / 2
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half
      const dy = (y - half) / half
      const r = Math.hypot(dx, dy)
      const ang = Math.atan2(dy, dx)
      const spoke = Math.abs(Math.sin(ang * 4))
      let alpha = 0
      let shade = 255
      // 外圈暗色主环（带 8 段符文凹口）
      if (r >= 0.72 && r <= 0.94) {
        const edge = 1 - Math.abs((r - 0.83) / 0.11)
        const notch = spoke > 0.24 ? 1 : 0.28
        alpha = Math.max(alpha, edge * notch * 235)
        shade = spoke > 0.78 ? 255 : 195
      }
      // 内圈细光环
      if (r >= 0.5 && r <= 0.59) {
        const edge = 1 - Math.abs((r - 0.545) / 0.045)
        alpha = Math.max(alpha, edge * 180)
        shade = 235
      }
      // 8 枚外缘符文尖刺
      if (r > 0.92 && r <= 0.99 && spoke > 0.92) {
        alpha = Math.max(alpha, 210)
        shade = 255
      }
      const idx = (y * size + x) * 4
      data[idx] = shade
      data[idx + 1] = shade
      data[idx + 2] = shade
      data[idx + 3] = Math.min(255, Math.round(alpha))
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/**
 * 哥布林之王：追击 → 蓄力砸地（0.85s 红圈预警）→ 硬直 → 追击。
 * 血量低于 55% 进入二阶段：怒吼、召唤援军，并追加高速冲锋。
 */
export class GoblinKing {
  readonly group: THREE.Group
  readonly kind: BossKind
  readonly title: string
  readonly barrageEvery: number
  readonly barrageCount: number
  readonly summonKind: EnemyKind
  x: number
  z: number
  hp: number = BOSS_VARIANTS.king.hp
  maxHp: number = BOSS_VARIANTS.king.hp
  radius: number = BOSS_VARIANTS.king.radius
  alive = true
  phase2 = false
  /** 狂暴视觉态（血量 <30% 由 game.ts 调用 setEnraged() 触发，只改视觉不改数值） */
  enraged = false
  /** 沉睡时待在后场，不追击、不攻击；玩家靠近后由 game.ts 唤醒 */
  dormant = false

  private readonly scene: THREE.Scene
  private readonly tuning: BossTuning
  private readonly anim: SpriteAnim
  private readonly sprite: THREE.Mesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  private readonly warn: THREE.Mesh
  private readonly warnMat: THREE.MeshBasicMaterial
  private readonly auraTex: THREE.DataTexture
  private readonly auraMat: THREE.MeshBasicMaterial
  private readonly auraRing: THREE.Mesh
  private readonly emberMat: THREE.MeshBasicMaterial
  private readonly embers: THREE.InstancedMesh
  private readonly emberSeeds: EmberSeed[]
  private readonly emberDummy = new THREE.Object3D()
  private readonly tintScratch = new THREE.Color()
  private readonly enragedScratch = new THREE.Color(ENRAGED_BODY_TINT)
  private readonly callbacks: BossCallbacks

  private state: BossState = 'chase'
  private stateTimer = 0
  private slamCd = 2.2
  private chargeCd = 5
  private summonTimer = 0
  private slamX = 0
  private slamZ = 0
  private chargeX = 0
  private chargeZ = 1
  private facing: Facing = 'down'
  private clock = 0

  constructor(scene: THREE.Scene, x: number, z: number, callbacks: BossCallbacks, kind: BossKind = 'king') {
    this.scene = scene
    this.x = x
    this.z = z
    this.callbacks = callbacks
    this.kind = kind
    this.title = BOSS_TITLES[kind]
    this.tuning = BOSS_VARIANTS[kind]
    this.hp = this.tuning.hp
    this.maxHp = this.tuning.hp
    this.radius = this.tuning.radius
    this.barrageEvery = this.tuning.barrageEvery
    this.barrageCount = this.tuning.barrageCount
    this.summonKind = this.tuning.summonKind
    this.slamCd = this.tuning.slamCooldown * 0.65

    this.anim = kingSprite(kind)
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    this.sprite = createSpriteMesh(this.anim)
    this.mat = this.sprite.material as THREE.MeshBasicMaterial
    this.group.add(this.sprite)

    this.shadow = createShadowMesh(this.anim.worldW * 0.92, this.anim.worldW * 0.72)
    this.group.add(this.shadow)

    // 脚下阶段光环：挂在 group 下自动跟随 Boss 移动；二阶段暗色旋转，狂暴切红色高频脉冲
    this.auraTex = createBossAuraTexture()
    this.auraMat = new THREE.MeshBasicMaterial({
      map: this.auraTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: PHASE2_AURA_COLOR[kind],
      toneMapped: false,
    })
    this.auraRing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.auraMat)
    this.auraRing.rotation.x = -Math.PI / 2
    this.auraRing.position.set(0, 0.035, 0)
    this.auraRing.scale.setScalar(this.radius * 2.4)
    this.auraRing.visible = false
    this.auraRing.renderOrder = 1
    this.group.add(this.auraRing)

    // 狂暴周身火星上浮：单 InstancedMesh 合批（仅 1 drawcall），挂在 group 下随 Boss 移动
    this.emberMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.embers = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 0.15), this.emberMat, EMBER_COUNT)
    this.embers.visible = false
    this.embers.renderOrder = 4
    this.embers.frustumCulled = false
    this.emberSeeds = []
    const col = new THREE.Color()
    for (let i = 0; i < EMBER_COUNT; i += 1) {
      this.emberSeeds.push({
        angle: (i / EMBER_COUNT) * Math.PI * 2 + (i % 3) * 0.27,
        radiusMul: 0.48 + ((i * 37) % 10) * 0.06,
        speed: 0.75 + ((i * 19) % 7) * 0.14,
        phase: (i / EMBER_COUNT) + ((i % 2) * 0.11),
        swirl: (i % 2 === 0 ? 1 : -1) * (1.2 + (i % 4) * 0.35),
        size: 0.75 + (i % 3) * 0.32,
      })
      col.setHex(EMBER_COLORS[i % EMBER_COLORS.length])
      this.embers.setColorAt(i, col)
    }
    if (this.embers.instanceColor) this.embers.instanceColor.needsUpdate = true
    this.group.add(this.embers)

    // 砸地预警圈：放在场景根节点，位置是世界绝对坐标；巫王用紫色，督军用橙红
    const warnColor = kind === 'witch' ? 0xb46bff : kind === 'warlord' ? 0xff5a36 : 0xff3b4b
    const warnGeo = new THREE.PlaneGeometry(1, 1)
    this.warnMat = new THREE.MeshBasicMaterial({
      map: particleTexture('ring'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: warnColor,
      toneMapped: false,
    })
    this.warn = new THREE.Mesh(warnGeo, this.warnMat)
    this.warn.rotation.x = -Math.PI / 2
    this.warn.position.set(x, 0.045, z)
    this.warn.scale.setScalar(this.tuning.slamRadius * 2)
    this.warn.visible = false
    this.warn.renderOrder = 2
    scene.add(this.warn)
  }

  /** 触发狂暴视觉（红色高频脉冲光环 + 周身火星 + 抖动提速感）；幂等，重复调用无效 */
  setEnraged(): void {
    if (this.enraged) return
    this.enraged = true
  }

  setDormant(value: boolean): void {
    if (this.dormant === value) return
    this.dormant = value
    this.state = 'chase'
    this.stateTimer = 0
    this.warn.visible = false
    this.warnMat.opacity = 0
    if (!value) {
      // 苏醒后给玩家一点反应时间，不要立刻砸地/冲锋
      this.slamCd = Math.max(this.slamCd, 1.2)
      this.chargeCd = Math.max(this.chargeCd, 4)
    }
  }

  update(dt: number, targetX: number, targetZ: number): void {
    // 权威坐标回写
    this.group.position.set(this.x, 0, this.z)
    if (!this.alive) return

    this.clock += dt

    // 沉睡：只做呼吸/朝向动画，绝不追击
    if (this.dormant) {
      const dx = targetX - this.x
      const dz = targetZ - this.z
      const dist = Math.hypot(dx, dz)
      const nx = dist > 0.001 ? dx / dist : 0
      const nz = dist > 0.001 ? dz / dist : 1
      const screen = rotateInput(nx, nz, getBillboardYaw())
      if (Math.abs(screen.x) > Math.abs(screen.z)) {
        this.facing = screen.x > 0 ? 'right' : 'left'
      } else {
        this.facing = screen.z > 0 ? 'down' : 'up'
      }
      setSpriteFrame(this.sprite, this.anim, this.facing, Math.floor(this.clock * 1.2) % 2)
      this.sprite.rotation.y = getBillboardYaw()
      const breath = Math.sin(this.clock * 1.7)
      this.sprite.position.set(0, breath * 0.025, 0)
      this.sprite.rotation.z = 0
      this.sprite.scale.set(1 + breath * 0.012, 1 + breath * 0.02, 1)
      this.updatePhaseVisuals(dt)
      this.updateFlash(dt)
      return
    }

    this.slamCd = Math.max(0, this.slamCd - dt)
    this.chargeCd = Math.max(0, this.chargeCd - dt)

    // 进入二阶段
    if (!this.phase2 && this.hp <= this.maxHp * this.tuning.phase2At) {
      this.phase2 = true
      this.summonTimer = this.tuning.summonEvery
      this.callbacks.onRoar()
      this.callbacks.onSummon(this.tuning.summonCount, this.tuning.summonKind)
    }

    // 二阶段定期召唤
    if (this.phase2) {
      this.summonTimer -= dt
      if (this.summonTimer <= 0) {
        this.summonTimer = this.tuning.summonEvery
        this.callbacks.onSummon(this.tuning.summonCount, this.tuning.summonKind)
      }
    }

    const dx = targetX - this.x
    const dz = targetZ - this.z
    const dist = Math.hypot(dx, dz)
    const nx = dist > 0.001 ? dx / dist : 0
    const nz = dist > 0.001 ? dz / dist : 1
    let moving = false

    switch (this.state) {
      case 'windup': {
        this.stateTimer -= dt
        // 预警圈呼吸闪烁
        this.warnMat.opacity = 0.32 + 0.3 * Math.abs(Math.sin(this.clock * 14))
        if (this.stateTimer <= 0) {
          this.warn.visible = false
          this.warnMat.opacity = 0
          this.callbacks.onSlam(this.slamX, this.slamZ, this.tuning.slamRadius, this.tuning.damage)
          this.state = 'recover'
          this.stateTimer = 1.1
          this.slamCd = this.tuning.slamCooldown
        }
        break
      }
      case 'recover': {
        this.stateTimer -= dt
        if (this.stateTimer <= 0) this.state = 'chase'
        break
      }
      case 'charge': {
        this.stateTimer -= dt
        const sp = this.tuning.chargeSpeed * dt
        this.x += this.chargeX * sp
        this.z += this.chargeZ * sp
        moving = true
        if (this.stateTimer <= 0) {
          this.state = 'recover'
          this.stateTimer = 0.7
          this.slamCd = Math.min(this.slamCd, 1.6)
        }
        break
      }
      default: {
        // 追击玩家
        if (dist > 0.001) {
          this.x += nx * this.tuning.speed * dt
          this.z += nz * this.tuning.speed * dt
          moving = true
        }
        if (this.slamCd <= 0 && dist < 8.5) {
          this.state = 'windup'
          this.stateTimer = this.tuning.slamWindup
          this.slamX = targetX
          this.slamZ = targetZ
          this.warn.position.set(this.slamX, 0.045, this.slamZ)
          this.warn.scale.setScalar(this.tuning.slamRadius * 2)
          this.warn.visible = true
          this.warnMat.opacity = 0.35
        } else if (this.phase2 && this.chargeCd <= 0 && dist > 6.5) {
          this.state = 'charge'
          this.stateTimer = this.tuning.chargeDuration
          this.chargeX = nx
          this.chargeZ = nz
          this.chargeCd = this.tuning.chargeCooldown
        }
        break
      }
    }

    // 预警圈随 Boss 动画保持可见性
    this.warn.position.y = 0.045
    this.warn.scale.setScalar(this.tuning.slamRadius * 2)

    // 朝向按相机转屏幕系
    const screen = rotateInput(nx, nz, getBillboardYaw())
    if (Math.abs(screen.x) > Math.abs(screen.z)) {
      this.facing = screen.x > 0 ? 'right' : 'left'
    } else {
      this.facing = screen.z > 0 ? 'down' : 'up'
    }

    // 帧：站立呼吸（慢）/ 移动（更慢的重步）；狂暴仅加快动画帧率与视觉抖动，不改移动/攻击数值
    const moveRate = this.enraged ? 8.5 : 5
    const idleRate = this.enraged ? 2.8 : 1.6
    let frame: number
    if (this.state === 'windup') {
      frame = 2
    } else if (this.state === 'charge' || moving) {
      frame = 2 + (Math.floor(this.clock * moveRate) % 2)
    } else {
      frame = Math.floor(this.clock * idleRate) % 2
    }
    setSpriteFrame(this.sprite, this.anim, this.facing, frame)
    this.sprite.rotation.y = getBillboardYaw()

    // 呼吸起伏 + 狂暴视觉速度感（微抖与前倾摆动）
    if (this.enraged) {
      const breath = Math.sin(this.clock * 4.2)
      const jitterX = Math.sin(this.clock * 38) * 0.055
      const jitterY = Math.cos(this.clock * 44) * 0.028
      const leanAmp = moving || this.state === 'charge' ? 0.095 : 0.05
      this.sprite.position.set(jitterX, breath * 0.038 + jitterY, 0)
      this.sprite.rotation.z = Math.sin(this.clock * 22) * leanAmp
      this.sprite.scale.set(1 + breath * 0.024, 1 + breath * 0.034, 1)
    } else {
      const breath = Math.sin(this.clock * 1.7)
      this.sprite.position.set(0, breath * 0.025, 0)
      this.sprite.rotation.z = 0
      this.sprite.scale.set(1 + breath * 0.012, 1 + breath * 0.02, 1)
    }

    // 阶段光环与狂暴火星
    this.updatePhaseVisuals(dt)

    // 受击闪白 + 阶段/狂暴色调偏移
    this.updateFlash(dt)
  }

  private updatePhaseVisuals(dt: number): void {
    const showAura = this.phase2 || this.enraged
    this.auraRing.visible = showAura
    if (showAura) {
      const baseScale = this.radius * 2.4
      if (this.enraged) {
        const pulse = 0.5 + 0.5 * Math.sin(this.clock * 16)
        this.auraMat.color.setHex(ENRAGED_AURA_COLOR)
        this.auraMat.opacity = 0.52 + pulse * 0.43
        this.auraRing.rotation.z += dt * 2.8
        this.auraRing.scale.setScalar(baseScale * (1 + pulse * 0.14))
      } else {
        const breathe = 0.5 + 0.5 * Math.sin(this.clock * 3.4)
        this.auraMat.color.setHex(PHASE2_AURA_COLOR[this.kind])
        this.auraMat.opacity = 0.58 + breathe * 0.16
        this.auraRing.rotation.z += dt * 0.9
        this.auraRing.scale.setScalar(baseScale * (1 + breathe * 0.04))
      }
    }

    this.embers.visible = this.enraged
    if (this.enraged) {
      const yaw = getBillboardYaw()
      const maxH = this.anim.worldH * 1.15
      for (let i = 0; i < EMBER_COUNT; i += 1) {
        const s = this.emberSeeds[i]
        const t = (this.clock * s.speed + s.phase) % 1
        const ang = s.angle + this.clock * s.swirl
        const rad = this.radius * s.radiusMul * (1 - t * 0.25)
        const y = 0.15 + t * maxH
        const scale = s.size * Math.sin(t * Math.PI) * (0.85 + 0.25 * Math.sin(this.clock * 20 + i))
        this.emberDummy.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad)
        this.emberDummy.rotation.set(0, yaw, t * Math.PI)
        this.emberDummy.scale.setScalar(Math.max(0.01, scale))
        this.emberDummy.updateMatrix()
        this.embers.setMatrixAt(i, this.emberDummy.matrix)
      }
      this.embers.instanceMatrix.needsUpdate = true
    }
  }

  private flash = 0

  private updateFlash(dt: number): void {
    if (this.enraged) {
      this.tintScratch.setHex(PHASE2_BODY_TINT[this.kind]).lerp(this.enragedScratch, 0.52)
      const throb = 1 + 0.08 * Math.sin(this.clock * 18)
      this.tintScratch.multiplyScalar(throb)
    } else if (this.phase2) {
      this.tintScratch.setHex(PHASE2_BODY_TINT[this.kind])
    } else {
      this.tintScratch.setScalar(1)
    }

    if (this.flash <= 0) {
      this.mat.color.copy(this.tintScratch)
      return
    }
    this.flash = Math.max(0, this.flash - dt)
    this.mat.color.copy(this.tintScratch).multiplyScalar(1 + (this.flash / 0.1) * 2.8)
  }

  hit(amount: number, kx: number, kz: number): boolean {
    if (!this.alive) return false
    this.hp -= amount
    this.flash = 0.1
    // 巨躯只被轻微推动
    this.x += kx * 0.03
    this.z += kz * 0.03
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
      // 死亡后 update 不再推进受击闪白，这里立刻恢复本色并隐藏阶段特效，交给 game.ts 做旋转消散
      this.flash = 0
      this.mat.color.setScalar(1)
      this.sprite.position.set(0, 0, 0)
      this.sprite.rotation.z = 0
      this.warn.visible = false
      this.warnMat.opacity = 0
      this.auraRing.visible = false
      this.embers.visible = false
      return true
    }
    return false
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.scene.remove(this.warn)
    this.group.clear()
    this.sprite.geometry.dispose()
    this.mat.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.auraRing.geometry.dispose()
    this.auraMat.dispose()
    this.auraTex.dispose()
    this.embers.geometry.dispose()
    this.emberMat.dispose()
    this.warn.geometry.dispose()
    this.warnMat.dispose()
  }
}

export { GoblinKing as Boss }
