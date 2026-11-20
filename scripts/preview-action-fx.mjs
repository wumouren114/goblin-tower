/**
 * 4 个动作特效离线预览（2×2 四宫格）：
 *   node scripts/preview-action-fx.mjs
 * 输出：shots/action-fx.png
 *   左上：fxExecute      右上：fxBlockParry
 *   左下：fxWatergun     右下：fxComboBurst
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

const { fxExecute, fxBlockParry, fxWatergun, fxComboBurst } = await import('../src/systems/characterFx.ts')

const CELL_W = 280
const CELL_H = 220
const COLS = 2
const ROWS = 2
const GAP = 12
const PAD = 14
const W = PAD * 2 + CELL_W * COLS + GAP * (COLS - 1)
const H = PAD * 2 + CELL_H * ROWS + GAP * (ROWS - 1)
const buf = Buffer.alloc(W * H * 4)

function setPx(x, y, r, g, b, a = 255) {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || ix >= W || iy < 0 || iy >= H) return
  const idx = (iy * W + ix) * 4
  if (a >= 255) {
    buf[idx] = Math.max(0, Math.min(255, Math.round(r)))
    buf[idx + 1] = Math.max(0, Math.min(255, Math.round(g)))
    buf[idx + 2] = Math.max(0, Math.min(255, Math.round(b)))
    buf[idx + 3] = 255
  } else {
    const k = Math.max(0, Math.min(1, a / 255))
    buf[idx] = Math.round(buf[idx] * (1 - k) + Math.max(0, Math.min(255, r)) * k)
    buf[idx + 1] = Math.round(buf[idx + 1] * (1 - k) + Math.max(0, Math.min(255, g)) * k)
    buf[idx + 2] = Math.round(buf[idx + 2] * (1 - k) + Math.max(0, Math.min(255, b)) * k)
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
  const steps = Math.max(56, Math.ceil(Math.max(rx, ry) * 6))
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
        setPx(cx + dx, cy + dy, core ? 255 : r, core ? 248 : g, core ? 210 : b, a)
      }
    }
  }
}

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
  return [ox + CELL_W / 2, oy + CELL_H / 2 + 24]
}

function proj(cx, cy, wx, wy, wz, scale = 36) {
  return [cx + wx * scale, cy + wz * scale * 0.55 - wy * scale * 0.88]
}

const scene = new THREE.Scene()

function verifyAutoCleanup(fx, name) {
  let alive = true
  let guard = 0
  while (alive && guard < 2000) {
    alive = fx.update(0.05)
    guard += 1
  }
  if (scene.children.includes(fx.group)) {
    throw new Error(`${name} 播放完毕未从 scene 移除`)
  }
}

// 1. fxExecute（赤红竖斩光 + 金色碎片四散）
{
  const [cx, cy] = cellOrigin(0, 0)
  const fx = fxExecute(scene, 0, 0)
  fx.update(0.13)
  const [blade, core, ring, ...shards] = fx.group.children
  drawRing(cx, cy, ring.scale.x * 32, ring.scale.x * 17, 4, 255, 59, 82, Math.round(ring.material.opacity * 230))
  const [bx, by] = proj(cx, cy, blade.position.x, blade.position.y, blade.position.z, 34)
  drawLine(bx - 12, by - 66, bx + 12, by + 60, 12, 230, 30, 54, Math.round(blade.material.opacity * 220))
  drawLine(bx - 11, by - 64, bx + 11, by + 58, 4.5, 255, 233, 181, Math.round(core.material.opacity * 255))
  for (const s of shards) {
    const [px, py] = proj(cx, cy, s.position.x, s.position.y, s.position.z, 34)
    const c = s.material.color
    drawDiamond(px, py, Math.max(3.5, s.scale.x * 26), c.r * 255, c.g * 255, c.b * 255, Math.round(s.material.opacity * 255))
  }
  verifyAutoCleanup(fx, 'fxExecute')
}

// 2. fxBlockParry（青白盾面碎裂 + 指向攻击者残影拖尾）
{
  const [cx, cy] = cellOrigin(1, 0)
  drawDisk(cx - 48, cy + 4, 11, 210, 82, 108, 190) // 玩家位置示意
  drawDisk(cx + 68, cy - 18, 10, 110, 122, 148, 150) // 攻击者方向示意
  const fx = fxBlockParry(scene, 0, 0, 4, -1.2)
  fx.update(0.12)
  for (const child of fx.group.children) {
    const [px, py] = proj(cx - 48, cy + 28, child.position.x, child.position.y, child.position.z, 34)
    const c = child.material.color
    const a = Math.round(child.material.opacity * 255)
    if (child.geometry.parameters?.height > 0.5) {
      drawLine(px - 14, py + 4, px + 16, py - 4, 5.5, c.r * 255, c.g * 255, c.b * 255, a)
    } else {
      drawDiamond(px, py, 5.5, c.r * 255, c.g * 255, c.b * 255, a)
    }
  }
  verifyAutoCleanup(fx, 'fxBlockParry')
}

// 3. fxWatergun（扇形青蓝水幕 + 流动喷射水柱粒子）
{
  const [cx, cy] = cellOrigin(0, 1)
  const ox = cx - 95
  const oy = cy + 8
  drawDisk(ox, oy, 11, 110, 210, 255, 220) // 鱼位置示意
  const fx = fxWatergun(scene, 0, 0, 1, -0.18, 2.0)
  fx.update(0.35)
  const fans = fx.group.children.slice(0, 3)
  const drops = fx.group.children.slice(3)
  for (const f of fans) {
    const [px, py] = proj(ox, oy + 18, f.position.x, f.position.y, f.position.z, 34)
    const c = f.material.color
    drawLine(ox + 10, oy - 4, px + (px - ox) * 0.85, py + (py - oy) * 0.75, 16, c.r * 255, c.g * 255, c.b * 255, Math.round(f.material.opacity * 200))
  }
  for (const d of drops) {
    const [px, py] = proj(ox, oy + 18, d.position.x, d.position.y, d.position.z, 34)
    const c = d.material.color
    drawLine(px - 7, py + 1.2, px + 7, py - 1.2, 3.8, c.r * 255, c.g * 255, c.b * 255, Math.round(d.material.opacity * 255))
  }
  verifyAutoCleanup(fx, 'fxWatergun')
}

// 4. fxComboBurst（60 连击金色环爆 + 星点上冲）
{
  const [cx, cy] = cellOrigin(1, 1)
  const fx = fxComboBurst(scene, 0, 0)
  fx.update(0.18)
  const [outer, inner, ...stars] = fx.group.children
  drawRing(cx, cy + 12, outer.scale.x * 32, outer.scale.x * 17, 5, 255, 212, 121, Math.round(outer.material.opacity * 245))
  drawRing(cx, cy + 12, inner.scale.x * 32, inner.scale.x * 17, 4, 255, 243, 196, Math.round(inner.material.opacity * 245))
  for (const s of stars) {
    const [px, py] = proj(cx, cy + 12, s.position.x, s.position.y, s.position.z, 34)
    const c = s.material.color
    drawDiamond(px, py, Math.max(4, s.scale.x * 26), c.r * 255, c.g * 255, c.b * 255, Math.round(s.material.opacity * 255))
  }
  verifyAutoCleanup(fx, 'fxComboBurst')
}

const crcTable = new Int32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  crcTable[n] = c
}
function crc32(b) {
  let c = -1
  for (let i = 0; i < b.length; i += 1) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const head = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head, data])), 0)
  return Buffer.concat([len, head, data, crc])
}
const raw = Buffer.alloc(H * (W * 4 + 1))
for (let y = 0; y < H; y += 1) {
  raw[y * (W * 4 + 1)] = 0
  buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
mkdirSync('shots', { recursive: true })
writeFileSync('shots/action-fx.png', png)
console.log(`wrote shots/action-fx.png (${W}x${H}), scene children remaining: ${scene.children.length}`)
