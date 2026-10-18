const fs = require('fs')
let s = fs.readFileSync('sim/simulate.mjs', 'utf8')
const miss = []
const rep = (a, b) => {
  if (!s.includes(a)) { miss.push(a.slice(0, 55)); return }
  s = s.split(a).join(b)
}
rep(
  `    hp: 110, chargeMax: 100, stamina: 100, magic: 100, intelligence: 100, moveSpeed: 6.2,`,
  `    hp: 110, chargeMax: 100, stamina: 135, magic: 100, intelligence: 100, moveSpeed: 6.2,`,
)
rep(
  `    hp: 135, chargeMax: 90, stamina: 130, magic: 95, intelligence: 70, moveSpeed: 7.0,`,
  `    hp: 175, chargeMax: 80, stamina: 130, magic: 95, intelligence: 70, moveSpeed: 7.3,`,
)
rep(
  `    skill: { cost: 90, kind: 'dash', heal: 15, aoe: 0.3 },`,
  `    skill: { cost: 80, kind: 'dash', heal: 22, aoe: 0.3 },`,
)
rep(
  `    hp: 130, chargeMax: 110, stamina: 140, magic: 80, intelligence: 110, moveSpeed: 6.6,`,
  `    hp: 110, chargeMax: 90, stamina: 180, magic: 80, intelligence: 110, moveSpeed: 6.6,`,
)
rep(
  `    skill: { cost: 110, kind: 'summon', duration: 10, count: 3, minionDpsRatio: 0.45, aoe: 0.25 },`,
  `    skill: { cost: 90, kind: 'summon', duration: 10, count: 3, minionDpsRatio: 0.45, aoe: 0.25 },`,
)
rep('const CHARGE_PER_KILL = 6', 'const CHARGE_PER_KILL = 8')
fs.writeFileSync('sim/simulate.mjs', s)
console.log('miss', miss)
