/**
 * P0-a 三档道具卡 / 背包 / 商店 / 商人「交换」专项冒烟：
 *   node sim/card-smoke.mjs
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
const { ITEM_CARDS, cardRuntimeValueAt, cardIdOfItem } = await import('../src/data/cards.ts')
const economy = await import('../src/systems/economy.ts')
const invMod = await import('../src/systems/inventory.ts')
const shop = await import('../src/systems/shop.ts')
const { isRunState } = await import('../src/systems/saveLoad.ts')

const { Inventory } = invMod
const { MerchantExchange, exchangePriceFor, generateOffers, jumpTierChance, legalExchangePool } = shop

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

function approx(actual, expected, eps = 1e-6, hint = '') {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${hint} 期望 ≈${expected}，实际 ${actual}`)
  }
}

console.log('\n三档卡 / 背包 / 商店 / 商人交换 · card-smoke')

check('10 张卡 × 3 档：makeCardItem 纯由 tier 推导数值且严格递增', () => {
  eq(ITEM_CARDS.length, 10)
  for (const def of ITEM_CARDS) {
    const t1 = economy.makeCardItem(def.id, 1)
    const t2 = economy.makeCardItem(def.id, 2)
    const t3 = economy.makeCardItem(def.id, 3)
    approx(t1.value, cardRuntimeValueAt(def, 1), 1e-9, `${def.id} t1`)
    approx(t2.value, cardRuntimeValueAt(def, 2), 1e-9, `${def.id} t2`)
    approx(t3.value, cardRuntimeValueAt(def, 3), 1e-9, `${def.id} t3`)
    ok(t1.value < t2.value && t2.value < t3.value, `${def.id} 三档未递增`)
    eq(cardIdOfItem(t1), def.id, `${def.id} 反查 id`)
    eq(cardIdOfItem(t3), def.id, `${def.id} 金档反查 id`)
  }
})

check('生命之源（hpRegen）进背包可原地升档且不破坏存档校验', () => {
  const bag = new Inventory()
  const r1 = economy.makeCardItem('hpRegen', 1)
  eq(r1.stat, undefined, 'hpRegen 暂不占 CardStat')
  ok(bag.add(r1))
  approx(bag.hpRegen, 0.025, 1e-9)
  ok(bag.add(economy.makeCardItem('hpRegen', 1)))
  eq(bag.count, 1)
  eq(bag.tierOf('hpRegen'), 2)
  approx(bag.hpRegen, 0.05, 1e-9)
  ok(bag.add(economy.makeCardItem('hpRegen', 2)))
  eq(bag.tierOf('hpRegen'), 3)
  approx(bag.hpRegen, 0.09, 1e-9)
  eq(bag.add(economy.makeCardItem('hpRegen', 3)), false, '满金退池不再入包')

  const run = {
    version: 3,
    difficulty: 'normal',
    character: 'mutsumi',
    layer: 3,
    stage: 1,
    gold: 100,
    hp: 100,
    maxHp: 100,
    cards: bag.cards,
    inventory: [...bag.items],
    kills: 10,
    playTime: 20,
    seed: 1,
    savedAt: Date.now(),
  }
  ok(isRunState(run), '含生命之源的存档应通过 isRunState 校验')
})

check('旧合成导出 canMergeItems 已删除', () => {
  eq('canMergeItems' in invMod, false, '不应再导出 canMergeItems')
  eq('DEFAULT_BAG_SLOTS' in invMod, false, '不应再导出 DEFAULT_BAG_SLOTS')
})

check('商店只出比当前持有高一档的卡，且满金卡绝不再出现', () => {
  const bag = new Inventory()
  bag.add(economy.makeCardItem('magic', 3)) // 满金 -> 退池
  bag.add(economy.makeCardItem('stamina', 2)) // 持紫 -> 只出金
  bag.add(economy.makeCardItem('hp', 1)) // 持蓝 -> 出紫或跳金

  const rng = new Rng(202611)
  for (let i = 0; i < 120; i += 1) {
    const offers = generateOffers(8, 'mutsumi', 9999, rng, 4, 0, bag)
    for (const offer of offers) {
      if (offer.kind !== 'buff-card') continue
      const cid = cardIdOfItem(offer)
      ok(cid !== 'magic', '满金卡 magic 不应再出现在商店')
      if (cid === 'stamina') eq(offer.tier, 3, '持紫 stamina 只能出金')
      if (cid === 'hp') ok(offer.tier >= 2, '持蓝 hp 至少出紫')
    }
  }
})

check('跳级概率随层数温和升高且严格压低（<= 12%）', () => {
  eq(jumpTierChance(1, 0), 0, 'L1 不跳级')
  eq(jumpTierChance(3, 0), 0, 'L3 不跳级')
  ok(jumpTierChance(10, 0) > jumpTierChance(5, 0), '未持有跳级率随层数上升')
  ok(jumpTierChance(15, 0) <= 0.12, '未持有跳级率封顶 12%')
  eq(jumpTierChance(6, 1), 0, 'L6 持蓝不跳金')
  ok(jumpTierChance(13, 1) > jumpTierChance(8, 1), '持蓝跳金率随层数上升')
  ok(jumpTierChance(15, 1) <= 0.08, '持蓝跳金率封顶 8%')
})

check('一局 15 层模拟能拿到 1–2 张金卡 + 数张散卡', () => {
  const runs = 100
  let totalGoldCards = 0
  let totalOtherCards = 0
  for (let r = 0; r < runs; r += 1) {
    const rng = new Rng(9000 + r)
    const bag = new Inventory()
    // 模拟 15 层：每层在商店买 1 张卡（优先买高档升级卡）
    for (let layer = 1; layer <= 15; layer += 1) {
      const offers = generateOffers(layer, 'murasame', 9999, rng, 4, 0, bag)
      const cards = offers.filter((o) => o.kind === 'buff-card').sort((a, b) => b.tier - a.tier)
      if (cards.length > 0) {
        const pick = cards[0]
        const cid = cardIdOfItem(pick)
        if (cid) bag.add(economy.makeCardItem(cid, pick.tier))
      }
    }
    const owned = bag.ownedCards()
    totalGoldCards += owned.filter((c) => c.tier === 3).length
    totalOtherCards += owned.filter((c) => c.tier < 3).length
  }
  const avgGold = totalGoldCards / runs
  const avgOther = totalOtherCards / runs
  console.log(`    [15层×100局均值] 金卡=${avgGold.toFixed(2)} 张, 蓝/紫散卡=${avgOther.toFixed(2)} 张`)
  ok(avgGold >= 0.8 && avgGold <= 3.5, `局均金卡应在 0.8–3.5 张区间（消耗品保底挤占一格），实际 ${avgGold.toFixed(2)}`)
  ok(avgOther >= 3.0, `局均散卡应 >= 3 张，实际 ${avgOther.toFixed(2)}`)
})

check('商人「交换」价格曲线 0 / 15 / 25 / 40 / 65 / 104（×1.6）', () => {
  eq(exchangePriceFor(0), 0)
  eq(exchangePriceFor(1), 15)
  eq(exchangePriceFor(2), 25)
  eq(exchangePriceFor(3), 40)
  eq(exchangePriceFor(4), 65)
  eq(exchangePriceFor(5), Math.round(65 * 1.6))
  eq(exchangePriceFor(6), Math.round(65 * 1.6 * 1.6))
})

check('商人「交换」同档不同名三选一、房间内递增、离开房间重置', () => {
  const rng = new Rng(4242)
  const bag = new Inventory()
  const m = economy.makeCardItem('magic', 2)
  const h = economy.makeCardItem('hp', 1)
  bag.add(m)
  bag.add(h)

  const ex = new MerchantExchange()
  let gold = 200

  // 第 1 次免费（0 金）
  eq(ex.currentPrice, 0)
  const offer1 = ex.rollChoices(m, bag, rng)
  ok(offer1, '应给出交换三选一')
  eq(offer1.choices.length, 3)
  eq(offer1.price, 0)
  for (const c of offer1.choices) {
    eq(c.tier, 2, '候选必须同档（紫）')
    const cid = cardIdOfItem(c)
    ok(cid !== 'magic' && cid !== 'hp', '候选不能与原卡或已持有卡同名')
  }
  const chosen1 = cardIdOfItem(offer1.choices[0])
  const res1 = ex.commitExchange(m.uid, chosen1, bag, gold)
  ok(res1.ok)
  eq(res1.cost, 0)
  eq(res1.goldAfter, 200)
  gold = res1.goldAfter
  eq(bag.tierOf('magic'), 0, '原卡应被替换掉')
  eq(bag.tierOf(chosen1), 2, '新卡应保持同档位')

  // 第 2 次 15 金
  eq(ex.currentPrice, 15)
  const swapped = bag.get(m.uid)
  const offer2 = ex.rollChoices(swapped, bag, rng)
  ok(offer2)
  const chosen2 = cardIdOfItem(offer2.choices[0])
  const res2 = ex.commitExchange(swapped.uid, chosen2, bag, gold)
  ok(res2.ok)
  eq(res2.cost, 15)
  eq(res2.goldAfter, 185)
  eq(ex.currentPrice, 25, '第 3 次应涨到 25 金')

  // 离开房间重置
  ex.reset()
  eq(ex.currentPrice, 0, '离开房间后应重置为 0 金')
})

check('商人「交换」池内无合法目标时不可交换且不扣钱', () => {
  const rng = new Rng(777)
  const bag = new Inventory()
  for (const def of ITEM_CARDS) {
    bag.add(economy.makeCardItem(def.id, 1))
  }
  const first = bag.items[0]
  const ex = new MerchantExchange()
  eq(legalExchangePool(first, bag).length, 0, '全 10 张已持有时无合法目标')
  eq(ex.canExchange(first, bag), false, '按钮应置灰')
  eq(ex.rollChoices(first, bag, rng), null, 'rollChoices 返回 null')
  const res = ex.commitExchange(first.uid, 'stamina', bag, 100)
  eq(res.ok, false)
  eq(res.reason, 'no-target')
  eq(res.cost, 0, '不扣钱')
  eq(res.goldAfter, 100, '金币不变')
  eq(ex.usesInRoom, 0, '不递增本房间次数')
})

console.log(`\n通过 ${passed}，失败 ${failures.length}`)
if (failures.length) {
  for (const f of failures) console.error(`\n[${f.name}]\n${f.error.stack}`)
  process.exit(1)
}
