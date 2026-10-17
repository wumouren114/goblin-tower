// 哥布林之塔 · 数值蒙特卡洛模拟器
// 用途：在没有真实战斗代码的情况下，用「数值模型」推演一局，验证三档难度是否能通关。
// 运行：node sim/simulate.mjs [--runs 400] [--difficulty hard] [--verbose]
// 数据源：src/data/balance.json（唯一数值来源）；角色基础值与公式需与 src/data/characters.ts 保持一致。

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

// ── 角色基础值（镜像 src/data/characters.ts，改动请同步）──
const CHARS = {
  mutsumi: {
    hp: 110, chargeMax: 100, stamina: 100, magic: 100, intelligence: 100, moveSpeed: 6.2,
    attack: { damage: 16, intervalBase: 0.55, minInterval: 0.24, shape: 'single' },
    skill: { cost: 100, kind: 'transform', duration: 8, aoe: 0.4 },
    exposure: 1.0,
  },
  murasame: {
    hp: 135, chargeMax: 90, stamina: 130, magic: 95, intelligence: 70, moveSpeed: 7.0,
    attack: { damage: 17, intervalBase: 0.55, minInterval: 0.22, shape: 'cone', coneTargets: 2.05 },
    skill: { cost: 90, kind: 'dash', heal: 15, aoe: 0.3 },
    exposure: 1.32,
  },
  fish: {
    hp: 130, chargeMax: 110, stamina: 140, magic: 80, intelligence: 110, moveSpeed: 6.6,
    attack: { damage: 10, intervalBase: 0.55, minInterval: 0.2, shape: 'single' },
    skill: { cost: 110, kind: 'summon', duration: 10, count: 3, minionDpsRatio: 0.45, aoe: 0.25 },
    exposure: 0.85,
  },
}

const CHARGE_PER_KILL = 6
const CRIT = 1.08 // 8% × 1.8 → 期望 +6.4%，取整

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const rnd = (seedState) => {
  // mulberry32
  let t = (seedState.s += 0x6d2b79f5)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function xpToNext(level) {
  const { xpPerLevelBase: b, xpPerLevelGrowth: g } = balance.levelCards
  return Math.round(b * Math.pow(g, level - 1) + 2 * (level - 1))
}

const C = balance.layerCurve
const WEAPON = balance.weapons

function layerCount(diff) {
  return diff.stages.reduce((a, b) => a + b, 0)
}

function isBossLayer(diff, layer) {
  let acc = 0
  for (const s of diff.stages) {
    acc += s
    if (layer === acc) return true
  }
  return false
}

/** 该层玩家面板与输出 */
function playerOutput(charId, st) {
  const c = CHARS[charId]
  const w = WEAPON[charId].tiers[st.weaponLv - 1]
  const magic = c.magic + st.cards.magic + st.levelStats.magic
  const stamina = c.stamina + st.cards.stamina + st.levelStats.stamina
  const intelligence = c.intelligence + st.cards.intelligence + st.levelStats.intelligence

  let damage = c.attack.damage
  let hits = 1 // 单体命中数
  let crowdHits = 1
  if (charId === 'mutsumi') {
    damage = w.damage
    crowdHits = w.projectiles
    if (w.bounce) crowdHits += w.bounce * (w.bounceMul * w.projectiles)
  } else if (charId === 'murasame') {
    damage = w.damage
    crowdHits = c.attack.coneTargets
    if (w.allStatMul > 1) crowdHits *= w.allStatMul
  } else if (charId === 'fish') {
    damage = w.damage
    crowdHits = 1 + (w.pierce ?? 0)
    crowdHits += w.minionCount * ((c.skill.minionDpsRatio ?? 0.45) + 0.12 * (st.weaponLv - 1)) / 1
  }
  if (w.allStatMul > 1) damage *= w.allStatMul

  const interval = Math.max(c.attack.minInterval, c.attack.intervalBase * 100 / stamina)
  const hit = damage * (magic / 100) * CRIT
  const singleDps = hit / interval
  let crowdDps = (hit * crowdHits) / interval

  const chargeCost = Math.max(20, (charId === 'murasame' ? w.skillCharge : c.chargeMax) + st.cards.chargeMax)
  const chargeRate = (CHARGE_PER_KILL * (1 + st.cards.chargeGain)) // 每击杀
  // 技能对群体清怪/单体输出的增益权重
  const skillUptime = charId === 'mutsumi' ? (c.skill.duration ?? 0) / (chargeCost / (chargeRate * 1.0)) : 0
  if (skillUptime > 0) crowdDps *= 1 + Math.min(0.55, skillUptime * 0.5)
  else crowdDps *= 1 + c.skill.aoe

  return { singleDps, crowdDps, interval, magic, stamina, intelligence, chargeCost, hit }
}

function makeState(charId) {
  const c = CHARS[charId]
  return {
    charId,
    hp: c.hp,
    maxHp: c.hp,
    gold: 0,
    weaponLv: 1,
    level: 1,
    xp: 0,
    cards: { magic: 0, stamina: 0, intelligence: 0, hp: 0, moveSpeed: 0, chargeMax: 0, chargeGain: 0, armor: 0, dodge: 0 },
    levelStats: { magic: 0, stamina: 0, intelligence: 0, hp: 0, armor: 0 },
    potions: 0,
    weaponCoupons: {},
  }
}

function gainXp(st, amount, rand) {
  st.xp += amount
  while (st.xp >= xpToNext(st.level)) {
    st.xp -= xpToNext(st.level)
    st.level += 1
    const pool = balance.levelCards.cards
    let r = rand() * 100
    for (const card of pool) {
      r -= card.weight
      if (r <= 0) {
        if (card.stat === 'hp') {
          st.maxHp += card.value
          st.hp += card.value
          st.levelStats.hp += card.value
        } else if (card.stat === 'armor') st.levelStats.armor += card.value
        else if (card.stat === 'chargeGain') st.cards.chargeGain += card.value
        else st.levelStats[card.stat] = (st.levelStats[card.stat] ?? 0) + card.value
        break
      }
    }
  }
}

/** 商店品质：层数越高越容易刷出高品（数值/价格同步上涨） */
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

/** 玩家每层结束后的消费策略：先保命，再升专武，再买卡。SLOPPY=1 模拟「乱买/不升级」的普通玩家 */
const SLOPPY = process.env.SLOPPY === '1'

function spendGold(st, layer, diff, rand) {
  const maxHp = st.maxHp
  const heal = balance.shop.consumables.heal
  const healAt = SLOPPY ? 0.35 : 0.55
  if (st.hp < maxHp * healAt && st.gold >= heal.price) {
    st.gold -= heal.price
    st.hp = Math.min(maxHp, st.hp + maxHp * heal.healRatio)
  }
  // 专武升级：优先，因为它是输出的主要成长
  const nextTier = WEAPON[st.charId].tiers[st.weaponLv] // 下一级（index = lv）
  if (nextTier && st.gold >= nextTier.price && (!SLOPPY || rand() < 0.3)) {
    st.gold -= nextTier.price
    st.weaponLv += 1
  }
  // 增益卡：留 30 金当药钱
  const cardCap = SLOPPY ? 1 : 3
  const affordable = () => st.gold >= 30
  let guard = 0
  while (affordable() && guard < cardCap) {
    guard += 1
    const cardPool = balance.buffCards
    let r = rand() * 100
    let picked = null
    for (const card of cardPool) {
      r -= 20
      if (r <= 0) { picked = card; break }
    }
    picked = picked ?? cardPool[0]
    const q = rollQuality(layer, rand)
    const price = Math.round(shopPrice(picked.basePrice, layer) * q.priceMul)
    if (st.gold < price) break
    st.gold -= price
    const value = picked.value * q.valueMul
    if (picked.stat === 'hp') {
      st.maxHp += value
      st.hp += value
      st.cards.hp += value
    } else if (picked.stat === 'chargeMax') st.cards.chargeMax += value
    else if (picked.stat === 'moveSpeed') st.cards.moveSpeed += value
    else st.cards[picked.stat] += value
  }
}

/** 传送门收益：三种类型各给不同的金币/属性回报 */
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
      } else {
        // 技能卡：给一层小增益（用金币折算）
        gold += 30
      }
    } else if (type === 'trade') {
      const r2 = rand()
      if (r2 < P.trade.merchant) {
        // 商人：花金买卡（模拟成金币回收 + 一张便宜卡）
        const price = shopPrice(35, layer)
        if (st.gold + gold >= price + 20) {
          st.gold -= price + 20
          st.cards.magic += 10
        }
      } else {
        const cost = P.altarBaseCost + P.altarCostStep * (layer - 1)
        if (st.gold + gold >= cost) {
          st.gold -= cost
          st.cards.stamina += 8
        }
      }
    } else {
      gold += (P.chestGoldBase + P.chestGoldPerLayer * (layer - 1)) * 0.8
    }
  }
  st.gold += gold * diff.goldMul + st.cards.chargeGain * 0
}

function simulateRun(charId, diff, seed) {
  const rand = (() => {
    const s = { s: seed }
    return () => rnd(s)
  })()
  const st = makeState(charId)
  const layers = layerCount(diff)
  const trace = []
  let diedAt = null

  for (let layer = 1; layer <= layers; layer += 1) {
    const boss = isBossLayer(diff, layer)
    const out = playerOutput(charId, st)
    const mobHp = C.mobHpBase * (1 + C.mobHpPerLayer * (layer - 1)) * diff.hpMul
    const quota = Math.round(C.quotaBase + C.quotaPerLayer * (layer - 1))
    const timer = (boss ? balance.meta.bossTimerSeconds : balance.meta.layerTimerSeconds) * diff.timerMul

    let clearTime
    const spawnRate = (C.spawnBatchBase / Math.max(C.spawnIntervalMin, C.spawnIntervalBase - C.spawnIntervalDecay * (layer - 1))) * diff.spawnMul
    if (boss) {
      const bossHp = C.bossHpBase * (1 + C.bossHpPerLayer * (layer - 1)) * diff.hpMul
      const bossDps = out.singleDps * (1 + 0.25) // 技能/爆发期期望
      clearTime = bossHp / bossDps
    } else {
      // 击杀速度既受输出限制，也受刷新速度限制（打不完的怪不会凭空出现）
      const dpsKillRate = out.crowdDps / mobHp
      const killRate = Math.min(dpsKillRate, spawnRate * 0.92)
      clearTime = quota / killRate
    }

    // 超时处理
    let timedOut = clearTime > timer
    if (timedOut) {
      st.hp -= st.maxHp * C.timeoutHpPenaltyRatio
      if (st.hp <= 0) { diedAt = layer; trace.push({ layer, clearTime, timedOut, dead: true }); break }
    }

    const clearDur = Math.min(timer, clearTime)
    // 受伤模型：正常走位下的接触频率 × 单次伤害；怪越密越容易被围
    const mobDmg = C.mobDamageBase * (1 + C.mobDamagePerLayer * (layer - 1)) * diff.damageMul
    const hitsPerSecond = boss ? 0.12 : 0.075
    const crowdFactor = boss ? 1 : 1 + Math.min(0.4, spawnRate / 8)
    const dodge = st.cards.dodge ?? 0
    const armor = clamp(st.levelStats.armor, 0, 0.6)
    let dmgTaken = mobDmg * hitsPerSecond * clearDur * crowdFactor * (1 - dodge) * (1 - armor) * (CHARS[charId].exposure ?? 1)
    if (boss) dmgTaken += mobDmg * 2.2 * (1 - dodge) * (1 - armor) * (CHARS[charId].exposure ?? 1) // 砸地/冲锋
    st.hp -= dmgTaken

    // 回血：丛雨的突进回血按释放次数折算
    if (charId === 'murasame') st.hp += 12 * Math.max(1, clearDur / 22)

    if (st.hp <= 0) { diedAt = layer; trace.push({ layer, clearTime, mobHp, quota, out, dead: true }); break }

    // 奖励
    if (!timedOut) {
      const goldPerKill = C.goldPerKillBase + Math.floor((layer - 1) / C.goldPerKillEveryLayers)
      const kills = boss ? Math.round(quota * 0.6) : quota
      st.gold += Math.round((kills * goldPerKill + C.clearGoldBase + C.clearGoldPerLayer * (layer - 1)) * diff.goldMul)
      gainXp(st, kills * (C.xpPerKillBase + C.xpPerKillPerLayer * (layer - 1)) * diff.xpMul, rand)
      portalReward(st, layer, diff, rand)
      // 阶段 Boss 大奖励：金币 + 回血 + 一张免费增益卡（避免下一阶段断崖）
      if (boss) {
        st.gold += Math.round((90 + 15 * layer) * diff.goldMul)
        st.hp = Math.min(st.maxHp, st.hp + st.maxHp * 0.25)
        const free = balance.buffCards[Math.floor(rand() * balance.buffCards.length)]
        if (free.stat === 'hp') { st.maxHp += free.value; st.hp += free.value; st.cards.hp += free.value }
        else if (free.stat === 'chargeMax') st.cards.chargeMax += free.value
        else st.cards[free.stat] += free.value
      }
    } else {
      gainXp(st, Math.round(quota * 0.5 * C.xpPerKillBase), rand)
    }

    spendGold(st, layer, diff, rand)
    st.hp = Math.min(st.maxHp, st.hp)

    trace.push({ layer, boss, mobHp, quota, timer, clearTime, hit: out.hit, singleDps: out.singleDps, crowdDps: out.crowdDps, hp: st.hp, maxHp: st.maxHp, gold: st.gold, weaponLv: st.weaponLv, level: st.level, timedOut })
  }

  return { charId, difficulty: diff.name, diedAt, survived: diedAt === null, trace, st }
}

// ── 跑全部组合 ──
const diffs = Object.entries(balance.difficulties).filter(([k]) => !ONLY || k === ONLY)
const results = []
for (const [id, diff] of diffs) {
  for (const charId of Object.keys(CHARS)) {
    const runs = []
    for (let i = 0; i < RUNS; i += 1) runs.push(simulateRun(charId, { ...diff, id }, 1000 + i * 7919))
    const wins = runs.filter((r) => r.survived).length
    const deaths = runs.filter((r) => !r.survived).map((r) => r.diedAt)
    const avgLayer = deaths.length ? deaths.reduce((a, b) => a + b, 0) / deaths.length : 0
    const timedOut = runs.reduce((a, r) => a + r.trace.filter((t) => t.timedOut).length, 0)
    const clears = runs.flatMap((r) => r.trace.filter((t) => !t.boss && t.clearTime))
    const avgClear = clears.length ? clears.reduce((a, t) => a + t.clearTime, 0) / clears.length : 0
    const sample = runs.find((r) => r.survived) ?? runs[0]
    const last = sample.trace
    const finalSt = sample.st
    results.push({ id, name: diff.name, charId, winRate: wins / RUNS, avgDeathLayer: avgLayer, timeoutPerRun: timedOut / RUNS, avgClear, trace: last, finalSt, RUNS })
  }
}

console.log(`\n=== 模拟结果（每组合 ${RUNS} 局，困难度目标：可通关且非无脑过） ===\n`)
for (const r of results) {
  console.log(
    `${r.name.padEnd(4)} ${r.charId.padEnd(9)} 通关率 ${(r.winRate * 100).toFixed(1)}%` +
    `   平均阵亡层 ${r.avgDeathLayer ? r.avgDeathLayer.toFixed(1) : '—'}` +
    `   平均清层 ${r.avgClear.toFixed(1)}s   超时 ${r.timeoutPerRun.toFixed(2)} 次/局` +
    `   终局专武 Lv${r.finalSt.weaponLv} 等级 ${r.finalSt.level} 余金 ${Math.round(r.finalSt.gold)}`
  )
}
if (VERBOSE) {
  for (const r of results) {
    console.log(`\n--- ${r.name}/${r.charId} 逐层（一局样本）---`)
    console.log('层  怪血  配额  单发  单体DPS  群伤DPS  清层秒  计时  血量      金币  专武 Lv')
    for (const t of r.trace) {
      console.log(
        String(t.layer).padStart(2) + '  ' +
        String(Math.round(t.mobHp)).padStart(4) + '  ' +
        String(t.quota ?? '-').padStart(4) + '  ' +
        (t.hit ? t.hit.toFixed(1).padStart(4) : '   -') + '  ' +
        (t.singleDps ? t.singleDps.toFixed(0).padStart(6) : '     -') + '  ' +
        (t.crowdDps ? t.crowdDps.toFixed(0).padStart(6) : '     -') + '  ' +
        (t.clearTime ? t.clearTime.toFixed(1).padStart(5) : '    -') + '  ' +
        String(t.timer ?? '-').padStart(4) + '  ' +
        `${Math.round(t.hp ?? 0)}/${Math.round(t.maxHp ?? 0)}`.padStart(9) + '  ' +
        String(Math.round(t.gold ?? 0)).padStart(4) + '  ' +
        String(t.weaponLv ?? '-').padStart(2) + (t.timedOut ? '  超时' : '') + (t.dead ? '  阵亡' : '')
      )
    }
  }
}

const hard = results.filter((r) => r.id === 'hard')
if (hard.length) {
  const min = Math.min(...hard.map((r) => r.winRate))
  console.log(`\n困难模式最低通关率：${(min * 100).toFixed(1)}%（三角色）`)
}
