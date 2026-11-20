/**
 * 三类物件精细化离线多角度预览（纯 Node.js，零浏览器依赖）：
 *   node scripts/preview-props.mjs
 * 输出：shots/props.png（3 行 × 2 列 = 6 视口）：
 *   - 第 1 行：障碍物（木箱/木桶/石柱/碎石，含程序化木纹/铁箍/石纹与 3 色变体，前 3/4 与侧俯两角度）
 *   - 第 2 行：宝箱（左：未开态含锁扣微光呼吸；右：已开态含翻盖、暗化锁扣与内衬）
 *   - 第 3 行：祭坛（玄武岩刻纹底座 + 发光献祭凹槽 + 6 枚浮动符文微粒，正 3/4 与侧俯两角度）
 */
import * as THREE from 'three'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createServer } from 'vite'

/* ── 1. 真实像素缓冲 Canvas2D ──────────────────────────────────────────── */
function parseCssColor(str) {
  if (!str || typeof str !== 'string') return [255, 255, 255, 255]
  if (str.startsWith('rgba(') || str.startsWith('rgb(')) {
    const parts = str.slice(str.indexOf('(') + 1, str.indexOf(')')).split(',').map((s) => parseFloat(s.trim()))
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? Math.round(parts[3] * 255) : 255]
  }
  if (str.startsWith('#')) {
    const h = str.slice(1)
    if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255]
    if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
  }
  return [255, 255, 255, 255]
}

function makePixelCanvas(w = 64, h = 64) {
  const canvas = {
    width: w,
    height: h,
    style: {},
    _buf: new Uint8ClampedArray(w * h * 4),
    _ctx: null,
    getContext() {
      if (this._ctx) return this._ctx
      const ensureBuf = () => {
        const need = Math.max(1, this.width) * Math.max(1, this.height) * 4
        if (this._buf.length !== need) this._buf = new Uint8ClampedArray(need)
      }
      const pathPts = []
      const ctx = {
        canvas: this,
        fillStyle: '#000',
        strokeStyle: '#000',
        lineWidth: 1,
        globalAlpha: 1,
        imageSmoothingEnabled: false,
        shadowColor: 'rgba(0,0,0,0)',
        shadowBlur: 0,
        save() {},
        restore() {},
        translate() {},
        rotate() {},
        scale() {},
        _blend(px, py, r, g, b, a) {
          ensureBuf()
          const ix = Math.floor(px)
          const iy = Math.floor(py)
          if (ix < 0 || ix >= canvas.width || iy < 0 || iy >= canvas.height) return
          const alpha = (a / 255) * this.globalAlpha
          if (alpha <= 0) return
          const idx = (iy * canvas.width + ix) * 4
          if (alpha >= 0.999) {
            canvas._buf[idx] = r
            canvas._buf[idx + 1] = g
            canvas._buf[idx + 2] = b
            canvas._buf[idx + 3] = 255
          } else {
            const inv = 1 - alpha
            canvas._buf[idx] = Math.round(canvas._buf[idx] * inv + r * alpha)
            canvas._buf[idx + 1] = Math.round(canvas._buf[idx + 1] * inv + g * alpha)
            canvas._buf[idx + 2] = Math.round(canvas._buf[idx + 2] * inv + b * alpha)
            canvas._buf[idx + 3] = 255
          }
        },
        fillRect(x, y, rw, rh) {
          if (typeof this.fillStyle !== 'string') return
          const [r, g, b, a] = parseCssColor(this.fillStyle)
          for (let py = Math.floor(y); py < Math.ceil(y + rh); py += 1) {
            for (let px = Math.floor(x); px < Math.ceil(x + rw); px += 1) this._blend(px, py, r, g, b, a)
          }
        },
        strokeRect(x, y, rw, rh) {
          const [r, g, b, a] = parseCssColor(this.strokeStyle)
          const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.floor(x + rw), y1 = Math.floor(y + rh)
          for (let px = x0; px <= x1; px += 1) { this._blend(px, y0, r, g, b, a); this._blend(px, y1, r, g, b, a) }
          for (let py = y0; py <= y1; py += 1) { this._blend(x0, py, r, g, b, a); this._blend(x1, py, r, g, b, a) }
        },
        clearRect() {},
        beginPath() { pathPts.length = 0 },
        moveTo(x, y) { pathPts.push([x, y, true]) },
        lineTo(x, y) { pathPts.push([x, y, false]) },
        closePath() {},
        arc() {},
        ellipse() {},
        stroke() {
          const [r, g, b, a] = parseCssColor(this.strokeStyle)
          for (let i = 1; i < pathPts.length; i += 1) {
            if (pathPts[i][2]) continue
            const [x0, y0] = pathPts[i - 1], [x1, y1] = pathPts[i]
            const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
            for (let s = 0; s <= steps; s += 1) {
              this._blend(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, g, b, a)
            }
          }
        },
        fill() {},
        createRadialGradient() { return { addColorStop() {} } },
        createLinearGradient() { return { addColorStop() {} } },
        createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData() {},
        setLineDash() {},
        clip() {},
      }
      this._ctx = ctx
      return ctx
    },
  }
  return canvas
}

globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') return makePixelCanvas(64, 64)
    return { style: {} }
  },
}
if (!globalThis.performance) globalThis.performance = { now: () => Date.now() }

/* ── 2. PNG 编码与软光栅渲染到指定子视口 ──────────────────────────────── */
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}
function encodePng(rgba, width, height) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })), pngChunk('IEND', Buffer.alloc(0))])
}

function sampleTexture(tex, u, v) {
  const img = tex?.image
  if (!img || !img._buf) return null
  const repX = tex.repeat?.x ?? 1
  const repY = tex.repeat?.y ?? 1
  const uu = ((u * repX) % 1 + 1) % 1
  const vv = ((v * repY) % 1 + 1) % 1
  const px = Math.min(img.width - 1, Math.floor(uu * img.width))
  const py = Math.min(img.height - 1, Math.floor((1 - vv) * img.height))
  const idx = (py * img.width + px) * 4
  return [img._buf[idx], img._buf[idx + 1], img._buf[idx + 2], img._buf[idx + 3]]
}

function renderViewport(fb, fbW, vx, vy, vw, vh, scene, camera, bgHex = 0x1b2234) {
  const zbuf = new Float32Array(vw * vh)
  zbuf.fill(Infinity)
  const bgR = (bgHex >> 16) & 255
  const bgG = (bgHex >> 8) & 255
  const bgB = bgHex & 255
  for (let y = 0; y < vh; y += 1) {
    for (let x = 0; x < vw; x += 1) {
      const idx = ((vy + y) * fbW + (vx + x)) * 4
      fb[idx] = bgR
      fb[idx + 1] = bgG
      fb[idx + 2] = bgB
      fb[idx + 3] = 255
    }
  }

  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  const keyDir = new THREE.Vector3(0.42, 0.82, 0.45).normalize()

  const opaque = []
  const transparent = []
  const instCol = new THREE.Color()
  scene.traverse((obj) => {
    if (!obj.visible || !obj.isMesh || !obj.geometry) return
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
    if (!mat || mat.visible === false || (mat.opacity !== undefined && mat.opacity <= 0.01)) return
    const bucket = mat.transparent || mat.blending === THREE.AdditiveBlending ? transparent : opaque
    if (obj.isInstancedMesh) {
      const m = new THREE.Matrix4()
      const wm = new THREE.Matrix4()
      for (let i = 0; i < obj.count; i += 1) {
        obj.getMatrixAt(i, m)
        if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue
        wm.multiplyMatrices(obj.matrixWorld, m)
        let tint = null
        if (obj.instanceColor) {
          obj.getColorAt(i, instCol)
          tint = instCol.clone()
        }
        bucket.push({ geo: obj.geometry, mat, matrix: wm.clone(), tint })
      }
    } else {
      let geo = obj.geometry
      if (geo.type === 'PlaneGeometry' && geo.parameters && geo.parameters.width > 12) {
        geo = new THREE.PlaneGeometry(geo.parameters.width, geo.parameters.height, 12, 12)
      }
      bucket.push({ geo, mat, matrix: obj.matrixWorld.clone(), tint: null })
    }
  })

  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3()
  const p0 = new THREE.Vector4(), p1 = new THREE.Vector4(), p2 = new THREE.Vector4()
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), normal = new THREE.Vector3()

  function draw({ geo, mat, matrix, tint }, isTrans) {
    const pos = geo.attributes.position
    const uv = geo.attributes.uv
    if (!pos) return
    const index = geo.index
    const tris = index ? index.count / 3 : pos.count / 3
    const baseCol = mat.color ? mat.color.clone() : new THREE.Color(0xffffff)
    if (tint) baseCol.multiply(tint)
    const emiCol = mat.emissive ? mat.emissive : new THREE.Color(0x000000)
    const emiInt = mat.emissiveIntensity ?? 0
    const additive = mat.blending === THREE.AdditiveBlending
    const opacity = mat.opacity ?? 1
    const unlit = Boolean(mat.isMeshBasicMaterial)
    const map = mat.map || null

    for (let t = 0; t < tris; t += 1) {
      const i0 = index ? index.getX(t * 3) : t * 3
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      v0.fromBufferAttribute(pos, i0).applyMatrix4(matrix)
      v1.fromBufferAttribute(pos, i1).applyMatrix4(matrix)
      v2.fromBufferAttribute(pos, i2).applyMatrix4(matrix)
      p0.set(v0.x, v0.y, v0.z, 1).applyMatrix4(vp)
      p1.set(v1.x, v1.y, v1.z, 1).applyMatrix4(vp)
      p2.set(v2.x, v2.y, v2.z, 1).applyMatrix4(vp)
      if (p0.w <= 0.1 || p1.w <= 0.1 || p2.w <= 0.1) continue

      const sx0 = (p0.x / p0.w * 0.5 + 0.5) * vw
      const sy0 = (0.5 - p0.y / p0.w * 0.5) * vh
      const sx1 = (p1.x / p1.w * 0.5 + 0.5) * vw
      const sy1 = (0.5 - p1.y / p1.w * 0.5) * vh
      const sx2 = (p2.x / p2.w * 0.5 + 0.5) * vw
      const sy2 = (0.5 - p2.y / p2.w * 0.5) * vh
      const area = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0)
      if (Math.abs(area) < 0.25) continue

      const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)))
      const maxX = Math.min(vw - 1, Math.ceil(Math.max(sx0, sx1, sx2)))
      const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)))
      const maxY = Math.min(vh - 1, Math.ceil(Math.max(sy0, sy1, sy2)))
      if (minX > maxX || minY > maxY) continue

      e1.subVectors(v1, v0)
      e2.subVectors(v2, v0)
      normal.crossVectors(e1, e2).normalize()
      const light = unlit ? 1 : 0.45 + Math.max(0, normal.dot(keyDir)) * 0.72

      const u0 = uv ? uv.getX(i0) : 0, uv0 = uv ? uv.getY(i0) : 0
      const u1 = uv ? uv.getX(i1) : 0, uv1 = uv ? uv.getY(i1) : 0
      const u2 = uv ? uv.getX(i2) : 0, uv2 = uv ? uv.getY(i2) : 0
      const invA = 1 / area

      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const w0 = ((sx1 - px) * (sy2 - py) - (sy1 - py) * (sx2 - px)) * invA
          const w1 = ((sx2 - px) * (sy0 - py) - (sy2 - py) * (sx0 - px)) * invA
          const w2 = 1 - w0 - w1
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue
          const depth = 1 / (w0 / p0.w + w1 / p1.w + w2 / p2.w)
          const zIdx = py * vw + px
          if (depth >= zbuf[zIdx]) continue

          let tr = 255, tg = 255, tb = 255, ta = 255
          if (map && uv) {
            const uu = (w0 * (u0 / p0.w) + w1 * (u1 / p1.w) + w2 * (u2 / p2.w)) * depth
            const vv = (w0 * (uv0 / p0.w) + w1 * (uv1 / p1.w) + w2 * (uv2 / p2.w)) * depth
            const texel = sampleTexture(map, uu, vv)
            if (texel) { tr = texel[0]; tg = texel[1]; tb = texel[2]; ta = texel[3] }
          }
          const alpha = (ta / 255) * opacity
          if (alpha < 0.02) continue

          const r = Math.min(255, tr * baseCol.r * light + emiCol.r * emiInt * 255)
          const g = Math.min(255, tg * baseCol.g * light + emiCol.g * emiInt * 255)
          const b = Math.min(255, tb * baseCol.b * light + emiCol.b * emiInt * 255)
          const out = ((vy + py) * fbW + (vx + px)) * 4
          if (!isTrans && alpha >= 0.98) {
            zbuf[zIdx] = depth
            fb[out] = r | 0
            fb[out + 1] = g | 0
            fb[out + 2] = b | 0
            fb[out + 3] = 255
          } else if (additive) {
            fb[out] = Math.min(255, (fb[out] + r * alpha) | 0)
            fb[out + 1] = Math.min(255, (fb[out + 1] + g * alpha) | 0)
            fb[out + 2] = Math.min(255, (fb[out + 2] + b * alpha) | 0)
          } else {
            const inv = 1 - alpha
            fb[out] = (fb[out] * inv + r * alpha) | 0
            fb[out + 1] = (fb[out + 1] * inv + g * alpha) | 0
            fb[out + 2] = (fb[out + 2] * inv + b * alpha) | 0
          }
        }
      }
    }
  }

  for (const e of opaque) draw(e, false)
  for (const e of transparent) draw(e, true)
}

function addPropShowcase(scene, kind, x, z, tintHex = 0xffffff) {
  const g = new THREE.Group()
  g.position.set(x, 0, z)
  const c = new THREE.Color(tintHex)
  for (const part of kind.parts) {
    const mat = part.mat.clone()
    if (mat.color) mat.color.multiply(c)
    const m = new THREE.Mesh(part.geo, mat)
    m.position.set(part.pos[0], part.pos[1], part.pos[2])
    m.scale.set(part.scale[0], part.scale[1], part.scale[2])
    if (part.rot) m.rotation.set(part.rot[0], part.rot[1], part.rot[2])
    g.add(m)
  }
  scene.add(g)
}

/* ── 3. 拼装 3 行 × 2 列物件预览图 shots/props.png ─────────────────────── */
const CELL_W = 460
const CELL_H = 300
const GAP = 12
const PAD = 16
const W = PAD * 2 + CELL_W * 2 + GAP
const H = PAD * 2 + CELL_H * 3 + GAP * 2
const fb = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i += 1) {
  fb[i * 4] = 14
  fb[i * 4 + 1] = 17
  fb[i * 4 + 2] = 26
  fb[i * 4 + 3] = 255
}

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { PropSet } = await server.ssrLoadModule('/src/world/props.ts')
  const { TowerFloor } = await server.ssrLoadModule('/src/world/floor.ts')
  const { THEMES_V3 } = await server.ssrLoadModule('/src/world/themes.ts')

  // Row 1: 障碍物（木箱 3 变体 + 木桶 3 变体 + 苔石柱 + 碎石）
  {
    const s = new THREE.Scene()
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 10, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3f4e48, roughness: 0.95 }),
    )
    ground.rotation.x = -Math.PI / 2
    s.add(ground)

    const props = new PropSet(THEMES_V3['stage1-hall'])
    const crate = props.kinds.find((k) => k.key === 'crate')
    const barrel = props.kinds.find((k) => k.key === 'barrel')
    const pillar = props.kinds.find((k) => k.key === 'moss-pillar')
    const rubble = props.kinds.find((k) => k.key === 'rubble')
    const crateCols = crate?.variantColors ?? [0xffffff, 0xe8d2b8, 0xcab098]
    const barrelCols = barrel?.variantColors ?? [0xffffff, 0xe4cbb0, 0xc6a88c]
    if (crate) {
      addPropShowcase(s, crate, -2.5, 0.9, crateCols[0])
      addPropShowcase(s, crate, -1.1, 0.9, crateCols[1])
      addPropShowcase(s, crate, 0.3, 0.9, crateCols[2])
    }
    if (barrel) {
      addPropShowcase(s, barrel, -2.3, -1.0, barrelCols[0])
      addPropShowcase(s, barrel, -1.1, -1.0, barrelCols[1])
      addPropShowcase(s, barrel, 0.1, -1.0, barrelCols[2])
    }
    if (pillar) addPropShowcase(s, pillar, 2.0, -0.5, 0xffffff)
    if (rubble) addPropShowcase(s, rubble, 2.1, 1.2, 0xe2e8f0)

    const cam1 = new THREE.PerspectiveCamera(40, CELL_W / CELL_H, 0.2, 50)
    cam1.position.set(0.2, 3.3, 5.4)
    cam1.lookAt(0, 0.7, 0)
    renderViewport(fb, W, PAD, PAD, CELL_W, CELL_H, s, cam1, 0x26323a)

    const cam2 = new THREE.PerspectiveCamera(40, CELL_W / CELL_H, 0.2, 50)
    cam2.position.set(-4.6, 4.1, 3.4)
    cam2.lookAt(0, 0.6, 0)
    renderViewport(fb, W, PAD + CELL_W + GAP, PAD, CELL_W, CELL_H, s, cam2, 0x26323a)
    props.dispose()
  }

  // Row 2: 宝箱（左：未开态 + 锁扣呼吸微光；右：已开态 + 翻盖 + 丝绒内衬）
  {
    const s = new THREE.Scene()
    const floor = new TowerFloor(s)
    floor.build({
      id: 'preview-chest',
      name: '宝箱预览',
      subtitle: '',
      themeId: 'stage3-frost',
      stage: 3,
      halfSize: 15,
      props: 6,
      accent: '#ffd066',
    })
    floor.update(0.4, 0.4)
    const cache = floor['caches']?.[0]
    if (cache) {
      const cx = cache.x
      const cz = cache.z
      const rot = cache.group.rotation.y
      const fx = Math.sin(rot)
      const fz = -Math.cos(rot)
      const camClosed = new THREE.PerspectiveCamera(36, CELL_W / CELL_H, 0.1, 50)
      camClosed.position.set(cx + fx * 2.1 + fz * 1.1, 1.45, cz + fz * 2.1 - fx * 1.1)
      camClosed.lookAt(cx, 0.45, cz)
      renderViewport(fb, W, PAD, PAD + CELL_H + GAP, CELL_W, CELL_H, s, camClosed, 0x2b241d)

      // 切换为已开态并推进翻盖动画
      cache.used = true
      for (let i = 0; i < 20; i += 1) floor.update(0.05, 0.4 + i * 0.05)
      renderViewport(fb, W, PAD + CELL_W + GAP, PAD + CELL_H + GAP, CELL_W, CELL_H, s, camClosed, 0x2b241d)
    }
    floor.dispose()
  }

  // Row 3: 祭坛（无 landmark 的场景，直接渲染 buildAltar：玄武岩刻纹底座 + 发光凹槽 + 6 枚浮动符文微粒）
  {
    const s = new THREE.Scene()
    const floor = new TowerFloor(s)
    floor.build({
      id: 'preview-altar',
      name: '祭坛预览',
      subtitle: '',
      themeId: 'stage2-forge',
      stage: 2,
      halfSize: 16,
      props: 4,
      accent: '#c98eff',
    })
    for (let i = 0; i < 20; i += 1) floor.update(0.05, i * 0.05)

    const camA1 = new THREE.PerspectiveCamera(40, CELL_W / CELL_H, 0.2, 60)
    camA1.position.set(0.4, 2.7, 5.2)
    camA1.lookAt(0, 1.0, 0)
    renderViewport(fb, W, PAD, PAD + (CELL_H + GAP) * 2, CELL_W, CELL_H, s, camA1, 0x1b1d33)

    const camA2 = new THREE.PerspectiveCamera(40, CELL_W / CELL_H, 0.2, 60)
    camA2.position.set(-4.2, 4.4, 3.6)
    camA2.lookAt(0, 0.9, 0)
    renderViewport(fb, W, PAD + CELL_W + GAP, PAD + (CELL_H + GAP) * 2, CELL_W, CELL_H, s, camA2, 0x1b1d33)
    floor.dispose()
  }

  const outDir = path.resolve('shots')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'props.png')
  writeFileSync(outPath, encodePng(fb, W, H))
  const kb = Math.round(statSync(outPath).size / 1024)
  console.log(`RENDERED  shots/props.png  (${kb} KB, ${W}x${H})`)
} finally {
  await server.close()
}
