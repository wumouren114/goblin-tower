// 从所有 DSH 会话日志里找回 src/ui/hud.ts 最近一次的完整 write 内容
// （PowerShell 5.1 用 GBK 读写 UTF-8 源码会不可逆损坏中文/emoji，只能用日志回放）
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const ROOT = 'C:\\Users\\38875\\.dsh\\sessions'
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function findLogs(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) findLogs(p, out)
    else if (e.name.endsWith('.jsonl.zstd')) out.push(p)
  }
  return out
}

function decompressAll(buf) {
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
      /* 残缺帧跳过 */
    }
  }
  return raw
}

function scan(node, sink, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 20) return
  if (Array.isArray(node)) {
    for (const item of node) scan(item, sink, depth + 1)
    return
  }
  if (node.name === 'write' && typeof node.arguments === 'string') {
    try {
      const args = JSON.parse(node.arguments)
      const fp = typeof args.file_path === 'string' ? args.file_path.replace(/\\/g, '/') : ''
      if (fp.endsWith('src/ui/hud.ts') && typeof args.content === 'string') sink.push(args.content)
    } catch {
      /* 不完整 arguments 忽略 */
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'arguments') continue
    const v = node[key]
    if (v && typeof v === 'object') scan(v, sink, depth + 1)
  }
}

const logs = findLogs(ROOT)
console.log(`日志文件 ${logs.length} 个`)
const found = []
for (const file of logs) {
  let st
  try {
    st = statSync(file)
  } catch {
    continue
  }
  if (Date.now() - st.mtimeMs > 36 * 3600 * 1000) continue
  let buf
  try {
    buf = readFileSync(file)
  } catch {
    continue
  }
  const raw = decompressAll(buf)
  if (!raw.includes('hud.ts')) continue
  const sink = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      scan(JSON.parse(line), sink)
    } catch {
      /* 非 JSON 行 */
    }
  }
  for (const c of sink) found.push({ file, content: c })
  console.log(`  ${file} → ${sink.length} 条 hud.ts 写入`)
}

if (!found.length) {
  console.error('未找到 hud.ts 的写入记录')
  process.exit(1)
}
const best = found
  .filter((c) => c.content.includes('js-boss') && c.content.includes('showTunnelOffers'))
  .sort((a, b) => b.content.length - a.content.length)[0]
if (!best) {
  console.error('找到写入但没有完整 hud.ts（缺 js-boss/showTunnelOffers）')
  process.exit(1)
}
writeFileSync('src/ui/hud.ts', best.content, 'utf8')
console.log(`已恢复 src/ui/hud.ts（${best.content.length} chars，来源 ${best.file}）`)
