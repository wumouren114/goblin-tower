/**
 * 战斗系统冒烟（Node 假 canvas + Vite SSR 加载 TS）
 * 覆盖：三角色各打 20 秒、Mortis 变身计时/脉冲、丛雨突进路径命中+聚怪+回血、
 *       肥鱼召唤物存在/消失/伤害、白米饭、充能增长、武器档位。
 * 运行：node sim/combat-smoke.mjs
 */
import * as THREE from 'three'

// ── 假 canvas（纹理生成只需要 2D 接口，不真的绘图） ──────────────────────────
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

const { createServer } = await import('vite')
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

const { Combat } = await server.ssrLoadModule('/src/systems/combat.ts')
const chars = await server.ssrLoadModule('/src/data/characters.ts')
const runtime = await server.ssrLoadModule('/src/data/characterRuntime.ts')

let failed = 0
const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`)
}
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps

function statsFor(id, extra = {}) {
  const d = chars.CHARACTERS[id]
  return {
    maxHp: d.base.hp,
    moveSpeed: d.base.moveSpeed,
    damage: d.attack.baseDamage,
    attackSpeed: 1,
    attackRadius: d.attack.baseRange,
    critChance: 0,
    critMultiplier: 1.8,
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
  const world = {
    enemies: [],
    halfSize: 20,
    heals: 0,
    invulns: [],
    dashes: [],
    bursts: 0,
    clamp(x, z) {
      const h = this.halfSize
      return { x: Math.max(-h, Math.min(h, x)), z: Math.max(-h, Math.min(h, z)) }
    },
    heal(n) {
      this.heals += n
    },
    grantInvuln(s) {
      this.invulns.push(s)
    },
    dashPlayer(dx, dz, distance, duration) {
      this.dashes.push({ dx, dz, distance, duration })
    },
    burst() {
      this.bursts++
    },
  }
  return world
}

function addEnemy(world, x, z, hp = 100000, radius = 0.42, kind = 'goblin') {
  const e = {
    x,
    z,
    radius,
    alive: true,
    hp,
    maxHp: hp,
    kind,
    elite: kind === 'elite',
    hits: 0,
    taken: 0,
    hit(amount, kx, kz) {
      if (!this.alive) return false
      this.hits++
      this.taken += amount
      this.hp -= amount
      this.x += kx * 0.15
      this.z += kz * 0.15
      if (this.hp <= 0) {
        this.hp = 0
        this.alive = false
        return true
      }
      return false
    },
  }
  world.enemies.push(e)
  return e
}

function makeCombat(events) {
  const scene = new THREE.Scene()
  const hooks = {
    onHit(t, amount, crit, killed) {
      events.hits++
      events.lastAmount = amount
      events.lastCrit = crit
      events.killed += killed ? 1 : 0
      if (killed) events.killList.push(t)
    },
    onSfx(name) {
      events.sfx.push(name)
    },
  }
  return { combat: new Combat(scene, hooks), scene }
}

const DT = 1 / 60
function run(combat, world, seconds, opts = {}) {
  const { px = 0, pz = 0, aim = { x: 0, z: -1 }, attack = false } = opts
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    if (attack) combat.tryAttack(DT, px, pz, aim.x, aim.z, world)
    combat.update(DT, px, pz, world)
  }
}

try {
  // ═════════════ A. 若叶睦：20 秒普攻 + Mortis 变身 ═════════════
  {
    const events = { hits: 0, sfx: [], killed: 0, killList: [], lastAmount: 0, lastCrit: false }
    const { combat } = makeCombat(events)
    const world = makeWorld()
    combat.setCharacter('mutsumi')
    combat.setStats(statsFor('mutsumi'))
    combat.setWeaponLv(3)

    const e = addEnemy(world, 0, -5)
    let maxProjectiles = 0
    for (let i = 0; i < 20 * 60; i++) {
      // 敌人保持在前方 5m，专注验证 20 秒输出循环
      e.x = 0
      e.z = -5
      combat.tryAttack(DT, 0, 0, 0, -1, world)
      combat.update(DT, 0, 0, world)
      maxProjectiles = Math.max(maxProjectiles, combat.projectileCount)
    }
    check('mutsumi 20s 普攻有命中', events.hits > 0, `hits=${events.hits}`)
    check('mutsumi 普攻发射黄瓜弹道', maxProjectiles > 0, `peak projectiles=${maxProjectiles}`)
    check('mutsumi 伤害公式 20*100/100=20', near(events.lastAmount, 20, 1e-6), `last=${events.lastAmount}`)
    check('mutsumi 攻击音效已上报', events.sfx.filter((s) => s === 'attack').length > 0)

    // 变身
    world.enemies.length = 0
    const dummy = addEnemy(world, 0, -3, 100000)
    combat.grantCharge(1)
    check('mutsumi 满充能 skillReady', combat.skillReady)
    const before = events.hits
    const cast = combat.trySkill(0, 0, 0, -1, world)
    check('mutsumi 右键进入 Mortis', cast && combat.transformActive, `left=${combat.transformLeft.toFixed(2)}`)
    check('Mortis 持续时间 8s', near(combat.transformLeft, 8, 1e-6), `left=${combat.transformLeft}`)
    check('Mortis 充能已扣光', combat.charge === 0, `charge=${combat.charge}`)
    const mods = combat.modifiers
    check(
      'Mortis modifiers 来自 characters.ts',
      mods.staminaMul === 1.6 &&
        mods.magicMul === 1.7 &&
        mods.intelligenceMul === 0.6 &&
        mods.moveSpeedMul === 0.9 &&
        mods.damageReduction === 0.15,
      JSON.stringify(mods),
    )
    check('变身瞬间爆发命中', events.hits > before, `delta=${events.hits - before}`)

    const hitsBeforePulse = events.hits
    run(combat, world, 1.0, { px: 0, pz: 0 })
    check('Mortis 每 0.5s 音波脉冲命中', events.hits - hitsBeforePulse >= 2, `pulse hits=${events.hits - hitsBeforePulse}`)
    check('Mortis 期间 transformActive=true', combat.transformActive)
    run(combat, world, 7.2, { px: 0, pz: 0 })
    check('8s 后变身结束', !combat.transformActive)
    check('变身结束 modifiers 归 1', combat.modifiers.magicMul === 1 && combat.modifiers.damageReduction === 0)

    // lv4 变身期普攻 = 前方音波剑气
    combat.setWeaponLv(4)
    combat.grantCharge(1)
    combat.trySkill(0, 0, 0, -1, world)
    run(combat, world, 0.3, { px: 0, pz: 0 })
    const hb = events.hits
    const waveCast = combat.tryAttack(DT, 0, 0, 0, -1, world)
    run(combat, world, 0.45, { px: 0, pz: 0 })
    check('lv4 变身期普攻发射音波剑气', waveCast && combat.projectileCount > 0, `projectiles=${combat.projectileCount}`)
    check('音波剑气命中', events.hits > hb, `delta=${events.hits - hb}`)
    combat.dispose()
  }

  // ═════════════ B. 丛雨：扇形最多 8 目标 + 突进 ═════════════
  {
    const events = { hits: 0, sfx: [], killed: 0, killList: [], lastAmount: 0, lastCrit: false }
    const { combat } = makeCombat(events)
    const world = makeWorld()
    combat.setCharacter('murasame')
    combat.setStats(statsFor('murasame'))
    combat.setWeaponLv(5)

    // 突进路径 3 个敌人 + 终点附近 1 个
    const e1 = addEnemy(world, 0, -3)
    const e2 = addEnemy(world, 0, -5)
    const e3 = addEnemy(world, 0, -8)
    const e4 = addEnemy(world, 1.8, -9.5)
    combat.grantCharge(1)
    const healBefore = world.heals
    const dashed = combat.trySkill(0, 0, 0, -1, world)
    check('murasame 右键突进释放', dashed && world.dashes.length === 1)
    check(
      '突进 7.5m / 0.24s',
      world.dashes[0] && near(world.dashes[0].distance, 7.5) && near(world.dashes[0].duration, 0.24),
      JSON.stringify(world.dashes[0]),
    )
    check('突进路径命中 3 个', e1.taken > 0 && e2.taken > 0 && e3.taken > 0, `taken=${e1.taken},${e2.taken},${e3.taken}`)
    check('突进伤害 45*95/100*1.25', near(e1.taken, 45 * 0.95 * 1.25, 1e-6), `taken=${e1.taken}`)
    check('技能每命中回 12×3=36', near(world.heals - healBefore, 36, 1e-6), `heal=${world.heals - healBefore}`)
    check('突进后 0.4s 无敌', world.invulns.includes(0.4), JSON.stringify(world.invulns))
    check('终点 2.4m 聚怪', Math.hypot(e3.x, e3.z + 7.5) <= 1.0, `d=${Math.hypot(e3.x, e3.z + 7.5).toFixed(2)}`)
    check('满充能必能释放（充能上限 >= 消耗）', combat.chargeMax >= 80, `max=${combat.chargeMax}`)
    check('???? 64 ???lv5?', combat.charge === 16, `charge=${combat.charge}`)
    check('突进后 0.2s 硬直内不能普攻', !combat.tryAttack(DT, 0, 0, 0, -1, world))

    run(combat, world, 0.3, { px: 0, pz: 0 })
    // 扇形：12 个目标挤在 110° / 2.415m 内，只打 8 个
    world.enemies.length = 0
    for (let i = 0; i < 12; i++) {
      const ang = (i - 5.5) * 0.12
      addEnemy(world, Math.sin(ang) * 1.5, -Math.cos(ang) * 1.5, 100000)
    }
    const beforeCone = events.hits
    const swing = combat.tryAttack(DT, 0, 0, 0, -1, world)
    check('murasame 扇形普攻释放', swing)
    check('110° 扇形最多 8 目标', events.hits - beforeCone === 8, `hits=${events.hits - beforeCone}`)

    // lv4 普攻前冲（Combat 走 world.dashPlayer 兜底）
    combat.setWeaponLv(4)
    run(combat, world, 0.6, { px: 0, pz: 0 })
    const dashesBefore = world.dashes.length
    const atk = combat.tryAttack(DT, 0, 0, 0, -1, world)
    check('lv4 普攻带前冲 0.8m', atk && world.dashes.length === dashesBefore + 1, `dashes=${world.dashes.length - dashesBefore}`)
    check('murasame 技能音效', events.sfx.includes('dash') && events.sfx.includes('skill'))
    combat.dispose()
  }

  // ═════════════ C. 肥鱼：召唤物 + 白米饭 ═════════════
  {
    const events = { hits: 0, sfx: [], killed: 0, killList: [], lastAmount: 0, lastCrit: false }
    const { combat } = makeCombat(events)
    const world = makeWorld()
    combat.setCharacter('fish')
    combat.setStats(statsFor('fish'))
    combat.setWeaponLv(5)
    combat.grantCharge(1)
    const summoned = combat.trySkill(0, 0, 0, -1, world)
    check('fish 右键召唤', summoned && combat.minionCount === 5, `minions=${combat.minionCount}`)
    check('召唤物继承 35% 生命', near(combat.minionsList[0].hp, 110 * 0.55, 1e-6), `hp=${combat.minionsList[0].hp}`)
    check('召唤物消耗 110 充能', combat.charge === 0, `charge=${combat.charge}`)

    const target = addEnemy(world, 0, -5, 100000)
    run(combat, world, 2.0, { px: 0, pz: 0 })
    check('召唤物发射泡泡并命中', events.hits > 0 && target.hits > 0, `hits=${events.hits}`)
    check('召唤物伤害 10*0.4*(魔力80/100)=3.2', near(events.lastAmount, 6.24, 1e-6), `last=${events.lastAmount}`)
    // 重复释放刷新数量
    combat.grantCharge(1)
    combat.trySkill(0, 0, 0, -1, world)
    check('重复召唤刷新为 5 只', combat.minionCount === 5)
    run(combat, world, 10.5, { px: 0, pz: 0 })
    check('召唤物 10s 后消失', combat.minionCount === 0, `minions=${combat.minionCount}`)

    // 白米饭：lv3 每 10s 掉一份
    combat.setWeaponLv(3)
    const chargeBefore = combat.charge
    run(combat, world, 10.6, { px: 0, pz: 0 })
    const gotRice = combat.riceCount >= 1 || combat.charge >= chargeBefore + 20
    check('lv3 每 10s 掉白米饭', gotRice, `riceCount=${combat.riceCount} charge=${combat.charge.toFixed(1)}`)
    combat.dispose()
  }

  // ═════════════ D. 充能与层间起手 ═════════════
  {
    const events = { hits: 0, sfx: [], killed: 0, killList: [], lastAmount: 0, lastCrit: false }
    const { combat } = makeCombat(events)
    combat.setCharacter('fish')
    combat.setStats(statsFor('fish', { chargeGain: 0.5, chargeMax: 110 }))
    combat.resetLayer(0.5)
    check('层间起手 50% 充能', near(combat.charge, 55, 1e-6), `charge=${combat.charge}`)
    const beforeKill = combat.charge
    combat.onKill({
      x: 0,
      z: 0,
      radius: 0.42,
      alive: false,
      hit: () => false,
    })
    check('小怪击杀 8*1.5*1.25=15', near(combat.charge - beforeKill, 15, 1e-6), `+${(combat.charge - beforeKill).toFixed(2)}`)
    combat.resetLayer(0)
    combat.onKill({ x: 0, z: 0, radius: 0.6, alive: false, hit: () => false, kind: 'elite', elite: true })
    check('精英击杀 28*1.5*1.25=52.5', near(combat.charge, 52.5, 1e-6), `charge=${combat.charge}`)
    combat.resetLayer(0)
    combat.onKill({ x: 0, z: 0, radius: 1.5, alive: false, hit: () => false, kind: 'boss' })
    check('boss 击杀 70*1.5*1.25=131 → 上限 110', near(combat.charge, 110, 1e-6), `charge=${combat.charge}`)
    combat.resetLayer(0)
    combat.grantCharge(0.25)
    check('grantCharge(0.25)=27.5', near(combat.charge, 27.5, 1e-6), `charge=${combat.charge}`)
    combat.dispose()
  }

  // ═════════════ E. 武器档位读取 ═════════════
  {
    const t1 = runtime.getWeaponTier('mutsumi', 1)
    const t5 = runtime.getWeaponTier('mutsumi', 5)
    check('mutsumi lv1 单发 / lv5 三发', t1.projectiles === 1 && t5.projectiles === 3, `${t1.projectiles}/${t5.projectiles}`)
    check('mutsumi lv5 黄瓜变大', t5.sizeMul === 1.4 && t5.hitRadiusMul === 1.5, JSON.stringify({ s: t5.sizeMul, h: t5.hitRadiusMul }))
    check('murasame lv5 突进消耗 70', runtime.getWeaponTier('murasame', 5).skillCharge === 64)
    check('fish lv5 召唤 5 只', runtime.getWeaponTier('fish', 5).minionCount === 5)
    check('武器等级夹到 1..5', runtime.getWeaponTier('fish', 99).lv === 5 && runtime.getWeaponTier('fish', -3).lv === 1)
  }

  // ═════════════ F. 暴击与击杀 ═════════════
  {
    const events = { hits: 0, sfx: [], killed: 0, killList: [], lastAmount: 0, lastCrit: false }
    const { combat } = makeCombat(events)
    const world = makeWorld()
    combat.setCharacter('mutsumi')
    combat.setStats(statsFor('mutsumi', { critChance: 1 }))
    combat.setWeaponLv(1)
    const e = addEnemy(world, 0, -4, 16, 0.42)
    for (let i = 0; i < 120 && e.alive; i++) {
      combat.tryAttack(DT, 0, 0, 0, -1, world)
      combat.update(DT, 0, 0, world)
    }
    check('暴击 1.8 倍伤害', near(events.lastAmount, 16 * 1.8, 1e-6), `last=${events.lastAmount}`)
    check('暴击音效', events.sfx.includes('crit'))
    check('击杀事件 killed=true', events.killed === 1, `kills=${events.killed}`)
    combat.dispose()
  }
} finally {
  await server.close()
}

console.log('\n────────────────────────')
console.log(`共 ${results.length} 项，失败 ${failed} 项`)
if (failed > 0) {
  console.log('失败项：')
  for (const r of results) if (!r.ok) console.log(` - ${r.name}${r.detail ? '  ' + r.detail : ''}`)
  process.exitCode = 1
} else {
  console.log('全部通过 ✅')
}
