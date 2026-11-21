/**
 * 真浏览器抽查脚本（Headless Chromium / Edge CDP）：
 * 启动 dist/ 静态服务 → 逐一打开 6 个关键流程页面 → 捕获 console error / uncaught exception →
 * 检查关键 DOM 元素可见性 → 输出 6 张 PNG 截图到 shots/full-matrix/。
 *
 * 运行：node scripts/browser-matrix-check.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PORT = 5199
const CDP_PORT = 9223
const OUT_DIR = path.resolve(process.cwd(), 'shots/full-matrix')
mkdirSync(OUT_DIR, { recursive: true })

const BROWSER_CANDIDATES = [
  process.env.CHROME_BIN,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

const browserBin = BROWSER_CANDIDATES.find((p) => existsSync(p))
if (!browserBin) {
  console.error('未找到可用的 Chromium / Chrome / Edge 可执行文件')
  process.exit(1)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
    } catch {
      /* retry */
    }
    await sleep(200)
  }
  throw new Error(`等待 ${url} 超时`)
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.id = 0
    this.pending = new Map()
    this.events = []
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve)
      this.ws.addEventListener('error', reject)
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      } else if (msg.method) {
        this.events.push(msg)
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
  clearEvents() {
    this.events.length = 0
  }
  close() {
    this.ws.close()
  }
}

const HOST = '127.0.0.2'
const DIST_ROOT = path.resolve(process.cwd(), 'dist')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
}
const httpServer = createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(DIST_ROOT, url === '/' ? 'index.html' : url)
  if (!existsSync(file) || !statSync(file).isFile()) file = path.join(DIST_ROOT, 'index.html')
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' })
  createReadStream(file).pipe(res)
}).listen(PORT, HOST)
const serverProc = { kill: () => httpServer.close() }

const userDataDir = path.join(os.tmpdir(), `gt-cdp-matrix-${Date.now()}`)
const chromeProc = spawn(
  browserBin,
  [
    '--headless',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-sandbox',
    '--no-proxy-server',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--mute-audio',
    '--window-size=1280,720',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const SCENES = [
  {
    id: '01-start-mutsumi',
    label: '开局画面（?autostart=normal&char=mutsumi）',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42&warmup=1`,
    setupExpr: null,
    checkExpr: `(() => {
      const c = document.querySelector('#game');
      const fatal = document.querySelector('#fatal-overlay');
      const hudText = document.body.innerText || '';
      return {
        ok: Boolean(c) && !fatal && hudText.includes('第 1 层') || hudText.includes('云上花庭'),
        detail: 'canvas=' + Boolean(c) + ', fatal=' + Boolean(fatal) + ', textLen=' + hudText.length
      };
    })()`,
  },
  {
    id: '02-potential-after-l1',
    label: '第 1 层清完弹潜能三选一',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42&screen=potential`,
    setupExpr: null,
    checkExpr: `(() => {
      const text = document.body.innerText || '';
      const hasBranches = text.includes('节奏') && text.includes('交响') && text.includes('双重人格');
      return { ok: hasBranches, detail: 'hasAll3Branches=' + hasBranches };
    })()`,
  },
  {
    id: '03-three-doors',
    label: '三扇时空隧道门',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42&screen=tunnel`,
    setupExpr: null,
    checkExpr: `(() => {
      const cards = document.querySelectorAll('.tunnel-card, [data-tunnel-id], .offer-card');
      const buttons = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
      const text = document.body.innerText || '';
      const ok = cards.length >= 3 || (text.includes('时空隧道') || text.includes('选择') || buttons.length >= 3);
      return { ok, detail: 'cards=' + cards.length + ', visibleButtons=' + buttons.length };
    })()`,
  },
  {
    id: '04-reward-room-dialogue',
    label: '奖励关 NPC 对话与三选一',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42`,
    setupExpr: `(() => {
      const g = window.__goblinTower;
      if (!g || typeof g.openRewardRoom !== 'function') return 'no-openRewardRoom';
      g.openRewardRoom('chest', { uid: 'test-card', kind: 'buff-card', name: '蓝·魔力药剂', desc: '伤害 +18%', icon: '✨', tier: 1, stat: 'magic', value: 18 });
      return 'opened';
    })()`,
    checkExpr: `(() => {
      const text = document.body.innerText || '';
      const ok = text.includes('宝藏密室') && text.includes('直接领取') && text.includes('换成金币') && text.includes('赌一把');
      return { ok, detail: 'hasRewardDialogueAnd3Opts=' + ok };
    })()`,
  },
  {
    id: '05-altar-choices',
    label: '祭坛献祭多选一（四档祭坛）',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42`,
    setupExpr: `(() => {
      const g = window.__goblinTower;
      if (!g || typeof g.openAltar !== 'function') return 'no-openAltar';
      g.openAltar();
      return 'opened';
    })()`,
    checkExpr: `(() => {
      const text = document.body.innerText || '';
      const has3 = text.includes('噬词的祭坛') && text.includes('枯血的祭坛') && text.includes('刻契的祭坛');
      const has4th = text.includes('盲筹的祭坛');
      return { ok: has3, detail: 'has3AltarCards=' + has3 + ', has4thMysteryCard=' + has4th };
    })()`,
  },
  {
    id: '06-key-guide-bar',
    label: '键位引导条（Q+F 解锁状态）',
    url: `http://127.0.0.2:${PORT}/?autostart=normal&char=mutsumi&seed=42&potential=mutsumi-rhythm&pnodes=mutsumi-rhythm-combo,mutsumi-rhythm-mercy&warmup=1`,
    setupExpr: null,
    checkExpr: `(() => {
      const bar = document.querySelector('.key-guide, .key-guide-bar, [class*="key-guide"]');
      const text = bar ? bar.innerText : (document.body.innerText || '');
      const ok = Boolean(bar) && (text.includes('Q') || text.includes('F') || text.includes('推敌'));
      return { ok, detail: 'barFound=' + Boolean(bar) + ', barText=' + JSON.stringify((bar?.innerText || '').replace(/\\s+/g, ' ').slice(0, 80)) };
    })()`,
  },
]

const report = []

try {
  await waitForHttp(`http://127.0.0.2:${PORT}/`)
  const listRes = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const targets = await listRes.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error('未找到 CDP 页面 target')

  const cdp = new CdpClient(page.webSocketDebuggerUrl)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Log.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  })

  for (const s of SCENES) {
    cdp.clearEvents()
    await cdp.send('Runtime.evaluate', { expression: 'window.__goblinTower = null' }).catch(() => {})
    await cdp.send('Page.navigate', { url: s.url })
    await sleep(3200)

    if (s.setupExpr) {
      await cdp.send('Runtime.evaluate', { expression: s.setupExpr, returnByValue: true })
      await sleep(800)
    }

    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: s.checkExpr,
      returnByValue: true,
    })
    const check = evalRes.result?.value ?? { ok: false, detail: 'eval-failed' }

    const errors = cdp.events
      .filter(
        (e) =>
          e.method === 'Runtime.exceptionThrown' ||
          (e.method === 'Runtime.consoleAPICalled' && e.params?.type === 'error') ||
          (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error'),
      )
      .map((e) => {
        if (e.method === 'Runtime.exceptionThrown') {
          return e.params?.exceptionDetails?.exception?.description || e.params?.exceptionDetails?.text
        }
        if (e.method === 'Runtime.consoleAPICalled') {
          return (e.params?.args ?? []).map((a) => a.value ?? a.description).join(' ')
        }
        return e.params?.entry?.text
      })

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const outPath = path.join(OUT_DIR, `${s.id}.png`)
    writeFileSync(outPath, Buffer.from(shot.data, 'base64'))

    const passed = Boolean(check.ok) && errors.length === 0
    report.push({ id: s.id, label: s.label, passed, detail: check.detail, errors, file: `shots/full-matrix/${s.id}.png` })
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${s.id} (${s.label}) → ${check.detail} | errors=${errors.length}`)
    if (errors.length > 0) console.error('   errors:', errors)
  }

  cdp.close()
} finally {
  chromeProc.kill('SIGKILL')
  serverProc.kill('SIGKILL')
}

const failed = report.filter((r) => !r.passed).length
console.log(`\n浏览器抽查完成：${report.length - failed}/${report.length} 通过，${failed} 失败`)
if (failed > 0) process.exitCode = 1
