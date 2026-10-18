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

function colorsOf(atlas) {
  const seen = new Map()
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
}

const cellArg = process.argv.find((a) => a.startsWith('--cell='))
if (cellArg) {
  const [id, row, col] = cellArg.slice(7).split(',')
  const atlas = atlases[id]
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
