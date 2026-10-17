// 无头 Edge 截图工具：node scripts/shot.mjs <url> [out.png] [budgetMs] [width] [height]
// 用于在不打开真实浏览器的情况下验证 WebGL 场景是否正常渲染。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'

const CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]

const [url, outArg = 'shots/shot.png', budgetArg = '9000', widthArg = '1600', heightArg = '900'] = process.argv.slice(2)

if (!url) {
  console.error('用法: node scripts/shot.mjs <url> [out.png] [budgetMs] [width] [height]')
  process.exit(1)
}

const browser = CANDIDATES.find((p) => existsSync(p))
if (!browser) {
  console.error('未找到 Edge/Chrome 可执行文件')
  process.exit(1)
}

const out = path.resolve(process.cwd(), outArg)
mkdirSync(path.dirname(out), { recursive: true })
if (existsSync(out)) rmSync(out, { force: true })

const result = spawnSync(
  browser,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--mute-audio',
    `--window-size=${widthArg},${heightArg}`,
    `--virtual-time-budget=${budgetArg}`,
    `--screenshot=${out}`,
    url,
  ],
  { stdio: 'ignore', timeout: 90_000, windowsHide: true },
)

if (result.error) {
  console.error('启动浏览器失败:', result.error.message)
  process.exit(1)
}

if (existsSync(out)) {
  console.log(`OK ${out} (${statSync(out).size} bytes)`)
} else {
  console.error(`FAILED 没有生成截图: ${out}`)
  process.exit(1)
}
