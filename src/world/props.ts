import * as THREE from 'three'
import type { ThemeDef } from '../types'

/**
 * ============================================================
 *  场景道具库
 *  - 每层主题 4 种道具，每种由若干"零件"组成（共用单位几何体）
 *  - 摆放时按 零件 分组 → 每个零件一个 InstancedMesh（drawcall 极低）
 *  - 道具只给圆形碰撞半径，具体位置由 floor.ts 过程化生成
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
}

/** 材质创建参数 */
interface MatOpts {
  roughness?: number
  metalness?: number
  flat?: boolean
  emissive?: number
  emissiveIntensity?: number
}

function std(color: number, o: MatOpts = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.92,
    metalness: o.metalness ?? 0.0,
    flatShading: o.flat ?? true,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 0,
  })
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

  constructor(theme: ThemeDef) {
    // ---- 共享单位几何体（缩放放在零件里） ----
    this.box = this.trackGeo(new THREE.BoxGeometry(1, 1, 1))
    this.cyl = this.trackGeo(new THREE.CylinderGeometry(1, 1, 1, 10, 1))
    this.cone = this.trackGeo(new THREE.ConeGeometry(1, 1, 8))
    this.rock = this.trackGeo(new THREE.DodecahedronGeometry(1, 0))
    this.oct = this.trackGeo(new THREE.OctahedronGeometry(1, 0))
    this.sphere = this.trackGeo(new THREE.SphereGeometry(1, 8, 6))

    // ---- 主题材质 ----
    const p = theme.propColors
    const stone = this.trackMat(std(mixHex(p[0] ?? theme.wallColor, theme.wallColor, 0.35)))
    const stoneDark = this.trackMat(std(toneHex(mixHex(p[2] ?? theme.wallColor, theme.wallColor, 0.4), -0.08)))
    const stoneLight = this.trackMat(std(mixHex(p[1] ?? theme.wallColor, theme.wallTopColor, 0.3)))
    const wood = this.trackMat(std(mixHex(p[1] ?? 0x6a5038, 0x6b4a2a, 0.55), { roughness: 0.95 }))
    const woodDark = this.trackMat(std(mixHex(0x3a2a1c, p[0] ?? 0x4a3a2a, 0.35), { roughness: 0.95 }))
    const metal = this.trackMat(std(0x2b2b33, { metalness: 0.72, roughness: 0.42 }))
    const metalLight = this.trackMat(std(0x6e6a74, { metalness: 0.6, roughness: 0.35 }))
    const gold = this.trackMat(std(mixHex(theme.accentColor, 0xe8be62, 0.55), { metalness: 0.85, roughness: 0.3, emissive: theme.accentColor, emissiveIntensity: 0.12 }))
    const wax = this.trackMat(std(mixHex(theme.accentColor, 0xf0e2c0, 0.7), { roughness: 0.85 }))
    const moss = this.trackMat(std(mixHex(theme.accentColor, 0x3d5f34, 0.65), { roughness: 1 }))
    const lava = this.trackMat(std(0x2a1512, { emissive: theme.accentColor, emissiveIntensity: 1.6, roughness: 1 }))
    const ice = this.trackMat(
      std(mixHex(theme.accentColor, 0xffffff, 0.25), {
        roughness: 0.16,
        metalness: 0.08,
        emissive: theme.accentColor,
        emissiveIntensity: 0.35,
      }),
    )
    const fire = this.trackMat(new THREE.MeshBasicMaterial({ color: mixHex(theme.torchColor, 0xfff2c0, 0.35), toneMapped: false }))

    this.pulse = theme.id === 'forge' ? (lava as THREE.MeshStandardMaterial) : null

    const M: Record<string, THREE.Material> = {
      stone,
      stoneDark,
      stoneLight,
      wood,
      woodDark,
      metal,
      metalLight,
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

  dispose(): void {
    for (const g of this.geos) g.dispose()
    for (const m of this.ownedMats) m.dispose()
    this.geos.length = 0
    this.ownedMats.length = 0
    this.kinds.length = 0
  }
}

/* ------------------------------------------------------------------ */
/*  主题道具原型                                                       */
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

function buildKinds(theme: ThemeDef, lib: PropSet): PropKind[] {
  const { box, cyl, cone, rock, oct, sphere } = lib
  const m = lib.mats

  // ---- 通用：断墙/碎石 ----
  const rubble: PropKind = {
    key: 'rubble',
    weight: 3,
    colliderR: 0.8,
    parts: [
      P(box, m.stone, [0, 0.22, 0], [1.15, 0.44, 0.95], [0, 0.35, 0]),
      P(box, m.stoneDark, [0.52, 0.17, 0.36], [0.72, 0.34, 0.62], [0, 1.15, -0.08]),
      P(box, m.stone, [-0.46, 0.13, -0.28], [0.64, 0.26, 0.5], [0.06, 2.3, 0.12]),
      P(box, m.stoneLight, [0.08, 0.47, 0.02], [0.46, 0.3, 0.4], [0, 0.8, 0.1]),
    ],
  }

  // ---- 通用：木箱 ----
  const crate: PropKind = {
    key: 'crate',
    weight: 3,
    colliderR: 0.72,
    parts: [
      P(box, m.wood, [0, 0.5, 0], [1.08, 1, 1.08]),
      P(box, m.woodDark, [0, 1.04, 0], [1.16, 0.13, 1.16]),
      P(box, m.woodDark, [0, 0.5, 0.555], [0.16, 1, 0.04]),
      P(box, m.woodDark, [0, 0.5, -0.555], [0.16, 1, 0.04]),
      P(box, m.woodDark, [0.555, 0.5, 0], [0.04, 1, 0.16]),
    ],
  }

  // ---- 通用：木桶 ----
  const barrel: PropKind = {
    key: 'barrel',
    weight: 2,
    colliderR: 0.58,
    parts: [
      P(cyl, m.wood, [0, 0.56, 0], [0.55, 1.12, 0.55]),
      P(cyl, m.metal, [0, 0.28, 0], [0.585, 0.1, 0.585]),
      P(cyl, m.metal, [0, 0.85, 0], [0.585, 0.1, 0.585]),
      P(cyl, m.woodDark, [0, 1.14, 0], [0.43, 0.08, 0.43]),
    ],
  }

  switch (theme.id) {
    case 'moss': {
      // 断柱（苔石柱）
      const pillar: PropKind = {
        key: 'moss-pillar',
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(box, m.stoneDark, [0, 0.18, 0], [1.35, 0.36, 1.35]),
          P(cyl, m.stone, [0, 1.26, 0], [0.5, 2.1, 0.5]),
          P(cyl, m.moss, [0, 1.9, 0], [0.53, 0.34, 0.53]),
          P(box, m.stoneDark, [0.08, 2.5, 0], [0.74, 0.3, 0.74], [0, 0.55, 0.06]),
        ],
      }
      return [pillar, crate, rubble, barrel]
    }

    case 'candle': {
      // 烛台
      const stand: PropKind = {
        key: 'candle-stand',
        weight: 3,
        colliderR: 0.46,
        parts: [
          P(cyl, m.metal, [0, 0.06, 0], [0.5, 0.12, 0.5]),
          P(cyl, m.metal, [0, 0.95, 0], [0.1, 1.78, 0.1]),
          P(cyl, m.metalLight, [0, 1.86, 0], [0.42, 0.08, 0.42]),
          P(cyl, m.wax, [0.17, 2.02, 0.06], [0.09, 0.3, 0.09]),
          P(cyl, m.wax, [-0.13, 1.99, -0.09], [0.08, 0.24, 0.08]),
          P(cyl, m.wax, [0.02, 2.04, -0.16], [0.07, 0.2, 0.07]),
          P(cyl, m.fire, [0.17, 2.23, 0.06], [0.05, 0.17, 0.05]),
          P(cyl, m.fire, [-0.13, 2.18, -0.09], [0.04, 0.14, 0.04]),
        ],
      }
      // 堆放的木料
      const woodpile: PropKind = {
        key: 'woodpile',
        weight: 2,
        colliderR: 0.85,
        parts: [
          P(cyl, m.wood, [0, 0.22, 0.2], [0.2, 2.1, 0.2], [0, 0, Math.PI / 2]),
          P(cyl, m.woodDark, [0, 0.22, -0.2], [0.2, 2.1, 0.2], [0, 0.2, Math.PI / 2]),
          P(cyl, m.wood, [0, 0.6, 0], [0.19, 2, 0.19], [0, -0.15, Math.PI / 2]),
          P(cyl, m.wood, [0.1, 0.95, 0], [0.18, 1.8, 0.18], [0.12, 0.1, Math.PI / 2]),
        ],
      }
      return [stand, crate, woodpile, barrel]
    }

    case 'forge': {
      // 铁砧
      const anvil: PropKind = {
        key: 'anvil',
        weight: 3,
        colliderR: 0.72,
        parts: [
          P(box, m.stoneDark, [0, 0.22, 0], [1.0, 0.44, 0.72]),
          P(box, m.metal, [0, 0.6, 0], [1.45, 0.3, 0.6]),
          P(box, m.metalLight, [0, 0.79, 0], [0.55, 0.14, 0.48]),
          P(cone, m.metal, [0.9, 0.6, 0], [0.2, 0.42, 0.2], [0, 0, -Math.PI / 2]),
          P(box, m.lava, [0, 0.75, 0.02], [0.3, 0.02, 0.18]),
        ],
      }
      // 熔岩巨石
      const lavaRock: PropKind = {
        key: 'lava-rock',
        weight: 3,
        colliderR: 0.75,
        parts: [
          P(rock, m.stone, [0, 0.4, 0], [1.25, 0.9, 1.15]),
          P(box, m.lava, [0.12, 0.58, 0.36], [0.5, 0.1, 0.18], [0, 0.7, 0]),
          P(box, m.lava, [-0.34, 0.24, -0.2], [0.34, 0.08, 0.5], [0, 0.2, 0]),
          P(box, m.lava, [0.3, 0.16, -0.4], [0.3, 0.06, 0.22], [0, 1.2, 0]),
        ],
      }
      // 熔炉石块
      const forgeBlock: PropKind = {
        key: 'forge-block',
        weight: 2,
        colliderR: 0.7,
        parts: [
          P(box, m.stoneDark, [0, 0.45, 0], [1.3, 0.9, 1.1]),
          P(box, m.stone, [0, 1.02, 0], [1.1, 0.24, 0.92]),
          P(box, m.lava, [0, 0.92, 0.56], [0.8, 0.06, 0.04]),
        ],
      }
      // 煤堆
      const coal: PropKind = {
        key: 'coal',
        weight: 2,
        colliderR: 0.7,
        parts: [
          P(cone, m.stoneDark, [0, 0.34, 0], [0.85, 0.68, 0.85]),
          P(rock, m.stone, [0.42, 0.14, 0.2], [0.28, 0.24, 0.26]),
          P(box, m.lava, [0.05, 0.5, 0.15], [0.18, 0.05, 0.18], [0, 0.5, 0]),
          P(box, m.lava, [-0.3, 0.28, -0.2], [0.12, 0.04, 0.12]),
        ],
      }
      return [anvil, lavaRock, forgeBlock, coal]
    }

    case 'frost': {
      // 冰晶簇
      const crystal: PropKind = {
        key: 'ice-crystal',
        weight: 3,
        colliderR: 0.58,
        parts: [
          P(oct, m.ice, [0, 1.05, 0], [0.42, 1.25, 0.42]),
          P(oct, m.ice, [0.42, 0.55, 0.14], [0.24, 0.7, 0.24], [0.1, 0.3, 0.18]),
          P(oct, m.ice, [-0.34, 0.42, -0.2], [0.2, 0.55, 0.2], [-0.12, 0.1, -0.2]),
          P(box, m.stoneDark, [0, 0.08, 0], [0.9, 0.16, 0.9]),
        ],
      }
      // 冻结的石柱
      const frozenPillar: PropKind = {
        key: 'frozen-pillar',
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(box, m.stoneDark, [0, 0.2, 0], [1.3, 0.4, 1.3]),
          P(cyl, m.stone, [0, 1.3, 0], [0.48, 2.2, 0.48]),
          P(cyl, m.ice, [0, 2.1, 0], [0.56, 0.5, 0.56]),
          P(oct, m.ice, [0, 2.55, 0], [0.3, 0.42, 0.3]),
        ],
      }
      // 冰封的石块
      const iceBlock: PropKind = {
        key: 'ice-block',
        weight: 2,
        colliderR: 0.78,
        parts: [
          P(box, m.stone, [0, 0.42, 0], [1.25, 0.84, 1.05]),
          P(box, m.ice, [0, 0.9, 0], [1.1, 0.24, 0.92]),
          P(oct, m.ice, [0.35, 1.02, 0.2], [0.16, 0.3, 0.16]),
        ],
      }
      // 雪堆碎石
      const snowRubble: PropKind = {
        key: 'snow-rubble',
        weight: 2,
        colliderR: 0.75,
        parts: [
          P(box, m.stone, [0, 0.2, 0], [1.1, 0.4, 0.9], [0, 0.4, 0]),
          P(box, m.stoneLight, [0.4, 0.14, 0.3], [0.6, 0.28, 0.52], [0, 1.1, -0.1]),
          P(cone, m.ice, [0, 0.5, 0], [0.72, 0.3, 0.6]),
        ],
      }
      return [crystal, frozenPillar, iceBlock, snowRubble]
    }

    case 'throne':
    default: {
      // 王座
      const throne: PropKind = {
        key: 'throne',
        weight: 2,
        colliderR: 0.85,
        parts: [
          P(box, m.stoneDark, [0, 0.3, 0], [1.4, 0.6, 1.3]),
          P(box, m.stone, [0, 0.72, 0.05], [1.2, 0.28, 1.05]),
          P(box, m.stoneDark, [0, 1.55, -0.45], [1.25, 1.5, 0.24]),
          P(box, m.gold, [0.62, 0.95, 0], [0.14, 0.5, 1.0]),
          P(box, m.gold, [-0.62, 0.95, 0], [0.14, 0.5, 1.0]),
          P(box, m.gold, [0, 2.3, -0.45], [1.35, 0.12, 0.3]),
          P(cone, m.gold, [0, 2.5, -0.45], [0.18, 0.3, 0.18]),
        ],
      }
      // 火盆
      const brazier: PropKind = {
        key: 'brazier',
        weight: 3,
        colliderR: 0.5,
        parts: [
          P(cyl, m.stoneDark, [0, 0.14, 0], [0.42, 0.28, 0.42]),
          P(cyl, m.metal, [0, 0.62, 0], [0.12, 0.75, 0.12]),
          P(cyl, m.gold, [0, 1.02, 0], [0.46, 0.24, 0.46]),
          P(cone, m.fire, [0, 1.32, 0], [0.3, 0.55, 0.3]),
          P(cone, m.fire, [0, 1.5, 0], [0.18, 0.42, 0.18]),
        ],
      }
      // 金币堆
      const goldpile: PropKind = {
        key: 'gold-pile',
        weight: 2,
        colliderR: 0.62,
        parts: [
          P(cyl, m.gold, [0, 0.14, 0], [0.6, 0.28, 0.6]),
          P(cyl, m.gold, [0.12, 0.32, 0.05], [0.44, 0.22, 0.44]),
          P(cyl, m.gold, [-0.06, 0.45, -0.04], [0.3, 0.16, 0.3]),
          P(sphere, m.gold, [0.2, 0.16, 0.28], [0.12, 0.12, 0.12]),
        ],
      }
      return [throne, brazier, goldpile, rubble]
    }
  }
}
