/**
 * 残响高塔 · 真引擎无头试玩矩阵（3 角色 × 3 难度 × 2 局 = 18 局）
 *
 * 与 sim/full-matrix-smoke.mjs 的区别：
 *   - 那个脚本是「公式推演器」，把 game.ts / combat.ts 的逻辑再手写一遍；
 *   - 本脚本直接跑 dist/ 里的真实构建产物（three.js + Combat + Game 全套实机逻辑），
 *     通过 CDP 驱动 window.__goblinTower，用固定步长快进，逐帧采集血量、金币、房间与承伤。
 *
 * 自动化策略（固定、可复现；报告里必须声明）：
 *   - 走位：保持在射程带内（太远贴近、太近后撤、刚好在带内绕圈），贴墙/贴障碍按圆形碰撞体绕行，
 *     检测到 1.2s 内位移 < 0.35m 就翻转绕行方向。注意：v5 已删除冲刺，所以自动机没有闪避键。
 *   - 攻击：debugAutoAttack(true) → 自动索敌普攻 + 充能满自动放技能。
 *   - Q/F：潜能节点 ≥ 2 时每 0.25s 尝试触发（CD 由游戏自己管）。
 *   - 时间：接管 performance.now() 为「游戏时间」，否则节奏分支的踩拍判定与 Q/F 冷却
 *     在快进下几乎不走（会严重低估若叶睦·节奏）。
 *   - 潜能：第 1 局取分支候选表第 1 条，第 2 局取第 2 条（一局一套构筑，覆盖两条路线）。
 *   - 隧道三选一：残血(<50%)优先营地；否则 战斗房 > 奖励房 > 商人 > 小游戏 > 事件 > 祭坛 > 考验 > 休憩。
 *   - 商店：先药水保命 → 潜能节点 → 训练(金币>300) → 卡片（魔力/生命/护甲/闪避/攻速 优先）。
 *   - 事件/奖励房：选第 1 个选项；小游戏：点「ESC 离开」按放弃结算（无惩罚）。
 *
 * 运行：
 *   node sim/playtest-matrix.mjs                  # 18 局全跑，写 sim/playtest-matrix.json
 *   node sim/playtest-matrix.mjs --only murasame-hard
 *   node sim/playtest-matrix.mjs --shots          # 关键相位截图到 shots/playtest/
 *   node sim/playtest-matrix.mjs --maxsec 240     # 单局墙上时钟上限（默认 200s）
 *   node sim/playtest-matrix.mjs --coverage --shots  # 补充覆盖测试（祭坛/考验/小游戏/事件/技能圣所）
 *   node sim/playtest-matrix.mjs --assert-flow --only normal-1   # 流程断言（P0 修复前应为红）
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}
const ONLY = typeof flag('only') === 'string' ? flag('only') : null
const SHOTS = Boolean(flag('shots', false))
const MAX_SEC = Number(flag('maxsec', 200))
const COVERAGE = Boolean(flag('coverage', false))
const ASSERT_FLOW = Boolean(flag('assert-flow', false))
const OUT_OVERRIDE = typeof flag('out', '') === 'string' ? flag('out') : null

const HOST = '127.0.0.2'
const PORT = 5188
const CDP_PORT = 9333
const DIST = path.resolve(process.cwd(), 'dist')
const OUT_DIR = path.resolve(process.cwd(), 'shots/playtest')
const JSON_OUT = path.resolve(process.cwd(), 'sim/playtest-matrix.json')
const PROFILE = path.join(process.cwd(), 'node_modules', '.cache', `gt-playtest-${Date.now()}`)
mkdirSync(OUT_DIR, { recursive: true })

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ 不存在：请先 npm run build')
  process.exit(1)
}

const BROWSERS = [
  process.env.CHROME_BIN,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean)
const BROWSER = BROWSERS.find((p) => existsSync(p))
if (!BROWSER) {
  console.error('未找到 Edge/Chrome 可执行文件')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
}
const httpServer = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST, url === '/' ? 'index.html' : url)
  if (!existsSync(file) || !statSync(file).isFile()) file = path.join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
})
await new Promise((resolve) => httpServer.listen(PORT, HOST, resolve))

const chrome = spawn(
  BROWSER,
  [
    '--headless',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-sandbox',
    '--no-proxy-server',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--mute-audio',
    '--window-size=1280,720',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

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
  throw new Error(`等待 ${label} 超时 (${timeoutMs}ms)`)
}

const target = await waitFor(async () => {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const list = await res.json()
  return list.find((t) => t.type === 'page') ?? null
}, 20000, 'CDP target')

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.errors = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true })
      this.ws.addEventListener('error', reject, { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
        return
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        this.errors.push(msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? 'exception')
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        this.errors.push((msg.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' '))
      }
    })
  }
  async send(method, params = {}) {
    await this.ready
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) {
      throw new Error(`page eval: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    }
    return res.result?.value
  }
  async shot(file) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(res.data, 'base64'))
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

const cdp = new Cdp(target.webSocketDebuggerUrl)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false })

/* ────────────────────────────── 页面内驱动器 ────────────────────────────── */

const DRIVER = String.raw`
(() => {
  const g = window.__goblinTower
  if (!g) return 'no-game'
  if (window.__pt && window.__pt.ready) return 'already'

  const S = {
    ready: true,
    t: 0,                 // 快进的游戏时间（秒）
    wall: Date.now(),
    dmgTaken: 0,
    hits: 0,
    maxHit: 0,
    goldSpent: 0,
    rooms: [],            // 每个隧道房间一条记录
    battles: [],          // 层内配额战斗（layerTotal > 0 且非房间战）
    battle: null,
    layers: [],           // [layer, hp, maxHp, gold, kills, t]
    scenes: [],           // [layer, sceneName]
    lastLayer: 0,
    roomStart: null,
    shopOpen: false,
    skippedMinigame: 0,
    events: 0,
    shopVisits: 0,
    potentialLog: [],
    strafeDir: 1,
    avoidDir: 1,
    done: false,
    outcome: null,
    timeout: false,
    error: null,
    tickMs: 0,
  }

  // 接管 performance.now()：节奏踩拍、Q/F 冷却、音效冷却都读它
  if (!window.__ptClock) {
    const clk = { ms: 0 }
    window.__ptClock = clk
    window.__ptRealNow = performance.now.bind(performance)
    performance.now = () => clk.ms
  }

  // 真实承伤：damagePlayer 内部已算闪避/减伤，这里量 HP 差
  if (!g.__ptDmg) {
    g.__ptDmg = true
    const orig = g.damagePlayer.bind(g)
    g.damagePlayer = (v) => {
      const before = g.player?.hp ?? 0
      orig(v)
      const after = g.player?.hp ?? 0
      const d = before - after
      if (d > 0.4) {
        S.dmgTaken += d
        S.hits += 1
        if (d > S.maxHit) S.maxHit = d
      }
    }
  }

  const keys = new Map()
  const setKey = (code, on) => {
    if (keys.get(code) === on) return
    keys.set(code, on)
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, bubbles: true }))
  }
  const press = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }))
  }
  const clearKeys = () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) setKey(code, false)
  }
  const clickText = (needles, selector = 'button') => {
    const list = [...document.querySelectorAll(selector)]
    for (const el of list) {
      const t = (el.textContent || '').replace(/\s+/g, ' ')
      if (needles.some((n) => t.includes(n))) {
        el.click()
        return t.slice(0, 40)
      }
    }
    return null
  }

  const nearest = () => {
    const p = g.player
    if (!p) return null
    let best = null
    let bd = 1e9
    for (const e of g.goblins || []) {
      if (!e.alive) continue
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2
      if (d < bd) { bd = d; best = e }
    }
    if (g.boss?.alive) {
      const d = (g.boss.x - p.x) ** 2 + (g.boss.z - p.z) ** 2
      if (d < bd) { bd = d; best = g.boss }
    }
    return best ? { e: best, dist: Math.sqrt(bd) } : null
  }

  // 角色基础射程（src/data/characters.ts）：把走位控制在刚好能打到人的距离带
  const BASE_RANGE = { mutsumi: 5.5, murasame: 4.6, fish: 7.5 }
  const rotateInput = (x, z, yaw) => ({
    x: x * Math.cos(yaw) - z * Math.sin(yaw),
    z: -x * Math.sin(yaw) - z * Math.cos(yaw),
  })

  const kite = () => {
    const p = g.player
    if (!p) return
    const reach = (BASE_RANGE[g.run.character] ?? 5) * Math.max(0.6, Math.min(1.7, (p.stats.intelligence || 100) / 100))
    const inner = reach * 0.45
    const outer = reach * 0.9
    let wx = 0
    let wz = 0
    const near = nearest()
    if (near) {
      const dx = near.e.x - p.x
      const dz = near.e.z - p.z
      const d = Math.hypot(dx, dz) || 1
      const ux = dx / d
      const uz = dz / d
      if (d > outer) {
        wx = ux
        wz = uz
      } else if (d < inner) {
        wx = -ux
        wz = -uz
      } else {
        const dir = S.strafeDir ?? 1
        wx = -uz * dir
        wz = ux * dir
      }
    } else {
      wx = -p.x * 0.05
      wz = -p.z * 0.05
    }
    // 贴墙修正
    const half = (g.floor?.halfSize ?? 20) - 3
    if (p.x > half * 0.8 && wx > 0) wx = -Math.abs(wx)
    if (p.x < -half * 0.8 && wx < 0) wx = Math.abs(wx)
    if (p.z > half * 0.8 && wz > 0) wz = -Math.abs(wz)
    if (p.z < -half * 0.8 && wz < 0) wz = Math.abs(wz)
    // 简易绕障：柱子/地标是圆形碰撞体，贴太近就沿切线绕开，否则会卡在道具上打不到人
    const cols = g.floor?.propColliders ?? []
    const avoidDir = S.avoidDir ?? 1
    for (const c of cols) {
      const dx = p.x - c.x
      const dz = p.z - c.z
      const d = Math.hypot(dx, dz) || 0.001
      const nearR = c.r + 1.6
      if (d < nearR) {
        const w = (nearR - d) / nearR
        const tx = -dz / d
        const tz = dx / d
        wx += (tx * avoidDir * 1.5 + (dx / d) * 0.7) * w
        wz += (tz * avoidDir * 1.5 + (dz / d) * 0.7) * w
      }
    }
    // 卡住检测：1.2 秒内位移 < 0.35m 就翻转绕行方向
    if (!S.lastMove || S.t - S.lastMove.t > 1.2) {
      if (S.lastMove && Math.hypot(p.x - S.lastMove.x, p.z - S.lastMove.z) < 0.35 && (wx || wz)) {
        S.avoidDir = -(S.avoidDir ?? 1)
        S.strafeDir = -(S.strafeDir ?? 1)
        S.stuckFlips = (S.stuckFlips ?? 0) + 1
      }
      S.lastMove = { x: p.x, z: p.z, t: S.t }
    }
    // 脱困兜底：追击 3 秒还没拉近 0.5m（被柱子/墙角夹住，人类会贴墙滑过去），
    // 给一次 1.2m 的辅助位移。计入 assists，报告里单独披露，避免把卡死算成"游戏设计问题"。
    if (near) {
      const ref = S.chaseRef
      if (!ref || S.t - ref.t > 3) {
        if (ref && ref.d - near.dist < 0.5 && (S.assists ?? 0) < 400) {
          const dx = near.e.x - p.x
          const dz = near.e.z - p.z
          const L2 = Math.hypot(dx, dz) || 1
          p.x += (dx / L2) * 1.2
          p.z += (dz / L2) * 1.2
          S.assists = (S.assists ?? 0) + 1
        }
        S.chaseRef = { d: near.dist, t: S.t }
      }
    } else {
      S.chaseRef = null
    }
    const L = Math.hypot(wx, wz) || 1
    wx /= L
    wz /= L
    const s = rotateInput(wx, wz, g.rig.yaw)
    setKey('KeyW', s.z > 0.38)
    setKey('KeyS', s.z < -0.38)
    setKey('KeyD', s.x > 0.38)
    setKey('KeyA', s.x < -0.38)
  }

  const advance = (sec) => {
    const step = 1 / 30
    const n = Math.max(1, Math.round(sec / step))
    for (let i = 0; i < n; i += 1) {
      if (i % 6 === 0) {
        if (g.phase !== 'playing') break
        kite()
        if ((g.run?.potential?.nodes?.length ?? 0) >= 2) {
          press('KeyQ')
          press('KeyF')
        }
      }
      g.clock.getDelta()
      g.elapsed += step
      g.update(step)
      g.input.endFrame()
      S.t += step
      window.__ptClock.ms += step * 1000
      if (g.phase !== 'playing') break
    }
    clearKeys()
  }

  const sample = () => {
    const p = g.player
    if (!p) return null
    if (g.run.layer !== S.lastLayer) {
      S.lastLayer = g.run.layer
      S.layers.push([g.run.layer, Math.round(p.hp), Math.round(p.stats.maxHp), Math.round(g.run.gold), g.run.kills, Math.round(S.t)])
      S.scenes.push([g.run.layer, g.sceneName ?? ''])
    }
    // 记录「层内清怪配额」战斗（房间战另记在 rooms 里）
    if (g.phase === 'playing' && g.layerTotal > 0 && !g.roomActive) {
      if (!S.battle || S.battle.layer !== g.run.layer) {
        S.battle = { layer: g.run.layer, total: g.layerTotal, killed: g.layerKilled, start: Math.round(S.t), end: null }
        S.battles.push(S.battle)
      } else {
        S.battle.total = g.layerTotal
        S.battle.killed = g.layerKilled
        S.battle.end = Math.round(S.t)
      }
    }
    // Boss 战前 15 秒的 NDC 采样：客观验证「首帧 Boss 是否在画面内」（G3 判据）
    if (g.boss?.group) {
      if (!S.bossFrames) S.bossFrames = []
      const last = S.bossFrames[S.bossFrames.length - 1]
      if (S.bossFrames.length < 30 && (!last || S.t - last.t > 0.5)) {
        try {
          const v = g.boss.group.position.clone()
          v.y = 1.6
          v.project(g.camera)
          S.bossFrames.push({ t: Math.round(S.t), x: Number(v.x.toFixed(2)), y: Number(v.y.toFixed(2)) })
        } catch {
          /* ignore */
        }
      }
    }
    return p
  }

  /* ── 潜能三选一 ── */
  const BRANCH_INDEX = Number(window.__ptBranchIndex ?? 0)
  const pickPotential = () => {
    const offers = g.potentialOffers || []
    if (!offers.length) return
    const hasBranch = Boolean(g.run.potential?.branch)
    let pick = null
    if (!hasBranch) {
      const branches = offers.filter((o) => o.payload?.potential && !o.payload.potential.nodeId)
      pick = branches[BRANCH_INDEX % Math.max(1, branches.length)] ?? offers[0]
      S.potentialLog.push('branch:' + (pick?.title ?? '?'))
    } else {
      pick = offers.find((o) => o.payload?.potential?.nodeId) ?? offers[0]
      S.potentialLog.push('node:' + (pick?.title ?? '?'))
    }
    g.pickTunnel(pick.id)
  }

  const closeRoomRecord = () => {
    if (!S.roomStart) return
    const rec = S.rooms[S.rooms.length - 1]
    if (rec && rec.hpAfter === null) {
      rec.hpAfter = Math.round(g.player?.hp ?? 0)
      rec.goldAfter = Math.round(g.run.gold)
      rec.secs = Math.round((S.t - S.roomStart.t) * 10) / 10
    }
    S.roomStart = null
  }

  /* ── 隧道三选一 ── */
  const chooseTunnel = () => {
    const offers = g.tunnelOffers || []
    if (!offers.length) return
    // 上一间房可能没走出口裂隙（战斗门金币/潜能奖励会直接开下一轮门），先封口
    closeRoomRecord()
    const PREFER = Array.isArray(window.__ptPrefer) ? window.__ptPrefer : []
    const hpRatio = g.player ? g.player.hp / Math.max(1, g.player.stats.maxHp) : 1
    const score = (o) => {
      const preferIdx = PREFER.indexOf(o.room)
      if (preferIdx >= 0) return 1000 - preferIdx
      switch (o.room) {
        case 'boss': return 100
        case 'mob-wave': return 78
        case 'elite-fight': return hpRatio > 0.75 ? 80 : 45
        case 'chest': return 72
        case 'skill-card': return 70
        case 'merchant': return 68
        case 'minigame': return 62
        case 'event': return 60
        case 'rest': return hpRatio < 0.5 ? 98 : 55
        case 'altar': return 40
        case 'trial': return 30
        default: return 10
      }
    }
    const best = [...offers].sort((a, b) => score(b) - score(a))[0]
    const p = g.player
    S.rooms.push({
      layer: g.run.layer,
      room: best.room,
      title: best.title,
      hpBefore: Math.round(p?.hp ?? 0),
      goldBefore: Math.round(g.run.gold),
      hpAfter: null,
      goldAfter: null,
      secs: null,
    })
    S.roomStart = { t: S.t, hp: p?.hp ?? 0, gold: g.run.gold }
    g.pickTunnel(best.id)
  }

  /* ── 商店采购 ── */
  const shopStep = () => {
    const offers = g.shopOffers || []
    const p = g.player
    if (!p) { g.leaveShop(); return }
    const ratio = p.hp / Math.max(1, p.stats.maxHp)
    const gold = g.run.gold

    // 1) 保命药水：买完立刻喝
    const healOffer = offers.find((o) => o.kind === 'consumable' && (o.name || '').includes('治疗'))
    if (healOffer && ratio < 0.8 && gold >= healOffer.price) {
      g.buyOffer(healOffer.id)
      const item = (g.inventory.items || []).find((i) => (i.name || '').includes('治疗'))
      if (item) g.useItem(item.uid)
      return
    }
    // 2) 潜能节点
    const pot = offers.find((o) => o.kind === 'potential' && gold >= o.price)
    if (pot && (g.run.potential?.nodes?.length ?? 0) < 3) { g.buyOffer(pot.id); return }
    // 3) 金币训练（钱多才买）
    const train = offers.find((o) => o.kind === 'training' && gold >= o.price * 2.2)
    if (train) { g.buyOffer(train.id); return }
    // 4) 道具卡：按收益优先级
    const prio = { magic: 0, hp: 1, armor: 2, dodge: 3, stamina: 4, chargeGain: 5, crit: 6, intelligence: 7, moveSpeed: 8, chargeMax: 9 }
    const cards = offers
      .filter((o) => o.kind === 'buff-card' && gold >= o.price + 60)
      .sort((a, b) => (prio[a.stat] ?? 50) - (prio[b.stat] ?? 50))
    if (cards.length) { g.buyOffer(cards[0].id); return }
    // 5) 充能电池兜底
    const battery = offers.find((o) => o.kind === 'consumable' && (o.name || '').includes('充能'))
    if (battery && gold >= battery.price + 120) { g.buyOffer(battery.id); return }
    g.leaveShop()
  }

  /* ── 事件 / 奖励房面板 ── */
  const handleEventPanel = () => {
    const panel = g.eventPanel
    if (!panel?.isOpen) return false
    const cont = clickText(['继续 ·'])
    if (cont) return true
    panel.pickIndex(0)
    S.events += 1
    return true
  }

  /* ── 小游戏：点「ESC 离开」按放弃结算（无惩罚） ── */
  const handleMinigame = () => {
    const hit = clickText(['ESC 离开'])
    if (hit) {
      S.skippedMinigame += 1
      return true
    }
    return false
  }

  /* ── 房间 NPC / 出口裂隙 ── */
  const handleRoom = () => {
    const room = g.roomMap
    if (!room || g.roomActive) return false
    const p = g.player
    if (!p) return false
    if (!room.resolved) {
      p.x = room.npc.x
      p.z = room.npc.z - 1.1
      g.tryRoomInteract()
      return true
    }
    if (room.portal) {
      p.x = room.portal.x
      p.z = room.portal.z - 0.5
      g.tryRoomInteract()
      return true
    }
    return false
  }

  window.__pt = {
    ready: true,
    S,
    tick(sec = 0.25) {
      const t0 = Date.now()
      try {
        if (!g || g.disposed) { S.done = true; S.outcome = 'disposed'; return this.snap() }
        const phase = g.phase
        if (phase === 'victory' || phase === 'dead') {
          S.done = true
          S.outcome = phase
          closeRoomRecord()
          return this.snap()
        }
        if (handleEventPanel()) return this.finish(t0)
        if (handleMinigame()) return this.finish(t0)
        if (S.roomStart && !g.roomMap) closeRoomRecord()

        if (phase === 'tunnel') {
          if (g.altarActive) {
            const offers = g.altarOffers || []
            const pick =
              g.run.gold > 120
                ? offers.find((o) => o.id === 'altar-hp') ?? offers[0]
                : offers.find((o) => !o.id.includes('mystery')) ?? offers[0]
            if (pick) g.pickTunnel(pick.id)
          } else if (g.trialActive) {
            const ratio = (g.player?.hp ?? 0) / Math.max(1, g.player?.stats?.maxHp ?? 1)
            g.pickTunnel(ratio > 0.6 ? 'trial-accept' : 'trial-refuse')
          } else if (g.cardRewardActive) {
            const o = (g.cardRewardOffers || [])[0]
            if (o) g.pickTunnel(o.id)
          } else if (g.potentialActive) {
            pickPotential()
          } else if ((g.tunnelOffers || []).length) {
            chooseTunnel()
          }
          sample()
          return this.finish(t0)
        }

        if (phase === 'shop') {
          if (!S.shopOpen) {
            S.shopOpen = true
            S.shopVisits += 1
          }
          shopStep()
          sample()
          return this.finish(t0)
        }
        if (S.shopOpen && phase !== 'shop') S.shopOpen = false

        if (phase === 'playing') {
          if (handleRoom()) { sample(); return this.finish(t0) }
          advance(sec)
          sample()
          return this.finish(t0)
        }

        return this.finish(t0)
      } catch (err) {
        S.error = String(err && err.stack ? err.stack.split('\n')[0] : err)
        S.done = true
        S.outcome = 'error'
        return this.snap()
      }
    },
    finish(t0) {
      S.tickMs = Date.now() - t0
      return this.snap()
    },
    snap() {
      const p = g?.player
      return {
        done: S.done,
        outcome: S.outcome,
        phase: g?.phase,
        layer: g?.run?.layer ?? 0,
        stage: g?.run?.stage ?? 0,
        hp: Math.round(p?.hp ?? 0),
        maxHp: Math.round(p?.stats?.maxHp ?? 0),
        gold: Math.round(g?.run?.gold ?? 0),
        kills: g?.run?.kills ?? 0,
        goblins: (g?.goblins || []).length,
        aliveList: (g?.goblins || [])
          .filter((x) => x.alive)
          .slice(0, 6)
          .map((x) => ({
            kind: g.goblinKinds?.get?.(x) ?? '?',
            hp: Math.round(x.hp ?? 0),
            x: Number((x.x ?? 0).toFixed(1)),
            z: Number((x.z ?? 0).toFixed(1)),
            d: Math.round(Math.hypot((x.x ?? 0) - (p?.x ?? 0), (x.z ?? 0) - (p?.z ?? 0))),
          })),
        boss: g?.boss ? { hp: Math.round(g.boss.hp), maxHp: Math.round(g.boss.maxHp), title: g.boss.title } : null,
        // Boss 是否真的在画面里（NDC 绝对值 <1 即可见）：G3 的客观判据，不靠肉眼
        bossNdc: (() => {
          if (!g?.boss?.group) return null
          try {
            const v = g.boss.group.position.clone()
            v.y = 1.6
            v.project(g.camera)
            return { x: Number(v.x.toFixed(2)), y: Number(v.y.toFixed(2)) }
          } catch {
            return null
          }
        })(),
        room: g?.roomMap ? { room: g.roomMap.offer?.room, resolved: g.roomMap.resolved, active: g.roomActive } : null,
        layerTotal: g?.layerTotal ?? 0,
        layerKilled: g?.layerKilled ?? 0,
        layerSpawned: g?.layerSpawned ?? 0,
        scene: g?.sceneName ?? '',
        nodes: g?.run?.potential?.nodes?.length ?? 0,
        branch: g?.run?.potential?.branch ?? null,
        dmg: Math.round(S.dmgTaken),
        hits: S.hits,
        t: Math.round(S.t),
        wallMs: Date.now() - S.wall,
      }
    },
    report() {
      closeRoomRecord()
      const p = g?.player
      return {
        outcome: S.outcome,
        error: S.error,
        layer: g?.run?.layer ?? 0,
        diff: g?.run?.difficulty,
        char: g?.run?.character,
        style: g?.run?.style,
        hp: Math.round(p?.hp ?? 0),
        maxHp: Math.round(p?.stats?.maxHp ?? 0),
        gold: Math.round(g?.run?.gold ?? 0),
        kills: g?.run?.kills ?? 0,
        gameTime: Math.round(S.t),
        wallMs: Date.now() - S.wall,
        dmgTaken: Math.round(S.dmgTaken),
        hits: S.hits,
        maxHit: Math.round(S.maxHit),
        assists: S.assists ?? 0,
        stuckFlips: S.stuckFlips ?? 0,
        events: S.events,
        shopVisits: S.shopVisits,
        skippedMinigame: S.skippedMinigame,
        potentialLog: S.potentialLog,
        branch: g?.run?.potential?.branch ?? null,
        nodes: g?.run?.potential?.nodes?.length ?? 0,
        rooms: S.rooms,
        battles: S.battles,
        layers: S.layers,
        scenes: S.scenes,
        bossFrames: S.bossFrames ?? [],
        inventory: (g?.inventory?.items || []).map((i) => i.name),
        cards: g?.cards ?? null,
        trial: g?.run?.trial ?? null,
        boons: g?.run?.boons ?? null,
        hpCapPenalty: g?.run?.hpCapPenalty ?? 0,
        training: g?.run?.training ?? null,
        trainingBuys: g?.run?.trainingBuys ?? 0,
      }
    },
  }
  return 'ok'
})()
`

/* ────────────────────────────── 矩阵 ────────────────────────────── */

const CHARS = [
  { id: 'mutsumi', name: '若叶睦', style: 'mutsumi-solo' },
  { id: 'murasame', name: '丛雨', style: 'murasame-iai' },
  { id: 'fish', name: '大肥鱼', style: 'fish-swarm' },
]
const DIFFS = [
  { id: 'easy', name: '简单' },
  { id: 'normal', name: '普通' },
  { id: 'hard', name: '困难' },
]

const RUNS = []
for (const c of CHARS) {
  for (const d of DIFFS) {
    for (let k = 0; k < 2; k += 1) {
      RUNS.push({
        char: c.id,
        charName: c.name,
        style: c.style,
        diff: d.id,
        diffName: d.name,
        runIndex: k + 1,
        seed: 2100 + RUNS.length * 13 + k * 7,
        branchIndex: k,
        tag: `${c.id}-${d.id}-${k + 1}`,
      })
    }
  }
}
const selected = ONLY ? RUNS.filter((r) => r.tag.includes(ONLY) || `${r.char}-${r.diff}` === ONLY) : [...RUNS]

// 补充覆盖测试：主动挑「祭坛 / 考验 / 小游戏 / 事件 / 技能圣所」，验证这些系统能否跑通
const COV_PREFS = [
  ['trial', 'altar'],
  ['minigame', 'event'],
  ['skill-card', 'rest'],
]
if (COVERAGE) {
  selected.length = 0
  for (const c of CHARS) {
    COV_PREFS.forEach((prefer, i) => {
      selected.push({
        char: c.id,
        charName: c.name,
        style: c.style,
        diff: 'easy',
        diffName: '简单',
        runIndex: i + 1,
        seed: 4400 + selected.length * 17,
        branchIndex: i % 3,
        tag: `cov-${c.id}-${i + 1}`,
        prefer,
      })
    })
  }
}
const JSON_TARGET = OUT_OVERRIDE
  ? path.resolve(process.cwd(), OUT_OVERRIDE)
  : COVERAGE
    ? path.resolve(process.cwd(), 'sim/playtest-coverage.json')
    : JSON_OUT

const results = []
try {
  for (const run of selected) {
    const t0 = Date.now()
    cdp.errors = []
    await cdp.send('Page.navigate', { url: `http://${HOST}:${PORT}/?seed=${run.seed}` })
    await waitFor(() => cdp.eval('Boolean(window.__goblinTower)'), 25000, 'game ready')
    await cdp.eval(`window.__ptBranchIndex = ${run.branchIndex}; window.__ptPrefer = ${JSON.stringify(run.prefer ?? [])}; ${DRIVER}`)
    if (SHOTS) await cdp.shot(path.join(OUT_DIR, `00-title.png`)).catch(() => {})
    const shotKeys = new Set()
    const grabShot = async (snap) => {
      if (!SHOTS || !snap) return
      const boss = snap.boss ? ':boss' : ''
      const room = snap.room ? `:${snap.room.room}${snap.room.active ? ':fight' : ''}` : ':main'
      const key = `${snap.phase}${room}${boss}`
      if (shotKeys.has(key) || shotKeys.size >= 14) return
      shotKeys.add(key)
      await cdp
        .eval('(() => { const g = window.__goblinTower; if (g) g.renderer.render(g.scene, g.camera); return 1 })()')
        .catch(() => {})
      const name = `${run.tag}-${String(shotKeys.size).padStart(2, '0')}-${key.replace(/[^a-zA-Z0-9-]/g, '_')}.png`
      await cdp.shot(path.join(OUT_DIR, name)).catch(() => {})
    }
    const boot = await cdp.eval(
      `(() => { const g = window.__goblinTower; g.startRun('${run.char}','${run.diff}','${run.style}'); g.debugAutoAttack(true); window.__pt.S.wall = Date.now(); return { phase: g.phase, layer: g.run.layer, hp: Math.round(g.player.hp), maxHp: Math.round(g.player.stats.maxHp), style: g.run.style } })()`,
    )

    let snap = null
    let lastReport = Date.now()
    while (Date.now() - t0 < MAX_SEC * 1000) {
      snap = await cdp.eval('window.__pt.tick(0.25)')
      if (!snap) break
      if (snap.done) break
      await grabShot(snap)
      if (Date.now() - lastReport > 15000) {
        lastReport = Date.now()
        process.stdout.write(`  · ${run.tag} L${snap.layer} hp ${snap.hp}/${snap.maxHp} gold ${snap.gold} t=${snap.t}s` +
          ` 配额 ${snap.layerKilled}/${snap.layerTotal}（已刷 ${snap.layerSpawned}） 怪${snap.goblins} alive=${JSON.stringify(snap.aliveList ?? [])} 阶段=${snap.phase} 房=${JSON.stringify(snap.room ?? null)}\n`)
      }
    }
    const report = await cdp.eval('window.__pt.report()')
    if (snap && !snap.done) {
      report.outcome = report.outcome ?? 'timeout'
      report.timeout = true
    }
    if (SHOTS) await cdp.shot(path.join(OUT_DIR, `${run.tag}-end.png`)).catch(() => {})
    const rec = {
      ...run,
      ...report,
      boot,
      consoleErrors: cdp.errors.slice(0, 5),
      wallSeconds: Math.round((Date.now() - t0) / 100) / 10,
    }
    results.push(rec)
    const status = report.outcome === 'victory' ? '通关' : report.outcome === 'dead' ? '阵亡' : report.outcome
    console.log(
      `${run.tag.padEnd(18)} ${String(status).padEnd(4)} L${String(report.layer).padStart(2)}  ` +
        `hp ${String(report.hp).padStart(3)}/${String(report.maxHp).padEnd(3)} 金 ${String(report.gold).padStart(4)}  ` +
        `击杀 ${String(report.kills).padStart(3)} 承伤 ${String(report.dmgTaken).padStart(5)} 挨打 ${String(report.hits).padStart(3)}  ` +
        `房间 ${String(report.rooms.length).padStart(2)} 游戏时长 ${String(report.gameTime).padStart(4)}s  实际 ${rec.wallSeconds}s` +
        (report.error ? `  ERR ${report.error}` : '') +
        (cdp.errors.length ? `  consoleErr ${cdp.errors.length}` : ''),
    )
    writeFileSync(JSON_TARGET, JSON.stringify(results, null, 2))
  }
} finally {
  cdp.close()
  chrome.kill()
  httpServer.close()
  await sleep(300)
  try {
    rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/* ────────────────────────────── 汇总 ────────────────────────────── */

const pad = (s, n) => String(s).padEnd(n)
const num = (v, n = 4) => String(v).padStart(n)
console.log('\n================ 矩阵汇总 ================')
console.log(pad('组合', 18) + pad('局', 3) + pad('结局', 6) + num('到达层', 7) + num('击杀', 6) + num('承伤', 7) + num('房间', 6) + num('游戏秒', 8) + '  潜能')
for (const r of results) {
  console.log(
    pad(`${r.charName}·${r.diffName}`, 18) +
      pad(r.runIndex, 3) +
      pad(r.outcome === 'victory' ? '通关' : r.outcome === 'dead' ? '阵亡' : r.outcome, 6) +
      num(r.layer, 7) +
      num(r.kills, 6) +
      num(r.dmgTaken, 7) +
      num(r.rooms.length, 6) +
      num(r.gameTime, 8) +
      '  ' + (r.branch ?? '-') + (r.potentialLog?.length ? ` (${r.potentialLog.length}节点)` : ''),
  )
}
writeFileSync(JSON_TARGET, JSON.stringify(results, null, 2))
console.log(`\n详细数据：${JSON_TARGET}`)

/* ────────────────────────────── 流程断言（P0 标尺） ────────────────────────── */

if (ASSERT_FLOW) {
  const TOTAL = { easy: 9, normal: 16, hard: 18 }
  const BOSS = { easy: [9], normal: [7, 16], hard: [6, 12, 18] }
  const COUNT_MUL = { easy: 0.95, normal: 1.35, hard: 1.35 }
  const FAMILY = { 1: '云上花庭', 2: '星砂观星台', 3: '黄铜钟塔' }
  const stageOf = (diff, layer) => {
    const sizes = { easy: [9], normal: [7, 9], hard: [6, 6, 6] }[diff]
    let acc = 0
    for (let i = 0; i < sizes.length; i += 1) {
      acc += sizes[i]
      if (layer <= acc) return i + 1
    }
    return sizes.length
  }
  const quotaOf = (diff, layer) => Math.round((33 + 7.5 * (layer - 1)) * (COUNT_MUL[diff] ?? 1))

  const rows = []
  let fails = 0
  for (const r of results) {
    const bossLayers = BOSS[r.diff] ?? []
    const reached = Math.max(1, ...(r.layers ?? [[1]]).map((l) => l[0]))
    const expectedBattles = Array.from({ length: reached }, (_, i) => i + 1).filter((l) => !bossLayers.includes(l)).length
    const battles = (r.battles ?? []).filter((b) => b.total > 0)
    const battleLayers = [...new Set(battles.map((b) => b.layer))].sort((a, b) => a - b)
    const battleLayersNonBoss = battleLayers.filter((l) => !bossLayers.includes(l))
    const okBattle = battleLayersNonBoss.length === expectedBattles

    // Boss 层必须存在「清 60% 小怪」的配额战斗，且配额正确
    const bossChecks = bossLayers
      .filter((l) => l <= reached)
      .map((l) => {
        const b = battles.find((x) => x.layer === l)
        const want = Math.round(quotaOf(r.diff, l) * 0.6)
        return { layer: l, want, got: b ? b.total : null, ok: Boolean(b) && b.total === want }
      })

    // 场景必须随阶段切换
    const sceneChecks = (r.scenes ?? []).map(([layer, name]) => {
      const fam = FAMILY[stageOf(r.diff, layer)]
      return { layer, name, ok: typeof name === 'string' && name.startsWith(fam) }
    })
    const sceneOk = sceneChecks.every((c) => c.ok)

    const ok = okBattle && bossChecks.every((c) => c.ok) && sceneOk
    if (!ok) fails += 1
    rows.push({ tag: r.tag, reached, expectedBattles, gotBattles: battleLayers.length, gotBattlesNonBoss: battleLayersNonBoss.length, battleLayers, okBattle, bossChecks, sceneChecks, sceneOk, ok })
  }

  console.log('\n================ 流程断言（每局配额战斗 / Boss 层配额 / 场景切换） ================')
  for (const x of rows) {
    console.log(
      `${x.ok ? 'PASS' : 'FAIL'}  ${x.tag.padEnd(17)} 到达 L${String(x.reached).padStart(2)}  ` +
        `配额战斗层 ${x.gotBattlesNonBoss}/${x.expectedBattles}（含 Boss 层共 ${x.gotBattles}）${x.battleLayers.length ? ` [L${x.battleLayers.join(',L')}]` : ''}  ` +
        `Boss层: ${x.bossChecks.length ? x.bossChecks.map((c) => `L${c.layer} ${c.got ?? '缺失'}/${c.want}`).join(' ') : '未到达'}  ` +
        `场景: ${x.sceneOk ? 'OK' : x.sceneChecks.filter((c) => !c.ok).map((c) => `L${c.layer}=${c.name || '?'}`).join(',')}`,
    )
  }
  const bad = rows.filter((x) => !x.ok)
  console.log(`\n流程断言：${rows.length - bad.length}/${rows.length} 通过，${bad.length} 失败`)
  if (bad.length) {
    console.log('失败项含义：配额战斗层数应等于「已到达层数中非 Boss 层数量」（Boss 层单算）；Boss 层应先清 60% 小怪；场景名应匹配所属阶段。')
    console.log('对应问题：docs/21-试玩评估报告.md §3.1（advanceToNextLayer 未调 enterLayer）+ §3.5（死在眩晕里的敌人永不剔除 → 软锁）。')
    process.exitCode = 1
  }
}
