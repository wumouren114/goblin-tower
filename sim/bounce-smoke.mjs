/**
 * 弹道撞障碍反射（交响·折射）纯逻辑冒烟测试：
 *   node sim/bounce-smoke.mjs
 */
import { register } from 'node:module'

const loaderSource = `
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../')
  if (relative && context.parentURL && !/\\.[a-z0-9]+$/i.test(specifier)) {
    const base = new URL(specifier, context.parentURL)
    for (const ext of ['.ts', '/index.ts']) {
      const candidate = new URL(base.href + ext)
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
`
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`)

const { reflectOffObstacle } = await import('../src/systems/bounce.ts')

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function near(a, b, eps = 1e-6, msg = '') {
  if (Math.abs(a - b) > eps) throw new Error(`${msg} 期望 ${b}，实际 ${a}`)
}

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed += 1
    console.error(`  ✗ ${name} → ${err.message}`)
  }
}

console.log('\n弹道撞障碍反射 · bounce-smoke')

test('斜向入射 → 入射角等于出射角（法线两侧对称）', () => {
  const ob = { x: 0, z: 0, r: 1.0 }
  // 命中左上 45° 表面（法线 (-√2/2, -√2/2)），沿 +x 水平入射
  const s = Math.SQRT1_2
  const px = -s * 1.15
  const pz = -s * 1.15
  const res = reflectOffObstacle(1, 0, px, pz, ob)
  assert(res !== null, '应命中障碍')
  const nx = px / Math.hypot(px, pz)
  const nz = pz / Math.hypot(px, pz)
  const cosIn = -(1 * nx + 0 * nz)
  const cosOut = res.dirX * nx + res.dirZ * nz
  near(cosIn, cosOut, 1e-6, '入射角与出射角余弦应相等')
  // 法线 (-s,-s)，+x 反射后应沿 -z (0, -1)
  near(res.dirX, 0, 1e-6, 'dirX')
  near(res.dirZ, -1, 1e-6, 'dirZ')
})

test('垂直正碰 → 方向完全反向', () => {
  const ob = { x: 5, z: 2, r: 1.0 }
  const res = reflectOffObstacle(1, 0, 3.85, 2, ob)
  assert(res !== null, '应命中障碍')
  near(res.dirX, -1, 1e-6, 'dirX 应反向')
  near(res.dirZ, 0, 1e-6, 'dirZ 应保持 0')
})

test('掠过或正在离开障碍（dot >= 0）→ 返回 null', () => {
  const ob = { x: 0, z: 0, r: 1.0 }
  // 位于右侧 (+1.1, 0)，法线 (+1, 0)
  // 1) 沿 +x 离开（dot = +1）
  assert(reflectOffObstacle(1, 0, 1.1, 0, ob) === null, '离开障碍不应反射')
  // 2) 沿 +z 切向掠过（dot = 0）
  assert(reflectOffObstacle(0, 1, 1.1, 0, ob) === null, '切向掠过（dot=0）不应反射')
})

test('距离太远（dist > r+0.25）或圆心重合（dist < 1e-4）→ 返回 null', () => {
  const ob = { x: 2, z: -3, r: 1.2 }
  assert(reflectOffObstacle(1, 0, 2 - 1.46, -3, ob) === null, '距离 > r+0.25 不应命中')
  assert(reflectOffObstacle(1, 0, 2, -3, ob) === null, '圆心完全重合应返回 null')
  assert(reflectOffObstacle(1, 0, 2 + 5e-5, -3, ob) === null, 'dist < 1e-4 应返回 null')
})

test('反射后位置恰被推出到圆心 + 法线 × (r + 0.3)', () => {
  const ob = { x: -3, z: 4, r: 1.5 }
  const angle = Math.PI / 6
  const px = ob.x + Math.cos(angle) * (ob.r + 0.1)
  const pz = ob.z + Math.sin(angle) * (ob.r + 0.1)
  const res = reflectOffObstacle(-Math.cos(angle), -Math.sin(angle), px, pz, ob)
  assert(res !== null, '应命中障碍')
  const outDist = Math.hypot(res.x - ob.x, res.z - ob.z)
  near(outDist, ob.r + 0.3, 1e-6, '推出距离应为 r + 0.3')
  near(res.x, ob.x + Math.cos(angle) * (ob.r + 0.3), 1e-6, 'x 坐标')
  near(res.z, ob.z + Math.sin(angle) * (ob.r + 0.3), 1e-6, 'z 坐标')
})

test('镜面反射后方向向量模长守恒（|dir| = 1）', () => {
  const ob = { x: 0, z: 0, r: 1.0 }
  for (const deg of [0, 17, 35, 45, 62, 78]) {
    const rad = (deg * Math.PI) / 180
    const dx = Math.cos(rad)
    const dz = Math.sin(rad)
    const res = reflectOffObstacle(dx, dz, -1.1, -0.3, ob)
    if (!res) continue
    near(Math.hypot(res.dirX, res.dirZ), 1, 1e-6, `deg=${deg} 反射后模长不为 1`)
  }
})

test('多个障碍重叠时按顺序取第一个命中', () => {
  const obs = [
    { x: 0, z: 0, r: 1.0 },
    { x: 0, z: 1.6, r: 1.0 },
  ]
  const px = -0.8
  const pz = 0.8
  const dirX = Math.SQRT1_2
  const dirZ = -Math.SQRT1_2
  let chosen = -1
  let hitRes = null
  for (let i = 0; i < obs.length; i += 1) {
    const r = reflectOffObstacle(dirX, dirZ, px, pz, obs[i])
    if (r) {
      chosen = i
      hitRes = r
      break
    }
  }
  assert(chosen === 0 && hitRes !== null, '应命中第 0 个障碍')
  near(Math.hypot(hitRes.x - obs[0].x, hitRes.z - obs[0].z), obs[0].r + 0.3, 1e-6, '应按第 0 个障碍推出')
})

test('边界阈值：dist = r+0.25 内命中，超出即未命中', () => {
  const ob = { x: 0, z: 0, r: 1.0 }
  assert(reflectOffObstacle(1, 0, -(1.25 - 1e-6), 0, ob) !== null, 'r+0.25-eps 应命中')
  assert(reflectOffObstacle(1, 0, -(1.25 + 1e-6), 0, ob) === null, 'r+0.25+eps 不应命中')
})

test('接线回归：wallBounce=2 在两障碍间连续折返 2 次后停止折返', () => {
  const obs = [
    { x: 3, z: 0, r: 1.0 },
    { x: -3, z: 0, r: 1.0 },
  ]
  const p = { x: 0, z: 0, dirX: 1, dirZ: 0, wallBounce: 2 }
  let bounces = 0
  const stepLen = 0.1
  for (let step = 0; step < 240; step += 1) {
    p.x += p.dirX * stepLen
    p.z += p.dirZ * stepLen
    if (p.wallBounce > 0) {
      for (const ob of obs) {
        const hit = reflectOffObstacle(p.dirX, p.dirZ, p.x, p.z, ob)
        if (!hit) continue
        p.dirX = hit.dirX
        p.dirZ = hit.dirZ
        p.x = hit.x
        p.z = hit.z
        p.wallBounce -= 1
        bounces += 1
        break
      }
    }
  }
  assert(bounces === 2, `期望折返 2 次，实际 ${bounces}`)
  assert(p.wallBounce === 0, `剩余 wallBounce 应为 0，实际 ${p.wallBounce}`)
  // 2 次折返后方向恢复为 +x 并越过右侧障碍不再反弹
  near(p.dirX, 1, 1e-6, '第 2 次折返后应朝 +x')
  assert(p.x > 5, `第 3 次接近右侧障碍应直接穿过，实际 x=${p.x.toFixed(2)}`)
})

console.log(`\n结果：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
