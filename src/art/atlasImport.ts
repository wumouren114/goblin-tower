import * as THREE from 'three'
import type { Facing } from '../types'
import type { SpriteAnim } from './sprites'

/**
 * 外部原画（豆包出图 → scripts/art-normalize.py 归一化）的加载与切图。
 *
 * 约定：
 *  - `assets/art_raw/*.png` 里每张图的文件名（去扩展名）就是 ArtKey；
 *  - 图集必须是严格等分网格（归一化脚本保证），切图只按 cols/rows 算 UV；
 *  - 所有 getter 在 `preloadArt()` 之后同步可用；**没加载/没这张图时返回 null**，
 *    调用方继续用 characters.ts 里的程序化像素图兜底，所以删掉 assets/art_raw 也能玩。
 */

export type ArtKey =
  | 'char_mutsumi'
  | 'char_murasame'
  | 'char_fish'
  | 'boss_king'
  | 'keyart_title'
  | 'prop_crate'
  | 'prop_barrel'
  | 'prop_pillar'
  | 'prop_crystal'
  | 'pickup_coin'
  | 'pickup_heart'
  | 'pickup_rice'
  | 'pickup_card'
  | 'proj_cucumber'
  | 'proj_bubble'
  | 'proj_wave'
  | 'proj_slash'
  | 'proj_orbfire'
  | 'fx_ring'
  | 'fx_glow'
  | 'portrait_mutsumi'
  | 'portrait_mortis'
  | 'portrait_murasame'
  | 'portrait_fish'
  | 'portrait_boss'
  | 'icon_weapon_mutsumi'
  | 'icon_weapon_murasame'
  | 'icon_weapon_fish'
  | 'icon_card_magic'
  | 'icon_card_stamina'
  | 'icon_card_intelligence'
  | 'icon_card_hp'
  | 'icon_card_moveSpeed'
  | 'icon_card_charge'
  | 'icon_card_armor'
  | 'icon_card_dodge'
  | 'icon_card_crit'
  | 'style_mutsumi_solo'
  | 'style_mutsumi_duet'
  | 'style_mutsumi_requiem'
  | 'style_murasame_iai'
  | 'style_murasame_blood'
  | 'style_murasame_guard'
  | 'style_fish_school'
  | 'style_fish_burst'
  | 'style_fish_whale'

const ROW_OF: Record<Facing, number> = { down: 0, up: 1, left: 2, right: 3 }

/**
 * Vite 会把 assets/art_raw 下的 PNG 变成可访问的 URL（dev 直接给路径，build 带 hash）。
 * 用函数包一层 + try/catch：Node 里跑 sim/*.mjs 时没有 import.meta.glob，
 * 直接返回空表（全部走程序化回退），不会把无头自检搞崩。
 */
function collectUrls(): Record<string, string> {
  try {
    return {
      ...(import.meta.glob('/assets/art_raw/*.png', {
        eager: true,
        query: '?url',
        import: 'default',
      }) as Record<string, string>),
      // v4.6：画图 AI 风格图标单独放 v46/icons，避免和旧图集混在一起
      ...(import.meta.glob('/assets/art_raw/v46/icons/*.png', {
        eager: true,
        query: '?url',
        import: 'default',
      }) as Record<string, string>),
    }
  } catch {
    return {}
  }
}

const modules = collectUrls()

const urls = new Map<string, string>()
for (const [file, url] of Object.entries(modules)) {
  const name = file.split('/').pop()?.replace(/\.png$/i, '')
  if (name) urls.set(name, url)
}

const images = new Map<string, HTMLImageElement>()
const textures = new Map<string, THREE.CanvasTexture>()
const variantTextures = new Map<string, THREE.CanvasTexture>()
let loaded = false

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`decode failed: ${url}`))
    img.src = url
  })
}

/**
 * 预加载全部原画；`main.ts` 在 new Game 之前 await 一次。
 * 单张失败只跳过那一张（缺图回退程序化），整体不抛错。
 */
export async function preloadArt(): Promise<void> {
  const jobs: Promise<void>[] = []
  for (const [name, url] of urls) {
    jobs.push(
      loadImage(url)
        .then((img) => {
          images.set(name, img)
        })
        .catch(() => {
          /* 单张失败：保持缺失，走程序化回退 */
        }),
    )
  }
  await Promise.all(jobs)
  loaded = images.size > 0
}

export function artReady(): boolean {
  return loaded
}

/** 已加载的 PNG 的 URL（给 DOM / CSS 用），未加载返回 null */
export function artUrl(key: ArtKey): string | null {
  if (!images.has(key)) return null
  return urls.get(key) ?? null
}

/** 共享纹理：最近邻采样、sRGB、flipY=false（和程序化图集同一套 UV 约定） */
export function artTexture(key: ArtKey): THREE.CanvasTexture | null {
  const cached = textures.get(key)
  if (cached) return cached
  const img = images.get(key)
  if (!img) return null
  // THREE.CanvasTexture 只接受 canvas：把解码好的 PNG 画进离屏 canvas（同时统一成 RGBA）
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false
  tex.needsUpdate = true
  textures.set(key, tex)
  return tex
}

/**
 * Boss 变体纹理：不新增外部原画，直接把同一张 boss_king 图集做色相/饱和/叠色处理。
 * 结果按 `key#variant` 缓存，和原图共享 UV 布局。
 */
export function variantArtTexture(
  key: ArtKey,
  variant: string,
  filter: string,
  overlay?: string,
  overlayAlpha = 0.2,
): THREE.CanvasTexture | null {
  const cacheKey = `${key}#${variant}`
  const cached = variantTextures.get(cacheKey)
  if (cached) return cached
  const img = images.get(key)
  if (!img) return null
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  try {
    ctx.filter = filter
  } catch {
    /* 老浏览器不支持 filter 时仍能画出原图 */
  }
  ctx.drawImage(img, 0, 0)
  if (overlay) {
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'source-atop'
    ctx.globalAlpha = overlayAlpha
    ctx.fillStyle = overlay
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.colorSpace = THREE.SRGBColorSpace
  tex.flipY = false
  tex.needsUpdate = true
  variantTextures.set(cacheKey, tex)
  return tex
}

/**
 * 把一张等分图集接成 SpriteAnim。
 * @param cols 图集列数（= 每个朝向的帧数）
 * @param rows 图集行数
 * @param rowOfFacing 可覆盖「朝向 → 行号」，比如 Mortis 只有一行立绘（第 5 行）时全指向该行
 */
export function sheetAnimFromArt(
  key: ArtKey,
  cols: number,
  rows: number,
  worldW: number,
  worldH: number,
  rowOfFacing: Partial<Record<Facing, number>> = {},
): SpriteAnim | null {
  const texture = artTexture(key)
  if (!texture) return null
  return animFromTexture(texture, cols, rows, worldW, worldH, rowOfFacing)
}

/** 用同一套 UV 规则把已有的图集纹理包成 SpriteAnim */
function animFromTexture(
  texture: THREE.CanvasTexture,
  cols: number,
  rows: number,
  worldW: number,
  worldH: number,
  rowOfFacing: Partial<Record<Facing, number>> = {},
): SpriteAnim {
  const frames = {} as SpriteAnim['frames']
  for (const facing of Object.keys(ROW_OF) as Facing[]) {
    const row = rowOfFacing[facing] ?? ROW_OF[facing]
    const list: { offsetX: number; offsetY: number }[] = []
    for (let col = 0; col < cols; col++) {
      list.push({ offsetX: col / cols, offsetY: row / rows })
    }
    frames[facing] = list
  }
  return { texture, frames, cols, rows, worldW, worldH }
}

/** 变体 Boss 图集：原画调色版优先，缺图时回退到程序化配色图集 */
export function variantAnimFromArt(
  key: ArtKey,
  variant: string,
  cols: number,
  rows: number,
  worldW: number,
  worldH: number,
  filter: string,
  overlay?: string,
  overlayAlpha = 0.2,
): SpriteAnim | null {
  const texture = variantArtTexture(key, variant, filter, overlay, overlayAlpha)
  if (!texture) return null
  return animFromTexture(texture, cols, rows, worldW, worldH)
}

/** 单张原画（道具/弹道/粒子）当一帧精灵用 */
export function singleFrameAnimFromArt(key: ArtKey, worldW: number, worldH: number): SpriteAnim | null {
  return sheetAnimFromArt(key, 1, 1, worldW, worldH)
}

export function disposeArt(): void {
  for (const tex of textures.values()) tex.dispose()
  textures.clear()
  for (const tex of variantTextures.values()) tex.dispose()
  variantTextures.clear()
  images.clear()
  loaded = false
}
