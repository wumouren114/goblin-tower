/**
 * 回声记忆小游戏冒烟测试（无浏览器，纯 Node + Vite SSR）：
 *   node sim/echo-memory-smoke.mjs
 */
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const {
  echoMemoryMiniGame,
  createEchoSession,
  sequenceLengthFor,
  ECHO_FLASH_SEC,
  ECHO_GAP_SEC,
  ECHO_TIME_LIMIT_SEC,
  ECHO_TOTAL_ROUNDS,
} = await server.ssrLoadModule('/src/minigames/echoMemory.ts')

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

function makeRng(seed = 42) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

function advanceShowPhase(session) {
  let guard = 0
  while (session.phase === 'show' && guard < 200) {
    session.tick(0.05)
    guard += 1
  }
}

try {
  // 1. MiniGame 接口契约
  check(
    'echoMemoryMiniGame 实现 MiniGame 完整接口',
    echoMemoryMiniGame.id === 'echo-memory' &&
      echoMemoryMiniGame.title === '回声记忆' &&
      typeof echoMemoryMiniGame.mount === 'function' &&
      typeof echoMemoryMiniGame.unmount === 'function',
  )

  // 2. 难度随层数/押注微调且严格控制在 3~5（不反人类）
  {
    const low0 = sequenceLengthFor(1, 30, 0)
    const low2 = sequenceLengthFor(1, 30, 2)
    const high0 = sequenceLengthFor(18, 150, 0)
    const high2 = sequenceLengthFor(18, 150, 2)
    const extreme = sequenceLengthFor(99, 999, 2)
    check(
      '序列长度严格在 3~5 且高层递增不反人类',
      low0 === 3 && low2 === 4 && high0 === 4 && high2 === 5 && extreme === 5,
      `low=[${low0},${low2}], high=[${high0},${high2}], extreme=${extreme}`,
    )
  }

  // 3. 每个符号闪现 0.5s 后切换，播完进入 input 阶段
  {
    const s = createEchoSession({ layer: 2, stake: 40, rng: makeRng(1) })
    const firstSym = s.sequence[0]
    check('起手处于 show 阶段且显示首个符号', s.phase === 'show' && s.activeSymbol === firstSym)
    s.tick(ECHO_FLASH_SEC - 0.05)
    check('0.5s 内仍保持当前符号亮起', s.activeSymbol === firstSym)
    s.tick(0.06) // 进入间隔
    check('超过 0.5s 后进入闪烁间隔', s.activeSymbol === -1)
    s.tick(ECHO_GAP_SEC + 0.02)
    check('间隔后切换到第 2 个符号', s.activeSymbol === s.sequence[1])
  }

  // 4. 3 轮全对通关 win:true
  {
    const s = createEchoSession({ layer: 5, stake: 50, rng: makeRng(7) })
    let finalRes = null
    for (let r = 0; r < ECHO_TOTAL_ROUNDS; r += 1) {
      advanceShowPhase(s)
      const seq = [...s.sequence]
      for (const sym of seq) {
        finalRes = s.submit(sym)
      }
    }
    check('3 轮全对通关 resolve { win: true, score: 3 }', finalRes?.win === true && finalRes?.score === 3, JSON.stringify(finalRes))
  }

  // 5. 点错允许重试 1 次，第 2 次失误判定失败
  {
    const s = createEchoSession({ layer: 3, stake: 40, rng: makeRng(13) })
    advanceShowPhase(s)
    const wrong1 = (s.sequence[0] + 1) % 4
    const r1 = s.submit(wrong1)
    check('第 1 次点错触发重播而非直接失败（retriesLeft 1→0）', r1 === null && s.retriesLeft === 0 && s.phase === 'show')
    advanceShowPhase(s)
    const wrong2 = (s.sequence[0] + 1) % 4
    const r2 = s.submit(wrong2)
    check('第 2 次点错直接 resolve { win: false }', r2?.win === false, JSON.stringify(r2))
  }

  // 6. 单局限时 ≤ 25 秒，超时判定失败
  {
    const s = createEchoSession({ layer: 4, stake: 40, rng: makeRng(19) })
    let res = null
    for (let i = 0; i < 600 && !res; i += 1) res = s.tick(0.05)
    check(
      '单局超时（25s）判定 win: false',
      ECHO_TIME_LIMIT_SEC <= 25 && res?.win === false && s.elapsed >= ECHO_TIME_LIMIT_SEC,
      `elapsed=${s.elapsed.toFixed(2)}`,
    )
  }

  // 7. ESC / abort 放弃 resolve { win: false }
  {
    const s = createEchoSession({ layer: 8, stake: 80, rng: makeRng(23) })
    const res = s.abort()
    check('ESC / abort 放弃 resolve { win: false }', res.win === false && s.phase === 'done')
  }
} finally {
  await server.close()
}

console.log(`\n────────────────────────\n共 ${pass + fail} 项，失败 ${fail} 项`)
if (fail > 0) {
  console.error('失败项：')
  for (const f of fails) console.error(` - ${f.name}  ${f.detail}`)
  process.exit(1)
}
console.log('全部通过 ✅')
