/**
 * 潜能系统 6 个独立特效离线预览：
 *   node scripts/preview-fx.mjs
 * 输出：shots/potential-fx.png（3×2 六宫格，深色背景，每格渲染对应特效的一帧实机状态）
 *   1. fxBloodTick      2. fxMarkStack (3层)   3. fxBlockShield
 *   4. fxRecallWater    5. fxStrongBeat        6. fxResonanceBadge (三组配色)
 */
import { register } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import * as THREE from 'three'

const loaderSource = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && context.parentURL && !/\\.[a-z0-9]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '/index.ts']) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`)

const {
  fxBloodTick,
  fxMarkStack,
  fxBlockShield,
  fxRecallWater,
  fxStrongBeat,
  fxResonanceBadge,
  buildResonanceBadgePixels,
} = await import('../src/systems/characterFx.ts')

const CELL_W = 220
const CELL_H = 180
const COLS = 3
const ROWS = 2
const GAP = 10
const PAD = 12
const W = PAD * 2 + CELL_W * COLS + GAP * (COLS - 1)
const H = PAD * 2 + CELL_H * ROWS + GAP * (ROWS - 1)

const buf = Buffer.alloc(W * H * 4)

function setPx(x, y, r, g, b, a = 255) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return
  const idx = (iy * W + ix) * 4
  if (a >= 255) {
    buf[idx] = r
    buf[idx + 1] = g
    buf[idx + 2] = b
    buf[idx + 3] = 255
  } else {
    const k = a / 255
    buf[idx] = Math.round(buf[idx] * (1 - k) + r * k)
    buf[idx + 1] = Math.round(buf[idx + 1] * (1 - k) + g * k)
    buf[idx + 2] = Math.round(buf[idx + 2] * (1 - k) + b * k)
    buf[idx + 3] = 255
  }
}

function drawDisk(px, py, rad, r, g, b, a = 255) {
  const r2 = rad * rad
  for (let y = Math.floor(py - rad - 1); y <= Math.ceil(py + rad + 1); y += 1) {
    for (let x = Math.floor(px - rad - 1); x <= Math.ceil(px + rad + 1); x += 1) {
      if ((x - px) ** 2 + (y - py) ** 2 <= r2) setPx(x, y, r, g, b, a)
    }
  }
}

function drawRing(px, py, rx, ry, thickness, r, g, b, a = 255) {
  const steps = Math.max(48, Math.ceil(Math.max(rx, ry) * 6))
  for (let i = 0; i < steps; i += 1) {
    const ang = (i / steps) * Math.PI * 2
    drawDisk(px + Math.cos(ang) * rx, py + Math.sin(ang) * ry, thickness * 0.5, r, g, b, a)
  }
}

function drawLine(x0, y0, x1, y1, thickness, r, g, b, a = 255) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    drawDisk(x0 + dx * t, y0 + dy * t, thickness * 0.5, r, g, b, a)
  }
}

function drawDiamond(cx, cy, rad, r, g, b, a = 255) {
  for (let dy = -Math.ceil(rad); dy <= Math.ceil(rad); dy += 1) {
    for (let dx = -Math.ceil(rad); dx <= Math.ceil(rad); dx += 1) {
      const d = Math.abs(dx) + Math.abs(dy)
      if (d <= rad) {
        const core = d <= rad * 0.42
        setPx(cx + dx, cy + dy, core ? 255 : r, core ? 242 : g, core ? 185 : b, a)
      }
    }
  }
}

// 背景与 6 格底框
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) setPx(x, y, 14, 17, 24, 255)
}

function cellOrigin(col, row) {
  const ox = PAD + col * (CELL_W + GAP)
  const oy = PAD + row * (CELL_H + GAP)
  for (let y = oy; y < oy + CELL_H; y += 1) {
    for (let x = ox; x < ox + CELL_W; x += 1) {
      const border = x === ox || x === ox + CELL_W - 1 || y === oy || y === oy + CELL_H - 1
      setPx(x, y, border ? 56 : 21, border ? 68 : 26, border ? 92 : 37, 255)
    }
  }
  return [ox + CELL_W / 2, oy + CELL_H / 2 + 12]
}

// 伪 35° 俯视投影（模拟实机视角）
function proj(cx, cy, wx, wy, wz, scale = 34) {
  return [cx + wx * scale, cy + wz * scale * 0.62 - wy * scale * 0.85]
}

const scene = new THREE.Scene()

// 1. fxBloodTick（暗红 2~3 滴贴地溅落）
{
  const [cx, cy] = cellOrigin(0, 0)
  drawRing(cx, cy, 34, 20, 1.5, 66, 76, 98, 120)
  const fx = fxBloodTick(scene, 0, 0)
  fx.update(0.11)
  for (const child of fx.group.children) {
    const mesh = child
    const col = mesh.material.color
    const [px, py] = proj(cx, cy, mesh.position.x, mesh.position.y, mesh.position.z, 90)
    drawDisk(px, py, Math.max(4.5, mesh.scale.x * 78), col.r * 255, col.g * 255, col.b * 255, Math.round(mesh.material.opacity * 255))
    drawDisk(px - 1, py - 1, 1.8, 230, 88, 108, 170)
  }
  fx.dispose()
}

// 2. fxMarkStack（目标头顶 3 枚橙色小菱形）
{
  const [cx, cy] = cellOrigin(1, 0)
  // 目标剪影示意
  drawDisk(cx, cy + 16, 22, 46, 54, 72, 220)
  drawRing(cx, cy + 16, 22, 22, 1.5, 92, 108, 138, 220)
  const fx = fxMarkStack(scene, 0, 0, 3)
  fx.update(0.06)
  for (const child of fx.group.children) {
    const [px, py] = proj(cx, cy + 44, child.position.x, fx.group.position.y + child.position.y, child.position.z, 68)
    drawDiamond(px, py, child.scale.x * 46, 255, 152, 42, Math.round(child.material.opacity * 255))
  }
  fx.dispose()
}

// 3. fxBlockShield（面前弧形青白盾光 + 边缘微抖）
{
  const [cx, cy] = cellOrigin(2, 0)
  drawDisk(cx, cy + 12, 14, 220, 90, 112, 200)
  const fx = fxBlockShield(scene, 0, 0, 0)
  fx.update(0.22)
  // 弧形青白盾光渲染（模拟 100° 弧面）
  for (let i = -24; i <= 24; i += 1) {
    const a = (i / 24) * (Math.PI * 0.28)
    const rx = Math.sin(a) * 58
    const ry = -Math.cos(a) * 32 - 6
    const jitter = Math.sin(i * 1.7) * 2.2
    drawLine(cx + rx, cy + ry - 26, cx + rx, cy + ry + 26, 4.2, 120, 238, 255, 115)
    drawDisk(cx + rx, cy + ry - 26 + jitter, 2.2, 236, 255, 255, 235)
    drawDisk(cx + rx, cy + ry + 26 - jitter, 2.2, 236, 255, 255, 235)
  }
  fx.dispose()
}

// 4. fxRecallWater（5 道青蓝细水线从四周汇向玩家）
{
  const [cx, cy] = cellOrigin(0, 1)
  drawDisk(cx, cy, 10, 140, 240, 255, 220)
  const fx = fxRecallWater(scene, 0, 0, 5)
  fx.update(0.18)
  for (const child of fx.group.children) {
    const pos = child.geometry.getAttribute('position')
    const col = child.material.color
    for (let i = 0; i < pos.count - 1; i += 1) {
      const [x0, y0] = proj(cx, cy, pos.getX(i), pos.getY(i), pos.getZ(i), 30)
      const [x1, y1] = proj(cx, cy, pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1), 30)
      drawLine(x0, y0, x1, y1, 2.4, col.r * 255, col.g * 255, col.b * 255, 230)
    }
  }
  fx.dispose()
}

// 5. fxStrongBeat（脚下双环节拍脉冲）
{
  const [cx, cy] = cellOrigin(1, 1)
  const fx = fxStrongBeat(scene, 0, 0)
  fx.update(0.16)
  const outer = fx.group.children[0]
  const inner = fx.group.children[1]
  drawRing(cx, cy, outer.scale.x * 32, outer.scale.x * 19, 3.6, 159, 216, 255, Math.round(outer.material.opacity * 255))
  drawRing(cx, cy, inner.scale.x * 32, inner.scale.x * 19, 4.4, 255, 212, 121, Math.round(inner.material.opacity * 255))
  drawDisk(cx, cy, 6, 255, 236, 180, 200)
  fx.dispose()
}

// 6. fxResonanceBadge（三组跨枝配色并排预览）
{
  const [cx, cy] = cellOrigin(2, 1)
  const samples = [
    ['murasame', 'murasame-res-bleed-mark'],
    ['fish', 'fish-res-clone-swarm'],
    ['mutsumi', 'mutsumi-res-rhythm-symphony'],
  ]
  const scale = 2
  samples.forEach(([charId, comboId], idx) => {
    const sprite = fxResonanceBadge(scene, charId, comboId)
    const pixels = buildResonanceBadgePixels(charId, comboId)
    const bx = Math.round(cx + (idx - 1) * 66 - 32)
    const by = Math.round(cy - 40)
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const si = (y * 32 + x) * 4
        const a = pixels[si + 3]
        if (a === 0) continue
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            setPx(bx + x * scale + dx, by + y * scale + dy, pixels[si], pixels[si + 1], pixels[si + 2], a)
          }
        }
      }
    }
    sprite.material.dispose()
    scene.remove(sprite)
  })
}

// PNG 编码
const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6

const raw = Buffer.alloc((W * 4 + 1) * H)
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 4 + 1)] = 0
  buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('shots', { recursive: true })
writeFileSync('shots/potential-fx.png', png)
console.log(`wrote shots/potential-fx.png ${W}x${H}（6 项潜能特效，scene 残留子节点=${scene.children.length}）`)
