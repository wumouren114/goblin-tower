// 历史一次性迁移脚本。v4.4 已移除倒计时，请勿再运行（否则会把 timer 字段写回 balance.json）。
console.error('migrate-v3c.mjs 是历史脚本，v4.4 起不再适用；当前数值以 balance.json 为准。')
process.exit(1)

import fs from 'node:fs'

const bp = 'src/data/balance.json'
const b = JSON.parse(fs.readFileSync(bp, 'utf8'))

// 用户口径：每层 1 分钟，Boss 层 1 分半
b.meta.layerTimerSeconds = 60
b.meta.bossTimerSeconds = 90

// 新增 3 张卡，给金币更多出口、也补生存维度
const extra = [
  { id: 'armor', name: '铁鳞甲片', stat: 'armor', value: 0.03, basePrice: 55, maxStacks: 10, desc: '受到的伤害 -3%' },
  { id: 'dodge', name: '疾影护符', stat: 'dodge', value: 0.03, basePrice: 60, maxStacks: 8, desc: '闪避率 +3%（上限 24%）' },
  { id: 'chargeGain', name: '猎手徽记', stat: 'chargeGain', value: 0.08, basePrice: 45, maxStacks: 8, desc: '击杀获得充能 +8%' }
]
for (const card of extra) if (!b.buffCards.some((c) => c.id === card.id)) b.buffCards.push(card)
fs.writeFileSync(bp, JSON.stringify(b, null, 2) + '\n')

const sp = 'sim/simulate.mjs'
let s = fs.readFileSync(sp, 'utf8')
s = s.replace('exposure: 1.32', 'exposure: 1.55')
// 闪避上限
s = s.replace('const dodge = st.cards.dodge ?? 0', 'const dodge = Math.min(0.24, st.cards.dodge ?? 0)')
fs.writeFileSync(sp, s)
console.log('timers 60/90, +3 cards, murasame exposure 1.55')
