import * as THREE from 'three'
import type { PickupKind } from '../types'
import { PixelCanvas } from '../art/pixels'
import { particleTexture, textureFromPixels } from '../art/sprites'
import { artReady, artTexture, type ArtKey } from '../art/atlasImport'
import { BillboardBatch } from '../art/billboardBatch'

/**
 * v3 拾取物种类：
 *  - gold  金币（击杀掉落，进金币池）
 *  - heart 红心（回血）
 *  - rice  白米饭（肥鱼专武 lv3 掉落，拾取 +20 充能）
 *  - card  掉落卡片（进背包，本层结束后三选一）
 *
 * types.ts 的 PickupKind 由 Lead 按契约同步为这 4 种；这里先本地兜底，
 * 保证即使 types.ts 还没改完，world/entities 侧也是 v3 语义。
 */
export type PickupKindV3 = 'gold' | 'heart' | 'rice' | 'card'

/** 兼容旧 types.ts 的 PickupKind（Lead 同步后即等价） */
export type PickupKindCompat = PickupKind | PickupKindV3

/** 米饭回充能值（契约 §4：拾取回 20 充能） */
export const RICE_CHARGE = 20

const MAX_PICKUPS = 260
const PICK_RADIUS = 0.5

/** 磁吸：先向外轻弹再加速（保留旧手感） */
const MAGNET_BOUNCE = 3.4
const MAGNET_DELAY = 0.09
const MAGNET_ACCEL = 26
const MAGNET_MAX_SPEED = 24

/** 每种拾取物的像素图标尺寸（世界米） */
const SIZE: Record<PickupKindV3, number> = { gold: 0.3, heart: 0.36, rice: 0.4, card: 0.44 }
const GLOW_SIZE: Record<PickupKindV3, number> = { gold: 0.7, heart: 0.8, rice: 1.1, card: 1.5 }
const GLOW_COLOR: Record<PickupKindV3, number> = {
  gold: 0xffd76a,
  heart: 0xff6b7f,
  rice: 0x7ef3d0, // 青绿光
  card: 0xffd76a, // 金色光
}
const BASE_Y: Record<PickupKindV3, number> = { gold: 0.32, heart: 0.34, rice: 0.36, card: 0.4 }

const iconCache = new Map<PickupKindV3, THREE.CanvasTexture>()

/** 程序化绘制拾取物图标（每类只画一次） */
function pickupTexture(kind: PickupKindV3): THREE.CanvasTexture {
  const cached = iconCache.get(kind)
  if (cached) return cached
  const pc = new PixelCanvas(16, 16)
  if (kind === 'gold') {
    pc.circle(8, 8, 6, 0xffd76a)
    pc.circle(8, 8, 4, 0xf2b23e)
    pc.circle(8, 8, 2, 0xffe9a8)
    pc.set(8, 4, 0xfff6d8)
    pc.set(7, 5, 0xfff6d8)
    pc.outline(0x4a2c0d)
  } else if (kind === 'heart') {
    // 红心
    pc.circle(6, 6, 4, 0xff6b7f)
    pc.circle(11, 6, 4, 0xff6b7f)
    pc.triangle(2, 7, 14, 7, 8, 15, 0xff6b7f)
    pc.set(5, 5, 0xffc2cc)
    pc.set(6, 4, 0xffc2cc)
    pc.outline(0x4a1520)
  } else if (kind === 'rice') {
    // 白米饭团：白色三角饭团 + 底部海苔 + 米粒高光
    pc.triangle(8, 1, 1, 13, 15, 13, 0xfff8ec)
    pc.fillRect(3, 11, 10, 3, 0xfff8ec)
    pc.fillRect(6, 9, 4, 5, 0x1d3b34) // 海苔
    pc.set(7, 4, 0xd8fff2)
    pc.set(9, 5, 0xd8fff2)
    pc.set(5, 7, 0xd8fff2)
    pc.set(10, 8, 0xd8fff2)
    pc.set(4, 10, 0xe8fff8)
    pc.outline(0x173f38)
  } else {
    // 掉落卡片：深紫卡面 + 金边 + 中央金色符文
    pc.fillRect(2, 3, 12, 10, 0x2a1e33)
    pc.fillRect(2, 3, 12, 1, 0xffd76a)
    pc.fillRect(2, 12, 12, 1, 0xffd76a)
    pc.fillRect(2, 3, 1, 10, 0xffd76a)
    pc.fillRect(13, 3, 1, 10, 0xffd76a)
    pc.triangle(8, 5, 5, 9, 11, 9, 0xffe9a8)
    pc.triangle(8, 10, 5, 7, 11, 7, 0xffc84d)
    pc.set(8, 7, 0xfff6d8)
    pc.set(4, 4, 0xffe9a8)
    pc.set(11, 11, 0xffe9a8)
    pc.outline(0x0f0a14)
  }
  const tex = textureFromPixels(pc)
  iconCache.set(kind, tex)
  return tex
}

/** 拾取物对应的原画（assets/art_raw/*.png） */
const ART_KEY: Record<PickupKindV3, ArtKey> = {
  gold: 'pickup_coin',
  heart: 'pickup_heart',
  rice: 'pickup_rice',
  card: 'pickup_card',
}

interface IconVisual {
  /** 原画或程序化像素贴图（共享纹理，不能在拾取物销毁时释放） */
  tex: THREE.CanvasTexture
  /** 原画宽 / 高；程序化像素图恒为 1 */
  aspect: number
  art: boolean
}

/**
 * 拾取物图标：原画可用就用原画（保留原始像素比例），否则回退程序化像素图。
 * 每次取用都重新判断，保证 preloadArt() 晚于首帧完成时也能切到原画。
 */
function iconVisual(kind: PickupKindV3): IconVisual {
  if (artReady()) {
    const tex = artTexture(ART_KEY[kind])
    if (tex) {
      const img = tex.image as { width?: number; height?: number } | undefined
      const w = img?.width ?? 0
      const h = img?.height ?? 0
      return { tex, aspect: w > 0 && h > 0 ? w / h : 1, art: true }
    }
  }
  return { tex: pickupTexture(kind), aspect: 1, art: false }
}

interface PickupItem {
  kind: PickupKindV3
  value: number
  x: number
  z: number
  vx: number
  vz: number
  magnet: boolean
  magnetDelay: number
  phase: number
  age: number
  /** 图标批次 + 实例位（同纹理的图标合成 1 drawcall） */
  iconBatch: BillboardBatch
  iconIndex: number
  /** 原画贴图 flipY=false，写入 UV 时需要翻转 v */
  iconArt: boolean
  /** 图标基准尺寸（保留原画宽高比，金币旋转等动画基于它缩放） */
  baseW: number
  baseH: number
  glowIndex: number
  sparkIndex: number
}

/**
 * 金币 / 红心 / 白米饭 / 掉落卡片的掉落管理器。
 * 全部视觉走 billboard 合批：每种纹理 1 个 drawcall，不再按掉落物产生 mesh。
 */
export class PickupManager {
  private readonly scene: THREE.Scene
  private readonly items: PickupItem[] = []
  private readonly glowBatch: BillboardBatch
  private readonly sparkBatch: BillboardBatch
  private readonly iconBatches = new Map<THREE.Texture, BillboardBatch>()

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.glowBatch = new BillboardBatch(scene, particleTexture('glow'), MAX_PICKUPS, { renderOrder: 3 })
    this.sparkBatch = new BillboardBatch(scene, particleTexture('spark'), MAX_PICKUPS, { renderOrder: 5 })
  }

  get count(): number {
    return this.items.length
  }

  spawn(kind: PickupKindV3, x: number, z: number, value?: number): void {
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

  /** 全吸（清层收尾 / Boss 死亡）：无视距离直接飞向玩家 */
  vacuumAll(): void {
    for (const it of this.items) {
      it.magnet = true
      it.magnetDelay = 0
      it.vx = 0
      it.vz = 0
    }
  }

  /**
   * 立即结算并清空地面掉落。
   * 清层/离开战斗时调用，避免下一层 enterLayer 的 clear() 吞掉未拾取收益。
   */
  drainAll(): { kind: PickupKindV3; value: number }[] {
    if (this.items.length === 0) return []
    const drops = this.items.map((it) => ({ kind: it.kind, value: it.value }))
    this.clear()
    return drops
  }

  update(
    dt: number,
    px: number,
    pz: number,
    magnetRadius: number,
    onCollect: (kind: PickupKindV3, value: number) => void,
  ): void {
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
        it.magnetDelay = MAGNET_DELAY
        it.vx = -nx * MAGNET_BOUNCE
        it.vz = -nz * MAGNET_BOUNCE
      }

      if (it.magnet) {
        if (it.magnetDelay > 0) {
          it.magnetDelay -= dt
        } else {
          it.vx += nx * MAGNET_ACCEL * dt
          it.vz += nz * MAGNET_ACCEL * dt
          const sp = Math.hypot(it.vx, it.vz)
          if (sp > MAGNET_MAX_SPEED) {
            it.vx = (it.vx / sp) * MAGNET_MAX_SPEED
            it.vz = (it.vz / sp) * MAGNET_MAX_SPEED
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

      // 视觉：billboard + 上下浮动 + 呼吸光（全部写进合批实例）
      const bob = Math.sin(it.age * 2.6 + it.phase) * (it.kind === 'card' ? 0.1 : 0.06)
      const y = BASE_Y[it.kind] + bob
      const pulse = 0.55 + 0.45 * Math.sin(it.age * 3.2 + it.phase)
      const gs = GLOW_SIZE[it.kind] * (0.9 + pulse * 0.12)
      this.glowBatch.set(it.glowIndex, it.x, y, it.z, gs, gs, GLOW_COLOR[it.kind], 0.22 + pulse * 0.28)

      let sx = it.baseW
      let sy = it.baseH
      if (it.kind === 'gold') {
        // 金币旋转：用横向缩放模拟（按原画宽度缩放，保持宽高比）
        sx = it.baseW * (0.3 + Math.abs(Math.cos(it.age * 4 + it.phase)) * 0.7)
      } else if (it.kind === 'card' || it.kind === 'rice') {
        const s = 0.96 + pulse * 0.06
        sx = it.baseW * s
        sy = it.baseH * s
      }
      const v0 = it.iconArt ? 1 : 0
      const vs = it.iconArt ? -1 : 1
      it.iconBatch.set(it.iconIndex, it.x, y, it.z, sx, sy, 0xffffff, 1, 0, v0, 1, vs)

      // 卡片上浮的金色粒子
      if (it.sparkIndex >= 0) {
        const cycle = (it.age * 0.9 + it.phase) % 1
        const sc = 0.16 + cycle * 0.12
        this.sparkBatch.set(
          it.sparkIndex,
          it.x,
          BASE_Y[it.kind] - 0.1 + cycle * 0.9,
          it.z,
          sc,
          sc,
          0xffe9a8,
          (1 - cycle) * 0.8,
        )
      }
    }
  }

  /** 每帧末提交合批数据（无变化时 GPU 不会被无谓上传） */
  flush(): void {
    this.glowBatch.flush()
    this.sparkBatch.flush()
    for (const batch of this.iconBatches.values()) batch.flush()
  }

  clear(): void {
    for (const it of this.items) this.destroyItem(it)
    this.items.length = 0
    this.flush()
  }

  dispose(): void {
    this.clear()
    this.glowBatch.dispose()
    this.sparkBatch.dispose()
    for (const batch of this.iconBatches.values()) batch.dispose()
    this.iconBatches.clear()
  }

  private batchFor(texture: THREE.Texture): BillboardBatch {
    let batch = this.iconBatches.get(texture)
    if (!batch) {
      batch = new BillboardBatch(this.scene, texture, MAX_PICKUPS, {
        renderOrder: 4,
        blending: THREE.NormalBlending,
      })
      this.iconBatches.set(texture, batch)
    }
    return batch
  }

  private createItem(kind: PickupKindV3, x: number, z: number, value: number): PickupItem {
    const icon = iconVisual(kind)
    const batch = this.batchFor(icon.tex)
    const item: PickupItem = {
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
      iconBatch: batch,
      iconIndex: batch.acquire(),
      iconArt: icon.art,
      baseW: SIZE[kind] * icon.aspect,
      baseH: SIZE[kind],
      glowIndex: this.glowBatch.acquire(),
      sparkIndex: -1,
    }
    if (kind === 'card') item.sparkIndex = this.sparkBatch.acquire()
    return item
  }

  /** 复用旧对象：换图标、换尺寸、挪位置 */
  private configure(it: PickupItem, kind: PickupKindV3, x: number, z: number, value: number): void {
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

    const icon = iconVisual(kind)
    it.iconBatch.release(it.iconIndex)
    it.iconBatch = this.batchFor(icon.tex)
    it.iconIndex = it.iconBatch.acquire()
    it.iconArt = icon.art
    it.baseW = SIZE[kind] * icon.aspect
    it.baseH = SIZE[kind]

    if (kind === 'card') {
      if (it.sparkIndex < 0) it.sparkIndex = this.sparkBatch.acquire()
    } else if (it.sparkIndex >= 0) {
      this.sparkBatch.release(it.sparkIndex)
      it.sparkIndex = -1
    }
  }

  private destroyItem(it: PickupItem): void {
    it.iconBatch.release(it.iconIndex)
    this.glowBatch.release(it.glowIndex)
    if (it.sparkIndex >= 0) {
      this.sparkBatch.release(it.sparkIndex)
      it.sparkIndex = -1
    }
  }
}

function defaultValue(kind: PickupKindV3): number {
  if (kind === 'heart') return 25
  if (kind === 'rice') return RICE_CHARGE
  if (kind === 'card') return 1
  return 1 // gold：实际调用方会传 balance 的 coinValue，这里只兜底
}
