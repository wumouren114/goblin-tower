import * as THREE from 'three'
import { CONFIG, BASE_STATS } from '../data/gameConfig'
import type { Circle, Facing, PlayerStats } from '../types'
import { rotateInput } from '../core/math'
import {
  createShadowMesh,
  createSpriteMesh,
  getBillboardYaw,
  particleTexture,
  playerSprite,
  setBillboardYaw,
  setSpriteFrame,
  type SpriteAnim,
} from '../art/sprites'

export type PlayerAnim = 'idle' | 'run' | 'dash' | 'hurt'

interface Ghost {
  mesh: THREE.Mesh
  material: THREE.MeshBasicMaterial
  life: number
  maxLife: number
}

/**
 * 主角：红黑长发冒险者少女（像素 billboard）。
 *
 * 坐标权威：`x/z` 是唯一真相，update 每帧先写回 group.position；
 * 冲刺位移由本类在 update 内完成，外部只调用 tryDash 给方向。
 */
export class Player {
  readonly group: THREE.Group
  x = 0
  z = 0
  radius: number = CONFIG.player.radius
  stats: PlayerStats = { ...BASE_STATS }
  hp: number = CONFIG.player.maxHp
  alive = true
  invuln = 0
  facing: Facing = 'down'
  dashCooldownLeft = 0
  dashTimeLeft = 0

  private readonly scene: THREE.Scene
  private readonly anim: SpriteAnim
  private readonly sprite: THREE.Mesh
  private readonly spriteMat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  private readonly ring: THREE.Mesh
  private readonly ghosts: Ghost[] = []

  private animClock = 0
  private flash = 0
  private ghostTimer = 0
  /** 冲刺方向（屏幕系，update 时再按当前 yaw 转世界） */
  private dashX = 0
  private dashZ = 1
  private moving = false

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.anim = playerSprite()
    this.group = new THREE.Group()
    this.group.position.set(this.x, 0, this.z)
    scene.add(this.group)

    this.sprite = createSpriteMesh(this.anim)
    this.spriteMat = this.sprite.material as THREE.MeshBasicMaterial
    this.group.add(this.sprite)

    this.shadow = createShadowMesh(1.0, 0.62)
    this.shadow.position.y = 0.02
    this.group.add(this.shadow)

    // 拾取半径光圈（呼吸式亮度在 update 里推进）
    const ringGeo = new THREE.PlaneGeometry(1, 1)
    const ringMat = new THREE.MeshBasicMaterial({
      map: particleTexture('ring'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0x5ff5da,
      toneMapped: false,
    })
    this.ring = new THREE.Mesh(ringGeo, ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.03
    this.ring.renderOrder = 1
    this.group.add(this.ring)
    this.updateRing()

    // 冲刺残影池：放在场景根节点，不跟随玩家移动
    for (let i = 0; i < 3; i++) {
      const geo = new THREE.PlaneGeometry(this.anim.worldW, this.anim.worldH)
      geo.translate(0, this.anim.worldH / 2, 0)
      const mat = new THREE.MeshBasicMaterial({
        map: this.anim.texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        color: 0x6fe6ff,
        toneMapped: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.visible = false
      mesh.renderOrder = 2
      scene.add(mesh)
      this.ghosts.push({ mesh, material: mat, life: 0, maxLife: 0.28 })
    }
  }

  /** 主角数值变化：maxHp 变化不会自动回血 */
  setStats(stats: PlayerStats): void {
    this.stats = { ...stats }
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp
    this.updateRing()
  }

  heal(amount: number): void {
    if (!this.alive || amount <= 0) return
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }

  /** 返回实际扣血量；无敌帧内返回 0 */
  takeDamage(amount: number): number {
    if (!this.alive || this.invuln > 0 || amount <= 0) return 0
    const dealt = Math.max(1, amount - this.stats.armor)
    this.hp = Math.max(0, this.hp - dealt)
    this.invuln = CONFIG.player.iFrames
    this.flash = 0.14
    // 微击退：沿上一帧移动方向反向弹一点
    if (this.moving) {
      const back = rotateInput(-this.lastInputX, -this.lastInputZ, getBillboardYaw())
      this.x += back.x * 0.12
      this.z += back.z * 0.12
    }
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    return dealt
  }

  /** 尝试冲刺；方向是屏幕系输入（x 右、z 前），位移在 update 内完成 */
  tryDash(dirX: number, dirZ: number): boolean {
    if (!this.alive || this.dashCooldownLeft > 0 || this.dashTimeLeft > 0) return false
    let dx = dirX
    let dz = dirZ
    const len = Math.hypot(dx, dz)
    if (len < 0.01) {
      // 没给方向就朝当前朝向冲
      const f = facingVector(this.facing)
      dx = f.x
      dz = f.z
    } else {
      dx /= len
      dz /= len
    }
    this.dashX = dx
    this.dashZ = dz
    this.dashTimeLeft = CONFIG.player.dashDuration
    this.dashCooldownLeft = Math.max(0.2, this.stats.dashCooldown)
    // 冲刺全程无敌（覆盖后续 1 帧保险）
    this.invuln = Math.max(this.invuln, CONFIG.player.dashDuration + 0.05)
    this.ghostTimer = 0
    this.faceFromInput(dx, dz)
    return true
  }

  update(dt: number, moveX: number, moveZ: number, cameraYaw: number, colliders: Circle[], bounds: number): void {
    // 相机 yaw 提供给所有 billboard 实体
    setBillboardYaw(cameraYaw)

    this.invuln = Math.max(0, this.invuln - dt)
    this.dashCooldownLeft = Math.max(0, this.dashCooldownLeft - dt)
    this.flash = Math.max(0, this.flash - dt)

    // 先同步权威坐标，再叠加自身移动
    this.group.position.set(this.x, 0, this.z)

    if (!this.alive) {
      this.animate(dt, 0)
      this.updateVisuals(dt)
      return
    }

    let moving = false
    if (this.dashTimeLeft > 0) {
      // 冲刺：按当前相机朝向把屏幕方向转成世界方向
      const dir = rotateInput(this.dashX, this.dashZ, cameraYaw)
      this.x += dir.x * CONFIG.player.dashSpeed * dt
      this.z += dir.z * CONFIG.player.dashSpeed * dt
      this.dashTimeLeft = Math.max(0, this.dashTimeLeft - dt)
      moving = true
      this.moving = true
      this.lastInputX = this.dashX
      this.lastInputZ = this.dashZ
      this.faceFromInput(this.dashX, this.dashZ)
      this.emitGhosts(dt)
    } else {
      let mx = moveX
      let mz = moveZ
      const len = Math.hypot(mx, mz)
      if (len > 1) {
        mx /= len
        mz /= len
      }
      moving = len > 0.001
      this.moving = moving
      if (moving) {
        const dir = rotateInput(mx, mz, cameraYaw)
        this.x += dir.x * this.stats.moveSpeed * dt
        this.z += dir.z * this.stats.moveSpeed * dt
        this.lastInputX = mx
        this.lastInputZ = mz
        this.faceFromInput(mx, mz)
      } else {
        this.lastInputX = 0
        this.lastInputZ = 0
      }
      this.ghostTimer = 0
    }

    // 圆形障碍推挤（木桶、柱子等）
    for (const c of colliders) {
      const dx = this.x - c.x
      const dz = this.z - c.z
      const rr = c.r + this.radius
      const d2 = dx * dx + dz * dz
      if (d2 >= rr * rr) continue
      const d = Math.sqrt(d2)
      if (d < 1e-4) {
        this.x += rr
        continue
      }
      const push = rr - d
      this.x += (dx / d) * push
      this.z += (dz / d) * push
    }

    // 方形场地 clamp
    const limit = bounds - this.radius
    this.x = Math.max(-limit, Math.min(limit, this.x))
    this.z = Math.max(-limit, Math.min(limit, this.z))
    this.group.position.set(this.x, 0, this.z)

    this.animate(dt, moving ? 1 : 0)
    this.updateVisuals(dt)
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.group.clear()
    this.sprite.geometry.dispose()
    this.spriteMat.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.ring.geometry.dispose()
    ;(this.ring.material as THREE.Material).dispose()
    for (const g of this.ghosts) {
      this.scene.remove(g.mesh)
      g.mesh.geometry.dispose()
      g.material.dispose()
    }
    this.ghosts.length = 0
  }

  private lastInputX = 0
  private lastInputZ = 0

  private faceFromInput(x: number, z: number): void {
    if (Math.abs(x) > Math.abs(z)) {
      this.facing = x > 0 ? 'right' : 'left'
    } else if (Math.abs(z) > 0.001) {
      // 屏幕向下（+z）是朝向镜头
      this.facing = z > 0 ? 'down' : 'up'
    }
  }

  private animate(dt: number, runFactor: number): void {
    this.animClock += dt
    let frame: number
    if (this.dashTimeLeft > 0) {
      frame = 2 + (Math.floor(this.animClock * 16) % 2)
    } else if (runFactor > 0) {
      // 跑动帧率随移速提高，加速词条能看出来更快
      const runFps = Math.max(7, this.stats.moveSpeed * 1.5)
      frame = 2 + (Math.floor(this.animClock * runFps) % 2)
    } else {
      frame = Math.floor(this.animClock * 2.2) % 2
    }
    setSpriteFrame(this.sprite, this.anim, this.facing, frame)
    this.sprite.rotation.y = getBillboardYaw()
  }

  private updateVisuals(dt: number): void {
    // 受击闪白用颜色乘数，无敌帧用轻微闪烁
    const flashK = this.flash > 0 ? this.flash / 0.14 : 0
    const base = 1 + flashK * 2.4
    this.spriteMat.color.setScalar(base)
    if (this.invuln > 0 && this.dashTimeLeft <= 0 && this.flash <= 0) {
      this.spriteMat.opacity = 0.55 + 0.45 * Math.abs(Math.sin(this.animClock * 26))
    } else {
      this.spriteMat.opacity = 1
    }

    // 光圈：亮度呼吸 + 随拾取半径缩放
    const ringMat = this.ring.material as THREE.MeshBasicMaterial
    ringMat.opacity = this.alive ? 0.24 + 0.1 * Math.sin(this.animClock * 2.4) : 0

    // 残影淡出
    for (const g of this.ghosts) {
      if (g.life <= 0) continue
      g.life = Math.max(0, g.life - dt)
      const t = g.life / g.maxLife
      g.material.opacity = t * 0.42
      if (g.life <= 0) g.mesh.visible = false
    }
  }

  private emitGhosts(dt: number): void {
    this.ghostTimer -= dt
    if (this.ghostTimer > 0) return
    this.ghostTimer = 0.045
    // 取一个已经消失的残影复用
    let slot = this.ghosts.find((g) => g.life <= 0)
    if (!slot) slot = this.ghosts.reduce((a, b) => (a.life < b.life ? a : b))
    slot.mesh.position.set(this.x, 0, this.z)
    slot.mesh.rotation.y = getBillboardYaw()
    // 残影冻结当前帧
    const list = this.anim.frames[this.facing]
    const frame = 2 + (Math.floor(this.animClock * 16) % 2)
    const f = list[frame % 4]
    const col = Math.round(f.offsetX * this.anim.cols)
    const row = Math.round(f.offsetY * this.anim.rows)
    const uv = slot.mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
    const u0 = col / this.anim.cols
    const u1 = (col + 1) / this.anim.cols
    const vT = row / this.anim.rows
    const vB = (row + 1) / this.anim.rows
    uv.setXY(0, u0, vT)
    uv.setXY(1, u1, vT)
    uv.setXY(2, u0, vB)
    uv.setXY(3, u1, vB)
    uv.needsUpdate = true
    slot.life = slot.maxLife
    slot.mesh.visible = true
    slot.material.opacity = 0.42
  }

  private updateRing(): void {
    // 光圈半径 = 拾取半径（贴地直径 = 2 × pickupRadius）
    const d = Math.max(0.8, this.stats.pickupRadius * 2)
    this.ring.scale.set(d, d, 1)
  }
}

/** 朝向对应的世界方向（未考虑相机旋转的基准，相机系 = down 朝 +z） */
function facingVector(f: Facing): { x: number; z: number } {
  switch (f) {
    case 'up':
      return { x: 0, z: -1 }
    case 'left':
      return { x: -1, z: 0 }
    case 'right':
      return { x: 1, z: 0 }
    default:
      return { x: 0, z: 1 }
  }
}
