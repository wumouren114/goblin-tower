import fs from 'node:fs'

const bp = 'src/data/balance.json'
const b = JSON.parse(fs.readFileSync(bp, 'utf8'))
const c = b.layerCurve
c.clearGoldBase = 60
c.clearGoldPerLayer = 14
c.goldPerKillEveryLayers = 4
b.portals.chestGoldBase = 80
b.portals.chestGoldPerLayer = 14
fs.writeFileSync(bp, JSON.stringify(b, null, 2) + '\n')

const sp = 'sim/simulate.mjs'
let s = fs.readFileSync(sp, 'utf8')
s = s.replace('st.gold += Math.round((90 + 15 * layer) * diff.goldMul)', 'st.gold += Math.round((130 + 22 * layer) * diff.goldMul)')
fs.writeFileSync(sp, s)
console.log('income boosted')
