/**
 * 把 5 类敌人原型的图集渲染成一张 PNG，便于肉眼检查（不参与游戏运行时）。
 *   node scripts/preview-archetypes.mjs
 * 输出：shots/archetypes.png（每行一个原型，4 向 × 4 帧，放大 3 倍）
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

const { buildArchetypeAtlas } = await import('../src/art/characters.ts')

const KINDS = ['ranged', 'blocker', 'charger', 'summoner', 'bomber']
const SCALE = 3
const GAP = 6
const atlases = KINDS.map((k) => ({ kind: k, atlas: buildArchetypeAtlas(k) }))

const cellW = atlases[0].atlas.canvas.width
const cellH = atlases[0].atlas.canvas.height
const outW = cellW * SCALE
const outH = (cellH + GAP) * atlases.length * SCALE

const buf = Buffer.alloc(outW * outH * 4)
// 深色底，方便看清描边
for (let i = 0; i < buf.length; i += 4) {
  buf[i] = 24
  buf[i + 1] = 26
  buf[i + 2] = 32
  buf[i + 3] = 255
}

atlases.forEach((entry, row) => {
  const { canvas } = entry.atlas
  const baseY = row * (cellH + GAP) * SCALE
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const si = (y * canvas.width + x) * 4
      const a = canvas.data[si + 3]
      if (a === 0) continue
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const di = ((baseY + y * SCALE + dy) * outW + (x * SCALE + dx)) * 4
          buf[di] = canvas.data[si]
          buf[di + 1] = canvas.data[si + 1]
          buf[di + 2] = canvas.data[si + 2]
          buf[di + 3] = a
        }
      }
    }
  }
})

/* ---- 极简 PNG 编码 ---- */
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
writeFileSync('shots/archetypes.png', png)
console.log(`wrote shots/archetypes.png ${outW}x${outH}（${KINDS.join(' / ')}）`)
