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

// ── balance.json：整体降难度 + 提速 ──
patch('src/data/balance.json', [
  ['"layerTimerSeconds": 60', '"layerTimerSeconds": 70'],
  ['"bossTimerSeconds": 90', '"bossTimerSeconds": 100'],
  // easy
  [`      "hpMul": 0.85,
      "damageMul": 0.7,`, `      "hpMul": 0.7,
      "damageMul": 0.55,`],
  // normal
  [`      "hpMul": 1.05,
      "damageMul": 1,`, `      "hpMul": 0.85,
      "damageMul": 0.72,`],
  // hard
  [`      "hpMul": 1.35,
      "damageMul": 1.35,`, `      "hpMul": 1.15,
      "damageMul": 1.05,`],
  ['"mobHpBase": 30', '"mobHpBase": 23'],
  ['"mobHpPerLayer": 0.55', '"mobHpPerLayer": 0.45'],
  ['"mobDamageBase": 6', '"mobDamageBase": 5'],
  ['"mobDamagePerLayer": 0.2', '"mobDamagePerLayer": 0.16'],
  ['"bossHpBase": 520', '"bossHpBase": 440'],
  ['"bossHpPerLayer": 0.55', '"bossHpPerLayer": 0.45'],
])

// ── characters.ts：充能更快、单体攻速更快、丛雨更肉 ──
patch('src/data/characters.ts', [
  [`export const CHARGE_PER_KILL = {
  small: 6,
  brute: 9,
  elite: 25,
  boss: 60,
} as const`, `export const CHARGE_PER_KILL = {
  small: 10,
  brute: 14,
  elite: 34,
  boss: 80,
} as const`],
  ['export const CHARGE_FLOOR_START_RATIO = 0.5', 'export const CHARGE_FLOOR_START_RATIO = 0.6'],
  // 若叶睦：耐力 100→135（攻击间隔 0.55→0.41s）
  ['base: { hp: 110, chargeMax: 100, stamina: 100, magic: 100, intelligence: 100, moveSpeed: 6.2 }',
   'base: { hp: 110, chargeMax: 100, stamina: 135, magic: 100, intelligence: 100, moveSpeed: 6.2 }'],
  // 丛雨：血更厚、移速略快、技能更便宜更能回
  ['base: { hp: 135, chargeMax: 90, stamina: 130, magic: 95, intelligence: 70, moveSpeed: 7.0 }',
   'base: { hp: 175, chargeMax: 80, stamina: 130, magic: 95, intelligence: 70, moveSpeed: 7.3 }'],
  ['      chargeCost: 90,\n      kind: \'dash\',', '      chargeCost: 80,\n      kind: \'dash\','],
  ['        heal: 15,', '        heal: 22,'],
  // 肥鱼：耐力 140→180（间隔 0.39→0.31s）、充能上限 110→90、技能更快
  ['base: { hp: 95, chargeMax: 110, stamina: 140, magic: 80, intelligence: 110, moveSpeed: 6.6 }',
   'base: { hp: 110, chargeMax: 90, stamina: 180, magic: 80, intelligence: 110, moveSpeed: 6.6 }'],
  ['      chargeCost: 110,\n      kind: \'summon\',', '      chargeCost: 90,\n      kind: \'summon\','],
])

console.log('misses:', miss)
