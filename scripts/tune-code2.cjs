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

// stages.ts：按 halfSize 唯一锚点下调道具数量（约 -45%）
patch('src/data/stages.ts', [
  ['halfSize: 15,\n      props: 28', 'halfSize: 15,\n      props: 15'],
  ['halfSize: 16,\n      props: 30', 'halfSize: 16,\n      props: 17'],
  ['halfSize: 14,\n      props: 24', 'halfSize: 14,\n      props: 13'],
  ['halfSize: 18,\n      props: 34', 'halfSize: 18,\n      props: 19'],
  ['halfSize: 19,\n      props: 36', 'halfSize: 19,\n      props: 20'],
  ['halfSize: 17,\n      props: 30', 'halfSize: 17,\n      props: 17'],
  ['halfSize: 21,\n      props: 40', 'halfSize: 21,\n      props: 21'],
  ['halfSize: 22,\n      props: 42', 'halfSize: 22,\n      props: 22'],
  ['halfSize: 24,\n      props: 24', 'halfSize: 24,\n      props: 14'],
])

// cameraRig：相机留在墙内
patch('src/systems/cameraRig.ts', [
  ['  private initialised = false', '  private initialised = false\n  /** 场地半边长：相机不许退到墙外 */\n  private arenaHalf = 0'],
  ['  /** 按场地半边长收紧镜头距离，避免相机退到墙外被遮挡 */', `  setArenaHalf(halfSize: number): void {
    this.arenaHalf = halfSize
  }

  /** 按场地半边长收紧镜头距离，避免相机退到墙外被遮挡 */`],
  ['    this.desired.set(x + Math.sin(yaw) * dist, height, z + Math.cos(yaw) * dist)', `    this.desired.set(x + Math.sin(yaw) * dist, height, z + Math.cos(yaw) * dist)
    if (this.arenaHalf > 0) {
      // 相机被墙挡住是第三人称最常见的穿帮：把机位夹在墙内侧
      const lim = Math.max(2, this.arenaHalf - 1.2)
      this.desired.x = THREE.MathUtils.clamp(this.desired.x, -lim, lim)
      this.desired.z = THREE.MathUtils.clamp(this.desired.z, -lim, lim)
    }`],
])

// player：攻击时朝准星转向
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

// game：自动索敌 + 清层后三选一卡
patch('src/game.ts', [
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
  [`  private nearestEnemy(x: number, z: number): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestD = Infinity`, `  private nearestEnemy(x: number, z: number, maxDist = 999): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestD = maxDist * maxDist`],
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
