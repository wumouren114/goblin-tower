// 哥布林之塔 · 数值蒙特卡洛模拟器 v3（对应 balance.json v3）
// 规则：无经验/等级系统（一切金币购买）；每层怪物总数固定；限时内清完才算通关，超时判负。
// 运行：node sim/simulate.mjs [--runs 400] [--difficulty hard] [--verbose]
// 环境变量：SLOPPY=1 模拟乱买玩家
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const balance = JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'data', 'balance.json'), 'utf8'))

const args = new Map()
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1])
const RUNS = Number(args.get('runs') ?? 400)
const ONLY = args.get('difficulty') ?? null
const VERBOSE = args.has('verbose')
const SLOPPY = process.env.SLOPPY === '1'

// ── 角色基础值（镜像 src/data/characters.ts）──
const CHARS = {
  mutsumi: {
    hp: 110, chargeMax: 100, stamina: 135, magic: 100, intelligence: 100, moveSpeed: 6.2,
    attack: { damage: 14, intervalBase: 0.55, minInterval: 0.24, shape: 'single' },
    chargeGainMul: 0.55,
    skill: { cost: 100, kind: 'transform', duration: 8, aoe: 0.4 },
    exposure: 1.0,
  },
  murasame: {
    hp: 205, chargeMax: 80, stamina: 145, magic: 95, intelligence: 70, moveSpeed: 7.5,
    attack: { damage: 19, intervalBase: 0.55, minInterval: 0.22, shape: 'cone', coneTargets: 2.2 },
    chargeGainMul: 1,
    skill: { cost: 80, kind: 'dash', heal: 28, aoe: 0.3 },
    exposure: 1.15,
  },
  fish: {
    hp: 110, chargeMax: 90, stamina: 180, magic: 80, intelligence: 110, moveSpeed: 6.6,
    attack: { damage: 10, intervalBase: 0.55, minInterval: 0.2, shape: 'single' },
    chargeGainMul: 1.25,
    skill: { cost: 90, kind: 'summon', duration: 10, count: 3, minionDpsRatio: 0.45, aoe: 0.25 },
    exposure: 0.85,
  },
}

const CHARGE_PER_KILL = 8
const CRIT = 1.08

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rnd = (state) => {
  let t = (state.s += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const C = balance.layerCurve
const WEAPON = balance.weapons

const layerCount = (diff) => diff.stages.reduce((a, b) => a + b, 0)
function isBossLayer(diff, layer) {
  let acc = 0
  for (const s of diff.stages) {
    acc += s
    if (layer === acc) return true
  }
  return false
}

function playerOutput(charId, st) {
  const c = CHARS[charId]
  const w = WEAPON[charId].tiers[st.weaponLv - 1]
  const magic = c.magic + st.cards.magic
  const stamina = c.stamina + st.cards.stamina
  const intelligence = c.intelligence + st.cards.intelligence

  let damage = c.attack.damage
  let crowdHits = 1
  if (charId === 'mutsumi') {
    damage = w.damage
    crowdHits = w.projectiles
    if (w.bounce) crowdHits += w.bounce * w.bounceMul * w.projectiles
  } else if (charId === 'murasame') {
    damage = w.damage
    crowdHits = c.attack.coneTargets * (w.allStatMul ?? 1)
  } else if (charId === 'fish') {
    damage = w.damage
    crowdHits = 1 + (w.pierce ?? 0) + w.minionCount * ((c.skill.minionDpsRatio ?? 0.45) + 0.12 * (st.weaponLv - 1))
  }
  if (w.allStatMul > 1) damage *= w.allStatMul

  const interval = Math.max(c.attack.minInterval, c.attack.intervalBase * 100 / stamina)
  const hit = damage * (magic / 100) * CRIT
  const singleDps = hit / interval
  let crowdDps = (hit * crowdHits) / interval

  const chargeCost = Math.max(20, (charId === 'murasame' ? w.skillCharge : c.chargeMax) + st.cards.chargeMax)
  const chargePerKill = CHARGE_PER_KILL * (c.chargeGainMul ?? 1) * (1 + st.cards.chargeGain)
  if (charId === 'mutsumi') {
    const castsPerLayerCost = chargeCost / (chargePerKill * 8) // 粗略：每 8 杀一次
    const uptime = clamp(castsPerLayerCost * c.skill.duration, 0, 0.6)
    crowdDps *= 1 + uptime * 0.5
  } else {
    crowdDps *= 1 + c.skill.aoe
  }

  return { singleDps, crowdDps, interval, magic, stamina, intelligence, chargeCost }
}

function makeState(charId) {
  const c = CHARS[charId]
  return {
    charId,
    hp: c.hp,
    maxHp: c.hp,
    gold: 0,
    weaponLv: 1,
    cards: { magic: 0, stamina: 0, intelligence: 0, hp: 0, moveSpeed: 0, chargeMax: 0, chargeGain: 0, dodge: 0, armor: 0 },
  }
}

function rollQuality(layer, rand) {
  const Q = balance.shop.quality
  const t2 = Math.min(Q.tier2.chanceCap, Q.tier2.chancePerLayer * Math.max(0, layer - Q.tierUpStartLayer + 1))
  const t3 = Math.min(Q.tier3.chanceCap, Q.tier3.chancePerLayer * Math.max(0, layer - Q.tier3.startLayer + 1))
  const r = rand()
  if (r < t3) return { tier: 3, valueMul: Q.tier3.valueMul, priceMul: Q.tier3.priceMul }
  if (r < t3 + t2) return { tier: 2, valueMul: Q.tier2.valueMul, priceMul: Q.tier2.priceMul }
  return { tier: 1, valueMul: 1, priceMul: 1 }
}

function shopPrice(base, layer) {
  return Math.round(base * (1 + balance.shop.priceGrowthPerLayer * (layer - 1)))
}

/** 消费策略：先保命，再升专武，再买卡 */
function spendGold(st, layer, rand) {
  const heal = balance.shop.consumables.heal
  const healAt = SLOPPY ? 0.35 : 0.55
  if (st.hp < st.maxHp * healAt && st.gold >= heal.price) {
    st.gold -= heal.price
    st.hp = Math.min(st.maxHp, st.hp + st.maxHp * heal.healRatio)
  }
  const nextTier = WEAPON[st.charId].tiers[st.weaponLv]
  if (nextTier && st.gold >= nextTier.price && (!SLOPPY || rand() < 0.3)) {
    st.gold -= nextTier.price
    st.weaponLv += 1
  }
  const cardCap = SLOPPY ? 1 : 5
  let guard = 0
  while (st.gold >= 30 && guard < cardCap) {
    guard += 1
    const pool = balance.buffCards.filter((c) => (st.cards[c.stat] ?? 0) / c.value < c.maxStacks)
    if (!pool.length) break
    const picked = pool[Math.floor(rand() * pool.length)]
    const q = rollQuality(layer, rand)
    const price = Math.round(shopPrice(picked.basePrice, layer) * q.priceMul)
    if (st.gold < price) break
    st.gold -= price
    const value = picked.value * q.valueMul
    if (picked.stat === 'hp') {
      st.maxHp += value
      st.hp += value
      st.cards.hp += value
    } else {
      st.cards[picked.stat] += value
    }
  }
}

/** 传送门收益：v3 奖励房 > 对战房 */
function portalReward(st, layer, diff, rand) {
  const P = balance.portals
  let gold = 0
  for (let i = 0; i < P.count; i += 1) {
    const r = rand()
    const type = r < P.weights.reward ? 'reward' : r < P.weights.reward + P.weights.trade ? 'trade' : 'battle'
    if (type === 'reward') {
      const r2 = rand()
      if (r2 < P.reward.chest) {
        gold += P.chestGoldBase + P.chestGoldPerLayer * (layer - 1)
        if (rand() < P.chestCardChance) {
          const free = balance.buffCards[Math.floor(rand() * balance.buffCards.length)]
          if (free.stat === 'hp') { st.maxHp += free.value; st.hp += free.value; st.cards.hp += free.value }
          else st.cards[free.stat] += free.value
        }
      } else {
        gold += 20
        const free = balance.skillCards[Math.floor(rand() * balance.skillCards.length)]
        if (free.id === 'crit' || free.id === 'lifesteal') st.cards.magic += 8
        else st.cards.stamina += 8
      }
    } else if (type === 'trade') {
      const r2 = rand()
      if (r2 < P.trade.merchant) {
        const price = shopPrice(45, layer)
        if (st.gold + gold >= price + 20) {
          st.gold -= price + 20
          st.cards.magic += 12
        }
      } else {
        const cost = P.altarBaseCost + P.altarCostStep * (layer - 1)
        if (st.gold + gold >= cost) {
          st.gold -= cost
          st.cards.stamina += 10
        }
      }
    } else {
      const mul = rand() < P.battle.mobWave ? P.mobWaveGoldMul : P.eliteFightGoldMul
      gold += (P.chestGoldBase * 0.6 + P.chestGoldPerLayer * 0.6 * (layer - 1)) * mul
    }
  }
  st.gold += gold * diff.goldMul
}

function simulateRun(charId, diff, seed) {
  const rand = (() => { const s = { s: seed }; return () => rnd(s) })()
  const st = makeState(charId)
  const layers = layerCount(diff)
  const trace = []
  let diedAt = null
  let cleared = 0

  for (let layer = 1; layer <= layers; layer += 1) {
    const boss = isBossLayer(diff, layer)
    const out = playerOutput(charId, st)
    const warmTable = diff.id === 'hard' ? balance.warmup.hard : balance.warmup.easyNormal
    const W = warmTable[layer - 1] ?? null
    const mobHp = C.mobHpBase * (1 + C.mobHpPerLayer * (layer - 1)) * diff.hpMul * (W?.hpMul ?? 1)
    const monsterCount = Math.round((C.quotaBase + C.quotaPerLayer * (layer - 1)) * (diff.countMul ?? 1) * (boss ? 0.6 : 1))
    const timer = (boss ? balance.meta.bossTimerSeconds : balance.meta.layerTimerSeconds) * diff.timerMul + (boss ? 0 : (W?.timerBonus ?? 0))

    const spawnRate = (C.spawnBatchBase / (Math.max(C.spawnIntervalMin, C.spawnIntervalBase - C.spawnIntervalDecay * (layer - 1)) * (W?.spawnMul ?? 1))) * diff.spawnMul
    let clearTime
    if (boss) {
      const bossHp = C.bossHpBase * (1 + C.bossHpPerLayer * (layer - 1)) * diff.hpMul
      clearTime = bossHp / (out.singleDps * 1.25)
    } else {
      // 固定怪物总数：清怪时间 = 总数 / min(输出击杀速率, 刷新速率)
      const dpsKillRate = out.crowdDps / mobHp
      const killRate = Math.min(dpsKillRate, spawnRate * 0.92)
      clearTime = monsterCount / killRate
    }

    // v3：超时直接判负
    if (clearTime > timer) {
      diedAt = layer
      trace.push({ layer, boss, monsterCount, mobHp, clearTime, timer, timedOut: true, dead: true, hp: st.hp, maxHp: st.maxHp, gold: st.gold, weaponLv: st.weaponLv, singleDps: out.singleDps, crowdDps: out.crowdDps })
      break
    }

    const clearDur = clearTime
    const mobDmg = C.mobDamageBase * (1 + C.mobDamagePerLayer * (layer - 1)) * diff.damageMul * (W?.damageMul ?? 1)
    const hitsPerSecond = boss ? 0.12 : 0.075
    const crowdFactor = boss ? 1 : 1 + Math.min(0.4, spawnRate / 8)
    const dodge = Math.min(0.24, st.cards.dodge ?? 0)
    const armor = clamp(st.cards.armor ?? 0, 0, 0.6)
    let dmgTaken = mobDmg * hitsPerSecond * clearDur * crowdFactor * (1 - dodge) * (1 - armor) * CHARS[charId].exposure
    if (boss) dmgTaken += mobDmg * 2.2 * (1 - dodge) * (1 - armor) * CHARS[charId].exposure
    st.hp -= dmgTaken
    if (charId === 'murasame') st.hp += 12 * Math.max(1, clearDur / 22)

    if (st.hp <= 0) {
      diedAt = layer
      trace.push({ layer, boss, monsterCount, mobHp, clearTime, timer, dead: true, hp: 0, maxHp: st.maxHp, gold: st.gold, weaponLv: st.weaponLv, singleDps: out.singleDps, crowdDps: out.crowdDps })
      break
    }

    // 奖励：无经验，只有金币
    const goldPerKill = C.goldPerKillBase + Math.floor((layer - 1) / C.goldPerKillEveryLayers)
    st.gold += Math.round((monsterCount * goldPerKill + C.clearGoldBase + C.clearGoldPerLayer * (layer - 1)) * diff.goldMul)
    portalReward(st, layer, diff, rand)
    if (boss) {
      st.gold += Math.round((130 + 22 * layer) * diff.goldMul)
      st.hp = Math.min(st.maxHp, st.hp + st.maxHp * 0.25)
      const free = balance.buffCards[Math.floor(rand() * balance.buffCards.length)]
      if (free.stat === 'hp') { st.maxHp += free.value; st.hp += free.value; st.cards.hp += free.value }
      else st.cards[free.stat] += free.value
    }

    spendGold(st, layer, rand)
    st.hp = Math.min(st.maxHp, st.hp)
    cleared += 1
    trace.push({ layer, boss, monsterCount, mobHp, clearTime, timer, hp: st.hp, maxHp: st.maxHp, gold: st.gold, weaponLv: st.weaponLv, singleDps: out.singleDps, crowdDps: out.crowdDps })
  }

  return { charId, difficulty: diff.name, diedAt, survived: diedAt === null, cleared, trace, st }
}

const diffs = Object.entries(balance.difficulties).filter(([k]) => !ONLY || k === ONLY)
const results = []
for (const [id, diff] of diffs) {
  for (const charId of Object.keys(CHARS)) {
    const runs = []
    for (let i = 0; i < RUNS; i += 1) runs.push(simulateRun(charId, { ...diff, id }, 1000 + i * 7919))
    const wins = runs.filter((r) => r.survived).length
    const deaths = runs.filter((r) => !r.survived).map((r) => r.diedAt)
    const avgLayer = deaths.length ? deaths.reduce((a, b) => a + b, 0) / deaths.length : 0
    const timeouts = runs.reduce((a, r) => a + r.trace.filter((t) => t.timedOut).length, 0)
    const clears = runs.flatMap((r) => r.trace.filter((t) => !t.boss && t.clearTime))
    const avgClear = clears.length ? clears.reduce((a, t) => a + t.clearTime, 0) / clears.length : 0
    const sample = runs.find((r) => r.survived) ?? runs[0]
    results.push({
      id, name: diff.name, charId,
      winRate: wins / RUNS,
      avgDeathLayer: avgLayer,
      timeoutRate: timeouts / RUNS,
      avgClear,
      trace: sample.trace,
      finalSt: sample.st,
    })
  }
}

console.log(`\n=== 模拟结果 v3（每组合 ${RUNS} 局｜无经验·怪物数量固定·超时判负） ===\n`)
for (const r of results) {
  console.log(
    `${r.name.padEnd(4)} ${r.charId.padEnd(9)} 通关率 ${(r.winRate * 100).toFixed(1)}%` +
    `   平均阵亡层 ${r.avgDeathLayer ? r.avgDeathLayer.toFixed(1) : '—'}` +
    `   平均清层 ${r.avgClear.toFixed(1)}s   超时 ${r.timeoutRate.toFixed(2)} 次/局` +
    `   终局专武 Lv${r.finalSt.weaponLv} 余金 ${Math.round(r.finalSt.gold)}`
  )
}
if (VERBOSE) {
  for (const r of results) {
    console.log(`\n--- ${r.name}/${r.charId} 逐层（通关样本）---`)
    console.log('层  怪血  总数  单体DPS  群伤DPS  清层秒  限时  血量      金币  专武')
    for (const t of r.trace) {
      console.log(
        String(t.layer).padStart(2) + '  ' +
        String(Math.round(t.mobHp)).padStart(4) + '  ' +
        String(t.monsterCount ?? '-').padStart(4) + '  ' +
        (t.singleDps ? t.singleDps.toFixed(0).padStart(6) : '     -') + '  ' +
        (t.crowdDps ? t.crowdDps.toFixed(0).padStart(6) : '     -') + '  ' +
        (t.clearTime ? t.clearTime.toFixed(1).padStart(5) : '    -') + '  ' +
        String(t.timer ?? '-').padStart(4) + '  ' +
        `${Math.round(t.hp ?? 0)}/${Math.round(t.maxHp ?? 0)}`.padStart(9) + '  ' +
        String(Math.round(t.gold ?? 0)).padStart(4) + '  ' +
        String(t.weaponLv ?? '-').padStart(2) + (t.timedOut ? '  超时判负' : '') + (t.dead && !t.timedOut ? '  阵亡' : '')
      )
    }
  }
}

const hard = results.filter((r) => r.id === 'hard')
if (hard.length) console.log(`\n困难模式最低通关率：${(Math.min(...hard.map((r) => r.winRate)) * 100).toFixed(1)}%（三角色）`)
