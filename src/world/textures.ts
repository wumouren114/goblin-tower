import * as THREE from 'three'
import type { AirParticleKind, FloorTilePattern, LightPatchKind, ThemeLike, ThemeV3 } from './themes'
import { familyOf } from './themes'
import { Rng } from '../core/rng'

/**
 * ============================================================
 *  程序化像素纹理（全部 Canvas2D 生成，禁止外部素材）
 *  - 地砖 / 墙砖：64×64 逻辑像素平铺，NearestFilter
 *  - 符文圈 / 石门 / 火焰 / 光柱 / 光点：柔和过滤，additive 用
 *  每层 build() 生成一份，dispose() 全部释放。
 * ============================================================
 */

/** 离屏画布 */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 Canvas2D 上下文')
  return { canvas, ctx }
}

/** 0xRRGGBB → CSS 颜色 */
function hexCss(hex: number, alpha = 1): string {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`
}

/** 两色线性混合 */
function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  return (((ar + (br - ar) * k) | 0) << 16) | (((ag + (bg - ag) * k) | 0) << 8) | ((ab + (bb - ab) * k) | 0)
}

/** 提亮（f>0）/ 压暗（f<0） */
function toneHex(hex: number, f: number): number {
  return f >= 0 ? mixHex(hex, 0xffffff, f) : mixHex(hex, 0x000000, -f)
}

/** 程序化像素画布缓存（按 key 复用，避免重复绘制与每帧生成；CanvasTexture 实例仍由调用方独立 dispose） */
const PIXEL_CANVAS_CACHE = new Map<string, HTMLCanvasElement>()

function cachedPixelCanvas(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  const hit = PIXEL_CANVAS_CACHE.get(key)
  if (hit) return hit
  const { canvas, ctx } = makeCanvas(w, h)
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  PIXEL_CANVAS_CACHE.set(key, canvas)
  return canvas
}

/** 收尾成纹理：像素风严格最近邻 NearestFilter + 关闭 mipmap 模糊 */
function finalize(
  canvas: HTMLCanvasElement,
  opts: { nearest?: boolean; repeat?: boolean; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  if (opts.nearest) {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.generateMipmaps = true
  }
  const wrap = opts.repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping
  tex.wrapS = wrap
  tex.wrapT = wrap
  tex.anisotropy = 4
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/* ------------------------------------------------------------------ */
/*  地砖                                                               */
/* ------------------------------------------------------------------ */

/** 在指定区域内画一道像素裂纹 */
function drawCrack(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, color: string, rng: Rng): void {
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  let px = x
  let py = y
  ctx.moveTo(px, py)
  const steps = Math.max(2, Math.floor(len / 6))
  let dir = rng.chance(0.5) ? 1 : -1
  for (let i = 0; i < steps; i++) {
    px += rng.range(2, 6) * dir
    py += rng.range(1, 5)
    ctx.lineTo(px, py)
    if (rng.chance(0.28)) dir *= -1
  }
  ctx.stroke()
}

/** 主题地面细节（苔藓/烛蜡/熔岩缝/冰霜/紫纹） */
function floorDetail(ctx: CanvasRenderingContext2D, theme: ThemeLike, rng: Rng): void {
  switch (familyOf(theme)) {
    case 'moss': {
      // 苔藓：沿缝隙生长的绿色斑块
      const moss = mixHex(theme.accentColor, 0x2f4a2c, 0.55)
      for (let i = 0; i < 26; i++) {
        const x = rng.int(0, 63)
        const y = rng.int(0, 63)
        ctx.fillStyle = hexCss(moss, rng.range(0.45, 0.9))
        const w = rng.int(1, 3)
        const h = rng.int(1, 2)
        ctx.fillRect(x, y, w, h)
      }
      // 少量高光孢子
      ctx.fillStyle = hexCss(toneHex(moss, 0.45), 0.7)
      for (let i = 0; i < 6; i++) ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
      break
    }
    case 'candle': {
      // 烛蜡：地面滴落的浅色蜡痕
      const wax = mixHex(theme.accentColor, 0xf2e6c8, 0.65)
      for (let i = 0; i < 9; i++) {
        const x = rng.int(3, 60)
        const y = rng.int(3, 60)
        const r = rng.range(1.5, 4)
        ctx.fillStyle = hexCss(wax, rng.range(0.25, 0.55))
        ctx.beginPath()
        ctx.ellipse(x, y, r, r * rng.range(0.6, 1.1), rng.range(0, 3.14), 0, Math.PI * 2)
        ctx.fill()
      }
      // 零星烛芯灰
      ctx.fillStyle = hexCss(0x241a12, 0.5)
      for (let i = 0; i < 10; i++) ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
      break
    }
    case 'forge': {
      // 冷却熔渣：先用暗色不规则斑块压住石面，让亮橙裂缝不再铺满整块地砖
      for (let i = 0; i < 5; i++) {
        const x = rng.int(1, 56)
        const y = rng.int(1, 58)
        const w = rng.int(3, 9)
        const h = rng.int(2, 6)
        ctx.fillStyle = hexCss(0x1b110d, rng.range(0.3, 0.55))
        ctx.fillRect(x, y, w, h)
        ctx.fillStyle = hexCss(0x3a2620, rng.range(0.35, 0.6))
        ctx.fillRect(x + 1, y, Math.max(1, w - 2), 1)
      }
      // 主熔岩缝：每张 64×64 地砖最多 1 道，压低亮度和光晕半径
      const lava = mixHex(theme.accentColor, 0xffc070, 0.28)
      if (rng.chance(0.72)) {
        ctx.save()
        ctx.shadowColor = hexCss(lava, 0.55)
        ctx.shadowBlur = 2
        drawCrack(
          ctx,
          rng.int(2, 42),
          rng.int(2, 22),
          rng.range(14, 24),
          hexCss(lava, rng.range(0.45, 0.64)),
          rng,
        )
        ctx.restore()
      }
      // 冷却后的暗红细裂纹：提供石面信息量，但不和熔岩抢视线
      for (let i = 0; i < 2; i++) {
        drawCrack(
          ctx,
          rng.int(2, 48),
          rng.int(2, 44),
          rng.range(8, 16),
          hexCss(0x2a1913, rng.range(0.55, 0.8)),
          rng,
        )
      }
      // 余烬点：少而小，只做点缀
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = hexCss(mixHex(0x24140d, lava, rng.range(0.3, 0.75)), rng.range(0.5, 0.85))
        ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
      }
      break
    }
    case 'frost': {
      // 冰霜：白蓝霜纹 + 结晶点
      const ice = mixHex(theme.accentColor, 0xffffff, 0.55)
      for (let i = 0; i < 7; i++) {
        const x = rng.int(2, 60)
        const y = rng.int(2, 60)
        ctx.strokeStyle = hexCss(ice, rng.range(0.25, 0.5))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + rng.range(-7, 7), y + rng.range(-6, 6))
        ctx.stroke()
      }
      for (let i = 0; i < 18; i++) {
        ctx.fillStyle = hexCss(ice, rng.range(0.35, 0.8))
        ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
      }
      break
    }
    case 'throne': {
      // 紫纹 + 金粒
      const vein = mixHex(theme.accentColor, 0x8a4ad0, 0.45)
      for (let i = 0; i < 5; i++) {
        ctx.strokeStyle = hexCss(vein, rng.range(0.25, 0.5))
        drawCrack(ctx, rng.int(2, 50), rng.int(2, 20), rng.range(14, 30), hexCss(vein), rng)
      }
      ctx.fillStyle = hexCss(mixHex(theme.accentColor, 0xfff0b0, 0.5), 0.85)
      for (let i = 0; i < 10; i++) ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
      break
    }
    default:
      break
  }
}

function drawTileBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: number,
  rng: Rng,
): void {
  if (w <= 2 || h <= 2) return
  ctx.fillStyle = hexCss(base)
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = hexCss(toneHex(base, 0.18))
  ctx.fillRect(x, y, w - 1, 1)
  ctx.fillRect(x, y, 1, h - 1)
  ctx.fillStyle = hexCss(toneHex(base, -0.3))
  ctx.fillRect(x, y + h - 1, w, 1)
  ctx.fillRect(x + w - 1, y, 1, h)
  const grain = Math.max(4, Math.floor((w * h) / 48))
  for (let i = 0; i < grain; i++) {
    const v = rng.chance(0.5) ? 0.12 : -0.14
    ctx.fillStyle = hexCss(toneHex(base, v), rng.range(0.45, 0.9))
    ctx.fillRect(x + rng.int(1, Math.max(1, w - 2)), y + rng.int(1, Math.max(1, h - 2)), rng.int(1, 2), 1)
  }
}

/** 2×2 离散色阶抖动填充（纯像素点阵，禁止任何渐变） */
function ditherRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  colA: number,
  colB: number,
  density = 0.25,
): void {
  ctx.fillStyle = hexCss(colA)
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = hexCss(colB)
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const pat = ((px & 1) << 1) | (py & 1)
      if ((density >= 0.5 && (px + py) % 2 === 0) || (density < 0.5 && pat === 0)) {
        ctx.fillRect(px, py, 1, 1)
      }
    }
  }
}

/** 绘制带 1px 深色描边、1px 左上高光、内部离散色阶抖动的像素方块 */
function drawPixelTileBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  base: number,
  outline: number,
  rng: Rng,
): void {
  if (w < 4 || h < 4) return
  const light = toneHex(base, 0.22)
  const shade = toneHex(base, -0.14)
  const dark = toneHex(base, -0.28)
  // 1px 外描边
  ctx.fillStyle = hexCss(outline)
  ctx.fillRect(x, y, w, h)
  // 内部离散色阶抖动
  ditherRect(ctx, x + 1, y + 1, w - 2, h - 2, base, shade, 0.25)
  // 1px 左上高光棱线
  ctx.fillStyle = hexCss(light)
  ctx.fillRect(x + 1, y + 1, w - 3, 1)
  ctx.fillRect(x + 1, y + 1, 1, h - 3)
  // 1px 右下暗棱
  ctx.fillStyle = hexCss(dark)
  ctx.fillRect(x + 2, y + h - 2, w - 3, 1)
  ctx.fillRect(x + w - 2, y + 2, 1, h - 3)
  // 少量离散像素噪点
  const specks = Math.max(2, Math.floor((w * h) / 42))
  for (let i = 0; i < specks; i += 1) {
    ctx.fillStyle = hexCss(rng.chance(0.5) ? light : dark)
    ctx.fillRect(x + rng.int(2, Math.max(2, w - 3)), y + rng.int(2, Math.max(2, h - 3)), 1, 1)
  }
}

/** 32×32 沙盒像素风地砖（9 套主题各自独立像素 tile：1px 描边 + 离散色阶抖动，无渐变，走画布缓存） */
function makeFloorTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const detail = (theme as Partial<ThemeV3>).detail
  const pattern: FloorTilePattern = detail?.tilePattern ?? 'flagstone'
  const inlayCol = detail?.inlayColor ?? mixHex(theme.floorColor, 0xffffff, 0.22)
  const cacheKey = `floor32:${theme.id}:${pattern}:${theme.floorColor}:${theme.floorAltColor}:${theme.accentColor}`

  const canvas = cachedPixelCanvas(cacheKey, 32, 32, (ctx) => {
    const rng = new Rng(seed)
    const outline = toneHex(theme.floorAltColor, -0.52)
    ctx.fillStyle = hexCss(outline)
    ctx.fillRect(0, 0, 32, 32)

    // 4 阶离散主题色板（禁止渐变）
    const c0 = theme.floorColor
    const c1 = theme.floorAltColor
    const c2 = mixHex(theme.floorColor, inlayCol, 0.45)
    const c3 = toneHex(theme.floorAltColor, -0.1)

    if (pattern === 'crazy') {
      const blocks: [number, number, number, number, number][] = [
        [0, 0, 14, 11, c0], [14, 0, 10, 8, c1], [24, 0, 8, 12, c2],
        [0, 11, 9, 11, c3], [9, 8, 15, 10, c0], [24, 12, 8, 10, c1],
        [0, 22, 16, 10, c1], [16, 18, 8, 14, c2], [24, 22, 8, 10, c0],
      ]
      for (const [bx, by, bw, bh, col] of blocks) {
        drawPixelTileBlock(ctx, bx, by, bw, bh, col, outline, rng)
      }
    } else if (pattern === 'inlay') {
      drawPixelTileBlock(ctx, 0, 0, 32, 6, c2, outline, rng)
      drawPixelTileBlock(ctx, 0, 26, 32, 6, c2, outline, rng)
      drawPixelTileBlock(ctx, 0, 6, 6, 20, c1, outline, rng)
      drawPixelTileBlock(ctx, 26, 6, 6, 20, c1, outline, rng)
      drawPixelTileBlock(ctx, 6, 6, 10, 10, c0, outline, rng)
      drawPixelTileBlock(ctx, 16, 6, 10, 10, c3, outline, rng)
      drawPixelTileBlock(ctx, 6, 16, 10, 10, c3, outline, rng)
      drawPixelTileBlock(ctx, 16, 16, 10, 10, c0, outline, rng)
      // 中心像素菱形徽记 + 四角像素铆钉
      ctx.fillStyle = hexCss(outline)
      ctx.fillRect(13, 13, 6, 6)
      ctx.fillStyle = hexCss(mixHex(inlayCol, theme.accentColor, 0.35))
      ctx.fillRect(14, 14, 4, 4)
      ctx.fillStyle = hexCss(toneHex(theme.accentColor, 0.3))
      ctx.fillRect(15, 15, 2, 2)
      for (const [rx, ry] of [[2, 2], [28, 2], [2, 28], [28, 28]]) {
        ctx.fillRect(rx, ry, 2, 2)
      }
    } else {
      // 大方砖错缝像素拼法
      drawPixelTileBlock(ctx, 0, 0, 19, 16, c0, outline, rng)
      drawPixelTileBlock(ctx, 19, 0, 13, 16, c2, outline, rng)
      drawPixelTileBlock(ctx, 0, 16, 13, 16, c1, outline, rng)
      drawPixelTileBlock(ctx, 13, 16, 19, 16, c3, outline, rng)
    }

    // 9 套主题专属 1px/2px 像素地表细节（无模糊/无阴影）
    const id = theme.id
    if (id === 'stage1-hall') {
      // 云上花庭·晨光：缝隙青苔像素簇 + 零星粉白花瓣点
      ctx.fillStyle = hexCss(0x52884e)
      for (const [mx, my] of [[1, 15], [2, 16], [18, 1], [19, 15], [12, 30], [29, 16]]) ctx.fillRect(mx, my, 2, 1)
      ctx.fillStyle = hexCss(0x88c474)
      for (const [mx, my] of [[2, 15], [19, 2], [13, 30]]) ctx.fillRect(mx, my, 1, 1)
      ctx.fillStyle = hexCss(0xffb4c8)
      ctx.fillRect(7, 8, 2, 1)
      ctx.fillRect(24, 22, 1, 1)
    } else if (id === 'stage1-candle') {
      // 云上花庭·风起：金黄蒲公英绒点 + 浅草点缀
      ctx.fillStyle = hexCss(0x8ea862)
      for (const [mx, my] of [[13, 10], [23, 21], [5, 22]]) ctx.fillRect(mx, my, 2, 1)
      ctx.fillStyle = hexCss(0xffe07d)
      for (const [px, py] of [[6, 5], [18, 12], [27, 26], [11, 25]]) ctx.fillRect(px, py, 1, 1)
    } else if (id === 'stage1-courtyard') {
      // 云上花庭·花落：樱粉双像素落瓣
      ctx.fillStyle = hexCss(0xff96b8)
      for (const [px, py] of [[8, 9], [21, 10], [10, 21], [23, 22]]) ctx.fillRect(px, py, 2, 1)
      ctx.fillStyle = hexCss(0xffdbe8)
      for (const [px, py] of [[9, 8], [22, 23]]) ctx.fillRect(px, py, 1, 1)
    } else if (id === 'stage2-forge') {
      // 星砂观星台·暮色：星轨黄铜角点 + 星尘像素
      ctx.fillStyle = hexCss(0xffd479)
      for (const [px, py] of [[3, 3], [17, 3], [3, 19], [16, 19], [26, 10], [22, 26]]) ctx.fillRect(px, py, 1, 1)
      ctx.fillStyle = hexCss(0xb8d4ff)
      ctx.fillRect(10, 12, 1, 1)
      ctx.fillRect(28, 28, 1, 1)
    } else if (id === 'stage2-slag') {
      // 星砂观星台·砂河：沿砖缝流淌的青白星砂像素线
      ctx.fillStyle = hexCss(0x8eeeff)
      for (const [px, py] of [[13, 2], [13, 5], [14, 8], [23, 14], [23, 18], [15, 23], [16, 27]]) ctx.fillRect(px, py, 1, 2)
    } else if (id === 'stage2-ember') {
      // 星砂观星台·流星：粉紫星屑点阵
      ctx.fillStyle = hexCss(0xffb4dc)
      for (const [px, py] of [[8, 8], [22, 9], [9, 22], [23, 23]]) ctx.fillRect(px, py, 1, 1)
      ctx.fillStyle = hexCss(0xffffff)
      ctx.fillRect(15, 15, 2, 2)
    } else if (id === 'stage3-frost') {
      // 黄铜钟塔·齿轮厅：金属地板四角铆钉 + 青绿铜锈像素
      ctx.fillStyle = hexCss(toneHex(theme.wallTopColor, 0.3))
      for (const [rx, ry] of [[2, 2], [16, 2], [21, 2], [29, 2], [2, 18], [15, 18], [29, 29]]) ctx.fillRect(rx, ry, 1, 1)
      ctx.fillStyle = hexCss(0x52b89c)
      for (const [px, py] of [[18, 14], [19, 15], [12, 17], [13, 17]]) ctx.fillRect(px, py, 2, 1)
    } else if (id === 'stage3-iron') {
      // 黄铜钟塔·熔金槽：暗铁板缝 + 像素熔金火花
      ctx.fillStyle = hexCss(0xff9a3c)
      for (const [px, py] of [[13, 8], [14, 9], [23, 15], [15, 21]]) ctx.fillRect(px, py, 2, 1)
      ctx.fillStyle = hexCss(0xffe078)
      ctx.fillRect(14, 8, 1, 1)
      ctx.fillRect(23, 15, 1, 1)
    } else if (id === 'stage3-throne') {
      // 黄铜钟塔·塔心：紫金王座像素嵌纹
      ctx.fillStyle = hexCss(0xffcf5c)
      for (const [px, py] of [[7, 7], [23, 7], [7, 23], [23, 23]]) ctx.fillRect(px, py, 2, 1)
      ctx.fillStyle = hexCss(0x9b72d4)
      ctx.fillRect(14, 14, 4, 4)
      ctx.fillStyle = hexCss(0xffdf80)
      ctx.fillRect(15, 15, 2, 2)
    }
  })

  return finalize(canvas, { nearest: true, repeat: true })
}

/* ------------------------------------------------------------------ */
/*  墙砖                                                               */
/* ------------------------------------------------------------------ */

/** 32×32 沙盒像素砖墙（每块砖独立离散色阶 + 1px 描边/高光，严禁渐变，走画布缓存） */
function makeWallTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const cacheKey = `wall32:${theme.id}:${theme.wallColor}:${theme.wallTopColor}:${theme.accentColor}`

  const canvas = cachedPixelCanvas(cacheKey, 32, 32, (ctx) => {
    const rng = new Rng(seed)
    const mortar = toneHex(theme.wallColor, -0.54)
    ctx.fillStyle = hexCss(mortar)
    ctx.fillRect(0, 0, 32, 32)

    // 4 阶离散砖色（每块砖独立挑选色阶，禁止线性渐变）
    const brickPalette = [
      toneHex(theme.wallColor, -0.12),
      theme.wallColor,
      mixHex(theme.wallColor, theme.wallTopColor, 0.25),
      mixHex(theme.wallColor, theme.wallTopColor, 0.44),
    ]

    const BH = 8
    const BW = 16
    for (let row = 0; row < 4; row += 1) {
      const offset = row % 2 === 0 ? 0 : -BW / 2
      for (let col = -1; col < 3; col += 1) {
        const x = col * BW + offset
        const y = row * BH
        // 每块砖独立色阶（底部行偏深一阶，纯离散切换）
        const stepIdx = Math.max(0, Math.min(3, rng.int(0, 3) - (row === 3 ? 1 : 0)))
        const base = brickPalette[stepIdx]
        const hi = toneHex(base, 0.24)
        const lo = toneHex(base, -0.3)

        ctx.fillStyle = hexCss(base)
        ctx.fillRect(x + 1, y + 1, BW - 2, BH - 2)
        // 1px 顶/左像素高光
        ctx.fillStyle = hexCss(hi)
        ctx.fillRect(x + 1, y + 1, BW - 3, 1)
        ctx.fillRect(x + 1, y + 1, 1, BH - 3)
        // 1px 底/右像素暗棱
        ctx.fillStyle = hexCss(lo)
        ctx.fillRect(x + 2, y + BH - 2, BW - 3, 1)
        ctx.fillRect(x + BW - 2, y + 2, 1, BH - 3)
        // 离散像素磨损点
        ctx.fillStyle = hexCss(rng.chance(0.5) ? hi : lo)
        ctx.fillRect(x + rng.int(3, BW - 4), y + rng.int(2, BH - 3), 1, 1)
        if (rng.chance(0.3)) {
          ctx.fillStyle = hexCss(mortar)
          ctx.fillRect(x + (rng.chance(0.5) ? 1 : BW - 2), y + BH - 2, 1, 1)
        }
      }
    }

    // 主题专属像素墙面细节（无阴影/无渐变）
    const family = familyOf(theme)
    if (family === 'moss') {
      ctx.fillStyle = hexCss(0x4b7d46)
      for (const [mx, my] of [[3, 24], [4, 25], [15, 22], [16, 23], [26, 26], [27, 27]]) ctx.fillRect(mx, my, 2, 2)
      ctx.fillStyle = hexCss(0x88c474)
      ctx.fillRect(4, 24, 1, 1)
      ctx.fillRect(16, 22, 1, 1)
    } else if (family === 'frost') {
      // 钟塔齿轮厅：铆钉像素 + 青绿铜锈块
      ctx.fillStyle = hexCss(toneHex(theme.wallTopColor, 0.32))
      for (let r = 0; r < 4; r += 1) {
        ctx.fillRect(2, r * 8 + 2, 1, 1)
        ctx.fillRect(18, r * 8 + 2, 1, 1)
      }
      ctx.fillStyle = hexCss(0x52b89c)
      ctx.fillRect(9, 18, 2, 3)
      ctx.fillRect(25, 10, 2, 3)
    } else if (family === 'forge') {
      const trim = mixHex(theme.accentColor, 0xffe49e, 0.3)
      ctx.fillStyle = hexCss(trim)
      for (const [px, py] of [[6, 3], [22, 11], [12, 19], [28, 27]]) ctx.fillRect(px, py, 2, 1)
    } else if (family === 'throne') {
      ctx.fillStyle = hexCss(0xffcf5c)
      ctx.fillRect(0, 7, 32, 1)
      ctx.fillRect(0, 23, 32, 1)
    }
  })

  return finalize(canvas, { nearest: true, repeat: true })
}

/* ------------------------------------------------------------------ */
/*  符文圈                                                             */
/* ------------------------------------------------------------------ */

/** 祭坛/楼梯用符文圈（透明底，additive 叠加） */
function makeRuneTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed)
  const { canvas, ctx } = makeCanvas(256, 256)
  const cx = 128
  const cy = 128
  const accent = mixHex(theme.accentColor, 0xffffff, 0.35)
  const color = hexCss(accent)

  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = 16
  ctx.lineCap = 'round'

  // 双环
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, 112, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.5
  ctx.globalAlpha = 0.75
  ctx.beginPath()
  ctx.arc(cx, cy, 98, 0, Math.PI * 2)
  ctx.stroke()

  // 刻度
  ctx.globalAlpha = 0.85
  ctx.lineWidth = 2
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2
    const r0 = i % 7 === 0 ? 100 : 104
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0)
    ctx.lineTo(cx + Math.cos(a) * 111, cy + Math.sin(a) * 111)
    ctx.stroke()
  }

  // 环形符文（随机折线，可复现）
  ctx.lineWidth = 2.2
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng.range(-0.05, 0.05)
    const px = cx + Math.cos(a) * 82
    const py = cy + Math.sin(a) * 82
    ctx.save()
    ctx.translate(px, py)
    ctx.rotate(a + Math.PI / 2)
    let x = rng.range(-4, 4)
    let y = -7
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let s = 0; s < 3; s++) {
      x += rng.range(-6, 6)
      y += rng.range(4, 8)
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    ctx.restore()
  }

  // 中心六芒星
  ctx.lineWidth = 2
  ctx.globalAlpha = 0.9
  for (const flip of [0, 1]) {
    ctx.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + (flip ? Math.PI : 0) - Math.PI / 2
      const x = cx + Math.cos(a) * 56
      const y = cy + Math.sin(a) * 56
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }
  // 中心点
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(cx, cy, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
  return finalize(canvas, { nearest: false, repeat: false })
}

/* ------------------------------------------------------------------ */
/*  石门                                                              */
/* ------------------------------------------------------------------ */

/** 楼梯石门（locked=暗色 + 红色警戒符文；open=亮起 + 主题色符文） */
function makeDoorTexture(theme: ThemeLike, open: boolean): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 176)
  ctx.imageSmoothingEnabled = false

  const base = mixHex(theme.wallColor, 0x000000, 0.4)
  ctx.fillStyle = hexCss(base)
  ctx.fillRect(0, 0, 128, 176)

  // 四块竖门板
  for (let i = 0; i < 4; i++) {
    const x = i * 32 + 2
    const c = mixHex(base, open ? 0x8a7048 : 0x5c5044, open ? 0.4 : 0.22 + (i % 2) * 0.07)
    ctx.fillStyle = hexCss(c)
    ctx.fillRect(x, 3, 28, 170)
    // 木纹
    ctx.fillStyle = hexCss(toneHex(c, -0.3), 0.55)
    for (let j = 0; j < 5; j++) ctx.fillRect(x + 3, 10 + j * 33, 22, 1)
    ctx.fillStyle = hexCss(toneHex(c, 0.15), 0.5)
    ctx.fillRect(x, 3, 1, 170)
  }

  // 铁箍 + 铆钉
  for (const y of [24, 78, 132]) {
    ctx.fillStyle = hexCss(0x26262c)
    ctx.fillRect(0, y, 128, 10)
    ctx.fillStyle = hexCss(0x50505c)
    ctx.fillRect(0, y, 128, 2)
    ctx.fillStyle = hexCss(0x16161a)
    for (const x of [12, 44, 84, 116]) ctx.fillRect(x - 2, y + 3, 4, 4)
  }

  // 外框
  ctx.strokeStyle = hexCss(0x121216)
  ctx.lineWidth = 4
  ctx.strokeRect(2, 2, 124, 172)

  // 中央符文徽记
  const rune = open ? mixHex(theme.accentColor, 0xffffff, 0.4) : 0xff3b30
  const runeCss = hexCss(rune)
  ctx.save()
  ctx.strokeStyle = runeCss
  ctx.fillStyle = runeCss
  ctx.shadowColor = runeCss
  ctx.shadowBlur = open ? 18 : 10
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(64, 88, 25, 0, Math.PI * 2)
  ctx.stroke()
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(64, 88, 17, 0, Math.PI * 2)
  ctx.stroke()
  // 内三角
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2
    const x = 64 + Math.cos(a) * 12
    const y = 88 + Math.sin(a) * 12
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.stroke()
  if (!open) {
    // 警示叉
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(52, 76)
    ctx.lineTo(76, 100)
    ctx.moveTo(76, 76)
    ctx.lineTo(52, 100)
    ctx.stroke()
  }
  // 四角小符
  ctx.lineWidth = 2
  for (const [x, y] of [
    [20, 20],
    [108, 20],
    [20, 156],
    [108, 156],
  ]) {
    ctx.beginPath()
    ctx.moveTo(x, y - 5)
    ctx.lineTo(x + 5, y)
    ctx.lineTo(x, y + 5)
    ctx.lineTo(x - 5, y)
    ctx.closePath()
    ctx.stroke()
  }
  ctx.restore()

  return finalize(canvas, { nearest: true, repeat: false })
}

/* ------------------------------------------------------------------ */
/*  发光贴图（火焰/光点/光柱）                                         */
/* ------------------------------------------------------------------ */

/** 火把火焰 billboard（底白顶橙，带柔光） */
function makeFlameTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(32, 48)
  // 外层柔光
  let g = ctx.createRadialGradient(16, 34, 1, 16, 30, 22)
  g.addColorStop(0, 'rgba(255,255,235,1)')
  g.addColorStop(0.22, 'rgba(255,226,150,0.95)')
  g.addColorStop(0.48, 'rgba(255,150,50,0.55)')
  g.addColorStop(0.78, 'rgba(255,90,20,0.18)')
  g.addColorStop(1, 'rgba(255,60,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 48)
  // 内焰（细长）
  g = ctx.createRadialGradient(16, 32, 1, 16, 30, 14)
  g.addColorStop(0, 'rgba(255,255,250,1)')
  g.addColorStop(0.4, 'rgba(255,240,190,0.9)')
  g.addColorStop(1, 'rgba(255,170,60,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.ellipse(16, 31, 9, 17, 0, 0, Math.PI * 2)
  ctx.fill()
  return finalize(canvas, { nearest: false, repeat: false })
}

/** 通用圆形光点（粒子/烛光/光晕） */
function makeGlowTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(32, 32)
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)')
  g.addColorStop(0.6, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 32, 32)
  return finalize(canvas, { nearest: false, repeat: false })
}

/** 光柱（竖直渐变 + 水平收边，用于楼梯门解锁） */
function makeBeamTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(32, 128)
  const v = ctx.createLinearGradient(0, 0, 0, 128)
  v.addColorStop(0, 'rgba(255,255,255,0)')
  v.addColorStop(0.12, 'rgba(255,255,255,0.9)')
  v.addColorStop(0.42, 'rgba(255,255,255,0.5)')
  v.addColorStop(0.82, 'rgba(255,255,255,0.18)')
  v.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, 32, 128)
  // 只在两侧羽化 alpha，保留中间
  ctx.globalCompositeOperation = 'destination-in'
  const h = ctx.createLinearGradient(0, 0, 32, 0)
  h.addColorStop(0, 'rgba(255,255,255,0)')
  h.addColorStop(0.5, 'rgba(255,255,255,0.95)')
  h.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, 32, 128)
  return finalize(canvas, { nearest: false, repeat: false })
}

/** 空气中的浮尘/光点 */
function makeMoteTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(16, 16)
  const g = ctx.createRadialGradient(8, 8, 0, 8, 8, 8)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 16, 16)
  return finalize(canvas, { nearest: false, repeat: false })
}

/** 地面光斑贴图（全柔边径向/线性羽化，无硬边多边形色纸感） */
function makeLightPatchTexture(kind: LightPatchKind): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(128, 128)
  ctx.clearRect(0, 0, 128, 128)

  const softSpot = (cx: number, cy: number, rx: number, ry: number, alpha: number, rot = 0): void => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.scale(1, ry / Math.max(1, rx))
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, `rgba(255,255,255,${alpha})`)
    g.addColorStop(0.45, `rgba(255,255,255,${(alpha * 0.55).toFixed(3)})`)
    g.addColorStop(0.78, `rgba(255,255,255,${(alpha * 0.14).toFixed(3)})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, rx, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  if (kind === 'window') {
    // 柔化 2×2 窗格光斑：每个窗格自身径向羽化，避免硬矩形切边
    softSpot(42, 42, 24, 20, 0.54)
    softSpot(86, 42, 24, 20, 0.5)
    softSpot(42, 84, 24, 20, 0.42)
    softSpot(86, 84, 24, 20, 0.38)
    softSpot(64, 60, 36, 30, 0.16)
  } else if (kind === 'canopy') {
    // 树影斑驳：多枚重叠柔光椭圆
    softSpot(44, 44, 30, 20, 0.72, 0.25)
    softSpot(82, 48, 26, 18, 0.66, -0.2)
    softSpot(64, 78, 34, 22, 0.7, 0.15)
    softSpot(36, 82, 20, 16, 0.48, -0.3)
    softSpot(92, 84, 22, 16, 0.45, 0.35)
  } else if (kind === 'crystal') {
    // 晶光：柔和星芒 + 中心晕染，无锐利切角
    softSpot(64, 64, 42, 42, 0.62)
    softSpot(64, 64, 52, 16, 0.55, 0)
    softSpot(64, 64, 52, 16, 0.55, Math.PI / 2)
    softSpot(64, 64, 36, 12, 0.38, Math.PI / 4)
    softSpot(64, 64, 36, 12, 0.38, -Math.PI / 4)
  } else {
    // 拱窗光束：上圆下淡的柔化长椭圆光带
    softSpot(64, 48, 34, 32, 0.78)
    softSpot(64, 76, 36, 42, 0.58)
    softSpot(64, 96, 32, 24, 0.28)
  }

  // 全局外圈柔化遮罩：保证贴图四周边缘平滑归零（约 0.3m 过渡带）
  ctx.globalCompositeOperation = 'destination-in'
  const mask = ctx.createRadialGradient(64, 64, 16, 64, 64, 62)
  mask.addColorStop(0, 'rgba(255,255,255,1)')
  mask.addColorStop(0.58, 'rgba(255,255,255,0.78)')
  mask.addColorStop(0.84, 'rgba(255,255,255,0.22)')
  mask.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = mask
  ctx.fillRect(0, 0, 128, 128)
  ctx.globalCompositeOperation = 'source-over'

  return finalize(canvas, { nearest: false, repeat: false })
}

/** 空气粒子贴图（走 BillboardBatch 批处理）：花庭花瓣 / 观星台星尘 / 钟塔火星铜屑 */
function makeAirParticleTexture(kind: AirParticleKind): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(32, 32)
  ctx.clearRect(0, 0, 32, 32)

  if (kind === 'garden') {
    const g = ctx.createRadialGradient(14, 14, 1, 16, 16, 13)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.ellipse(16, 16, 11, 7, -0.45, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'observatory') {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 14)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.75)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(16, 2)
    ctx.lineTo(19, 13)
    ctx.lineTo(30, 16)
    ctx.lineTo(19, 19)
    ctx.lineTo(16, 30)
    ctx.lineTo(13, 19)
    ctx.lineTo(2, 16)
    ctx.lineTo(13, 13)
    ctx.closePath()
    ctx.fill()
  } else {
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 13)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.85)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(16, 4)
    ctx.lineTo(25, 16)
    ctx.lineTo(16, 28)
    ctx.lineTo(7, 16)
    ctx.closePath()
    ctx.fill()
  }
  return finalize(canvas, { nearest: false, repeat: false })
}

/* ------------------------------------------------------------------ */
/*  纹理包                                                             */
/* ------------------------------------------------------------------ */

/**
 * 一层场景用到的全部纹理。
 * 注意：所有纹理都带 `repeat` 语义的地砖/墙砖由使用方设置 repeat，
 * 本类只负责创建与释放。
 */
export class TextureBook {
  readonly floor: THREE.CanvasTexture
  readonly wall: THREE.CanvasTexture
  readonly rune: THREE.CanvasTexture
  readonly doorLocked: THREE.CanvasTexture
  readonly doorOpen: THREE.CanvasTexture
  readonly flame: THREE.CanvasTexture
  readonly glow: THREE.CanvasTexture
  readonly beam: THREE.CanvasTexture
  readonly mote: THREE.CanvasTexture
  readonly lightPatch: THREE.CanvasTexture
  readonly airParticle: THREE.CanvasTexture
  private readonly owned: THREE.Texture[] = []

  constructor(readonly theme: ThemeLike) {
    const seed = 0x1b873593 ^ (theme.name.length * 7919) ^ (theme.floorColor & 0xffff)
    this.floor = this.reg(makeFloorTexture(theme, seed))
    // 地面是大幅重复贴图：线性 mipmap 比最近邻更稳，避免转动镜头时格子边缘跳动
    this.floor.magFilter = THREE.LinearFilter
    this.floor.minFilter = THREE.LinearMipmapLinearFilter
    this.floor.anisotropy = 16
    this.floor.needsUpdate = true
    this.wall = this.reg(makeWallTexture(theme, seed ^ 0x9e3779b9))
    this.rune = this.reg(makeRuneTexture(theme, seed ^ 0x85ebca6b))
    this.doorLocked = this.reg(makeDoorTexture(theme, false))
    this.doorOpen = this.reg(makeDoorTexture(theme, true))
    this.flame = this.reg(makeFlameTexture())
    this.glow = this.reg(makeGlowTexture())
    this.beam = this.reg(makeBeamTexture())
    this.mote = this.reg(makeMoteTexture())
    const detail = (theme as Partial<ThemeV3>).detail
    this.lightPatch = this.reg(makeLightPatchTexture(detail?.lightPatchKind ?? 'window'))
    this.airParticle = this.reg(makeAirParticleTexture(detail?.airKind ?? 'garden'))
  }

  private reg<T extends THREE.Texture>(t: T): T {
    this.owned.push(t)
    return t
  }

  dispose(): void {
    for (const t of this.owned) t.dispose()
    this.owned.length = 0
  }
}

/** 供其他世界子模块复用的小工具 */
export { hexCss, mixHex, toneHex }
