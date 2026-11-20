/**
 * 场景视觉精修离线预览渲染（纯 Node.js，零浏览器依赖）：
 *   node scripts/preview-scenes.mjs
 * 通过真实像素 Canvas2D 缓冲驱动 src/world/textures.ts 生成 128×128 地面/墙体纹理，
 * 构建完整 TowerFloor 场景树并经 PerspectiveCamera 软光栅化输出 3 阶段 × 1 场景 PNG：
 *   - shots/scene-stage1.png  (阶段 1：云上花庭 · 晨光)
 *   - shots/scene-stage2.png  (阶段 2：星砂观星台 · 暮色)
 *   - shots/scene-stage3.png  (阶段 3：黄铜钟塔 · 齿轮厅)
 */
import * as THREE from 'three'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { createServer } from 'vite'

/* ── 1. 真实像素缓冲 Canvas2D（让 textures.ts 生成真实 128×128 像素纹理）── */
function parseCssColor(str) {
  if (!str || typeof str !== 'string') return [255, 255, 255, 255]
  if (str.startsWith('rgba(') || str.startsWith('rgb(')) {
    const parts = str.slice(str.indexOf('(') + 1, str.indexOf(')')).split(',').map((s) => parseFloat(s.trim()))
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? Math.round(parts[3] * 255) : 255]
  }
  if (str.startsWith('#')) {
    const h = str.slice(1)
    if (h.length === 3) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16), 255]
    }
    if (h.length === 6) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
    }
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
      let tx = 0
      let ty = 0
      const stack = []
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
        save() {
          stack.push({ tx, ty, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha })
        },
        restore() {
          const s = stack.pop()
          if (s) {
            tx = s.tx
            ty = s.ty
            this.fillStyle = s.fillStyle
            this.strokeStyle = s.strokeStyle
            this.globalAlpha = s.globalAlpha
          }
        },
        translate(dx, dy) {
          tx += dx
          ty += dy
        },
        rotate() {},
        scale() {},
        _blend(px, py, r, g, b, a) {
          ensureBuf()
          const ix = Math.floor(px + tx)
          const iy = Math.floor(py + ty)
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
            canvas._buf[idx + 3] = Math.min(255, Math.round(canvas._buf[idx + 3] + a * (1 - canvas._buf[idx + 3] / 255)))
          }
        },
        fillRect(x, y, rw, rh) {
          ensureBuf()
          if (this.fillStyle && typeof this.fillStyle === 'object' && this.fillStyle._grad) {
            const g = this.fillStyle
            const x0 = Math.max(0, Math.floor(x))
            const y0 = Math.max(0, Math.floor(y))
            const x1 = Math.min(canvas.width, Math.ceil(x + rw))
            const y1 = Math.min(canvas.height, Math.ceil(y + rh))
            for (let py = y0; py < y1; py += 1) {
              for (let px = x0; px < x1; px += 1) {
                let t = 0
                if (g.kind === 'radial') {
                  const d = Math.hypot(px - g.x0, py - g.y0)
                  t = Math.max(0, Math.min(1, (d - g.r0) / Math.max(1e-4, g.r1 - g.r0)))
                } else {
                  const dx = g.x1 - g.x0
                  const dy = g.y1 - g.y0
                  const len2 = dx * dx + dy * dy || 1
                  t = Math.max(0, Math.min(1, ((px - g.x0) * dx + (py - g.y0) * dy) / len2))
                }
                const c = g.sample(t)
                this._blend(px, py, c[0], c[1], c[2], c[3])
              }
            }
            return
          }
          const [r, g, b, a] = parseCssColor(this.fillStyle)
          const x0 = Math.floor(x)
          const y0 = Math.floor(y)
          const x1 = Math.ceil(x + rw)
          const y1 = Math.ceil(y + rh)
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) this._blend(px, py, r, g, b, a)
          }
        },
        strokeRect(x, y, rw, rh) {
          const [r, g, b, a] = parseCssColor(this.strokeStyle)
          const x0 = Math.floor(x)
          const y0 = Math.floor(y)
          const x1 = Math.floor(x + rw)
          const y1 = Math.floor(y + rh)
          for (let px = x0; px <= x1; px += 1) {
            this._blend(px, y0, r, g, b, a)
            this._blend(px, y1, r, g, b, a)
          }
          for (let py = y0; py <= y1; py += 1) {
            this._blend(x0, py, r, g, b, a)
            this._blend(x1, py, r, g, b, a)
          }
        },
        clearRect(x, y, rw, rh) {
          ensureBuf()
          const x0 = Math.max(0, Math.floor(x))
          const y0 = Math.max(0, Math.floor(y))
          const x1 = Math.min(canvas.width, Math.ceil(x + rw))
          const y1 = Math.min(canvas.height, Math.ceil(y + rh))
          for (let py = y0; py < y1; py += 1) {
            for (let px = x0; px < x1; px += 1) {
              const idx = (py * canvas.width + px) * 4
              canvas._buf[idx] = 0
              canvas._buf[idx + 1] = 0
              canvas._buf[idx + 2] = 0
              canvas._buf[idx + 3] = 0
            }
          }
        },
        beginPath() {
          pathPts.length = 0
        },
        moveTo(x, y) {
          pathPts.push([x, y, true])
        },
        lineTo(x, y) {
          pathPts.push([x, y, false])
        },
        closePath() {
          if (pathPts.length > 1) pathPts.push([pathPts[0][0], pathPts[0][1], false])
        },
        arc(cx, cy, r, a0, a1) {
          const steps = 16
          for (let i = 0; i <= steps; i += 1) {
            const a = a0 + ((a1 - a0) * i) / steps
            pathPts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, i === 0])
          }
        },
        ellipse(cx, cy, rx, ry, rot, a0, a1) {
          const steps = 14
          for (let i = 0; i <= steps; i += 1) {
            const a = a0 + ((a1 - a0) * i) / steps
            const lx = Math.cos(a) * rx
            const ly = Math.sin(a) * ry
            const px = cx + lx * Math.cos(rot) - ly * Math.sin(rot)
            const py = cy + lx * Math.sin(rot) + ly * Math.cos(rot)
            pathPts.push([px, py, i === 0])
          }
        },
        stroke() {
          const [r, g, b, a] = parseCssColor(this.strokeStyle)
          for (let i = 1; i < pathPts.length; i += 1) {
            if (pathPts[i][2]) continue
            const [x0, y0] = pathPts[i - 1]
            const [x1, y1] = pathPts[i]
            const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)))
            for (let s = 0; s <= steps; s += 1) {
              this._blend(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, r, g, b, a)
            }
          }
        },
        fill() {
          if (pathPts.length < 3) return
          const [r, g, b, a] = parseCssColor(this.fillStyle)
          let minX = Infinity
          let maxX = -Infinity
          let minY = Infinity
          let maxY = -Infinity
          for (const [px, py] of pathPts) {
            if (px < minX) minX = px
            if (px > maxX) maxX = px
            if (py < minY) minY = py
            if (py > maxY) maxY = py
          }
          for (let py = Math.floor(minY); py <= Math.ceil(maxY); py += 1) {
            for (let px = Math.floor(minX); px <= Math.ceil(maxX); px += 1) {
              let inside = false
              for (let i = 0, j = pathPts.length - 1; i < pathPts.length; j = i++) {
                const xi = pathPts[i][0]
                const yi = pathPts[i][1]
                const xj = pathPts[j][0]
                const yj = pathPts[j][1]
                if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-6) + xi) inside = !inside
              }
              if (inside) this._blend(px, py, r, g, b, a)
            }
          }
        },
        createRadialGradient(x0, y0, r0, x1, y1, r1) {
          const stops = []
          return {
            _grad: true,
            kind: 'radial',
            x0,
            y0,
            r0,
            x1,
            y1,
            r1,
            addColorStop(t, col) {
              stops.push([t, parseCssColor(col)])
              stops.sort((a, b) => a[0] - b[0])
            },
            sample(t) {
              if (!stops.length) return [0, 0, 0, 0]
              if (t <= stops[0][0]) return stops[0][1]
              if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1]
              for (let i = 1; i < stops.length; i += 1) {
                if (t <= stops[i][0]) {
                  const k = (t - stops[i - 1][0]) / Math.max(1e-4, stops[i][0] - stops[i - 1][0])
                  const c0 = stops[i - 1][1]
                  const c1 = stops[i][1]
                  return [
                    c0[0] + (c1[0] - c0[0]) * k,
                    c0[1] + (c1[1] - c0[1]) * k,
                    c0[2] + (c1[2] - c0[2]) * k,
                    c0[3] + (c1[3] - c0[3]) * k,
                  ]
                }
              }
              return stops[stops.length - 1][1]
            },
          }
        },
        createLinearGradient(x0, y0, x1, y1) {
          const stops = []
          return {
            _grad: true,
            kind: 'linear',
            x0,
            y0,
            x1,
            y1,
            addColorStop(t, col) {
              stops.push([t, parseCssColor(col)])
              stops.sort((a, b) => a[0] - b[0])
            },
            sample(t) {
              if (!stops.length) return [0, 0, 0, 0]
              if (t <= stops[0][0]) return stops[0][1]
              if (t >= stops[stops.length - 1][0]) return stops[stops.length - 1][1]
              for (let i = 1; i < stops.length; i += 1) {
                if (t <= stops[i][0]) {
                  const k = (t - stops[i - 1][0]) / Math.max(1e-4, stops[i][0] - stops[i - 1][0])
                  const c0 = stops[i - 1][1]
                  const c1 = stops[i][1]
                  return [
                    c0[0] + (c1[0] - c0[0]) * k,
                    c0[1] + (c1[1] - c0[1]) * k,
                    c0[2] + (c1[2] - c0[2]) * k,
                    c0[3] + (c1[3] - c0[3]) * k,
                  ]
                }
              }
              return stops[stops.length - 1][1]
            },
          }
        },
        createImageData: (cw, ch) => ({ width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) }),
        putImageData() {},
        quadraticCurveTo(cpx, cpy, x, y) {
          pathPts.push([x, y, false])
        },
        bezierCurveTo(_a, _b, _c, _d, x, y) {
          pathPts.push([x, y, false])
        },
        roundRect(x, y, rw, rh) {
          this.fillRect(x, y, rw, rh)
        },
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

/* ── 2. PNG 编码器 ─────────────────────────────────────────────────────── */
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

/* ── 3. Z-Buffer 软光栅化（支持真实 CanvasTexture 采样 + 光照 + 加法发光）── */
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

function renderSceneToPng(scene, camera, width, height, outPath) {
  const fb = Buffer.alloc(width * height * 4)
  const zbuf = new Float32Array(width * height)
  zbuf.fill(Infinity)

  const bg = scene.background instanceof THREE.Color ? scene.background : new THREE.Color(0x161a24)
  const bgR = Math.round(bg.r * 255)
  const bgG = Math.round(bg.g * 255)
  const bgB = Math.round(bg.b * 255)
  for (let i = 0; i < width * height; i += 1) {
    fb[i * 4] = bgR
    fb[i * 4 + 1] = bgG
    fb[i * 4 + 2] = bgB
    fb[i * 4 + 3] = 255
  }

  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)

  // 提取主光方向与雾参数
  const keyDir = new THREE.Vector3(-0.35, 0.85, 0.4).normalize()
  let keyCol = new THREE.Color(0xfff4e0)
  let hemiSky = new THREE.Color(0xc8e4ff)
  let hemiGround = new THREE.Color(0x667080)
  scene.traverse((obj) => {
    if (obj.isDirectionalLight && obj.castShadow) {
      keyDir.copy(obj.position).normalize()
      keyCol = obj.color.clone()
    } else if (obj.isHemisphereLight) {
      hemiSky = obj.color.clone()
      hemiGround = obj.groundColor.clone()
    }
  })
  const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : null
  const fogR = fog ? fog.color.r * 255 : bgR
  const fogG = fog ? fog.color.g * 255 : bgG
  const fogB = fog ? fog.color.b * 255 : bgB

  const opaqueList = []
  const transparentList = []

  scene.traverse((obj) => {
    if (!obj.visible || !obj.isMesh || !obj.geometry) return
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material
    if (!mat || mat.visible === false || (mat.opacity !== undefined && mat.opacity <= 0.01)) return
    const bucket = mat.transparent || mat.blending === THREE.AdditiveBlending ? transparentList : opaqueList
    if (obj.isInstancedMesh) {
      const m = new THREE.Matrix4()
      const worldM = new THREE.Matrix4()
      for (let i = 0; i < obj.count; i += 1) {
        obj.getMatrixAt(i, m)
        // 跳过零缩放隐藏实例
        if (m.elements[0] === 0 && m.elements[5] === 0 && m.elements[10] === 0) continue
        worldM.multiplyMatrices(obj.matrixWorld, m)
        bucket.push({ geo: obj.geometry, mat, matrix: worldM.clone() })
      }
    } else {
      let geo = obj.geometry
      if (geo.type === 'PlaneGeometry' && geo.parameters && geo.parameters.width > 20) {
        geo = new THREE.PlaneGeometry(geo.parameters.width, geo.parameters.height, 24, 24)
      }
      bucket.push({ geo, mat, matrix: obj.matrixWorld.clone() })
    }
  })

  const v0 = new THREE.Vector3()
  const v1 = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  const p0 = new THREE.Vector4()
  const p1 = new THREE.Vector4()
  const p2 = new THREE.Vector4()
  const e1 = new THREE.Vector3()
  const e2 = new THREE.Vector3()
  const normal = new THREE.Vector3()

  function drawMeshEntry({ geo, mat, matrix }, isTransparent) {
    const pos = geo.attributes.position
    const uv = geo.attributes.uv
    if (!pos) return
    const index = geo.index
    const triCount = index ? index.count / 3 : pos.count / 3
    const baseCol = mat.color ? mat.color : new THREE.Color(0xffffff)
    const emiCol = mat.emissive ? mat.emissive : new THREE.Color(0x000000)
    const emiInt = mat.emissiveIntensity ?? 0
    const additive = mat.blending === THREE.AdditiveBlending
    const opacity = mat.opacity ?? 1
    const unlit = Boolean(mat.isMeshBasicMaterial)
    const map = mat.map || null

    for (let t = 0; t < triCount; t += 1) {
      const i0 = index ? index.getX(t * 3) : t * 3
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2
      v0.fromBufferAttribute(pos, i0).applyMatrix4(matrix)
      v1.fromBufferAttribute(pos, i1).applyMatrix4(matrix)
      v2.fromBufferAttribute(pos, i2).applyMatrix4(matrix)

      p0.set(v0.x, v0.y, v0.z, 1).applyMatrix4(vp)
      p1.set(v1.x, v1.y, v1.z, 1).applyMatrix4(vp)
      p2.set(v2.x, v2.y, v2.z, 1).applyMatrix4(vp)
      if (p0.w <= 0.2 || p1.w <= 0.2 || p2.w <= 0.2) continue

      const sx0 = (p0.x / p0.w * 0.5 + 0.5) * width
      const sy0 = (0.5 - p0.y / p0.w * 0.5) * height
      const sx1 = (p1.x / p1.w * 0.5 + 0.5) * width
      const sy1 = (0.5 - p1.y / p1.w * 0.5) * height
      const sx2 = (p2.x / p2.w * 0.5 + 0.5) * width
      const sy2 = (0.5 - p2.y / p2.w * 0.5) * height

      const area = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0)
      if (Math.abs(area) < 0.25) continue

      const minX = Math.max(0, Math.floor(Math.min(sx0, sx1, sx2)))
      const maxX = Math.min(width - 1, Math.ceil(Math.max(sx0, sx1, sx2)))
      const minY = Math.max(0, Math.floor(Math.min(sy0, sy1, sy2)))
      const maxY = Math.min(height - 1, Math.ceil(Math.max(sy0, sy1, sy2)))
      if (minX > maxX || minY > maxY) continue

      e1.subVectors(v1, v0)
      e2.subVectors(v2, v0)
      normal.crossVectors(e1, e2).normalize()
      const ndl = Math.max(0, normal.dot(keyDir))
      const hemiT = normal.y * 0.5 + 0.5
      const lightR = unlit ? 1 : (hemiGround.r * (1 - hemiT) + hemiSky.r * hemiT) * 0.62 + keyCol.r * ndl * 0.68
      const lightG = unlit ? 1 : (hemiGround.g * (1 - hemiT) + hemiSky.g * hemiT) * 0.62 + keyCol.g * ndl * 0.68
      const lightB = unlit ? 1 : (hemiGround.b * (1 - hemiT) + hemiSky.b * hemiT) * 0.62 + keyCol.b * ndl * 0.68

      const u0 = uv ? uv.getX(i0) : 0
      const uv0 = uv ? uv.getY(i0) : 0
      const u1 = uv ? uv.getX(i1) : 0
      const uv1 = uv ? uv.getY(i1) : 0
      const u2 = uv ? uv.getX(i2) : 0
      const uv2 = uv ? uv.getY(i2) : 0

      const invA = 1 / area
      for (let py = minY; py <= maxY; py += 1) {
        for (let px = minX; px <= maxX; px += 1) {
          const w0 = ((sx1 - px) * (sy2 - py) - (sy1 - py) * (sx2 - px)) * invA
          const w1 = ((sx2 - px) * (sy0 - py) - (sy2 - py) * (sx0 - px)) * invA
          const w2 = 1 - w0 - w1
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue

          const invW = w0 / p0.w + w1 / p1.w + w2 / p2.w
          const depth = 1 / invW
          const zIdx = py * width + px
          if (depth >= zbuf[zIdx]) continue

          let tr = 255
          let tg = 255
          let tb = 255
          let ta = 255
          if (map && uv) {
            const uu = (w0 * (u0 / p0.w) + w1 * (u1 / p1.w) + w2 * (u2 / p2.w)) * depth
            const vv = (w0 * (uv0 / p0.w) + w1 * (uv1 / p1.w) + w2 * (uv2 / p2.w)) * depth
            const texel = sampleTexture(map, uu, vv)
            if (texel) {
              tr = texel[0]
              tg = texel[1]
              tb = texel[2]
              ta = texel[3]
            }
          }
          const alpha = (ta / 255) * opacity
          if (alpha < 0.02) continue

          let r = Math.min(255, tr * baseCol.r * lightR + emiCol.r * emiInt * 255)
          let g = Math.min(255, tg * baseCol.g * lightG + emiCol.g * emiInt * 255)
          let b = Math.min(255, tb * baseCol.b * lightB + emiCol.b * emiInt * 255)

          if (fog && !additive) {
            const f = Math.exp(-Math.pow(fog.density * depth * 0.9, 2))
            r = r * f + fogR * (1 - f)
            g = g * f + fogG * (1 - f)
            b = b * f + fogB * (1 - f)
          }

          const out = zIdx * 4
          if (!isTransparent && alpha >= 0.98) {
            zbuf[zIdx] = depth
            fb[out] = Math.max(0, Math.min(255, r | 0))
            fb[out + 1] = Math.max(0, Math.min(255, g | 0))
            fb[out + 2] = Math.max(0, Math.min(255, b | 0))
            fb[out + 3] = 255
          } else if (additive) {
            fb[out] = Math.min(255, (fb[out] + r * alpha) | 0)
            fb[out + 1] = Math.min(255, (fb[out + 1] + g * alpha) | 0)
            fb[out + 2] = Math.min(255, (fb[out + 2] + b * alpha) | 0)
          } else {
            const inv = 1 - alpha
            fb[out] = Math.max(0, Math.min(255, (fb[out] * inv + r * alpha) | 0))
            fb[out + 1] = Math.max(0, Math.min(255, (fb[out + 1] * inv + g * alpha) | 0))
            fb[out + 2] = Math.max(0, Math.min(255, (fb[out + 2] * inv + b * alpha) | 0))
          }
        }
      }
    }
  }

  for (const e of opaqueList) drawMeshEntry(e, false)
  for (const e of transparentList) drawMeshEntry(e, true)

  writeFileSync(outPath, encodePng(fb, width, height))
}

/* ── 4. 渲染 3 阶段 × 每阶段 1 场景 ─────────────────────────────────────── */
const OUT_DIR = path.resolve('shots')
mkdirSync(OUT_DIR, { recursive: true })

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { TowerFloor } = await server.ssrLoadModule('/src/world/floor.ts')
  const { STAGE_SCENES } = await server.ssrLoadModule('/src/data/stages.ts')

  const TARGETS = [
    { def: STAGE_SCENES[0][0], file: 'scene-stage1.png' },
    { def: STAGE_SCENES[1][0], file: 'scene-stage2.png' },
    { def: STAGE_SCENES[2][0], file: 'scene-stage3.png' },
  ]

  for (const { def, file } of TARGETS) {
    const scene = new THREE.Scene()
    const floor = new TowerFloor(scene)
    floor.build(def)
    floor.setWallHidden('south', true)
    for (let i = 0; i < 36; i += 1) floor.update(0.05, i * 0.05)

    const half = def.halfSize
    const camera = new THREE.PerspectiveCamera(44, 960 / 540, 0.5, 160)
    camera.position.set(half * 0.36, half * 1.15, half * 1.38)
    camera.lookAt(0, 0.6, -half * 0.14)

    const outPath = path.join(OUT_DIR, file)
    renderSceneToPng(scene, camera, 960, 540, outPath)
    floor.dispose()
    const kb = Math.round(statSync(outPath).size / 1024)
    console.log(`RENDERED  shots/${file}  (${kb} KB)  — Stage ${def.stage} · ${def.name}`)
  }
} finally {
  await server.close()
}
