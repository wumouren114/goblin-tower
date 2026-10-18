// 读取 DSH 会话记录（多帧 zstd jsonl），打印最近若干条记录的精简摘要
// 用法: node scripts/session-tail.mjs <sessionId> [count] [chars]
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'

const sessionId = process.argv[2] || 'session-be3174c7-5284-4362-9b0a-13d5e06bc5f3'
const count = Number(process.argv[3] || 40)
const chars = Number(process.argv[4] || 400)

const base = process.env.USERPROFILE + '\\.dsh\\sessions'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

let file = null
for (const dir of readdirSync(base)) {
  const candidate = join(base, dir, sessionId, 'session.v4.jsonl.zstd')
  try {
    readFileSync(candidate)
    file = candidate
    break
  } catch { /* next */ }
}
if (!file) {
  console.error('session not found: ' + sessionId)
  process.exit(1)
}

const buf = readFileSync(file)
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
  } catch { /* 跳过残缺帧 */ }
}

const lines = raw.split('\n').filter((l) => l.trim().length > 0)
console.log(`FRAMES ${offsets.length} RAW ${raw.length} LINES ${lines.length}`)

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === 'string') return c
        if (c && typeof c === 'object') {
          if (typeof c.text === 'string') return c.text
          if (typeof c.content === 'string') return c.content
          if (c.type === 'tool_use') return `[tool_use ${c.name} ${JSON.stringify(c.input || {}).slice(0, 160)}]`
          if (c.type === 'tool_result') return `[tool_result ${JSON.stringify(c.content || c.output || '').slice(0, 200)}]`
          if (c.type === 'image') return '[image]'
          return JSON.stringify(c).slice(0, 120)
        }
        return String(c)
      })
      .join('\n')
  }
  if (content && typeof content === 'object') return JSON.stringify(content).slice(0, chars)
  return ''
}

const records = []
for (const line of lines) {
  let obj
  try { obj = JSON.parse(line) } catch { continue }
  records.push(obj)
}

const tail = records.slice(-count)
console.log('--- records (oldest of tail first) ---')
for (const rec of tail) {
  const kind = rec.kind || rec.type || rec.recordType || '?'
  let role = rec.role || rec.message?.role || ''
  const payload = rec.message?.content ?? rec.content ?? rec.payload ?? rec.data
  const text = textOf(payload)
  const toolCalls = rec.toolCalls || rec.message?.tool_calls
  const tools = Array.isArray(toolCalls) ? toolCalls.map((t) => t.function?.name || t.name).join(',') : ''
  const keys = Object.keys(rec).join(',')
  console.log(`\n### ${kind} ${role} ${tools ? 'tools:' + tools : ''} keys:${keys}`)
  console.log(text.length > chars ? text.slice(0, chars) + ` …(+${text.length - chars})` : text)
}
