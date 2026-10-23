// 原画资产自检：确认 assets/art_raw 里的图齐全、尺寸与游戏代码约定一致。
// 只读 PNG 头（IHDR），不需要浏览器/Pillow；在 CI 或改图后跑一次即可。
// 用法：node scripts/check-art.mjs
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'assets', 'art_raw')

/** 归一化后的规格：图集按 cols/rows/cell，单图按宽高 */
const SHEETS = {
  'char_mutsumi.png': { w: 640, h: 400, cols: 10, rows: 5 },
  'char_murasame.png': { w: 640, h: 400, cols: 10, rows: 5 },
  'char_fish.png': { w: 640, h: 400, cols: 10, rows: 5 },
  'boss_king.png': { w: 576, h: 448, cols: 6, rows: 4 },
}

const SINGLES = {
  'keyart_title.png': [1920, 1080],
  'prop_crate.png': [40, 40],
  'prop_barrel.png': [40, 48],
  'prop_pillar.png': [32, 64],
  'prop_crystal.png': [40, 56],
  'pickup_coin.png': [16, 16],
  'pickup_heart.png': [16, 16],
  'pickup_rice.png': [16, 16],
  'pickup_card.png': [20, 28],
  'proj_cucumber.png': [20, 10],
  'proj_bubble.png': [24, 24],
  'proj_wave.png': [32, 32],
  'proj_slash.png': [48, 48],
  'proj_orbfire.png': [24, 24],
  'fx_ring.png': [64, 64],
  'fx_glow.png': [32, 32],
  'portrait_mutsumi.png': [512, 512],
  'portrait_mortis.png': [128, 128],
  'portrait_murasame.png': [512, 512],
  'portrait_fish.png': [512, 512],
  'portrait_boss.png': [192, 192],
  'icon_weapon_mutsumi.png': [32, 32],
  'icon_weapon_murasame.png': [32, 32],
  'icon_weapon_fish.png': [32, 32],
  'icon_card_magic.png': [32, 32],
  'icon_card_stamina.png': [32, 32],
  'icon_card_intelligence.png': [32, 32],
  'icon_card_hp.png': [32, 32],
  'icon_card_moveSpeed.png': [32, 32],
  'icon_card_charge.png': [32, 32],
  'icon_card_armor.png': [32, 32],
  'icon_card_dodge.png': [32, 32],
  'icon_card_crit.png': [32, 32],
}

function pngSize(file) {
  const buf = readFileSync(file)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) throw new Error('不是 PNG')
  if (buf.toString('ascii', 12, 16) !== 'IHDR') throw new Error('IHDR 缺失')
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

let ok = 0
let bad = 0
const fail = (msg) => {
  bad++
  console.error('  ✗ ' + msg)
}

for (const [name, spec] of Object.entries(SHEETS)) {
  const file = path.join(DIR, name)
  if (!existsSync(file)) {
    fail(`${name} 缺失（先跑 python scripts/art-normalize.py）`)
    continue
  }
  const { w, h } = pngSize(file)
  if (w !== spec.w || h !== spec.h) {
    fail(`${name} 尺寸 ${w}x${h} != ${spec.w}x${spec.h}`)
    continue
  }
  if (w % spec.cols !== 0 || h % spec.rows !== 0) {
    fail(`${name} 不能等分 ${spec.cols}x${spec.rows}`)
    continue
  }
  console.log(`  ✓ ${name} ${w}x${h}  ${spec.cols}x${spec.rows} 格 ${w / spec.cols}x${h / spec.rows}`)
  ok++
}

for (const [name, [w, h]] of Object.entries(SINGLES)) {
  const file = path.join(DIR, name)
  if (!existsSync(file)) {
    fail(`${name} 缺失`)
    continue
  }
  const size = pngSize(file)
  if (size.w !== w || size.h !== h) {
    fail(`${name} 尺寸 ${size.w}x${size.h} != ${w}x${h}`)
    continue
  }
  ok++
}

const total = Object.keys(SHEETS).length + Object.keys(SINGLES).length
console.log(`\n${bad === 0 ? '✅' : '❌'} 原画自检：${ok}/${total} 通过${bad ? `，${bad} 个问题` : ''}`)
process.exit(bad === 0 ? 0 : 1)
