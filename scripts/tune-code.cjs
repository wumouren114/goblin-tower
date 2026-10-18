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

// ── stages.ts：道具数量下调 45%（让走位更顺、远程视野更干净）──
patch('src/data/stages.ts', [
  ['props: 28', 'props: 15'],
  ['props: 30', 'props: 17'],
  ['props: 24', 'props: 13'],
  ['props: 34', 'props: 19'],
  ['props: 36', 'props: 20'],
  ['props: 30', 'props: 17'],
  ['props: 40', 'props: 22'],
  ['props: 42', 'props: 23'],
  ['props: 24', 'props: 16'],
])

// ── cameraRig：相机永远留在墙内，避免南墙挡住角色 ──
patch('src/systems/cameraRig.ts', [
  ['  private initialised = false', '  private initialised = false\n  /** 场地半边长：相机不许退到墙外 */\n  private arenaHalf = 0'],
  ['  /** 按场地半边长收紧镜头距离，避免相机退到墙外被遮挡 */', `  setArenaHalf(halfSize: number): void {
    this.arenaHalf = halfSize
  }

  /** 按场地半边长收紧镜头距离，避免相机退到墙外被遮挡 */`],
  [`    this.desired.set(x + Math.sin(yaw) * dist, height, z + Math.cos(yaw) * dist)`, `    this.desired.set(x + Math.sin(yaw) * dist, height, z + Math.cos(yaw) * dist)
    if (this.arenaHalf > 0) {
      // 相机被墙挡住是第三人称最常见的穿帮：把机位夹在墙内侧
      const lim = Math.max(2, this.arenaHalf - 1.2)
      this.desired.x = THREE.MathUtils.clamp(this.desired.x, -lim, lim)
      this.desired.z = THREE.MathUtils.clamp(this.desired.z, -lim, lim)
    }`],
])

// ── player：攻击时朝准星转向 ──
patch('src/entities/player.ts', [
  ['  private lastInputX = 0', `  /** 攻击/技能时朝世界坐标转向（自动索敌用） */
  faceToward(wx: number, wz: number): void {
    const dx = wx - this.x
    const dz = wz - this.z
    if (dx * dx + dz * dz < 0.0001) return
    const c = Math.cos(this.cameraYawCache)
    const s = Math.sin(this.cameraYawCache)
    this.faceFromInput(dx * c - dz * s, -dx * s - dz * c)
  }

  private cameraYawCache = 0
  private lastInputX = 0`],
  ['    setBillboardYaw(cameraYaw)', '    setBillboardYaw(cameraYaw)\n    this.cameraYawCache = cameraYaw'],
])

// ── game：自动索敌 + 每层清怪后三选一卡 ──
patch('src/game.ts', [
  // 自动索敌
  [`    const attackHeld = this.autoPlay || this.input.attackHeld
    if (attackHeld && this.combat) {
      this.combat.tryAttack(dt, p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld())
    }`, `    // 自动索敌：攻击与技能自动朝向最近的敌人（移动方向不受影响）
    const lockOn = this.nearestEnemy(p.x, p.z, 16)
    if (lockOn) this.aimPoint.set(lockOn.x, 0.6, lockOn.z)

    const attackHeld = this.autoPlay || this.input.attackHeld
    if (attackHeld && this.combat) {
      p.faceToward(this.aimPoint.x, this.aimPoint.z)
      this.combat.tryAttack(dt, p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld())
    }`],
  [`    if (this.input.consumeSkill() && this.combat) {
      if (this.combat.trySkill(`, `    if (this.input.consumeSkill() && this.combat) {
      p.faceToward(this.aimPoint.x, this.aimPoint.z)
      if (this.combat.trySkill(`],
  // nearestEnemy 支持射程
  [`  private nearestEnemy(x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestD = Infinity
    for (const g of this.goblins) {
      if (!g.alive) continue
      const d = (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z)
      if (d < bestD) {`, `  private nearestEnemy(x: number, z: number, maxDist = 999): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestD = maxDist * maxDist
    for (const g of this.goblins) {
      if (!g.alive) continue
      const d = (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z)
      if (d < bestD) {`],
  // 清层后先三选一卡，再传送门
  [`    audio.stairs()
    this.vfx.levelUpBurst(this.player?.x ?? 0, this.player?.z ?? 0)
    this.openTunnels()`, `    audio.stairs()
    this.vfx.levelUpBurst(this.player?.x ?? 0, this.player?.z ?? 0)
    this.openBonusCards()`],
  [`      this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
      this.openTunnels()`, `      this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
      this.openBonusCards()`],
])

console.log('misses:', miss)
