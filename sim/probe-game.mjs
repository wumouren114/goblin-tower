/**
 * 游戏内实况数据探针：直接读真实构建产物里的数值与门分布，避免「公式手抄一遍」失真。
 *
 * 采集内容：
 *   1) 每难度每层的真实配额 / 小怪血量与伤害 / Boss 血量（进层后读实例）；
 *   2) 每难度每层的三扇门房型分布（直接调真实 rollTunnels，累计 200×N 扇）；
 *   3) 三角色基础面板（HP / 充能 / 耐力 / 魔力 / 智力 / 移速 / 单发伤害）。
 *
 * 运行：node sim/probe-game.mjs [--doors 200]
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const DOOR_ROUNDS = Number(argv[argv.indexOf('--doors') + 1] ?? 200) || 200

const HOST = '127.0.0.2'
const PORT = 5189
const CDP_PORT = 9335
const DIST = path.resolve(process.cwd(), 'dist')
const PROFILE = path.join(process.cwd(), 'node_modules', '.cache', `gt-probe-${Date.now()}`)

const BROWSERS = [
  process.env.CHROME_BIN,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const BROWSER = BROWSERS.find((p) => existsSync(p))
if (!BROWSER) throw new Error('未找到 Edge/Chrome')

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav' }
const httpServer = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST, url === '/' ? 'index.html' : url)
  if (!existsSync(file) || !statSync(file).isFile()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
})
await new Promise((r) => httpServer.listen(PORT, HOST, r))

const chrome = spawn(BROWSER, [
  '--headless',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${PROFILE}`,
  '--no-sandbox',
  '--no-proxy-server',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  '--mute-audio',
  '--window-size=1280,720',
  'about:blank',
], { stdio: 'ignore', windowsHide: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* retry */
    }
    await sleep(150)
  }
  throw new Error(`等待 ${label} 超时`)
}

const target = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page') ?? null
}, 20000, 'CDP')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true })
  ws.addEventListener('error', rej, { once: true })
})
let seq = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(String(ev.data))
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(m.error.message))
    else res(m.result)
  }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result?.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: `http://${HOST}:${PORT}/?seed=777` })
await waitFor(() => evalJs('Boolean(window.__goblinTower)'), 25000, 'game object')
await sleep(500)

const DIFFS = ['easy', 'normal', 'hard']
const TOTAL = { easy: 9, normal: 16, hard: 18 }
const BOSS = { easy: [9], normal: [7, 16], hard: [6, 12, 18] }
const result = { chars: {}, layers: {}, doors: {}, styles: {} }

// 1) 三角色基础面板（开局读一次）
for (const char of ['mutsumi', 'murasame', 'fish']) {
  const info = await evalJs(`(() => {
    const g = window.__goblinTower
    g.startRun('${char}', 'normal')
    const p = g.player
    const s = p.stats
    return { char: '${char}', style: g.run.style, hp: Math.round(p.hp), maxHp: Math.round(s.maxHp),
      damage: Number(s.damage.toFixed(2)), magic: Number(s.magic.toFixed(1)), stamina: Number(s.stamina.toFixed(1)),
      intelligence: Number(s.intelligence.toFixed(1)), moveSpeed: Number(s.moveSpeed.toFixed(2)),
      chargeMax: Math.round(s.chargeMax), crit: s.critChance, critMul: s.critMultiplier, armor: s.armorRate, dodge: s.dodge }
  })()`)
  result.chars[char] = info
}

// 2) 每难度每层：配额 / 小怪血量伤害 / Boss 血量
for (const diff of DIFFS) {
  const rows = await evalJs(`(() => {
    const g = window.__goblinTower
    g.startRun('murasame', '${diff}')
    const rows = []
    const bossLayers = ${JSON.stringify(BOSS[diff])}
    for (let layer = 1; layer <= ${TOTAL[diff]}; layer += 1) {
      // 层数用内部 enterLayer 推进（与 retryLayer 同一入口），进层后跑 3 秒读实例
      try { g.enterLayer(layer) } catch (err) { rows.push({ layer, error: String(err) }); break }
      if (g.run.layer !== layer) break
      for (let i = 0; i < 90; i += 1) { g.update(1 / 30) }
      const hpSet = [...new Set(g.goblins.map((x) => Math.round(x.maxHp)))].sort((a, b) => a - b)
      const dmgSet = [...new Set(g.goblins.map((x) => Number((x.damage ?? 0).toFixed(1))))].sort((a, b) => a - b)
      const byKind = {}
      for (const gb of g.goblins) {
        const kind = g.goblinKinds?.get?.(gb.uid) ?? '?'
        byKind[kind] = { hp: Math.round(gb.maxHp), dmg: Number((gb.damage ?? 0).toFixed(1)) }
      }
      let bossHp = null
      if (bossLayers.includes(layer)) {
        // Boss 本体只在首领房生成：直接开一次首领房读血量
        try {
          g.startRoomBossBattle()
          bossHp = g.boss ? Math.round(g.boss.maxHp) : null
          g.clearRoomAdds()
          if (g.boss) { g.boss.dispose(); g.boss = null }
        } catch (err) { bossHp = 'err' }
      }
      rows.push({
        layer,
        quota: g.layerTotal,
        boss: bossLayers.includes(layer),
        bossHp,
        mobHp: hpSet,
        mobDmg: dmgSet,
        byKind,
        alive: g.goblins.length,
        scene: g.sceneName,
        stage: g.run.stage,
      })
      if (g.phase !== 'playing') g.phase = 'playing'
    }
    return rows
  })()`)
  result.layers[diff] = rows
}

// 3) 门分布：直接调真实 openTunnels/rollTunnels
for (const diff of DIFFS) {
  const doors = await evalJs(`(() => {
    const g = window.__goblinTower
    g.startRun('murasame', '${diff}')
    const total = 60
    const byLayer = {}
    const all = {}
    const sampleLayers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18]
    for (const layer of sampleLayers) {
      if (layer > total) continue
      g.run.layer = layer
      g.run.stage = Math.min(3, Math.ceil(layer / 6))
      const counts = {}
      for (let i = 0; i < ${DOOR_ROUNDS}; i += 1) {
        g.openTunnels()
        for (const o of g.tunnelOffers) {
          counts[o.room] = (counts[o.room] ?? 0) + 1
          all[o.room] = (all[o.room] ?? 0) + 1
        }
      }
      byLayer[layer] = counts
    }
    return { byLayer, all, runs: ${DOOR_ROUNDS} * sampleLayers.length }
  })()`)
  result.doors[diff] = doors
}

writeFileSync(path.resolve(process.cwd(), 'sim/probe-game.json'), JSON.stringify(result, null, 2))

console.log('=== 角色基础面板 ===')
for (const [k, v] of Object.entries(result.chars)) console.log(k, JSON.stringify(v))
console.log('\n=== 逐层数值 ===')
for (const [diff, rows] of Object.entries(result.layers)) {
  console.log(`\n[${diff}] 层 配额 小怪HP 小怪伤害 BossHP 场景 阶段 开始存活`)
  for (const r of rows) {
    console.log(
      `${String(r.layer).padStart(2)} ${String(r.quota).padStart(4)} ${String(r.mobHp.join('/')).padStart(6)} ` +
        `${String(r.mobDmg.join('/')).padStart(7)} ${String(r.bossHp ?? '-').padStart(6)} ${String(r.scene ?? '').padEnd(10)} ${r.stage} ${r.alive}`,
    )
  }
}
console.log('\n=== 门分布（每难度） ===')
for (const [diff, d] of Object.entries(result.doors)) {
  const total = Object.values(d.all).reduce((a, b) => a + b, 0)
  const parts = Object.entries(d.all)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v} (${((v / total) * 100).toFixed(1)}%)`)
  console.log(`${diff} 共 ${total} 扇：${parts.join('，')}`)
}

ws.close()
chrome.kill()
httpServer.close()
await sleep(200)
try {
  rmSync(PROFILE, { recursive: true, force: true })
} catch {
  /* ignore */
}
