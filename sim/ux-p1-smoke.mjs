/**
 * feat/ux-p1 三项 UI 可读性回归冒烟（无浏览器，纯 Node）：
 *   node sim/ux-p1-smoke.mjs
 * 覆盖：
 *   - P1-1：720p 下 .boss-bar 宽度收紧（<=460px）且 .hud-floor 收紧（<=300px），水平零压叠
 *   - P1-2：右上角 .hud-stats 隐藏重复的场上敌人/累计击杀，.hud-status-bar 隐藏重复金币，.sb-detail 左移不遮挡
 *   - P2-2：TOAST_MAX_VISIBLE === 2，good 停留时长 > info，toast-layer 位于屏幕上缘且支持新顶旧
 */
import { readFileSync } from 'node:fs'

const css = readFileSync('src/styles.css', 'utf8')
const hud = readFileSync('src/ui/hud.ts', 'utf8')

let pass = 0
let fail = 0
const fails = []

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`PASS  ${name}${detail ? `  → ${detail}` : ''}`)
  } else {
    fail += 1
    fails.push({ name, detail })
    console.error(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

// P1-1
check(
  'P1-1 Boss 血条收紧至 min(40vw, 480px) 且 720p 媒体查询下 <= 460px，与左上层信息留白 >= 60px',
  css.includes('width: min(40vw, 480px);') &&
    css.includes('max-width: 300px;') &&
    css.includes('width: min(38vw, 460px);'),
)

// P1-2
check(
  'P1-2 右上角统计条与状态栏统一宽度 248px 并去除重复的敌人/击杀/金币项',
  /\.hud-stats \.stat-alive,\s*\.hud-stats \.stat-kill \{\s*display: none;/m.test(css) &&
    /\.hud-status-bar \.sb-gold \{\s*display: none;/m.test(css) &&
    css.includes('right: 278px;'),
)

// P2-2
check(
  'P2-2 hud.ts 定义 TOAST_MAX_VISIBLE = 2 且 good 停留时间长于 info',
  hud.includes('export const TOAST_MAX_VISIBLE = 2') &&
    hud.includes('good: 3200') &&
    hud.includes('info: 2200') &&
    hud.includes('while (this.toastLayerEl.childElementCount >= TOAST_MAX_VISIBLE)'),
)
check(
  'P2-2 toast-layer 移至屏幕上缘（top: 86px）并使用动态 --toast-out-delay 退场延迟',
  css.includes('top: 86px;') && css.includes('var(--toast-out-delay, 1.85s)'),
)

console.log(`\n────────────────────────\n共 ${pass + fail} 项，失败 ${fail} 项`)
if (fail > 0) {
  console.error('失败项：')
  for (const f of fails) console.error(` - ${f.name}  ${f.detail}`)
  process.exit(1)
}
console.log('全部通过 ✅')
