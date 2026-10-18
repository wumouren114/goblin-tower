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

patch('src/game.ts', [
  ['  private mortisVisual = false', `  private mortisVisual = false
  private bonusOffers: TunnelOffer[] = []
  private bonusActive = false`],
  [`  private openTunnels(): void {`, `  private cardIcon(stat: CardStat): string {
    const table: Record<string, string> = {
      magic: '✨',
      stamina: '⚡',
      intelligence: '🔮',
      hp: '❤️',
      moveSpeed: '👟',
      chargeMax: '🔋',
      armor: '🛡️',
      dodge: '💨',
      chargeGain: '🎯',
    }
    return table[stat] ?? '🎴'
  }

  /** 每层清空后：先三选一拿一张增益卡，再开时空隧道 */
  private openBonusCards(): void {
    const pool = [...BALANCE.buffCards]
    this.bonusOffers = []
    for (let i = 0; i < 3 && pool.length > 0; i += 1) {
      const idx = this.rng.int(0, pool.length - 1)
      const card = pool.splice(idx, 1)[0]
      this.bonusOffers.push({
        id: \`bonus-\${i}\`,
        kind: 'reward',
        room: 'skill-card',
        title: card.name,
        desc: card.desc,
        icon: this.cardIcon(card.stat),
        payload: {
          skillCard: { id: card.id, name: card.name, desc: card.desc, stat: card.stat as CardStat, value: card.value },
        },
      })
    }
    if (this.bonusOffers.length === 0) {
      this.openTunnels()
      return
    }
    this.bonusActive = true
    this.phase = 'tunnel'
    this.hud.showTunnelOffers(this.bonusOffers, this.run.layer)
    audio.levelUp()
  }

  private openTunnels(): void {`],
  // 隧道入口先处理「清层奖励卡」
  [`  pickTunnel(id: string): void {
    if (this.phase !== 'tunnel') return`, `  pickTunnel(id: string): void {
    if (this.phase !== 'tunnel') return
    if (this.bonusActive) {
      const pick = this.bonusOffers.find((o) => o.id === id)
      if (!pick) return
      this.bonusActive = false
      this.bonusOffers = []
      this.hud.hideTunnels()
      audio.click()
      const card = pick.payload.skillCard
      if (card) {
        const item = makeCardItem(card.stat, 1)
        item.value = card.value
        if (this.inventory.add(item)) {
          this.syncCards()
          this.hud.toast(\`清层奖励：\${item.name}\`, 'good')
        } else {
          this.hud.toast('背包已满，奖励卡丢失', 'bad')
        }
      }
      this.openTunnels()
      return
    }`],
  // 相机场地半边长
  ['    this.rig.fitForArena(half)', '    this.rig.setArenaHalf(half)\n    this.rig.fitForArena(half)'],
])

let m = fs.readFileSync('src/main.ts', 'utf8')
if (!m.includes("params.get('px')")) {
  m = m.replace(
    '    if (params.get(\'autoattack\') === \'1\') game.debugAutoAttack(true)',
    `    if (params.get('px') || params.get('pz')) {
      const g = (window as any).__goblinTower
      if (g?.player) {
        g.player.x = Number(params.get('px') ?? 0)
        g.player.z = Number(params.get('pz') ?? 0)
      }
    }
    if (params.get('autoattack') === '1') game.debugAutoAttack(true)`,
  )
  fs.writeFileSync('src/main.ts', m)
}
console.log('misses:', miss)
