import * as THREE from 'three'
import { PixelCanvas } from './pixels'
import { createSpriteMesh, textureFromPixels, type SpriteAnim } from './sprites'

export type MinionVariant = 'small' | 'clone' | 'orbit'

/**
 * 小肥鱼（召唤物）程序化像素贴图：14×10 蓝色小鱼，最近邻采样。
 */
function minionPixels(): PixelCanvas {
  const pc = new PixelCanvas(14, 10)
  // 身体
  pc.ellipse(6.4, 5, 4.6, 3.1, 0x2f7fd0)
  pc.ellipse(6.4, 4.4, 4.2, 2.4, 0x58b6ff)
  // 肚皮
  pc.ellipse(6.6, 6.2, 3.2, 1.6, 0xd8f2ff)
  // 尾巴
  pc.triangle(1.2, 2.6, 3.4, 5, 1.2, 7.4, 0x2f7fd0)
  pc.triangle(1.6, 3.2, 3.2, 5, 1.6, 6.8, 0x58b6ff)
  // 背鳍
  pc.triangle(5.2, 2.2, 7.2, 0.8, 8.6, 2.4, 0x1f5fa8)
  // 眼睛
  pc.set(9, 3, 0x0b2540)
  pc.set(9, 4, 0x0b2540)
  pc.set(10, 3, 0xffffff)
  // 高光/鳃
  pc.set(5, 3, 0x9fdcff)
  pc.set(4, 4, 0x9fdcff)
  pc.set(8, 5, 0x1f5fa8)
  return pc
}

/**
 * 本体分身（clone）：18×14 亮青蓝鲸体 + 完整金色描边与背冠高光。
 */
function clonePixels(): PixelCanvas {
  const pc = new PixelCanvas(18, 14)
  // 外层金色描边轮廓（本体分身辨识圈）
  pc.ellipse(8.8, 7.2, 6.1, 4.4, 0xffc83d)
  pc.triangle(1.0, 3.4, 4.6, 7.2, 1.0, 11.0, 0xffc83d)
  pc.triangle(6.6, 3.2, 9.6, 0.7, 11.6, 3.4, 0xffe47a)

  // 更亮的主体青蓝层
  pc.ellipse(8.8, 7.2, 5.1, 3.4, 0x3ea4f5)
  pc.ellipse(8.8, 6.5, 4.7, 2.7, 0x7ee0ff)
  // 透亮肚皮
  pc.ellipse(9.1, 8.4, 3.6, 1.7, 0xf0fbff)
  // 尾巴内芯
  pc.triangle(2.0, 4.4, 4.4, 7.2, 2.0, 10.0, 0x3ea4f5)
  pc.triangle(2.5, 5.1, 4.2, 7.2, 2.5, 9.3, 0x7ee0ff)
  // 背鳍内芯 + 金冠尖点
  pc.triangle(7.4, 3.4, 9.4, 1.8, 10.8, 3.6, 0x2b7fd4)
  pc.set(9, 1, 0xfff3a8)
  pc.set(10, 1, 0xffd24c)

  // 眼睛与亮瞳
  pc.set(12, 5, 0x0b2540)
  pc.set(12, 6, 0x0b2540)
  pc.set(13, 5, 0xffffff)
  // 背部高光与金色鳃纹
  pc.set(7, 5, 0xd4f7ff)
  pc.set(6, 6, 0xd4f7ff)
  pc.set(10, 7, 0xffd24c)
  pc.set(11, 7, 0x2b7fd4)
  return pc
}

/**
 * 环绕体（orbit）：18×10 偏紫小巧撞击体，尾部带渐隐拖尾光点。
 */
function orbitPixels(): PixelCanvas {
  const pc = new PixelCanvas(18, 10)
  // 拖尾光点（从左到右逐渐聚拢变亮）
  pc.set(1, 5, 0x8f5bff)
  pc.set(3, 4, 0xc388ff)
  pc.set(3, 6, 0xa86eff)
  pc.set(5, 5, 0xf2c6ff)
  pc.set(6, 4, 0xd89eff)
  pc.set(6, 6, 0xd89eff)

  // 小巧偏紫鱼体（靠右侧绘制，留出拖尾空间）
  pc.ellipse(11.6, 5.0, 4.2, 2.9, 0x6f3fd6)
  pc.ellipse(11.6, 4.4, 3.6, 2.2, 0xa770ff)
  // 浅紫肚皮
  pc.ellipse(11.9, 6.0, 2.6, 1.3, 0xf0dcff)
  // 尖尾鳍
  pc.triangle(6.6, 3.0, 8.6, 5.0, 6.6, 7.0, 0x6f3fd6)
  pc.triangle(7.2, 3.6, 8.5, 5.0, 7.2, 6.4, 0xc592ff)
  // 背鳍
  pc.triangle(10.6, 2.3, 12.2, 1.0, 13.4, 2.5, 0x5228ad)
  // 亮眼与紫光核
  pc.set(14, 4, 0x240b48)
  pc.set(14, 5, 0x240b48)
  pc.set(15, 4, 0xffe6ff)
  pc.set(10, 4, 0xe8c4ff)
  pc.set(12, 5, 0xffa6f6)
  return pc
}

let cached: SpriteAnim | null = null
const variantCache: Partial<Record<Exclude<MinionVariant, 'small'>, SpriteAnim>> = {}

function makeSingleFrameAnim(pc: PixelCanvas, worldW: number, worldH: number): SpriteAnim {
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

function minionAnim(): SpriteAnim {
  if (cached) return cached
  cached = makeSingleFrameAnim(minionPixels(), 0.78, 0.56)
  return cached
}

function variantAnim(kind: MinionVariant): SpriteAnim {
  if (kind === 'small') return minionAnim()
  const hit = variantCache[kind]
  if (hit) return hit
  const anim =
    kind === 'clone'
      ? makeSingleFrameAnim(clonePixels(), 0.84, 0.65)
      : makeSingleFrameAnim(orbitPixels(), 0.82, 0.46)
  variantCache[kind] = anim
  return anim
}

/** 创建小肥鱼 billboard（原点在脚底，和角色精灵一致） */
export function createMinionMesh(scale = 1): THREE.Mesh {
  const mesh = createSpriteMesh(minionAnim())
  mesh.scale.setScalar(scale)
  mesh.renderOrder = 3
  return mesh
}

/**
 * 创建指定变体的召唤物 billboard：
 * - small：现有青蓝小鲸子
 * - clone：1.7 倍大、亮青蓝 + 金色描边（本体分身）
 * - orbit：更小、偏紫 + 尾部拖尾光点（环绕撞击体）
 */
export function createMinionMeshVariant(kind: MinionVariant, scale = 1): THREE.Mesh {
  const mesh = createSpriteMesh(variantAnim(kind))
  const sizeMul = kind === 'clone' ? 1.7 : kind === 'orbit' ? 0.78 : 1
  mesh.scale.setScalar(scale * sizeMul)
  mesh.renderOrder = kind === 'clone' ? 4 : 3
  return mesh
}

export function disposeMinionArt(): void {
  if (cached) cached.texture.dispose()
  cached = null
  for (const key of Object.keys(variantCache) as Exclude<MinionVariant, 'small'>[]) {
    variantCache[key]?.texture.dispose()
    delete variantCache[key]
  }
}
