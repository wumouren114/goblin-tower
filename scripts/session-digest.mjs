// 从 DSH 会话记录里提取「用户消息」与「最近的工具调用」，用于恢复上下文
// 用法: node scripts/session-digest.mjs <sessionId> [userChars] [toolCount]
import { readFileSync, readdirSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

const sessionId = process.argv[2] || 'session-be3174c7-5284-4362-9b0a-13d5e06bc5f3'
const userChars = Number(process.argv[3] || 600)
const toolCount = Number(process.argv[4] || 40)

const base = process.env.USERPROFILE + '\\.dsh\\sessions'
let file = null
for (const dir of readdirSync(base)) {
  const candidate = join(base, dir, sessionId, 'session.v4.jsonl.zstd')
  try { readFileSync(candidate); file = candidate; break } catch { /* next */ }
}
if (!file) { console.error('session not found'); process.exit(1) }

const buf = readFileSync(file)
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const offsets = []
let idx = buf.indexOf(MAGIC, 0)
while (idx !== -1) { offsets.push(idx); idx = buf.indexOf(MAGIC, idx + 4) }
let raw = ''
for (let i = 0; i < offsets.length; i += 1) {
  const start = offsets[i]
  const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length
  try { raw += zstdDecompressSync(buf.subarray(start, end)).toString('utf8') } catch { /* skip */ }
}

const users = []
const tools = []
let turn = 0

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  for (const k of Object.keys(node)) {
    if (k === 'arguments' && typeof node[k] === 'string') continue
    const v = node[k]
    if (v && typeof v === 'object') walk(v, visit)
  }
}

const lines = raw.split('\n').filter((l) => l.trim())
for (const line of lines) {
  let rec
  try { rec = JSON.parse(line) } catch { continue }
  if (rec.type === 'turn/start') turn = rec.data?.turn ?? turn + 1
  if (rec.type === 'user/message' && rec.data?.role === 'user') {
    const parts = rec.data.content || []
    const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
    if (text.trim()) users.push({ turn, seq: rec.seq, text })
  }
  if (rec.type === 'step/end' || rec.type === 'assistant/attempt') {
    const seen = new Set()
    walk(rec.data, (n) => {
      if (typeof n.name === 'string' && typeof n.arguments === 'string') {
        const key = n.id || `${n.name}:${n.arguments.slice(0, 40)}`
        if (seen.has(key)) return
        seen.add(key)
        tools.push({ turn, seq: rec.seq, name: n.name, args: n.arguments })
      }
    })
  }
}

console.log(`TURNS ${turn}  USER_MSGS ${users.length}  TOOL_CALLS ${tools.length}`)
console.log('\n================ USER MESSAGES ================')
for (const u of users) {
  const t = u.text.replace(/\s+/g, ' ').trim()
  console.log(`\n--- turn ${u.turn} seq ${u.seq} ---`)
  console.log(t.length > userChars ? t.slice(0, userChars) + ` …(+${t.length - userChars})` : t)
}
console.log('\n================ LAST TOOL CALLS ================')
for (const t of tools.slice(-toolCount)) {
  let brief = t.args
  try {
    const a = JSON.parse(t.args)
    const keys = Object.keys(a)
    brief = keys.map((k) => {
      let v = a[k]
      if (typeof v === 'string') v = v.length > 90 ? v.slice(0, 90) + '…' : v
      else v = JSON.stringify(v).slice(0, 90)
      return `${k}=${v}`
    }).join(' | ')
  } catch { brief = brief.slice(0, 120) }
  console.log(`turn ${t.turn}  ${t.name}  ${brief}`)
}
