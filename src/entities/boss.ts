import * as THREE from 'three'
import { CONFIG } from '../data/gameConfig'
import type { Facing } from '../types'
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
  onSummon(count: number): void
  onRoar(): void
}

type BossState = 'chase' | 'windup' | 'recover' | 'charge'

const WINDUP = CONFIG.boss.slamWindup

/**
 * 哥布林之王：追击 → 蓄力砸地（0.85s 红圈预警）→ 硬直 → 追击。
 * 血量低于 55% 进入二阶段：怒吼、召唤援军，并追加高速冲锋。
 */
export class GoblinKing {
  readonly group: THREE.Group
  x: number
  z: number
  hp: number = CONFIG.boss.hp
  maxHp: number = CONFIG.boss.hp
  radius: number = CONFIG.boss.radius
  alive = true
  phase2 = false

  private readonly scene: THREE.Scene
  private readonly anim: SpriteAnim
  private readonly sprite: THREE.Mesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  private readonly warn: THREE.Mesh
  private readonly warnMat: THREE.MeshBasicMaterial
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

  constructor(scene: THREE.Scene, x: number, z: number, callbacks: BossCallbacks) {
    this.scene = scene
    this.x = x
    this.z = z
    this.callbacks = callbacks

    this.anim = kingSprite()
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    this.sprite = createSpriteMesh(this.anim)
    this.mat = this.sprite.material as THREE.MeshBasicMaterial
    this.group.add(this.sprite)

    this.shadow = createShadowMesh(1.65, 1.3)
    this.group.add(this.shadow)

    // 砸地预警红圈：放在场景根节点，位置是世界绝对坐标
    const warnGeo = new THREE.PlaneGeometry(1, 1)
    this.warnMat = new THREE.MeshBasicMaterial({
      map: particleTexture('ring'),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xff3b4b,
      toneMapped: false,
    })
    this.warn = new THREE.Mesh(warnGeo, this.warnMat)
    this.warn.rotation.x = -Math.PI / 2
    this.warn.position.set(x, 0.045, z)
    this.warn.scale.setScalar(CONFIG.boss.slamRadius * 2)
    this.warn.visible = false
    this.warn.renderOrder = 2
    scene.add(this.warn)
  }

  update(dt: number, targetX: number, targetZ: number): void {
    // 权威坐标回写
    this.group.position.set(this.x, 0, this.z)
    if (!this.alive) return

    this.clock += dt
    this.slamCd = Math.max(0, this.slamCd - dt)
    this.chargeCd = Math.max(0, this.chargeCd - dt)

    // 进入二阶段
    if (!this.phase2 && this.hp <= this.maxHp * CONFIG.boss.phase2At) {
      this.phase2 = true
      this.summonTimer = CONFIG.boss.summonEvery
      this.callbacks.onRoar()
      this.callbacks.onSummon(CONFIG.boss.summonCount)
    }

    // 二阶段定期召唤
    if (this.phase2) {
      this.summonTimer -= dt
      if (this.summonTimer <= 0) {
        this.summonTimer = CONFIG.boss.summonEvery
        this.callbacks.onSummon(CONFIG.boss.summonCount)
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
          this.callbacks.onSlam(this.slamX, this.slamZ, CONFIG.boss.slamRadius, CONFIG.boss.damage)
          this.state = 'recover'
          this.stateTimer = 1.1
          this.slamCd = 3.4
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
        const sp = CONFIG.boss.chargeSpeed * dt
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
          this.x += nx * CONFIG.boss.speed * dt
          this.z += nz * CONFIG.boss.speed * dt
          moving = true
        }
        if (this.slamCd <= 0 && dist < 8.5) {
          this.state = 'windup'
          this.stateTimer = WINDUP
          this.slamX = targetX
          this.slamZ = targetZ
          this.warn.position.set(this.slamX, 0.045, this.slamZ)
          this.warn.scale.setScalar(CONFIG.boss.slamRadius * 2)
          this.warn.visible = true
          this.warnMat.opacity = 0.35
        } else if (this.phase2 && this.chargeCd <= 0 && dist > 6.5) {
          this.state = 'charge'
          this.stateTimer = 0.75
          this.chargeX = nx
          this.chargeZ = nz
          this.chargeCd = 4.5
        }
        break
      }
    }

    // 预警圈随 Boss 动画保持可见性
    this.warn.position.y = 0.045
    this.warn.scale.setScalar(CONFIG.boss.slamRadius * 2)

    // 朝向按相机转屏幕系
    const screen = rotateInput(nx, nz, getBillboardYaw())
    if (Math.abs(screen.x) > Math.abs(screen.z)) {
      this.facing = screen.x > 0 ? 'right' : 'left'
    } else {
      this.facing = screen.z > 0 ? 'down' : 'up'
    }

    // 帧：站立呼吸（慢）/ 移动（更慢的重步）
    let frame: number
    if (this.state === 'windup') {
      frame = 2
    } else if (this.state === 'charge' || moving) {
      frame = 2 + (Math.floor(this.clock * 5) % 2)
    } else {
      frame = Math.floor(this.clock * 1.6) % 2
    }
    setSpriteFrame(this.sprite, this.anim, this.facing, frame)
    this.sprite.rotation.y = getBillboardYaw()

    // 王站立时的呼吸起伏：整体轻微上下 + 横向微胀
    const breath = Math.sin(this.clock * 1.7)
    this.sprite.position.y = breath * 0.025
    this.sprite.scale.set(1 + breath * 0.012, 1 + breath * 0.02, 1)

    // 受击闪白（由 hit 内的计时控制）
    this.updateFlash(dt)
  }

  private flash = 0

  private updateFlash(dt: number): void {
    if (this.flash <= 0) {
      this.mat.color.setScalar(1)
      return
    }
    this.flash = Math.max(0, this.flash - dt)
    this.mat.color.setScalar(1 + (this.flash / 0.1) * 2.8)
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
      // 死亡后 update 不再推进受击闪白，这里立刻恢复本色，交给 game.ts 做旋转消散
      this.flash = 0
      this.mat.color.setScalar(1)
      this.warn.visible = false
      this.warnMat.opacity = 0
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
    this.warn.geometry.dispose()
    this.warnMat.dispose()
  }
}
