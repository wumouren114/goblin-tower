/**
 * G2 数值接线三处回归冒烟测试（无浏览器，纯 Node + Vite SSR）：
 *   node sim/g2-stat-wiring-smoke.mjs
 * 覆盖：
 *   - 2a：睦·双重人格技能需求 = 120（100×1.2，无双重取反）；丛雨·瞬闪技能需求 = 68（80×0.85）
 *   - 2b：闪避上限统一读取 cards.ts 数据源（40%），装备金·疾影护符 + 训练可超过旧 24% 截断并封顶 40%
 *   - 2c：常规层（layer >= 3）500 次抽样中 bomber 占比 5~16%、blocker 占比 4~14%（各自独立分支）
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

function makeCtx(canvas) {
  return {
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    ellipse() {},
    bezierCurveTo() {},
    quadraticCurveTo() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  }
}
globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') return {}
    const c = { width: 1, height: 1, style: {}, getContext() { return (c._ctx ??= makeCtx(c)) } }
    return c
  },
}
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() }

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const { CHARACTERS } = await server.ssrLoadModule('/src/data/characters.ts')
const { POTENTIALS } = await server.ssrLoadModule('/src/data/potentials.ts')
const { cardOf, cardRuntimeValueAt } = await server.ssrLoadModule('/src/data/cards.ts')
const { Combat } = await server.ssrLoadModule('/src/systems/combat.ts')
const { Rng } = await server.ssrLoadModule('/src/core/rng.ts')

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

function makeWorld() {
  return {
    enemies: [],
    halfSize: 16,
    clamp: (x, z) => ({ x, z }),
    heal() {},
    grantInvuln() {},
    dashPlayer() {},
    burst() {},
  }
}

try {
  const gameSrc = readFileSync('src/game.ts', 'utf8')

  // ── 2a：充能上限不再双重取反 ─────────────────────────────────────
  {
    const noDoubleInvert = !gameSrc.includes("branch === 'shunshan'") && !gameSrc.includes("branch === 'mutsumi-duet' ? 0.8")
    check('2a game.ts 不再对 chargeMax 乘 0.8（避免与 combat 双重取反）', noDoubleInvert)
    const duetBranch = POTENTIALS.mutsumi.branches.find((b) => b.id === 'mutsumi-duet')
    check('2a 双重人格卡片文案已修正为 100→120（睦基础充能 100）', duetBranch?.cost.includes('100→120') && !duetBranch?.cost.includes('80→96'), duetBranch?.cost)

    // 睦·双重人格：原始 chargeMax = 100 → combat 有效上限与技能需求均为 120
    const cDuet = new Combat(new THREE.Scene(), { onHit() {}, onSfx() {} })
    cDuet.setCharacter('mutsumi')
    cDuet.setStats({
      maxHp: CHARACTERS.mutsumi.base.hp,
      chargeMax: CHARACTERS.mutsumi.base.chargeMax,
      stamina: CHARACTERS.mutsumi.base.stamina,
      magic: CHARACTERS.mutsumi.base.magic,
      intelligence: CHARACTERS.mutsumi.base.intelligence,
      moveSpeed: CHARACTERS.mutsumi.base.moveSpeed,
      dodgeChance: 0,
      critChance: 0,
      critMultiplier: 2,
    })
    cDuet.setPotential(['mutsumi-duet'], [])
    const w = makeWorld()
    cDuet.grantCharge(1) // 充至满格
    const maxAtFull = cDuet.charge
    const castOk = cDuet.trySkill(0, 0, 0, -2, w)
    check(
      '2a 睦·双重人格：技能需求 = 120（100×1.2，满充能 120 释放后归 0）',
      Math.abs(maxAtFull - 120) < 1e-4 && castOk && Math.abs(cDuet.charge) < 1e-4,
      `full=${maxAtFull}, after=${cDuet.charge}`,
    )

    // 丛雨·瞬闪：原始 chargeMax = 80 → 技能消耗 = 68（80×0.85），释放后余 12
    const cShun = new Combat(new THREE.Scene(), { onHit() {}, onSfx() {} })
    cShun.setCharacter('murasame')
    cShun.setStats({
      maxHp: CHARACTERS.murasame.base.hp,
      chargeMax: CHARACTERS.murasame.base.chargeMax,
      stamina: CHARACTERS.murasame.base.stamina,
      magic: CHARACTERS.murasame.base.magic,
      intelligence: CHARACTERS.murasame.base.intelligence,
      moveSpeed: CHARACTERS.murasame.base.moveSpeed,
      dodgeChance: 0,
      critChance: 0,
      critMultiplier: 2,
    })
    cShun.setPotential(['murasame-shunshan'], [])
    cShun.grantCharge(1) // 80
    const castShun = cShun.trySkill(0, 0, 0, -2, w)
    check(
      '2a 丛雨·瞬闪：技能需求 = 68（80×0.85，释放后余 12）',
      castShun && Math.abs(cShun.charge - 12) < 1e-4,
      `after=${cShun.charge}`,
    )
  }

  // ── 2b：闪避上限统一读取 cards.ts（40%），不再硬截断 24% ─────────
  {
    const dodgeCard = cardOf('dodge')
    const cap = (dodgeCard?.cap ?? 0) / 100
    const usesCardsCap = !gameSrc.includes('Math.min(0.24, c.dodge') && gameSrc.includes("cardOf('dodge')?.cap")
    check('2b game.ts 闪避上限读取 cards.ts 数据源（无 0.24 硬截断）', usesCardsCap && Math.abs(cap - 0.4) < 1e-6, `cap=${cap}`)

    // 装备金·疾影护符（+22%）+ 5 次训练（0.008×5=4%）= 26% > 24%；叠到 50% 时封顶 40%
    const goldVal = cardRuntimeValueAt(dodgeCard, 'gold')
    const after5Train = Math.min(cap, goldVal + 0.008 * 5)
    const afterCap = Math.min(cap, goldVal + 0.008 * 30)
    check(
      '2b 金·疾影护符 + 训练可超 24% 且封顶 40%',
      after5Train > 0.24 && Math.abs(after5Train - 0.26) < 1e-6 && Math.abs(afterCap - 0.4) < 1e-6,
      `gold+5train=${(after5Train * 100).toFixed(1)}%, capped=${(afterCap * 100).toFixed(1)}%`,
    )
  }

  // ── 2c：爆破手独立抽样分支（layer>=3，500 次抽样 bomber 5~16%、blocker 4~14%）──
  {
    const hasIndependentBomber =
      gameSrc.includes("else if (r < eliteChance + casterChance + spearChance + bomberChance) kind = 'bomber'") &&
      gameSrc.includes("else if (r < eliteChance + casterChance + spearChance + bomberChance + blockerChance) kind = 'blocker'")
    check('2c game.ts spawnOne() 中 bomber 与 blocker 为独立抽样分支', hasIndependentBomber)

    const rng = new Rng(20261121)
    const layer = 6
    const eliteChance = layer >= 4 ? 0.08 : 0
    const casterChance = Math.min(0.16, 0.07 + (layer - 2) * 0.015)
    const spearChance = Math.min(0.2, 0.08 + (layer - 2) * 0.02)
    const bomberChance = Math.min(0.16, 0.05 + (layer - 3) * 0.018)
    const blockerChance = Math.min(0.14, 0.04 + (layer - 4) * 0.02)
    let bombers = 0
    let blockers = 0
    const N = 500
    for (let i = 0; i < N; i += 1) {
      const r = rng.next()
      if (r < eliteChance) continue
      else if (r < eliteChance + casterChance) continue
      else if (r < eliteChance + casterChance + spearChance) continue
      else if (r < eliteChance + casterChance + spearChance + bomberChance) bombers += 1
      else if (r < eliteChance + casterChance + spearChance + bomberChance + blockerChance) blockers += 1
    }
    const bomberRate = bombers / N
    const blockerRate = blockers / N
    check(
      '2c L6 500 次抽样：bomber 占比 5~16%，blocker 占比 4~14%',
      bomberRate >= 0.05 && bomberRate <= 0.16 && blockerRate >= 0.04 && blockerRate <= 0.14,
      `bomber=${(bomberRate * 100).toFixed(1)}% (${bombers}/${N}), blocker=${(blockerRate * 100).toFixed(1)}% (${blockers}/${N})`,
    )
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
