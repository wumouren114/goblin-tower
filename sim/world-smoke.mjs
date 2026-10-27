/**
 * ============================================================
 *  sim/world-smoke.mjs —— v3 世界层冒烟测试（Node，无需浏览器）
 *
 *  用法：node sim/world-smoke.mjs
 *
 *  覆盖：
 *   1. 3 x 3 场景数据校验（名称 / halfSize / themeId / 主题映射 / pickScene）
 *   2. 9 个 SceneDef 全部 build 成功
 *   3. halfSize / isInside / clampToArena / spawnPoints / scatterPoints（撒点不出界）
 *   4. 性能预算：单层 drawcall < 80、实时点光 <= 6、FogExp2 + 1 张 2048 阴影贴图
 *   5. 入口净空：入口 5m 内没有阻挡物
 *   6. 重建 + dispose：几何/材质/纹理全部释放，节点数不增长（不泄漏）
 *
 *  实现：用 Node 24 自带的 TypeScript 转换能力（module.stripTypeScriptTypes）
 *  注册同步 loader hooks，直接 import src/*.ts；再用一个假 canvas 让
 *  world/textures.ts 的程序化纹理能在 Node 里生成。
 * ============================================================
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

/* ------------------------------------------------------------------ */
/*  0. 假 canvas                                                       */
/* ------------------------------------------------------------------ */

function makeGradient() {
  return { addColorStop() {} }
}

function makeCtx() {
  return {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    shadowColor: '#000',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    createRadialGradient: makeGradient,
    createLinearGradient: makeGradient,
    createConicGradient: makeGradient,
    createPattern: () => null,
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    resetTransform() {},
    transform() {},
    fillText() {},
    strokeText() {},
    measureText: () => ({ width: 8 }),
    drawImage() {},
    getImageData: (x, y, w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    putImageData() {},
    createImageData: (w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
    }),
    setLineDash() {},
    getLineDash: () => [],
    isPointInPath: () => false,
  }
}

function makeCanvas() {
  const ctx = makeCtx()
  return {
    width: 1,
    height: 1,
    style: {},
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,',
  }
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas()
    return { style: {}, appendChild() {}, removeChild() {} }
  },
  createElementNS(_ns, tag) {
    if (tag === 'canvas') return makeCanvas()
    return { style: {}, appendChild() {}, removeChild() {} }
  },
  body: { appendChild() {}, removeChild() {} },
}
if (!globalThis.window) globalThis.window = globalThis

/* ------------------------------------------------------------------ */
/*  1. TypeScript loader hooks（把 .ts 当 ESM 直接加载）                */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * 拾取物测试用假美术模块：pickups.ts 只依赖这几个导出，
 * 这里用轻量替身跳过浏览器的像素图集 / 精灵动画依赖。
 */
const FAKE_ART = {
  '../art/sprites': 'dsh-fake:art/sprites',
  '../art/pixels': 'dsh-fake:art/pixels',
}
const FAKE_SOURCES = {
  'dsh-fake:art/sprites': `
export const getBillboardYaw = () => 0
export const textureFromPixels = () => null
export const particleTexture = () => null
`,
  'dsh-fake:art/pixels': `
export class PixelCanvas {
  constructor(w, h) { this.width = w; this.height = h }
  circle() {}
  triangle() {}
  hLine() {}
  set() {}
  outline() {}
  fillRect() {}
}
`,
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // pickups.ts 的美术依赖 → 假模块
    if (context.parentURL?.includes('/src/entities/') && FAKE_ART[specifier]) {
      return { url: FAKE_ART[specifier], format: 'module', shortCircuit: true }
    }
    // src 内的无扩展名相对导入 → 补 .ts（等价 bundler moduleResolution）
    if (
      context.parentURL?.startsWith('file:') &&
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.(ts|mts|cts|js|mjs|cjs|json)$/.test(specifier)
    ) {
      const url = new URL(specifier + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, format: 'module', shortCircuit: true }
      }
    }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (FAKE_SOURCES[url]) {
      return { format: 'module', source: FAKE_SOURCES[url], shortCircuit: true }
    }
    if (url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.mts'))) {
      const file = fileURLToPath(url)
      const source = readFileSync(file, 'utf8')
      let transformed
      try {
        // transform 模式：支持 enum / 构造器参数属性等需要改写的语法
        transformed = stripTypeScriptTypes(source, { mode: 'transform', sourceUrl: url })
      } catch {
        transformed = stripTypeScriptTypes(source, { mode: 'strip' })
      }
      return { format: 'module', source: transformed, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})

/* ------------------------------------------------------------------ */
/*  2. 断言框架                                                        */
/* ------------------------------------------------------------------ */

let passed = 0
const failures = []
let currentSection = ''

function section(title) {
  currentSection = title
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`)
}

function check(ok, message, detail) {
  if (ok) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    const line = detail === undefined ? message : `${message}  →  ${detail}`
    failures.push(`[${currentSection}] ${line}`)
    console.log(`  ✗ ${line}`)
  }
}

function eq(actual, expected, message) {
  check(
    actual === expected,
    message,
    actual === expected ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  )
}

/* ------------------------------------------------------------------ */
/*  3. 加载被测模块                                                    */
/* ------------------------------------------------------------------ */

const Three = await import('three')
const THREE = Three.default ?? Three

const { TowerFloor } = await import(pathToFileURL(path.join(ROOT, 'src/world/floor.ts')).href)
const stages = await import(pathToFileURL(path.join(ROOT, 'src/data/stages.ts')).href)
const themesMod = await import(pathToFileURL(path.join(ROOT, 'src/world/themes.ts')).href)
const { Rng } = await import(pathToFileURL(path.join(ROOT, 'src/core/rng.ts')).href)
const { PickupManager, RICE_CHARGE } = await import(
  pathToFileURL(path.join(ROOT, 'src/entities/pickups.ts')).href
)

const { STAGE_SCENES, STAGE_NAMES, pickScene, sceneById, scenesOfStage, stageName } = stages
const { THEMES_V3, themeFor, familyOf } = themesMod

/* ------------------------------------------------------------------ */
/*  4. 释放计数（检测 dispose 是否真的释放）                            */
/* ------------------------------------------------------------------ */

const disposeCount = { geometry: 0, material: 0, texture: 0 }
function trackDispose(proto, key, name) {
  const original = proto[key]
  proto[key] = function patchedDispose(...args) {
    disposeCount[name]++
    return original.apply(this, args)
  }
  return () => {
    proto[key] = original
  }
}
const restoreHooks = [
  trackDispose(THREE.BufferGeometry.prototype, 'dispose', 'geometry'),
  trackDispose(THREE.Material.prototype, 'dispose', 'material'),
  trackDispose(THREE.Texture.prototype, 'dispose', 'texture'),
]

function snapshotCounts() {
  return { ...disposeCount }
}
function delta(before) {
  return {
    geometry: disposeCount.geometry - before.geometry,
    material: disposeCount.material - before.material,
    texture: disposeCount.texture - before.texture,
  }
}

/* ------------------------------------------------------------------ */
/*  5. 场景统计工具                                                    */
/* ------------------------------------------------------------------ */

function statsOf(group) {
  const out = {
    meshes: 0,
    instanced: 0,
    sprites: 0,
    points: 0,
    lines: 0,
    lights: 0,
    pointLights: 0,
    directionalLights: 0,
    hemiLights: 0,
    shadowLights: 0,
    shadowMapSizes: [],
    nodes: 0,
    drawcalls: 0,
    /** InstancedBufferGeometry 合批（火把/光晕/粒子等） */
    billboards: 0,
  }
  group.traverse((obj) => {
    out.nodes++
    if (obj.isInstancedMesh) {
      out.instanced++
      out.drawcalls++
      return
    }
    if (obj.isMesh) {
      out.meshes++
      out.drawcalls++
      if (obj.geometry?.isInstancedBufferGeometry) out.billboards++
    } else if (obj.isSprite) {
      out.sprites++
      out.drawcalls++
    } else if (obj.isPoints) {
      out.points++
      out.drawcalls++
    } else if (obj.isLine) {
      out.lines++
      out.drawcalls++
    }
    if (obj.isLight) {
      out.lights++
      if (obj.isPointLight) out.pointLights++
      if (obj.isDirectionalLight) out.directionalLights++
      if (obj.isHemisphereLight) out.hemiLights++
      if (obj.castShadow) {
        out.shadowLights++
        out.shadowMapSizes.push(`${obj.shadow.mapSize.x}x${obj.shadow.mapSize.y}`)
      }
    }
  })
  return out
}

function countPointLightsInScene(scene) {
  let n = 0
  scene.traverse((o) => {
    if (o.isPointLight) n++
  })
  return n
}

/* 契约 §5 的 halfSize 表：3 阶段 × 3 场景 */
const CONTRACT_HALF = [
  [15, 16, 14],
  [18, 19, 17],
  [21, 22, 24],
]

/* ------------------------------------------------------------------ */
/*  6. 数据校验                                                        */
/* ------------------------------------------------------------------ */

section('场景数据（stages.ts）')

eq(STAGE_NAMES.length, 3, 'STAGE_NAMES 有 3 个阶段名')
eq(STAGE_NAMES[0], '苔石遗迹', "阶段 1 = '苔石遗迹'")
eq(STAGE_NAMES[1], '熔火工坊', "阶段 2 = '熔火工坊'")
eq(STAGE_NAMES[2], '霜蚀圣所', "阶段 3 = '霜蚀圣所'")
eq(STAGE_SCENES.length, 3, 'STAGE_SCENES 有 3 个阶段')
eq(THEMES_V3 && Object.keys(THEMES_V3).length, 9, 'THEMES_V3 共 9 套主题')

const allScenes = []
const ids = new Set()
for (let s = 0; s < 3; s++) {
  const list = STAGE_SCENES[s]
  eq(Array.isArray(list) && list.length, 3, `阶段 ${s + 1} 有 3 个场景`)
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    allScenes.push(d)
    const tag = `阶段${s + 1}-场景${i + 1}(${d.id})`
    check(typeof d.id === 'string' && d.id.length > 0, `${tag} id 非空`)
    check(!ids.has(d.id), `${tag} id 唯一`, ids.has(d.id) ? '重复 id' : undefined)
    ids.add(d.id)
    check(typeof d.name === 'string' && d.name.length >= 2, `${tag} 有场景名`)
    check(typeof d.subtitle === 'string' && d.subtitle.length >= 2, `${tag} 有 subtitle`)
    eq(d.stage, s + 1, `${tag} stage = ${s + 1}`)
    eq(d.halfSize, CONTRACT_HALF[s][i], `${tag} halfSize = ${CONTRACT_HALF[s][i]}`)
    check(Number.isInteger(d.props) && d.props >= 4, `${tag} props 数量合理(${d.props})`)
    check(/^#[0-9a-fA-F]{6}$/.test(d.accent), `${tag} accent 为 #RRGGBB`)
    check(!!THEMES_V3[d.themeId], `${tag} themeId '${d.themeId}' 在 THEMES_V3 中`)
    const theme = THEMES_V3[d.themeId]
    if (theme) {
      eq(theme.stage, s + 1, `${tag} 主题 stage 与场景一致`)
      eq(theme.name, d.name, `${tag} 主题名与场景名一致`)
    }
  }
}

/* pickScene 行为 */
{
  const rng = new Rng(0xabc123)
  const picked = { first: false, second: false, boss: true }
  for (let i = 0; i < 64; i++) {
    const d = pickScene(1, false, rng)
    if (d === STAGE_SCENES[0][0]) picked.first = true
    if (d === STAGE_SCENES[0][1]) picked.second = true
  }
  check(picked.first && picked.second, '普通层会随机抽到场景 1/2')
  for (let stage = 1; stage <= 3; stage++) {
    for (let i = 0; i < 8; i++) {
      check(pickScene(stage, true, rng) === STAGE_SCENES[stage - 1][2], `阶段 ${stage} Boss 层固定场景 3`)
    }
  }
  check(pickScene(0, false, rng) !== undefined, 'stage 0 被夹到阶段 1')
  check(pickScene(9, false, rng) !== undefined, 'stage 9 被夹到阶段 3')
  check(scenesOfStage(2).length === 3, 'scenesOfStage(2) 返回 3 个场景')
  check(sceneById('stage3-throne') === STAGE_SCENES[2][2], 'sceneById 能反查王座之巅')
  check(stageName(2) === '熔火工坊', 'stageName(2) = 熔火工坊')
  const missing = sceneById('nope')
  check(missing === undefined, 'sceneById 未命中返回 undefined')
}

/* 主题家族覆盖 */
{
  const families = new Set(allScenes.map((d) => familyOf(themeFor(d.themeId))))
  check(families.size >= 4, `9 场景覆盖 ${families.size} 种视觉家族（>=4）`, [...families].join(','))
  check(familyOf(themeFor('stage2-forge')) === 'forge', 'stage2-forge 家族 = forge')
  check(familyOf(themeFor('stage3-throne')) === 'throne', 'stage3-throne 家族 = throne')
  const fallback = themeFor('does-not-exist')
  check(fallback.id === 'stage1-hall', '未知 themeId 兜底到 stage1-hall')
}

/* ------------------------------------------------------------------ */
/*  7. 9 场景 build + 行为 + 性能 + 释放                                */
/* ------------------------------------------------------------------ */

const scene3d = new THREE.Scene()
const floor = new TowerFloor(scene3d)

section('9 场景 build / 查询 API / 性能预算 / dispose')

const reportRows = []

for (const def of allScenes) {
  const tag = `${def.id}`
  const before = snapshotCounts()

  floor.build(def)
  floor.update(1 / 60, 1 / 60)

  const stats = statsOf(floor.group)
  const theme = themeFor(def.themeId)

  /* --- 基本状态 --- */
  eq(floor.halfSize, def.halfSize, `${tag} build 后 halfSize 正确`)
  eq(floor.spawnPoints.length, 16, `${tag} spawnPoints 四面各 4 = 16`)
  check(floor.propColliders.length > 5, `${tag} propColliders 含角柱+祭坛+道具(${floor.propColliders.length})`)
  check(scene3d.fog && scene3d.fog.isFogExp2, `${tag} 使用 FogExp2`)
  if (scene3d.fog && scene3d.fog.isFogExp2) {
    check(scene3d.fog.density > 0 && scene3d.fog.density < 0.1, `${tag} 雾密度在合理区间`)
    check(!!scene3d.fog && scene3d.fog.density > 0, `${tag} 雾已设置且密度 > 0`)
  }

  /* --- 出生点都在场内 --- */
  let spawnOk = true
  for (const p of floor.spawnPoints) {
    if (!floor.isInside(p.x, p.z, 0.4)) spawnOk = false
  }
  check(spawnOk, `${tag} 16 个出生点都在场地内`)

  /* --- isInside / clampToArena --- */
  check(floor.isInside(0, 0, 0.4), `${tag} isInside(0,0,0.4)`)
  check(!floor.isInside(def.halfSize - 0.1, 0, 0.4), `${tag} isInside(边界外) = false`)
  const clamped = floor.clampToArena(def.halfSize + 50, -def.halfSize - 50, 0.5)
  eq(round3(clamped.x), round3(def.halfSize - 0.5), `${tag} clampToArena x 夹到 half-0.5`)
  eq(round3(clamped.z), round3(-(def.halfSize - 0.5)), `${tag} clampToArena z 夹到 -(half-0.5)`)
  const inner = floor.clampToArena(1.25, -2.5, 0.5)
  eq(round3(inner.x), 1.25, `${tag} clampToArena 场内点不变 x`)
  eq(round3(inner.z), -2.5, `${tag} clampToArena 场内点不变 z`)

  /* --- 撒点：不出界、不进阻挡物、不进入口净空区 --- */
  const count = 40
  const pts = floor.scatterPoints(count, 3.9)
  eq(pts.length, count, `${tag} scatterPoints(${count}) 返回足够点数`)
  let outOfBounds = 0
  let inCollider = 0
  let nearCenter = 0
  let inEntrance = 0
  for (const p of pts) {
    if (Math.abs(p.x) > def.halfSize - 1.5 + 1e-6 || Math.abs(p.z) > def.halfSize - 1.5 + 1e-6) outOfBounds++
    if (Math.hypot(p.x, p.z) < 3.9 - 1e-6) nearCenter++
    if (Math.hypot(p.x - floor.entrance.x, p.z - floor.entrance.z) < 4.3 - 1e-6) inEntrance++
    for (const c of floor.propColliders) {
      if (Math.hypot(p.x - c.x, p.z - c.z) < c.r) {
        inCollider++
        break
      }
    }
  }
  eq(outOfBounds, 0, `${tag} 撒点不出界`)
  eq(nearCenter, 0, `${tag} 撒点离中心 >= 3.9`)
  eq(inCollider, 0, `${tag} 撒点不与碰撞体重叠`)
  eq(inEntrance, 0, `${tag} 撒点不进入口净空区`)

  /* --- 入口 5m 内无阻挡物（契约 §5） --- */
  let nearest = Infinity
  for (const c of floor.propColliders) {
    nearest = Math.min(nearest, Math.hypot(c.x - floor.entrance.x, c.z - floor.entrance.z) - c.r)
  }
  check(nearest >= 5, `${tag} 入口 5m 内无阻挡物（最近 ${nearest.toFixed(2)}m）`)
  check(floor.isInside(floor.entrance.x, floor.entrance.z, 0.4), `${tag} 入口点在场地内`)

  /* --- 性能预算 --- */
  check(stats.drawcalls < 80, `${tag} 单层 drawcall ${stats.drawcalls} < 80`)
  check(stats.pointLights <= 6, `${tag} 实时点光 ${stats.pointLights} <= 6`)
  check(stats.shadowLights === 1, `${tag} 只有 1 个投影光源`)
  eq(stats.shadowMapSizes.join(','), '2048x2048', `${tag} 阴影贴图 2048x2048`)
  check(countPointLightsInScene(scene3d) === stats.pointLights, `${tag} 点光全部挂在场景树内`)
  check(stats.sprites === 0, `${tag} 火把火焰已合批，不再有独立 sprite`)
  check(stats.billboards >= 2, `${tag} 场景发光合批 ${stats.billboards} 个（光晕/火焰）`)

  /* --- 确定性：同场景重建布局一致 --- */
  const colliders1 = floor.propColliders.map((c) => `${round3(c.x)},${round3(c.z)},${round3(c.r)}`).join('|')
  const spawn1 = floor.spawnPoints.map((p) => `${round3(p.x)},${round3(p.z)}`).join('|')
  floor.build(def)
  const colliders2 = floor.propColliders.map((c) => `${round3(c.x)},${round3(c.z)},${round3(c.r)}`).join('|')
  const spawn2 = floor.spawnPoints.map((p) => `${round3(p.x)},${round3(p.z)}`).join('|')
  eq(colliders2, colliders1, `${tag} 同场景重建布局确定`)
  eq(spawn2, spawn1, `${tag} 同场景重建出生点确定`)

  /* --- dispose 释放统计 --- */
  const countsBeforeDispose = snapshotCounts()
  floor.dispose()
  const freed = delta(countsBeforeDispose)
  check(freed.geometry > 0, `${tag} dispose 释放几何体 ${freed.geometry} 个`)
  check(freed.material > 0, `${tag} dispose 释放材质 ${freed.material} 个`)
  check(freed.texture > 0, `${tag} dispose 释放纹理 ${freed.texture} 个`)
  eq(floor.group.parent, null, `${tag} dispose 后 group 已离开场景`)
  eq(floor.group.children.length, 1, `${tag} dispose 后只留空 root 容器`)
  eq(floor.group.children[0]?.children.length ?? -1, 0, `${tag} dispose 后场景树清空`)
  eq(scene3d.fog, null, `${tag} dispose 后雾已清除`)
  eq(countSceneNodes(scene3d), 0, `${tag} dispose 后场景里没有残留节点`)

  /* rebuild 的资源净增：本轮 build 释放量应覆盖上一轮构建（不泄漏） */
  const freedThisRound = delta(before)
  reportRows.push({
    id: def.id,
    name: def.name,
    halfSize: def.halfSize,
    props: def.props,
    colliders: colliders1.split('|').length,
    drawcalls: stats.drawcalls,
    meshes: stats.meshes,
    instanced: stats.instanced,
    sprites: stats.sprites,
    points: stats.points,
    pointLights: stats.pointLights,
    nearestEntry: nearest,
    freedGeo: freedThisRound.geometry,
    freedMat: freedThisRound.material,
    freedTex: freedThisRound.texture,
  })
}

/* ------------------------------------------------------------------ */
/*  8. dispose 后重建不泄漏                                            */
/* ------------------------------------------------------------------ */

section('重建循环 / 泄漏检查')

{
  const before = snapshotCounts()
  const loopScene = new THREE.Scene()
  const loopFloor = new TowerFloor(loopScene)
  for (let i = 0; i < 3; i++) {
    for (const def of allScenes) {
      loopFloor.build(def)
      loopFloor.update(1 / 60, i / 60)
    }
  }
  loopFloor.dispose()
  const freed = delta(before)
  check(freed.geometry >= 27, `27 次 build 后几何体全部释放（${freed.geometry} 个）`)
  check(freed.material >= 27, `27 次 build 后材质全部释放（${freed.material} 个）`)
  check(freed.texture >= 27, `27 次 build 后纹理全部释放（${freed.texture} 个）`)
  eq(countSceneNodes(loopScene), 0, '循环重建 + dispose 后场景无残留节点')
  eq(loopScene.fog, null, '循环重建 + dispose 后雾已清除')
}

/* ------------------------------------------------------------------ */
/*  9. 拾取物（pickups.ts）冒烟                                        */
/* ------------------------------------------------------------------ */

section('拾取物 gold / heart / rice / card')

{
  eq(RICE_CHARGE, 20, '米饭拾取回 20 充能')

  const pkScene = new THREE.Scene()
  const pm = new PickupManager(pkScene)

  /* 四类都能生成 + 视觉对象入场景 */
  pm.spawn('gold', 3, 3, 7)
  pm.spawn('heart', 4, 3)
  pm.spawn('rice', 3, 4)
  pm.spawn('card', 4, 4)
  eq(pm.count, 4, '4 种拾取物都能生成')
  eq(pkScene.children.length, 3, '拾取物视觉已合批（光晕/火花/图标 3 个批次）')

  /* 上限 260：超出后复用最早的个体，不无限增长 */
  pm.clear()
  eq(pm.count, 0, 'clear 后拾取物清空')
  eq(pkScene.children.length, 3, 'clear 后合批容器保留（实例已隐藏）')
  for (let i = 0; i < 300; i++) pm.spawn('gold', -8 + (i % 10) * 0.1, 8 + Math.floor(i / 10) * 0.1, 1)
  eq(pm.count, 260, '拾取物上限 260')

  /* 米饭：吸附后收取值 = 20 */
  pm.clear()
  pm.spawn('rice', 1.4, 0)
  const collected = []
  const onCollect = (kind, value) => collected.push([kind, value])
  for (let i = 0; i < 180 && pm.count > 0; i++) pm.update(1 / 60, 0, 0, 3, onCollect)
  eq(collected.length, 1, '磁吸范围内米饭被拾取')
  eq(collected[0]?.[0], 'rice', '收取种类 = rice')
  eq(collected[0]?.[1], 20, '米饭收取值 = 20 充能')
  eq(pm.count, 0, '收取后列表清空')

  /* 近身直接拾取：红心 25 / 金币用调用方传值 / 卡片 1 */
  pm.clear()
  collected.length = 0
  pm.spawn('heart', 0.2, 0)
  pm.spawn('gold', 0.2, 0.1, 5)
  pm.spawn('card', 0.2, -0.1)
  pm.update(1 / 60, 0, 0, 0, onCollect)
  eq(pm.count, 0, '三个近身拾取物一帧内全部收取')
  const byKind = new Map(collected)
  eq(byKind.get('heart'), 25, '红心值 = 25')
  eq(byKind.get('gold'), 5, '金币使用调用方传值')
  eq(byKind.get('card'), 1, '卡片默认值 = 1')

  /* 清层 drainAll：一次性取回所有剩余掉落并清空场景 */
  pm.clear()
  pm.spawn('gold', 2, 0, 7)
  pm.spawn('gold', -2, 0, 5)
  pm.spawn('heart', 0, 2)
  pm.spawn('rice', 0, -2)
  const drained = pm.drainAll()
  eq(drained.length, 4, 'drainAll 取回全部剩余掉落')
  eq(drained.filter((d) => d.kind === 'gold').reduce((sum, d) => sum + d.value, 0), 12, 'drainAll 保留金币金额')
  eq(pm.count, 0, 'drainAll 后拾取物清空')
  eq(pkScene.children.length, 3, 'drainAll 后合批容器保留')

  /* 拾取物漂移视觉 + dispose 不泄漏 */
  pm.clear()
  pm.spawn('card', 2, -2)
  pm.spawn('rice', -2, 2)
  for (let i = 0; i < 30; i++) pm.update(1 / 60, 20, 20, 0, onCollect)
  eq(pm.count, 2, '远距离拾取物保持在场')
  pm.dispose()
  eq(pm.count, 0, 'dispose 后拾取物清空')
  eq(pkScene.children.length, 0, 'dispose 后场景无残留')
}

/* ------------------------------------------------------------------ */
/*  10. 报告                                                          */
/* ------------------------------------------------------------------ */

restoreHooks.forEach((fn) => fn())

section('场景统计')
console.log(
  '  id'.padEnd(20) +
    'half'.padStart(6) +
    'props'.padStart(8) +
    'coll'.padStart(6) +
    'draw'.padStart(6) +
    'mesh'.padStart(6) +
    'inst'.padStart(6) +
    'spr'.padStart(5) +
    'pts'.padStart(5) +
    'lights'.padStart(7) +
    'entry'.padStart(7),
)
for (const r of reportRows) {
  console.log(
    ('  ' + r.id).padEnd(20) +
      String(r.halfSize).padStart(6) +
      String(r.props).padStart(8) +
      String(r.colliders).padStart(6) +
      String(r.drawcalls).padStart(6) +
      String(r.meshes).padStart(6) +
      String(r.instanced).padStart(6) +
      String(r.sprites).padStart(5) +
      String(r.points).padStart(5) +
      String(r.pointLights).padStart(7) +
      r.nearestEntry.toFixed(1).padStart(7),
  )
}

const drawMax = Math.max(...reportRows.map((r) => r.drawcalls))
const lightMax = Math.max(...reportRows.map((r) => r.pointLights))
console.log(`\n  drawcall 峰值 = ${drawMax}（预算 < 80）`)
console.log(`  实时点光峰值 = ${lightMax}（预算 <= 6）`)
console.log(`  场景名: ${allScenes.map((d) => d.name).join(' / ')}`)

console.log('\n' + '='.repeat(72))
if (failures.length === 0) {
  console.log(`✅ 世界层冒烟通过：${passed} 项断言全部通过`)
  process.exit(0)
} else {
  console.log(`❌ 世界层冒烟失败：${failures.length} 项失败 / ${passed} 项通过`)
  for (const f of failures) console.log(`   - ${f}`)
  process.exit(1)
}

/* ------------------------------------------------------------------ */
/*  工具函数                                                          */
/* ------------------------------------------------------------------ */

function round3(v) {
  return Math.round(v * 1000) / 1000
}

function countSceneNodes(scene) {
  let n = 0
  scene.traverse(() => {
    n++
  })
  return n - 1 // 减去 scene 自身
}
