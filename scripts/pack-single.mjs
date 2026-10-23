// 打包成「双击就能玩」的单文件 HTML：把 JS/CSS/PNG/WAV 全部内联成 data:
// 用法：node scripts/pack-single.mjs
// 产物：dist/残响高塔-单文件版.html（约 15MB），可以在 file:// 下直接打开，
// 也可以直接发给别人（微信/网盘/邮件），不需要 Node、不需要服务器。
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIST = path.join(ROOT, 'dist')

console.log('[pack] vite build …')
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' })

const assetsDir = path.join(DIST, 'assets')
if (!existsSync(assetsDir)) throw new Error('dist/assets 不存在，build 失败？')

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
}

const files = readdirSync(assetsDir)
const dataUrl = new Map()
let assetBytes = 0
for (const name of files) {
  const ext = path.extname(name).toLowerCase()
  const mime = MIME[ext]
  if (!mime) continue
  const buf = readFileSync(path.join(assetsDir, name))
  assetBytes += buf.length
  dataUrl.set(`/assets/${name}`, `data:${mime};base64,${buf.toString('base64')}`)
  // CSS 里可能出现 url(assets/xxx) / url(./assets/xxx) 两种相对写法
  dataUrl.set(`./assets/${name}`, dataUrl.get(`/assets/${name}`))
  dataUrl.set(`assets/${name}`, dataUrl.get(`/assets/${name}`))
}

/** 把一段文本里的资源 URL 全部换成 data: */
function inlineUrls(text) {
  let out = text
  // 长的先替换，避免 assets/index-xx.js 与 index-xx.js.map 之类前缀冲突
  const keys = [...dataUrl.keys()].sort((a, b) => b.length - a.length)
  for (const key of keys) out = out.split(key).join(dataUrl.get(key))
  return out
}

const htmlPath = path.join(DIST, 'index.html')
let html = readFileSync(htmlPath, 'utf8')

// 1) 内联 <script type="module" src=...>（保留 type="module"：Vite 产物里可能有
//    import.meta / 顶层 await 等只有 module 才合法的语法）
html = html.replace(/<script([^>]*?)src="([^"]+)"([^>]*)><\/script>/g, (m, pre, src, post) => {
  const file = path.join(DIST, src.replace(/^\//, ''))
  if (!existsSync(file)) return m
  let code = readFileSync(file, 'utf8')
  code = inlineUrls(code)
  const attrs = (pre + post)
    .replace(/\scrossorigin(="[^"]*")?/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `<script${attrs ? ' ' + attrs : ''}>${code}</script>`
})

// 2) 内联 <link rel="stylesheet" href=...>
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (m, href) => {
  const file = path.join(DIST, href.replace(/^\//, ''))
  if (!existsSync(file)) return m
  const css = inlineUrls(readFileSync(file, 'utf8'))
  return `<style>${css}</style>`
})

// 3) HTML 里可能还有内联的 url(/assets/...)
html = inlineUrls(html)

const outName = '残响高塔-单文件版.html'
const outPath = path.join(DIST, outName)
writeFileSync(outPath, html, 'utf8')
const size = statSync(outPath).size
console.log(
  `[pack] ✅ ${outPath}\n        ${(size / 1024 / 1024).toFixed(1)}MB（内联资源 ${(assetBytes / 1024 / 1024).toFixed(1)}MB）`,
)
