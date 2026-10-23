import * as THREE from 'three'
import type { BossKind, CharacterId, Facing } from '../types'
import { PixelCanvas, type AtlasData } from './pixels'
import {
  buildCharacterAtlas,
  buildEnemyBulletAtlas,
  buildGoblinAtlas,
  buildKingAtlas,
  type GoblinKind,
} from './characters'
import {
  sheetAnimFromArt,
  singleFrameAnimFromArt,
  variantAnimFromArt,
  type ArtKey,
} from './atlasImport'

/**
 * 像素精灵的 three.js 包装层。
 *
 * 图集只按「角色种类」生成一次并缓存（主角 1 张、哥布林 3 张、王 1 张），
 * 所有同类实体共享同一张 CanvasTexture；每个实体只克隆一个 4 顶点的 PlaneGeometry，
 * 用它自己的 UV 指向图集里的某一格，因此 140 只哥布林同屏也不会重复上传纹理。
 *
 * 图集布局（由 characters.ts 决定）：列 = 帧（idleA / idleB / run1-4 / attack1-3 / hurt），
 * 行 = 朝向（down / up / left / right）+ 第 5 行技能态。
 */
export interface SpriteAnim {
  texture: THREE.CanvasTexture
  /** frames[朝向][帧序号] 给出该帧在图集中的 UV 偏移（左上角） */
  frames: Record<Facing, { offsetX: number; offsetY: number }[]>
  cols: number
  rows: number
  /** 世界尺寸（米），1 倍体型 */
  worldW: number
  worldH: number
}

const ROW_OF: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 }

const spriteCache = new Map<string, SpriteAnim>()
const particleCache = new Map<string, THREE.CanvasTexture>()
let shadowTex: THREE.CanvasTexture | null = null

/** 当前相机 yaw：所有 billboard 精灵都绕 Y 轴转这个角度，正面朝相机 */
let billboardYaw = 0

export function setBillboardYaw(yaw: number): void {
  billboardYaw = yaw
}

export function getBillboardYaw(): number {
  return billboardYaw
}

/** 纯像素画布 → HTMLCanvasElement（浏览器环境） */
function pixelsToCanvas(pc: PixelCanvas): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = pc.width
  canvas.height = pc.height
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(pc.width, pc.height)
  img.data.set(pc.data)
  ctx.putImageData(img, 0, 0)
  return canvas
}

/** 把 PixelCanvas 直接转成最近邻采样的纹理（拾取物图标等也复用它） */
export function textureFromPixels(pc: PixelCanvas): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(pixelsToCanvas(pc))
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

function atlasToAnim(atlas: AtlasData): SpriteAnim {
  const canvas = pixelsToCanvas(atlas.canvas)
  const texture = new THREE.CanvasTexture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = THREE.SRGBColorSpace
  // 图集行从上到下就是 down/up/left/right，翻转后 UV 的 v 向下增长，直接按行算偏移
  texture.flipY = false
  texture.needsUpdate = true

  const frames = {} as SpriteAnim['frames']
  for (const facing of Object.keys(ROW_OF) as Facing[]) {
    const row = ROW_OF[facing]
    const list: { offsetX: number; offsetY: number }[] = []
    for (let col = 0; col < atlas.cols; col++) {
      list.push({ offsetX: col / atlas.cols, offsetY: row / atlas.rows })
    }
    frames[facing] = list
  }
  return {
    texture,
    frames,
    cols: atlas.cols,
    rows: atlas.rows,
    worldW: atlas.worldW,
    worldH: atlas.worldH,
  }
}

/**
 * 主角图集（按角色 id 缓存）：mutsumi / murasame / fish / mortis。
 * 优先用 assets/art_raw 的外部原画；缺图时回退 characters.ts 的程序化图集。
 * 原画格子 64×80（宽高比 0.8），世界尺寸按同一比例给 1.4×1.75 避免横向拉宽。
 */
export function playerSprite(id: CharacterId | 'mortis' = 'mutsumi'): SpriteAnim {
  const key = `player-${id}`
  let anim = spriteCache.get(key)
  if (!anim) {
    if (id === 'mortis') {
      // 原画里 Mortis 只有 char_mutsumi 的第 5 行（格 10×1），四个朝向都指这一行
      anim =
        sheetAnimFromArt('char_mutsumi', 10, 5, 1.4, 1.75, {
          down: 4,
          up: 4,
          left: 4,
          right: 4,
        }) ?? undefined
    } else {
      anim = sheetAnimFromArt(`char_${id}` as ArtKey, 10, 5, 1.4, 1.75) ?? undefined
    }
    if (!anim) anim = atlasToAnim(buildCharacterAtlas(id))
    spriteCache.set(key, anim)
  }
  return anim
}

/** 哥布林图集（small / brute / elite / caster / spear / bomber 各缓存一张）——原画包未提供，保持程序化 */
export function goblinSprite(kind: GoblinKind): SpriteAnim {
  const key = `goblin-${kind}`
  let anim = spriteCache.get(key)
  if (!anim) {
    anim = atlasToAnim(buildGoblinAtlas(kind))
    spriteCache.set(key, anim)
  }
  return anim
}

/** 哥布林之王图集：原版用 boss_king 原画；督军/巫王用同一原画的调色变体 */
export function kingSprite(kind: BossKind = 'king'): SpriteAnim {
  const key = `king-${kind}`
  let anim = spriteCache.get(key)
  if (!anim) {
    if (kind === 'warlord') {
      anim =
        variantAnimFromArt(
          'boss_king',
          'warlord',
          6,
          4,
          2.08,
          2.38,
          'sepia(0.35) saturate(0.72) contrast(1.16) brightness(0.78)',
          '#5a1a14',
          0.38,
        ) ?? atlasToAnim(buildKingAtlas('warlord'))
    } else if (kind === 'witch') {
      anim =
        variantAnimFromArt(
          'boss_king',
          'witch',
          6,
          4,
          1.86,
          2.16,
          'hue-rotate(150deg) saturate(0.88) contrast(1.1) brightness(0.8)',
          '#321a55',
          0.24,
        ) ?? atlasToAnim(buildKingAtlas('witch'))
    } else {
      anim = sheetAnimFromArt('boss_king', 6, 4, 1.9, 2.2) ?? atlasToAnim(buildKingAtlas('king'))
    }
    spriteCache.set(key, anim)
  }
  return anim
}

/** 敌方弹幕紫球：原画是单张 proj_orbfire */
export function enemyBulletSprite(): SpriteAnim {
  let anim = spriteCache.get('enemy-bullet')
  if (!anim) {
    anim = singleFrameAnimFromArt('proj_orbfire', 0.55, 0.55) ?? atlasToAnim(buildEnemyBulletAtlas())
    spriteCache.set('enemy-bullet', anim)
  }
  return anim
}

/** 释放某个图集纹理（只在整局结束时调用，不要按实体释放） */
export function disposeSprite(anim: SpriteAnim): void {
  for (const [key, value] of spriteCache) {
    if (value === anim) spriteCache.delete(key)
  }
  anim.texture.dispose()
}

/** 创建 billboard 精灵网格：脚底在 y=0，向前（+z）朝相机 */
export function createSpriteMesh(anim: SpriteAnim): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(anim.worldW, anim.worldH)
  // 把平面下移半个高度，让原点落在脚底，缩放/压扁时不会浮空
  geo.translate(0, anim.worldH / 2, 0)
  const mat = new THREE.MeshBasicMaterial({
    map: anim.texture,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 3
  return mesh
}

/**
 * 切换精灵帧：直接改写几何体的 UV（每个实体一份几何，互不干扰）。
 * frames 的 offset 是 UV 左上角，flipY=false 时 v 向下增长。
 */
export function setSpriteFrame(mesh: THREE.Mesh, anim: SpriteAnim, facing: Facing, frame: number): void {
  const list = anim.frames[facing] ?? anim.frames.down
  const count = list.length
  const f = list[((frame % count) + count) % count]
  const col = Math.round(f.offsetX * anim.cols)
  const row = Math.round(f.offsetY * anim.rows)
  const u0 = col / anim.cols
  const u1 = (col + 1) / anim.cols
  const vTop = row / anim.rows
  const vBottom = (row + 1) / anim.rows
  const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute
  // PlaneGeometry 顶点顺序：0/1 是上边，2/3 是下边
  uv.setXY(0, u0, vTop)
  uv.setXY(1, u1, vTop)
  uv.setXY(2, u0, vBottom)
  uv.setXY(3, u1, vBottom)
  uv.needsUpdate = true
  const mat = mesh.material as THREE.MeshBasicMaterial
  if (mat.map !== anim.texture) {
    mat.map = anim.texture
    mat.needsUpdate = true
  }
}

/** 脚下柔和椭圆阴影（共享纹理） */
export function shadowTexture(): THREE.CanvasTexture {
  if (shadowTex) return shadowTex
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.5)')
  g.addColorStop(0.55, 'rgba(0,0,0,0.3)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  shadowTex = tex
  return tex
}

let bombTex: THREE.CanvasTexture | null = null

/** v4.8 爆破手的炸弹：程序化 24×24 像素图，暗铁球 + 灼热铁箍 + 燃烧引线 */
export function bombTexture(): THREE.CanvasTexture {
  if (bombTex) return bombTex
  const size = 24
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  // 暗色余烬外圈：保证在暗色地砖上可读，但把主体留给铁球
  ctx.fillStyle = '#6e2a14'
  ctx.beginPath()
  ctx.arc(11, 14, 8, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ff8a3d'
  ctx.beginPath()
  ctx.arc(11, 14, 7, 0, Math.PI * 2)
  ctx.fill()
  // 暗铁球与高光
  ctx.fillStyle = '#120a10'
  ctx.beginPath()
  ctx.arc(11, 14, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#2b1d26'
  ctx.beginPath()
  ctx.arc(11, 14, 4.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#6b4d54'
  ctx.fillRect(8, 10, 2, 2)
  ctx.fillStyle = '#ffe6a0'
  ctx.fillRect(9, 9, 1, 1)
  // 铁箍只压在球体上
  ctx.fillStyle = '#c9a15c'
  ctx.fillRect(5, 13, 12, 1)
  ctx.fillRect(5, 16, 12, 1)
  // 引线 + 火花
  ctx.fillStyle = '#7a4b26'
  ctx.fillRect(16, 8, 2, 2)
  ctx.fillRect(17, 5, 2, 3)
  ctx.fillStyle = '#ff7a2f'
  ctx.fillRect(18, 3, 2, 2)
  ctx.fillRect(19, 1, 1, 2)
  ctx.fillStyle = '#ffe6a0'
  ctx.fillRect(19, 1, 1, 1)
  ctx.fillStyle = '#fff6c9'
  ctx.fillRect(20, 4, 1, 1)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  bombTex = tex
  return tex
}

/** 地面阴影网格（水平铺开，压在角色脚下） */
export function createShadowMesh(width: number, depth = width * 0.62): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(width, depth)
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.015
  mesh.renderOrder = 1
  return mesh
}

export type ParticleKind = 'spark' | 'ring' | 'glow' | 'shard'

/** 粒子 / 光圈 / 光晕纹理（柔边，用线性过滤） */
export function particleTexture(kind: ParticleKind): THREE.CanvasTexture {
  const cached = particleCache.get(kind)
  if (cached) return cached

  const size = kind === 'shard' ? 32 : 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const half = size / 2

  if (kind === 'spark') {
    const g = ctx.createRadialGradient(half, half, 0, half, half, half)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    // 十字星芒
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fillRect(half - 0.75, 6, 1.5, size - 12)
    ctx.fillRect(6, half - 0.75, size - 12, 1.5)
  } else if (kind === 'ring') {
    const g = ctx.createRadialGradient(half, half, half * 0.55, half, half, half)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.78, 'rgba(255,255,255,0.5)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(half, half, half, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'glow') {
    const g = ctx.createRadialGradient(half, half, 0, half, half, half)
    g.addColorStop(0, 'rgba(255,255,255,0.95)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.45)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  } else {
    // 菱形碎片
    const g = ctx.createRadialGradient(half, half, 0, half, half, half)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(half, 1)
    ctx.lineTo(size - 1, half)
    ctx.lineTo(half, size - 1)
    ctx.lineTo(1, half)
    ctx.closePath()
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  particleCache.set(kind, tex)
  return tex
}
