/**
 * 敌人威胁原型与行为状态机冒烟（纯数据/逻辑，不需要 canvas / three.js）：
 *   node sim/enemy-smoke.mjs
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

const {
  ENEMY_ARCHETYPES,
  TODO_MELEE_ATTACK_RANGE,
  archetypeOf,
} = await import('../src/data/enemyArchetypes.ts')

const {
  ENEMY_BEHAVIOR_STATES,
  ENEMY_STATE_SPECS,
  canTransitionState,
  computeDetourDirection,
  computeFacing,
  createEnemyStateMachine,
  maintainDistance,
  selectTarget,
  stepEnemyBehavior,
  transitionState,
} = await import('../src/systems/enemyBehavior.ts')

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

function throws(fn, hint = '预期抛出异常') {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  if (!threw) throw new Error(hint)
}

console.log('\n敌人威胁原型与行为状态机 · enemy-smoke')

check('5 类原型齐全、id 唯一且均声明非空 tags', () => {
  const expectedIds = ['ranged-pressure', 'blocker', 'charger', 'summoner', 'bomber']
  eq(ENEMY_ARCHETYPES.length, 5)
  const seen = new Set()
  for (const def of ENEMY_ARCHETYPES) {
    ok(!seen.has(def.id), `重复 id: ${def.id}`)
    seen.add(def.id)
    ok(def.name.length > 0, `${def.id} 缺名称`)
    ok(Array.isArray(def.tags) && def.tags.length > 0, `${def.id} 必须声明非空 tags`)
    ok(def.preferredRange > 0, `${def.id} preferredRange 需 > 0`)
    ok(def.windupMs > 0, `${def.id} windupMs 需 > 0`)
    ok(def.cooldownMs > 0, `${def.id} cooldownMs 需 > 0`)
    eq(archetypeOf(def.id).id, def.id)
  }
  for (const id of expectedIds) ok(seen.has(id), `缺少原型 ${id}`)
})

check('charger 前摇 >= 800ms（玩家无冲刺必须能靠走位躲开）', () => {
  const charger = archetypeOf('charger')
  ok(charger.windupMs >= 800, `charger windupMs=${charger.windupMs} < 800`)
})

check('ranged-pressure 偏好距离严格大于近战攻击距离', () => {
  const ranged = archetypeOf('ranged-pressure')
  ok(
    ranged.preferredRange > TODO_MELEE_ATTACK_RANGE,
    `ranged preferredRange=${ranged.preferredRange} 应大于近战距离 ${TODO_MELEE_ATTACK_RANGE}`,
  )
})

check('所有 6 个状态均声明进入条件、可打断标记与合法转移表', () => {
  eq(ENEMY_BEHAVIOR_STATES.length, 6)
  for (const s of ENEMY_BEHAVIOR_STATES) {
    const spec = ENEMY_STATE_SPECS[s]
    ok(spec, `缺少状态规格 ${s}`)
    ok(spec.enterCondition.length > 0, `${s} 缺进入条件`)
    eq(typeof spec.interruptible, 'boolean', `${s} 缺可被打断标记`)
    ok(Array.isArray(spec.allowedTransitions), `${s} 缺合法转移表`)
  }
  eq(ENEMY_STATE_SPECS.dead.allowedTransitions.length, 0, 'dead 为终态')
})

check('非法状态转移必须抛错', () => {
  const dead = createEnemyStateMachine('dead')
  throws(() => transitionState(dead, 'chase'), 'dead -> chase 应抛错')
  throws(() => transitionState(dead, 'attack'), 'dead -> attack 应抛错')

  const chase = createEnemyStateMachine('chase')
  eq(canTransitionState('chase', 'recover'), false)
  throws(() => transitionState(chase, 'recover'), 'chase -> recover 应抛错')
  throws(() => transitionState(chase, 'attack'), 'chase -> attack（跳过 windup）应抛错')

  const attack = createEnemyStateMachine('attack')
  throws(() => transitionState(attack, 'chase'), 'attack -> chase（跳过 recover）应抛错')
})

check('状态机不卡死：任意状态在 120 帧内必能转移到 attack 或 dead', () => {
  const maxFrames = 120
  const dtMs = 50
  for (const def of ENEMY_ARCHETYPES) {
    for (const startState of ENEMY_BEHAVIOR_STATES) {
      let sm = createEnemyStateMachine(startState, def)
      let reached = sm.state === 'attack' || sm.state === 'dead'
      for (let f = 0; f < maxFrames && !reached; f += 1) {
        sm = stepEnemyBehavior(
          sm,
          def,
          { hp: 100, hasTarget: true, distanceToTarget: def.preferredRange },
          dtMs,
        )
        if (sm.state === 'attack' || sm.state === 'dead') reached = true
      }
      ok(reached, `${def.id} 从 ${startState} 出发在 ${maxFrames} 帧内未到达 attack/dead（停在 ${sm.state}）`)
    }
  }
})

check('hp <= 0 时任意存活状态立即转移到 dead 且停留终态', () => {
  const def = archetypeOf('blocker')
  for (const s of ['chase', 'windup', 'attack', 'recover', 'reposition']) {
    const sm = createEnemyStateMachine(s, def)
    const next = stepEnemyBehavior(sm, def, { hp: 0, hasTarget: true, distanceToTarget: 1 }, 16)
    eq(next.state, 'dead', `${s} 在 hp=0 时应立即转 dead`)
    const stay = stepEnemyBehavior(next, def, { hp: 100, hasTarget: true, distanceToTarget: 1 }, 16)
    eq(stay.state, 'dead', 'dead 状态不可复活')
  }
})

check('纯函数工具：选目标 / 算朝向 / 保持距离 / 绕行', () => {
  const picked = selectTarget({ x: 0, z: 0 }, [
    { id: 'dead-near', x: 1, z: 0, alive: false, priority: 10 },
    { id: 'far-taunt', x: 10, z: 0, alive: true, priority: 5 },
    { id: 'near-normal', x: 2, z: 0, alive: true, priority: 0 },
  ])
  eq(picked?.id, 'far-taunt', '高优先级目标应优先于普通近距目标')

  const facing = computeFacing({ x: 0, z: 0 }, { x: 0, z: 5 })
  eq(facing.distance, 5)
  eq(facing.dx, 0)
  eq(facing.dz, 1)

  const approach = maintainDistance({ x: 0, z: 0 }, { x: 10, z: 0 }, 4, 0.5)
  eq(approach.mode, 'approach')
  ok(approach.dx > 0.99)

  const hold = maintainDistance({ x: 0, z: 0 }, { x: 4.2, z: 0 }, 4, 0.5)
  eq(hold.mode, 'hold')
  eq(hold.dx, 0)

  const retreat = maintainDistance({ x: 0, z: 0 }, { x: 1, z: 0 }, 4, 0.5)
  eq(retreat.mode, 'retreat')
  ok(retreat.dx < -0.99)

  const detour = computeDetourDirection(
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    0.5,
    [{ x: 1.5, z: 0.1, radius: 0.6 }],
    2.5,
  )
  ok(Math.abs(detour.z) > 0.5, '前方有障碍时应产生横向绕行分量')
  ok(Math.abs(Math.hypot(detour.x, detour.z) - 1) < 1e-6, '绕行向量应归一化')
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.error.stack}`)
  process.exit(1)
}
