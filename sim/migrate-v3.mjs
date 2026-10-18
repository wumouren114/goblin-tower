import fs from 'node:fs'
const p = 'src/data/balance.json'
const b = JSON.parse(fs.readFileSync(p, 'utf8'))

// 用户拍板（m00597）：①删回旋刃 ②取消经验/等级，全部金币购买 ③怪物数量固定、超时判负、新增存档
b._comment = '哥布林之塔 · 关卡与经济数值唯一数据源（docs/04 的实现口径）。v3：无经验系统，怪物数量固定，超时判负。修改后跑 node sim/simulate.mjs 复验。'
b.meta.version = 3
b.meta.layerTimerSeconds = 90
b.meta.bossTimerSeconds = 120
b.meta.timeoutIsDefeat = true
b.meta.monsterCountIsFixed = true
b.meta.note = '每层怪物总数固定（= quota 字段），刷完即止；限时内清完才通关，超时判负'

// 去掉经验体系
delete b.levelCards

b.layerCurve.quotaBase = 30
b.layerCurve.quotaPerLayer = 5.0
b.layerCurve.quotaNote = 'quota = 本层固定怪物总数，不再随时间无限刷新'

// 奖励房比战斗房给得多
b.portals.chestGoldBase = 60
b.portals.chestGoldPerLayer = 10
b.portals.chestCardChance = 0.5
b.portals.mobWaveGoldMul = 1.2
b.portals.eliteFightGoldMul = 1.8

// 存档
b.save = {
  slots: 3,
  storageKey: 'goblin-tower-save-v3',
  autosaveOnLayerStart: true,
  autosaveOnShopExit: true,
  note: '每层开始时自动存档；标题页可「继续游戏」，暂停菜单可手动存/读档'
}

// 没有等级卡后，商店是唯一成长来源：略微提高金币产出与卡片数值上限
b.layerCurve.clearGoldBase = 45
b.layerCurve.clearGoldPerLayer = 10
b.buffCards = b.buffCards.map((c) => ({ ...c, maxStacks: Math.round(c.maxStacks * 1.4) }))

fs.writeFileSync(p, JSON.stringify(b, null, 2) + '\n')
console.log('balance.json -> v3')
