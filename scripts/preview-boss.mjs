/**
 * Boss 三态视觉离线预览：
 *   node scripts/preview-boss.mjs
 * 输出：shots/boss-phases.png（3 行 × 3 列：king / warlord / witch × 一阶段 / 二阶段 / 狂暴）
 * 验证：
 * - phase2 时身体色调偏移（金 / 橙 / 紫）+ 脚下持续旋转暗色光环
 * - setEnraged() 幂等 + 红色高频脉冲光环 + 周身火星上浮 + 视觉抖动/前倾
 */
import { register } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import zlib from 'node:zlib'
import * as THREE from 'three'

// 为 headless Node 提供最小 Canvas/Image stub，让 sprites.ts 可正常初始化
function makeFakeCanvas(w = 64, h = 64) {
  return {
    width: w,
    height: h,
    getContext() {
      return {
        imageSmoothingEnabled: false,
        fillStyle: '#fff',
        strokeStyle: '#fff',
        lineWidth: 1,
        globalAlpha: 1,
        clearRect() {},
        fillRect() {},
        strokeRect() {},
        beginPath() {},
        arc() {},
        ellipse() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        fill() {},
        stroke() {},
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        scale() {},
        drawImage() {},
        createRadialGradient() {
          return { addColorStop() {} }
        },
        createLinearGradient() {
          return { addColorStop() {} }
        },
        createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
        getImageData: () => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData() {},
      }
    },
  }
}
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeFakeCanvas()
    return {}
  },
}
globalThis.Image = class FakeImage {
  set src(_v) {}
}

const loaderSource = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(specifier, context, nextResolve) {
  if (/\\.(png|wav|mp3|ogg|webp)$/i.test(specifier)) {
    return { url: 'data:text/javascript,export default ""', shortCircuit: true }
  }
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

const { GoblinKing } = await import('../src/entities/boss.ts')

const KINDS = ['king', 'warlord', 'witch']
const CELL_W = 220
const CELL_H = 190
const COLS = 3
const ROWS = 3
const GAP = 10
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

function drawEllipse(cx, cy, rx, ry, r, g, b, a = 255) {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y += 1) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x += 1) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) setPx(x, y, r, g, b, a)
    }
  }
}

function drawAuraFromMesh(cx, cy, auraMesh) {
  if (!auraMesh.visible) return
  const tex = auraMesh.material.map
  const { width, height, data } = tex.image
  const col = auraMesh.material.color
  const op = auraMesh.material.opacity
  const rx = auraMesh.scale.x * 18
  const ry = auraMesh.scale.x * 10.5
  const rot = auraMesh.rotation.z
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy += 1) {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx += 1) {
      const ux = dx / rx
      const uy = dy / ry
      if (ux * ux + uy * uy > 1) continue
      const rxu = ux * cos - uy * sin
      const ryu = ux * sin + uy * cos
      const tx = Math.floor((rxu * 0.5 + 0.5) * width)
      const ty = Math.floor((ryu * 0.5 + 0.5) * height)
      if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue
      const ti = (ty * width + tx) * 4
      const ta = (data[ti + 3] / 255) * op
      if (ta < 0.02) continue
      const shade = data[ti] / 255
      setPx(cx + dx, cy + dy, col.r * 255 * shade, col.g * 255 * shade, col.b * 255 * shade, Math.round(ta * 255))
    }
  }
}

function drawBossSilhouette(cx, cy, kind, tintCol, tilt, offsetX, offsetY) {
  const bx = cx + offsetX * 65
  const by = cy - 42 - offsetY * 55
  const baseBody = kind === 'witch' ? [132, 118, 178] : kind === 'warlord' ? [168, 134, 108] : [130, 176, 118]
  const tr = Math.min(255, baseBody[0] * tintCol.r)
  const tg = Math.min(255, baseBody[1] * tintCol.g)
  const tb = Math.min(255, baseBody[2] * tintCol.b)
  // 简易像素剪影（体现王冠/双角/巫帽 + 实时色调偏移 + 狂暴前倾）
  const cos = Math.cos(tilt)
  const sin = Math.sin(tilt)
  const put = (lx, ly, r, g, b, rad = 3.2) => {
    const rx = lx * cos - ly * sin
    const ry = lx * sin + ly * cos
    drawDisk(bx + rx, by + ry, rad, r, g, b, 255)
  }
  // 躯干
  for (let y = -10; y <= 26; y += 3) {
    const w = 22 - Math.abs(y - 8) * 0.35
    for (let x = -w; x <= w; x += 3) put(x, y, tr, tg, tb, 2.8)
  }
  // 头部
  for (let y = -34; y <= -12; y += 3) {
    const w = 15 - Math.abs(y + 23) * 0.3
    for (let x = -w; x <= w; x += 3) put(x, y, Math.min(255, tr * 1.08), Math.min(255, tg * 1.08), Math.min(255, tb * 1.08), 2.8)
  }
  // 眼睛
  put(-6, -22, 255, 228, 110, 2.5)
  put(6, -22, 255, 228, 110, 2.5)
  // 头饰分化
  if (kind === 'king') {
    for (let x = -12; x <= 12; x += 4) put(x, -38 - (Math.abs(x) % 8 === 0 ? 5 : 0), 255, 212, 82, 2.8)
  } else if (kind === 'warlord') {
    put(-16, -38, 232, 222, 200, 3.2)
    put(-20, -45, 245, 235, 215, 2.5)
    put(16, -38, 232, 222, 200, 3.2)
    put(20, -45, 245, 235, 215, 2.5)
  } else {
    for (let h = 0; h < 20; h += 3) {
      const w = 16 - h * 0.72
      for (let x = -w; x <= w; x += 3) put(x, -36 - h, 148, 86, 220, 2.6)
    }
  }
}

// 背景
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) setPx(x, y, 14, 17, 24, 255)
}

const scene = new THREE.Scene()
const noop = { onSlam() {}, onSummon() {}, onRoar() {} }

KINDS.forEach((kind, row) => {
  const states = ['phase1', 'phase2', 'enraged']
  states.forEach((mode, col) => {
    const ox = PAD + col * (CELL_W + GAP)
    const oy = PAD + row * (CELL_H + GAP)
    for (let y = oy; y < oy + CELL_H; y += 1) {
      for (let x = ox; x < ox + CELL_W; x += 1) {
        const border = x === ox || x === ox + CELL_W - 1 || y === oy || y === oy + CELL_H - 1
        setPx(x, y, border ? 56 : 21, border ? 68 : 26, border ? 92 : 37, 255)
      }
    }
    const cx = ox + CELL_W / 2
    const cy = oy + CELL_H - 44

    const boss = new GoblinKing(scene, 0, 0, noop, kind)
    if (mode === 'phase2' || mode === 'enraged') {
      boss.hp = boss.maxHp * 0.45
    }
    if (mode === 'enraged') {
      boss.setEnraged()
      boss.setEnraged() // 验证幂等
    }
    for (let step = 0; step < 18; step += 1) {
      boss.update(0.05, 0, 12)
    }

    // 地面阴影
    drawEllipse(cx, cy, 42, 20, 8, 10, 15, 175)

    // 从真实 THREE.Group 中取出光环、精灵、火星合批进行投影渲染
    const [sprite, _shadow, auraRing, embers] = boss.group.children
    drawAuraFromMesh(cx, cy, auraRing)
    drawBossSilhouette(cx, cy, kind, sprite.material.color, sprite.rotation.z, sprite.position.x, sprite.position.y)

    if (embers.visible) {
      const m = new THREE.Matrix4()
      const pos = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const sc = new THREE.Vector3()
      const ec = new THREE.Color()
      for (let i = 0; i < embers.count; i += 1) {
        embers.getMatrixAt(i, m)
        m.decompose(pos, q, sc)
        embers.getColorAt(i, ec)
        const px = cx + pos.x * 36
        const py = cy + pos.z * 18 - pos.y * 28
        drawDisk(px, py, Math.max(2, sc.x * 3.8), ec.r * 255, ec.g * 255, ec.b * 255, 225)
        drawDisk(px, py, Math.max(1, sc.x * 1.6), 255, 245, 210, 210)
      }
    }

    boss.dispose()
  })
})

// PNG 编码
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
writeFileSync('shots/boss-phases.png', png)
console.log(`wrote shots/boss-phases.png (${W}x${H})`)
