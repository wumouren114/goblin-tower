// 同一页面连拍多帧：用 CDP 截图，排查「画面闪烁」这类逐帧问题。
// 用法：node scripts/frames.mjs <url> [outDir] [count] [intervalMs] [width] [height]
// 依赖：本机 Edge/Chrome + 内置 WebSocket（Node 22+ 自带）。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const [url, outArg = 'scripts/out/frames', countArg = '12', intervalArg = '120', widthArg = '1280', heightArg = '720'] =
  process.argv.slice(2)
if (!url) {
  console.error('用法: node scripts/frames.mjs <url> [outDir] [count] [intervalMs] [width] [height]')
  process.exit(1)
}

const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error('未找到 Edge/Chrome 可执行文件')
  process.exit(1)
}

const outDir = path.resolve(process.cwd(), outArg)
mkdirSync(outDir, { recursive: true })
for (const f of ['profile', 'shots']) rmSync(path.join(outDir, f), { recursive: true, force: true })
mkdirSync(path.join(outDir, 'shots'), { recursive: true })

const port = 9333 + Math.floor(Math.random() * 200)
const profile = path.join(outDir, 'profile')
const proc = spawn(
  browser,
  [
    '--headless',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    `--window-size=${widthArg},${heightArg}`,
    url,
  ],
  { stdio: 'ignore', windowsHide: true },
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来 */
    }
    await sleep(150)
  }
  throw new Error('CDP 目标未就绪')
}

const page = await targets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

let msgId = 0
const pending = new Map()
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
})
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve) => {
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

await send('Page.enable')
await sleep(2500)

const count = Math.max(1, Number(countArg) || 12)
const interval = Math.max(0, Number(intervalArg) || 120)
for (let i = 0; i < count; i += 1) {
  const res = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const data = res?.result?.data
  if (!data) {
    console.error(`第 ${i} 帧截图失败`, JSON.stringify(res).slice(0, 200))
    continue
  }
  writeFileSync(path.join(outDir, 'shots', `frame_${String(i).padStart(2, '0')}.png`), Buffer.from(data, 'base64'))
  await sleep(interval)
}

ws.close()
proc.kill()
await sleep(300)
console.log(`OK ${outDir}/shots/frame_00..${String(count - 1).padStart(2, '0')}.png`)
