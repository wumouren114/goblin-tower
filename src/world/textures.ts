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

/** 收尾成纹理：像素风用 Nearest，发光图用 Linear */
function finalize(
  canvas: HTMLCanvasElement,
  opts: { nearest?: boolean; repeat?: boolean; srgb?: boolean } = {},
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  if (opts.nearest) {
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestMipmapLinearFilter
  } else {
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearMipmapLinearFilter
  }
  tex.generateMipmaps = true
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

/** 128×128 多拼法地砖：四象限宏观明暗变化 + 细微磨损斑块 + 主题纹样 */
function makeFloorTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed)
  const { canvas, ctx } = makeCanvas(128, 128)
  ctx.imageSmoothingEnabled = false

  const detail = (theme as Partial<ThemeV3>).detail
  const pattern: FloorTilePattern = detail?.tilePattern ?? 'flagstone'
  const inlayCol = detail?.inlayColor ?? mixHex(theme.floorColor, 0xffffff, 0.25)
  const themeId = theme.id

  // 底色 = 深砖缝（压暗的主副色）
  ctx.fillStyle = hexCss(toneHex(theme.floorAltColor, -0.48))
  ctx.fillRect(0, 0, 128, 128)

  // 四象限拼铺，每象限带轻微明暗与冷暖偏移，打破纯色重复感
  for (let qy = 0; qy < 2; qy += 1) {
    for (let qx = 0; qx < 2; qx += 1) {
      const ox = qx * 64
      const oy = qy * 64
      const quadShift = ((qx + qy) % 2 === 0 ? 0.045 : -0.045) + rng.range(-0.025, 0.025)
      const qFloor = toneHex(theme.floorColor, quadShift)
      const qAlt = toneHex(theme.floorAltColor, quadShift)
      const qInlay = toneHex(inlayCol, quadShift * 0.7)

      if (pattern === 'crazy') {
        const blocks: [number, number, number, number][] = [
          [1, 1, 22, 18], [24, 1, 17, 13], [42, 1, 21, 20],
          [1, 20, 14, 21], [16, 15, 25, 16], [42, 22, 21, 15],
          [1, 42, 26, 21], [28, 32, 13, 19], [42, 38, 21, 25],
          [28, 52, 13, 11], [16, 32, 11, 9],
        ]
        for (let i = 0; i < blocks.length; i++) {
          const [bx, by, w, h] = blocks[i]
          const base =
            (i + qx + qy) % 5 === 2
              ? mixHex(qFloor, qInlay, 0.55)
              : mixHex(qFloor, qAlt, rng.range(0.05, 0.95))
          drawTileBevel(ctx, ox + bx, oy + by, w, h, base, rng)
          if (rng.chance(0.42)) {
            drawCrack(ctx, ox + bx + 2, oy + by + 2, rng.range(6, 14), hexCss(toneHex(base, -0.5), 0.72), rng)
          }
        }
      } else if (pattern === 'inlay') {
        drawTileBevel(ctx, ox + 1, oy + 1, 62, 11, mixHex(qAlt, qInlay, 0.36), rng)
        drawTileBevel(ctx, ox + 1, oy + 52, 62, 11, mixHex(qAlt, qInlay, 0.36), rng)
        drawTileBevel(ctx, ox + 1, oy + 13, 11, 38, mixHex(qFloor, qAlt, 0.5), rng)
        drawTileBevel(ctx, ox + 52, oy + 13, 11, 38, mixHex(qFloor, qAlt, 0.5), rng)
        drawTileBevel(ctx, ox + 13, oy + 13, 18, 18, qFloor, rng)
        drawTileBevel(ctx, ox + 33, oy + 13, 18, 18, mixHex(qFloor, qAlt, 0.42), rng)
        drawTileBevel(ctx, ox + 13, oy + 33, 18, 18, mixHex(qFloor, qAlt, 0.42), rng)
        drawTileBevel(ctx, ox + 33, oy + 33, 18, 18, qFloor, rng)
        ctx.fillStyle = hexCss(mixHex(qInlay, theme.accentColor, 0.25), 0.88)
        ctx.beginPath()
        ctx.moveTo(ox + 32, oy + 22)
        ctx.lineTo(ox + 42, oy + 32)
        ctx.lineTo(ox + 32, oy + 42)
        ctx.lineTo(ox + 22, oy + 32)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = hexCss(mixHex(theme.accentColor, 0xffffff, 0.38), 0.82)
        for (const [cx, cy] of [[6, 6], [56, 6], [6, 56], [56, 56]]) {
          ctx.fillRect(ox + cx, oy + cy, 3, 3)
        }
      } else {
        const tiles: [number, number, number, number, boolean][] =
          (qx + qy) % 2 === 0
            ? [
                [1, 1, 38, 30, false],
                [40, 1, 23, 30, true],
                [1, 32, 23, 31, true],
                [25, 32, 38, 31, false],
              ]
            : [
                [1, 1, 23, 30, true],
                [25, 1, 38, 30, false],
                [1, 32, 38, 31, false],
                [40, 32, 23, 31, true],
              ]
        for (const [bx, by, w, h, accentTile] of tiles) {
          const base = accentTile
            ? mixHex(qAlt, qInlay, 0.44)
            : mixHex(qFloor, qAlt, rng.range(0, 0.74))
          drawTileBevel(ctx, ox + bx, oy + by, w, h, base, rng)
          ctx.strokeStyle = hexCss(toneHex(base, -0.22), 0.42)
          ctx.strokeRect(ox + bx + 3.5, oy + by + 3.5, w - 7, h - 7)
          if (rng.chance(0.5)) {
            drawCrack(
              ctx,
              ox + bx + rng.int(2, Math.max(3, w - 8)),
              oy + by + rng.int(2, Math.max(3, h - 8)),
              rng.range(8, 20),
              hexCss(toneHex(base, -0.52), 0.78),
              rng,
            )
          }
        }
      }

      // 象限级原有主题细节（复用 64×64 坐标系平移）
      ctx.save()
      ctx.translate(ox, oy)
      floorDetail(ctx, theme, rng)
      ctx.restore()
    }
  }

  // 宏观明暗变化：柔和暖冷光照斑块 + 轻微踩踏磨损，让整片地面有呼吸与层次
  for (let i = 0; i < 6; i += 1) {
    const cx = rng.range(12, 116)
    const cy = rng.range(12, 116)
    const r = rng.range(18, 42)
    const bright = i % 2 === 0
    const col = bright ? toneHex(theme.floorColor, 0.22) : toneHex(theme.floorAltColor, -0.28)
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, r)
    grad.addColorStop(0, hexCss(col, bright ? 0.16 : 0.18))
    grad.addColorStop(1, hexCss(col, 0))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 128, 128)
  }

  // 阶段专属地表细部纹样（低对比，不影响敌人/弹道可读性）
  if (themeId.startsWith('stage1')) {
    // 云上花庭：砖缝散落极细花瓣点与草叶碎影
    const petal = mixHex(theme.accentColor, 0xffffff, 0.35)
    for (let i = 0; i < 18; i += 1) {
      ctx.fillStyle = hexCss(petal, rng.range(0.32, 0.62))
      ctx.fillRect(rng.int(2, 124), rng.int(2, 124), rng.int(1, 2), 1)
    }
  } else if (themeId.startsWith('stage2')) {
    // 星砂观星台：暗嵌星轨细弧与星砂微点
    const lineCol = mixHex(theme.accentColor, 0xffffff, 0.28)
    ctx.strokeStyle = hexCss(lineCol, 0.22)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(64, 64, 44, 0.2, Math.PI * 1.15)
    ctx.stroke()
    for (let i = 0; i < 24; i += 1) {
      ctx.fillStyle = hexCss(lineCol, rng.range(0.28, 0.72))
      ctx.fillRect(rng.int(1, 126), rng.int(1, 126), 1, 1)
    }
  } else if (themeId.startsWith('stage3')) {
    // 黄铜钟塔：板缝铆钉高光 + 铜锈青绿磨损斑
    const rivetHi = toneHex(theme.wallTopColor, 0.3)
    const patina = mixHex(theme.accentColor, 0x3b7a68, 0.55)
    for (let gy = 0; gy < 128; gy += 32) {
      for (let gx = 0; gx < 128; gx += 32) {
        ctx.fillStyle = hexCss(rivetHi, 0.55)
        ctx.fillRect(gx + 3, gy + 3, 2, 2)
        ctx.fillStyle = hexCss(toneHex(theme.floorAltColor, -0.45), 0.65)
        ctx.fillRect(gx + 4, gy + 4, 1, 1)
      }
    }
    for (let i = 0; i < 14; i += 1) {
      ctx.fillStyle = hexCss(patina, rng.range(0.16, 0.34))
      ctx.fillRect(rng.int(0, 122), rng.int(0, 122), rng.int(2, 5), rng.int(1, 3))
    }
  }

  return finalize(canvas, { nearest: true, repeat: true })
}

/* ------------------------------------------------------------------ */
/*  墙砖                                                               */
/* ------------------------------------------------------------------ */

/** 128×128 墙砖（8 层交错石/铜砖 + 边缘高光 + 缺角磨损 + 上下湿痕/风化渐变） */
function makeWallTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed)
  const { canvas, ctx } = makeCanvas(128, 128)
  ctx.imageSmoothingEnabled = false

  const mortar = toneHex(theme.wallColor, -0.48)
  ctx.fillStyle = hexCss(mortar)
  ctx.fillRect(0, 0, 128, 128)

  const BH = 16
  const BW = 32
  for (let row = 0; row < 8; row++) {
    const offset = row % 2 === 0 ? 0 : -BW / 2
    // 顶部受光偏亮，底部墙脚偏暗磨损
    const rowShade = (3.5 - row) * 0.022
    for (let col = -1; col < 5; col++) {
      const x = col * BW + offset
      const y = row * BH
      const base = toneHex(mixHex(theme.wallColor, theme.wallTopColor, rng.range(0.06, 0.42)), rowShade)
      ctx.fillStyle = hexCss(base)
      ctx.fillRect(x + 1, y + 1, BW - 2, BH - 2)
      // 边缘高光（顶边 + 左边受光棱线）
      ctx.fillStyle = hexCss(toneHex(base, 0.24), 0.92)
      ctx.fillRect(x + 1, y + 1, BW - 2, 1)
      ctx.fillRect(x + 1, y + 1, 1, BH - 3)
      // 凹陷阴影（底边 + 右边）
      ctx.fillStyle = hexCss(toneHex(base, -0.34), 0.95)
      ctx.fillRect(x + 1, y + BH - 2, BW - 2, 1)
      ctx.fillRect(x + BW - 2, y + 2, 1, BH - 3)
      // 砖角轻微缺口磨损
      if (rng.chance(0.28)) {
        ctx.fillStyle = hexCss(mortar, 0.85)
        const cx = rng.chance(0.5) ? x + 1 : x + BW - 3
        const cy = rng.chance(0.5) ? y + 1 : y + BH - 3
        ctx.fillRect(cx, cy, 2, 2)
      }
      // 砖面细颗粒与横向凿痕
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = hexCss(toneHex(base, rng.chance(0.5) ? 0.13 : -0.15), 0.68)
        ctx.fillRect(x + rng.int(2, BW - 3), y + rng.int(2, BH - 3), rng.int(1, 2), 1)
      }
    }
  }

  // 上下风化渐变：顶部压边微亮，底部墙脚微暗做地墙过渡
  const weatherGrad = ctx.createLinearGradient(0, 0, 0, 128)
  weatherGrad.addColorStop(0, hexCss(toneHex(theme.wallTopColor, 0.2), 0.14))
  weatherGrad.addColorStop(0.28, 'rgba(0,0,0,0)')
  weatherGrad.addColorStop(0.75, 'rgba(0,0,0,0)')
  weatherGrad.addColorStop(1, hexCss(toneHex(theme.wallColor, -0.65), 0.28))
  ctx.fillStyle = weatherGrad
  ctx.fillRect(0, 0, 128, 128)

  // 竖向雨痕 / 岁月磨损条纹
  for (let i = 0; i < 12; i += 1) {
    const sx = rng.int(2, 124)
    const sy = rng.int(0, 88)
    const sh = rng.int(10, 34)
    ctx.fillStyle = hexCss(toneHex(theme.wallColor, -0.45), rng.range(0.12, 0.26))
    ctx.fillRect(sx, sy, 1, sh)
  }

  // 主题墙面细节
  const family = familyOf(theme)
  if (family === 'moss') {
    const moss = mixHex(theme.accentColor, 0x2f4a2c, 0.6)
    for (let i = 0; i < 56; i++) {
      ctx.fillStyle = hexCss(moss, rng.range(0.32, 0.76))
      ctx.fillRect(rng.int(0, 125), rng.int(44, 126), rng.int(1, 3), rng.int(1, 2))
    }
  } else if (family === 'candle') {
    const wax = mixHex(theme.accentColor, 0xf2e6c8, 0.6)
    for (let i = 0; i < 18; i++) {
      const x = rng.int(2, 124)
      const y = rng.int(2, 96)
      ctx.fillStyle = hexCss(wax, rng.range(0.22, 0.48))
      ctx.fillRect(x, y, 2, rng.int(5, 16))
    }
  } else if (family === 'forge') {
    const trim = mixHex(theme.accentColor, 0xffdf9a, 0.35)
    ctx.save()
    ctx.shadowColor = hexCss(trim)
    ctx.shadowBlur = 3
    for (let i = 0; i < 4; i++) {
      drawCrack(ctx, rng.int(4, 96), rng.int(8, 92), rng.range(16, 32), hexCss(trim, 0.65), rng)
    }
    ctx.restore()
  } else if (family === 'frost') {
    // 钟塔齿轮厅：铜铆钉高光 + 青绿氧化铜锈纹
    const patina = mixHex(theme.accentColor, 0x3b7a68, 0.45)
    const rivet = toneHex(theme.wallTopColor, 0.32)
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        ctx.fillStyle = hexCss(rivet, 0.62)
        ctx.fillRect(col * 32 + 4, row * 16 + 4, 2, 2)
      }
    }
    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = hexCss(patina, rng.range(0.18, 0.42))
      ctx.fillRect(rng.int(0, 124), rng.int(12, 124), rng.int(2, 4), rng.int(3, 10))
    }
  } else if (family === 'throne') {
    const g = mixHex(theme.accentColor, 0xfff0b0, 0.35)
    ctx.strokeStyle = hexCss(g, 0.55)
    ctx.lineWidth = 1
    for (const y of [15, 63, 111]) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(128, y)
      ctx.stroke()
    }
    ctx.fillStyle = hexCss(g, 0.82)
    for (let i = 0; i < 16; i++) ctx.fillRect(rng.int(0, 126), rng.int(0, 126), 2, 1)
  }

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
    // 柔化 2×2 窗格光斑：降低峰值亮度，避免在浅色花庭地面泛白刺眼
    softSpot(42, 42, 24, 20, 0.56)
    softSpot(86, 42, 24, 20, 0.52)
    softSpot(42, 84, 24, 20, 0.44)
    softSpot(86, 84, 24, 20, 0.4)
    softSpot(64, 60, 38, 32, 0.18)
  } else if (kind === 'canopy') {
    // 树影斑驳：克制不透明度，保持地面砖纹与战斗弹道可读
    softSpot(44, 44, 28, 18, 0.52, 0.25)
    softSpot(82, 48, 24, 16, 0.46, -0.2)
    softSpot(64, 78, 30, 20, 0.48, 0.15)
    softSpot(36, 82, 18, 14, 0.34, -0.3)
    softSpot(92, 84, 20, 14, 0.32, 0.35)
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
