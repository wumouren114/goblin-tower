/**
 * 丛雨三分支重做 + 特效配色 + 格挡炸弹人冒烟测试
 * 运行：node sim/murasame-rework-smoke.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'

function makeCtx(canvas) {
  return {
    canvas,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }
    },
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
    createRadialGradient() {
      return { addColorStop() {} }
    },
    createLinearGradient() {
      return { addColorStop() {} }
    },
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error(`fake document: unsupported element ${tag}`)
    const canvas = {
      width: 1,
      height: 1,
      style: {},
      getContext() {
        if (!canvas._ctx) canvas._ctx = makeCtx(canvas)
        return canvas._ctx
      },
    }
    return canvas
  },
}
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() }

const { createServer } = await import('vite')
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const { CHARACTERS } = await server.ssrLoadModule('/src/data/characters.ts')
const { POTENTIALS } = await server.ssrLoadModule('/src/data/potentials.ts')
const { Combat, mitigateExplosionByBlock } = await server.ssrLoadModule('/src/systems/combat.ts')

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

const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps

function makeEnemy(x, z, hp = 1000) {
  return {
    x,
    z,
    radius: 0.45,
    maxHp: hp,
    hp,
    alive: true,
    hits: [],
    hit(amount) {
      if (!this.alive) return false
      this.hits.push(amount)
      this.hp -= amount
      if (this.hp <= 0) {
        this.hp = 0
        this.alive = false
        return true
      }
      return false
    },
  }
}

function makeWorld(enemies) {
  const halfSize = 20
  return {
    enemies,
    halfSize,
    heals: [],
    dashes: [],
    invulns: [],
    clamp(x, z) {
      return {
        x: Math.max(-halfSize, Math.min(halfSize, x)),
        z: Math.max(-halfSize, Math.min(halfSize, z)),
      }
    },
    heal(n) {
      this.heals.push(n)
    },
    grantInvuln(s) {
      this.invulns.push(s)
    },
    dashPlayer(dx, dz, distance, duration) {
      this.dashes.push({ dx, dz, distance, duration })
    },
    burst() {},
  }
}

function createMurasame(branch, nodes = [], magicOverride = null) {
  const scene = new THREE.Scene()
  const events = { hits: [], sfx: [] }
  const combat = new Combat(scene, {
    onHit(t, amount, crit, killed) {
      events.hits.push({ t, amount, crit, killed })
    },
    onSfx(name) {
      events.sfx.push(name)
    },
  })
  combat.setCharacter('murasame')
  combat.setWeaponLv(1)
  const base = CHARACTERS.murasame.base
  const stats = {
    maxHp: base.hp,
    chargeMax: base.chargeMax,
    stamina: base.stamina,
    magic: magicOverride !== null ? magicOverride : base.magic,
    intelligence: base.intelligence,
    moveSpeed: base.moveSpeed,
    dodgeChance: 0,
    critChance: 0,
    critMultiplier: 1.5,
  }
  combat.setStats(stats)
  combat.setPotential(branch ? [branch] : [], nodes)
  return { combat, stats, events }
}

try {
  // ── 1. 基础属性 ──────────────────────────────────────────────────
  check('丛雨初始生命上限 +15%（205 → 236）', CHARACTERS.murasame.base.hp === 236, `hp=${CHARACTERS.murasame.base.hp}`)
  check('其他角色初始生命未被改动', CHARACTERS.mutsumi.base.hp === 110 && CHARACTERS.fish.base.hp === 110)
  const jianyiBranch = POTENTIALS.murasame.branches.find((b) => b.id === 'murasame-jianyi')
  check('第三分支名称已改为「居合」', jianyiBranch?.name === '居合', `name=${jianyiBranch?.name}`)

  // ── 2. 流殇：按敌人最大生命百分比流血（独立于玩家攻击）──────────
  {
    const { combat: cBase } = createMurasame('murasame-liushang', [], 95)
    const eBase = makeEnemy(0, -1.5, 1000)
    const wBase = makeWorld([eBase])
    cBase.tryAttack(0.5, 0, 0, 0, -2, wBase)
    const firstHit = eBase.hits[0]
    // 普攻代价 -20%：19 * (95/100) * 0.8 = 14.44
    check('流殇保留普攻伤害 -20% 代价', near(firstHit, 19 * 0.95 * 0.8, 1e-4), `first=${firstHit.toFixed(4)}`)
    // 推进 3.05s，应触发恰好 6 跳 × 12 = 72（敌人 maxHp 1000 的 7.2%）
    for (let i = 0; i < 61; i += 1) cBase.update(0.05, 0, 0, wBase)
    const bleedTicks = eBase.hits.slice(1)
    const bleedSum = bleedTicks.reduce((s, v) => s + v, 0)
    check(
      '流殇基础：0.5s×6 跳，每跳 = 敌人 maxHp×1.2%（共 7.2%）',
      bleedTicks.length === 6 && bleedTicks.every((v) => near(v, 12, 1e-6)) && near(bleedSum, 72, 1e-6),
      `ticks=${bleedTicks.length}, each=${bleedTicks[0]}, sum=${bleedSum}`,
    )

    // 独立于玩家魔力/攻击力：把 magic 翻倍到 300，单跳仍为 12
    const { combat: cHighMag } = createMurasame('murasame-liushang', [], 300)
    const eHigh = makeEnemy(0, -1.5, 1000)
    const wHigh = makeWorld([eHigh])
    cHighMag.tryAttack(0.5, 0, 0, 0, -2, wHigh)
    for (let i = 0; i < 12; i += 1) cHighMag.update(0.05, 0, 0, wHigh)
    check(
      '流殇流血伤害独立于玩家攻击/魔力',
      eHigh.hits.length >= 2 && near(eHigh.hits[1], 12, 1e-6),
      `magic300_tick=${eHigh.hits[1]}`,
    )

    // 点满 3 节点（血流 0.4s + 深创 1.5% + 不止 4s）：10 跳 × 15 = 150（15%）
    const { combat: cFull } = createMurasame('murasame-liushang', [
      'murasame-liushang-rate',
      'murasame-liushang-power',
      'murasame-liushang-long',
    ])
    const eFull = makeEnemy(0, -1.5, 1000)
    const wFull = makeWorld([eFull])
    cFull.tryAttack(0.5, 0, 0, 0, -2, wFull)
    for (let i = 0; i < 82; i += 1) cFull.update(0.05, 0, 0, wFull)
    const fullTicks = eFull.hits.slice(1)
    const fullSum = fullTicks.reduce((s, v) => s + v, 0)
    check(
      '流殇点满：0.4s×10 跳（4s），每跳 1.5% maxHp（共 15%）',
      fullTicks.length === 10 && fullTicks.every((v) => near(v, 15, 1e-6)) && near(fullSum, 150, 1e-6),
      `ticks=${fullTicks.length}, each=${fullTicks[0]}, sum=${fullSum}`,
    )
  }

  // ── 3. 瞬闪：自动回能 + 消耗 68 + 无普攻减伤 + 回气 44 + 断流 10% ──
  {
    const { combat } = createMurasame('murasame-shunshan', [])
    const e = makeEnemy(0, -1.5, 1000)
    const w = makeWorld([e])
    combat.tryAttack(0.5, 0, 0, 0, -2, w)
    // 移除旧 -15% 普攻代价：19 * 0.95 = 18.05
    check('瞬闪已移除旧普攻 -15% 代价', near(e.hits[0], 19 * 0.95, 1e-4), `atk=${e.hits[0].toFixed(4)}`)

    // 自动回能：1.5% chargeMax / 秒（80 * 0.015 = 1.2/s，10 秒 = +12）
    const cRegen = createMurasame('murasame-shunshan', []).combat
    const wEmpty = makeWorld([])
    for (let i = 0; i < 100; i += 1) cRegen.update(0.1, 0, 0, wEmpty)
    check('瞬闪每秒自动回复 1.5% chargeMax（10s +12）', near(cRegen.charge, 12, 1e-3), `charge=${cRegen.charge.toFixed(3)}`)

    // 技能消耗 -15%（80 → 68），未点回气时回血 28
    const cCost = createMurasame('murasame-shunshan', []).combat
    const wSkill = makeWorld([makeEnemy(0, -3, 1000)])
    cCost.grantCharge(1) // 80
    const ok = cCost.trySkill(0, 0, 0, -5, wSkill)
    check('瞬闪技能消耗 -15%（80 → 68，释放后余 12）', ok && near(cCost.charge, 12, 1e-4), `charge=${cCost.charge}`)
    check('瞬闪基础突进回血 28', near(wSkill.heals[0], 28, 1e-4), `heal=${wSkill.heals[0]}`)

    // 一闪 +20%、回气 28→44、断流命中返 10% 充能（多目标仍只触发 1 次 = +8）
    const cNodes = createMurasame('murasame-shunshan', [
      'murasame-shunshan-power',
      'murasame-shunshan-heal',
      'murasame-shunshan-kill',
    ]).combat
    const e1 = makeEnemy(0, -2, 1000)
    const e2 = makeEnemy(0, -4, 1000)
    const wNodes = makeWorld([e1, e2])
    cNodes.grantCharge(1) // 80
    cNodes.trySkill(0, 0, 0, -6, wNodes)
    const expectedSkillDmg = 45 * 0.95 * 1.2 // 51.3
    check('瞬闪·一闪技能伤害 +20%', near(e1.hits[0], expectedSkillDmg, 1e-4), `dmg=${e1.hits[0]}`)
    check('瞬闪·回气突进回血 28 → 44', near(wNodes.heals[0], 44, 1e-4), `heal=${wNodes.heals[0]}`)
    check(
      '瞬闪·断流命中返 10% 充能（命中多目标仍限 1 次：80-68+8=20）',
      near(cNodes.charge, 20, 1e-4),
      `charge=${cNodes.charge}`,
    )
  }

  // ── 4. 居合：叠标上限 3 + <2 禁放 + 20% 突进 + 0 本体伤 + 引爆回血 ──
  {
    const { combat, stats } = createMurasame('murasame-jianyi', [])
    const marked = makeEnemy(0, -1.5, 1000)
    const unmarked = makeEnemy(0, -1.0, 1000) // 站在 20% 突进路径上但不带标记
    const w = makeWorld([marked])

    // 0 层 / 1 层禁止施放技能
    combat.grantCharge(1) // 80
    const cast0 = combat.trySkill(0, 0, 0, -5, w)
    check('居合 0 层标记无法施放技能且不耗充能', !cast0 && near(combat.charge, 80, 1e-4), `cast0=${cast0}, charge=${combat.charge}`)

    combat.tryAttack(0.5, 0, 0, 0, -2, w)
    check('居合普攻第 1 刀叠 1 层标记', combat.getMarkStacks(marked) === 1, `stacks=${combat.getMarkStacks(marked)}`)
    const cast1 = combat.trySkill(0, 0, 0, -5, w)
    check('居合 1 层标记（<2 层）无法施放技能', !cast1 && near(combat.charge, 80, 1e-4), `cast1=${cast1}`)

    // 再打 3 刀（推进冷却），验证上限锁定 3 层
    for (let i = 0; i < 3; i += 1) {
      combat.update(0.35, 0, 0, w)
      combat.tryAttack(0.5, 0, 0, 0, -2, w)
    }
    check('居合标记上限严格锁 3 层', combat.getMarkStacks(marked) === 3, `stacks=${combat.getMarkStacks(marked)}`)

    // 把无标记敌人放入路径，施放居合引爆
    w.enemies.push(unmarked)
    const beforeMarkedHits = marked.hits.length
    const cast3 = combat.trySkill(0, 0, 0, -5, w)
    const detonateDmg = marked.hits[beforeMarkedHits]
    const baseSkillDmg = 45 * 0.95 // 42.75
    check('居合技能消耗降至 60（80 → 20）', cast3 && near(combat.charge, 20, 1e-4), `charge=${combat.charge}`)
    check('居合突进距离缩至原距离 20%（7.5 → 1.5m）', near(w.dashes[0]?.distance ?? 0, 1.5, 1e-4), `dist=${w.dashes[0]?.distance}`)
    check('居合技能本体 0 直接伤害（路径上无标记目标未受伤）', unmarked.hits.length === 0, `unmarkedHits=${unmarked.hits.length}`)
    check(
      '居合 3 层引爆 = 180% 技能基础伤害（42.75×1.8=76.95）',
      near(detonateDmg, baseSkillDmg * 1.8, 1e-4),
      `detonate=${detonateDmg}`,
    )
    check(
      '居合 3 层引爆回复 9% 最大生命（236×0.09=21.24）',
      near(w.heals[0] ?? 0, stats.maxHp * 0.09, 1e-4),
      `heal=${w.heals[0]}, expected=${(stats.maxHp * 0.09).toFixed(4)}`,
    )

    // 含锋 +10% + 裂帛 3m 60% 溅射 + 蓄势 +2/s
    const { combat: cJNodes } = createMurasame('murasame-jianyi', [
      'murasame-jianyi-amp',
      'murasame-jianyi-boom',
      'murasame-jianyi-regen',
    ])
    const mainT = makeEnemy(0, -1.5, 1000)
    const nearT = makeEnemy(2.0, -1.5, 1000) // 距离 mainT 2m（在 3m 裂帛范围内）
    const wJN = makeWorld([mainT])
    cJNodes.tryAttack(0.5, 0, 0, 0, -2, wJN) // 第 1 刀无标：18.05
    cJNodes.update(0.35, 0, 0, wJN)
    cJNodes.tryAttack(0.5, 0, 0, 0, -2, wJN) // 第 2 刀有标吃含锋 +10%：18.05 * 1.1 = 19.855
    check(
      '居合·含锋：带标记目标受普攻伤害 +10%',
      near(mainT.hits[1], mainT.hits[0] * 1.1, 1e-4),
      `h1=${mainT.hits[0].toFixed(4)}, h2=${mainT.hits[1].toFixed(4)}`,
    )
    wJN.enemies.push(nearT)
    cJNodes.grantCharge(1)
    cJNodes.trySkill(0, 0, 0, -5, wJN)
    const det2 = mainT.hits[2]
    check(
      '居合·裂帛：引爆对 3m 内造成 60% 引爆伤害',
      near(nearT.hits[0] ?? 0, det2 * 0.6, 1e-4),
      `splash=${nearT.hits[0]}, expected=${(det2 * 0.6).toFixed(4)}`,
    )
  }

  // ── 5. F 格挡减免炸弹人爆炸伤害验证 ───────────────────────────────
  {
    const blocked = mitigateExplosionByBlock(50, true)
    const unblocked = mitigateExplosionByBlock(50, false)
    const gameSrc = readFileSync('src/game.ts', 'utf8')
    const bombUsesDamagePlayer = gameSrc.includes('this.damagePlayer(bomb.damage)')
    const damagePlayerChecksBlock =
      gameSrc.includes('const blocking = performance.now() < this.blockUntil') &&
      gameSrc.includes('blocking ? 0.2 : 1')
    check(
      'F 格挡对炸弹人爆炸生效（80% 减伤：50 → 10，且 game.ts 炸弹走 damagePlayer）',
      blocked.blocked && near(blocked.damage, 10, 1e-6) && !unblocked.blocked && near(unblocked.damage, 50, 1e-6) && bombUsesDamagePlayer && damagePlayerChecksBlock,
      `blocked=${blocked.damage}, unblocked=${unblocked.damage}, wired=${bombUsesDamagePlayer && damagePlayerChecksBlock}`,
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
