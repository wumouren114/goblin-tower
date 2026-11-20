/**
 * 状态效果系统冒烟（纯逻辑，不需要 canvas / three.js / DOM）：
 *   node sim/status-smoke.mjs
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

const { StatusField } = await import('../src/systems/statusEffects.ts')

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
  if (actual !== expected) {
    throw new Error(`${hint} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

console.log('\n状态效果系统 · status-smoke')

check('施加状态后 has 为 true、remaining 正确，推进到期后自动清除', () => {
  const field = new StatusField()
  eq(field.has('stun', 'e1'), false, '初始无 stun')
  eq(field.remaining('stun', 'e1'), 0, '初始剩余时间为 0')

  eq(field.apply('stun', 'e1', 600), true, '施加 stun 应成功')
  eq(field.has('stun', 'e1'), true, '施加后 has 为 true')
  eq(field.remaining('stun', 'e1'), 600, '剩余时间应为 600ms')
  eq(field.stacks('stun', 'e1'), 1, 'stun 层数应为 1')

  field.update(250)
  eq(field.has('stun', 'e1'), true, '未到期仍存在')
  eq(field.remaining('stun', 'e1'), 350, '剩余时间应递减为 350ms')

  field.update(350)
  eq(field.has('stun', 'e1'), false, '到期后 has 为 false')
  eq(field.remaining('stun', 'e1'), 0, '到期后 remaining 为 0')
  eq(field.stacks('stun', 'e1'), 0, '到期后 stacks 为 0')
})

check('resistWindowMs 内重复施加返回 false，窗口结束后可再次施加', () => {
  const field = new StatusField()
  eq(field.apply('stun', 'e1', 500, { resistWindowMs: 2000 }), true, '首次施加应成功')

  field.update(600)
  eq(field.has('stun', 'e1'), false, '600ms 后 stun 已到期')
  eq(field.apply('stun', 'e1', 500, { resistWindowMs: 2000 }), false, '抗性窗口内再次施加应返回 false')
  eq(field.has('stun', 'e1'), false, '被抗性挡住不应生效')

  field.update(1399) // 累计 1999ms
  eq(field.apply('stun', 'e1', 500, { resistWindowMs: 2000 }), false, '1999ms 仍在窗口内')

  field.update(1) // 累计 2000ms
  eq(field.apply('stun', 'e1', 500, { resistWindowMs: 2000 }), true, '窗口结束后应可再次施加')
  eq(field.has('stun', 'e1'), true, '再次施加后应生效')
  eq(field.remaining('stun', 'e1'), 500, '再次施加剩余时间应为 500ms')
})

check('mark 可叠层至 maxStacks 不超限，且叠层时刷新持续时间不重置层数', () => {
  const field = new StatusField()
  eq(field.apply('mark', 'e1', 1000, { maxStacks: 3 }), true, '第 1 层 mark')
  eq(field.stacks('mark', 'e1'), 1, '应为 1 层')

  field.update(400)
  eq(field.remaining('mark', 'e1'), 600, '400ms 后剩余 600ms')

  eq(field.apply('mark', 'e1', 1000, { maxStacks: 3 }), true, '第 2 层 mark')
  eq(field.stacks('mark', 'e1'), 2, '应叠到 2 层')
  eq(field.remaining('mark', 'e1'), 1000, '叠层应刷新持续时间至 1000ms')

  field.update(300)
  eq(field.apply('mark', 'e1', 1000, { maxStacks: 3 }), true, '第 3 层 mark')
  eq(field.stacks('mark', 'e1'), 3, '应叠到 3 层')
  eq(field.remaining('mark', 'e1'), 1000, '第 3 层应刷新持续时间')

  field.update(200)
  eq(field.apply('mark', 'e1', 1000, { maxStacks: 3 }), true, '满层再施加应成功并刷新时间')
  eq(field.stacks('mark', 'e1'), 3, '层数不得超过 maxStacks=3')
  eq(field.remaining('mark', 'e1'), 1000, '满层再施加仍刷新持续时间')
})

check('stun 固定最多 1 层，即便传入 maxStacks > 1 也不叠层', () => {
  const field = new StatusField()
  eq(field.apply('stun', 'e1', 500, { maxStacks: 5 }), true, '首次 stun')
  eq(field.stacks('stun', 'e1'), 1, 'stun 层数恒为 1')

  field.update(200)
  eq(field.apply('stun', 'e1', 500, { maxStacks: 5 }), true, '无抗性窗口时刷新 stun')
  eq(field.stacks('stun', 'e1'), 1, '重复 stun 仍为 1 层')
  eq(field.remaining('stun', 'e1'), 500, '重复 stun 应刷新剩余时间')
})

check('consume 返回消耗层数并清零，重复 consume 返回 0', () => {
  const field = new StatusField()
  field.apply('mark', 'e1', 2000, { maxStacks: 4 })
  field.apply('mark', 'e1', 2000, { maxStacks: 4 })
  field.apply('mark', 'e1', 2000, { maxStacks: 4 })
  eq(field.stacks('mark', 'e1'), 3, '消耗前应为 3 层')

  eq(field.consume('mark', 'e1'), 3, 'consume 应返回消耗的 3 层')
  eq(field.stacks('mark', 'e1'), 0, '消耗后层数应归零')
  eq(field.has('mark', 'e1'), false, '消耗后 has 应为 false')
  eq(field.remaining('mark', 'e1'), 0, '消耗后 remaining 应为 0')
  eq(field.consume('mark', 'e1'), 0, '再次 consume 应返回 0')
})

check('多目标互不干扰，不同状态类型互不干扰，targetsWith 准确返回', () => {
  const field = new StatusField()
  field.apply('stun', 'e1', 800, { resistWindowMs: 2000 })
  field.apply('mark', 'e1', 1500, { maxStacks: 3 })
  field.apply('mark', 'e2', 1500, { maxStacks: 3 })
  field.apply('mark', 'e2', 1500, { maxStacks: 3 })

  // e1 吃 stun 抗性不影响 e2 的 stun，也不影响 e1 的 mark
  eq(field.apply('stun', 'e2', 800, { resistWindowMs: 2000 }), true, 'e2 不受 e1 抗性影响')
  eq(field.apply('mark', 'e1', 1500, { maxStacks: 3 }), true, 'e1 的 mark 不受 stun 抗性影响')
  eq(field.stacks('mark', 'e1'), 2, 'e1 mark 为 2 层')
  eq(field.stacks('mark', 'e2'), 2, 'e2 mark 为 2 层')

  const stunned = field.targetsWith('stun').sort()
  eq(stunned.join(','), 'e1,e2', 'stun 目标列表应为 e1,e2')

  field.consume('mark', 'e1')
  eq(field.targetsWith('mark').join(','), 'e2', '消耗 e1 后仅剩 e2 带 mark')
  eq(field.has('stun', 'e1'), true, '消耗 e1 的 mark 不影响 e1 的 stun')
})

check('clear 仅清理指定目标（含抗性），clearAll 清理全部目标', () => {
  const field = new StatusField()
  field.apply('stun', 'e1', 1000, { resistWindowMs: 5000 })
  field.apply('mark', 'e2', 1000, { maxStacks: 2 })

  field.clear('e1')
  eq(field.has('stun', 'e1'), false, 'clear 后 e1 无 stun')
  eq(field.has('mark', 'e2'), true, 'clear e1 不影响 e2')
  // clear 后 e1 抗性也随之清理，可重新施加
  eq(field.apply('stun', 'e1', 1000, { resistWindowMs: 5000 }), true, 'clear 后 e1 抗性已重置')

  field.clearAll()
  eq(field.has('stun', 'e1'), false, 'clearAll 后 e1 无状态')
  eq(field.has('mark', 'e2'), false, 'clearAll 后 e2 无状态')
  eq(field.targetsWith('stun').length, 0, 'clearAll 后 stun 目标为空')
  eq(field.targetsWith('mark').length, 0, 'clearAll 后 mark 目标为空')
})

check('update(0) 与负值 dtMs 不改变任何状态', () => {
  const field = new StatusField()
  field.apply('stun', 'e1', 500, { resistWindowMs: 1000 })
  field.apply('mark', 'e1', 900, { maxStacks: 3 })
  field.apply('mark', 'e1', 900, { maxStacks: 3 })

  field.update(0)
  field.update(-100)
  eq(field.has('stun', 'e1'), true, 'update(0) 后 stun 仍在')
  eq(field.remaining('stun', 'e1'), 500, 'update(0) 不改变 stun 剩余时间')
  eq(field.stacks('mark', 'e1'), 2, 'update(0) 不改变 mark 层数')
  eq(field.remaining('mark', 'e1'), 900, 'update(0) 不改变 mark 剩余时间')
  ok(field.targetsWith('mark').includes('e1'), 'update(0) 不改变 targetsWith')
})

console.log(`\n结果：${passed} 通过，${failures.length} 失败`)
if (failures.length > 0) {
  process.exit(1)
}
