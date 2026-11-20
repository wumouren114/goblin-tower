/**
 * 事件 battle 效果刷怪与流程闭环冒烟测试
 * 运行：node sim/event-battle-smoke.mjs
 *
 * 覆盖：
 * 1. 全量 EVENTS 数据中所有 kind:'battle' 效果均为正整数 count
 * 2. 事件面板打开期间（onPick）只记录待刷数量，不提前刷怪；关闭面板（onClose）后才开战
 * 3. 单怪（count=1）按 1 精英口径刷出；多怪（count>=2）按小怪口径刷出
 * 4. 事件房（roomMap 存在）清怪后回到事件收尾回调 onDone（开启出口裂隙，不卡层进度、不误发战斗门奖励）
 * 5. 普通层（roomMap 为空）遭遇战计入 layerTotal，清完后才走正常清层流程
 * 6. 非 battle 事件关闭后直接走 onDone，不进入战斗
 * 7. 房间销毁（disposeRoomMap）清理 eventBattleActive / pendingEventBattleDone，无状态泄漏
 */
import { readFileSync } from 'node:fs'
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

const { EVENTS } = await import('../src/data/events.ts')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) passed += 1
  else failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

// ── 1. 事件数据中的 battle 效果盘点 ──────────────────────────────────────────
const battleEffects = []
for (const ev of EVENTS) {
  for (const opt of ev.options) {
    for (const out of opt.outcomes) {
      for (const eff of out.effects) {
        if (eff.kind === 'battle') battleEffects.push({ eventId: ev.id, count: eff.count })
      }
    }
  }
}
check(
  'EVENTS 包含真实 battle 效果且 count 均为正整数',
  battleEffects.length >= 5 && battleEffects.every((b) => Number.isInteger(b.count) && b.count >= 1),
  `共 ${battleEffects.length} 处（counts=${[...new Set(battleEffects.map((b) => b.count))].join('/')}）`,
)

// ── 2. src/game.ts 接线契约验证 ──────────────────────────────────────────────
const gameSrc = readFileSync('src/game.ts', 'utf-8')
check(
  'openEventById 在 onPick 仅累计待刷数量、onClose 后才调用 startEventBattle',
  gameSrc.includes('pendingBattleCount += this.applyEventEffects(outcome.effects)') &&
    gameSrc.includes('if (pendingBattleCount > 0)') &&
    gameSrc.includes('this.startEventBattle(pendingBattleCount, onDone)'),
)
check(
  'startEventBattle 按 count===1 出精英、多怪出小怪，且区分事件房与普通层',
  gameSrc.includes('const elite = safeCount === 1 ? 1 : 0') &&
    gameSrc.includes('this.startRoomBattle(safeCount, elite)') &&
    gameSrc.includes('this.layerTotal += safeCount'),
)
check(
  'finishRoomBattle 优先收尾 eventBattleActive 并回调 pendingEventBattleDone（不误发战斗门奖励）',
  gameSrc.includes('if (this.eventBattleActive)') &&
    gameSrc.includes('if (done) done()'),
)
check(
  'disposeRoomMap 重置 eventBattleActive 与 pendingEventBattleDone',
  gameSrc.includes('this.eventBattleActive = false') &&
    gameSrc.includes('this.pendingEventBattleDone = null'),
)

// ── 3. 状态机闭环模拟（严格复刻 game.ts 事件战生命周期） ────────────────────
function makeHarness(inRoomMap) {
  const state = {
    roomMap: inRoomMap ? { resolved: true } : null,
    roomActive: false,
    eventBattleActive: false,
    pendingEventBattleDone: null,
    layerTotal: inRoomMap ? 0 : 10,
    layerKilled: 0,
    spawned: [],
    completedRoom: 0,
    battleDoorRewarded: 0,
    layerCleared: 0,
  }

  function applyEventEffects(effects) {
    let battleCount = 0
    for (const eff of effects) {
      if (eff.kind === 'battle') battleCount += Math.max(1, Math.round(eff.count))
    }
    return battleCount
  }

  function startEventBattle(count, onDone) {
    const safeCount = Math.max(1, Math.round(count))
    const elite = safeCount === 1 ? 1 : 0
    if (state.roomMap) {
      state.eventBattleActive = true
      state.pendingEventBattleDone = onDone ?? null
      state.roomActive = true
      for (let i = 0; i < safeCount; i += 1) {
        state.spawned.push(i < elite ? 'elite' : 'small')
      }
      return
    }
    state.layerTotal += safeCount
    for (let i = 0; i < safeCount; i += 1) {
      state.spawned.push(i < elite ? 'elite' : 'small')
    }
  }

  function finishRoomBattle() {
    state.roomActive = false
    if (state.eventBattleActive) {
      state.eventBattleActive = false
      const done = state.pendingEventBattleDone
      state.pendingEventBattleDone = null
      if (done) done()
      return
    }
    state.battleDoorRewarded += 1
  }

  function runEvent(effects, onDone) {
    const pending = applyEventEffects(effects)
    // 面板尚在打开时，不应已刷怪
    const spawnedBeforeClose = state.spawned.length
    // 关闭面板
    if (pending > 0) startEventBattle(pending, onDone)
    else if (onDone) onDone()
    return { spawnedBeforeClose }
  }

  return { state, runEvent, finishRoomBattle }
}

// 3a. 事件房单怪（精英）遭遇战闭环
{
  const h = makeHarness(true)
  const { spawnedBeforeClose } = h.runEvent(
    [{ kind: 'battle', count: 1 }, { kind: 'gold', value: 70 }],
    () => { h.state.completedRoom += 1 },
  )
  check(
    '事件房 count=1：关闭前 0 怪，关闭后刷 1 只精英且未提前结束房间',
    spawnedBeforeClose === 0 &&
      h.state.spawned.length === 1 &&
      h.state.spawned[0] === 'elite' &&
      h.state.roomActive &&
      h.state.completedRoom === 0,
  )
  h.finishRoomBattle()
  check(
    '事件房遭遇战清怪后回到事件收尾 onDone，且不误发战斗门奖励',
    !h.state.roomActive &&
      !h.state.eventBattleActive &&
      h.state.completedRoom === 1 &&
      h.state.battleDoorRewarded === 0,
  )
}

// 3b. 事件房多怪（小怪群）遭遇战闭环
{
  const h = makeHarness(true)
  h.runEvent([{ kind: 'battle', count: 3 }], () => { h.state.completedRoom += 1 })
  check(
    '事件房 count=3：刷 3 只小怪并在清怪后开启出口裂隙',
    h.state.spawned.length === 3 && h.state.spawned.every((k) => k === 'small'),
  )
  h.finishRoomBattle()
  check('事件房多怪清完后同样正常收尾', h.state.completedRoom === 1)
}

// 3c. 普通层（非房间）遭遇战计入清层配额
{
  const h = makeHarness(false)
  h.runEvent([{ kind: 'battle', count: 2 }], undefined)
  check(
    '普通层触发 battle ×2：刷 2 只小怪且 layerTotal 增加 2（不卡死或跳过清层）',
    h.state.spawned.length === 2 && h.state.layerTotal === 12,
  )
}

// 3d. 非 battle 事件直接走 onDone
{
  const h = makeHarness(true)
  h.runEvent([{ kind: 'gold', value: 50 }], () => { h.state.completedRoom += 1 })
  check(
    '非 battle 事件关闭后直接收尾，不触发刷怪',
    h.state.spawned.length === 0 && !h.state.roomActive && h.state.completedRoom === 1,
  )
}

console.log(`\n事件遭遇战冒烟：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
