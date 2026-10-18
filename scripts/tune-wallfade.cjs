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

// floor.ts：墙体可淡出（相机退到墙外时，墙挡住视线就透明）
patch('src/world/floor.ts', [
  ['  private torches: TorchEntry[] = []', '  private torches: TorchEntry[] = []\n  /** 墙体材质：相机退到墙外时淡出，避免挡住角色 */\n  private wallMat: THREE.MeshStandardMaterial | null = null'],
  ['    const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.97, metalness: 0.02 })', '    const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.97, metalness: 0.02 })\n    this.wallMat = wallMat'],
  ['  dispose(): void {', `  /** 0 = 实体墙，1 = 完全透明（相机退到墙外时调用） */
  fadeWalls(t: number): void {
    const m = this.wallMat
    if (!m) return
    const k = Math.max(0, Math.min(1, t))
    m.transparent = k > 0.01
    m.opacity = 1 - k
    m.depthWrite = k < 0.5
    m.needsUpdate = true
  }

  dispose(): void {`],
])

// cameraRig：取消“抬高机位”的粗暴方案，回到只按场地收距离
patch('src/systems/cameraRig.ts', [
  [`    if (this.arenaHalf > 0) {
      // 玩家贴边时相机会退到墙外→被墙挡住。处理方式：抬高机位越过墙顶，
      // 同时最多内收 dist-5 米（保证不会贴到脸上），这样永远能看见角色与怪。
      const lim = Math.max(2, this.arenaHalf - 1.2)
      const overX = Math.max(0, Math.abs(this.desired.x) - lim)
      const overZ = Math.max(0, Math.abs(this.desired.z) - lim)
      if (overX > 0 || overZ > 0) {
        this.desired.y += Math.min(18, (overX + overZ) * 1.7)
        const pull = Math.min(overX + overZ, Math.max(0, dist - 5))
        if (pull > 0) {
          const len = Math.hypot(overX, overZ) || 1
          this.desired.x -= Math.sign(this.desired.x - x) * pull * (overX / len)
          this.desired.z -= Math.sign(this.desired.z - z) * pull * (overZ / len)
        }
      }
    }`, ''],
])

// game.ts：每帧计算相机是否退到墙外 → 平滑淡出墙体
patch('src/game.ts', [
  ['  private bonusOffers: TunnelOffer[] = []', '  private bonusOffers: TunnelOffer[] = []\n  private wallFade = 0'],
  [`      this.rig.update(dt, p.x, p.z, this.moveInput.x, this.moveInput.z, this.phase === 'title')`,
   `      this.rig.update(dt, p.x, p.z, this.moveInput.x, this.moveInput.z, this.phase === 'title')
      this.updateWallFade(dt)`],
  ['  private updateAim(): void {', `  /** 相机贴到墙外时把墙淡出，保证永远能看到角色和怪物 */
  private updateWallFade(dt: number): void {
    if (!this.floor) return
    const half = this.floor.halfSize
    const cp = this.camera.position
    const outside =
      Math.abs(cp.x) > half - 0.4 || Math.abs(cp.z) > half - 0.4 || this.camera.position.y > 26
    const target = outside ? 1 : 0
    this.wallFade += (target - this.wallFade) * Math.min(1, dt * 8)
    if (Math.abs(this.wallFade - target) < 0.01) this.wallFade = target
    this.floor.fadeWalls(this.wallFade)
  }

  private updateAim(): void {`],
])

console.log('misses:', miss)
