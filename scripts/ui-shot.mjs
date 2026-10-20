// 临时：批量截取 v3 UI 各界面（先起 vite dev server）
// 用法：node scripts/ui-shot.mjs [baseUrl=http://127.0.0.1:5199]
import { spawnSync } from 'node:child_process'

const base = process.argv[2] ?? 'http://127.0.0.1:5199'
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

let fails = 0
for (const s of screens) {
  const url = `${base}/scripts/ui-preview.html?screen=${s}`
  const out = `shots/ui-${s}.png`
  const r = spawnSync(process.execPath, ['scripts/shot.mjs', url, out, '4500', '1440', '900'], {
    stdio: 'inherit',
    windowsHide: true,
  })
  if (r.status !== 0) fails += 1
  console.log(`${r.status === 0 ? 'OK  ' : 'FAIL'} ${s} -> ${out}`)
}

console.log(fails === 0 ? 'ALL OK' : `${fails} FAILED`)
process.exit(fails === 0 ? 0 : 1)
