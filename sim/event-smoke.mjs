/**
 * 事件数据与状态层冒烟：
 *   node sim/event-smoke.mjs
 * 需 Node 24 原生 TS type-stripping。
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

const { EVENTS, ARC_IDS, eventOf } = await import('../src/data/events.ts')
const { EventState } = await import('../src/systems/eventState.ts')
const { Rng } = await import('../src/core/rng.ts')

let passed = 0
const failures = []
function check(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures.push({ name, e })
    console.log(`  ✗ ${name}  → ${e.message}`)
  }
}
function ok(v, hint = '断言失败') {
  if (!v) throw new Error(hint)
}
function eq(a, b, hint = '') {
  if (a !== b) throw new Error(`${hint} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}

const arcs = new Set(ARC_IDS)

console.log('\n事件数据 · event-smoke')

check('事件数量与 id 唯一', () => {
  eq(EVENTS.length, 8)
  const seen = new Set()
  for (const e of EVENTS) {
    ok(!seen.has(e.id), `重复 id: ${e.id}`)
    seen.add(e.id)
  }
})

check('每个事件都有标题、介绍、线索', () => {
  for (const e of EVENTS) {
    ok(e.title.length > 0, `${e.id} 缺标题`)
    ok(e.intro.length > 4, `${e.id} 缺介绍`)
    ok(e.clues.length >= 1, `${e.id} 至少要有一条免费线索`)
  }
})

check('每个事件至少 2 个选项，每个选项有文案和结果', () => {
  for (const e of EVENTS) {
    ok(e.options.length >= 2, `${e.id} 选项太少`)
    for (const o of e.options) {
      ok(o.label.length > 0, `${e.id}/${o.id} 缺文案`)
      ok(o.outcomes.length >= 1, `${e.id}/${o.id} 没有结果`)
    }
  }
})

check('声明了隐藏真身的事件：每个真身都能选每个选项', () => {
  for (const e of EVENTS) {
    if (!e.roles) continue
    ok(e.roles.length >= 2, `${e.id} roles 太少`)
    for (const o of e.options) {
      for (const role of e.roles) {
        const pool = o.outcomes.filter((x) => x.role === undefined || x.role === role)
        ok(pool.length >= 1, `${e.id}/${o.id} 在真身 ${role} 下没有结果`)
      }
    }
  }
})

check('至少 3 个事件带随机真身（保证"不写死身份"）', () => {
  const n = EVENTS.filter((e) => e.roles && e.roles.length >= 2).length
  ok(n >= 3, `只有 ${n} 个事件有真身`)
})

check('伏笔只能引用已登记 arc', () => {
  for (const e of EVENTS) {
    for (const o of e.options) {
      for (const out of o.outcomes) {
        for (const eff of out.effects) {
          if (eff.kind === 'arc') ok(arcs.has(eff.id), `${e.id}/${out.id} 引用了未登记的 arc: ${eff.id}`)
        }
      }
    }
  }
})

check('惩罚封顶：金币 ≤ 200、减益 ≤ 3 层、增益 ≤ 20%', () => {
  for (const e of EVENTS) {
    for (const o of e.options) {
      for (const out of o.outcomes) {
        for (const eff of out.effects) {
          if (eff.kind === 'gold') ok(Math.abs(eff.value) <= 200, `${e.id} 金币 ${eff.value} 超上限`)
          if (eff.kind === 'debuff') ok(eff.layers <= 3, `${e.id} 减益 ${eff.layers} 层超标`)
          if (eff.kind === 'buff') ok(Math.abs(eff.value) <= 0.2, `${e.id} 增益 ${eff.value} 超标`)
        }
      }
    }
  }
})

check('每个事件都能被 eventOf 查到', () => {
  for (const e of EVENTS) eq(eventOf(e.id)?.id, e.id)
})

check('EventState：伏笔挂上 → 兑现一次 → 不再兑现', () => {
  const s = new EventState()
  eq(s.hasArc('saved-knight'), false)
  s.addArc('saved-knight', 3)
  eq(s.hasArc('saved-knight'), true)
  eq(s.arcLayer('saved-knight'), 3)
  eq(s.takeArc('saved-knight'), true)
  eq(s.takeArc('saved-knight'), false, '第二次不应再兑现')
})

check('EventState：选项可用性（金币 / 卡 / 记忆前置）', () => {
  const s = new EventState()
  const chapel = eventOf('chapel')
  const memoryOpt = chapel.options.find((o) => o.id === 'leave-memory')
  const goldOpt = chapel.options.find((o) => o.id === 'leave-gold')
  eq(s.canPick(memoryOpt, { gold: 999, cards: 0 }), false, '没有记忆不能选')
  s.addMemory('own-death')
  eq(s.canPick(memoryOpt, { gold: 999, cards: 0 }), true)
  eq(s.canPick(goldOpt, { gold: 10, cards: 0 }), false, '金币不够不能选')
  eq(s.canPick(goldOpt, { gold: 100, cards: 0 }), true)
})

check('EventState：结果按真身过滤', () => {
  const s = new EventState()
  const rng = new Rng(7)
  const buy = eventOf('peddler').options.find((o) => o.id === 'buy')
  for (let i = 0; i < 20; i += 1) {
    eq(s.pickOutcome(buy, 'swindler', rng)?.id, 'buy-fake')
    eq(s.pickOutcome(buy, 'genuine', rng)?.id, 'buy-real')
  }
  ok(s.pickOutcome(eventOf('peddler').options.find((o) => o.id === 'leave'), 'swindler', rng) !== null)
})

check('EventState：快照可往返', () => {
  const s = new EventState()
  s.addFlag('met-merchant')
  s.addClue('tower-collects')
  s.addArc('wall-script', 2)
  s.addMemory('own-death')
  const snap = s.snapshot()
  const t = new EventState()
  t.restore(snap)
  eq(t.hasFlag('met-merchant'), true)
  eq(t.hasClue('tower-collects'), true)
  eq(t.hasArc('wall-script'), true)
  eq(t.memories.length, 1)
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.e.stack}`)
  process.exit(1)
}
