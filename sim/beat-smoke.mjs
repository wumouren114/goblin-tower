/**
 * 节拍时钟冒烟（Node 直接跑，不需要 canvas / three.js）：
 *   node sim/beat-smoke.mjs
 *
 * 依赖 Node 24 原生 TS type-stripping（node --version >= 22.18 / 23）。
 * 用 module.register 注册 data: URL 小加载器，解析无扩展名的相对 import。
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

const { BeatClock, DEFAULT_BEAT_CLOCK } = await import('../src/core/beatClock.ts')

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

function approx(actual, expected, tolerance = 1e-6, hint = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${hint} 期望 ≈${expected}（±${tolerance}），实际 ${actual}`)
  }
}

/** 134 BPM 八分音符网格 */
const GRID = 60000 / 134 / 2

console.log('\n节拍时钟 · beat-smoke')

check('134 BPM 八分音符网格 = 223.88ms', () => {
  const clock = new BeatClock()
  approx(clock.gridMs, GRID, 1e-9)
  approx(GRID, 223.880597, 1e-5)
})

check('默认 miss 带 > 0（否则 miss 永远判不出来）', () => {
  const clock = new BeatClock()
  ok(clock.missBandMs > 10, `missBandMs=${clock.missBandMs}`)
  ok(clock.config.goodMs < clock.gridMs / 2, 'goodMs 必须小于半个网格')
})

check('正拍 = perfect', () => {
  const clock = new BeatClock()
  eq(clock.judge(0), 'perfect')
  eq(clock.judge(GRID), 'perfect')
  eq(clock.judge(GRID * 3), 'perfect')
})

check('窗口分层：30=perfect / 45=good / 100=miss', () => {
  const clock = new BeatClock()
  eq(clock.judge(30), 'perfect')
  eq(clock.judge(45), 'good')
  eq(clock.judge(100), 'miss')
})

check('提前与滞后对称', () => {
  const clock = new BeatClock()
  eq(clock.judge(-60), 'good')
  eq(clock.judge(-100), 'miss')
})

check('半个网格处判 miss（不会算到隔壁拍点）', () => {
  const clock = new BeatClock()
  eq(clock.judge(GRID * 0.5 - 0.5), 'miss')
})

check('跨过中点后归到下一拍', () => {
  const clock = new BeatClock()
  const pos = clock.position(GRID * 0.55)
  eq(pos.index, 0, '取整下标')
  approx(pos.deviationMs, -GRID * 0.45, 1e-6, '偏差应为负（提前到下一拍）')
  eq(clock.judge(GRID * 0.55), 'miss')
})

check('phase 在格内 0..1', () => {
  const clock = new BeatClock()
  approx(clock.position(0).phase, 0, 1e-9)
  approx(clock.position(GRID * 0.5).phase, 0.5, 1e-9)
})

check('nextGridIn：踩点返回 0，之后是剩余量', () => {
  const clock = new BeatClock()
  approx(clock.nextGridIn(0), 0, 1e-9)
  approx(clock.nextGridIn(50), GRID - 50, 1e-6)
})

check('offsetMs 补偿输出延迟', () => {
  const clock = new BeatClock({ offsetMs: 60 })
  eq(clock.judge(60), 'perfect', '整体后移 60ms 后，原 +60 应变成正拍')
  eq(clock.judge(0), 'good', '原正拍在补偿后偏早 60ms，降到 good')
  eq(clock.judge(-60), 'miss', '偏早 120ms，超出 good 窗口')
})

check('reset 对齐新起点', () => {
  const clock = new BeatClock()
  clock.reset(1000)
  eq(clock.gridIndex(1000), 0)
  eq(clock.judge(1000), 'perfect')
  eq(clock.judge(1000 + GRID * 2), 'perfect')
})

check('gridIndex 用于同格去重', () => {
  const clock = new BeatClock()
  eq(clock.gridIndex(0), 0)
  eq(clock.gridIndex(GRID * 0.9), 0, '同格内不应变化')
  eq(clock.gridIndex(GRID * 1.1), 1)
})

check('goodMs < perfectMs 时被抬到 perfectMs', () => {
  const clock = new BeatClock({ perfectMs: 80, goodMs: 40 })
  eq(clock.config.goodMs, 80)
})

check('换曲改 BPM 只改网格', () => {
  const clock = new BeatClock({ bpm: 148 })
  approx(clock.gridMs, 60000 / 148 / 2, 1e-9)
  eq(clock.judge(0), 'perfect')
})

check('describe 输出可读', () => {
  const clock = new BeatClock()
  const text = clock.describe(60)
  ok(text.includes('beat#0'), text)
  ok(text.includes('good'), text)
})

check('默认配置口径（134 / 八分 / 35 / 60）', () => {
  eq(DEFAULT_BEAT_CLOCK.bpm, 134)
  eq(DEFAULT_BEAT_CLOCK.subdivision, 2)
  eq(DEFAULT_BEAT_CLOCK.perfectMs, 35)
  eq(DEFAULT_BEAT_CLOCK.goodMs, 60)
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.error.stack}`)
  process.exit(1)
}
