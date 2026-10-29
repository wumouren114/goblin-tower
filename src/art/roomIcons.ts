import { PixelCanvas } from './pixels'
import type { TunnelRoom } from '../types'

/**
 * 时空隧道路线卡的房间图标：24×24 程序化像素画。
 *
 * 全部由 PixelCanvas 逐像素绘制，浏览器里再转成 Canvas data URL 交给 CSS，
 * 不依赖外部美术资源，也不会因为系统字体/emoji 不同而变样。
 */
export const ROOM_ICON_ROOMS: TunnelRoom[] = [
  'chest',
  'skill-card',
  'merchant',
  'altar',
  'mob-wave',
  'elite-fight',
  'boss',
  'rest',
]

const C = {
  ink: 0x080a0b,
  gold: 0xe8b25a,
  goldHi: 0xffe2a0,
  goldDark: 0x8a5a22,
  teal: 0x46d8c2,
  tealHi: 0xb9fff4,
  red: 0xff5f56,
  redDark: 0x7e211d,
  purple: 0xb46bff,
  purpleDark: 0x4b246e,
  wood: 0x7a4a2a,
  woodDark: 0x3a2416,
  bone: 0xe8dfcf,
  boneDark: 0x8f8474,
  green: 0x7fb84e,
  greenDark: 0x355524,
  fire: 0xff8a3c,
  fireHi: 0xffe08a,
  stone: 0x756a61,
  stoneDark: 0x3d3732,
  white: 0xfff6dd,
}

function chestIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 箱体与拱形箱盖
  p.fillRect(4, 10, 16, 10, C.woodDark)
  p.fillRect(5, 11, 14, 8, C.wood)
  p.fillRect(5, 7, 14, 5, C.wood)
  p.hLine(6, 17, 6, C.goldDark)
  p.hLine(5, 18, 7, C.gold)
  p.hLine(5, 18, 10, C.goldDark)
  // 金属包边
  p.vLine(7, 8, 19, C.gold)
  p.vLine(16, 8, 19, C.gold)
  // 锁扣
  p.fillRect(10, 11, 4, 5, C.goldDark)
  p.fillRect(11, 11, 2, 4, C.gold)
  p.set(12, 13, C.goldHi)
  p.set(11, 14, C.goldHi)
  // 箱脚与高光
  p.fillRect(5, 19, 3, 2, C.goldDark)
  p.fillRect(16, 19, 3, 2, C.goldDark)
  p.set(6, 12, C.goldHi)
  p.set(17, 12, C.goldDark)
  return p
}

function skillCardIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 卡牌底：左上角切角，像一张被翻开的技能卡
  p.fillRect(6, 4, 12, 16, C.white)
  p.fillRect(6, 4, 12, 2, C.teal)
  p.fillRect(6, 18, 12, 2, C.teal)
  p.vLine(6, 4, 20, C.teal)
  p.vLine(17, 4, 20, C.teal)
  p.fillRect(7, 6, 10, 12, 0x241b2e)
  // 紫色菱形符文
  p.triangle(12, 7, 7, 12, 12, 17, C.purpleDark)
  p.triangle(12, 7, 17, 12, 12, 17, C.purple)
  p.set(11, 10, C.white)
  p.set(12, 9, C.white)
  // 四角小刻度
  for (const [x, y] of [
    [8, 7],
    [15, 7],
    [8, 16],
    [15, 16],
  ]) {
    p.set(x, y, C.tealHi)
  }
  return p
}

function merchantIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 兜帽与肩部
  p.ellipse(12, 11, 8, 8, C.woodDark)
  p.ellipse(12, 10, 7, 7, C.wood)
  p.fillRect(4, 15, 16, 6, C.woodDark)
  p.hLine(5, 18, 15, C.goldDark)
  // 帽檐下的暗脸与金色眼睛
  p.ellipse(12, 12, 5, 5, 0x120d0b)
  p.fillRect(9, 11, 2, 2, C.gold)
  p.fillRect(14, 11, 2, 2, C.gold)
  p.set(10, 11, C.goldHi)
  p.set(15, 11, C.goldHi)
  // 一只手托着金币
  p.fillRect(16, 16, 3, 3, C.wood)
  p.circle(19, 16, 3, C.goldDark)
  p.circle(19, 16, 2, C.gold)
  p.set(18, 15, C.goldHi)
  // 帽尖与钱袋绳结
  p.set(5, 6, C.goldDark)
  p.set(4, 7, C.gold)
  p.set(7, 20, C.goldDark)
  return p
}

function altarIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 三层石台
  p.fillRect(3, 18, 18, 3, C.stoneDark)
  p.fillRect(5, 15, 14, 3, C.stone)
  p.fillRect(7, 12, 10, 3, C.stoneDark)
  p.hLine(3, 20, 18, C.goldDark)
  // 两侧小石柱
  p.fillRect(4, 10, 3, 8, C.stone)
  p.fillRect(17, 10, 3, 8, C.stone)
  p.set(4, 10, C.goldDark)
  p.set(19, 10, C.goldDark)
  // 悬浮法球
  p.circle(12, 8, 5, C.purpleDark)
  p.circle(12, 8, 4, C.purple)
  p.circle(12, 8, 2, 0x5c2d8e)
  p.set(11, 6, C.white)
  p.set(13, 9, C.tealHi)
  // 法球上下的刻线
  p.set(12, 1, C.purple)
  p.set(12, 2, C.purpleDark)
  p.set(12, 14, C.purpleDark)
  p.set(8, 8, C.purpleDark)
  p.set(16, 8, C.purpleDark)
  return p
}

function goblinHead(p: PixelCanvas, cx: number, cy: number, scale = 1): void {
  const rx = Math.max(2, Math.round(3 * scale))
  const ry = Math.max(2, Math.round(3.4 * scale))
  // 尖耳
  p.triangle(cx - rx, cy - 1, cx - rx - 3, cy - 4, cx - rx + 1, cy - 3, C.greenDark)
  p.triangle(cx + rx, cy - 1, cx + rx + 3, cy - 4, cx + rx - 1, cy - 3, C.greenDark)
  p.ellipse(cx, cy, rx, ry, C.green)
  p.hLine(cx - rx, cx + rx, cy - ry + 1, C.greenDark)
  // 眼睛与獠牙
  p.set(cx - 2, cy, C.fireHi)
  p.set(cx + 2, cy, C.fireHi)
  p.set(cx - 1, cy + 2, C.bone)
  p.set(cx + 1, cy + 2, C.bone)
}

function mobWaveIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 后排两只小怪 + 前排一只，形成“怪潮”层次
  goblinHead(p, 5, 12, 0.82)
  goblinHead(p, 19, 12, 0.82)
  goblinHead(p, 12, 10, 1.15)
  // 前排小怪的身体
  p.fillRect(7, 15, 10, 5, C.greenDark)
  p.fillRect(8, 15, 8, 3, C.green)
  p.hLine(8, 15, 15, C.goldDark)
  // 地面尘线
  p.hLine(2, 21, 21, C.stoneDark)
  p.set(3, 20, C.stone)
  p.set(20, 20, C.stone)
  return p
}

function eliteFightIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 弯角
  p.triangle(4, 2, 9, 8, 4, 9, C.boneDark)
  p.triangle(20, 2, 15, 8, 20, 9, C.boneDark)
  p.triangle(5, 3, 8, 8, 5, 8, C.bone)
  p.triangle(19, 3, 16, 8, 19, 8, C.bone)
  // 头骨
  p.ellipse(12, 11, 7, 7, C.boneDark)
  p.ellipse(12, 10, 6, 6, C.bone)
  p.fillRect(8, 14, 8, 5, C.bone)
  // 眼窝与红光
  p.fillRect(8, 9, 3, 3, 0x160b0a)
  p.fillRect(13, 9, 3, 3, 0x160b0a)
  p.set(9, 10, C.red)
  p.set(14, 10, C.red)
  p.set(9, 11, C.redDark)
  p.set(14, 11, C.redDark)
  // 鼻腔与牙齿
  p.set(12, 13, 0x2a1712)
  p.set(11, 14, 0x2a1712)
  p.vLine(9, 16, 18, C.boneDark)
  p.vLine(12, 16, 18, C.boneDark)
  p.vLine(15, 16, 18, C.boneDark)
  // 肩甲碎片
  p.fillRect(2, 18, 4, 3, C.stoneDark)
  p.fillRect(18, 18, 4, 3, C.stoneDark)
  return p
}

function bossIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 底座阴影
  p.fillRect(4, 19, 16, 3, C.purpleDark)
  // 冠体
  p.fillRect(4, 13, 16, 6, C.goldDark)
  p.fillRect(5, 14, 14, 4, C.gold)
  p.hLine(5, 18, 18, C.goldDark)
  // 三个冠尖
  p.triangle(4, 13, 7, 4, 10, 13, C.gold)
  p.triangle(9, 13, 12, 2, 15, 13, C.gold)
  p.triangle(14, 13, 17, 4, 20, 13, C.gold)
  p.set(7, 6, C.goldHi)
  p.set(12, 4, C.goldHi)
  p.set(17, 6, C.goldHi)
  // 中央红宝石
  p.triangle(12, 8, 9, 12, 12, 16, C.redDark)
  p.triangle(12, 8, 15, 12, 12, 16, C.red)
  p.set(12, 10, C.white)
  // 冠沿的圆钉
  for (const x of [6, 10, 14, 18]) p.set(x, 16, C.goldHi)
  return p
}

function restIcon(): PixelCanvas {
  const p = new PixelCanvas(24, 24)
  // 交叠木柴
  p.line(4, 21, 20, 16, C.woodDark)
  p.line(4, 16, 20, 21, C.woodDark)
  p.line(5, 20, 19, 15, C.wood)
  p.line(5, 15, 19, 20, C.wood)
  // 火焰外焰/内焰/焰心
  p.triangle(12, 3, 6, 14, 18, 14, C.fire)
  p.triangle(12, 3, 8, 12, 16, 12, C.fireHi)
  p.triangle(12, 7, 10, 12, 14, 12, C.white)
  p.set(12, 9, 0xfff6d0)
  // 火星
  p.set(5, 8, C.fire)
  p.set(18, 6, C.fireHi)
  p.set(8, 4, C.fire)
  // 地面暖光
  p.hLine(3, 20, 22, C.goldDark)
  p.set(2, 21, C.gold)
  p.set(21, 21, C.gold)
  return p
}

const DRAWERS: Record<TunnelRoom, () => PixelCanvas> = {
  chest: chestIcon,
  'skill-card': skillCardIcon,
  merchant: merchantIcon,
  altar: altarIcon,
  'mob-wave': mobWaveIcon,
  'elite-fight': eliteFightIcon,
  boss: bossIcon,
  rest: restIcon,
}

/** 纯像素数据版本（无 DOM，Node 冒烟测试可直接断言） */
export function drawRoomIcon(room: TunnelRoom): PixelCanvas {
  const cell = (DRAWERS[room] ?? chestIcon)()
  cell.outline(C.ink)
  return cell
}

const urlCache = new Map<TunnelRoom, string>()

/** 房间图标 → Canvas data URL（仅浏览器/HUD 调用，按房间缓存） */
export function roomIconDataUrl(room: TunnelRoom): string {
  const hit = urlCache.get(room)
  if (hit) return hit
  const cell = drawRoomIcon(room)
  const canvas = document.createElement('canvas')
  canvas.width = cell.width
  canvas.height = cell.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(cell.width, cell.height)
  img.data.set(cell.data)
  ctx.putImageData(img, 0, 0)
  const url = canvas.toDataURL('image/png')
  urlCache.set(room, url)
  return url
}
