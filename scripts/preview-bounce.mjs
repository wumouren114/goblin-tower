/**
 * 弹道撞障碍反射（交响·折射）离线可视化预览：
 *   node scripts/preview-bounce.mjs
 * 输出：shots/bounce.png（深色背景，3 个障碍圆 + 6 条弹道，覆盖垂直正碰 / 45° 斜碰 / 掠过不反射）
 */
import { register } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'

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

const { reflectOffObstacle } = await import('../src/systems/bounce.ts')

const W = 720
const H = 480
const SCALE = 38 // px per world unit
const CX = W / 2
const CY = H / 2

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

function toPx(wx, wz) {
  return [CX + wx * SCALE, CY + wz * SCALE]
}

function drawDisk(px, py, rad, r, g, b, a = 255) {
  const r2 = rad * rad
  const x0 = Math.floor(px - rad - 1)
  const x1 = Math.ceil(px + rad + 1)
  const y0 = Math.floor(py - rad - 1)
  const y1 = Math.ceil(py + rad + 1)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - px
      const dy = y - py
      if (dx * dx + dy * dy <= r2) setPx(x, y, r, g, b, a)
    }
  }
}

function drawRing(px, py, rad, thickness, r, g, b, a = 255) {
  const ro2 = (rad + thickness * 0.5) ** 2
  const ri2 = Math.max(0, rad - thickness * 0.5) ** 2
  const x0 = Math.floor(px - rad - thickness - 1)
  const x1 = Math.ceil(px + rad + thickness + 1)
  const y0 = Math.floor(py - rad - thickness - 1)
  const y1 = Math.ceil(py + rad + thickness + 1)
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d2 = (x - px) ** 2 + (y - py) ** 2
      if (d2 <= ro2 && d2 >= ri2) setPx(x, y, r, g, b, a)
    }
  }
}

function drawLine(x0, y0, x1, y1, thickness, r, g, b, a = 255) {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2))
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const x = x0 + dx * t
    const y = y0 + dy * t
    if (thickness <= 1) setPx(x, y, r, g, b, a)
    else drawDisk(x, y, thickness * 0.5, r, g, b, a)
  }
}

// 1. 深色背景 + 细网格
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    setPx(x, y, 16, 20, 29, 255)
  }
}
for (let gx = -9; gx <= 9; gx += 1) {
  const [px] = toPx(gx, 0)
  drawLine(px, 0, px, H - 1, 1, 26, 33, 46, 255)
}
for (let gz = -6; gz <= 6; gz += 1) {
  const [, py] = toPx(0, gz)
  drawLine(0, py, W - 1, py, 1, 26, 33, 46, 255)
}

// 2. 3 个圆形障碍
const obstacles = [
  { x: -4.2, z: -1.8, r: 1.05 },
  { x: 0.3, z: 1.3, r: 1.2 },
  { x: 4.5, z: -1.2, r: 1.1 },
]

for (const ob of obstacles) {
  const [px, py] = toPx(ob.x, ob.z)
  // 判定外圈 r + 0.25（虚感淡圈）
  drawRing(px, py, (ob.r + 0.25) * SCALE, 1.4, 72, 96, 128, 120)
  // 实体圆 + 亮描边
  drawDisk(px, py, ob.r * SCALE, 38, 49, 68, 255)
  drawRing(px, py, ob.r * SCALE, 2.2, 132, 168, 214, 255)
  // 圆心十字
  drawLine(px - 4, py, px + 4, py, 1, 132, 168, 214, 180)
  drawLine(px, py - 4, px, py + 4, 1, 132, 168, 214, 180)
}

// 3. 6 条弹道（垂直正碰 / 45° 斜碰 / 双反弹 / 掠过不反射）
const rays = [
  // 1) 垂直正碰 ob1
  { name: 'head-on', x: -8.6, z: -1.8, dirX: 1, dirZ: 0, wallBounce: 1, range: 11, bright: [96, 240, 255], dim: [42, 118, 138] },
  // 2) 45° 斜碰 ob1 左下缘
  { name: 'oblique-45-a', x: -8.2, z: 1.35, dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2, wallBounce: 1, range: 12, bright: [255, 214, 102], dim: [142, 108, 42] },
  // 3) 45° 斜碰 ob2 → 二次折返 ob3
  { name: 'double-bounce', x: -3.2, z: 4.9, dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2, wallBounce: 2, range: 16, bright: [232, 132, 255], dim: [118, 66, 148] },
  // 4) 45° 斜碰 ob2 右下缘
  { name: 'oblique-45-b', x: 3.9, z: 5.1, dirX: -Math.SQRT1_2, dirZ: -Math.SQRT1_2, wallBounce: 1, range: 12, bright: [146, 244, 132], dim: [64, 128, 62] },
  // 5) 掠过不反射（距 ob3 边缘略大于 r+0.25）
  { name: 'graze-miss-a', x: 0.4, z: -3.45, dirX: 0.996, dirZ: 0.087, wallBounce: 1, range: 9.2, bright: [255, 128, 112], dim: [140, 64, 58] },
  // 6) 掠过不反射（离开 ob3 方向，dot >= 0）
  { name: 'graze-away-b', x: 5.75, z: -1.65, dirX: 0.94, dirZ: 0.34, wallBounce: 1, range: 4.0, bright: [148, 194, 255], dim: [72, 98, 138] },
]

const bouncePoints = []
const stepLen = 0.04

for (const ray of rays) {
  const norm = Math.hypot(ray.dirX, ray.dirZ)
  let x = ray.x
  let z = ray.z
  let dirX = ray.dirX / norm
  let dirZ = ray.dirZ / norm
  let wallBounce = ray.wallBounce
  let bounced = 0
  let traveled = 0

  const [sx, sy] = toPx(x, z)
  drawDisk(sx, sy, 3.6, ray.bright[0], ray.bright[1], ray.bright[2], 255)

  while (traveled < ray.range) {
    const nx = x + dirX * stepLen
    const nz = z + dirZ * stepLen
    traveled += stepLen

    const [p0x, p0y] = toPx(x, z)
    const [p1x, p1y] = toPx(nx, nz)
    const col = bounced === 0 ? ray.bright : ray.dim
    drawLine(p0x, p0y, p1x, p1y, bounced === 0 ? 2.6 : 2.0, col[0], col[1], col[2], 255)

    x = nx
    z = nz

    if (wallBounce > 0) {
      for (const ob of obstacles) {
        const hit = reflectOffObstacle(dirX, dirZ, x, z, ob)
        if (!hit) continue
        bouncePoints.push({ x, z, ob })
        dirX = hit.dirX
        dirZ = hit.dirZ
        x = hit.x
        z = hit.z
        wallBounce -= 1
        bounced += 1
        break
      }
    }
  }
}

// 4. 反射点标记（亮白内核 + 金色外圈 + 法线短线）
for (const bp of bouncePoints) {
  const [px, py] = toPx(bp.x, bp.z)
  const dx = bp.x - bp.ob.x
  const dz = bp.z - bp.ob.z
  const d = Math.hypot(dx, dz) || 1
  const [nx2, ny2] = toPx(bp.x + (dx / d) * 0.55, bp.z + (dz / d) * 0.55)
  drawLine(px, py, nx2, ny2, 1.5, 255, 232, 150, 220)
  drawRing(px, py, 6.2, 2.0, 255, 212, 102, 255)
  drawDisk(px, py, 3.0, 255, 255, 255, 255)
}

// 5. PNG 编码（zlib + CRC32，零依赖）
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
writeFileSync('shots/bounce.png', png)
console.log(`wrote shots/bounce.png ${W}x${H}（${obstacles.length} 障碍 / ${rays.length} 弹道 / ${bouncePoints.length} 反射点）`)
