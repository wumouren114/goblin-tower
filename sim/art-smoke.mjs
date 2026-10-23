/**
 * 《哥布林之塔》v3 角色像素图集冒烟测试（Node 直跑，不需要浏览器）。
 *
 *   node sim/art-smoke.mjs
 *   node sim/art-smoke.mjs --preview   # 额外输出四套放大预览 PNG 到 sim/.art-preview/
 *
 * 复用 sim/world-smoke.mjs 的技巧：registerHooks 把 .ts 当 ESM 加载，
 * 外加一个最小假 canvas（three.CanvasTexture 只存 image，不真正解码像素）。
 *
 * 断言：
 *   1. 四套图集（mutsumi / mortis / murasame / fish）均为 5 行 × 10 列、48×56 单元格；
 *   2. 每套 50 格全部非空；
 *   3. 每格四条边（x=0/47、y=0/55）完全透明；
 *   4. 每格脚底锚定行 y=54 有实心像素（脚底对齐单元格底部）；
 *   5. 四个角色只统计高饱和像素的平均色相两两明显不同；
 *   6. Mortis 出现紫色音波像素、丛雨出现蓝白刀光像素、肥鱼出现黄色水枪像素；
 *   7. playerSprite 按 id 缓存（同 id 两次拿到同一对象、不同 id 对象不同）；
 *   8. buildPlayerAtlas() 仍可用（mutsumi 别名）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks, stripTypeScriptTypes } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'

/* ------------------------------------------------------------------ */
/*  0. 最小假 canvas / document（three 的 CanvasTexture 需要）          */
/* ------------------------------------------------------------------ */

function makeCtx() {
  return {
    canvas: null,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    imageSmoothingEnabled: false,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    ellipse() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    clip() {},
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createConicGradient: () => ({ addColorStop() {} }),
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
  const canvas = {
    width: 1,
    height: 1,
    style: {},
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,',
  }
  ctx.canvas = canvas
  return canvas
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
/*  1. TypeScript loader hooks                                          */
/* ------------------------------------------------------------------ */

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))

registerHooks({
  resolve(specifier, context, nextResolve) {
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
    if (url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.mts'))) {
      const file = fileURLToPath(url)
      const source = readFileSync(file, 'utf8')
      let transformed
      try {
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

function check(name, fn) {
  try {
    fn()
    passed += 1
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : err}`)
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

/* ------------------------------------------------------------------ */
/*  3. 像素工具                                                        */
/* ------------------------------------------------------------------ */

const CHAR_IDS = ['mutsumi', 'mortis', 'murasame', 'fish']
const EXPECTED = { cols: 10, rows: 5, cellW: 48, cellH: 56 }

function loadCharacters() {
  return import(pathToFileURL(path.join(ROOT, 'src/art/characters.ts')).href)
}

function alphaAt(atlas, x, y) {
  return atlas.canvas.data[(y * atlas.canvas.width + x) * 4 + 3]
}
function colorAt(atlas, x, y) {
  const d = atlas.canvas.data
  const i = (y * atlas.canvas.width + x) * 4
  return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
}
function cellOrigin(atlas, col, row) {
  return { x: col * atlas.cellW, y: row * atlas.cellH }
}

function cellStats(atlas, col, row) {
  const { x: ox, y: oy } = cellOrigin(atlas, col, row)
  let opaque = 0
  let borderSolid = 0
  for (let y = 0; y < atlas.cellH; y++) {
    for (let x = 0; x < atlas.cellW; x++) {
      if (alphaAt(atlas, ox + x, oy + y) === 0) continue
      opaque += 1
      if (x === 0 || x === atlas.cellW - 1 || y === 0 || y === atlas.cellH - 1) {
        borderSolid += 1
      }
    }
  }
  let footRowSolid = 0
  const footY = oy + atlas.cellH - 2
  for (let x = 0; x < atlas.cellW; x++) if (alphaAt(atlas, ox + x, footY)) footRowSolid += 1
  return { opaque, borderSolid, footRowSolid }
}

function colorsOf(atlas) {  const seen = new Map()
  const d = atlas.canvas.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
    seen.set(c, (seen.get(c) ?? 0) + 1)
  }
  return seen
}

function rgbToHsv(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** 高饱和像素的加权圆形平均色相（度）；权重 = 饱和度。 */
function meanHue(atlas) {
  let sx = 0
  let sy = 0
  let weight = 0
  const d = atlas.canvas.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const { h, s, v } = rgbToHsv(d[i], d[i + 1], d[i + 2])
    if (s < 0.3 || v < 0.25) continue
    const w = s
    const rad = (h * Math.PI) / 180
    sx += Math.cos(rad) * w
    sy += Math.sin(rad) * w
    weight += w
  }
  if (weight === 0) return { hue: 0, weight: 0 }
  let hue = (Math.atan2(sy, sx) * 180) / Math.PI
  if (hue < 0) hue += 360
  return { hue, weight }
}

function circularDistance(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function countColors(atlas, colors, minSaturation = 0) {
  let n = 0
  const d = atlas.canvas.data
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue
    const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]
    if (!colors.includes(c)) continue
    if (minSaturation > 0) {
      const { s } = rgbToHsv(d[i], d[i + 1], d[i + 2])
      if (s < minSaturation) continue
    }
    n += 1
  }
  return n
}

/* ------------------------------------------------------------------ */
/*  4. 主流程                                                          */
/* ------------------------------------------------------------------ */

const chars = await loadCharacters()
const sprites = await import(pathToFileURL(path.join(ROOT, 'src/art/sprites.ts')).href)
const roomNpc = await import(pathToFileURL(path.join(ROOT, 'src/entities/roomNpc.ts')).href)
const THREE = await import('three')
const preview = process.argv.includes('--preview')
const scaleArg = process.argv.find((a) => a.startsWith('--scale='))
const previewScale = scaleArg ? Math.max(1, Math.min(8, Number(scaleArg.slice(8)) || 2)) : 2

const atlases = {}
for (const id of CHAR_IDS) {
  check(`图集结构 ${id}`, () => {
    const atlas = chars.buildCharacterAtlas(id)
    atlases[id] = atlas
    assert(atlas.cols === EXPECTED.cols, `cols=${atlas.cols}`)
    assert(atlas.rows === EXPECTED.rows, `rows=${atlas.rows}`)
    assert(atlas.cellW === EXPECTED.cellW, `cellW=${atlas.cellW}`)
    assert(atlas.cellH === EXPECTED.cellH, `cellH=${atlas.cellH}`)
    assert(atlas.canvas.width === EXPECTED.cols * EXPECTED.cellW, `canvas.width=${atlas.canvas.width}`)
    assert(atlas.canvas.height === EXPECTED.rows * EXPECTED.cellH, `canvas.height=${atlas.canvas.height}`)
    assert(atlas.worldW === 1.5, `worldW=${atlas.worldW}`)
    assert(atlas.worldH === 1.75, `worldH=${atlas.worldH}`)
  })
}

for (const id of CHAR_IDS) {
  check(`50 格全部非空 / 四边透明 / 脚底实心 ${id}`, () => {
    const atlas = atlases[id]
    assert(atlas, '图集未生成')
    for (let row = 0; row < atlas.rows; row++) {
      for (let col = 0; col < atlas.cols; col++) {
        const s = cellStats(atlas, col, row)
        assert(s.opaque > 0, `row${row} col${col} 空格子`)
        assert(s.borderSolid === 0, `row${row} col${col} 四边有 ${s.borderSolid} 个不透明像素`)
        assert(s.footRowSolid > 0, `row${row} col${col} 脚底行无实心像素`)
      }
    }
  })
}

check('四套图集内容互不相同', () => {
  for (let i = 0; i < CHAR_IDS.length; i++) {
    for (let j = i + 1; j < CHAR_IDS.length; j++) {
      const a = atlases[CHAR_IDS[i]].canvas.data
      const b = atlases[CHAR_IDS[j]].canvas.data
      let same = true
      for (let k = 0; k < a.length; k++) {
        if (a[k] !== b[k]) {
          same = false
          break
        }
      }
      assert(!same, `${CHAR_IDS[i]} 与 ${CHAR_IDS[j]} 图集完全相同`)
    }
  }
})

const hues = {}
check('四人平均色相明显不同', () => {
  for (const id of CHAR_IDS) hues[id] = meanHue(atlases[id])
  console.log(
    '\n平均色相: ' +
      CHAR_IDS.map((id) => `${id}=${hues[id].hue.toFixed(1)}°`).join('  '),
  )
  let worst = 360
  let pair = ''
  for (let i = 0; i < CHAR_IDS.length; i++) {
    for (let j = i + 1; j < CHAR_IDS.length; j++) {
      const dist = circularDistance(hues[CHAR_IDS[i]].hue, hues[CHAR_IDS[j]].hue)
      if (dist < worst) {
        worst = dist
        pair = `${CHAR_IDS[i]}/${CHAR_IDS[j]}`
      }
    }
  }
  assert(worst >= 15, `最小色相差 ${worst.toFixed(1)}° (${pair}) < 15°`)
})

check('Mortis 紫色音波像素', () => {
  const n = countColors(atlases.mortis, [0xb46bff, 0xd9b0ff])
  assert(n >= 40, `紫色音波像素仅 ${n}`)
  const base = countColors(atlases.mutsumi, [0xb46bff, 0xd9b0ff])
  assert(base >= 40, `若叶睦技能行（Mortis 形态）紫色像素仅 ${base}`)
})

check('丛雨蓝白刀光像素', () => {
  const n = countColors(atlases.murasame, [0x8fd8ff, 0xdfe9f5])
  assert(n >= 40, `蓝白刀光像素仅 ${n}`)
})

check('肥鱼黄色水枪像素', () => {
  const n = countColors(atlases.fish, [0xf2c14e, 0xffe08a])
  assert(n >= 40, `黄色水枪像素仅 ${n}`)
  const bubbles = countColors(atlases.fish, [0xbfefff, 0x57d6e8])
  // 泡泡与枪口同色板，一起统计
  assert(bubbles >= 40, `泡泡/青色像素仅 ${bubbles}`)
})

check('playerSprite 按 id 缓存', () => {
  const a = sprites.playerSprite('mutsumi')
  const b = sprites.playerSprite('mutsumi')
  assert(a === b, '同一 id 两次返回不同对象')
  assert(sprites.playerSprite() === a, '默认参数没有落到 mutsumi')
  const mortis = sprites.playerSprite('mortis')
  assert(mortis !== a, 'mortis 与 mutsumi 共享对象')
  assert(sprites.playerSprite('fish') !== sprites.playerSprite('murasame'), 'fish/murasame 共享对象')
  for (const id of CHAR_IDS) {
    const anim = sprites.playerSprite(id)
    assert(anim.cols === 10 && anim.rows === 5, `${id} anim 尺寸 ${anim.cols}x${anim.rows}`)
    assert(anim.frames.down.length === 10, `${id} down 帧数 ${anim.frames.down.length}`)
    assert(anim.frames.left.length === 10, `${id} left 帧数 ${anim.frames.left.length}`)
    assert(anim.worldW === 1.5 && anim.worldH === 1.75, `${id} 世界尺寸 ${anim.worldW}x${anim.worldH}`)
    assert(anim.texture.flipY === false, `${id} flipY 不是 false`)
    assert(anim.texture.magFilter === 1003, `${id} magFilter 不是 NearestFilter`)
  }
})

check('buildPlayerAtlas 仍可用（mutsumi 别名）', () => {
  const atlas = chars.buildPlayerAtlas()
  assert(atlas.cols === 10 && atlas.rows === 5, 'buildPlayerAtlas 未返回 v3 图集')
  assert(atlas.worldW === 1.5 && atlas.worldH === 1.75, 'buildPlayerAtlas 世界尺寸不对')
  const same =
    Buffer.compare(
      Buffer.from(atlas.canvas.data.buffer, atlas.canvas.data.byteOffset, atlas.canvas.data.byteLength),
      Buffer.from(
        atlases.mutsumi.canvas.data.buffer,
        atlases.mutsumi.canvas.data.byteOffset,
        atlases.mutsumi.canvas.data.byteLength,
      ),
    ) === 0
  assert(same, 'buildPlayerAtlas 与 buildCharacterAtlas(mutsumi) 像素不一致')
  const anim = sprites.playerSprite('mutsumi')
  assert(anim.cols === 10, 'playerSprite 默认不是 10 列')
})

check('setSpriteFrame 使用 anim.cols 取模并正确换算 UV', async () => {
  const THREE = await import('three')
  const anim = sprites.playerSprite('murasame')
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(anim.worldW, anim.worldH),
    new THREE.MeshBasicMaterial({ map: anim.texture }),
  )
  sprites.setSpriteFrame(mesh, anim, 'down', 9)
  let uv = mesh.geometry.getAttribute('uv')
  assert(Math.abs(uv.getX(0) - 0.9) < 1e-6 && Math.abs(uv.getX(1) - 1.0) < 1e-6, '第 9 列 UV 不对')
  assert(Math.abs(uv.getY(0)) < 1e-6 && Math.abs(uv.getY(2) - 0.2) < 1e-6, 'down 行 UV 不对')
  sprites.setSpriteFrame(mesh, anim, 'left', 10)
  uv = mesh.geometry.getAttribute('uv')
  assert(Math.abs(uv.getX(0)) < 1e-6, '第 10 帧没有回绕到第 0 列')
  assert(Math.abs(uv.getY(0) - 0.4) < 1e-6, 'left 行 UV 不对')
  sprites.setSpriteFrame(mesh, anim, 'right', -1)
  uv = mesh.geometry.getAttribute('uv')
  assert(Math.abs(uv.getX(0) - 0.9) < 1e-6, '负帧没有回绕到最后一列')
  mesh.geometry.dispose()
})

check('caster 图集：4×4 非空、紫色兜帽/水晶、比 small 高', () => {
  const atlas = chars.buildGoblinAtlas('caster')
  assert(atlas.cols === 4 && atlas.rows === 4, `caster 图集尺寸 ${atlas.cols}x${atlas.rows}`)
  assert(atlas.cellW === 28 && atlas.cellH === 32, `caster 单元格 ${atlas.cellW}x${atlas.cellH}`)
  assert(atlas.worldW === 0.9 && atlas.worldH === 1.0, `caster 世界尺寸 ${atlas.worldW}x${atlas.worldH}`)
  for (let row = 0; row < atlas.rows; row++) {
    for (let col = 0; col < atlas.cols; col++) {
      const s = cellStats(atlas, col, row)
      assert(s.opaque > 0, `caster row${row} col${col} 空格子`)
    }
  }
  const hood = countColors(atlas, [0x5a3a78, 0x3a2450, 0x7d559e])
  const crystal = countColors(atlas, [0xb46bff, 0xd9b3ff, 0x7a3cff])
  assert(hood >= 80, `紫色兜帽像素仅 ${hood}`)
  assert(crystal >= 20, `紫水晶像素仅 ${crystal}`)
  const small = chars.buildGoblinAtlas('small')
  const sameAsSmall =
    Buffer.compare(
      Buffer.from(atlas.canvas.data.buffer, atlas.canvas.data.byteOffset, atlas.canvas.data.byteLength),
      Buffer.from(small.canvas.data.buffer, small.canvas.data.byteOffset, small.canvas.data.byteLength),
    ) === 0
  assert(!sameAsSmall, 'caster 与 small 的图集像素完全相同')
  const topRow = (a) => {
    for (let y = 0; y < a.cellH; y++) {
      for (let x = 0; x < a.cellW; x++) if (alphaAt(a, x, y) !== 0) return y
    }
    return 999
  }
  const ct = topRow(atlas)
  const st = topRow(small)
  assert(ct < st, `caster 头顶 y=${ct} 没有比 small y=${st} 更高`)
})

check('v4.8 长矛手 / 爆破手图集与本体、彼此可区分', () => {
  const small = chars.buildGoblinAtlas('small')
  const spear = chars.buildGoblinAtlas('spear')
  const bomber = chars.buildGoblinAtlas('bomber')
  for (const [name, atlas] of [
    ['spear', spear],
    ['bomber', bomber],
  ]) {
    assert(atlas.cols === 4 && atlas.rows === 4, `${name} 图集尺寸 ${atlas.cols}x${atlas.rows}`)
    assert(atlas.cellW === 28 && atlas.cellH === 32, `${name} 单元格 ${atlas.cellW}x${atlas.cellH}`)
    assert(atlas.worldW === 0.9 && atlas.worldH === 1.0, `${name} 世界尺寸 ${atlas.worldW}x${atlas.worldH}`)
    for (let row = 0; row < atlas.rows; row++) {
      for (let col = 0; col < atlas.cols; col++) {
        const s = cellStats(atlas, col, row)
        assert(s.opaque > 0, `${name} row${row} col${col} 空格子`)
        assert(s.footRowSolid > 0, `${name} row${row} col${col} 脚底无像素`)
      }
    }
  }
  const bytes = (a) => Buffer.from(a.canvas.data.buffer, a.canvas.data.byteOffset, a.canvas.data.byteLength)
  assert(Buffer.compare(bytes(spear), bytes(small)) !== 0, '长矛手仍是小怪旧图集')
  assert(Buffer.compare(bytes(bomber), bytes(small)) !== 0, '爆破手仍是小怪旧图集')
  assert(Buffer.compare(bytes(spear), bytes(bomber)) !== 0, '长矛手与爆破手图集完全相同')
  assert(countColors(spear, [0xb0b6c0, 0x676d78, 0xa23a2f]) >= 30, '长矛手缺少枪头/红布条像素')
  assert(countColors(bomber, [0xb0b6c0, 0x676d78, 0xffd166, 0x1a1714]) >= 30, '爆破手缺少炸弹/引线像素')
})

check('v4.8 哥布林之王三变体图集：尺寸 / 调色 / 像素互异', () => {
  const king = chars.buildKingAtlas('king')
  const warlord = chars.buildKingAtlas('warlord')
  const witch = chars.buildKingAtlas('witch')
  for (const [name, atlas, worldW, worldH] of [
    ['king', king, 1.9, 2.2],
    ['warlord', warlord, 2.08, 2.38],
    ['witch', witch, 1.86, 2.16],
  ]) {
    assert(atlas.cols === 4 && atlas.rows === 4, `${name} 图集尺寸 ${atlas.cols}x${atlas.rows}`)
    assert(atlas.cellW === 52 && atlas.cellH === 60, `${name} 单元格 ${atlas.cellW}x${atlas.cellH}`)
    assert(atlas.worldW === worldW && atlas.worldH === worldH, `${name} 世界尺寸 ${atlas.worldW}x${atlas.worldH}`)
    for (let row = 0; row < atlas.rows; row++) {
      for (let col = 0; col < atlas.cols; col++) {
        assert(cellStats(atlas, col, row).opaque > 0, `${name} row${row} col${col} 空格子`)
      }
    }
  }
  const bytes = (a) => Buffer.from(a.canvas.data.buffer, a.canvas.data.byteOffset, a.canvas.data.byteLength)
  assert(Buffer.compare(bytes(king), bytes(warlord)) !== 0, '督军与旧王图集完全相同')
  assert(Buffer.compare(bytes(king), bytes(witch)) !== 0, '巫王与旧王图集完全相同')
  assert(Buffer.compare(bytes(warlord), bytes(witch)) !== 0, '督军与巫王图集完全相同')
  assert(countColors(warlord, [0x8a7a3f, 0x5a4e25, 0x8f2024, 0x4c0e11]) >= 200, '督军缺少赤褐/暗红配色像素')
  assert(countColors(witch, [0x8d77b7, 0x5b477f, 0x4d2170, 0x92ddc8]) >= 200, '巫王缺少紫皮/青金配色像素')
  assert(countColors(warlord, [0x6c9640, 0x93bb58]) < 20, '督军仍大量残留旧绿色皮肤')
  assert(countColors(witch, [0x6c9640, 0x93bb58]) < 20, '巫王仍大量残留旧绿色皮肤')
})

check('v4.8 Boss 精灵缓存：三变体互不共享', () => {
  const king = sprites.kingSprite('king')
  const warlord = sprites.kingSprite('warlord')
  const witch = sprites.kingSprite('witch')
  assert(king !== warlord && king !== witch && warlord !== witch, 'Boss 变体共享了同一精灵对象')
  assert(sprites.kingSprite('warlord') === warlord, '督军精灵没有缓存')
  assert(warlord.worldW === 2.08 && warlord.worldH === 2.38, `督军精灵世界尺寸 ${warlord.worldW}x${warlord.worldH}`)
  assert(witch.worldW === 1.86 && witch.worldH === 2.16, `巫王精灵世界尺寸 ${witch.worldW}x${witch.worldH}`)
})

check('v4.8 炸弹纹理 24×24 且缓存复用', () => {
  const tex = sprites.bombTexture()
  assert(tex.image.width === 24 && tex.image.height === 24, `炸弹纹理 ${tex.image.width}x${tex.image.height}`)
  assert(sprites.bombTexture() === tex, '炸弹纹理没有缓存')
  assert(tex.magFilter === 1003 && tex.minFilter === 1003, '炸弹纹理不是最近邻采样')
})

check('v4.8 房间 NPC 信息 / 模型结构与出口裂隙清理', () => {
  const rooms = ['chest', 'skill-card', 'merchant', 'altar', 'mob-wave', 'elite-fight', 'boss', 'rest']
  for (const room of rooms) {
    const info = roomNpc.roomNpcInfo(room)
    assert(info.kind.length > 0 && info.title.length > 0 && info.hint.length > 0, `${room} NPC 信息不完整`)
  }
  assert(roomNpc.roomNpcInfo('chest').kind === 'guide', '宝箱房 NPC 不是引路人')
  assert(roomNpc.roomNpcInfo('merchant').kind === 'merchant', '商人房 NPC 不是商人')
  assert(roomNpc.roomNpcInfo('rest').kind === 'guide', '休憩房 NPC 不是引路人')

  const scene = new THREE.Scene()
  const npc = new roomNpc.RoomNpc(scene, 'chest', 0, 0)
  assert(scene.children.length === 1 && npc.group.children.length === 3, '房间 NPC 结构不是 group(精灵+影子+地环)')
  npc.update(0.5)
  npc.dispose()
  assert(scene.children.length === 0, '房间 NPC dispose 后仍留在场景')

  const portal = new roomNpc.RoomPortal(scene, 0, 0)
  assert(scene.children.length === 1 && portal.group.children.length === 2, '出口裂隙结构不是 group(传送门+地面符文)')
  assert(portal.title.length > 0 && portal.hint.length > 0, '出口裂隙缺少标题/提示')
  portal.update(0.5)
  portal.dispose()
  assert(scene.children.length === 0, '出口裂隙 dispose 后仍留在场景')
})


check('敌方弹幕图集 + enemyBulletSprite 缓存', () => {
  const atlas = chars.buildEnemyBulletAtlas()
  assert(atlas.cols === 4 && atlas.rows === 1, `弹幕图集 ${atlas.cols}x${atlas.rows}`)
  assert(atlas.cellW === 16 && atlas.cellH === 16, `弹幕单元格 ${atlas.cellW}x${atlas.cellH}`)
  assert(atlas.canvas.width === 64 && atlas.canvas.height === 16, `弹幕画布 ${atlas.canvas.width}x${atlas.canvas.height}`)
  assert(atlas.worldW === 0.55 && atlas.worldH === 0.55, `弹幕世界尺寸 ${atlas.worldW}x${atlas.worldH}`)
  for (let col = 0; col < atlas.cols; col++) {
    const s = cellStats(atlas, col, 0)
    assert(s.opaque > 20, `弹幕第 ${col} 帧像素仅 ${s.opaque}`)
    const ox = col * atlas.cellW
    assert(alphaAt(atlas, ox, 0) === 0, `弹幕第 ${col} 帧左上角不透明`)
    assert(alphaAt(atlas, ox + 8, 8) !== 0, `弹幕第 ${col} 帧中心没有实心像素`)
  }
  for (const color of [0x7a3cff, 0xd9b3ff, 0xffffff]) {
    const n = countColors(atlas, [color])
    assert(n >= 8, `弹幕颜色 #${color.toString(16)} 仅 ${n} 像素`)
  }
  const a = sprites.enemyBulletSprite()
  const b = sprites.enemyBulletSprite()
  assert(a === b, 'enemyBulletSprite 没有缓存')
  assert(a.cols === 4 && a.rows === 1, `enemyBulletSprite 尺寸 ${a.cols}x${a.rows}`)
  assert(a.worldW === 0.55 && a.worldH === 0.55, `enemyBulletSprite 世界尺寸 ${a.worldW}x${a.worldH}`)
  assert(a.frames.down.length === 4 && a.frames.left.length === 4, 'enemyBulletSprite 帧数不对')
  assert(a.texture.flipY === false, 'enemyBulletSprite flipY 不是 false')
  assert(a.texture.magFilter === 1003, 'enemyBulletSprite 不是最近邻采样')
  const caster = sprites.goblinSprite('caster')
  assert(caster.cols === 4 && caster.rows === 4, 'goblinSprite(caster) 尺寸不对')
  assert(sprites.goblinSprite('caster') === caster, 'goblinSprite(caster) 没有缓存')
})

check('v4.6 九张风格图标均为 128×128 透明 PNG', () => {
  const names = [
    'style_mutsumi_solo.png',
    'style_mutsumi_duet.png',
    'style_mutsumi_requiem.png',
    'style_murasame_iai.png',
    'style_murasame_blood.png',
    'style_murasame_guard.png',
    'style_fish_school.png',
    'style_fish_burst.png',
    'style_fish_whale.png',
  ]
  const dir = path.join(ROOT, 'assets/art_raw/v46/icons')
  for (const name of names) {
    const file = path.join(dir, name)
    assert(existsSync(file), `缺少风格图标 ${name}`)
    const buf = readFileSync(file)
    assert(buf.length > 1024, `${name} 文件过小`)
    assert(buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG', `${name} 不是 PNG`)
    assert(buf.toString('ascii', 12, 16) === 'IHDR', `${name} 缺少 IHDR`)
    assert(buf.readUInt32BE(16) === 128 && buf.readUInt32BE(20) === 128, `${name} 不是 128×128`)
    assert(buf[24] === 8, `${name} 位深不是 8`)
    assert(buf[25] === 6, `${name} 不是 RGBA 透明 PNG`)
  }
})

/* ------------------------------------------------------------------ */
/*  5. 预览 PNG（仅 --preview）                                        */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(cw, ch, data, scale) {
  const w = cw * scale
  const h = ch * scale
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const rowStart = y * (w * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < w; x++) {
      const si = ((y / scale | 0) * cw + (x / scale | 0)) * 4
      const di = rowStart + 1 + x * 4
      raw[di] = data[si]
      raw[di + 1] = data[si + 1]
      raw[di + 2] = data[si + 2]
      raw[di + 3] = data[si + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function cropCell(atlas, col, row) {
  const out = new Uint8ClampedArray(atlas.cellW * atlas.cellH * 4)
  for (let y = 0; y < atlas.cellH; y++) {
    const src = ((row * atlas.cellH + y) * atlas.canvas.width + col * atlas.cellW) * 4
    out.set(atlas.canvas.data.subarray(src, src + atlas.cellW * 4), y * atlas.cellW * 4)
  }
  return out
}

if (preview) {
  const dir = path.join(ROOT, 'sim/.art-preview')
  mkdirSync(dir, { recursive: true })
  for (const id of CHAR_IDS) {
    const file = path.join(dir, `${id}.png`)
    writeFileSync(
      file,
      encodePng(atlases[id].canvas.width, atlases[id].canvas.height, atlases[id].canvas.data, previewScale),
    )
    console.log(`preview: ${file}`)
  }
  const caster = chars.buildGoblinAtlas('caster')
  const casterFile = path.join(dir, 'caster.png')
  writeFileSync(casterFile, encodePng(caster.canvas.width, caster.canvas.height, caster.canvas.data, previewScale))
  console.log(`preview: ${casterFile}`)
  const bullet = chars.buildEnemyBulletAtlas()
  const bulletFile = path.join(dir, 'enemy-bullet.png')
  writeFileSync(bulletFile, encodePng(bullet.canvas.width, bullet.canvas.height, bullet.canvas.data, previewScale * 2))
  console.log(`preview: ${bulletFile}`)
}

const cellArg = process.argv.find((a) => a.startsWith('--cell='))
if (cellArg) {
  const [id, row, col] = cellArg.slice(7).split(',')
  const atlas = id === 'caster' ? chars.buildGoblinAtlas('caster') : id === 'bullet' ? chars.buildEnemyBulletAtlas() : atlases[id]
  if (!atlas) throw new Error(`unknown --cell id ${id}`)
  const dir = path.join(ROOT, 'sim/.art-preview')
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `cell-${id}-r${row}c${col}.png`)
  writeFileSync(file, encodePng(atlas.cellW, atlas.cellH, cropCell(atlas, Number(col), Number(row)), 8))
  console.log(`cell preview: ${file}`)
}

/* ------------------------------------------------------------------ */

for (const f of failures) console.error(`FAIL ${f}`)
if (failures.length > 0) {
  console.error(`\n${passed} passed, ${failures.length} failed`)
  process.exit(1)
}
console.log(`\n${passed} passed`)
