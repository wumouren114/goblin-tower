import * as THREE from 'three'
import { CONFIG, BASE_STATS } from '../data/gameConfig'
import type { CharacterId, Circle, Facing, PlayerStats } from '../types'
import { rotateInput } from '../core/math'
import { rng } from '../core/rng'
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

/** 三角色的 billboard 染色（美术资源只有一张图集，先用色调区分） */
const CHAR_TINT: Record<CharacterId, { sprite: number; ring: number; ghost: number }> = {
  mutsumi: { sprite: 0xffffff, ring: 0x5ff5da, ghost: 0x6fe6ff },
  murasame: { sprite: 0xffc2c2, ring: 0xff9fb0, ghost: 0xff9fb0 },
  fish: { sprite: 0xbdefff, ring: 0x7fd8ff, ghost: 0x7fd8ff },
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
  private anim: SpriteAnim
  private readonly sprite: THREE.Mesh
  private charId: CharacterId | 'mortis'
  private readonly spriteMat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  private readonly ring: THREE.Mesh
  private readonly ghosts: Ghost[] = []

  private animClock = 0
  private flash = 0
  private ghostTimer = 0
  /** 冲刺方向（屏幕系；dashToward 时为世界系，见 dashWorld） */
  private dashX = 0
  private dashZ = 1
  private dashWorld = false
  private dashSpeed = CONFIG.player.dashSpeed
  private cameraYaw = 0
  private tint = new THREE.Color(0xffffff)
  private moving = false

  constructor(scene: THREE.Scene, x = 0, z = 0, charId: CharacterId = 'mutsumi') {
    this.scene = scene
    this.x = x
    this.z = z
    this.charId = charId
    this.tint.setHex(CHAR_TINT[charId].sprite)
    this.anim = playerSprite(charId)
    this.group = new THREE.Group()
    this.group.position.set(this.x, 0, this.z)
    scene.add(this.group)

    this.sprite = createSpriteMesh(this.anim)
    this.spriteMat = this.sprite.material as THREE.MeshBasicMaterial
    this.spriteMat.color.setHex(0xffffff)
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
      color: CHAR_TINT[charId].ring,
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
        color: CHAR_TINT[charId].ghost,
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
  /** 切换角色/形态外观（若叶睦 ↔ Mortis），无头模式下也安全 */
  setVisual(id: CharacterId | 'mortis'): void {
    if (this.charId === id) return
    this.charId = id
    this.anim = playerSprite(id)
  }

  setStats(stats: PlayerStats): void {
    this.stats = { ...stats }
    if (this.hp > this.stats.maxHp) this.hp = this.stats.maxHp
    this.updateRing()
  }

  heal(amount: number): void {
    if (!this.alive || amount <= 0) return
    this.hp = Math.min(this.stats.maxHp, this.hp + amount)
  }

  /** 读档 / 被动回血上限：直接设定当前血量（0 即倒地） */
  setHp(n: number): void {
    this.hp = Math.max(0, Math.min(this.stats.maxHp, n))
    this.alive = this.hp > 0
  }

  /** 无敌帧（突进/技能给） */
  grantInvuln(seconds: number): void {
    if (seconds <= 0) return
    this.invuln = Math.max(this.invuln, seconds)
  }

  /** 返回实际扣血量；无敌帧内返回 0 */
  takeDamage(amount: number): number {
    if (!this.alive || this.invuln > 0 || amount <= 0) return 0
    // 闪避：0..0.24（game.ts 若已在外部掷过，传 0 伤害即可）
    if (this.stats.dodge > 0 && rng.chance(this.stats.dodge)) {
      this.invuln = Math.max(this.invuln, 0.18)
      this.flash = 0.08
      return 0
    }
    // armorRate 比例减伤 + armor 固定减伤
    const rate = Math.max(0, Math.min(0.6, this.stats.armorRate))
    const flat = Math.max(0, this.stats.armor)
    const dealt = Math.max(1, amount * (1 - rate) - flat)
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
    this.dashWorld = false
    this.dashSpeed = CONFIG.player.dashSpeed
    this.dashTimeLeft = CONFIG.player.dashDuration
    this.dashCooldownLeft = Math.max(0.2, this.stats.dashCooldown)
    // 冲刺全程无敌（覆盖后续 1 帧保险）
    this.invuln = Math.max(this.invuln, CONFIG.player.dashDuration + 0.05)
    this.ghostTimer = 0
    this.faceFromInput(dx, dz)
    return true
  }

  /**
   * 世界系定向突进（丛雨右键）：不占冲刺冷却，速度 = distance/duration。
   * game.ts 通过 CombatWorld.dashPlayer 转调；方向已归一化。
   */
  dashToward(dirX: number, dirZ: number, distance: number, duration: number): void {
    if (!this.alive || distance <= 0 || duration <= 0) return
    const len = Math.hypot(dirX, dirZ)
    if (len < 1e-4) return
    const dx = dirX / len
    const dz = dirZ / len
    this.dashX = dx
    this.dashZ = dz
    this.dashWorld = true
    this.dashSpeed = distance / duration
    this.dashTimeLeft = duration
    this.invuln = Math.max(this.invuln, duration + 0.05)
    this.ghostTimer = 0
    const screen = rotateInput(dx, dz, this.cameraYaw)
    this.faceFromInput(screen.x, screen.z)
  }

  update(dt: number, moveX: number, moveZ: number, cameraYaw: number, colliders: Circle[], bounds: number): void {
    // 相机 yaw 提供给所有 billboard 实体
    setBillboardYaw(cameraYaw)
    this.cameraYawCache = cameraYaw
    this.cameraYaw = cameraYaw

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
      // 冲刺：世界系方向直接用；屏幕系方向按当前相机朝向转世界
      const screen = this.dashWorld
        ? rotateInput(this.dashX, this.dashZ, cameraYaw)
        : { x: this.dashX, z: this.dashZ }
      const dir = this.dashWorld
        ? { x: this.dashX, z: this.dashZ }
        : rotateInput(this.dashX, this.dashZ, cameraYaw)
      this.x += dir.x * this.dashSpeed * dt
      this.z += dir.z * this.dashSpeed * dt
      this.dashTimeLeft = Math.max(0, this.dashTimeLeft - dt)
      moving = true
      this.moving = true
      this.lastInputX = screen.x
      this.lastInputZ = screen.z
      this.faceFromInput(screen.x, screen.z)
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

  /** 攻击/技能时朝世界坐标转向（自动索敌用） */
  faceToward(wx: number, wz: number): void {
    const dx = wx - this.x
    const dz = wz - this.z
    if (dx * dx + dz * dz < 0.0001) return
    const c = Math.cos(this.cameraYawCache)
    const s = Math.sin(this.cameraYawCache)
    this.faceFromInput(dx * c - dz * s, -dx * s - dz * c)
  }

  private cameraYawCache = 0
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
    const dash = this.dashTimeLeft > 0
    const moving = dash || runFactor > 0
    let frame: number
    let phase = 0
    if (dash) {
      const t = this.animClock * 16
      frame = 2 + (Math.floor(t) % 4)
      phase = (t % 4) / 4
    } else if (runFactor > 0) {
      // 跑动帧率随移速提高（≈15~18fps，之前 7fps 像幻灯片）
      const runFps = 11 + this.stats.moveSpeed * 1.1
      const t = this.animClock * runFps
      frame = 2 + (Math.floor(t) % 4)
      phase = (t % 4) / 4
    } else {
      frame = Math.floor(this.animClock * 2.2) % 2
    }
    setSpriteFrame(this.sprite, this.anim, this.facing, frame)
    this.sprite.rotation.y = getBillboardYaw()

    // 原画只有 4 张跑动帧，单靠换图仍然像轮播：叠一层程序化「跨步」
    // —— 交替的小跳 + 左右微倾 + 触地压扁，让 4 帧之间连续起来
    const wave = Math.sin(phase * Math.PI * 2)
    const bounce = moving ? Math.abs(wave) : 0
    this.sprite.position.y = bounce * (dash ? 0.07 : 0.045)
    this.sprite.rotation.z = moving ? wave * (dash ? 0.10 : 0.045) : 0
    const squash = moving ? 1 - bounce * 0.03 : 1
    this.sprite.scale.set(1 + (1 - squash) * 0.7, squash, 1)
  }

  private updateVisuals(dt: number): void {
    // 受击闪白用颜色乘数，无敌帧用轻微闪烁
    const flashK = this.flash > 0 ? this.flash / 0.14 : 0
    const base = 1 + flashK * 2.4
    this.spriteMat.color.setScalar(base).multiply(this.tint)
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
