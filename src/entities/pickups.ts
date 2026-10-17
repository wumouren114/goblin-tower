import * as THREE from 'three'
import type { PickupKind } from '../types'
import { CONFIG } from '../data/gameConfig'
import { PixelCanvas } from '../art/pixels'
import { getBillboardYaw, particleTexture, textureFromPixels } from '../art/sprites'

const MAX_PICKUPS = 260
const PICK_RADIUS = 0.5
const ITEM_GEO = new THREE.PlaneGeometry(1, 1)
const GLOW_GEO = new THREE.PlaneGeometry(1, 1)

/** 每种拾取物的像素图标尺寸（世界米） */
const SIZE: Record<PickupKind, number> = { xp: 0.32, gold: 0.3, scroll: 0.62, heart: 0.36 }
const GLOW_SIZE: Record<PickupKind, number> = { xp: 1.0, gold: 0.7, scroll: 1.9, heart: 0.8 }
const GLOW_COLOR: Record<PickupKind, number> = {
  xp: 0x5ff5da,
  gold: 0xffd76a,
  scroll: 0xffe9a8,
  heart: 0xff6b7f,
}
const BASE_Y: Record<PickupKind, number> = { xp: 0.34, gold: 0.32, scroll: 0.5, heart: 0.34 }

const iconCache = new Map<PickupKind, THREE.CanvasTexture>()

/** 程序化绘制拾取物图标（每类只画一次） */
function pickupTexture(kind: PickupKind): THREE.CanvasTexture {
  const cached = iconCache.get(kind)
  if (cached) return cached
  const pc = new PixelCanvas(16, 16)
  if (kind === 'xp') {
    const c = 0x5ff5da
    const dark = 0x0d3b3c
    pc.triangle(8, 1, 2, 8, 14, 8, c)
    pc.triangle(2, 8, 14, 8, 8, 15, c)
    pc.hLine(4, 12, 8, 0xd8fff7)
    pc.set(6, 5, 0xf2fffd)
    pc.set(7, 5, 0xd8fff7)
    pc.outline(dark)
  } else if (kind === 'gold') {
    pc.circle(8, 8, 6, 0xffd76a)
    pc.circle(8, 8, 4, 0xf2b23e)
    pc.circle(8, 8, 2, 0xffe9a8)
    pc.set(8, 4, 0xfff6d8)
    pc.set(7, 5, 0xfff6d8)
    pc.outline(0x4a2c0d)
  } else if (kind === 'scroll') {
    // 卷轴：羊皮纸 + 红色缎带
    pc.fillRect(4, 3, 9, 11, 0xe8d8a8)
    pc.fillRect(3, 2, 2, 13, 0xc9b483)
    pc.fillRect(12, 2, 2, 13, 0xc9b483)
    pc.fillRect(5, 5, 7, 1, 0xb8a06a)
    pc.fillRect(5, 8, 7, 1, 0xb8a06a)
    pc.fillRect(5, 11, 7, 1, 0xb8a06a)
    pc.fillRect(7, 2, 3, 13, 0xa23a2f)
    pc.fillRect(6, 13, 5, 2, 0x7c281f)
    pc.set(8, 6, 0xffe9a8)
    pc.outline(0x3a2a18)
  } else {
    // 红心
    pc.circle(6, 6, 4, 0xff6b7f)
    pc.circle(11, 6, 4, 0xff6b7f)
    pc.triangle(2, 7, 14, 7, 8, 15, 0xff6b7f)
    pc.set(5, 5, 0xffc2cc)
    pc.set(6, 4, 0xffc2cc)
    pc.outline(0x4a1520)
  }
  const tex = textureFromPixels(pc)
  iconCache.set(kind, tex)
  return tex
}

interface PickupItem {
  kind: PickupKind
  value: number
  x: number
  z: number
  vx: number
  vz: number
  magnet: boolean
  magnetDelay: number
  phase: number
  age: number
  group: THREE.Group
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  glow: THREE.Mesh
  glowMat: THREE.MeshBasicMaterial
  spark: THREE.Mesh | null
  sparkMat: THREE.MeshBasicMaterial | null
}

/**
 * 经验豆 / 金币 / 卷轴 / 红心的掉落管理器。
 * 所有拾取物共用少量纹理与几何，上限 260 个，超出时复用最早的个体。
 */
export class PickupManager {
  private readonly scene: THREE.Scene
  private readonly items: PickupItem[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  get count(): number {
    return this.items.length
  }

  spawn(kind: PickupKind, x: number, z: number, value?: number): void {
    const v = value ?? defaultValue(kind)
    if (this.items.length >= MAX_PICKUPS) {
      // 复用最早生成的拾取物
      const old = this.items.shift()!
      this.configure(old, kind, x, z, v)
      this.items.push(old)
      return
    }
    const item = this.createItem(kind, x, z, v)
    this.items.push(item)
  }

  /** 全吸（升级清场）：无视距离直接飞向玩家 */
  vacuumAll(): void {
    for (const it of this.items) {
      it.magnet = true
      it.magnetDelay = 0
      it.vx = 0
      it.vz = 0
    }
  }

  update(
    dt: number,
    px: number,
    pz: number,
    magnetRadius: number,
    onCollect: (kind: PickupKind, value: number) => void,
  ): void {
    const yaw = getBillboardYaw()
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.age += dt
      const dx = px - it.x
      const dz = pz - it.z
      const dist = Math.hypot(dx, dz)
      const inv = dist > 1e-4 ? 1 / dist : 0
      const nx = dx * inv
      const nz = dz * inv

      // 进入吸附半径：先向外轻轻一弹，再加速飞向玩家
      if (!it.magnet && dist < magnetRadius) {
        it.magnet = true
        it.magnetDelay = 0.09
        it.vx = -nx * 3.4
        it.vz = -nz * 3.4
      }

      if (it.magnet) {
        if (it.magnetDelay > 0) {
          it.magnetDelay -= dt
        } else {
          const accel = CONFIG.economy.magnetAccel
          it.vx += nx * accel * dt
          it.vz += nz * accel * dt
          const sp = Math.hypot(it.vx, it.vz)
          const max = CONFIG.economy.magnetMaxSpeed
          if (sp > max) {
            it.vx = (it.vx / sp) * max
            it.vz = (it.vz / sp) * max
          }
        }
        it.x += it.vx * dt
        it.z += it.vz * dt
      }

      // 拾取判定（吸附移动后用最新距离，避免高速穿过玩家）
      const distNow = it.magnet ? Math.hypot(px - it.x, pz - it.z) : dist
      if (distNow < PICK_RADIUS) {
        onCollect(it.kind, it.value)
        this.destroyItem(it)
        this.items.splice(i, 1)
        continue
      }

      // 视觉：billboard + 上下浮动 + 呼吸光
      const bob = Math.sin(it.age * 2.6 + it.phase) * (it.kind === 'scroll' ? 0.1 : 0.06)
      const y = BASE_Y[it.kind] + bob
      it.group.position.set(it.x, y, it.z)
      it.group.rotation.y = yaw
      const pulse = 0.55 + 0.45 * Math.sin(it.age * 3.2 + it.phase)
      it.glowMat.opacity = 0.22 + pulse * 0.28
      const gs = GLOW_SIZE[it.kind] * (0.9 + pulse * 0.12)
      it.glow.scale.set(gs, gs, 1)
      if (it.kind === 'gold') {
        // 金币旋转：用横向缩放模拟
        it.mesh.scale.x = SIZE.gold * (0.3 + Math.abs(Math.cos(it.age * 4 + it.phase)) * 0.7)
      } else if (it.kind === 'scroll') {
        it.mesh.scale.setScalar(SIZE.scroll * (0.96 + pulse * 0.06))
      }
      // 卷轴上浮的金色粒子
      if (it.spark && it.sparkMat) {
        const cycle = (it.age * 0.9 + it.phase) % 1
        it.spark.position.y = -0.1 + cycle * 0.9
        it.sparkMat.opacity = (1 - cycle) * 0.8
        const sc = 0.16 + cycle * 0.12
        it.spark.scale.set(sc, sc, 1)
      }
      it.mat.opacity = 1
    }
  }

  clear(): void {
    for (const it of this.items) this.destroyItem(it)
    this.items.length = 0
  }

  dispose(): void {
    this.clear()
  }

  private createItem(kind: PickupKind, x: number, z: number, value: number): PickupItem {
    const group = new THREE.Group()
    group.position.set(x, BASE_Y[kind], z)
    this.scene.add(group)

    const mat = new THREE.MeshBasicMaterial({
      map: pickupTexture(kind),
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(ITEM_GEO, mat)
    mesh.scale.setScalar(SIZE[kind])
    mesh.renderOrder = 4
    group.add(mesh)

    const glowMat = new THREE.MeshBasicMaterial({
      map: particleTexture('glow'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: GLOW_COLOR[kind],
      toneMapped: false,
    })
    const glow = new THREE.Mesh(GLOW_GEO, glowMat)
    glow.position.z = -0.01
    glow.scale.setScalar(GLOW_SIZE[kind])
    glow.renderOrder = 3
    group.add(glow)

    let spark: THREE.Mesh | null = null
    let sparkMat: THREE.MeshBasicMaterial | null = null
    if (kind === 'scroll') {
      sparkMat = new THREE.MeshBasicMaterial({
        map: particleTexture('spark'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffe9a8,
        toneMapped: false,
      })
      spark = new THREE.Mesh(GLOW_GEO, sparkMat)
      spark.renderOrder = 5
      group.add(spark)
    }

    return {
      kind,
      value,
      x,
      z,
      vx: 0,
      vz: 0,
      magnet: false,
      magnetDelay: 0,
      phase: Math.random() * Math.PI * 2,
      age: 0,
      group,
      mesh,
      mat,
      glow,
      glowMat,
      spark,
      sparkMat,
    }
  }

  /** 复用旧对象：换图标、换尺寸、挪位置 */
  private configure(it: PickupItem, kind: PickupKind, x: number, z: number, value: number): void {
    it.kind = kind
    it.value = value
    it.x = x
    it.z = z
    it.vx = 0
    it.vz = 0
    it.magnet = false
    it.magnetDelay = 0
    it.age = 0
    it.phase = Math.random() * Math.PI * 2
    it.mat.map = pickupTexture(kind)
    it.mat.needsUpdate = true
    it.mesh.scale.setScalar(SIZE[kind])
    it.glowMat.color.setHex(GLOW_COLOR[kind])
    it.glow.scale.setScalar(GLOW_SIZE[kind])
    if (kind === 'scroll' && !it.spark) {
      const sparkMat = new THREE.MeshBasicMaterial({
        map: particleTexture('spark'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffe9a8,
        toneMapped: false,
      })
      const spark = new THREE.Mesh(GLOW_GEO, sparkMat)
      spark.renderOrder = 5
      it.group.add(spark)
      it.spark = spark
      it.sparkMat = sparkMat
    } else if (kind !== 'scroll' && it.spark) {
      it.group.remove(it.spark)
      it.sparkMat?.dispose()
      it.spark = null
      it.sparkMat = null
    }
    it.group.position.set(x, BASE_Y[kind], z)
  }

  private destroyItem(it: PickupItem): void {
    this.scene.remove(it.group)
    it.group.clear()
    it.mat.dispose()
    it.glowMat.dispose()
    it.sparkMat?.dispose()
  }
}

function defaultValue(kind: PickupKind): number {
  if (kind === 'xp') return CONFIG.economy.xpPerBean
  if (kind === 'heart') return 25
  if (kind === 'gold') return CONFIG.economy.coinValue
  return 1
}
