import * as THREE from 'three'
import type { ThemeLike } from './themes'
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

/** 64×64 石厅地砖（2×2 块大石砖 + 缝隙 + 裂纹） */
function makeFloorTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed)
  const { canvas, ctx } = makeCanvas(64, 64)
  ctx.imageSmoothingEnabled = false

  // 底色 = 缝隙（压暗的主色）
  ctx.fillStyle = hexCss(toneHex(theme.floorAltColor, -0.5))
  ctx.fillRect(0, 0, 64, 64)

  const TILE = 32
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const x0 = tx * TILE
      const y0 = ty * TILE
      const base = mixHex(theme.floorColor, theme.floorAltColor, rng.range(0, 0.9))

      ctx.fillStyle = hexCss(base)
      ctx.fillRect(x0 + 1, y0 + 1, TILE - 1, TILE - 1)

      // 受光边（上/左）
      ctx.fillStyle = hexCss(toneHex(base, 0.16))
      ctx.fillRect(x0 + 1, y0 + 1, TILE - 2, 1)
      ctx.fillRect(x0 + 1, y0 + 1, 1, TILE - 2)
      // 暗边（下/右）
      ctx.fillStyle = hexCss(toneHex(base, -0.32))
      ctx.fillRect(x0 + 1, y0 + TILE - 2, TILE - 1, 1)
      ctx.fillRect(x0 + TILE - 2, y0 + 1, 1, TILE - 1)

      // 石面颗粒
      for (let i = 0; i < 20; i++) {
        const v = rng.chance(0.5) ? 0.12 : -0.14
        ctx.fillStyle = hexCss(toneHex(base, v), rng.range(0.5, 0.95))
        ctx.fillRect(x0 + rng.int(2, TILE - 2), y0 + rng.int(2, TILE - 2), rng.int(1, 2), 1)
      }

      // 裂纹
      if (rng.chance(0.6)) {
        drawCrack(
          ctx,
          x0 + rng.int(2, TILE - 8),
          y0 + rng.int(2, TILE - 8),
          rng.range(8, 22),
          hexCss(toneHex(base, -0.55), 0.85),
          rng,
        )
      }
    }
  }

  floorDetail(ctx, theme, rng)
  return finalize(canvas, { nearest: true, repeat: true })
}

/* ------------------------------------------------------------------ */
/*  墙砖                                                               */
/* ------------------------------------------------------------------ */

/** 64×64 墙砖（4 层砖，交错排布） */
function makeWallTexture(theme: ThemeLike, seed: number): THREE.CanvasTexture {
  const rng = new Rng(seed)
  const { canvas, ctx } = makeCanvas(64, 64)
  ctx.imageSmoothingEnabled = false

  ctx.fillStyle = hexCss(toneHex(theme.wallColor, -0.45))
  ctx.fillRect(0, 0, 64, 64)

  const BH = 16
  const BW = 32
  for (let row = 0; row < 4; row++) {
    const offset = row % 2 === 0 ? 0 : -BW / 2
    for (let col = -1; col < 3; col++) {
      const x = col * BW + offset
      const y = row * BH
      const base = mixHex(theme.wallColor, theme.wallTopColor, rng.range(0.05, 0.4))
      ctx.fillStyle = hexCss(base)
      ctx.fillRect(x + 1, y + 1, BW - 2, BH - 2)
      // 砖块受光/阴影
      ctx.fillStyle = hexCss(toneHex(base, 0.14))
      ctx.fillRect(x + 1, y + 1, BW - 2, 1)
      ctx.fillStyle = hexCss(toneHex(base, -0.28))
      ctx.fillRect(x + 1, y + BH - 2, BW - 2, 1)
      // 砖面噪声
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = hexCss(toneHex(base, rng.chance(0.5) ? 0.1 : -0.12), 0.7)
        ctx.fillRect(x + rng.int(2, BW - 3), y + rng.int(2, BH - 3), 1, 1)
      }
    }
  }

  // 主题墙面细节（9 套主题按视觉家族复用 5 种细节）
  const family = familyOf(theme)
  if (family === 'moss') {
    const moss = mixHex(theme.accentColor, 0x2f4a2c, 0.6)
    for (let i = 0; i < 34; i++) {
      ctx.fillStyle = hexCss(moss, rng.range(0.35, 0.8))
      ctx.fillRect(rng.int(0, 63), rng.int(24, 63), rng.int(1, 3), rng.int(1, 2))
    }
  } else if (family === 'candle') {
    const wax = mixHex(theme.accentColor, 0xf2e6c8, 0.6)
    for (let i = 0; i < 12; i++) {
      const x = rng.int(2, 60)
      const y = rng.int(2, 48)
      ctx.fillStyle = hexCss(wax, rng.range(0.25, 0.5))
      ctx.fillRect(x, y, 2, rng.int(4, 14))
      ctx.fillRect(x - 1, y + 2, 4, 1)
    }
    // 烟熏
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = hexCss(0x120c08, rng.range(0.1, 0.3))
      ctx.beginPath()
      ctx.ellipse(rng.int(0, 63), rng.int(0, 20), rng.range(4, 12), rng.range(3, 8), 0, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (family === 'forge') {
    const lava = mixHex(theme.accentColor, 0xffd28a, 0.35)
    ctx.save()
    ctx.shadowColor = hexCss(lava)
    ctx.shadowBlur = 4
    for (let i = 0; i < 3; i++) {
      drawCrack(ctx, rng.int(4, 34), rng.int(4, 30), rng.range(16, 30), hexCss(lava), rng)
    }
    ctx.restore()
  } else if (family === 'frost') {
    const ice = mixHex(theme.accentColor, 0xffffff, 0.5)
    for (let i = 0; i < 16; i++) {
      ctx.strokeStyle = hexCss(ice, rng.range(0.2, 0.45))
      ctx.lineWidth = 1
      ctx.beginPath()
      const x = rng.int(0, 63)
      const y = rng.int(0, 63)
      ctx.moveTo(x, y)
      ctx.lineTo(x + rng.range(-8, 8), y + rng.range(-8, 8))
      ctx.stroke()
    }
  } else if (family === 'throne') {
    const g = mixHex(theme.accentColor, 0xfff0b0, 0.35)
    // 墙面金色嵌线
    ctx.strokeStyle = hexCss(g, 0.5)
    ctx.lineWidth = 1
    for (const y of [7, 39]) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(64, y)
      ctx.stroke()
    }
    ctx.fillStyle = hexCss(g, 0.8)
    for (let i = 0; i < 8; i++) ctx.fillRect(rng.int(0, 63), rng.int(0, 63), 1, 1)
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
