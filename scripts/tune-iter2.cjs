const fs = require('fs')
const miss = []
const patch = (file, pairs) => {
  let s = fs.readFileSync(file, 'utf8')
  for (const [a, b] of pairs) {
    if (!s.includes(a)) { miss.push(file + ': ' + a.slice(0, 50)); continue }
    s = s.split(a).join(b)
  }
  fs.writeFileSync(file, s)
}

patch('src/data/balance.json', [
  ['"mobHpBase": 23', '"mobHpBase": 26'],
  ['"mobHpPerLayer": 0.45', '"mobHpPerLayer": 0.5'],
  ['"bossHpBase": 440', '"bossHpBase": 480'],
  [`      "hpMul": 0.85,
      "damageMul": 0.72,`, `      "hpMul": 0.95,
      "damageMul": 0.85,`],
  [`      "hpMul": 1.15,
      "damageMul": 1.05,`, `      "hpMul": 1.3,
      "damageMul": 1.25,`],
])

patch('src/data/characters.ts', [
  [`export const CHARGE_PER_KILL = {
  small: 10,
  brute: 14,
  elite: 34,
  boss: 80,
} as const`, `export const CHARGE_PER_KILL = {
  small: 8,
  brute: 12,
  elite: 28,
  boss: 70,
} as const`],
])
console.log('miss', miss)
