/**
 * 把三种新增房间 NPC（trial 立约者 / altar 祭坛化身 / minigame 塔的执秤人）
 * 渲染成一张 PNG，便于肉眼检查剪影与细节：
 *   node scripts/preview-npc.mjs
 * 输出：shots/npc.png（3 格横向排列，4 倍放大，深色背景）
 */
import { register } from 'node:module'
import { writeFileSync, mkdirSync } from 'node:fs'
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

const { drawNpcCell } = await import('../src/entities/roomNpc.ts')

const KINDS = ['trial', 'altar', 'minigame']
const SCALE = 4
const PAD = 6
const GAP = 10

const cells = KINDS.map((kind) => ({ kind, canvas: drawNpcCell(kind) }))
const cellW = cells[0].canvas.width
const cellH = cells[0].canvas.height
const outW = (PAD * 2 + cellW * cells.length + GAP * (cells.length - 1)) * SCALE
const outH = (PAD * 2 + cellH) * SCALE
const buf = Buffer.alloc(outW * outH * 4)

for (let i = 0; i < buf.length; i += 4) {
  buf[i] = 20
  buf[i + 1] = 22
  buf[i + 2] = 30
  buf[i + 3] = 255
}

cells.forEach(({ canvas }, idx) => {
  const baseX = (PAD + idx * (cellW + GAP)) * SCALE
  const baseY = PAD * SCALE
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const si = (y * canvas.width + x) * 4
      const a = canvas.data[si + 3]
      if (a === 0) continue
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const di = ((baseY + y * SCALE + dy) * outW + (baseX + x * SCALE + dx)) * 4
          buf[di] = canvas.data[si]
          buf[di + 1] = canvas.data[si + 1]
          buf[di + 2] = canvas.data[si + 2]
          buf[di + 3] = a
        }
      }
    }
  }
})

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
ihdr.writeUInt32BE(outW, 0)
ihdr.writeUInt32BE(outH, 4)
ihdr[8] = 8
ihdr[9] = 6

const raw = Buffer.alloc((outW * 4 + 1) * outH)
for (let y = 0; y < outH; y += 1) {
  raw[y * (outW * 4 + 1)] = 0
  buf.copy(raw, y * (outW * 4 + 1) + 1, y * outW * 4, (y + 1) * outW * 4)
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('shots', { recursive: true })
writeFileSync('shots/npc.png', png)
console.log(`wrote shots/npc.png ${outW}x${outH}（${KINDS.join(' / ')}）`)
