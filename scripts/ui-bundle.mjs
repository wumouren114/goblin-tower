// 临时：把 scripts/ui-preview.ts 打包成自包含 HTML（沙箱里 vite 起不来时用 file:// 截图）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rolldown } from 'rolldown'

const screens = [
  'title',
  'charselect',
  'tunnel',
  'shop',
  'inventory',
  'pause',
  'savesave',
  'saveload',
  'defeat-hp',
  'victory',
  'hud',
  'boss',
]

const bundle = await rolldown({ input: 'scripts/ui-preview.ts' })
const { output } = await bundle.generate({ format: 'iife', name: 'UiPreview', inlineDynamicImports: true })
const js = output.map((o) => ('code' in o ? o.code : '')).join('')
const css = readFileSync('src/styles.css', 'utf8')

mkdirSync('shots/ui-preview', { recursive: true })
for (const screen of screens) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>UI ${screen}</title>
<style>${css}</style>
</head>
<body>
<div id="app"><canvas id="game"></canvas><div id="ui-root"></div></div>
<script>window.__SCREEN = ${JSON.stringify(screen)};</script>
<script>${js}</script>
</body>
</html>`
  writeFileSync(`shots/ui-preview/${screen}.html`, html)
}
console.log(`wrote ${screens.length} pages, js=${Math.round(js.length / 1024)}KB css=${Math.round(css.length / 1024)}KB`)
