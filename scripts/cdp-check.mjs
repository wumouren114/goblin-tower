/**
 * 本地无头浏览器联调小工具（不是运行时依赖）
 * 用法：node scripts/cdp-check.mjs <url> <out.png> [width] [height]
 * 会在页面上执行 window.__cdpActions（本文件内置 v4.6 检查脚本），并输出日志与截图。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BROWSERS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
const url = process.argv[2] ?? 'http://127.0.0.1:5173/?autostart=normal&floor=3&char=mutsumi&style=mutsumi-solo'
const out = path.resolve(process.argv[3] ?? 'shots/cdp-check.png')
const width = Number(process.argv[4] ?? 1570)
const height = Number(process.argv[5] ?? 873)
if (!browser) throw new Error('未找到 Edge/Chrome')

const port = 9455 + Math.floor(Math.random() * 200)
const profile = path.join(os.tmpdir(), `gt-cdp-${Date.now()}`)
const proc = spawn(
  browser,
  [
    '--headless',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${width},${height}`,
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    url,
  ],
  { stdio: 'ignore', windowsHide: true },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  let tab = null
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      tab = list.find((t) => t.type === 'page' && t.url.startsWith('http')) ?? list[0]
      if (tab?.webSocketDebuggerUrl) break
    } catch {}
    await sleep(250)
  }
  if (!tab) throw new Error('CDP 页面连接失败')

  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  let nextId = 1
  const pending = new Map()
  const errors = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text ?? 'runtime exception')
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalJs = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text)
    return res.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(2500)

  const actions = `
    (async () => {
      const g = window.__goblinTower;
      if (!g) return { error: 'game missing' };
      const log = [];
      const snap = () => ({
        phase: g.phase, layer: g.run?.layer, style: g.run?.style,
        hp: Math.round(g.player?.hp ?? 0), maxHp: Math.round(g.player?.stats?.maxHp ?? 0),
        resource: g.combat?.resource, shield: Math.round(g.shieldHp ?? 0),
        awakening: g.awakeningActive, bonus: g.bonusActive,
        awakenings: g.run?.awakenings, awakeningLayers: g.run?.awakeningLayers,
        minions: g.combat?.minionCount, transform: g.combat?.transformActive,
        combatAwakenings: g.combat?.awakenings,
      });
      const q = new URLSearchParams(location.search);
      if (g.phase === 'title') {
        const charId = q.get('pickchar') ?? 'mutsumi';
        const styleId = q.get('pickstyle') ?? 'mutsumi-requiem';
        document.querySelector('.char-card[data-char="' + charId + '"]')?.click();
        document.querySelector('.style-card[data-style="' + styleId + '"]')?.click();
        document.querySelector('.js-start')?.click();
        await new Promise((resolve) => setTimeout(resolve, 250));
        log.push({ step: 'title-start', charId, styleId, ...snap() });
      }
      log.push({ step: 'start', ...snap() });
      g.debugAutoAttack(true);
      g.debugAdvance(8);
      log.push({ step: 'after8s', ...snap() });
      // 风格资源/技能：直接补满资源并攻击，验证 HUD 与战斗不崩
      if (g.combat) {
        g.combat.grantCharge(1);
        const aimedAt = { x: g.player.x, z: g.player.z - 3 };
        const played = g.combat.trySkill(g.player.x, g.player.z, aimedAt.x, aimedAt.z, g.buildWorld());
        log.push({ step: 'skill', played, ...snap() });
        g.debugAdvance(0.15);
        log.push({ step: 'skill-after-tick', ...snap() });
      }
      if (new URLSearchParams(location.search).get('awaken') !== '0') {
        // 强制打开觉醒二选一（3 层）
        g.debugScreen('awakening');
        log.push({ step: 'awakening-open', ...snap() });
        const first = document.querySelector('.tunnel-card');
        if (first) first.click();
        const confirm = document.querySelector('.tunnel-confirm');
        if (confirm) confirm.click();
        log.push({ step: 'awakening-picked', ...snap() });
        if (new URLSearchParams(location.search).get('reload') === '1') {
          g.debugSaveLoadLoop();
          await new Promise((resolve) => setTimeout(resolve, 150));
          log.push({ step: 'save-load', ...snap() });
        }
      }
      return { log };
    })()
  `
  const result = await evalJs(actions)
  await sleep(800)
  const shot = await send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log(JSON.stringify(result, null, 2))
  console.log('screenshot:', out)
  ws.close()
}

try {
  await main()
} finally {
  proc.kill()
  await sleep(300)
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
}
