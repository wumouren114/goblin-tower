/**
 * 潜能 / 道具卡数据表冒烟（纯数据，不需要 canvas / three.js）：
 *   node sim/potential-smoke.mjs
 *
 * 依赖 Node 24 原生 TS type-stripping。
 */
import { register } from 'node:module'

const loaderSource = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && context.parentURL && !/\\.[a-z0-9]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '/index.ts']) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`)

const { POTENTIALS, branchOf, nodePoolOf } = await import('../src/data/potentials.ts')
const { ITEM_CARDS, CARD_TIERS, cardOf, cardValueAt, cardTextAt, nextTier, CARD_MAX_TIER } =
  await import('../src/data/cards.ts')

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`  ✗ ${name}  → ${error.message}`)
  }
}

function ok(value, hint = '断言失败') {
  if (!value) throw new Error(hint)
}

function eq(actual, expected, hint = '') {
  if (actual !== expected) throw new Error(`${hint} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

const CHARS = ['mutsumi', 'murasame', 'fish']

console.log('\n潜能 / 道具卡 · potential-smoke')

check('三个角色都有潜能表', () => {
  for (const c of CHARS) ok(POTENTIALS[c], `缺少 ${c}`)
  eq(Object.keys(POTENTIALS).length, 3)
})

check('每个角色恰好 3 条分支', () => {
  for (const c of CHARS) eq(POTENTIALS[c].branches.length, 3, `${c}`)
})

check('每条分支 = 根被动 + 代价 + 3 个一级节点', () => {
  for (const c of CHARS) {
    for (const b of POTENTIALS[c].branches) {
      ok(b.root.length > 4, `${b.id} 缺根被动`)
      ok(b.cost.length > 2, `${b.id} 缺代价`)
      ok(b.identity.length > 2, `${b.id} 缺身份描述`)
      eq(b.nodes.length, 3, `${b.id} 节点数`)
      for (const n of b.nodes) {
        ok(n.effect.length > 2, `${n.id} 缺效果`)
        ok(n.tags.length > 0, `${n.id} 缺标签`)
      }
    }
  }
})

check('节点 id 全局唯一（分支 + 通用）', () => {
  const seen = new Set()
  for (const c of CHARS) {
    for (const n of nodePoolOf(c)) {
      ok(!seen.has(n.id), `重复节点 id: ${n.id}`)
      seen.add(n.id)
    }
  }
  ok(seen.size > 20, `节点总数偏少: ${seen.size}`)
})

check('分支 id 唯一，且能按角色查到', () => {
  const seen = new Set()
  for (const c of CHARS) {
    for (const b of POTENTIALS[c].branches) {
      ok(!seen.has(b.id), `重复分支 id: ${b.id}`)
      seen.add(b.id)
      eq(branchOf(c, b.id)?.id, b.id, 'branchOf 应能命中')
    }
  }
  eq(seen.size, 9)
})

check('跨分支反应引用的分支都存在且不相同', () => {
  for (const c of CHARS) {
    const ids = new Set(POTENTIALS[c].branches.map((b) => b.id))
    ok(POTENTIALS[c].resonances.length === 3, `${c} 应有 3 组反应`)
    for (const r of POTENTIALS[c].resonances) {
      eq(r.requires.length, 2, `${r.id}`)
      ok(r.requires[0] !== r.requires[1], `${r.id} 不能自我反应`)
      for (const id of r.requires) ok(ids.has(id), `${r.id} 引用了不存在的分支 ${id}`)
    }
  }
})

check('通用项数量合理（2~6）', () => {
  for (const c of CHARS) {
    const n = POTENTIALS[c].commons.length
    ok(n >= 2 && n <= 6, `${c} 通用项 ${n}`)
  }
})

check('丛雨的代价咬自己（流殇砍普攻、剑意砍技能）', () => {
  ok(branchOf('murasame', 'murasame-liushang').cost.includes('普攻伤害'), '流殇代价')
  ok(branchOf('murasame', 'murasame-jianyi').cost.includes('技能伤害'), '剑意代价')
  ok(branchOf('murasame', 'murasame-jianyi').cost.includes('不吃'), '剑意代价需注明结算独立')
})

check('大肥鱼：小鲸子 0.4 / 分身 1.0 写进数据', () => {
  ok(branchOf('fish', 'fish-clone').root.includes('1.0 倍'), '分身 1.0 倍面板')
  ok(branchOf('fish', 'fish-clone').root.includes('0.4 倍'), '小鲸子 0.4 倍')
  ok(branchOf('fish', 'fish-bubble').cost.includes('攻速'), '分支3 代价 = 攻速降低')
  ok(branchOf('fish', 'fish-bubble').nodes[2].effect.includes('移速'), '巨化只降移速')
})

check('睦：节奏分支写死判定窗口', () => {
  const root = branchOf('mutsumi', 'mutsumi-rhythm').root
  ok(root.includes('±35'), root)
  ok(root.includes('±60'), root)
})

/* ── 道具卡 ────────────────────────────────────────────── */

check('10 张卡，id 与属性都不重复', () => {
  eq(ITEM_CARDS.length, 10)
  const ids = new Set()
  const stats = new Set()
  for (const c of ITEM_CARDS) {
    ok(!ids.has(c.id), `重复卡 id: ${c.id}`)
    ok(!stats.has(c.stat), `属性重复的卡: ${c.stat}`)
    ids.add(c.id)
    stats.add(c.stat)
  }
})

check('每张卡三档，且数值严格递增', () => {
  for (const c of ITEM_CARDS) {
    eq(c.tiers.length, 3, `${c.id}`)
    ok(c.tiers[0] < c.tiers[1] && c.tiers[1] < c.tiers[2], `${c.id} 数值必须递增`)
  }
})

check('有上限的卡不超过上限', () => {
  for (const c of ITEM_CARDS) {
    if (typeof c.cap !== 'number') continue
    for (const t of CARD_TIERS) ok(cardValueAt(c, t) <= c.cap, `${c.id} 超出上限 ${c.cap}`)
  }
})

check('词条模板会带出档位数值', () => {
  const magic = cardOf('magic')
  eq(cardTextAt(magic, 'blue'), '伤害 +18%')
  eq(cardTextAt(magic, 'gold'), '伤害 +66%')
  ok(!cardTextAt(cardOf('hpRegen'), 'purple').includes('{v}'), '模板未替换')
})

check('档位链：蓝 → 紫 → 金 → 退出池子', () => {
  eq(nextTier('blue'), 'purple')
  eq(nextTier('purple'), 'gold')
  eq(nextTier('gold'), null)
  eq(CARD_MAX_TIER, 3)
})

check('生命之源存在且为百分比回血', () => {
  const regen = cardOf('hpRegen')
  ok(regen, '缺生命之源')
  eq(regen.format, 'percent')
  ok(regen.text.includes('5 秒'), regen.text)
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.error.stack}`)
  process.exit(1)
}
