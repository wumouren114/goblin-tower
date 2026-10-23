import * as THREE from 'three'

/**
 * v4.7 角色特效贴图：全部程序化生成，不依赖外部美术资源。
 *
 * 设计口径：
 * - 所有纹理都是白色遮罩，实际颜色由 SpriteMaterial / MeshBasicMaterial 染色；
 * - 若叶睦走「音乐」语言：音符、五线谱法阵、同心音波；
 * - 丛雨走「刀术」语言：贴地弧形斩击、居合长线、樱花/血滴/守护火花；
 * - 肥鱼走「水」语言：泡泡、鱼影、鲸影。
 */

export type FxTextureKind =
  | 'note'
  | 'slash'
  | 'bladeLine'
  | 'staff'
  | 'ring'
  | 'petal'
  | 'blood'
  | 'bubble'
  | 'fish'
  | 'whale'
  | 'hex'

const cache = new Map<FxTextureKind, THREE.CanvasTexture>()

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return { canvas, ctx }
}

function glow(ctx: CanvasRenderingContext2D, blur: number): void {
  ctx.shadowColor = 'rgba(255,255,255,0.95)'
  ctx.shadowBlur = blur
}

/** 简单的音符轮廓：符头 + 符干 + 符尾，供音符粒子和五线谱法阵复用 */
function drawNoteGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, rot = 0): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rot)
  ctx.scale(s, s)
  glow(ctx, 8)
  ctx.fillStyle = '#ffffff'
  // 符头
  ctx.beginPath()
  ctx.ellipse(-8, 19, 9.5, 6.4, -0.32, 0, Math.PI * 2)
  ctx.fill()
  // 符干
  ctx.fillRect(-1.5, -23, 3.4, 42)
  // 符尾
  ctx.beginPath()
  ctx.moveTo(1.5, -23)
  ctx.bezierCurveTo(15, -18, 20, -8, 10, 3)
  ctx.bezierCurveTo(15, -8, 10, -13, 1.5, -15)
  ctx.closePath()
  ctx.fill()
  // 高光
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.beginPath()
  ctx.ellipse(-9.5, 17.5, 3.2, 2.1, -0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function noteTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64)
  drawNoteGlyph(ctx, 35, 28, 1.05, -0.12)
  return canvas
}

function slashTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(128, 128)
  const cx = 64
  const cy = 94
  const start = (202 * Math.PI) / 180
  const end = (338 * Math.PI) / 180

  // 外层刀风：宽、淡、带一点速度感
  ctx.save()
  glow(ctx, 12)
  ctx.strokeStyle = 'rgba(255,255,255,0.22)'
  ctx.lineWidth = 22
  ctx.beginPath()
  ctx.arc(cx, cy, 56, start, end)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 11
  ctx.beginPath()
  ctx.arc(cx, cy, 56, start + 0.04, end - 0.04)
  ctx.stroke()

  // 内层白芯：让斩击有明确的方向和锋利感
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 3.2
  ctx.beginPath()
  ctx.arc(cx, cy, 56, start + 0.08, end - 0.08)
  ctx.stroke()

  // 拖尾细线
  ctx.shadowBlur = 4
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 1.5
  for (const r of [45, 67]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r, start + 0.14, end - 0.16)
    ctx.stroke()
  }

  // 前缘亮斑
  const tipX = cx + Math.cos(end - 0.03) * 56
  const tipY = cy + Math.sin(end - 0.03) * 56
  const grad = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 13)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.6)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(tipX, tipY, 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return canvas
}

function bladeLineTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 256)
  const grad = ctx.createLinearGradient(0, 256, 0, 0)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.28, 'rgba(255,255,255,0.35)')
  grad.addColorStop(0.72, 'rgba(255,255,255,0.95)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')

  ctx.save()
  glow(ctx, 16)
  ctx.fillStyle = grad
  // 居合长线：底部宽、顶部收尖
  ctx.beginPath()
  ctx.moveTo(22, 248)
  ctx.quadraticCurveTo(29, 100, 31, 8)
  ctx.quadraticCurveTo(33, 100, 42, 248)
  ctx.closePath()
  ctx.fill()

  ctx.shadowBlur = 5
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(32, 244)
  ctx.quadraticCurveTo(32, 110, 32, 14)
  ctx.stroke()

  // 两侧速度线
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'
  ctx.lineWidth = 1.2
  for (const x of [16, 48]) {
    ctx.beginPath()
    ctx.moveTo(x, 230)
    ctx.quadraticCurveTo(x + (x < 32 ? 6 : -6), 110, x + (x < 32 ? 3 : -3), 76)
    ctx.stroke()
  }
  ctx.restore()
  return canvas
}

function staffTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(256, 256)
  const cx = 128
  const cy = 128
  ctx.save()
  glow(ctx, 7)

  // 外圈：法阵边界
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, 116, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  ctx.arc(cx, cy, 108, 0, Math.PI * 2)
  ctx.stroke()

  // 五线谱：五道同心细环，组成「音乐环」
  for (let i = 0; i < 5; i++) {
    const r = 64 + i * 8
    ctx.strokeStyle = `rgba(255,255,255,${0.22 + i * 0.04})`
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0.16, Math.PI * 2 - 0.16)
    ctx.stroke()
  }

  // 八根音律刻度
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 1.6
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * 92, cy + Math.sin(a) * 92)
    ctx.lineTo(cx + Math.cos(a) * 104, cy + Math.sin(a) * 104)
    ctx.stroke()
  }

  // 内圈 + 中心高音谱号意象
  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.arc(cx, cy, 44, 0, Math.PI * 2)
  ctx.stroke()
  drawNoteGlyph(ctx, cx + 5, cy - 2, 1.35, 0.08)

  // 环上的音符
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.35
    drawNoteGlyph(ctx, cx + Math.cos(a) * 84, cy + Math.sin(a) * 84, 0.34, a + Math.PI / 2)
  }
  ctx.restore()
  return canvas
}

function ringTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(96, 96)
  const cx = 48
  const cy = 48
  ctx.save()
  glow(ctx, 8)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 5
  ctx.beginPath()
  ctx.arc(cx, cy, 35, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.arc(cx, cy, 43, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'
  ctx.lineWidth = 1.4
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * 38, cy + Math.sin(a) * 38)
    ctx.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44)
    ctx.stroke()
  }
  ctx.restore()
  return canvas
}

function petalTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64)
  ctx.save()
  glow(ctx, 7)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(32, 5)
  ctx.bezierCurveTo(49, 14, 57, 34, 42, 51)
  ctx.bezierCurveTo(37, 56, 34, 58, 32, 61)
  ctx.bezierCurveTo(30, 58, 27, 56, 22, 51)
  ctx.bezierCurveTo(7, 34, 15, 14, 32, 5)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(32, 14)
  ctx.quadraticCurveTo(35, 34, 32, 52)
  ctx.stroke()
  ctx.restore()
  return canvas
}

function bloodTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64)
  ctx.save()
  glow(ctx, 6)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(32, 5)
  ctx.bezierCurveTo(45, 25, 48, 34, 44, 45)
  ctx.bezierCurveTo(41, 55, 36, 59, 32, 60)
  ctx.bezierCurveTo(28, 59, 23, 55, 20, 45)
  ctx.bezierCurveTo(16, 34, 19, 25, 32, 5)
  ctx.closePath()
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.beginPath()
  ctx.ellipse(26, 32, 3, 6, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return canvas
}

function bubbleTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64)
  const cx = 32
  const cy = 32
  ctx.save()
  glow(ctx, 5)
  const grad = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 25)
  grad.addColorStop(0, 'rgba(255,255,255,0.12)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.04)')
  grad.addColorStop(1, 'rgba(255,255,255,0.22)')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(cx, cy, 24, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineWidth = 3.2
  ctx.beginPath()
  ctx.arc(cx, cy, 24, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 4.5
  ctx.beginPath()
  ctx.arc(cx, cy, 18, Math.PI * 1.08, Math.PI * 1.55)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.arc(22, 20, 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return canvas
}

function fishTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(64, 64)
  ctx.save()
  glow(ctx, 6)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.ellipse(30, 34, 18, 11, -0.12, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(13, 34)
  ctx.lineTo(2, 23)
  ctx.lineTo(5, 34)
  ctx.lineTo(2, 45)
  ctx.closePath()
  ctx.fill()
  // 背鳍
  ctx.beginPath()
  ctx.moveTo(26, 25)
  ctx.quadraticCurveTo(31, 15, 38, 24)
  ctx.closePath()
  ctx.fill()
  // 眼睛用透明挖空
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(42, 30, 2.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  return canvas
}

function whaleTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(192, 112)
  ctx.save()
  glow(ctx, 7)
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  ctx.beginPath()
  ctx.moveTo(34, 58)
  ctx.bezierCurveTo(46, 26, 92, 18, 138, 33)
  ctx.bezierCurveTo(164, 41, 174, 55, 175, 65)
  ctx.bezierCurveTo(164, 72, 146, 73, 126, 68)
  ctx.bezierCurveTo(108, 63, 90, 62, 72, 67)
  ctx.bezierCurveTo(54, 72, 42, 68, 34, 58)
  ctx.closePath()
  ctx.fill()
  // 尾鳍
  ctx.beginPath()
  ctx.moveTo(38, 58)
  ctx.lineTo(13, 34)
  ctx.lineTo(20, 57)
  ctx.lineTo(11, 80)
  ctx.closePath()
  ctx.fill()
  // 侧鳍
  ctx.beginPath()
  ctx.moveTo(105, 64)
  ctx.bezierCurveTo(100, 85, 84, 94, 74, 91)
  ctx.bezierCurveTo(82, 80, 88, 72, 91, 61)
  ctx.closePath()
  ctx.fill()
  // 腹部纹理
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 5; i++) {
    ctx.beginPath()
    ctx.moveTo(68 + i * 15, 64)
    ctx.quadraticCurveTo(76 + i * 15, 70, 84 + i * 15, 65)
    ctx.stroke()
  }
  ctx.restore()
  return canvas
}

function hexTexture(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(128, 128)
  const cx = 64
  const cy = 64
  ctx.save()
  glow(ctx, 6)
  for (const r of [56, 48]) {
    ctx.strokeStyle = r === 56 ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)'
    ctx.lineWidth = r === 56 ? 3 : 1.4
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.stroke()
  }
  // 六条守御刻线
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1.2
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * 32, cy + Math.sin(a) * 32)
    ctx.lineTo(cx + Math.cos(a) * 47, cy + Math.sin(a) * 47)
    ctx.stroke()
  }
  ctx.restore()
  return canvas
}

function draw(kind: FxTextureKind): HTMLCanvasElement {
  switch (kind) {
    case 'note':
      return noteTexture()
    case 'slash':
      return slashTexture()
    case 'bladeLine':
      return bladeLineTexture()
    case 'staff':
      return staffTexture()
    case 'ring':
      return ringTexture()
    case 'petal':
      return petalTexture()
    case 'blood':
      return bloodTexture()
    case 'bubble':
      return bubbleTexture()
    case 'fish':
      return fishTexture()
    case 'whale':
      return whaleTexture()
    case 'hex':
      return hexTexture()
  }
}

export function fxTexture(kind: FxTextureKind): THREE.CanvasTexture {
  const hit = cache.get(kind)
  if (hit) return hit
  const tex = new THREE.CanvasTexture(draw(kind))
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  cache.set(kind, tex)
  return tex
}
