import * as THREE from 'three'
import { PixelCanvas } from './pixels'
import { createSpriteMesh, setSpriteFrame, textureFromPixels, type SpriteAnim } from './sprites'
import { artReady, artTexture, singleFrameAnimFromArt, type ArtKey } from './atlasImport'
import type { Facing } from '../types'

/**
 * 战斗弹道的贴图：优先用 AI 原画（assets/art_raw/proj_*.png），
 * 原画缺失/未加载时回退本文件的程序化像素图。
 * 两者都走 textureFromPixels/原画的最近邻采样 + createSpriteMesh billboard。
 */
export type ProjectileArtKind = 'cucumber' | 'bubble' | 'wave' | 'rice' | 'slash'

/** 原画键；按任务约定 rice 没有专属弹道原画，继续走程序化像素图 */
const ART_KEY: Partial<Record<ProjectileArtKind, ArtKey>> = {
  cucumber: 'proj_cucumber',
  bubble: 'proj_bubble',
  wave: 'proj_wave',
  slash: 'proj_slash',
}

/** 原画接入后每种弹道的世界宽度（米）；高度按原画宽高比推出，避免拉伸 */
const ART_WIDTH: Record<ProjectileArtKind, number> = {
  cucumber: 0.62,
  bubble: 0.54,
  wave: 1.5,
  slash: 2.8,
  rice: 0.42,
}

/** 单帧精灵：四朝向共用同一格 UV */
function singleFrameAnim(pc: PixelCanvas, worldW: number, worldH: number): SpriteAnim {
  const texture = textureFromPixels(pc)
  const frame = { offsetX: 0, offsetY: 0 }
  const frames = {
    down: [frame],
    up: [frame],
    left: [frame],
    right: [frame],
  } as SpriteAnim['frames']
  return { texture, frames, cols: 1, rows: 1, worldW, worldH }
}

function setAlpha(pc: PixelCanvas, x: number, y: number, alpha: number): void {
  x |= 0
  y |= 0
  if (x < 0 || y < 0 || x >= pc.width || y >= pc.height) return
  pc.data[(y * pc.width + x) * 4 + 3] = alpha
}

/** 小黄瓜：8×4 绿，带深色刺和亮尖 */
function cucumberPixels(): PixelCanvas {
  const pc = new PixelCanvas(8, 4)
  pc.fillRect(1, 1, 6, 2, 0x5fae3a)
  pc.hLine(2, 6, 1, 0x7fd24a)
  pc.hLine(1, 6, 2, 0x3f7d28)
  // 刺/花纹
  pc.set(2, 1, 0x2f5f1c)
  pc.set(4, 1, 0x2f5f1c)
  pc.set(5, 2, 0x2f5f1c)
  pc.set(2, 2, 0xd6ef7a)
  // 尾端瓜蒂 + 尖端
  pc.set(0, 1, 0x2f5f1c)
  pc.set(7, 2, 0xd9f57a)
  pc.set(7, 1, 0xeaffb0)
  return pc
}

/** 泡泡：10×10 半透明蓝，上方高光 */
function bubblePixels(): PixelCanvas {
  const pc = new PixelCanvas(10, 10)
  pc.ellipse(4.5, 4.5, 4.4, 4.4, 0x2f9fd8)
  for (let i = 3; i < pc.data.length; i += 4) if (pc.data[i] !== 0) pc.data[i] = 148
  pc.ellipse(4.5, 4.5, 3.2, 3.2, 0x66d8ff)
  for (let i = 3; i < pc.data.length; i += 4) if (pc.data[i] === 148) pc.data[i] = 104
  // 内部透一点，像水泡
  pc.ellipse(5.2, 5.2, 2.1, 2.1, 0x123a4a)
  for (let i = 3; i < pc.data.length; i += 4) {
    if (pc.data[i] === 148) pc.data[i] = 40
  }
  // 高光
  pc.set(3, 2, 0xffffff)
  setAlpha(pc, 3, 2, 245)
  pc.set(4, 2, 0xffffff)
  setAlpha(pc, 4, 2, 220)
  pc.set(2, 3, 0xffffff)
  setAlpha(pc, 2, 3, 200)
  return pc
}

/** 音波：24×24 紫色月牙，用于 Mortis 剑气 / 脉冲 */
function wavePixels(): PixelCanvas {
  const pc = new PixelCanvas(24, 24)
  const cx = 11.5
  const cy = 11.5
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      const ang = Math.atan2(dy, dx)
      if (Math.abs(ang) > 1.25) continue
      if (r < 7 || r > 11.4) continue
      const inner = r < 8.2
      pc.set(x, y, inner ? 0xf0dcff : r > 10.4 ? 0x7a4dff : 0xbf8dff)
    }
  }
  return pc
}

/** 丛雨挥刀弧光：32×32 青色宽月牙（110°） */
function slashPixels(): PixelCanvas {
  const pc = new PixelCanvas(32, 32)
  const cx = 15.5
  const cy = 15.5
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = x - cx
      const dy = y - cy
      const r = Math.hypot(dx, dy)
      const ang = Math.atan2(dy, dx)
      if (Math.abs(ang) > (110 * Math.PI) / 180 / 2) continue
      if (r < 9 || r > 15.6) continue
      const edge = 0.4 * (1 - Math.min(1, Math.abs(r - 12.3) / 3.2))
      pc.set(x, y, r > 14.2 ? 0x7ff6e0 : 0xe6fffb)
      setAlpha(pc, x, y, 90 + Math.round(150 * edge))
    }
  }
  return pc
}

/** 白米饭：7×7 白团 + 阴影 */
function ricePixels(): PixelCanvas {
  const pc = new PixelCanvas(7, 7)
  pc.ellipse(3, 3.4, 2.7, 2.2, 0xd8d2c0)
  pc.ellipse(3, 2.8, 2.7, 2.1, 0xf8f5e8)
  pc.set(2, 2, 0xffffff)
  pc.set(3, 2, 0xffffff)
  pc.set(2, 3, 0xeae4d2)
  pc.set(4, 3, 0xeae4d0)
  return pc
}

interface Art {
  anim: SpriteAnim
  /** true = 原画（共享纹理，不归本模块释放）；false = 本模块程序化生成 */
  art: boolean
}

const cache = new Map<ProjectileArtKind, Art>()

/** 原画单帧精灵；未加载/缺图返回 null */
function artAnim(kind: ProjectileArtKind): SpriteAnim | null {
  const key = ART_KEY[kind]
  if (!key || !artReady()) return null
  const tex = artTexture(key)
  if (!tex) return null
  const img = tex.image as { width?: number; height?: number } | undefined
  const w = img?.width ?? 0
  const h = img?.height ?? 0
  if (w <= 0 || h <= 0) return null
  const worldW = ART_WIDTH[kind]
  return singleFrameAnimFromArt(key, worldW, (worldW * h) / w)
}

/** 程序化像素图（原画缺失时的回退） */
function proceduralAnim(kind: ProjectileArtKind): SpriteAnim {
  switch (kind) {
    case 'cucumber':
      return singleFrameAnim(cucumberPixels(), 0.62, 0.32)
    case 'bubble':
      return singleFrameAnim(bubblePixels(), 0.5, 0.5)
    case 'wave':
      return singleFrameAnim(wavePixels(), 1.5, 1.5)
    case 'rice':
      return singleFrameAnim(ricePixels(), 0.42, 0.42)
    default:
      return singleFrameAnim(slashPixels(), 2.8, 2.8)
  }
}

function getArt(kind: ProjectileArtKind): Art {
  const cached = cache.get(kind)
  // 原画一旦加载完成就替换掉缓存里的回退版本；本就没有原画的种类直接复用
  if (cached && (cached.art || !ART_KEY[kind])) return cached
  const fromArt = artAnim(kind)
  if (fromArt) {
    const art: Art = { anim: fromArt, art: true }
    cache.set(kind, art)
    return art
  }
  if (cached) return cached
  const art: Art = { anim: proceduralAnim(kind), art: false }
  cache.set(kind, art)
  return art
}

/** 共享纹理（外部只读，不要在实体销毁时释放） */
export function projectileTexture(kind: ProjectileArtKind): THREE.CanvasTexture {
  return getArt(kind).anim.texture
}

/** 创建弹道 billboard：几何原点在中心（不是脚底），scale 为整体缩放 */
export function createProjectileMesh(
  kind: ProjectileArtKind,
  scale = 1,
  opts: { color?: number; additive?: boolean; opacity?: number } = {},
): THREE.Mesh {
  const { anim, art } = getArt(kind)
  const mesh = createSpriteMesh(anim)
  // 原画纹理 flipY=false：平面默认 UV 会上下颠倒，按图集约定把 v 轴翻过来
  if (art && anim.texture.flipY === false) setSpriteFrame(mesh, anim, 'down', 0)
  // createSpriteMesh 把原点放在脚底，弹道要绕中心旋转，挪回来
  mesh.geometry.translate(0, -anim.worldH / 2, 0)
  const mat = mesh.material as THREE.MeshBasicMaterial
  mat.alphaTest = 0.01
  if (opts.color !== undefined) mat.color.setHex(opts.color)
  if (opts.opacity !== undefined) mat.opacity = opts.opacity
  if (opts.additive) {
    mat.blending = THREE.AdditiveBlending
    mat.depthWrite = false
  }
  mesh.scale.setScalar(scale)
  mesh.renderOrder = 4
  return mesh
}

/** 整局结束释放共享纹理（Combat.dispose 调一次）；原画纹理由 atlasImport 管理，不在这里释放 */
export function disposeProjectileArt(): void {
  for (const art of cache.values()) if (!art.art) art.anim.texture.dispose()
  cache.clear()
}
