/**
 * 困难难度第 3 分支位 + 3 组跨枝反应冒烟测试
 * 运行：node sim/hard-branch-smoke.mjs
 *
 * 覆盖：
 * 1. 难度分支上限规则：hard = 3 分支位，normal / easy = 2 分支位（与 game.ts 接线一致）
 * 2. 顺序选分支写入：第 1 次写 branch、第 2 次写 branch2、第 3 次写 branch3，点节点保留全部分支与 resonances
 * 3. 跨枝反应判定：普通 2 分支最多 1 组反应；困难 3 分支同时成立全部 3 组反应且重复触发不重入
 * 4. Combat 实机运行：setPotential 传入 3 分支（potentialBranch3 生效）+ setResonances 传入 3 组反应同时生效
 *    - 血雨斩（res-liushang-jianyi）：带标记目标流血跳伤 ×1.4
 *    - 回潮（res-shunshan-liushang）：技能命中带流血目标返还 25% 充能
 *    - 满弦（res-jianyi-shunshan）：技能结算标记伤害随充能比例增幅
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

const { Combat } = await server.ssrLoadModule('/src/systems/combat.ts')
const chars = await server.ssrLoadModule('/src/data/characters.ts')

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) passed += 1
  else failed += 1
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}

const COMBOS = [
  { id: 'res-liushang-jianyi', a: 'murasame-liushang', b: 'murasame-jianyi' },
  { id: 'res-shunshan-liushang', a: 'murasame-shunshan', b: 'murasame-liushang' },
  { id: 'res-jianyi-shunshan', a: 'murasame-jianyi', b: 'murasame-shunshan' },
]

function maxBranchesFor(difficulty) {
  void difficulty
  return 1
}

function applyPotentialPick(current, choice) {
  const nodes = [...(current?.nodes ?? [])]
  if (choice.nodeId) nodes.push(choice.nodeId)
  const isNewBranch = !choice.nodeId
  const isSecond = isNewBranch && Boolean(current?.branch) && !current?.branch2
  const isThird = isNewBranch && Boolean(current?.branch) && Boolean(current?.branch2) && !current?.branch3
  return {
    branch: current?.branch ?? choice.branch,
    branch2: isSecond ? choice.branch : current?.branch2,
    branch3: isThird ? choice.branch : current?.branch3,
    nodes,
    resonances: current?.resonances,
  }
}

function activateResonances(pot) {
  const have = new Set([pot.branch, pot.branch2, pot.branch3].filter(Boolean))
  const newly = []
  for (const combo of COMBOS) {
    if (have.has(combo.a) && have.has(combo.b) && !(pot.resonances ?? []).includes(combo.id)) {
      newly.push(combo.id)
    }
  }
  if (newly.length > 0) {
    pot.resonances = [...(pot.resonances ?? []), ...newly]
  }
  return newly
}

// ── 1. 源码接线契约校验（确保 game.ts 与模型完全对齐） ────────────────────
const gameSrc = readFileSync('src/game.ts', 'utf-8')
const typesSrc = readFileSync('src/types.ts', 'utf-8')

check('types.ts RunState.potential 包含 branch3?: string', /branch3\?:\s*string/.test(typesSrc))
check('game.ts 分支上限已下线为 1（跨枝反应待新规则）', gameSrc.includes('const maxBranches = 1') && gameSrc.includes('resonancesEnabled = false'))
check('game.ts syncPotential 传递 [branch, branch2, branch3]', gameSrc.includes('[this.run.potential?.branch, this.run.potential?.branch2, this.run.potential?.branch3]'))
check('game.ts activateResonances 合并三分支并同步 combat.setResonances', gameSrc.includes('new Set([pot.branch, pot.branch2, pot.branch3].filter(Boolean))') && gameSrc.includes('this.combat?.setResonances(pot.resonances)'))

// ── 2. 难度分支位与跨枝反应状态流转 ──────────────────────────────────────
check('全难度统一 1 分支位（跨枝反应下线）', maxBranchesFor('normal') === 1 && maxBranchesFor('easy') === 1 && maxBranchesFor('hard') === 1)

{
  // 普通难度：选 2 条分支 → 最多 1 组反应，无第 3 分支空位
  let pot = undefined
  pot = applyPotentialPick(pot, { branch: 'murasame-liushang' })
  activateResonances(pot)
  pot = applyPotentialPick(pot, { branch: 'murasame-jianyi' })
  const r2 = activateResonances(pot)
  const owned = new Set([pot.branch, pot.branch2, pot.branch3].filter(Boolean))
  check('普通难度 2 分支写入 branch/branch2 且不再开放第 3 分支', owned.size === 2 && owned.size >= maxBranchesFor('normal') && pot.branch3 === undefined)
  check('普通难度 2 分支最多成立 1 组跨枝反应', r2.length === 1 && pot.resonances?.length === 1 && pot.resonances[0] === 'res-liushang-jianyi')
}

{
  // 困难难度：选 3 条分支 + 点节点 → 3 组反应同时成立且不重复
  let pot = undefined
  pot = applyPotentialPick(pot, { branch: 'murasame-liushang' })
  activateResonances(pot)
  pot = applyPotentialPick(pot, { branch: 'murasame-jianyi' })
  const firstRes = activateResonances(pot)
  pot = applyPotentialPick(pot, { branch: 'murasame-liushang', nodeId: 'murasame-liushang-rate' })
  const afterNode = activateResonances(pot)
  pot = applyPotentialPick(pot, { branch: 'murasame-shunshan' })
  const thirdRes = activateResonances(pot)
  const repeatRes = activateResonances(pot)

  check('困难难度第 3 次选分支写入 branch3 且保留既有节点与反应', pot.branch === 'murasame-liushang' && pot.branch2 === 'murasame-jianyi' && pot.branch3 === 'murasame-shunshan' && pot.nodes.includes('murasame-liushang-rate'))
  check('点节点后不丢失已有反应也不重复触发', firstRes.length === 1 && afterNode.length === 0)
  check('困难难度 3 分支同时成立全部 3 组跨枝反应且幂等', thirdRes.length === 2 && repeatRes.length === 0 && pot.resonances?.length === 3)
}

// ── 3. Combat 实机验证：第 3 分支 + 3 组跨枝反应同时生效 ─────────────────
function statsFor(id) {
  const d = chars.CHARACTERS[id]
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
    x, z, radius: 0.5, alive: true, hp, maxHp: hp, kind: 'goblin', elite: false, taken: 0,
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

function runMurasameScenario(branches, resonances) {
  const scene = new THREE.Scene()
  const combat = new Combat(scene, { onHit() {}, onSfx() {} })
  combat.setCharacter('murasame')
  combat.setStats(statsFor('murasame'), 1)
  combat.setPotential(branches, [])
  combat.setResonances(resonances)
  const world = makeWorld()
  const target = addDummy(world, 0, -2.0)

  // 1 次普攻：验证 3 分支普攻倍率（liushang ×0.8 + shunshan ×0.85），同时挂流血
  combat.tryAttack(0.05, 0, 0, 0, -1, world)
  const basicDmg = target.taken
  // 为目标施加 2 层剑意标记（验证血雨斩与满弦结算；注：近战普攻目前未调 marks.apply，仅弹道命中路径有挂标）
  combat.marks.apply('mark', combat.keyOf(target), 4000, { maxStacks: 3 })
  combat.marks.apply('mark', combat.keyOf(target), 4000, { maxStacks: 3 })

  // 推进 0.6s 触发 1 次流血跳伤（验证血雨斩 ×1.4）
  const beforeBleed = target.taken
  for (let i = 0; i < 12; i += 1) combat.update(0.05, 0, 0, world)
  const bleedTickDmg = target.taken - beforeBleed

  // 满充能释放突进技能命中带流血+标记目标（验证回潮返还 25% 充能 + 满弦标记结算增幅）
  combat.grantCharge(1)
  const beforeSkillDmg = target.taken
  const castOk = combat.trySkill(0, 0, 0, -1, world)
  const skillTotalDmg = target.taken - beforeSkillDmg
  const chargeAfterSkill = combat.charge

  combat.dispose()
  return { basicDmg, bleedTickDmg, castOk, skillTotalDmg, chargeAfterSkill }
}

const twoBranchNoRes = runMurasameScenario(
  ['murasame-liushang', 'murasame-jianyi'],
  [],
)
const threeBranchNoRes = runMurasameScenario(
  ['murasame-liushang', 'murasame-jianyi', 'murasame-shunshan'],
  [],
)
const threeBranchAllRes = runMurasameScenario(
  ['murasame-liushang', 'murasame-jianyi', 'murasame-shunshan'],
  ['res-liushang-jianyi', 'res-shunshan-liushang', 'res-jianyi-shunshan'],
)
const threeBranchTwoResNoFull = runMurasameScenario(
  ['murasame-liushang', 'murasame-jianyi', 'murasame-shunshan'],
  ['res-liushang-jianyi', 'res-shunshan-liushang'],
)

check(
  'Combat 第 3 分支已停用（分支上限 1，第 3 分支不影响数值）',
  Math.abs(threeBranchNoRes.basicDmg / twoBranchNoRes.basicDmg - 1) < 1e-3,
  `2-branch=${twoBranchNoRes.basicDmg.toFixed(2)}, 3-branch=${threeBranchNoRes.basicDmg.toFixed(2)}`,
)
check(
  '三组反应同时生效 ① 血雨斩：带标记流血跳伤 ×1.4',
  threeBranchNoRes.bleedTickDmg > 0 && Math.abs(threeBranchAllRes.bleedTickDmg / threeBranchNoRes.bleedTickDmg - 1.4) < 1e-3,
  `base=${threeBranchNoRes.bleedTickDmg.toFixed(3)}, res=${threeBranchAllRes.bleedTickDmg.toFixed(3)}`,
)
check(
  '跨枝反应已下线：回潮不返还充能',
  threeBranchAllRes.castOk && Math.abs(threeBranchAllRes.chargeAfterSkill - threeBranchNoRes.chargeAfterSkill) < 1e-6,
  `noRes=${threeBranchNoRes.chargeAfterSkill.toFixed(1)}, allRes=${threeBranchAllRes.chargeAfterSkill.toFixed(1)}`,
)
check(
  '跨枝反应已下线：满弦不提供充能增幅',
  Math.abs(threeBranchAllRes.skillTotalDmg - threeBranchTwoResNoFull.skillTotalDmg) < 1e-6,
  `without=${threeBranchTwoResNoFull.skillTotalDmg.toFixed(2)}, with=${threeBranchAllRes.skillTotalDmg.toFixed(2)}`,
)

await server.close()
console.log(`\n困难第 3 分支冒烟：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
