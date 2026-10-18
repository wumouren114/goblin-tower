const fs = require('fs')
let g = fs.readFileSync('src/game.ts', 'utf8')
const miss = []
const rep = (a, b) => {
  if (!g.includes(a)) { miss.push(a.slice(0, 55)); return }
  g = g.split(a).join(b)
}
rep('  /** 无头/联调：存档 → 回标题 → 读档，验证 continue 流程 */', `  /** 无头/联调：自动领取清层奖励卡（验证「先三选一，再传送门」） */
  debugPickFirstBonus(): void {
    if (this.bonusActive && this.bonusOffers[0]) this.pickTunnel(this.bonusOffers[0].id)
  }

  /** 无头/联调：存档 → 回标题 → 读档，验证 continue 流程 */`)
fs.writeFileSync('src/game.ts', g)

let m = fs.readFileSync('src/main.ts', 'utf8')
if (!m.includes("pickbonus")) {
  m = m.replace(
    "    if (params.get('autoattack') === '1') game.debugAutoAttack(true)",
    "    if (params.get('pickbonus') === '1') game.debugPickFirstBonus()\n    if (params.get('autoattack') === '1') game.debugAutoAttack(true)",
  )
  fs.writeFileSync('src/main.ts', m)
}
console.log('miss', miss)
