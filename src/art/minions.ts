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
 * 本体分身（clone）：24×16 更圆更胖 + 更大背鳍 + 2px 加粗金色描边。
 */
function clonePixels(): PixelCanvas {
  const pc = new PixelCanvas(24, 16)

  // 外层 2px 金色描边：先铺最外圈暖金，再叠内圈亮金
  pc.ellipse(13.2, 9.0, 8.6, 6.4, 0xe89b1c)
  pc.triangle(0.8, 4.0, 6.6, 9.0, 0.8, 14.0, 0xe89b1c)
  pc.triangle(8.4, 4.4, 13.4, 0.2, 16.8, 4.6, 0xe89b1c)

  pc.ellipse(13.2, 9.0, 7.8, 5.6, 0xffe066)
  pc.triangle(1.8, 4.9, 6.4, 9.0, 1.8, 13.1, 0xffe066)
  pc.triangle(9.3, 4.4, 13.4, 1.1, 15.9, 4.6, 0xffe066)

  // 更亮更圆胖的青蓝鲸体
  pc.ellipse(13.2, 9.0, 6.8, 4.7, 0x3ea8ff)
  pc.ellipse(13.2, 8.1, 6.2, 3.8, 0x86e4ff)
  // 饱满肚皮
  pc.ellipse(13.6, 10.6, 4.8, 2.2, 0xf2fcff)

  // 尾巴内芯
  pc.triangle(3.0, 6.0, 6.4, 9.0, 3.0, 12.0, 0x3ea8ff)
  pc.triangle(3.6, 6.7, 6.1, 9.0, 3.6, 11.3, 0x86e4ff)

  // 醒目大背鳍内芯 + 金冠尖点
  pc.triangle(10.3, 4.7, 13.3, 2.1, 15.0, 4.8, 0x2679d6)
  pc.triangle(11.1, 4.7, 13.2, 2.8, 14.4, 4.8, 0x5cc4ff)
  pc.set(13, 1, 0xfff7b8)
  pc.set(14, 1, 0xffe066)

  // 大眼睛与高光
  pc.set(17, 7, 0x0b2540)
  pc.set(17, 8, 0x0b2540)
  pc.set(18, 7, 0x0b2540)
  pc.set(18, 8, 0x0b2540)
  pc.set(18, 7, 0xffffff)

  // 背部高光与金色鳃纹
  pc.set(10, 6, 0xe0faff)
  pc.set(11, 6, 0xe0faff)
  pc.set(9, 7, 0xe0faff)
  pc.set(15, 9, 0xffd24c)
  pc.set(15, 10, 0xffd24c)
  pc.set(16, 9, 0x2679d6)
  return pc
}

/**
 * 环绕体（orbit）：24×16 更细长的偏紫撞击体 + 拉长的尾部拖尾光点。
 */
function orbitPixels(): PixelCanvas {
  const pc = new PixelCanvas(24, 16)

  // 拉长的尾部拖尾光点（从左端星点逐渐向尾部聚拢增亮）
  pc.set(1, 8, 0x5c2db8)
  pc.set(3, 7, 0x7c45e0)
  pc.set(3, 9, 0x6f39cf)
  pc.set(5, 8, 0xa266ff)
  pc.set(6, 7, 0x8b4ef0)
  pc.set(7, 9, 0xbc82ff)
  pc.set(8, 8, 0xdfa8ff)
  pc.set(9, 7, 0xc98cff)
  pc.set(9, 9, 0xc98cff)
  pc.set(10, 8, 0xffd6ff)

  // 细长流线型偏紫鱼体（靠右侧绘制，突出撞击感）
  pc.ellipse(17.4, 8.0, 5.2, 2.7, 0x6734cc)
  pc.ellipse(17.5, 7.6, 4.6, 2.0, 0xa86eff)
  // 细浅紫肚皮
  pc.ellipse(17.9, 8.9, 3.3, 1.0, 0xf2deff)

  // 细长燕尾
  pc.triangle(10.6, 5.6, 13.4, 8.0, 10.6, 10.4, 0x6734cc)
  pc.triangle(11.3, 6.4, 13.2, 8.0, 11.3, 9.6, 0xc994ff)

  // 掠后细背鳍
  pc.triangle(15.2, 5.7, 17.6, 3.8, 18.8, 5.8, 0x4b1fa3)
  pc.set(17, 4, 0xd8a8ff)

  // 锐利亮眼与紫粉能量核
  pc.set(20, 7, 0x220842)
  pc.set(21, 7, 0xffe8ff)
  pc.set(16, 7, 0xf2ccff)
  pc.set(18, 8, 0xff9cf4)
  return pc
}

/** 供离线预览脚本（scripts/preview-minions.mjs）直接读取像素画布 */
export function minionVariantPixels(kind: MinionVariant): PixelCanvas {
  if (kind === 'clone') return clonePixels()
  if (kind === 'orbit') return orbitPixels()
  return minionPixels()
}

let cached: SpriteAnim | null = null
const variantCache: Partial<Record<Exclude<MinionVariant, 'small'>, SpriteAnim>> = {}

const ringGeoCache: Partial<Record<MinionVariant, THREE.RingGeometry>> = {}
const ringMatCache: Partial<Record<Exclude<MinionVariant, 'clone'>, THREE.MeshBasicMaterial>> = {}

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
  cached = makeSingleFrameAnim(minionPixels(), 1.15, 0.82)
  return cached
}

function variantAnim(kind: MinionVariant): SpriteAnim {
  if (kind === 'small') return minionAnim()
  const hit = variantCache[kind]
  if (hit) return hit
  const anim =
    kind === 'clone'
      ? makeSingleFrameAnim(clonePixels(), 1.18, 0.79)
      : makeSingleFrameAnim(orbitPixels(), 1.28, 0.85)
  variantCache[kind] = anim
  return anim
}

/**
 * 为召唤物脚下挂载半透明贴地光环（depthWrite=false，不遮挡角色）：
 * - clone：金色细环 + 缓慢呼吸
 * - orbit：紫色细环
 * - small：青蓝色细环（透明度最低，避免群聚时糊成一片）
 */
function attachGroundRing(parent: THREE.Mesh, kind: MinionVariant): void {
  let geo = ringGeoCache[kind]
  if (!geo) {
    const [innerR, outerR] =
      kind === 'clone' ? [0.48, 0.56] : kind === 'orbit' ? [0.4, 0.48] : [0.38, 0.45]
    geo = new THREE.RingGeometry(innerR, outerR, 28)
    ringGeoCache[kind] = geo
  }

  let mat: THREE.MeshBasicMaterial
  if (kind === 'clone') {
    // clone 独立材质以支持各自平滑呼吸而不干扰其它环
    mat = new THREE.MeshBasicMaterial({
      color: 0xffd24c,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  } else {
    let shared = ringMatCache[kind]
    if (!shared) {
      shared = new THREE.MeshBasicMaterial({
        color: kind === 'orbit' ? 0xb27bff : 0x58b6ff,
        transparent: true,
        opacity: kind === 'orbit' ? 0.52 : 0.24,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      ringMatCache[kind] = shared
    }
    mat = shared
  }

  const ring = new THREE.Mesh(geo, mat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.renderOrder = 1

  if (kind === 'clone') {
    ring.onBeforeRender = () => {
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.0022
      const pulse = 0.5 + 0.5 * Math.sin(t)
      mat.opacity = 0.42 + pulse * 0.34
      const s = 0.96 + pulse * 0.08
      ring.scale.set(s, s, 1)
    }
  }

  parent.add(ring)
}

/** 创建小肥鱼 billboard（原点在脚底，和角色精灵一致） */
export function createMinionMesh(scale = 1): THREE.Mesh {
  const mesh = createSpriteMesh(minionAnim())
  ;(mesh.material as THREE.MeshBasicMaterial).depthWrite = false
  mesh.scale.setScalar(scale)
  mesh.renderOrder = 3
  return mesh
}

/**
 * 创建指定变体的召唤物 billboard（含脚下贴地光环与 depthWrite=false）：
 * - small：1.15 × 0.82 世界单位（青蓝小鲸子 + 低透明青蓝细环）
 * - clone：2.01 × 1.34 世界单位（1.7×，亮青蓝胖鲸 + 2px 金描边 + 金色呼吸细环）
 * - orbit：1.00 × 0.66 世界单位（0.78×，细长紫体 + 拉长拖尾光点 + 紫色细环）
 */
export function createMinionMeshVariant(kind: MinionVariant, scale = 1): THREE.Mesh {
  const mesh = createSpriteMesh(variantAnim(kind))
  ;(mesh.material as THREE.MeshBasicMaterial).depthWrite = false
  const sizeMul = kind === 'clone' ? 1.7 : kind === 'orbit' ? 0.78 : 1
  mesh.scale.setScalar(scale * sizeMul)
  mesh.renderOrder = kind === 'clone' ? 4 : 3
  attachGroundRing(mesh, kind)
  return mesh
}

export function disposeMinionArt(): void {
  if (cached) cached.texture.dispose()
  cached = null
  for (const key of Object.keys(variantCache) as Exclude<MinionVariant, 'small'>[]) {
    variantCache[key]?.texture.dispose()
    delete variantCache[key]
  }
  for (const key of Object.keys(ringGeoCache) as MinionVariant[]) {
    ringGeoCache[key]?.dispose()
    delete ringGeoCache[key]
  }
  for (const key of Object.keys(ringMatCache) as Exclude<MinionVariant, 'clone'>[]) {
    ringMatCache[key]?.dispose()
    delete ringMatCache[key]
  }
}
