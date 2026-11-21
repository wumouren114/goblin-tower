/**
 * 试玩矩阵结果分析器：读 sim/playtest-matrix.json，输出报告用的聚合表。
 * 运行：node sim/playtest-analyze.mjs [--json]
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

const FILE = path.resolve(process.cwd(), 'sim/playtest-matrix.json')
const runs = JSON.parse(readFileSync(FILE, 'utf8'))
const RAW = process.argv.includes('--json')

const TOTAL = { easy: 9, normal: 16, hard: 18 }
const DIFF_NAME = { easy: '简单', normal: '普通', hard: '困难' }
const CHAR_NAME = { mutsumi: '若叶睦', murasame: '丛雨', fish: '大肥鱼' }
const OUTCOME = { victory: '通关', dead: '阵亡', timeout: '超时', error: '异常' }

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const round = (v, n = 1) => Math.round(v * 10 ** n) / 10 ** n
const pct = (v) => `${Math.round(v * 100)}%`

function group(keyFn) {
  const map = new Map()
  for (const r of runs) {
    const k = keyFn(r)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(r)
  }
  return map
}

const lines = []
const out = (s = '') => {
  lines.push(s)
  console.log(s)
}

out('## A. 难度 × 结局')
out('| 难度 | 局数 | 通关 | 通关率 | 平均到达层 | 死亡层 | 平均游戏时长 | 平均承伤 |')
out('| --- | :-: | :-: | :-: | :-: | --- | :-: | :-: |')
for (const d of ['easy', 'normal', 'hard']) {
  const rs = runs.filter((r) => r.diff === d)
  const wins = rs.filter((r) => r.outcome === 'victory')
  const deaths = rs.filter((r) => r.outcome !== 'victory').map((r) => `L${r.layer}`)
  out(
    `| ${DIFF_NAME[d]}（${TOTAL[d]} 层） | ${rs.length} | ${wins.length} | ${pct(wins.length / rs.length)} | ` +
      `${round(avg(rs.map((r) => r.layer)))} | ${deaths.join(' / ') || '—'} | ${round(avg(rs.map((r) => r.gameTime)), 0)}s | ${round(avg(rs.map((r) => r.dmgTaken)), 0)} |`,
  )
}

out('')
out('## B. 角色 × 难度（每格 2 局）')
out('| 角色 | 难度 | 结局 | 到达层 | 承伤 / 挨打次数 | 最大单次 | 击杀 | 终局金币 | 潜能节点 | 用时 |')
out('| --- | --- | --- | :-: | --- | :-: | :-: | :-: | :-: | :-: |')
for (const c of ['mutsumi', 'murasame', 'fish']) {
  for (const d of ['easy', 'normal', 'hard']) {
    const rs = runs.filter((r) => r.char === c && r.diff === d)
    const tag = rs.map((r) => OUTCOME[r.outcome] ?? r.outcome).join('/')
    out(
      `| ${CHAR_NAME[c]} | ${DIFF_NAME[d]} | ${tag} | ${rs.map((r) => `L${r.layer}`).join('/')} | ` +
        `${rs.map((r) => `${r.dmgTaken}/${r.hits}`).join(' / ')} | ${rs.map((r) => r.maxHit).join('/')} | ` +
        `${rs.map((r) => r.kills).join('/')} | ${rs.map((r) => r.gold).join('/')} | ${rs.map((r) => r.nodes).join('/')} | ` +
        `${rs.map((r) => r.gameTime + 's').join('/')} |`,
    )
  }
}

out('')
out('## C. 角色聚合强度')
out('| 角色 | 通关 | 平均到达层 | 平均承伤 | 平均击杀 | 平均游戏时长 | 平均终局金币 |')
out('| --- | :-: | :-: | :-: | :-: | :-: | :-: |')
for (const c of ['mutsumi', 'murasame', 'fish']) {
  const rs = runs.filter((r) => r.char === c)
  out(
    `| ${CHAR_NAME[c]} | ${rs.filter((r) => r.outcome === 'victory').length}/${rs.length} | ${round(avg(rs.map((r) => r.layer)))} | ` +
      `${round(avg(rs.map((r) => r.dmgTaken)), 0)} | ${round(avg(rs.map((r) => r.kills)), 0)} | ${round(avg(rs.map((r) => r.gameTime)), 0)}s | ${round(avg(rs.map((r) => r.gold)), 0)} |`,
  )
}

out('')
out('## D. 每局是否有「层内清怪配额」战斗（关卡逻辑审计）')
let quotaBattleRuns = 0
const quotaBattlesByLayer = new Map()
const battlesPerRun = []
for (const r of runs) {
  const bs = r.battles ?? []
  if (bs.length) quotaBattleRuns += 1
  battlesPerRun.push(bs.length)
  for (const b of bs) quotaBattlesByLayer.set(b.layer, (quotaBattlesByLayer.get(b.layer) ?? 0) + 1)
}
out(`- 18 局中，出现「层内配额战斗」的局数：**${quotaBattleRuns}/18**`)
out(`- 每局配额战斗层数：${[...new Set(battlesPerRun)].join(' / ')}（期望应等于该难度总层数减 Boss 层）`)
out(`- 出现配额战斗的层号分布：${[...quotaBattlesByLayer.entries()].map(([l, n]) => `L${l}×${n}`).join('，')}`)
out('')
out('| 局 | 层1配额/清怪秒数 | 其余层的战斗来源 |')
out('| --- | --- | --- |')
for (const r of runs) {
  const q = (r.battles ?? []).find((b) => b.layer === 1)
  const others = (r.rooms ?? []).filter((x) => ['mob-wave', 'elite-fight', 'boss'].includes(x.room)).length
  out(`| ${r.tag} | ${q ? `${q.total} 只 / ${q.end - q.start}s` : '—'} | 隧道房间战 ${others} 次（无层内刷怪） |`)
}

out('')
out('## E. 房间类型分布与耗时')
const roomStats = new Map()
for (const r of runs) {
  for (const room of r.rooms ?? []) {
    if (!roomStats.has(room.room)) roomStats.set(room.room, { n: 0, secs: [], hp: [] })
    const s = roomStats.get(room.room)
    s.n += 1
    if (typeof room.secs === 'number') s.secs.push(room.secs)
    if (typeof room.hpBefore === 'number' && typeof room.hpAfter === 'number') s.hp.push(room.hpBefore - room.hpAfter)
  }
}
out('| 房间 | 出现次数 | 平均耗时 | 平均净掉血 | 日志最长耗时 |')
out('| --- | :-: | :-: | :-: | :-: |')
for (const [room, s] of [...roomStats.entries()].sort((a, b) => b[1].n - a[1].n)) {
  out(`| ${room} | ${s.n} | ${s.secs.length ? round(avg(s.secs)) + 's' : '—（非战斗房）'} | ${s.hp.length ? round(avg(s.hp)) : '—'} | ${s.secs.length ? Math.max(...s.secs) + 's' : '—'} |`)
}

out('')
out('## F. Boss 战（每局最后一次 Boss 房）')
out('| 局 | Boss 层 | Boss 战耗时 | 进战血量 → 结束血量 | 剩余血量比 |')
out('| --- | :-: | :-: | --- | :-: |')
for (const r of runs) {
  const bosses = (r.rooms ?? []).filter((x) => x.room === 'boss')
  if (!bosses.length) continue
  const b = bosses[bosses.length - 1]
  const ratio = typeof b.hpAfter === 'number' && r.maxHp ? Math.round((b.hpAfter / r.maxHp) * 100) : null
  out(`| ${r.tag} | L${b.layer} | ${b.secs ?? '?'}s | ${b.hpBefore} → ${b.hpAfter} | ${ratio == null ? '—' : ratio + '%'} |`)
}

out('')
out('## G. 成长与资源（可玩性）')
const fUnlock = runs.filter((r) => (r.nodes ?? 0) >= 2).length
const oneNode = runs.filter((r) => (r.nodes ?? 0) < 2).length
out(`- F 通用动作解锁（潜能节点 ≥2）的局数：**${fUnlock}/18**；仅 1 个节点（F 未解锁）的局：**${oneNode}/18**`)
out(`- 商店类房间（merchant）出现次数：${roomStats.get('merchant')?.n ?? 0}；休憩营地：${roomStats.get('rest')?.n ?? 0}；小游戏：${roomStats.get('minigame')?.n ?? 0}；事件：${roomStats.get('event')?.n ?? 0}；祭坛：${roomStats.get('altar')?.n ?? 0}；考验：${roomStats.get('trial')?.n ?? 0}`)
out(`- 终局金币：平均 ${round(avg(runs.map((r) => r.gold)), 0)}，最高 ${Math.max(...runs.map((r) => r.gold))}（通关局：${runs.filter((r) => r.outcome === 'victory').map((r) => r.gold).join('/')}）`)
out(`- 金币训练购买次数：${runs.map((r) => r.trainingBuys).join('/')}`)
out('')
out('| 局 | 潜能路线 | 节点 | 背包物品 | 属性卡汇总 | 商店到访 |')
out('| --- | --- | :-: | :-: | --- | :-: |')
for (const r of runs) {
  const cardStr = r.cards
    ? Object.entries(r.cards)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => `${k}+${v}`)
        .join(' ') || '—'
    : '—'
  out(`| ${r.tag} | ${(r.potentialLog ?? []).join(' → ') || '—'} | ${r.nodes ?? 0} | ${(r.inventory ?? []).length} | ${cardStr} | ${r.shopVisits ?? 0} |`)
}

if (RAW) out('```json\n' + JSON.stringify(runs, null, 2) + '\n```')
