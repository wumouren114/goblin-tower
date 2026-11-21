/**
 * 残响高塔 · 静音链路实测 v3（独立脚本，不改游戏源码）
 *
 * 返工修正（针对上一版两处硬伤）：
 *   1. 不再假设 gains[0] 是 master gain：每步完整记录全量 gains（序号 + 数值）与前后 diff，
 *      并同步记录 hudMuted、暂停按钮文案与 audio.status().muted；
 *   2. findings 仅记录异常/失败项，ok = (findings.length === 0)，不再把“脚本跑完”当“通过”；
 *   3. 对 M 热键先做最小三连复现（标题页 / 局内 / 焦点在按钮时），先区分派发与焦点再判真假 bug。
 *
 * 端口：127.0.0.2:5198 / CDP 9444（避开 lead 占用的 5188 / 9333）
 * 运行：node sim/mute-test.mjs
 * 产物：sim/mute-test-v3.json
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HOST = '127.0.0.2'
const PORT = 5198
const CDP_PORT = 9444
const DIST = path.resolve(process.cwd(), 'dist')
const OUT = path.resolve(process.cwd(), 'sim/mute-test-v3.json')
const PROFILE = path.join(process.cwd(), 'node_modules', '.cache', `gt-mute-v3-${Date.now()}`)
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
      return orig.apply(this, args)
    }
  }
  wrapStart(window.AudioBufferSourceNode, 'buffer')
  wrapStart(window.OscillatorNode, 'oscillator')
  window.addEventListener(
    'keydown',
    (e) =>
      probe.keyLog.push({
        t: Math.round(performance.now()),
        key: e.key,
        code: e.code,
        target: e.target?.tagName ?? null,
        active: document.activeElement?.tagName ?? null,
        defaultPrevented: e.defaultPrevented,
      }),
    false,
  )
})()
`

function diffGains(prevGains, nextGains) {
  const changes = []
  const maxLen = Math.max(prevGains.length, nextGains.length)
  for (let i = 0; i < maxLen; i += 1) {
    const before = prevGains[i]?.value ?? null
    const after = nextGains[i]?.value ?? null
    if (before !== after) changes.push({ idx: i, before, after })
  }
  return changes
}

let cdp = new Cdp(target.webSocketDebuggerUrl)
const result = {
  version: 3,
  url: `http://${HOST}:${PORT}/?debug=1`,
  browser: BROWSER,
  startedAt: new Date().toISOString(),
  mHotkeyMatrix: [],
  steps: [],
  notes: [],
  findings: [],
  ok: false,
}

try {
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

  await cdp.send('Page.navigate', { url: result.url })
  await waitFor(() => cdp.eval('!!window.__goblinTower && !!window.__audioProbe'), 20000, '游戏 + 探针')

  // 优先读 main.ts 在 ?debug=1 下挂出的实时只读句柄 window.__audio.status()，避免 #debug-overlay 500ms 刷新延迟
  const readAudioStatus = async () =>
    cdp.eval(`(() => {
      if (window.__audio && typeof window.__audio.status === 'function') {
        return window.__audio.status()
      }
      try {
        const parsed = JSON.parse(document.querySelector('#debug-overlay')?.textContent ?? '')
        return parsed?.audio ?? null
      } catch {
        return null
      }
    })()`)

  const readState = async () =>
    cdp.eval(`(() => {
      const g = window.__goblinTower
      const probe = window.__audioProbe
      const gains = probe.gains.map((n, idx) => ({ idx, value: Number(n.gain.value.toFixed(4)) }))
      return {
        phase: g.phase,
        layer: g.run?.layer ?? null,
        hudMuted: g.hud.muted,
        chipHidden: document.querySelector('.js-mute')?.hidden ?? null,
        chipText: document.querySelector('.js-mute')?.textContent ?? null,
        pauseMuteText: document.querySelector('.js-pause-mute')?.textContent ?? null,
        pauseOpen: document.querySelector('.js-pause')?.classList.contains('is-open') ?? null,
        activeElement: document.activeElement?.tagName ?? null,
        gainCount: gains.length,
        gains,
        starts: { ...probe.starts },
        keyLogLen: probe.keyLog.length,
        keyLogTail: probe.keyLog.slice(-4),
      }
    })()`)

  const record = async (name, extra = {}) => {
    const state = await readState()
    const audioSt = await readAudioStatus()
    const row = {
      name,
      ...extra,
      phase: state.phase,
      hudMuted: state.hudMuted,
      chipHidden: state.chipHidden,
      chipText: state.chipText,
      pauseMuteText: state.pauseMuteText,
      pauseOpen: state.pauseOpen,
      activeElement: state.activeElement,
      audioMuted: audioSt?.muted ?? null,
      audioState: audioSt?.state ?? null,
      gainCount: state.gainCount,
      gains: state.gains,
      starts: state.starts,
      keyLogTail: state.keyLogTail,
    }
    result.steps.push(row)
    const zeroCount = row.gains.filter((g) => g.value === 0).length
    console.log(
      `[${name}] phase=${row.phase} audioMuted=${row.audioMuted} hudMuted=${row.hudMuted} ` +
        `pause="${row.pauseMuteText}" gains=${row.gainCount}(zero:${zeroCount}) starts=${JSON.stringify(row.starts)}`,
    )
    return row
  }

  // 等待音频素材 ready
  await waitFor(async () => {
    const audioSt = await readAudioStatus()
    return audioSt?.state === 'ready' && (audioSt?.loaded?.length ?? 0) > 0
  }, 20000, '音频素材 ready')

  // 点击页面中心模拟用户手势解锁 AudioContext
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 360, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 640, y: 360, button: 'left', clickCount: 1 })
  await sleep(250)

  // ── A. M 热键最小三连复现（标题页 / 局内 / 焦点在按钮）──────────────
  const runMProbe = async (label) => {
    const before = await readState()
    const audioBefore = await readAudioStatus()
    await cdp.keyM()
    await sleep(400)
    const after = await readState()
    const audioAfter = await readAudioStatus()
    const newKeys = after.keyLogTail.slice(-(after.keyLogLen - before.keyLogLen))
    const keydownArrivedWindow = newKeys.some((k) => k.code === 'KeyM')
    const gainDiff = diffGains(before.gains, after.gains)
    const entry = {
      case: label,
      phase: after.phase,
      activeElementBefore: before.activeElement,
      keydownArrivedWindow,
      newKeys,
      audioMutedBefore: audioBefore?.muted ?? null,
      audioMutedAfter: audioAfter?.muted ?? null,
      hudMutedBefore: before.hudMuted,
      hudMutedAfter: after.hudMuted,
      pauseMuteTextAfter: after.pauseMuteText,
      gainDiff,
    }
    result.mHotkeyMatrix.push(entry)
    console.log(
      `[M-repro:${label}] arrived=${keydownArrivedWindow} audioMuted:${entry.audioMutedBefore}->${entry.audioMutedAfter} ` +
        `hudMuted:${entry.hudMutedBefore}->${entry.hudMutedAfter} gainDiff=${gainDiff.length}`,
    )
    return entry
  }

  // Case 1: 标题页按 M（先按一次切静音，再按一次恢复，便于对比）
  const mTitle = await runMProbe('title-screen')
  if (!mTitle.keydownArrivedWindow) {
    result.findings.push('M-repro(title): KeyM 未到达 window（派发/焦点问题）')
  } else if (mTitle.audioMutedAfter === mTitle.audioMutedBefore) {
    result.findings.push('M-repro(title): KeyM 已到达 window，但 audio.status().muted 未翻转')
  } else {
    result.notes.push(`M-repro(title): 标题页按 M 正常切换静音 (${mTitle.audioMutedBefore}→${mTitle.audioMutedAfter})`)
  }
  // 恢复未静音再进局内
  if (mTitle.audioMutedAfter === true) {
    await cdp.keyM()
    await sleep(300)
  }

  // 进入局内
  await cdp.eval(`(() => {
    const g = window.__goblinTower
    g.hud.hideEnd()
    g.startRun('mutsumi', 'normal', 'mutsumi-solo')
    return true
  })()`)
  await waitFor(async () => (await cdp.eval('window.__goblinTower.phase')) === 'playing', 8000, '开局')
  await sleep(600)
  const initial = await record('initial-playing-unmuted')

  // Case 2: 局内常规焦点按 M（静音）
  const mPlaying = await runMProbe('in-game-playing')
  const afterMPlaying = await record('after-M-playing-mute', { gainDiff: mPlaying.gainDiff })
  if (!mPlaying.keydownArrivedWindow) {
    result.findings.push('M-repro(playing): KeyM 未到达 window（派发/焦点问题）')
  } else if (afterMPlaying.audioMuted !== true || afterMPlaying.hudMuted !== true) {
    result.findings.push(
      `M-repro(playing): KeyM 已到达 window，但静音状态未同步（audio=${afterMPlaying.audioMuted}, hud=${afterMPlaying.hudMuted}）`,
    )
  } else if (!mPlaying.gainDiff.some((d) => d.after === 0)) {
    result.findings.push('M-repro(playing): audio.muted=true 但全量 gains 中无节点归零')
  } else {
    result.notes.push(`M-repro(playing): 局内按 M 静音成功，归零节点=${JSON.stringify(mPlaying.gainDiff.filter((d) => d.after === 0))}`)
  }

  // 静音时打开暂停菜单，检查 SFX 是否早退（不应新增 buffer 音源）
  const startsBeforeMutedPause = afterMPlaying.starts.buffer
  await cdp.eval('window.__goblinTower.togglePausePublic()')
  await sleep(350)
  const mutedPause = await record('muted-open-pause')
  const mutedSfxDelta = mutedPause.starts.buffer - startsBeforeMutedPause
  if (mutedSfxDelta !== 0) {
    result.findings.push(`静音状态下打开暂停仍新增 ${mutedSfxDelta} 个 buffer 音源`)
  } else {
    result.notes.push('静音时打开暂停未新增 buffer 音源（play() 早退生效）')
  }

  // Case 3: 焦点在按钮上按 M（把焦点显式放到暂停菜单按钮上，测试是否被吞键）
  await cdp.eval(`document.querySelector('.js-pause-mute')?.focus()`)
  await sleep(150)
  const mButtonFocus = await runMProbe('button-focused')
  const afterMButton = await record('after-M-button-focused', { gainDiff: mButtonFocus.gainDiff })
  if (!mButtonFocus.keydownArrivedWindow) {
    result.findings.push('M-repro(button-focused): 焦点在按钮时 KeyM 未到达 window')
  } else if (mButtonFocus.audioMutedAfter === mButtonFocus.audioMutedBefore) {
    result.findings.push('M-repro(button-focused): 焦点在按钮时 KeyM 到达 window 但静音状态未切换')
  } else {
    result.notes.push(`M-repro(button-focused): 焦点在按钮时按 M 正常切换 (${mButtonFocus.audioMutedBefore}→${mButtonFocus.audioMutedAfter})`)
  }

  // ── B. 暂停按钮静音 / 恢复 + 全量 gains diff 验证 ──────────────────
  // 确保先处于未静音态
  if (afterMButton.audioMuted === true) {
    await cdp.eval(`document.querySelector('.js-pause-mute')?.click()`)
    await sleep(400)
  }
  const beforeBtnMute = await record('before-pause-btn-mute')
  await cdp.eval(`document.querySelector('.js-pause-mute')?.click()`)
  await sleep(450)
  const afterBtnMute = await record('after-pause-btn-mute')
  const muteDiff = diffGains(beforeBtnMute.gains, afterBtnMute.gains)
  if (afterBtnMute.audioMuted !== true || afterBtnMute.hudMuted !== true || afterBtnMute.pauseMuteText !== '静音：开') {
    result.findings.push(
      `暂停按钮静音不同步：audio=${afterBtnMute.audioMuted}, hud=${afterBtnMute.hudMuted}, pause="${afterBtnMute.pauseMuteText}"`,
    )
  } else if (!muteDiff.some((d) => d.after === 0)) {
    result.findings.push(`暂停按钮静音后未观测到任何 gain 归零（diff=${JSON.stringify(muteDiff)}）`)
  } else {
    result.notes.push(`暂停按钮静音生效，归零节点=${JSON.stringify(muteDiff.filter((d) => d.after === 0))}`)
  }

  // 暂停按钮恢复
  await cdp.eval(`document.querySelector('.js-pause-mute')?.click()`)
  await sleep(450)
  const afterBtnUnmute = await record('after-pause-btn-unmute')
  const unmuteDiff = diffGains(afterBtnMute.gains, afterBtnUnmute.gains)
  if (afterBtnUnmute.audioMuted !== false || afterBtnUnmute.hudMuted !== false || afterBtnUnmute.pauseMuteText !== '静音：关') {
    result.findings.push(
      `暂停按钮恢复不同步：audio=${afterBtnUnmute.audioMuted}, hud=${afterBtnUnmute.hudMuted}, pause="${afterBtnUnmute.pauseMuteText}"`,
    )
  } else if (!unmuteDiff.some((d) => (d.before === 0 || d.before === null) && (d.after ?? 0) > 0)) {
    result.findings.push(`暂停按钮恢复后未观测到任何 gain 从 0 抬升（diff=${JSON.stringify(unmuteDiff)}）`)
  } else {
    result.notes.push(`暂停按钮恢复生效，回升节点=${JSON.stringify(unmuteDiff.filter((d) => (d.after ?? 0) > 0))}`)
  }

  // 非静音对照组：关闭暂停应触发 click() 新增 buffer 音源
  const startsBeforeUnmutedClick = afterBtnUnmute.starts.buffer
  await cdp.eval('window.__goblinTower.togglePausePublic()')
  await sleep(350)
  const afterUnmutedClose = await record('unmuted-close-pause')
  const unmutedSfxDelta = afterUnmutedClose.starts.buffer - startsBeforeUnmutedClick
  if (unmutedSfxDelta < 1) {
    result.findings.push(`非静音对照组未新增 buffer 音源（delta=${unmutedSfxDelta}）`)
  } else {
    result.notes.push(`非静音对照组新增 ${unmutedSfxDelta} 个 buffer 音源`)
  }

  // ── C. 刷新页面后静音状态重置（无持久化，属设计口径）────────────────
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
  void cdp2.send('Page.navigate', { url: result.url }).catch(() => {})
  await sleep(1200)
  await waitFor(() => cdp2.eval('!!window.__goblinTower && !!window.__audioProbe'), 20000, '新页面游戏 + 探针')
  cdp = cdp2
  await waitFor(async () => {
    const audioSt = await readAudioStatus()
    return audioSt?.state === 'ready' && (audioSt?.loaded?.length ?? 0) > 0
  }, 20000, '新页面音频 ready').catch(() => null)
  await sleep(300)
  const afterReload = await record('after-reload')
  if (afterReload.hudMuted !== false || afterReload.audioMuted !== false) {
    result.findings.push(`刷新后静音状态未重置：hud=${afterReload.hudMuted}, audio=${afterReload.audioMuted}`)
  } else {
    result.notes.push('刷新后静音状态重置为未静音（无持久化）')
  }

  if (cdp.errors.length > 0) {
    result.findings.push(`页面运行时异常：${cdp.errors.slice(0, 3).join(' | ')}`)
  }
  result.ok = result.findings.length === 0
  result.finishedAt = new Date().toISOString()
  writeFileSync(OUT, JSON.stringify(result, null, 2))
  console.log(`\n结果写入 ${OUT}  ok=${result.ok}  findings=${result.findings.length}`)
  if (result.findings.length) {
    console.log('findings:')
    for (const f of result.findings) console.log(` - ${f}`)
    process.exitCode = 1
  }
} finally {
  cdp.close()
  chrome.kill()
  httpServer.close()
  await sleep(250)
  try {
    rmSync(PROFILE, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
