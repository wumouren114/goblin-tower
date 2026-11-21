/**
 * 残响高塔 · 静音链路实测（独立脚本，不改游戏源码）
 *
 * 验证目标：
 *   1. M 热键（真实 CDP 键盘事件，带 code=KeyM）能否静音 / 恢复；
 *   2. 暂停菜单「静音」按钮能否静音 / 恢复；
 *   3. master GainNode 是否真的归零（不是只改 UI）；
 *   4. 静音时 SFX 是否不再创建音源（play() 早退）；
 *   5. HUD 静音芯片、暂停按钮文案是否同步；
 *   6. 刷新页面后静音状态是否保留（当前实现没有持久化，预期会重置）。
 *
 * 运行：
 *   node sim/mute-test.mjs
 * 产物：
 *   sim/mute-test.json
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HOST = '127.0.0.2'
const PORT = 5198
const CDP_PORT = 9444
const DIST = path.resolve(process.cwd(), 'dist')
const OUT = path.resolve(process.cwd(), 'sim/mute-test.json')
const PROFILE = path.join(process.cwd(), 'node_modules', '.cache', `gt-mute-${Date.now()}`)
mkdirSync(path.dirname(OUT), { recursive: true })

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
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
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
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--window-size=1280,720',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now()
  let lastErr = null
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      lastErr = e
    }
    await sleep(120)
  }
  throw new Error(`等待 ${label} 超时 (${timeoutMs}ms)${lastErr ? `: ${lastErr.message}` : ''}`)
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
        this.errors.push(
          msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? 'exception',
        )
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
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) {
      throw new Error(`page eval: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`)
    }
    return res.result?.value
  }
  async keyM() {
    const base = {
      key: 'm',
      code: 'KeyM',
      windowsVirtualKeyCode: 77,
      nativeVirtualKeyCode: 77,
    }
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: 'm', unmodifiedText: 'm', ...base })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

const PROBE = String.raw`
(() => {
  if (window.__audioProbe) return
  const probe = window.__audioProbe = {
    gains: [],
    starts: { buffer: 0, oscillator: 0 },
    created: [],
    keyLog: [],
  }
  const AC = window.AudioContext || window.webkitAudioContext
  if (AC) {
    const origGain = AC.prototype.createGain
    AC.prototype.createGain = function (...args) {
      const node = origGain.apply(this, args)
      probe.gains.push(node)
      return node
    }
  }
  const wrapStart = (Ctor, kind) => {
    if (!Ctor || !Ctor.prototype || typeof Ctor.prototype.start !== 'function') return
    const orig = Ctor.prototype.start
    Ctor.prototype.start = function (...args) {
      probe.starts[kind] += 1
      probe.created.push({ kind, t: performance.now() })
      return orig.apply(this, args)
    }
  }
  wrapStart(window.AudioBufferSourceNode, 'buffer')
  wrapStart(window.OscillatorNode, 'oscillator')
  window.addEventListener(
    'keydown',
    (e) => probe.keyLog.push({ type: e.type, key: e.key, code: e.code, target: e.target?.tagName ?? null }),
    true,
  )
})()
`

let cdp = new Cdp(target.webSocketDebuggerUrl)
await cdp.send('Page.enable')
await cdp.send('Runtime.enable')
await cdp.send('Log.enable')
await cdp.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: false,
})
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })

const URL = `http://${HOST}:${PORT}/?debug=1`
await cdp.send('Page.navigate', { url: URL })
await waitFor(() => cdp.eval('!!window.__goblinTower && !!window.__audioProbe'), 20000, '游戏 + 探针')

const readDebug = async () => {
  const text = await cdp.eval(`document.querySelector('#debug-overlay')?.textContent ?? ''`)
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const readState = async () =>
  cdp.eval(`(() => {
    const g = window.__goblinTower
    const probe = window.__audioProbe
    const gains = probe.gains.map((n) => Number(n.gain.value.toFixed(4)))
    return {
      phase: g.phase,
      layer: g.run?.layer,
      hudMuted: g.hud.muted,
      chipHidden: document.querySelector('.js-mute')?.hidden ?? null,
      chipText: document.querySelector('.js-mute')?.textContent ?? null,
      pauseMuteText: document.querySelector('.js-pause-mute')?.textContent ?? null,
      pauseOpen: document.querySelector('.js-pause')?.classList.contains('is-open') ?? null,
      masterGain: gains[0] ?? null,
      gains,
      starts: { ...probe.starts },
      keyLog: probe.keyLog.slice(-6),
    }
  })()`)

// 等音频素材加载完，避免 BGM 从合成切到 wav 时多出一次 buffer.start，干扰 SFX 计数。
await waitFor(async () => {
  const dbg = await readDebug()
  return dbg?.audio?.state === 'ready' && (dbg?.audio?.loaded?.length ?? 0) > 0
}, 20000, '音频素材 ready')

// 先点一下页面解锁音频（虽已加 autoplay 参数，仍模拟真实用户手势）。
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 })
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 })
await sleep(200)

await cdp.eval(`(() => {
  const g = window.__goblinTower
  g.hud.hideEnd()
  g.startRun('mutsumi', 'normal', 'mutsumi-solo')
  return true
})()`)
await waitFor(async () => (await cdp.eval('window.__goblinTower.phase')) === 'playing', 8000, '开局')
await sleep(700)

const result = {
  url: URL,
  browser: BROWSER,
  startedAt: new Date().toISOString(),
  steps: [],
  findings: [],
}

const record = async (name, extra = {}) => {
  const state = await readState()
  const dbg = await readDebug()
  const row = {
    name,
    ...extra,
    masterGain: state.masterGain,
    gains: state.gains,
    hudMuted: state.hudMuted,
    chipHidden: state.chipHidden,
    chipText: state.chipText,
    pauseMuteText: state.pauseMuteText,
    pauseOpen: state.pauseOpen,
    audioStatus: dbg?.audio ?? null,
    starts: state.starts,
    keyLog: state.keyLog,
  }
  result.steps.push(row)
  console.log(
    `[${name}] master=${row.masterGain} muted=${row.hudMuted} chipHidden=${row.chipHidden} ` +
      `pause="${row.pauseMuteText}" audio=${row.audioStatus?.state}/${row.audioStatus?.muted} starts=${JSON.stringify(row.starts)}`,
  )
  return row
}

const before = await record('initial-unmuted')

// 1) M 热键静音
const startsBeforeMuteOpen = before.starts
await cdp.keyM()
await sleep(600)
const muted = await record('after-M-mute', { keyExpected: 'KeyM', keySeen: (await readState()).keyLog })
if (muted.masterGain === 0) result.findings.push('M 热键后 master gain 归零')
else result.findings.push(`M 热键后 master gain 未归零：${muted.masterGain}`)
if (muted.hudMuted && muted.chipHidden === false && muted.pauseMuteText === '静音：开') {
  result.findings.push('M 热键后 HUD 芯片与暂停按钮文案同步')
} else {
  result.findings.push('M 热键后 HUD 状态未同步')
}
if (muted.audioStatus?.muted === true) result.findings.push('AudioBus.status().muted = true')

// 2) 静音时打开暂停：click() 应被 play() 早退，不应新增音源
await cdp.eval('window.__goblinTower.togglePausePublic()')
await sleep(350)
const mutedPause = await record('muted-open-pause')
const mutedSfxDelta = mutedPause.starts.buffer - startsBeforeMuteOpen.buffer
if (mutedSfxDelta === 0) result.findings.push('静音时暂停点击音效未创建音源（play() 早退）')
else result.findings.push(`静音时仍新增 ${mutedSfxDelta} 个 buffer 音源`)

// 3) 暂停菜单按钮恢复
await cdp.eval(`document.querySelector('.js-pause-mute')?.click()`)
await sleep(500)
const unmutedByButton = await record('pause-button-unmute')
if (unmutedByButton.masterGain > 0.5) result.findings.push('暂停菜单按钮可恢复 master gain')
else result.findings.push(`暂停菜单按钮恢复后 master gain 仍为 ${unmutedByButton.masterGain}`)
if (unmutedByButton.audioStatus?.muted === false) result.findings.push('暂停菜单按钮同步 AudioBus.muted = false')

// 4) 非静音时暂停：click() 应新增音源（对照组）
const startsBeforeUnmutedClick = unmutedByButton.starts
await cdp.eval('window.__goblinTower.togglePausePublic()')
await sleep(350)
const unmutedPause = await record('unmuted-open-pause')
const unmutedSfxDelta = unmutedPause.starts.buffer - startsBeforeUnmutedClick.buffer
if (unmutedSfxDelta >= 1) result.findings.push(`非静音时暂停点击新增 ${unmutedSfxDelta} 个 buffer 音源（对照组有效）`)
else result.findings.push(`非静音对照组未新增音源（${unmutedSfxDelta}），计数可能受 BGM 影响`)

// 5) 暂停按钮再次静音
await cdp.eval(`document.querySelector('.js-pause-mute')?.click()`)
await sleep(500)
const mutedByButton = await record('pause-button-mute')
if (mutedByButton.masterGain === 0) result.findings.push('暂停菜单按钮可静音（master = 0）')
else result.findings.push(`暂停菜单按钮静音后 master gain = ${mutedByButton.masterGain}`)

// 6) 刷新后是否保留
// 注意：同一 target 二次 Page.navigate 在 Edge headless 下会卡住（渲染进程不返回），
// 因此新开一个 target 模拟“重新打开页面”。静音状态本来就没有持久化，结果等价。
console.log('\n[reload] 新开 target，模拟重新打开页面…')
const freshTarget = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' }).then((r) =>
  r.json(),
)
const cdp2 = new Cdp(freshTarget.webSocketDebuggerUrl)
await cdp2.send('Page.enable')
await cdp2.send('Runtime.enable')
await cdp2.send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  mobile: false,
})
await cdp2.send('Page.addScriptToEvaluateOnNewDocument', { source: PROBE })
void cdp2.send('Page.navigate', { url: URL }).catch(() => {})
await sleep(1500)
await waitFor(() => cdp2.eval('!!window.__goblinTower && !!window.__audioProbe'), 20000, '新页面游戏 + 探针')
cdp = cdp2
await waitFor(async () => {
  const dbg = await readDebug()
  return dbg?.audio?.state === 'ready' && (dbg?.audio?.loaded?.length ?? 0) > 0
}, 20000, '新页面音频 ready').catch(() => null)
await sleep(300)
const afterReload = await record('after-reload')
if (afterReload.hudMuted === false && afterReload.audioStatus?.muted === false) {
  result.findings.push('刷新后静音状态重置为未静音（无持久化，属当前设计）')
} else {
  result.findings.push('刷新后静音状态被保留')
}

result.ok = true
result.finishedAt = new Date().toISOString()
writeFileSync(OUT, JSON.stringify(result, null, 2))
console.log(`\n结果写入 ${OUT}`)
console.log('findings:')
for (const f of result.findings) console.log(` - ${f}`)

cdp.close()
chrome.kill()
httpServer.close()
setTimeout(() => process.exit(0), 300).unref()
