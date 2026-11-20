/**
 * 持续伤害区域冒烟：
 *   node sim/hazard-smoke.mjs
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

const { HazardField } = await import('../src/systems/hazardZone.ts')

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
function eq(a, b, hint = '') {
  if (a !== b) throw new Error(`${hint} 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`)
}
function ok(v, hint = '断言失败') {
  if (!v) throw new Error(hint)
}

console.log('\n持续伤害区域 · hazard-smoke')

check('站在区域内会按 dps 累计并结算整数伤害', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 3, dps: 12, life: 10 })
  let total = 0
  for (let i = 0; i < 10; i += 1) total += f.update(0.1, { x: 0, z: 0 }).damage
  eq(total, 12, '1 秒应结算 12 点')
})

check('站在区域外不掉血', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 2, dps: 50, life: 10 })
  eq(f.update(1, { x: 5, z: 0 }).damage, 0)
  eq(f.update(1, { x: 0, z: 0 }).inside, true)
})

check('armDelay 前不生效（给玩家反应时间）', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 3, dps: 100, life: 10, armDelay: 1 })
  eq(f.update(0.5, { x: 0, z: 0 }).damage, 0, '前摇内')
  eq(f.update(0.6, { x: 0, z: 0 }).inside, true, '前摇后应算在区域内')
  ok(f.update(1, { x: 0, z: 0 }).damage > 0, '前摇后应开始掉血')
})

check('到寿命后自动消失', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 3, dps: 5, life: 1 })
  eq(f.count, 1)
  f.update(1.2, { x: 0, z: 0 })
  eq(f.count, 0)
})

check('多块区域同时生效，伤害累加', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 3, dps: 10, life: 10 })
  f.spawn({ x: 1, z: 0, radius: 3, dps: 10, life: 10 })
  let total = 0
  for (let i = 0; i < 10; i += 1) total += f.update(0.1, { x: 0.5, z: 0 }).damage
  eq(total, 20)
})

check('clear 清空所有区域', () => {
  const f = new HazardField()
  f.spawn({ x: 0, z: 0, radius: 3, dps: 10, life: 10 })
  f.spawn({ x: 4, z: 0, radius: 3, dps: 10, life: 10 })
  f.clear()
  eq(f.count, 0)
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.e.stack}`)
  process.exit(1)
}
