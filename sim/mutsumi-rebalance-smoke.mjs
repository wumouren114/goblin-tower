/**
 * 若叶睦三分支重做冒烟测试（节奏锁拍 / 交响技能期输出 / 双重人格高充能大范围）
 * 运行：node sim/mutsumi-rebalance-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import * as THREE from 'three'

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
    const c = { width: 64, height: 64, style: {} }
    c.getContext = () => makeCtx(c)
    return tag === 'canvas' ? c : {}
  },
}
globalThis.window = globalThis
globalThis.Image = class FakeImage {
  set src(_v) {}
}

const { createServer } = await import('vite')
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { Combat, rhythmComboMul } = await server.ssrLoadModule('/src/systems/combat.ts')
const { BeatClock, DEFAULT_BEAT_CLOCK, parseBpmParam } = await server.ssrLoadModule('/src/core/beatClock.ts')
const chars = await server.ssrLoadModule('/src/data/characters.ts')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) passed += 1
  else failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

function statsForMutsumi(extra = {}) {
  const d = chars.CHARACTERS.mutsumi
  return {
    maxHp: d.base.hp,
    moveSpeed: d.base.moveSpeed,
    damage: d.attack.baseDamage,
    attackSpeed: 1,
    attackRadius: d.attack.baseRange,
    critChance: 0,
    critMultiplier: 2,
    pickupRadius: 2,
    xpGain: 1,
    goldGain: 1,
    armor: 0,
    dashCooldown: 1.4,
    blades: 0,
    magic: d.base.magic,
    stamina: d.base.stamina,
    intelligence: d.base.intelligence,
    armorRate: 0,
    dodge: 0,
    chargeMax: d.base.chargeMax,
    chargeGain: 0,
    ...extra,
  }
}

function makeWorld() {
  return {
    enemies: [],
    halfSize: 20,
    heals: 0,
    invulns: [],
    dashes: [],
    bursts: 0,
    shield: 0,
    shieldSeconds: 0,
    hpRatio: 1,
    playerHpRatio() { return this.hpRatio },
    grantShield(a, s) { this.shield = Math.max(this.shield, a); this.shieldSeconds = Math.max(this.shieldSeconds, s) },
    clamp(x, z) { return { x: Math.max(-20, Math.min(20, x)), z: Math.max(-20, Math.min(20, z)) } },
    heal(n) { this.heals += n },
    grantInvuln(s) { this.invulns.push(s) },
    dashPlayer(dx, dz, distance, duration) { this.dashes.push({ dx, dz, distance, duration }) },
    burst() { this.bursts += 1 },
  }
}

function addDummy(world, x, z, hp = 100000) {
  const e = {
    x, z, radius: 0.4, alive: true, hp, maxHp: hp, kind: 'goblin', elite: false, taken: 0,
    hit(amount) {
      if (!this.alive) return false
      this.taken += amount
      this.hp -= amount
      if (this.hp <= 0) { this.hp = 0; this.alive = false; return true }
      return false
    },
  }
  world.enemies.push(e)
  return e
}

function makeMutsumiCombat(branches = [], nodes = [], extraStats = {}) {
  const scene = new THREE.Scene()
  const combat = new Combat(scene, { onHit() {}, onSfx() {} })
  combat.setCharacter('mutsumi')
  combat.setStats(statsForMutsumi(extraStats))
  combat.setPotential(branches, nodes)
  combat.resetBeat(0)
  return combat
}

// ── 1. 连击增伤曲线（0 / 20 / 40 / 60 / 61） ───────────────────────────────
check(
  '节奏连击倍率：0→1 / 20→1.15 / 40→1.3 / 60→1.5 / 61→1.5（60 封顶）',
  rhythmComboMul(0) === 1 &&
    rhythmComboMul(19) === 1 &&
    rhythmComboMul(20) === 1.15 &&
    rhythmComboMul(40) === 1.3 &&
    rhythmComboMul(60) === 1.5 &&
    rhythmComboMul(61) === 1.5 &&
    rhythmComboMul(120) === 1.5,
)

// ── 2. BPM 默认值与边界（90 / 150 / 非法值回退 120） ───────────────────────
{
  const clock = new BeatClock()
  const defaultOk =
    DEFAULT_BEAT_CLOCK.bpm === 120 &&
    DEFAULT_BEAT_CLOCK.perfectMs === 50 &&
    DEFAULT_BEAT_CLOCK.goodMs === 100 &&
    clock.config.bpm === 120
  clock.setBpm(90)
  const minOk = clock.config.bpm === 90
  clock.setBpm(150)
  const maxOk = clock.config.bpm === 150
  clock.setBpm(Number.NaN)
  const nanOk = clock.config.bpm === 120
  clock.setBpm(-50)
  const negOk = clock.config.bpm === 120
  const paramOk =
    parseBpmParam('90') === 90 &&
    parseBpmParam('150') === 150 &&
    parseBpmParam('abc') === 120 &&
    parseBpmParam('40') === 120 &&
    parseBpmParam('220') === 120 &&
    parseBpmParam(null) === 120
  check(
    'BPM 默认 120 (±50/±100ms) 且边界 90/150/非法值回退 120',
    defaultOk && minOk && maxOk && nanOk && negOk && paramOk,
  )
}

// ── 3. 节奏锁拍：攻击间隔 = 节拍网格，攻速加成无效 ──────────────────────────
{
  const world = makeWorld()
  addDummy(world, 0, -2)
  const slowStamina = makeMutsumiCombat(['mutsumi-rhythm'], [], { stamina: 100 })
  const fastStamina = makeMutsumiCombat(['mutsumi-rhythm'], [], { stamina: 400 })
  fastStamina.setRapidFire(10)

  slowStamina.tryAttack(0, 0, 0, 0, -1, world, 0)
  fastStamina.tryAttack(0, 0, 0, 0, -1, world, 0)
  // 120 BPM 八分网格 = 0.25s；推进 0.20s 两者均仍在冷却，推进到 0.26s 两者同时可再次攻击
  const blockedFast = !fastStamina.tryAttack(0.2, 0, 0, 0, -1, world, 250)
  const blockedSlow = !slowStamina.tryAttack(0.2, 0, 0, 0, -1, world, 250)
  const readyFast = fastStamina.tryAttack(0.06, 0, 0, 0, -1, world, 250)
  const readySlow = slowStamina.tryAttack(0.06, 0, 0, 0, -1, world, 250)
  check(
    '节奏分支攻击间隔锁定为节拍网格（0.25s），耐力/水枪攻速加成无效',
    blockedFast && blockedSlow && readyFast && readySlow,
  )
  slowStamina.dispose()
  fastStamina.dispose()
}

// ── 4. 节奏 miss：连击减半 + 0.3s 眩晕 + 10s 冷却 ──────────────────────────
{
  const world = makeWorld()
  addDummy(world, 0, -2)
  const combat = makeMutsumiCombat(['mutsumi-rhythm'])
  // 连续 7 次踩准（每 250ms 一次），连击 = 7
  for (let i = 0; i < 7; i += 1) {
    combat.tryAttack(0.3, 0, 0, 0, -1, world, i * 250)
  }
  const comboBeforeMiss = combat.combo

  // 第 1 次 miss（偏差 120ms）：连击 floor(7/2)=3，触发 0.3s 眩晕（lockedLeft=0.3）
  combat.tryAttack(0.3, 0, 0, 0, -1, world, 7 * 250 + 120)
  const comboAfterMiss1 = combat.combo
  // 推进 0.26s（大于 0.25s 网格冷却，但小于 0.3s 眩晕），仍被眩晕挡住
  combat.update(0.1, 0, 0, world)
  combat.update(0.1, 0, 0, world)
  combat.update(0.06, 0, 0, world)
  const stunnedBlocked = !combat.tryAttack(0.01, 0, 0, 0, -1, world, 8 * 250)

  // 再推 0.1s 眩晕结束，触发第 2 次 miss（仍在 10s 冷却内）：连击 floor(3/2)=1，但不再眩晕
  combat.update(0.1, 0, 0, world)
  combat.tryAttack(0.3, 0, 0, 0, -1, world, 9 * 250 + 120)
  const comboAfterMiss2 = combat.combo
  // 只推 0.26s（仅过网格冷却 0.25s，若再次眩晕 0.3s 会被挡住），应能立刻攻击
  combat.update(0.1, 0, 0, world)
  combat.update(0.1, 0, 0, world)
  combat.update(0.06, 0, 0, world)
  const noSecondStun = combat.tryAttack(0.01, 0, 0, 0, -1, world, 10 * 250)

  check(
    '节奏 miss 连击减半（7→3→1）+ 0.3s 眩晕',
    comboBeforeMiss === 7 && comboAfterMiss1 === 3 && stunnedBlocked && comboAfterMiss2 === 1,
    `7→${comboAfterMiss1}→${comboAfterMiss2}, stunned=${stunnedBlocked}`,
  )
  check(
    '节奏 miss 眩晕有 10s 冷却（冷却内第二次 miss 不重复眩晕）',
    noSecondStun,
  )
  combat.dispose()
}

// ── 5. 节奏踩准 2m / 50% 溅射 ──────────────────────────────────────────────
{
  const world = makeWorld()
  const main = addDummy(world, 0, -2.0)
  const near = addDummy(world, 1.5, -2.0) // 距离主目标 1.5m <= 2m
  const far = addDummy(world, 3.0, -2.0)  // 距离主目标 3.0m > 2m
  const combat = makeMutsumiCombat(['mutsumi-rhythm'])
  combat.tryAttack(0.3, 0, 0, 0, -1, world, 0)
  for (let i = 0; i < 10; i += 1) combat.update(0.05, 0, 0, world)
  check(
    '节奏踩准命中附带 2m / 50% 溅射（2m 外不受伤）',
    main.taken > 0 && Math.abs(near.taken - main.taken * 0.5) < 1e-2 && far.taken === 0,
    `main=${main.taken.toFixed(2)}, near=${near.taken.toFixed(2)}, far=${far.taken.toFixed(2)}`,
  )
  combat.dispose()
}

// ── 6. 大招/变身期间：节奏分支每次攻击固定 +2 连击（无需踩拍） ──────────────
{
  const world = makeWorld()
  addDummy(world, 0, -2)
  const combat = makeMutsumiCombat(['mutsumi-rhythm'])
  combat.grantCharge(1)
  const transformed = combat.trySkill(0, 0, 0, -1, world)
  const c0 = combat.combo
  // 故意传 miss 时间点（120ms），变身期间仍应固定 +2 连击
  combat.tryAttack(0.3, 0, 0, 0, -1, world, 120)
  const c1 = combat.combo
  combat.tryAttack(0.3, 0, 0, 0, -1, world, 370)
  const c2 = combat.combo
  check(
    '大招/变身期间节奏分支每次攻击固定 +2 连击（无需踩拍）',
    transformed && c1 === c0 + 2 && c2 === c1 + 2,
    `${c0}→${c1}→${c2}`,
  )
  combat.dispose()
}

// ── 7. 交响：技能期间普攻 ×0.7、技能音波 ×0.75 ────────────────────────────
{
  function runSkillAndAttack(branches) {
    const world = makeWorld()
    const target = addDummy(world, 0, -2.0)
    const combat = makeMutsumiCombat(branches)
    combat.grantCharge(1)
    combat.trySkill(0, 0, 0, -1, world)
    // 记录 1 次技能音波脉冲伤害（0.5s 触发）
    const beforePulse = target.taken
    for (let i = 0; i < 11; i += 1) combat.update(0.05, 0, 0, world)
    const pulseDmg = target.taken - beforePulse
    // 技能/变身期间发起 1 次普攻（用单目标对齐主弹道伤害：交响多 1 发 60% 副弹，把副弹错开角度测主弹或对比单发）
    const target2 = addDummy(world, 0, -4.9)
    target.alive = false
    const beforeAtk = target2.taken
    combat.tryAttack(0.5, 0, 0, 0, -1, world, 0)
    for (let i = 0; i < 10; i += 1) combat.update(0.05, 0, 0, world)
    const atkDmg = target2.taken - beforeAtk
    combat.dispose()
    return { pulseDmg, atkDmg }
  }
  const base = runSkillAndAttack([])
  const sym = runSkillAndAttack(['mutsumi-symphony'])
  check(
    '交响技能音波场伤害 ×0.75',
    base.pulseDmg > 0 && Math.abs(sym.pulseDmg / base.pulseDmg - 0.75) < 1e-2,
    `base=${base.pulseDmg.toFixed(2)}, sym=${sym.pulseDmg.toFixed(2)}`,
  )
  const atkRatio = sym.atkDmg / base.atkDmg
  check(
    '交响技能/变身期间允许普攻且主弹普攻伤害 ×0.7',
    base.atkDmg > 0 && Math.abs(atkRatio - 0.7) < 1e-2,
    `base=${base.atkDmg.toFixed(2)}, sym=${sym.atkDmg.toFixed(2)}, ratio=${atkRatio.toFixed(3)}`,
  )
}

// ── 8. 双重人格：充能 ×1.2、范围 ×1.25、同化 0.3s/+5s ───────────────────────
{
  const base = makeMutsumiCombat([])
  const duet = makeMutsumiCombat(['mutsumi-duet'], ['mutsumi-duet-core'])
  check(
    '双重人格技能所需充能 ×1.2（100→120）',
    base.chargeMax === 100 && duet.chargeMax === 120,
    `base=${base.chargeMax}, duet=${duet.chargeMax}`,
  )

  // 范围 ×1.25：默认脉冲半径 4.3m（+目标半径0.4=4.7m），×1.25 = 5.375m（+0.4=5.775m）
  // 放在 5.2m 处的目标：常态打不到，双重人格打得到
  const wBase = makeWorld()
  const eBase = addDummy(wBase, 0, -5.2)
  base.grantCharge(1)
  base.trySkill(0, 0, 0, -1, wBase)

  const wDuet = makeWorld()
  const eDuet = addDummy(wDuet, 0, -5.2)
  duet.grantCharge(1)
  duet.trySkill(0, 0, 0, -1, wDuet)
  check(
    '双重人格技能范围 ×1.25（5.2m 目标常态未中、双重人格命中）',
    eBase.taken === 0 && eDuet.taken > 0,
    `baseTaken=${eBase.taken}, duetTaken=${eDuet.taken.toFixed(1)}`,
  )

  // 同化：每击杀延长 0.3s，最多 +5s（8s 基础 + 5s 上限 = 13s）
  const t0 = duet.transformLeft
  duet.onKill('small', wDuet)
  const t1 = duet.transformLeft
  for (let i = 0; i < 30; i += 1) duet.onKill('small', wDuet)
  const tCap = duet.transformLeft
  check(
    '双重人格·同化每击杀延长 0.3s 且单次变身上限 +5s',
    Math.abs(t1 - t0 - 0.3) < 1e-3 && Math.abs(tCap - t0 - 5) < 1e-3,
    `t0=${t0.toFixed(2)}, +1kill=${t1.toFixed(2)}, cap=${tCap.toFixed(2)}`,
  )

  base.dispose()
  duet.dispose()
}

// ── 9. HUD 连击 ×N 与 main.ts ?bpm= 接线检查 ───────────────────────────────
const hudSrc = readFileSync('src/ui/hud.ts', 'utf-8')
const mainSrc = readFileSync('src/main.ts', 'utf-8')
check(
  'HUD 连击显示为 ×N 且 60 以上封顶缩放 + BPM 脉冲',
  hudSrc.includes('`×${count}`') && hudSrc.includes('Math.min(60, count)'),
)
check(
  'main.ts 接入 ?bpm= 参数并调用 parseBpmParam / setDefaultBpm',
  mainSrc.includes("params.get('bpm')") && mainSrc.includes('parseBpmParam'),
)

await server.close()
console.log(`\n若叶睦三分支重做冒烟：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
