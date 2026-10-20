// 生成 docs 用的逐层随难度数值表：node sim/table.mjs
import fs from 'node:fs'
const b = JSON.parse(fs.readFileSync('src/data/balance.json', 'utf8'))
const C = b.layerCurve
const d = b.difficulties.hard
console.log('| 层 | 阶段 | 类型 | 小怪血量 | 击杀配额 | 通关金币奖励 |')
console.log('|---:|---:|:--|---:|---:|---:|')
for (let i = 1; i <= 15; i += 1) {
  const isBoss = i === 5 || i === 10 || i === 15
  const stage = i <= 5 ? 1 : i <= 10 ? 2 : 3
  const hp = Math.round(C.mobHpBase * (1 + C.mobHpPerLayer * (i - 1)) * d.hpMul)
  // Boss 层的配额是小怪数量（Boss 本体不计入 quota）；先按整层配额取整，再乘 Boss 小怪系数，和 game.ts 一致
  const layerQuota = Math.round((C.quotaBase + C.quotaPerLayer * (i - 1)) * (d.countMul ?? 1))
  const quota = Math.round(layerQuota * (isBoss ? 0.6 : 1))
  const gold = Math.round((C.clearGoldBase + C.clearGoldPerLayer * (i - 1)) * d.goldMul)
  console.log(`| ${i} | ${stage} | ${isBoss ? 'Boss 层' : i === 1 || i === 6 || i === 11 ? '小怪层（阶段首）' : '小怪层'} | ${hp} | ${quota} | ${gold} |`)
}

console.log('\n简单（7 层 / 1 阶段）: 血量 ×0.7 伤害 ×0.55 刷新 ×0.9 数量 ×0.9 金币 ×1.2')
console.log('普通（12 层 / 5+7）: 血量 ×0.95 伤害 ×0.85 刷新 ×1.0 数量 ×1.2 金币 ×1.0')
console.log('困难（15 层 / 5+5+5）: 血量 ×1.45 伤害 ×1.4 刷新 ×1.2 数量 ×1.2 金币 ×1.05')

console.log('\n金币收入（普通难度/层）：')
for (let i = 1; i <= 12; i += 1) {
  const quota = Math.round(C.quotaBase + C.quotaPerLayer * (i - 1))
  const perKill = C.goldPerKillBase + Math.floor((i - 1) / C.goldPerKillEveryLayers)
  const clear = Math.round(C.clearGoldBase + C.clearGoldPerLayer * (i - 1))
  const isBoss = i === 5 || i === 12
  const killGold = (isBoss ? Math.round(quota * 0.6) : quota) * perKill
  console.log(`第 ${String(i).padStart(2)} 层：击杀 ${killGold} + 通关 ${clear}${isBoss ? ' + Boss 奖励 ' + Math.round(90 + 15 * i) : ''}`)
}
