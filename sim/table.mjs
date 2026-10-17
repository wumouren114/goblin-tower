// 生成 docs 用的逐层随难度数值表：node sim/table.mjs
import fs from 'node:fs'
const b = JSON.parse(fs.readFileSync('src/data/balance.json', 'utf8'))
const C = b.layerCurve
const d = b.difficulties.hard
console.log('| 层 | 阶段 | 类型 | 小怪血量 | 击杀配额 | 层限时 | 通关金币奖励 |')
console.log('|---:|---:|:--|---:|---:|---:|---:|')
for (let i = 1; i <= 15; i += 1) {
  const isBoss = i === 5 || i === 10 || i === 15
  const stage = i <= 5 ? 1 : i <= 10 ? 2 : 3
  const hp = Math.round(C.mobHpBase * (1 + C.mobHpPerLayer * (i - 1)) * d.hpMul)
  const quota = Math.round(C.quotaBase + C.quotaPerLayer * (i - 1))
  const timer = isBoss ? b.meta.bossTimerSeconds : b.meta.layerTimerSeconds
  const gold = Math.round(C.clearGoldBase + C.clearGoldPerLayer * (i - 1))
  console.log(`| ${i} | ${stage} | ${isBoss ? 'Boss 层' : i === 1 || i === 6 || i === 11 ? '小怪层（阶段首）' : '小怪层'} | ${hp} | ${quota} | ${timer}s | ${gold} |`)
}

console.log('\n简单（7 层 / 1 阶段）: 血量 ×0.85 伤害 ×0.7 刷新 ×0.9 金币 ×1.2 计时 ×1.15')
console.log('普通（12 层 / 5+7）: 血量 ×1.0 伤害 ×1.0 刷新 ×1.0 金币 ×1.0')
console.log('困难（15 层 / 5+5+5）: 血量 ×1.5 伤害 ×1.5 刷新 ×1.2 金币 ×1.05 计时 ×1.0')

console.log('\n金币收入（普通难度/层）：')
for (let i = 1; i <= 12; i += 1) {
  const quota = Math.round(C.quotaBase + C.quotaPerLayer * (i - 1))
  const perKill = C.goldPerKillBase + Math.floor((i - 1) / C.goldPerKillEveryLayers)
  const clear = Math.round(C.clearGoldBase + C.clearGoldPerLayer * (i - 1))
  const isBoss = i === 5 || i === 12
  const killGold = (isBoss ? Math.round(quota * 0.6) : quota) * perKill
  console.log(`第 ${String(i).padStart(2)} 层：击杀 ${killGold} + 通关 ${clear}${isBoss ? ' + Boss 奖励 ' + Math.round(90 + 15 * i) : ''}`)
}
