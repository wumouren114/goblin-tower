/**
 * 数值补偿冒烟测试（补偿专武删除与中后期脆皮承伤）：
 *   node sim/balance-compensation-smoke.mjs
 */
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

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

try {
  const {
    BALANCE,
    DIFFICULTIES,
    LAYER_CURVE,
    mobHpFor,
    quotaFor,
    clearGoldFor,
    goldPerKillFor,
  } = await server.ssrLoadModule('/src/data/balance.ts')
  const { CHARACTERS } = await server.ssrLoadModule('/src/data/characters.ts')

  // 旧曲线基线（专武退役前）
  const OLD_MOB_HP_BASE = 24
  const OLD_MOB_HP_PER_LAYER = 0.36
  const oldMobHpL7 = (hpMul) => Math.round(OLD_MOB_HP_BASE * (1 + OLD_MOB_HP_PER_LAYER * 6) * hpMul)

  // 1. 层曲线基础值下调约 15%
  check(
    'mobHpBase / mobHpPerLayer 均下调约 15%',
    LAYER_CURVE.mobHpBase <= 21 && LAYER_CURVE.mobHpPerLayer <= 0.31,
    `base=${LAYER_CURVE.mobHpBase}, perLayer=${LAYER_CURVE.mobHpPerLayer}`,
  )

  // 2-4. 三难度 L7 怪物 HP 相比旧曲线低 >= 13%
  for (const [id, label] of [
    ['easy', '简单'],
    ['normal', '普通'],
    ['hard', '困难'],
  ]) {
    const oldHp = oldMobHpL7(DIFFICULTIES[id].hpMul)
    const curHp = mobHpFor(id, 7)
    const drop = (oldHp - curHp) / oldHp
    check(
      `${label}难度 L7 怪物 HP 较旧曲线低 ≥13%`,
      drop >= 0.13,
      `old=${oldHp} → new=${curHp} (-${(drop * 100).toFixed(1)}%)`,
    )
  }

  // 5. 各难度 countMul +0.15 且第 7 层刷怪配额提升
  const oldCountMul = { easy: 0.8, normal: 1.2, hard: 1.2 }
  check(
    '三难度 countMul 均 +0.15（怪更多但更脆）',
    Math.abs(DIFFICULTIES.easy.countMul - 0.95) < 1e-6 &&
      Math.abs(DIFFICULTIES.normal.countMul - 1.35) < 1e-6 &&
      Math.abs(DIFFICULTIES.hard.countMul - 1.35) < 1e-6,
    `easy=${DIFFICULTIES.easy.countMul}, normal=${DIFFICULTIES.normal.countMul}, hard=${DIFFICULTIES.hard.countMul}`,
  )
  const oldQuotaL7Normal = Math.round((LAYER_CURVE.quotaBase + LAYER_CURVE.quotaPerLayer * 6) * oldCountMul.normal)
  check(
    '普通难度 L7 刷怪配额高于旧曲线',
    quotaFor('normal', 7) > oldQuotaL7Normal,
    `old=${oldQuotaL7Normal} → new=${quotaFor('normal', 7)}`,
  )

  // 6. 各难度 goldMul +0.15 且通关金提升
  check(
    '三难度 goldMul 均 +0.15',
    Math.abs(DIFFICULTIES.easy.goldMul - 1.35) < 1e-6 &&
      Math.abs(DIFFICULTIES.normal.goldMul - 1.15) < 1e-6 &&
      Math.abs(DIFFICULTIES.hard.goldMul - 1.2) < 1e-6,
    `easy=${DIFFICULTIES.easy.goldMul}, normal=${DIFFICULTIES.normal.goldMul}, hard=${DIFFICULTIES.hard.goldMul}`,
  )
  const oldClearL7Normal = Math.round((LAYER_CURVE.clearGoldBase + LAYER_CURVE.clearGoldPerLayer * 6) * 1.0)
  check(
    '普通难度 L7 通关金高于旧曲线',
    clearGoldFor('normal', 7) > oldClearL7Normal,
    `old=${oldClearL7Normal} → new=${clearGoldFor('normal', 7)}`,
  )

  // 7. 击杀金曲线 everyLayers 3 → 2
  const oldKillL7 = 1 + Math.floor(6 / 3)
  const curKillL7 = goldPerKillFor(7)
  check(
    'goldPerKillEveryLayers = 2 且 L7 击杀金提升',
    LAYER_CURVE.goldPerKillEveryLayers === 2 && curKillL7 > oldKillL7,
    `everyLayers=${LAYER_CURVE.goldPerKillEveryLayers}, L7: ${oldKillL7} → ${curKillL7}`,
  )

  // 8. 三角色基础移速统一 +0.5
  check(
    '三角色基础移速统一 +0.5（睦 6.7 / 丛雨 8.0 / 大肥鱼 7.1）',
    Math.abs(CHARACTERS.mutsumi.base.moveSpeed - 6.7) < 1e-6 &&
      Math.abs(CHARACTERS.murasame.base.moveSpeed - 8.0) < 1e-6 &&
      Math.abs(CHARACTERS.fish.base.moveSpeed - 7.1) < 1e-6,
    `mutsumi=${CHARACTERS.mutsumi.base.moveSpeed}, murasame=${CHARACTERS.murasame.base.moveSpeed}, fish=${CHARACTERS.fish.base.moveSpeed}`,
  )

  // 9. 专武段已彻底移除且跨枝反应保持下线
  const gameSrc = readFileSync('src/game.ts', 'utf8')
  check(
    'balance.json 无 weapons 段且 resonancesEnabled 保持 false',
    !('weapons' in BALANCE) && gameSrc.includes('resonancesEnabled = false'),
  )
} finally {
  await server.close()
}

console.log(`\n数值补偿冒烟：${pass} 通过，${fail} 失败`)
if (fail > 0) process.exitCode = 1
