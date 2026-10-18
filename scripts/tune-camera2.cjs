const fs = require('fs')
let c = fs.readFileSync('src/systems/cameraRig.ts', 'utf8')
const miss = []
const rep = (a, b) => {
  if (!c.includes(a)) { miss.push(a.slice(0, 60)); return }
  c = c.split(a).join(b)
}

rep(
  `    if (this.arenaHalf > 0) {
      // 相机被墙挡住是第三人称最常见的穿帮：把机位夹在墙内侧
      const lim = Math.max(2, this.arenaHalf - 1.2)
      this.desired.x = THREE.MathUtils.clamp(this.desired.x, -lim, lim)
      this.desired.z = THREE.MathUtils.clamp(this.desired.z, -lim, lim)
    }`,
  `    if (this.arenaHalf > 0) {
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
    }`,
)
fs.writeFileSync('src/systems/cameraRig.ts', c)
console.log('miss', miss)
