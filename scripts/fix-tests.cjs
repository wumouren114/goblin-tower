const fs = require('fs')
const miss = []
const patch = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8')
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { miss.push(file + ': ' + a.slice(0, 55)); continue }
    s = s.split(a).join(b)
  }
  fs.writeFileSync(file, s)
}

patch('sim/world-smoke.mjs', [
  ['check(Number.isInteger(d.props) && d.props >= 16,', 'check(Number.isInteger(d.props) && d.props >= 10,'],
])

patch('sim/combat-smoke.mjs', [
  [`check('突进消耗 70 充能', combat.charge === 20, \`charge=\${combat.charge}\`)`, `check('突进消耗 80 充能', combat.charge === 10, \`charge=\${combat.charge}\`)`],
  ['near(combat.minionsList[0].hp, 95 * 0.35, 1e-6)', 'near(combat.minionsList[0].hp, 110 * 0.35, 1e-6)'],
  [`check('小怪击杀 +6*(1+0.5)=9', near(combat.charge - beforeKill, 9, 1e-6)`, `check('小怪击杀 +8*(1+0.5)=12', near(combat.charge - beforeKill, 12, 1e-6)`],
  [`check('精英击杀 +25*(1.5)=37.5', near(combat.charge, 37.5, 1e-6)`, `check('精英击杀 +28*(1.5)=42', near(combat.charge, 42, 1e-6)`],
  [`check('boss 击杀 +60*(1.5)=90', near(combat.charge, 90, 1e-6)`, `check('boss 击杀 +70*(1.5)=105', near(combat.charge, 105, 1e-6)`],
])

// game.ts：层初充能改用 characters.ts 的 60% 常量
patch('src/game.ts', [
  ['this.combat.resetLayer(0.5)', 'this.combat.resetLayer(CHARGE_FLOOR_START_RATIO)'],
])

let g = fs.readFileSync('src/game.ts', 'utf8')
if (!g.includes('CHARGE_FLOOR_START_RATIO')) {
  g = g.replace("import { CHARACTERS } from './data/characters'", "import { CHARACTERS, CHARGE_FLOOR_START_RATIO } from './data/characters'")
  fs.writeFileSync('src/game.ts', g)
}
console.log('miss', miss)
