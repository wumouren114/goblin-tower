/**
 * 奖励关（宝藏密室 / 技能圣所）NPC 对话与三选一奖励冒烟测试：
 *   node sim/reward-room-smoke.mjs
 */
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const { roomNpcDialogue, roomNpcInfo } = await server.ssrLoadModule('/src/entities/roomNpc.ts')
const { buildRewardRoomEvent, resolveRewardChoice, rewardGoldFor } = await server.ssrLoadModule('/src/data/rewardRooms.ts')
const { clearGoldFor } = await server.ssrLoadModule('/src/data/balance.ts')
const { makeCardItem } = await server.ssrLoadModule('/src/systems/economy.ts')

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
  // 1. 宝藏守卫与刻文石灵各有 2~3 句对话（复用 roomNpc.ts）
  const chestLines = roomNpcDialogue('chest')
  const skillLines = roomNpcDialogue('skill-card')
  check(
    '宝藏守卫（chest）拥有 2~3 句 NPC 对话',
    roomNpcInfo('chest').title === '宝藏守卫' && chestLines.length >= 2 && chestLines.length <= 3,
    `lines=${chestLines.length}`,
  )
  check(
    '刻文石灵（skill-card）拥有 2~3 句 NPC 对话',
    roomNpcInfo('skill-card').title === '刻文石灵' && skillLines.length >= 2 && skillLines.length <= 3,
    `lines=${skillLines.length}`,
  )

  // 2. 构造的事件定义包含 3 个选项且写清代价与结果口径
  const blueCard = makeCardItem('magic', 1)
  const evChest = buildRewardRoomEvent('chest', blueCard, 'normal', 4)
  const optionIds = evChest.options.map((o) => o.id)
  check(
    '奖励关提供 3 个选项（直接领卡 / 换金币 / 赌一把）',
    optionIds.join(',') === 'take-card,take-gold,gamble' && evChest.intro.includes(chestLines[0]),
    `options=${optionIds.join(',')}`,
  )
  check(
    '各选项均写明代价与结果口径提示',
    evChest.options.every((o) => typeof o.hint === 'string' && o.hint.length >= 8 && o.outcomes.length >= 1),
  )

  // 3. 选项 1：直接领卡，稳妥返回原卡且不额外加金币
  {
    const res = resolveRewardChoice('take-card', blueCard, 'normal', 4, { chance: () => false })
    check('选「直接领取」返回原道具卡且无额外金币', res.card?.name === blueCard.name && res.gold === undefined)
  }

  // 4. 选项 2：换金币，严格对齐 economy-smoke 的 clearGoldFor 口径（不凭空放大）
  {
    const base = clearGoldFor('normal', 6)
    const table = rewardGoldFor('normal', 6)
    const res = resolveRewardChoice('take-gold', blueCard, 'normal', 6, { chance: () => false })
    check(
      '选「换成金币」数值锚定 clearGoldFor（<= 单层通关金，且 > 0）',
      res.gold === table.safeGold && res.gold > 0 && res.gold <= base && res.card === undefined,
      `safeGold=${res.gold}, clearGold=${base}`,
    )
  }

  // 5. 选项 3：赌一把（高结果升档/加码，低结果少于稳妥换金）
  {
    const highBlue = resolveRewardChoice('gamble', blueCard, 'normal', 6, { chance: () => true })
    check(
      '选「赌一把」成功时蓝卡升档为紫卡（tier 1 → 2）',
      highBlue.upgraded === true && highBlue.card?.tier === 2 && highBlue.card?.stat === 'magic',
      `tier=${highBlue.card?.tier}`,
    )

    const goldCard = makeCardItem('magic', 3)
    const highGold = resolveRewardChoice('gamble', goldCard, 'normal', 6, { chance: () => true })
    check(
      '选「赌一把」已满金卡成功时保留金卡并附赠加码金币',
      highGold.upgraded === true && highGold.card?.tier === 3 && (highGold.gold ?? 0) > 0,
      `gold=${highGold.gold}`,
    )

    const table = rewardGoldFor('normal', 6)
    const low = resolveRewardChoice('gamble', blueCard, 'normal', 6, { chance: () => false })
    check(
      '选「赌一把」失手时仅得少额补偿金币（< 稳妥换金，> 0）',
      low.upgraded === false && low.card === undefined && (low.gold ?? 0) === table.consolationGold && (low.gold ?? 0) < table.safeGold,
      `consolation=${low.gold}, safe=${table.safeGold}`,
    )
  }

  // 6. 层进度不卡死：game.ts 奖励房入口走 openRewardRoom 并在关闭面板后调用 completeRoomMap 开启出口裂隙
  {
    const gameSrc = readFileSync('src/game.ts', 'utf8')
    const wired =
      gameSrc.includes("room.offer.room === 'chest' || room.offer.room === 'skill-card'") &&
      gameSrc.includes('this.openRewardRoom(') &&
      gameSrc.includes('this.completeRoomMap(title)')
    check('game.ts 奖励关结算完成后走 completeRoomMap 开启出口裂隙（层进度不卡）', wired)
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
