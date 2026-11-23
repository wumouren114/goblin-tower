import * as THREE from 'three'
import type { ThemeLike } from './themes'
import { familyOf } from './themes'
import { artReady, artTexture, type ArtKey } from '../art/atlasImport'

/**
 * ============================================================
 *  场景道具库（沙盒像素风 · Voxel 方块拼装 + 16×16 像素贴图）
 *  - 每层主题 4 种道具，全部由共享 BoxGeometry 拼装成方块体素造型
 *  - 表面贴图使用 16×16 程序化像素画（NearestFilter，无渐变，模块级画布缓存）
 *  - 摆放时按「几何 + 材质」合并为 InstancedMesh（drawcall 极低）
 *  - 保持每种道具的 key / weight / colliderR / variantColors 与原版完全一致
 * ============================================================
 */

/** 道具的一个零件：单位几何体 + 材质 + 相对道具原点的位移/旋转/缩放 */
export interface PropPart {
  geo: THREE.BufferGeometry
  mat: THREE.Material
  pos: [number, number, number]
  scale: [number, number, number]
  rot?: [number, number, number]
}

/** 一种道具原型 */
export interface PropKind {
  key: string
  parts: PropPart[]
  /** 圆形碰撞半径（米，scale=1 时） */
  colliderR: number
  /** 随机挑选权重 */
  weight: number
  /** 同类 2~3 种实例染色变体（通过 InstancedMesh.setColorAt 区分，不增 drawcall / 不改碰撞） */
  variantColors?: readonly number[]
}

/** 材质创建参数 */
interface MatOpts {
  roughness?: number
  metalness?: number
  flat?: boolean
  emissive?: number
  emissiveIntensity?: number
  map?: THREE.Texture
}

function std(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    map: o.map ?? null,
    roughness: o.roughness ?? 0.92,
    metalness: o.metalness ?? 0.0,
    flatShading: o.flat ?? true,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 0,
  })
}

function hexCss(hex: number, a = 1): string {
  const r = (hex >> 16) & 0xff
  const g = (hex >> 8) & 0xff
  const b = hex & 0xff
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`
}

function mixHex(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  return (((ar + (br - ar) * k) | 0) << 16) | (((ag + (bg - ag) * k) | 0) << 8) | ((ab + (bb - ab) * k) | 0)
}

function toneHex(hex: number, f: number): number {
  return f >= 0 ? mixHex(hex, 0xffffff, f) : mixHex(hex, 0x000000, -f)
}

type PropSurfaceKind = 'wood' | 'stone' | 'metal' | 'ice' | 'lava' | 'gold' | 'moss'

/** 模块级 16×16 像素画布缓存：同一材质+基色只绘制一次，CanvasTexture 仍随 PropSet 独立释放 */
const PROP_CANVAS_CACHE = new Map<string, HTMLCanvasElement>()

function drawPixelPropCanvas(kind: PropSurfaceKind, baseHex: number): HTMLCanvasElement {
  const key = `${kind}:${baseHex.toString(16)}`
  const cached = PROP_CANVAS_CACHE.get(key)
  if (cached) return cached

  const S = 16
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false

  const px = (x: number, y: number, hex: number, w = 1, h = 1): void => {
    ctx.fillStyle = hexCss(hex)
    ctx.fillRect(x, y, w, h)
  }

  const dark = toneHex(baseHex, -0.46)
  const shade = toneHex(baseHex, -0.22)
  const mid = baseHex
  const light = toneHex(baseHex, 0.2)
  const hi = toneHex(baseHex, 0.38)

  // 铺底
  px(0, 0, mid, S, S)

  if (kind === 'wood') {
    // 4 条横向像素木板（每条 4px 高，1px 暗板缝 + 离散木纹色阶 + 四角铁铆钉）
    for (let row = 0; row < 4; row += 1) {
      const y = row * 4
      const plank = row % 2 === 0 ? mid : shade
      px(0, y, plank, S, 3)
      // 1px 顶沿高光
      px(1, y, row % 2 === 0 ? light : mid, S - 2, 1)
      // 离散木纹像素点
      for (let x = 2; x < S - 2; x += 3) {
        px(x, y + 1, row % 2 === 0 ? shade : dark, 2, 1)
      }
      // 1px 暗缝
      px(0, y + 3, dark, S, 1)
    }
    // 1px 外描边 + 四角 2×2 铁铆钉
    px(0, 0, dark, S, 1)
    px(0, S - 1, dark, S, 1)
    px(0, 0, dark, 1, S)
    px(S - 1, 0, dark, 1, S)
    for (const [rx, ry] of [
      [1, 1],
      [S - 3, 1],
      [1, S - 3],
      [S - 3, S - 3],
    ]) {
      px(rx, ry, 0x262630, 2, 2)
      px(rx, ry, 0xcad2e0, 1, 1)
    }
  } else if (kind === 'stone') {
    // 像素砌石块：1px 暗描边 + 左上倒角高光 + 离散色阶斑点 + 1px 锯齿裂纹
    px(0, 0, mid, S, S)
    // 2×2 离散石纹色块
    for (let y = 1; y < S - 1; y += 2) {
      for (let x = 1; x < S - 1; x += 2) {
        const h = (x * 7 + y * 13) % 5
        if (h === 0) px(x, y, shade, 2, 1)
        else if (h === 1) px(x, y, light, 1, 1)
      }
    }
    // 中缝砌线（错缝）
    px(0, 7, dark, S, 1)
    px(1, 8, light, S - 2, 1)
    px(7, 0, dark, 1, 8)
    px(11, 8, dark, 1, 8)
    // 1px 像素裂纹
    for (const [cx, cy] of [
      [3, 2],
      [4, 3],
      [4, 4],
      [5, 5],
      [2, 11],
      [3, 12],
      [4, 12],
      [5, 13],
    ]) {
      px(cx, cy, dark)
    }
    // 1px 外框描边 + 左上高光
    px(0, 0, dark, S, 1)
    px(0, S - 1, dark, S, 1)
    px(0, 0, dark, 1, S)
    px(S - 1, 0, dark, 1, S)
    px(1, 1, hi, S - 3, 1)
    px(1, 1, light, 1, S - 3)
  } else if (kind === 'metal') {
    // 铆钉锻铁/黄铜板：1px 暗框 + 阶梯斜向高光 + 四角铆钉
    px(0, 0, shade, S, S)
    px(1, 1, mid, S - 2, S - 2)
    // 离散斜向金属反光像素带（禁止渐变）
    for (let i = 2; i < S - 2; i += 1) {
      px(i, S - 1 - i, light)
      if (i + 1 < S - 2) px(i + 1, S - 1 - i, hi)
    }
    // 外描边与顶部亮边
    px(0, 0, dark, S, 1)
    px(0, S - 1, dark, S, 1)
    px(0, 0, dark, 1, S)
    px(S - 1, 0, dark, 1, S)
    px(1, 1, hi, S - 2, 1)
    // 四角铆钉
    for (const [rx, ry] of [
      [2, 2],
      [S - 4, 2],
      [2, S - 4],
      [S - 4, S - 4],
    ]) {
      px(rx, ry, dark, 2, 2)
      px(rx, ry, hi, 1, 1)
    }
  } else if (kind === 'ice') {
    // 像素冰晶切面：深蓝描边 + 阶梯斜向白蓝晶体高光
    const iceDark = mixHex(baseHex, 0x1e4c78, 0.55)
    const iceMid = mixHex(baseHex, 0x9be6ff, 0.35)
    const iceHi = 0xf0fcff
    px(0, 0, iceMid, S, S)
    for (let y = 1; y < S - 1; y += 1) {
      for (let x = 1; x < S - 1; x += 1) {
        if ((x + y) % 5 === 0) px(x, y, light)
        else if ((x - y + 16) % 7 === 0) px(x, y, shade)
      }
    }
    // 阶梯高光线
    for (let i = 2; i <= 6; i += 1) {
      px(i, 8 - i, iceHi)
      px(i + 5, 14 - i, iceHi)
    }
    px(0, 0, iceDark, S, 1)
    px(0, S - 1, iceDark, S, 1)
    px(0, 0, iceDark, 1, S)
    px(S - 1, 0, iceDark, 1, S)
    px(1, 1, iceHi, S - 3, 1)
  } else if (kind === 'lava') {
    // 熔岩裂隙像素块：暗玄武岩底 + 离散橙黄发光像素脉络
    const crust = 0x261614
    const crustHi = 0x3b221e
    const ember = mixHex(baseHex, 0xff6a1a, 0.55)
    const hot = 0xffe26a
    px(0, 0, crust, S, S)
    for (let y = 1; y < S - 1; y += 2) {
      for (let x = 1; x < S - 1; x += 2) {
        if ((x * 3 + y * 5) % 4 === 0) px(x, y, crustHi, 2, 1)
      }
    }
    const vein: [number, number][] = [
      [2, 3],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 5],
      [7, 6],
      [8, 7],
      [9, 7],
      [10, 8],
      [11, 9],
      [12, 10],
      [13, 11],
      [7, 7],
      [6, 8],
      [5, 9],
      [4, 10],
      [3, 11],
    ]
    for (const [vx, vy] of vein) {
      px(vx, vy, ember, 2, 2)
    }
    for (const [vx, vy] of vein) {
      px(vx, vy, hot, 1, 1)
    }
  } else if (kind === 'gold') {
    // 金砖/金币像素堆：1px 暗描边 + 阶梯高光点阵
    px(0, 0, shade, S, S)
    for (let row = 0; row < 4; row += 1) {
      const y = row * 4
      const off = (row % 2) * 4
      for (let x = -4 + off; x < S; x += 8) {
        const bx = Math.max(0, x)
        const bw = Math.min(S, x + 7) - bx
        if (bw > 0) {
          px(bx, y, mid, bw, 3)
          px(bx, y, hi, Math.max(1, bw - 2), 1)
          px(bx, y + 3, dark, bw, 1)
        }
        if (x + 7 < S && x + 7 >= 0) px(x + 7, y, dark, 1, 4)
      }
    }
    px(0, 0, dark, S, 1)
    px(0, S - 1, dark, S, 1)
  } else {
    // moss：像素苔藓叶簇（3 档绿色离散色块 + 1px 暗边）
    px(0, 0, shade, S, S)
    for (let y = 1; y < S - 1; y += 2) {
      for (let x = 1; x < S - 1; x += 2) {
        const v = (x * 5 + y * 11) % 4
        if (v === 0) px(x, y, hi, 2, 1)
        else if (v === 1 || v === 2) px(x, y, mid, 2, 2)
        else px(x, y, dark, 1, 2)
      }
    }
    px(0, 0, dark, S, 1)
    px(0, S - 1, dark, S, 1)
    px(0, 0, dark, 1, S)
    px(S - 1, 0, dark, 1, S)
  }

  PROP_CANVAS_CACHE.set(key, canvas)
  return canvas
}

/** 生成 16×16 严格 NearestFilter 像素纹理（禁用 mipmap 与平滑过滤，共用画布缓存） */
function makePropSurfaceTexture(kind: PropSurfaceKind, baseHex: number): THREE.CanvasTexture {
  const canvas = drawPixelPropCanvas(kind, baseHex)
  const tex = new THREE.CanvasTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
}

/** 原画纹理是 flipY=false（和角色图集一致），平面片要把 v 轴翻过来才正立 */
function flipUvVertical(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  uv.needsUpdate = true
}

/**
 * 一层的道具集合。持有共享几何/材质/原型定义，dispose 时一起释放。
 */
export class PropSet {
  readonly box: THREE.BoxGeometry
  readonly cyl: THREE.CylinderGeometry
  readonly cone: THREE.ConeGeometry
  readonly rock: THREE.DodecahedronGeometry
  readonly oct: THREE.OctahedronGeometry
  readonly sphere: THREE.SphereGeometry

  readonly mats: Record<string, THREE.Material>
  readonly kinds: PropKind[]
  /** 需要呼吸动画的自发光材质（熔岩/冰晶等） */
  readonly pulse: THREE.MeshStandardMaterial | null

  private readonly geos: THREE.BufferGeometry[] = []
  private readonly ownedMats: THREE.Material[] = []
  private readonly ownedTex: THREE.Texture[] = []

  constructor(theme: ThemeLike) {
    // ---- 共享单位几何体（沙盒像素风核心使用 box，保留其余字段兼容接口） ----
    this.box = this.trackGeo(new THREE.BoxGeometry(1, 1, 1))
    this.cyl = this.trackGeo(new THREE.CylinderGeometry(1, 1, 1, 10, 1))
    this.cone = this.trackGeo(new THREE.ConeGeometry(1, 1, 8))
    this.rock = this.trackGeo(new THREE.DodecahedronGeometry(1, 0))
    this.oct = this.trackGeo(new THREE.OctahedronGeometry(1, 0))
    this.sphere = this.trackGeo(new THREE.SphereGeometry(1, 8, 6))

    // ---- 16×16 主题像素贴图（NearestFilter + 画布缓存） ----
    const p = theme.propColors
    const stoneBase = mixHex(p[0] ?? theme.wallColor, theme.wallColor, 0.35)
    const woodBase = mixHex(p[1] ?? 0x7a5a3a, 0x7b5634, 0.55)
    const metalBase = 0x525666
    const goldBase = mixHex(theme.accentColor, 0xe8be62, 0.55)
    const mossBase = mixHex(theme.accentColor, 0x3d6836, 0.65)
    const iceBase = mixHex(theme.accentColor, 0xbceeff, 0.35)

    const stoneTex = this.trackTex(makePropSurfaceTexture('stone', stoneBase))
    const woodTex = this.trackTex(makePropSurfaceTexture('wood', woodBase))
    const metalTex = this.trackTex(makePropSurfaceTexture('metal', metalBase))
    const goldTex = this.trackTex(makePropSurfaceTexture('gold', goldBase))
    const mossTex = this.trackTex(makePropSurfaceTexture('moss', mossBase))
    const iceTex = this.trackTex(makePropSurfaceTexture('ice', iceBase))
    const lavaTex = this.trackTex(makePropSurfaceTexture('lava', theme.accentColor))

    const stone = this.trackMat(std(0xffffff, { map: stoneTex, roughness: 0.9, metalness: 0.04 }))
    const stoneDark = this.trackMat(std(toneHex(mixHex(p[2] ?? theme.wallColor, theme.wallColor, 0.4), -0.06), { map: stoneTex, roughness: 0.92 }))
    const stoneLight = this.trackMat(std(mixHex(p[1] ?? theme.wallColor, theme.wallTopColor, 0.36), { map: stoneTex, roughness: 0.85 }))
    const wood = this.trackMat(std(0xffffff, { map: woodTex, roughness: 0.9 }))
    const woodDark = this.trackMat(std(mixHex(0x523a26, p[0] ?? 0x5c4632, 0.35), { map: woodTex, roughness: 0.92 }))
    const metal = this.trackMat(std(0x9ca2b2, { map: metalTex, metalness: 0.68, roughness: 0.42 }))
    const metalLight = this.trackMat(std(0xd2d0dc, { map: metalTex, metalness: 0.6, roughness: 0.34 }))
    const warmMetal = this.trackMat(
      std(mixHex(0x645862, theme.accentColor, 0.25), {
        map: metalTex,
        metalness: 0.52,
        roughness: 0.5,
        emissive: theme.accentColor,
        emissiveIntensity: 0.08,
      }),
    )
    const gold = this.trackMat(std(0xffffff, { map: goldTex, metalness: 0.78, roughness: 0.34, emissive: theme.accentColor, emissiveIntensity: 0.1 }))
    const wax = this.trackMat(std(mixHex(theme.accentColor, 0xf2e4c4, 0.72), { roughness: 0.88 }))
    const moss = this.trackMat(std(0xffffff, { map: mossTex, roughness: 0.98 }))
    const lava = this.trackMat(std(0xffffff, { map: lavaTex, emissive: theme.accentColor, emissiveIntensity: 1.05, roughness: 0.95 }))
    const ice = this.trackMat(
      std(0xffffff, {
        map: iceTex,
        roughness: 0.22,
        metalness: 0.06,
        emissive: theme.accentColor,
        emissiveIntensity: 0.28,
      }),
    )
    const fire = this.trackMat(new THREE.MeshBasicMaterial({ color: mixHex(theme.torchColor, 0xfff2c0, 0.35), toneMapped: false }))

    this.pulse = familyOf(theme) === 'forge' ? (lava as THREE.MeshStandardMaterial) : null

    const M: Record<string, THREE.Material> = {
      stone,
      stoneDark,
      stoneLight,
      wood,
      woodDark,
      metal,
      metalLight,
      warmMetal,
      gold,
      wax,
      moss,
      lava,
      ice,
      fire,
    }
    this.mats = M

    this.kinds = buildKinds(theme, this)
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g)
    return g
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.ownedMats.push(m)
    return m
  }

  private trackTex<T extends THREE.Texture>(t: T): T {
    this.ownedTex.push(t)
    return t
  }

  /** 保留接口兼容：原画立绘替换入口 */
  artProp(
    kindKey: string,
    artKey: ArtKey,
    worldH: number,
    colliderR: number,
    weight: number,
    tint = 0xffffff,
  ): PropKind | null {
    if (!artReady()) return null
    const tex = artTexture(artKey)
    if (!tex) return null
    const img = tex.image as { width?: number; height?: number } | undefined
    const iw = img?.width ?? 0
    const ih = img?.height ?? 0
    if (iw <= 0 || ih <= 0) return null
    const worldW = (worldH * iw) / ih

    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        map: tex,
        color: tint,
        roughness: 0.95,
        metalness: 0.0,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
    )

    const parts: PropPart[] = []
    for (let i = 0; i < 2; i++) {
      const geo = this.trackGeo(new THREE.PlaneGeometry(worldW, worldH))
      geo.translate(0, worldH / 2, 0)
      if (tex.flipY === false) flipUvVertical(geo)
      parts.push(P(geo, mat, [0, 0, 0], [1, 1, 1], [0, (i * Math.PI) / 2, 0]))
    }
    return { key: kindKey, parts, colliderR, weight }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose()
    for (const m of this.ownedMats) m.dispose()
    for (const t of this.ownedTex) t.dispose()
    this.geos.length = 0
    this.ownedMats.length = 0
    this.ownedTex.length = 0
    this.kinds.length = 0
  }
}

/* ------------------------------------------------------------------ */
/*  主题道具原型（全 Voxel 方块拼装造型，保持原碰撞半径与权重）            */
/* ------------------------------------------------------------------ */

function P(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  pos: [number, number, number],
  scale: [number, number, number],
  rot?: [number, number, number],
): PropPart {
  return { geo, mat, pos, scale, rot }
}

function buildKinds(theme: ThemeLike, lib: PropSet): PropKind[] {
  const { box } = lib
  const m = lib.mats

  // ---- 通用：断墙/碎石（阶梯方块石块堆叠，3 色变体） ----
  const rubble: PropKind = {
    key: 'rubble',
    variantColors: [0xffffff, 0xe2e8f0, 0xd4ccbe],
    weight: 3,
    colliderR: 0.8,
    parts: [
      P(box, m.stone, [0, 0.22, 0], [1.14, 0.44, 0.96]),
      P(box, m.stoneDark, [0.48, 0.17, 0.34], [0.66, 0.34, 0.58]),
      P(box, m.stone, [-0.44, 0.14, -0.26], [0.58, 0.28, 0.48]),
      P(box, m.stoneLight, [0.06, 0.54, 0.02], [0.52, 0.26, 0.46]),
    ],
  }

  // ---- 通用：木箱（像素木纹方块箱体 + 四角铁包角 + 顶盖 + 3 色变体） ----
  const crate: PropKind = {
    key: 'crate',
    weight: 3,
    colliderR: 0.72,
    variantColors: [0xffffff, 0xe8d2b8, 0xcab098],
    parts: [
      P(box, m.wood, [0, 0.5, 0], [1.04, 1.0, 1.04]),
      P(box, m.woodDark, [0, 1.05, 0], [1.14, 0.14, 1.14]),
      // 四角方块铁包角
      P(box, m.metal, [0.52, 0.52, 0.52], [0.14, 1.06, 0.14]),
      P(box, m.metal, [-0.52, 0.52, 0.52], [0.14, 1.06, 0.14]),
      P(box, m.metal, [0.52, 0.52, -0.52], [0.14, 1.06, 0.14]),
      P(box, m.metal, [-0.52, 0.52, -0.52], [0.14, 1.06, 0.14]),
      // 顶盖中央像素金属扣片
      P(box, m.metalLight, [0, 1.13, 0], [0.42, 0.05, 0.42]),
    ],
  }

  // ---- 通用：木桶（阶梯体素方桶身 + 十字凸起木片 + 双道方块铁箍 + 3 色变体） ----
  const barrel: PropKind = {
    key: 'barrel',
    weight: 2,
    colliderR: 0.58,
    variantColors: [0xffffff, 0xe4cbb0, 0xc6a88c],
    parts: [
      // 桶身核心方块 + 十字外凸鼓腹（典型沙盒体素桶轮廓）
      P(box, m.wood, [0, 0.56, 0], [0.84, 1.12, 0.84]),
      P(box, m.wood, [0, 0.56, 0], [1.0, 0.84, 0.62]),
      P(box, m.wood, [0, 0.56, 0], [0.62, 0.84, 1.0]),
      // 上下双道像素铁箍
      P(box, m.metal, [0, 0.24, 0], [1.04, 0.12, 1.04]),
      P(box, m.metalLight, [0, 0.88, 0], [1.04, 0.12, 1.04]),
      // 桶顶内凹暗木盖
      P(box, m.woodDark, [0, 1.14, 0], [0.68, 0.08, 0.68]),
    ],
  }

  switch (familyOf(theme)) {
    case 'moss': {
      // 断柱（苔石柱）：全方块阶梯柱座 + 像素方柱身 + 苔藓体素领 + 残破柱头
      const pillar: PropKind = {
        key: 'moss-pillar',
        variantColors: [0xffffff, 0xdfeede, 0xd6d2c4],
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(box, m.stoneDark, [0, 0.18, 0], [1.28, 0.36, 1.28]),
          P(box, m.stoneLight, [0, 0.44, 0], [1.04, 0.18, 1.04]),
          P(box, m.stone, [0, 1.38, 0], [0.82, 1.72, 0.82]),
          P(box, m.moss, [0, 1.92, 0], [0.94, 0.34, 0.94]),
          P(box, m.moss, [0.34, 1.56, 0.34], [0.28, 0.42, 0.28]),
          P(box, m.stoneDark, [0.06, 2.38, 0], [0.96, 0.28, 0.96]),
        ],
      }
      return [pillar, crate, rubble, barrel]
    }

    case 'candle': {
      // 烛台：阶梯铁座 + 方柱杆 + 方盘 + 3 根方块像素蜡烛 + 像素火苗块
      const stand: PropKind = {
        key: 'candle-stand',
        variantColors: [0xffffff, 0xe8e2d8, 0xd4d8e6],
        weight: 3,
        colliderR: 0.46,
        parts: [
          P(box, m.metal, [0, 0.08, 0], [0.84, 0.16, 0.84]),
          P(box, m.metal, [0, 0.22, 0], [0.5, 0.14, 0.5]),
          P(box, m.metal, [0, 1.0, 0], [0.18, 1.48, 0.18]),
          P(box, m.metalLight, [0, 1.8, 0], [0.74, 0.12, 0.74]),
          P(box, m.wax, [0.18, 2.02, 0.08], [0.16, 0.32, 0.16]),
          P(box, m.wax, [-0.16, 1.98, -0.1], [0.14, 0.24, 0.14]),
          P(box, m.wax, [0.02, 2.0, -0.18], [0.12, 0.22, 0.12]),
          P(box, m.fire, [0.18, 2.24, 0.08], [0.1, 0.14, 0.1]),
          P(box, m.fire, [-0.16, 2.16, -0.1], [0.08, 0.12, 0.08]),
        ],
      }
      // 堆放的方木料（体素木梁叠放）
      const woodpile: PropKind = {
        key: 'woodpile',
        variantColors: [0xffffff, 0xe8d4bc, 0xd0b89e],
        weight: 2,
        colliderR: 0.85,
        parts: [
          P(box, m.wood, [0, 0.18, 0.24], [1.95, 0.36, 0.38]),
          P(box, m.woodDark, [0, 0.18, -0.24], [1.95, 0.36, 0.38]),
          P(box, m.wood, [0, 0.54, 0], [1.85, 0.34, 0.38]),
          P(box, m.woodDark, [0.08, 0.86, 0.04], [1.55, 0.3, 0.34]),
        ],
      }
      return [stand, crate, woodpile, barrel]
    }

    case 'forge': {
      // 铁砧：体素石座 + 阶梯锻铁身 + 方块砧角 + 熔火槽
      const anvil: PropKind = {
        key: 'anvil',
        variantColors: [0xffffff, 0xd8dce8, 0xe8d4be],
        weight: 3,
        colliderR: 0.72,
        parts: [
          P(box, m.stone, [0, 0.2, 0], [1.04, 0.4, 0.76]),
          P(box, m.warmMetal, [0, 0.48, 0], [0.68, 0.22, 0.48]),
          P(box, m.warmMetal, [0, 0.7, 0], [1.34, 0.26, 0.62]),
          P(box, m.metalLight, [0, 0.86, 0], [0.72, 0.1, 0.52]),
          P(box, m.warmMetal, [0.84, 0.72, 0], [0.36, 0.16, 0.32]),
          P(box, m.lava, [0, 0.92, 0.02], [0.28, 0.04, 0.18]),
        ],
      }
      // 熔岩巨石：体素堆叠玄武岩块 + 嵌缝发光熔岩像素块
      const lavaRock: PropKind = {
        key: 'lava-rock',
        variantColors: [0xffffff, 0xd6d4e6, 0xe6d2c8],
        weight: 3,
        colliderR: 0.75,
        parts: [
          P(box, m.stoneDark, [0, 0.32, 0], [1.26, 0.64, 1.18]),
          P(box, m.stone, [0.1, 0.74, -0.06], [0.92, 0.44, 0.86]),
          P(box, m.stoneLight, [-0.14, 1.02, 0.08], [0.48, 0.24, 0.48]),
          P(box, m.lava, [0.16, 0.56, 0.56], [0.48, 0.16, 0.14]),
          P(box, m.lava, [-0.58, 0.32, -0.14], [0.14, 0.22, 0.48]),
        ],
      }
      // 齿轮座 / 熔炉石块：阶梯方块座 + 顶面像素齿轮方块齿 + 熔岩槽
      const forgeBlock: PropKind = {
        key: 'forge-block',
        variantColors: [0xffffff, 0xe4dcd0, 0xd2d8e4],
        weight: 2,
        colliderR: 0.7,
        parts: [
          P(box, m.stone, [0, 0.4, 0], [1.26, 0.8, 1.14]),
          P(box, m.stoneLight, [0, 0.92, 0], [1.04, 0.24, 0.94]),
          P(box, m.metal, [0, 1.1, 0], [0.76, 0.14, 0.76]),
          P(box, m.metalLight, [0, 1.1, 0], [0.98, 0.1, 0.22]),
          P(box, m.metalLight, [0, 1.1, 0], [0.22, 0.1, 0.98]),
          P(box, m.lava, [0, 0.82, 0.58], [0.76, 0.08, 0.06]),
        ],
      }
      // 煤堆：阶梯方块炭堆 + 发光余烬方块
      const coal: PropKind = {
        key: 'coal',
        variantColors: [0xffffff, 0xdedce6, 0xe8d6cc],
        weight: 2,
        colliderR: 0.7,
        parts: [
          P(box, m.stoneDark, [0, 0.16, 0], [1.22, 0.32, 1.12]),
          P(box, m.stone, [0.06, 0.42, -0.04], [0.84, 0.28, 0.78]),
          P(box, m.stoneLight, [-0.04, 0.64, 0.04], [0.46, 0.2, 0.42]),
          P(box, m.lava, [0.14, 0.56, 0.22], [0.18, 0.12, 0.18]),
          P(box, m.lava, [-0.34, 0.34, -0.22], [0.16, 0.1, 0.16]),
        ],
      }
      return [anvil, lavaRock, forgeBlock, coal]
    }

    case 'frost': {
      // 冰晶簇：方块石座 + 3 组阶梯体素晶柱
      const crystal: PropKind = {
        key: 'ice-crystal',
        variantColors: [0xffffff, 0xd8f0ff, 0xe6e4ff],
        weight: 3,
        colliderR: 0.58,
        parts: [
          P(box, m.stoneDark, [0, 0.1, 0], [0.96, 0.2, 0.96]),
          P(box, m.ice, [0, 0.72, 0], [0.44, 1.08, 0.44]),
          P(box, m.ice, [0, 1.42, 0], [0.24, 0.36, 0.24]),
          P(box, m.ice, [0.36, 0.48, 0.16], [0.28, 0.68, 0.28]),
          P(box, m.ice, [-0.32, 0.4, -0.18], [0.26, 0.56, 0.26]),
        ],
      }
      // 冻结石柱：阶梯方石座 + 像素方柱身 + 体素冰领 + 冰冠
      const frozenPillar: PropKind = {
        key: 'frozen-pillar',
        variantColors: [0xffffff, 0xdfeee8, 0xe8dcb8],
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(box, m.stoneDark, [0, 0.2, 0], [1.26, 0.4, 1.26]),
          P(box, m.stone, [0, 1.3, 0], [0.8, 1.84, 0.8]),
          P(box, m.ice, [0, 2.08, 0], [0.96, 0.46, 0.96]),
          P(box, m.ice, [0, 2.48, 0], [0.54, 0.36, 0.54]),
        ],
      }
      // 冰封石块：体素石块 + 顶面像素冰盖 + 凸起晶块
      const iceBlock: PropKind = {
        key: 'ice-block',
        variantColors: [0xffffff, 0xdcf0ff, 0xe2e8f4],
        weight: 2,
        colliderR: 0.78,
        parts: [
          P(box, m.stone, [0, 0.4, 0], [1.24, 0.8, 1.06]),
          P(box, m.ice, [0, 0.9, 0], [1.14, 0.22, 0.96]),
          P(box, m.ice, [0.3, 1.12, 0.18], [0.28, 0.26, 0.28]),
        ],
      }
      // 雪堆碎石：体素阶梯石堆 + 方块雪帽
      const snowRubble: PropKind = {
        key: 'snow-rubble',
        variantColors: [0xffffff, 0xdcecf6, 0xe8e4dc],
        weight: 2,
        colliderR: 0.75,
        parts: [
          P(box, m.stone, [0, 0.2, 0], [1.12, 0.4, 0.92]),
          P(box, m.stoneLight, [0.38, 0.14, 0.28], [0.6, 0.28, 0.52]),
          P(box, m.ice, [0, 0.5, 0], [0.84, 0.22, 0.72]),
          P(box, m.ice, [0.06, 0.68, -0.04], [0.46, 0.16, 0.42]),
        ],
      }
      return [crystal, frozenPillar, iceBlock, snowRubble]
    }

    case 'throne':
    default: {
      // 王座：体素石座 + 高背 + 像素金扶手 + 阶梯金冠
      const throne: PropKind = {
        key: 'throne',
        variantColors: [0xffffff, 0xeadec8, 0xdcd6e6],
        weight: 2,
        colliderR: 0.85,
        parts: [
          P(box, m.stoneDark, [0, 0.3, 0], [1.4, 0.6, 1.3]),
          P(box, m.stone, [0, 0.72, 0.05], [1.2, 0.28, 1.05]),
          P(box, m.stoneDark, [0, 1.55, -0.45], [1.25, 1.5, 0.24]),
          P(box, m.gold, [0.62, 0.95, 0], [0.16, 0.5, 1.0]),
          P(box, m.gold, [-0.62, 0.95, 0], [0.16, 0.5, 1.0]),
          P(box, m.gold, [0, 2.32, -0.45], [1.36, 0.14, 0.3]),
          P(box, m.gold, [0, 2.52, -0.45], [0.36, 0.28, 0.28]),
        ],
      }
      // 火盆：体素石座 + 方柱 + 像素黄铜火盆 + 双层体素火焰方块
      const brazier: PropKind = {
        key: 'brazier',
        variantColors: [0xffffff, 0xead8c0, 0xd8dce8],
        weight: 3,
        colliderR: 0.5,
        parts: [
          P(box, m.stoneDark, [0, 0.14, 0], [0.76, 0.28, 0.76]),
          P(box, m.metal, [0, 0.6, 0], [0.26, 0.68, 0.26]),
          P(box, m.gold, [0, 1.02, 0], [0.82, 0.24, 0.82]),
          P(box, m.fire, [0, 1.28, 0], [0.46, 0.32, 0.46]),
          P(box, m.fire, [0, 1.52, 0], [0.24, 0.24, 0.24]),
        ],
      }
      // 金币堆：三层阶梯体素金砖/金币块
      const goldpile: PropKind = {
        key: 'gold-pile',
        variantColors: [0xffffff, 0xf6e6b8, 0xe8d098],
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(box, m.gold, [0, 0.14, 0], [1.04, 0.28, 0.96]),
          P(box, m.gold, [0.08, 0.36, 0.04], [0.72, 0.22, 0.68]),
          P(box, m.gold, [-0.06, 0.54, -0.04], [0.44, 0.18, 0.42]),
          P(box, m.gold, [0.34, 0.12, 0.46], [0.24, 0.16, 0.24]),
        ],
      }
      return [throne, brazier, goldpile, rubble]
    }
  }
}
