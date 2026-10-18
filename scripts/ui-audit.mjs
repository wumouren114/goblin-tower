// 临时：HUD DOM 结构自查（截图不可用时的替代验证）
import { readFileSync } from 'node:fs'

const hud = readFileSync('src/ui/hud.ts', 'utf8')
const css = readFileSync('src/styles.css', 'utf8')
const types = readFileSync('src/types.ts', 'utf8')

const problems = []

/* 1) 模板里的 js-* 钩子 vs 代码里查询的 js-* */
const inTemplate = new Set(
  [...hud.matchAll(/class="([^"]*)"/g)]
    .flatMap((m) => m[1].split(/\s+/))
    .filter((c) => c.startsWith('js-')),
)
const queried = new Set([...hud.matchAll(/this\.q[<(][^>]*>?\('\.(js-[\w-]+)'\)/g)].map((m) => m[1]))
// 兼容 this.q('.x') 与 this.q<HTMLElement>('.x')
for (const m of hud.matchAll(/'\.(js-[\w-]+)'/g)) queried.add(m[1])

const missingInTemplate = [...queried].filter((c) => !inTemplate.has(c))
if (missingInTemplate.length) problems.push(`查询了但模板里没有：${missingInTemplate.join(', ')}`)

const unusedHooks = [...inTemplate].filter((c) => !queried.has(c) && !hud.includes(`.${c}`))
if (unusedHooks.length) problems.push(`模板有但从未使用：${unusedHooks.join(', ')}`)

/* 2) 模板结构：标签闭合是否平衡（未闭合的 <button>/<section> 会吞掉后续兄弟节点） */
const templateSrc = hud.slice(hud.indexOf('const UI_TEMPLATE'), hud.indexOf('/* ------------------------------------------------------------------ */\n/* 实现'))
const TAGS = ['div', 'button', 'section', 'span', 'p', 'b', 'i', 'kbd', 'h2', 'h3', 'h4', 'ul', 'li', 'strong', 'em', 'small']
for (const tag of TAGS) {
  const opens = (templateSrc.match(new RegExp(`<${tag}\\b`, 'g')) || []).length
  const closes = (templateSrc.match(new RegExp(`</${tag}>`, 'g')) || []).length
  if (opens !== closes) problems.push(`模板 <${tag}> 不平衡：开 ${opens} / 闭 ${closes}`)
}

/* 3) 代码里用到的非 js-* 视觉 class 必须在 styles.css 里有定义 */
const visualClasses = new Set()
for (const m of hud.matchAll(/classList\.(?:add|remove|toggle)\('([\w-]+)'/g)) visualClasses.add(m[1])
for (const m of hud.matchAll(/class="([^"]*)"/g)) {
  for (const c of m[1].split(/\s+/)) if (c && !c.startsWith('js-')) visualClasses.add(c)
  // 模板里 class="a b" 拆开后 js-* 之外也记录
}
const ignored = new Set(['is-open', 'hidden', 'is-active', 'is-picked', 'is-poor', 'is-selected', 'is-mergeable', 'is-consumable', 'is-empty', 'is-zero', 'is-ready', 'is-danger', 'is-cleared', 'is-picked', 'is-victory', 'is-char-focus', 'is-phase2'])
const missingCss = [...visualClasses].filter(
  (c) => !ignored.has(c) && !css.includes(`.${c}`),
)
if (missingCss.length) problems.push(`模板/代码用到但 CSS 未定义：${missingCss.join(', ')}`)

/* 4) HudV3 接口方法是否全部实现 */
const iface = types.slice(types.indexOf('export interface HudV3'), types.indexOf('export interface HudV3Handlers'))
const methods = [...iface.matchAll(/^\s{2}([a-zA-Z]\w*)\(/gm)].map((m) => m[1])
const missingMethods = methods.filter((name) => !new RegExp(`^\\s{2}${name}\\(`, 'm').test(hud))
if (missingMethods.length) problems.push(`HudV3 未实现：${missingMethods.join(', ')}`)

/* 5) 不应出现 v1 概念的文案/字段（先去掉注释，注释里说明 v3 变化是允许的） */
const hudCode = hud.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const banned = [
  ['经验', /经验/],
  ['等级', /等级/],
  ['XP', /\bxp\b/i],
  ['楼梯', /楼梯/],
]
for (const [label, re] of banned) {
  if (re.test(hudCode)) problems.push(`hud.ts 仍含「${label}」`)
}

/* 6) CSS 里 [hidden] 兜底 */
if (!/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css)) problems.push('styles.css 缺少 [hidden] 兜底')

console.log(`模板钩子 ${inTemplate.size} 个 / 代码查询 ${queried.size} 个 / HudV3 方法 ${methods.length} 个`)
console.log(`视觉 class 检查 ${visualClasses.size} 个`)
if (problems.length === 0) {
  console.log('AUDIT OK：无结构问题')
} else {
  console.log('AUDIT 问题：')
  for (const p of problems) console.log(' - ' + p)
}
