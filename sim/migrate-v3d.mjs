import fs from 'node:fs'

const bp = 'src/data/balance.json'
const b = JSON.parse(fs.readFileSync(bp, 'utf8'))
b.difficulties.hard.hpMul = 1.35
b.difficulties.hard.damageMul = 1.35
fs.writeFileSync(bp, JSON.stringify(b, null, 2) + '\n')

const sp = 'sim/simulate.mjs'
let s = fs.readFileSync(sp, 'utf8')
s = s.replace('exposure: 1.55', 'exposure: 1.45')
fs.writeFileSync(sp, s)
console.log('hard 1.35/1.35, murasame exposure 1.45')
