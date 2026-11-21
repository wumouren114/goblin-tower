/**
 * G2c 纯 Node 刷怪分布探针：按 src/game.ts spawnOne() 同口径抽样 500 只常规怪
 * 运行：node sim/probe-spawn.mjs
 */
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const { Rng } = await server.ssrLoadModule('/src/core/rng.ts')

function rollKind(layer, r) {
  const bruteChance = Math.min(0.28, 0.04 + (layer - 1) * 0.05)
  const eliteChance = layer >= 4 ? 0.08 : 0
  const casterChance = layer >= 2 ? Math.min(0.16, 0.07 + (layer - 2) * 0.015) : 0
  const spearChance = layer >= 2 ? Math.min(0.2, 0.08 + (layer - 2) * 0.02) : 0
  const bomberChance = layer >= 3 ? Math.min(0.16, 0.05 + (layer - 3) * 0.018) : 0
  const blockerChance = layer >= 4 ? Math.min(0.14, 0.04 + (layer - 4) * 0.02) : 0
  const summonerChance = layer >= 5 ? Math.min(0.12, 0.04 + (layer - 5) * 0.02) : 0
  if (r < eliteChance) return 'elite'
  if (r < eliteChance + casterChance) return 'caster'
  if (r < eliteChance + casterChance + spearChance) return 'spear'
  if (r < eliteChance + casterChance + spearChance + bomberChance) return 'bomber'
  if (r < eliteChance + casterChance + spearChance + bomberChance + blockerChance) return 'blocker'
  if (r < eliteChance + casterChance + spearChance + bomberChance + blockerChance + summonerChance) return 'summoner'
  if (r < eliteChance + casterChance + spearChance + bomberChance + blockerChance + summonerChance + bruteChance) return 'brute'
  return 'small'
}

const KINDS = ['small', 'brute', 'caster', 'spear', 'bomber', 'blocker', 'summoner', 'elite']
const N = 500

try {
  console.log(`spawnOne() 抽样分布（每层 N=${N}）`)
  console.log('Layer | ' + KINDS.map((k) => k.padStart(9)).join(' | '))
  console.log('------+----------------------------------------------------------------------------------------')
  for (const layer of [3, 5, 7, 10]) {
    const rng = new Rng(20261121 + layer * 97)
    const counts = Object.fromEntries(KINDS.map((k) => [k, 0]))
    for (let i = 0; i < N; i += 1) counts[rollKind(layer, rng.next())] += 1
    const cols = KINDS.map((k) => `${((counts[k] / N) * 100).toFixed(1)}%`.padStart(9))
    console.log(`  L${String(layer).padStart(2)} | ` + cols.join(' | '))
  }
} finally {
  await server.close()
}
