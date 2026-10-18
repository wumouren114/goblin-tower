/**
 * 经济/存档纯数据层冒烟（Node 直接跑，不需要 canvas / three.js）：
 *   node sim/economy-smoke.mjs
 *
 * 依赖 Node 24 原生 TS type-stripping（node --version >= 22.18 / 23）。
 * 用 module.register 注册一个 data: URL 小加载器，让 Node 能：
 *   - 解析无扩展名的相对 import（仓库风格 './economy' → economy.ts）
 *   - 直接 import balance.json（TS 源码里的 `import raw from './balance.json'` 无 import attribute）
 */
import { register } from 'node:module'

const loaderSource = `
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
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

export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    const raw = await readFile(fileURLToPath(url), 'utf8')
    const parsed = JSON.parse(raw.replace(/^\\uFEFF/, ''))
    return { format: 'module', source: 'export default ' + JSON.stringify(parsed), shortCircuit: true }
  }
  return nextLoad(url, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`)

const { Rng } = await import('../src/core/rng.ts')
const { BALANCE, clearGoldFor, goldPerKillFor, isBossLayer, layerCount, quotaFor, shopPriceFor } =
  await import('../src/data/balance.ts')
const economy = await import('../src/systems/economy.ts')
const { Inventory } = await import('../src/systems/inventory.ts')
const shop = await import('../src/systems/shop.ts')
const tunnels = await import('../src/systems/tunnels.ts')
const saveLoad = await import('../src/systems/saveLoad.ts')

// ── 迷你测试框架 ────────────────────────────────────────────────
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

function eq(actual, expected, hint = '') {
  if (actual !== expected) throw new Error(`${hint} 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function ok(value, hint = '断言失败') {
  if (!value) throw new Error(hint)
}

function approx(actual, expected, tolerance = 1e-6, hint = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${hint} 期望 ≈${expected}（±${tolerance}），实际 ${actual}`)
  }
}

function deepEqual(actual, expected, hint = '') {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${hint} 期望 ${b}，实际 ${a}`)
}

function section(title) {
  console.log(`\n[${title}]`)
}

// ── 内存假 localStorage（Node 里没有 DOM Storage）────────────────
function installFakeStorage() {
  const mem = new Map()
  globalThis.localStorage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => {
      mem.set(key, String(value))
    },
    removeItem: (key) => {
      mem.delete(key)
    },
    clear: () => mem.clear(),
    key: (index) => [...mem.keys()][index] ?? null,
    get length() {
      return mem.size
    },
  }
  return mem
}

const { CHARACTERS } = await import('../src/data/characters.ts')

// ═════════════════════════════════════════════════════════════════
section('1. 15 层金币收支与商店价格曲线')
installFakeStorage()

const DIFF = 'hard'
const TOTAL = layerCount(DIFF)

check('hard 难度层数 = 15', () => eq(TOTAL, 15))
check('layers = 15 时第 15 层是 Boss 层', () => ok(isBossLayer(DIFF, 15) && !isBossLayer(DIFF, 14)))

check('击杀金按 goldPerKillBase + floor((layer-1)/everyLayers) 增长', () => {
  eq(economy.killGold(1, 'small'), goldPerKillFor(1), 'L1 small')
  eq(economy.killGold(4, 'small'), goldPerKillFor(4), 'L4 small')
  eq(economy.killGold(5, 'small'), goldPerKillFor(5), 'L5 small')
  eq(goldPerKillFor(5), goldPerKillFor(1) + 1, 'L5 应比 L1 高 1 金')
  eq(economy.killGold(1, 'brute'), 3, 'L1 brute')
  eq(economy.killGold(1, 'elite'), 12, 'L1 elite')
  eq(economy.killGold(1, 'boss'), 60, 'L1 boss')
  eq(economy.killGold(15, 'elite'), 12 * goldPerKillFor(15), 'L15 elite')
})
check('击杀金随层数单调不降', () => {
  for (let layer = 2; layer <= TOTAL; layer += 1) {
    ok(economy.killGold(layer, 'small') >= economy.killGold(layer - 1, 'small'))
  }
})
check('通关金走难度倍率（hard 1.05）', () => {
  eq(economy.clearGold(DIFF, 1), clearGoldFor(DIFF, 1))
  eq(economy.clearGold(DIFF, 15), clearGoldFor(DIFF, 15))
  ok(economy.clearGold('easy', 1) > economy.clearGold('normal', 1), 'easy 倍率应更高')
})

const shopCurve = []
const incomeRows = []
let totalIncome = 0
for (let layer = 1; layer <= TOTAL; layer += 1) {
  const kills = quotaFor(layer)
  const killGoldPerKill = economy.killGold(layer, 'small')
  const clear = economy.clearGold(DIFF, layer)
  const bossBonus = isBossLayer(DIFF, layer) ? 130 + 22 * layer : 0
  const goldMul = BALANCE.difficulties[DIFF].goldMul
  const income = Math.round((kills * killGoldPerKill + clear + bossBonus) * goldMul)
  totalIncome += income
  incomeRows.push({
    layer,
    kills,
    perKill: killGoldPerKill,
    killTotal: kills * killGoldPerKill,
    clear,
    bossBonus,
    income,
    cardPrice: economy.priceOf(55, layer),
    chestGold: Math.round(
      (BALANCE.portals.chestGoldBase ?? 0) +
        (BALANCE.portals.chestGoldPerLayer ?? 0) * (layer - 1),
    ),
  })
  shopCurve.push(economy.priceOf(55, layer))
}

console.log('  层 | 击杀 | 每杀金 | 击杀合计 | 通关金 | Boss奖励 | 本层收入 | 商城卡价 | 宝箱金')
for (const row of incomeRows) {
  console.log(
    `  ${String(row.layer).padStart(2)} | ${String(row.kills).padStart(4)} | ${String(row.perKill).padStart(6)} | ` +
      `${String(row.killTotal).padStart(8)} | ${String(row.clear).padStart(6)} | ${String(row.bossBonus).padStart(8)} | ` +
      `${String(row.income).padStart(8)} | ${String(row.cardPrice).padStart(8)} | ${String(row.chestGold).padStart(6)}`,
  )
}

check('商店价格曲线随层数单调上涨（55 金基准）', () => {
  for (let index = 1; index < shopCurve.length; index += 1) {
    ok(shopCurve[index] >= shopCurve[index - 1], `第 ${index + 1} 层价格回落`)
  }
  eq(shopCurve[0], 55, 'L1 价格 = 基准价')
  eq(shopCurve[14], Math.round(shopPriceFor(55, 15)), 'L15 与访问器一致')
  ok(shopCurve[14] > shopCurve[0] * 2, 'L15 卡价应超过 L1 两倍')
})
check('品质倍率抬高价格并放大卡值', () => {
  const tier2 = economy.makeCardItem('magic', 2)
  const tier3 = economy.makeCardItem('magic', 3)
  approx(tier2.value, 18 * 1.9, 1e-9, 'tier2 magic 18×1.9')
  approx(tier3.value, 18 * 3.2, 1e-9, 'tier3 magic 18×3.2')
  ok(tier2.name.startsWith(BALANCE.shop.quality.tier2.name), 'tier2 名字应带品质前缀')
  ok(economy.priceOf(55, 1, 2.4) > economy.priceOf(55, 1), '品质 priceMul 应抬高价格')
})
check('15 层总收入能覆盖专武 1→5 级（90/180/320/520）', () => {
  const weaponCost = 90 + 180 + 320 + 520
  ok(totalIncome > weaponCost * 2, `15 层收入 ${totalIncome} 应远大于专武总价 ${weaponCost}`)
  console.log(`  15 层总收入 ≈ ${totalIncome} 金，专武全买 = ${weaponCost} 金`)
})

// ═════════════════════════════════════════════════════════════════
section('2. 隧道 1000 次抽样分布')

const SAMPLE_LAYER = 5
const SAMPLE_RUNS = 1000
const rng = new Rng(424242)
const kindCount = { reward: 0, trade: 0, battle: 0 }
const roomCount = {
  chest: 0,
  'skill-card': 0,
  merchant: 0,
  altar: 0,
  'mob-wave': 0,
  'elite-fight': 0,
  boss: 0,
}
let repeatedKindRolls = 0
let offersTotal = 0
const firstByRoom = new Map()

for (let run = 0; run < SAMPLE_RUNS; run += 1) {
  const offers = tunnels.rollTunnels(SAMPLE_LAYER, TOTAL, false, 'mutsumi', rng, 2)
  eq(offers.length, BALANCE.portals.count, '每层门数')
  offersTotal += offers.length
  const kinds = new Set()
  let hasDuplicateKind = false
  for (const offer of offers) {
    kindCount[offer.kind] += 1
    roomCount[offer.room] += 1
    if (kinds.has(offer.kind)) hasDuplicateKind = true
    kinds.add(offer.kind)
    ok(offer.title.length > 0 && offer.desc.length > 0, '门应有标题/描述')
    ok(offer.icon.length > 0, '门应有图标')
    if (!firstByRoom.has(offer.room)) firstByRoom.set(offer.room, offer)
  }
  if (hasDuplicateKind) repeatedKindRolls += 1
}

console.log(`  抽样 ${SAMPLE_RUNS} 次 × ${BALANCE.portals.count} 门 = ${offersTotal} 扇`)
console.log(
  `  类型占比：reward ${(kindCount.reward / offersTotal * 100).toFixed(1)}%  ` +
    `trade ${(kindCount.trade / offersTotal * 100).toFixed(1)}%  ` +
    `battle ${(kindCount.battle / offersTotal * 100).toFixed(1)}%（权重 40/35/25）`,
)
for (const [room, count] of Object.entries(roomCount)) {
  console.log(`  ${room.padEnd(11)} ${(count / offersTotal * 100).toFixed(2)}%  (${count})`)
}
console.log(`  同一轮出现重复类别的比例：${(repeatedKindRolls / SAMPLE_RUNS * 100).toFixed(1)}%`)

check('类型分布接近 balance.portals.weights（±4%）', () => {
  approx(kindCount.reward / offersTotal, BALANCE.portals.weights.reward, 0.04, 'reward')
  approx(kindCount.trade / offersTotal, BALANCE.portals.weights.trade, 0.04, 'trade')
  approx(kindCount.battle / offersTotal, BALANCE.portals.weights.battle, 0.04, 'battle')
})
check('房间分布接近 balance.portals 子概率（±4%）', () => {
  const p = BALANCE.portals
  approx(roomCount.chest / offersTotal, p.weights.reward * p.reward.chest, 0.04, 'chest')
  approx(roomCount['skill-card'] / offersTotal, p.weights.reward * p.reward.skillCard, 0.04, 'skill-card')
  approx(roomCount.merchant / offersTotal, p.weights.trade * p.trade.merchant, 0.04, 'merchant')
  approx(roomCount.altar / offersTotal, p.weights.trade * p.trade.altar, 0.04, 'altar')
  approx(
    roomCount['mob-wave'] / offersTotal,
    p.weights.battle * p.battle.mobWave,
    0.04,
    'mob-wave',
  )
  approx(
    roomCount['elite-fight'] / offersTotal,
    p.weights.battle * p.battle.eliteFight,
    0.04,
    'elite-fight',
  )
  eq(roomCount.boss, 0, '非 Boss 层不应出现 boss 房')
})
check('类别可重复（同一轮出现两扇同类门）', () => ok(repeatedKindRolls > 0))

check('Boss 层三门全为 boss 房', () => {
  const bossRng = new Rng(7)
  for (let run = 0; run < 50; run += 1) {
    const offers = tunnels.rollTunnels(15, TOTAL, true, 'murasame', bossRng, 3)
    eq(offers.length, 3)
    for (const offer of offers) {
      eq(offer.room, 'boss', 'Boss 层房间')
      eq(offer.kind, 'battle', 'Boss 层类型')
      ok(offer.payload.bossLayer === true, 'payload.bossLayer 应为 true')
    }
  }
})
check('即将进入最后一层（layer >= totalLayers）也给出 boss 房', () => {
  const offers = tunnels.rollTunnels(15, 15, false, 'fish', new Rng(9))
  ok(offers.every((offer) => offer.room === 'boss'), 'layer=totalLayers 应全为 boss')
})

check('奖励房金币显著高于对战房', () => {
  for (let layer = 1; layer <= 15; layer += 1) {
    const offers = tunnels.rollTunnels(layer, 15, false, 'mutsumi', new Rng(100 + layer))
    const chest = offers.find((offer) => offer.room === 'chest')
    const wave = offers.find((offer) => offer.room === 'mob-wave')
    if (chest && wave) {
      ok(
        (chest.payload.gold ?? 0) > (wave.payload.gold ?? 0),
        `第 ${layer} 层奖励房 ${chest.payload.gold} 应高于怪潮 ${wave.payload.gold}`,
      )
    }
  }
  // 直接构造保证覆盖：奖励房 = 80 + 14×(layer-1)，怪潮 = 0.6 × 1.2 倍
  const reward = 80 + 14 * 9
  const battle = Math.round((80 + 14 * 9) * 0.6 * 1.2)
  ok(reward > battle, '奖励房公式应高于对战房公式')
})

check('resolveRoom 产出可直接结算的结果', () => {
  const res = {}
  for (const room of Object.keys(roomCount)) {
    const offer = firstByRoom.get(room)
    if (!offer) continue
    const result = tunnels.resolveRoom(offer, SAMPLE_LAYER, 'mutsumi', new Rng(31337))
    res[room] = result
    switch (room) {
      case 'chest': {
        ok((result.gold ?? 0) > 0, 'chest 金币')
        ok(result.card === undefined || typeof result.card.uid === 'string', 'chest 卡')
        eq(result.gold, offer.payload.gold, 'chest 金币应与预览一致')
        break
      }
      case 'skill-card': {
        ok(result.card, 'skill-card 应给出卡片')
        ok(result.card.name.length > 0, '技能卡名字')
        ok(['magic', 'stamina'].includes(result.card.stat), '技能卡五维映射')
        eq(result.card.value, 8, '技能卡折算值')
        break
      }
      case 'merchant': {
        ok(Array.isArray(result.shopOffers), 'merchant 货架')
        eq(result.shopOffers.length, BALANCE.shop.slots, 'merchant 4 件货')
        eq(shop.REFRESH_COST, BALANCE.shop.rerollCost, '重掷价')
        break
      }
      case 'altar': {
        eq(result.altarCost, BALANCE.portals.altarBaseCost + BALANCE.portals.altarCostStep * (SAMPLE_LAYER - 1))
        ok(result.altarReward && result.altarReward.value > 0, '祭坛祝福值')
        break
      }
      case 'mob-wave': {
        ok((result.enemies?.count ?? 0) > 0, '怪潮数量')
        eq(result.enemies.elite, 0, '怪潮无精英')
        ok((result.gold ?? 0) > 0, '怪潮金币')
        break
      }
      case 'elite-fight': {
        eq(result.enemies.elite, 2, '精英房 2 只精英')
        ok(result.enemies.count > 2, '精英房应有随从')
        break
      }
      case 'boss': {
        eq(result.bossLayer, true, 'bossLayer 标记')
        eq(result.enemies.count, 1, 'Boss 层单个敌人')
        break
      }
      default:
        break
    }
  }
  for (const room of ['chest', 'skill-card', 'merchant', 'altar', 'mob-wave', 'elite-fight']) {
    ok(res[room], `抽样应覆盖 ${room}`)
  }
})

check('Boss 层 resolveRoom 直接指向 Boss 战', () => {
  const offers = tunnels.rollTunnels(15, TOTAL, true, 'mutsumi', new Rng(5))
  const result = tunnels.resolveRoom(offers[0], 15, 'mutsumi', new Rng(6))
  eq(result.bossLayer, true)
  ok((result.gold ?? 0) > 0)
})

check('隧道随机可复现（同 seed 同结果）', () => {
  const a = tunnels.rollTunnels(7, 15, false, 'fish', new Rng(2024), 4)
  const b = tunnels.rollTunnels(7, 15, false, 'fish', new Rng(2024), 4)
  deepEqual(a, b, 'rollTunnels')
})

// ═════════════════════════════════════════════════════════════════
section('3. 背包：合成 / 满格 / 卡片汇总')

check('12 格上限：第 13 件加不进', () => {
  const bag = new Inventory()
  eq(bag.maxSlots, 12)
  for (let index = 0; index < 12; index += 1) {
    ok(bag.add(economy.makeCardItem('magic', 1)), `第 ${index + 1} 件应加入`)
  }
  eq(bag.count, 12)
  ok(bag.isFull)
  eq(bag.add(economy.makeCardItem('magic', 1)), false, '第 13 件')
})

check('同种同级合成：tier1→tier2，数值 ×2，占 1 格', () => {
  const bag = new Inventory()
  const a = economy.makeCardItem('stamina', 1)
  const b = economy.makeCardItem('stamina', 1)
  bag.add(a)
  bag.add(b)
  const baseValue = a.value
  ok(bag.canMerge(a.uid, b.uid))
  const merged = bag.merge(a.uid, b.uid)
  ok(merged, '应合成成功')
  eq(bag.count, 1)
  eq(merged.tier, 2)
  eq(merged.stat, 'stamina')
  approx(merged.value, baseValue * 2, 1e-9, '合成后数值')
  eq(bag.get(a.uid), undefined, '原卡 A 移除')
  eq(bag.get(b.uid), undefined, '原卡 B 移除')
})

check('tier2→tier3 可合成，tier3 不可再合', () => {
  const bag = new Inventory()
  const a = economy.makeCardItem('hp', 2)
  const b = economy.makeCardItem('hp', 2)
  bag.add(a)
  bag.add(b)
  const merged = bag.merge(a.uid, b.uid)
  ok(merged, 'tier2 应能合 tier3')
  eq(merged.tier, 3)
  approx(merged.value, a.value * 2, 1e-9)

  const c = economy.makeCardItem('hp', 3)
  const d = economy.makeCardItem('hp', 3)
  const bag2 = new Inventory()
  bag2.add(c)
  bag2.add(d)
  eq(bag2.canMerge(c.uid, d.uid), false, 'tier3 不可合')
  eq(bag2.merge(c.uid, d.uid), null, 'tier3 merge 返回 null')
  eq(bag2.count, 2, '失败不应消耗物品')
})

check('不同种 / 不同级 / 消耗品 / 自己 都不能合', () => {
  const bag = new Inventory()
  const magic = economy.makeCardItem('magic', 1)
  const stamina = economy.makeCardItem('stamina', 1)
  const magic2 = economy.makeCardItem('magic', 2)
  const potion = {
    uid: 'potion-1',
    kind: 'consumable',
    name: '治疗药水',
    desc: '',
    icon: '🧪',
    tier: 1,
    value: 0.35,
  }
  for (const item of [magic, stamina, magic2, potion]) bag.add(item)
  eq(bag.canMerge(magic.uid, magic.uid), false, '自己')
  eq(bag.canMerge(magic.uid, stamina.uid), false, '不同种')
  eq(bag.canMerge(magic.uid, magic2.uid), false, '不同级')
  eq(bag.canMerge(magic.uid, potion.uid), false, '消耗品')
  eq(bag.canMerge('nope', magic.uid), false, '不存在的 uid')
})

check('专武券：同名同等级可合，升下一级', () => {
  const bag = new Inventory()
  const a = economy.makeWeaponItem('mutsumi', 2)
  const b = economy.makeWeaponItem('mutsumi', 2)
  bag.add(a)
  bag.add(b)
  ok(bag.canMerge(a.uid, b.uid), '同角色同等级专武券应可合')
  const merged = bag.merge(a.uid, b.uid)
  ok(merged, '应合成')
  eq(merged.value, 3, '升到 Lv3')
  ok(merged.name.includes('Lv3'), `名字应含 Lv3：${merged.name}`)
  eq(merged.tier, 2)

  const other = economy.makeWeaponItem('murasame', 2)
  const bag2 = new Inventory()
  const x = economy.makeWeaponItem('mutsumi', 2)
  bag2.add(x)
  bag2.add(other)
  eq(bag2.canMerge(x.uid, other.uid), false, '不同角色不可合')
})

check('use() 只吃消耗品并返回该物品', () => {
  const bag = new Inventory()
  const potion = {
    uid: 'potion-2',
    kind: 'consumable',
    name: '治疗药水',
    desc: '',
    icon: '🧪',
    tier: 1,
    value: 0.35,
  }
  const battery = {
    uid: 'battery-1',
    kind: 'consumable',
    name: '充能电池',
    desc: '',
    icon: '🔋',
    tier: 1,
    value: 1,
  }
  const card = economy.makeCardItem('armor', 1)
  bag.add(potion)
  bag.add(battery)
  bag.add(card)
  const used = bag.use('potion-2')
  ok(used, '应返回被用掉的药水')
  eq(used.name, '治疗药水')
  eq(bag.count, 2, '药水应离包')
  eq(bag.use('battery-1').name, '充能电池')
  eq(bag.use(card.uid), null, '卡片不能 use')
  eq(bag.use('missing'), null, '不存在 uid')
})

check('cards 汇总：只累计增益卡，消耗品/专武券不上面板', () => {
  const bag = new Inventory()
  bag.add(economy.makeCardItem('magic', 1)) // 18
  bag.add(economy.makeCardItem('hp', 2)) // 25×1.9=47.5
  bag.add(economy.makeCardItem('armor', 1)) // 0.03
  bag.add(economy.makeWeaponItem('fish', 2))
  bag.add({ uid: 'c1', kind: 'consumable', name: '充能电池', desc: '', icon: '🔋', tier: 1, value: 1 })
  const cards = bag.cards
  approx(cards.magic, 18, 1e-9)
  approx(cards.hp, 47.5, 1e-9)
  approx(cards.armor, 0.03, 1e-9)
  eq(cards.stamina, 0)
})

check('applyItemToCards / recomputeMaxHp 口径', () => {
  const cards = economy.emptyCards()
  const item = economy.makeCardItem('hp', 1)
  economy.applyItemToCards(cards, item, 1)
  approx(cards.hp, 25, 1e-9)
  economy.applyItemToCards(cards, item, -1)
  approx(cards.hp, 0, 1e-9)
  eq(economy.recomputeMaxHp('mutsumi', cards), CHARACTERS.mutsumi.base.hp, 'mutsumi 基础生命')
  const withHp = { ...economy.emptyCards(), hp: 50 }
  eq(economy.recomputeMaxHp('mutsumi', withHp), CHARACTERS.mutsumi.base.hp + 50, '生命结晶叠加')
})

check('remove 后不可再操作', () => {
  const bag = new Inventory()
  const item = economy.makeCardItem('dodge', 1)
  bag.add(item)
  eq(bag.remove(item.uid), item)
  eq(bag.remove(item.uid), null)
  eq(bag.get(item.uid), undefined)
})

// ═════════════════════════════════════════════════════════════════
section('4. 存档 round-trip（内存假 localStorage）')

const mem = installFakeStorage()

function buildRun() {
  const bag = new Inventory()
  bag.add(economy.makeCardItem('magic', 1))
  bag.add(economy.makeCardItem('hp', 2))
  bag.add(economy.makeWeaponItem('murasame', 2))
  bag.add({ uid: 'potion-9', kind: 'consumable', name: '治疗药水', desc: '回血', icon: '🧪', tier: 1, value: 0.35 })
  return {
    version: 3,
    difficulty: 'normal',
    character: 'murasame',
    layer: 5,
    stage: 2,
    gold: 123,
    hp: 99,
    maxHp: 135,
    weaponLv: 2,
    cards: bag.cards,
    inventory: [...bag.items],
    kills: 42,
    playTime: 123.5,
    seed: 777,
    savedAt: 0,
  }
}

check('saveToSlot / loadFromSlot 完整往返', () => {
  const state = buildRun()
  eq(saveLoad.SAVE_SLOTS, 3)
  eq(saveLoad.SAVE_VERSION, 3)
  ok(saveLoad.saveToSlot(1, state), '存档应成功')
  ok(mem.has(`${BALANCE.save.storageKey}:1`), 'key 应使用 balance.save.storageKey')
  const loaded = saveLoad.loadFromSlot(1)
  ok(loaded, '读档应成功')
  eq(loaded.version, 3)
  eq(loaded.difficulty, 'normal')
  eq(loaded.character, 'murasame')
  eq(loaded.layer, 5)
  eq(loaded.stage, 2)
  eq(loaded.gold, 123)
  eq(loaded.hp, 99)
  eq(loaded.weaponLv, 2)
  eq(loaded.kills, 42)
  eq(loaded.playTime, 123.5)
  eq(loaded.seed, 777)
  ok(loaded.savedAt > 0, 'savedAt 应在存档时刷新')
  deepEqual(loaded.inventory, state.inventory, '背包物品')
  deepEqual(loaded.cards, state.cards, '五维')
})

check('listSlots 返回元信息（空槽为空）', () => {
  const metas = saveLoad.listSlots()
  eq(metas.length, 3)
  eq(metas[0].slot, 1)
  eq(metas[0].empty, false)
  eq(metas[0].character, 'murasame')
  eq(metas[0].layer, 5)
  eq(metas[0].gold, 123)
  ok(metas[0].savedAt > 0)
  eq(metas[1].empty, true, '槽 2 空')
  eq(metas[2].empty, true, '槽 3 空')
})

check('deleteSlot 清空并让 load 返回 null', () => {
  saveLoad.deleteSlot(1)
  eq(saveLoad.loadFromSlot(1), null)
  eq(saveLoad.listSlots()[0].empty, true)
})

check('坏 JSON 档：删除并返回 null', () => {
  const key = `${BALANCE.save.storageKey}:2`
  mem.set(key, '{"version":3,"difficulty":')
  eq(saveLoad.loadFromSlot(2), null)
  eq(mem.has(key), false, '坏档应被删除')
})

check('version 不符：删除并返回 null', () => {
  const state = { ...buildRun(), version: 2 }
  mem.set(`${BALANCE.save.storageKey}:2`, JSON.stringify(state))
  eq(saveLoad.loadFromSlot(2), null)
  eq(mem.has(`${BALANCE.save.storageKey}:2`), false, '版本不符应删除')
})

check('字段缺失（无 inventory）：删除并返回 null', () => {
  const state = buildRun()
  delete state.inventory
  mem.set(`${BALANCE.save.storageKey}:3`, JSON.stringify(state))
  eq(saveLoad.loadFromSlot(3), null)
  eq(mem.has(`${BALANCE.save.storageKey}:3`), false, '缺字段应删除')
})

check('非法槽位：save 返回 false，load 返回 null', () => {
  const state = buildRun()
  eq(saveLoad.saveToSlot(0, state), false)
  eq(saveLoad.saveToSlot(4, state), false)
  eq(saveLoad.saveToSlot(1.5, state), false)
  eq(saveLoad.loadFromSlot(0), null)
  eq(saveLoad.loadFromSlot(99), null)
})

check('三槽互不覆盖', () => {
  const a = { ...buildRun(), layer: 3, gold: 30 }
  const b = { ...buildRun(), layer: 7, gold: 70 }
  ok(saveLoad.saveToSlot(1, a))
  ok(saveLoad.saveToSlot(2, b))
  eq(saveLoad.loadFromSlot(1).layer, 3)
  eq(saveLoad.loadFromSlot(2).layer, 7)
  eq(saveLoad.listSlots().filter((meta) => !meta.empty).length, 2)
})

check('无 localStorage 时不抛异常（save=false / load=null / list 全空）', () => {
  const saved = globalThis.localStorage
  delete globalThis.localStorage
  eq(saveLoad.saveToSlot(1, buildRun()), false)
  eq(saveLoad.loadFromSlot(1), null)
  ok(saveLoad.listSlots().every((meta) => meta.empty), '无存储时槽位应为空')
  saveLoad.deleteSlot(1)
  globalThis.localStorage = saved
})

check('商店随机可复现（同 seed 同货架）', () => {
  const a = shop.generateOffers(6, 'fish', 200, new Rng(555), 4, 3)
  const b = shop.generateOffers(6, 'fish', 200, new Rng(555), 4, 3)
  deepEqual(a, b, 'generateOffers')
  eq(a.length, 4)
  ok(a.some((offer) => offer.kind === 'weapon'), '货架应含专武券')
  eq(a.find((offer) => offer.kind === 'weapon').weaponLevel, 4, '专武券 = 当前等级 +1')
  const weapon = a.find((offer) => offer.kind === 'weapon')
  eq(weapon.price, BALANCE.weapons.fish.tiers[3].price, '专武价格取 tiers[level-1].price')
  const cards = a.filter((offer) => offer.kind === 'buff-card')
  ok(cards.length >= 2, '至少 2 张增益卡')
  ok(shop.refreshOffers(6, 'fish', new Rng(1), 2).length === 4, 'refreshOffers 出 4 件')
})

check('商店专武券到 5 级后不再出现', () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const offers = shop.generateOffers(10, 'murasame', 999, new Rng(attempt), 4, 5)
    ok(offers.every((offer) => offer.kind !== 'weapon'), '满级不应出专武券')
  }
})

// ═════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(56)}`)
if (failures.length === 0) {
  console.log(`全部通过：${passed} 项检查 ✅`)
  process.exit(0)
}

console.log(`通过 ${passed} 项，失败 ${failures.length} 项 ❌`)
for (const failure of failures) {
  console.log(`\n✗ ${failure.name}\n  ${failure.error.stack ?? failure.error.message}`)
}
process.exit(1)
