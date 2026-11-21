/**
 * G3 首领房首帧 Boss 可见性冒烟测试（无浏览器，纯 Node + Vite SSR）：
 *   node sim/g3-boss-visibility-smoke.mjs
 */
import * as THREE from 'three'
import { readFileSync } from 'node:fs'
import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

const { CameraRig } = await server.ssrLoadModule('/src/systems/cameraRig.ts')
const { CONFIG } = await server.ssrLoadModule('/src/data/gameConfig.ts')

let pass = 0
let fail = 0
const fails = []

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1
    console.log(`PASS  ${name}${detail ? `  → ${detail}` : ''}`)
  } else {
    fail += 1
    fails.push({ name, detail })
    console.error(`FAIL  ${name}${detail ? `  → ${detail}` : ''}`)
  }
}

function projectNdc(cam, x, y, z) {
  return new THREE.Vector3(x, y, z).project(cam)
}

try {
  const gameSrc = readFileSync('src/game.ts', 'utf8')
  const bossFnStart = gameSrc.indexOf('private startRoomBossBattle()')
  const bossFnBody = bossFnStart >= 0 ? gameSrc.slice(bossFnStart, bossFnStart + 900) : ''
  check(
    'game.ts startRoomBossBattle 用 -halfSize*0.32 避开地标且不再瞬移玩家',
    bossFnBody.includes('const bossZ = -floor.halfSize * 0.32') &&
      bossFnBody.includes('this.rig.focusIntro(boss.x, boss.z, 0.75)') &&
      !bossFnBody.includes('p.z ='),
  )
  check(
    'game.ts enterRoomMap 统一设定玩家进房站位 p.z = half * 0.42',
    gameSrc.includes('p.z = half * 0.42'),
  )

  for (const halfSize of [15, 18, 22]) {
    const cam = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far)
    const rig = new CameraRig(cam)
    rig.reset()
    rig.setArenaHalf(halfSize)
    rig.fitForArena(halfSize)

    const playerZ = halfSize * 0.42
    const bossZ = -halfSize * 0.32
    const landmarkR = Math.min(3.2, halfSize * 0.2)
    check(
      `halfSize=${halfSize} Boss 出生点避开中央地标碰撞（|bossZ| >= landmarkR + 1.5）`,
      Math.abs(bossZ) >= landmarkR + 1.5,
      `|bossZ|=${Math.abs(bossZ).toFixed(2)}, minClear=${(landmarkR + 1.5).toFixed(2)}`,
    )
    rig.focusIntro(0, bossZ, 0.75)
    rig.update(0.016, 0, playerZ, 0, 0)
    cam.updateMatrixWorld(true)

    const feet = projectNdc(cam, 0, 0, bossZ)
    const mid = projectNdc(cam, 0, 1.4, bossZ)
    const crown = projectNdc(cam, 0, 2.8, bossZ)
    const player = projectNdc(cam, 0, 0.9, playerZ)

    const bossVisible =
      Math.abs(mid.x) < 0.85 &&
      feet.y > -0.85 &&
      crown.y < 0.82 &&
      feet.z < 1 &&
      crown.z < 1
    check(
      `halfSize=${halfSize} 首帧 Boss 全身在 16:9 视锥内且不顶出上沿`,
      bossVisible,
      `feetY=${feet.y.toFixed(2)}, midY=${mid.y.toFixed(2)}, crownY=${crown.y.toFixed(2)}`,
    )
    check(
      `halfSize=${halfSize} 首帧玩家同步可见`,
      Math.abs(player.x) < 0.85 && player.y > -0.9 && player.y < 0.85,
      `playerY=${player.y.toFixed(2)}`,
    )
  }

  {
    const cam = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far)
    const rig = new CameraRig(cam)
    rig.reset()
    rig.setArenaHalf(18)
    rig.fitForArena(18)
    rig.focusIntro(0, -3.24, 0.75)
    for (let i = 0; i < 60; i += 1) rig.update(0.02, 0, 7.56, 0, 0)
    const posAfter = cam.position.clone()

    const camNormal = new THREE.PerspectiveCamera(CONFIG.camera.fov, 16 / 9, CONFIG.camera.near, CONFIG.camera.far)
    const rigNormal = new CameraRig(camNormal)
    rigNormal.reset()
    rigNormal.setArenaHalf(18)
    rigNormal.fitForArena(18)
    for (let i = 0; i < 60; i += 1) rigNormal.update(0.02, 0, 7.56, 0, 0)
    const diff = posAfter.distanceTo(camNormal.position)
    check('进场镜头 0.75s 后平滑收敛回常规战斗跟随', diff < 0.25, `delta=${diff.toFixed(3)}`)
  }
} finally {
  await server.close()
}

console.log(`\n────────────────────────\n共 ${pass + fail} 项，失败 ${fail} 项`)
if (fail > 0) {
  console.error('失败项：')
  for (const f of fails) console.error(` - ${f.name}  ${f.detail}`)
  process.exit(1)
}
console.log('全部通过 ✅')
