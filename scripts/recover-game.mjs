// 从 DSH 会话记录（多帧 zstd jsonl）恢复被 PowerShell 编码损坏的 src/game.ts
// 会话日志把每个 tool-call 的完整 arguments 存在 block-end 记录里，直接取最大的 game.ts 写入即可。
import { readFileSync, writeFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const src =
  'C:\\Users\\38875\\.dsh\\sessions\\--C-Users-38875-Desktop-~6E38~620Fdemo--\\session-be3174c7-5284-4362-9b0a-13d5e06bc5f3\\session.v4.jsonl.zstd'

const buf = readFileSync(src)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
let idx = buf.indexOf(MAGIC, 0)
while (idx !== -1) {
  offsets.push(idx)
  idx = buf.indexOf(MAGIC, idx + 4)
}

let raw = ''
for (let i = 0; i < offsets.length; i += 1) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
  try {
    raw += zstdDecompressSync(buf.subarray(start, end)).toString('utf8')
  } catch {
    /* 跳过残缺帧 */
  }
}

const lines = raw.split('\n').filter((l) => l.trim().length > 0)
const candidates = []

function scan(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 16) return
  if (Array.isArray(node)) {
    for (const item of node) scan(item, depth + 1)
    return
  }
  if (node.name === 'write' && typeof node.arguments === 'string') {
    try {
      const args = JSON.parse(node.arguments)
      if (typeof args.file_path === 'string' && args.file_path.endsWith('game.ts') && typeof args.content === 'string') {
        candidates.push({ content: args.content })
      }
    } catch {
      /* arguments 不完整则忽略 */
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'arguments') continue
    const value = node[key]
    if (value && typeof value === 'object') scan(value, depth + 1)
  }
}

for (const line of lines) {
  try {
    scan(JSON.parse(line))
  } catch {
    /* 跳过非 JSON 行 */
  }
}

console.log(`frames: ${offsets.length}, raw: ${raw.length}, lines: ${lines.length}, game.ts writes: ${candidates.length}`)
for (const c of candidates) console.log(`  ${c.content.length} chars, hasBOSS=${c.content.includes('BOSS_NAME')}`)

const best = candidates.filter((c) => c.content.includes('BOSS_NAME')).sort((a, b) => b.content.length - a.content.length)[0]
if (!best) {
  writeFileSync('recovery/session-decompressed.txt', raw, 'utf8')
  console.error('未找到 game.ts 的完整写入记录，原始日志已写入 recovery/session-decompressed.txt')
  process.exit(1)
}

writeFileSync('src/game.ts', best.content, 'utf8')
console.log(`已恢复 src/game.ts（${best.content.length} chars）`)
