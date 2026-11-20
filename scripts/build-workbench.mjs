// 把 workbench/seed/*.json 合并进原工作台，产出「现状版」v2。
// 用法: node scripts/build-workbench.mjs
// 产出: 肉鸽爬塔AI提示词工作台-现状版.html  +  docs/工作台-现状备份.json
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SRC = path.join(ROOT, '肉鸽爬塔AI提示词工作台.html')
const SEED_DIR = path.join(ROOT, 'workbench', 'seed')
const OUT_HTML = path.join(ROOT, '肉鸽爬塔AI提示词工作台-现状版.html')
const OUT_JSON = path.join(ROOT, 'docs', '工作台-现状备份.json')

const html = readFileSync(SRC, 'utf8')

// ---- 1. 从原文件里取出 STAGES，用与页面完全一致的方式重放 id 分配 ----
const m = html.match(/var STAGES = (\[[\s\S]*?\n    \]);/)
if (!m) { console.error('✗ 没找到 STAGES 数组'); process.exit(1) }
const STAGES = eval(m[1])

const rows = []            // { id, si, name }
STAGES.forEach((st, si) => {
  st.groups.forEach((g) => {
    g.items.forEach((it) => rows.push({ id: 'r' + si + '_' + rows.length, si, name: it.n }))
  })
})

// ---- 2. 读种子（支持 {stage,items} 与 {entries:[{stage,items}]}）----
const seedByStage = new Map()
for (const f of readdirSync(SEED_DIR).filter((f) => f.endsWith('.json')).sort()) {
  const data = JSON.parse(readFileSync(path.join(SEED_DIR, f), 'utf8'))
  const entries = data.entries ? data.entries : [data]
  for (const e of entries) {
    if (!seedByStage.has(e.stage)) seedByStage.set(e.stage, new Map())
    const map = seedByStage.get(e.stage)
    for (const [name, v] of Object.entries(e.items)) {
      if (map.has(name)) { console.error(`✗ 重复条目 阶段${e.stage} 「${name}」（${f}）`); process.exit(1) }
      map.set(name, v)
    }
  }
}

// ---- 3. 对齐并校验 ----
const missing = []
const extra = []
const seedRows = {}
for (const r of rows) {
  const v = seedByStage.get(r.si)?.get(r.name)
  if (!v) { missing.push(`阶段${r.si} ${r.name}`); continue }
  const result = (v.result || '').trim()
  seedRows[r.id] = {
    prompt: (v.prompt || '').trim(),
    result,
    status: result.startsWith('未做') ? '待处理' : '已完成',
    done: !result.startsWith('未做'),
  }
}
for (const [si, map] of seedByStage) {
  for (const name of map.keys()) {
    if (!rows.some((r) => r.si === si && r.name === name)) extra.push(`阶段${si} ${name}`)
  }
}

if (missing.length) console.warn('⚠ 未填写 ' + missing.length + ' 项:\n  ' + missing.join('\n  '))
if (extra.length) console.warn('⚠ 种子里有对不上的条目 ' + extra.length + ' 项:\n  ' + extra.join('\n  '))

const noPrompt = Object.entries(seedRows).filter(([, v]) => !v.prompt)
if (noPrompt.length) console.warn('⚠ 空提示词 ' + noPrompt.length + ' 项')
for (const [id, v] of Object.entries(seedRows)) {
  for (const tag of ['【现状】', '【约束】', '【验收标准】']) {
    if (!v.prompt.includes(tag)) console.warn(`⚠ ${id} 缺 ${tag}`)
  }
}

// ---- 4. 注入 ----
const seed = { info: {}, rows: seedRows }
let out = html

// 4.1 换存储 key：避免与旧工作台（已存在 localStorage 里的 v1 数据）冲突
out = out.replace(
  "var KEY = 'roguelike-ai-prompt-workbench-v1';",
  "var KEY = 'roguelike-ai-prompt-workbench-v2';",
)
if (!out.includes("workbench-v2")) { console.error('✗ KEY 替换失败'); process.exit(1) }

// 4.2 首次打开时用种子填充（已有本地数据则以本地为准）
const anchor = 'if (saved) { try { applyData(JSON.parse(saved)); } catch(e){} }'
if (!out.includes(anchor)) { console.error('✗ 找不到 applyData 装载点'); process.exit(1) }
out = out.replace(
  anchor,
  anchor +
    '\n    else if (window.__WB_SEED) { try { applyData(window.__WB_SEED); refresh(); save(); } catch(e){ console.error(e) } }',
)

// 4.3 种子脚本 + 标题
out = out.replace(
  '<div class="wrap">',
  '<script>window.__WB_SEED = ' + JSON.stringify(seed) + ';</script>\n<div class="wrap">',
)
out = out.replace(
  '<title>肉鸽爬塔开发 · AI提示词工作台</title>',
  '<title>肉鸽爬塔开发 · AI提示词工作台（现状版 v2）</title>',
)
out = out.replace(
  '<h1>肉鸽爬塔开发 · AI 提示词工作台</h1>',
  '<h1>肉鸽爬塔开发 · AI 提示词工作台（现状版 v2）</h1>',
)
out = out.replace(
  '<p class="sub">用法：',
  '<p class="sub"><b>本版已把《残响高塔》v4.6 的现状填进每一环：</b>每格含【现状】实际实现与数值、【目标】这一环要交付什么、【约束】边界、【验收标准】可判定条件；「Agent 产出记录」写的是现状落点文件。<b>下一步：</b>以这些现状为基线，在你要重做的环节上改写提示词（保留格式，只换目标与验收）。<br>用法：',
)

// 4.4 提示词框自动撑高：长提示词不再被 88px 的框遮住
const growAnchor = '    refresh();\n  } catch(e) {'
if (!out.includes(growAnchor)) { console.error('✗ 找不到 autoGrow 注入点'); process.exit(1) }
out = out.replace(
  growAnchor,
  [
    "    function autoGrow(t){ if(!t) return; t.style.height='auto'; t.style.height=Math.min(t.scrollHeight+4, 620)+'px'; }",
    "    document.querySelectorAll('textarea[data-prompt]').forEach(autoGrow);",
    "    root.addEventListener('input', function(ev){ if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-prompt')) autoGrow(ev.target); });",
    '    refresh();',
    '  } catch(e) {',
  ].join('\n'),
)

writeFileSync(OUT_HTML, out, 'utf8')
writeFileSync(OUT_JSON, JSON.stringify(seed, null, 2), 'utf8')

const filled = Object.keys(seedRows).length
const doneCount = Object.values(seedRows).filter((v) => v.done).length
console.log(`✓ 行数 ${rows.length} / 已填 ${filled} / 现状已完成 ${doneCount} / 未做 ${filled - doneCount}`)
console.log(`✓ ${path.basename(OUT_HTML)}  ${(out.length / 1024).toFixed(0)} KB`)
console.log(`✓ ${path.basename(OUT_JSON)}`)
