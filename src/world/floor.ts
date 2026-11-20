import * as THREE from 'three'
import type { Circle, SceneDef, TunnelRoom, Vec2, WorldV3 } from '../types'
import { Rng } from '../core/rng'
import { mixHex, TextureBook } from './textures'
import { PropSet } from './props'
import type { PropKind } from './props'
import type { ThemeV3 } from './themes'
import { themeFor } from './themes'
import { disposeTree } from './util'
import { BillboardBatch } from '../art/billboardBatch'

const UP = new THREE.Vector3(0, 1, 0)
const ZERO_BANNER = new THREE.Matrix4().makeScale(0, 0, 0)

/** 火把运行时状态 */
interface TorchEntry {
  flameIndex: number
  seed: number
  light: THREE.PointLight | null
  /** 基础亮度，flicker 在其上抖动 */
  baseIntensity: number
  /** 火焰挂点（用于道具避让） */
  tx: number
  tz: number
  fy: number
  color: number
}

/** 道具落位结果 */
interface PropPlacement {
  x: number
  z: number
  scale: number
  rot: number
  kind: PropKind
}

/** 可交互的塔藏箱：开启后箱盖翻开、封印熄灭，但箱体仍作为障碍物 */
interface TowerCache {
  x: number
  z: number
  used: boolean
  /** 房间 preset 下非宝藏房会整体隐藏，避免“每个房间都能开箱”的语义冲突 */
  hidden: boolean
  open: number
  group: THREE.Group
  lidPivot: THREE.Group
  glowIndex: number
  sealIndex: number
  sealColor: number
  sealBaseY: number
  phase: number
  collider: Circle
}

export type TowerInteractionKind = 'altar' | 'cache'

/** 供 HUD 显示的一次互动提示；坐标用于交互判定与特效落点 */
export interface TowerInteraction {
  kind: TowerInteractionKind
  index: number
  x: number
  z: number
  title: string
  hint: string
}

/** 房间专属色：同一套竞技场靠“地面印记 + 火把/旗帜染色 + 布景轮廓”区分 */
const ROOM_ACCENT: Record<TunnelRoom, number> = {
  event: 0x9fd8ff,
  chest: 0xffc84d,
  'skill-card': 0x8fe3ff,
  merchant: 0xffd166,
  altar: 0xb46bff,
  'mob-wave': 0xff6a4a,
  'elite-fight': 0xff8a3d,
  rest: 0x8fffc8,
  minigame: 0x9fe8ff,
  trial: 0xffe08a,
  boss: 0xff4d6d,
}

type DecorShape = 'box' | 'cyl'
type DecorTone = 'wood' | 'stone' | 'dark' | 'accent' | 'gold'

/** 布景件只用“盒/柱 + 顶点色”表达，两个 InstancedMesh 封顶，+2 drawcall */
interface RoomDecorPiece {
  shape: DecorShape
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  ry?: number
  tone: DecorTone
}

/**
 * 房间布景不是几块纯色积木，而是“台面 + 腿 + 基座/檐口”的组合件：
 * - 商人房：长柜台 + 背架 + 两张边桌，读起来是摊位而不是一堵 U 形墙
 * - 首领土著：黑石方尖碑 + 红铜火盆，避免大块高饱和色块
 * - 刻文房：窄碑身 + 基座 + 发光檐口，和“技能碑林”的语义一致
 * 所有件都不进碰撞，不影响即将重写的战斗与 NPC 动线。
 */
function roomDecorPieces(kind: TunnelRoom): RoomDecorPiece[] {
  const pieces: RoomDecorPiece[] = []
  const box = (
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    tone: DecorTone,
    ry = 0,
  ): void => {
    pieces.push({ shape: 'box', x, y, z, sx, sy, sz, ry, tone })
  }
  const cyl = (x: number, y: number, z: number, r: number, h: number, tone: DecorTone): void => {
    pieces.push({ shape: 'cyl', x, y, z, sx: r, sy: h, sz: r, tone })
  }
  const obelisk = (x: number, z: number, tone: DecorTone): void => {
    box(x, 0.12, z, 0.92, 0.24, 0.92, tone)
    box(x, 0.76, z, 0.52, 1.12, 0.52, tone)
    box(x, 1.4, z, 0.74, 0.16, 0.74, 'accent')
  }

  switch (kind) {
    case 'rest': {
      for (const side of [-1, 1]) {
        const x = side * 4.2
        const z = 3.2
        const ry = side * 0.06
        box(x, 0.52, z, 3.0, 0.16, 0.64, 'wood', ry)
        box(x - 1.18, 0.24, z, 0.22, 0.48, 0.52, 'wood', ry)
        box(x + 1.18, 0.24, z, 0.22, 0.48, 0.52, 'wood', ry)
      }
      cyl(-5.5, 0.45, 1.0, 0.5, 0.9, 'wood')
      cyl(5.5, 0.45, 1.0, 0.5, 0.9, 'wood')
      box(0, 0.35, -4.6, 1.2, 0.7, 1.2, 'wood', 0.3)
      box(0, 0.77, -4.6, 1.3, 0.14, 1.3, 'wood', 0.3)
      break
    }
    case 'merchant': {
      // 主柜台：台面 + 四条腿
      box(0, 0.94, 2.8, 6.4, 0.16, 0.9, 'wood')
      for (const x of [-2.8, 2.8]) {
        for (const z of [2.5, 3.1]) box(x, 0.42, z, 0.22, 0.84, 0.22, 'wood')
      }
      // 背架：上檐 + 两根立柱 + 一层隔板
      box(0, 1.68, 2.25, 6.2, 0.12, 0.34, 'wood')
      box(-2.95, 0.84, 2.25, 0.18, 1.68, 0.18, 'wood')
      box(2.95, 0.84, 2.25, 0.18, 1.68, 0.18, 'wood')
      box(0, 1.24, 2.25, 5.9, 0.1, 0.28, 'wood')
      // 两侧边桌 + 桌上的金箱
      for (const side of [-1, 1]) {
        const x = side * 4.4
        box(x, 0.82, 4.4, 1.4, 0.12, 0.9, 'wood')
        cyl(x, 0.4, 4.4, 0.3, 0.8, 'wood')
        box(x, 1.02, 4.4, 0.55, 0.28, 0.42, 'gold', side * 0.2)
      }
      break
    }
    case 'altar': {
      for (const x of [-3.8, 3.8]) {
        for (const z of [-2.2, 2.2]) obelisk(x, z, 'stone')
      }
      break
    }
    case 'chest': {
      for (const side of [-1, 1]) {
        const x = side * 3.7
        box(x, 0.34, 2.0, 1.1, 0.68, 1.0, 'wood', side * 0.08)
        box(x, 0.73, 2.0, 1.2, 0.14, 1.08, 'wood', side * 0.08)
      }
      // 中央低台：石座 + 金边台面
      box(0, 0.14, -2.1, 2.8, 0.28, 1.6, 'stone')
      box(0, 0.38, -2.1, 2.3, 0.2, 1.25, 'gold')
      for (const x of [-5.0, 5.0]) {
        cyl(x, 0.42, 5.0, 0.38, 0.84, 'stone')
        box(x, 0.9, 5.0, 0.8, 0.12, 0.8, 'gold')
      }
      break
    }
    case 'skill-card': {
      for (const x of [-3.9, 3.9]) {
        for (const z of [2.4, 6.0]) {
          box(x, 0.1, z, 0.92, 0.2, 0.62, 'stone')
          box(x, 1.02, z, 0.42, 1.64, 0.2, 'stone')
          box(x, 1.92, z, 0.72, 0.16, 0.32, 'accent')
        }
      }
      for (const x of [-5.7, 5.7]) {
        cyl(x, 0.38, 4.0, 0.34, 0.76, 'stone')
        box(x, 0.82, 4.0, 0.66, 0.1, 0.66, 'accent')
      }
      break
    }
    case 'mob-wave': {
      for (const x of [-6.2, 6.2]) {
        for (const z of [2.2, 5.4]) {
          box(x, 0.9, z, 2.5, 0.2, 0.46, 'wood', x < 0 ? 0.06 : -0.06)
          box(x - 0.9, 0.45, z, 0.22, 0.9, 0.24, 'wood')
          box(x + 0.9, 0.45, z, 0.22, 0.9, 0.24, 'wood')
        }
      }
      for (const x of [-7.4, 7.4]) {
        cyl(x, 0.46, 4.0, 0.36, 0.92, 'stone')
        box(x, 0.98, 4.0, 0.62, 0.12, 0.62, 'accent')
      }
      break
    }
    case 'elite-fight': {
      for (const x of [-6.2, 6.2]) {
        for (const z of [1.2, 4.2, 7.2]) {
          box(x, 0.9, z, 2.5, 0.2, 0.46, 'wood', x < 0 ? 0.06 : -0.06)
          box(x - 0.9, 0.45, z, 0.22, 0.9, 0.24, 'wood')
          box(x + 0.9, 0.45, z, 0.22, 0.9, 0.24, 'wood')
        }
      }
      for (const x of [-7.6, 7.6]) {
        cyl(x, 0.46, 4.0, 0.38, 0.92, 'stone')
        box(x, 0.98, 4.0, 0.66, 0.12, 0.66, 'accent')
      }
      break
    }
    case 'boss': {
      for (const x of [-7.0, 7.0]) {
        for (const z of [-7.0, 5.8]) {
          box(x, 0.15, z, 1.0, 0.3, 1.0, 'dark', x * z > 0 ? 0.2 : -0.2)
          box(x, 1.3, z, 0.56, 2.0, 0.56, 'dark', x * z > 0 ? 0.2 : -0.2)
          box(x, 2.4, z, 0.86, 0.2, 0.86, 'accent', x * z > 0 ? 0.2 : -0.2)
        }
      }
      for (const x of [-8.2, 8.2]) {
        cyl(x, 0.48, 0, 0.52, 0.96, 'dark')
        box(x, 1.02, 0, 0.82, 0.14, 0.82, 'accent')
      }
      break
    }
  }
  return pieces
}

/**
 * ============================================================
 *  TowerFloor —— v3 的一层场景（实现 WorldV3）
 *  - build(def: SceneDef)：按场景 halfSize + themeId 构建
 *    地砖 + 四面墙/压边/角柱 + 中央祭坛 + 火把 + 主题道具 + 浮尘
 *  - v3 不再有楼梯门：清层后由 game 直接传送，StairGate 文件仅保留
 *  - 布局全部走 core/rng 的 Rng，同一场景重建结果一致
 *  - 整层内容放在 this.root 下，build() 时可整体清理
 *  - 顶点/材质/纹理复用，道具按零件合并为 InstancedMesh 控制 drawcall
 *
 *  性能口径（契约 §5）：单层 drawcall < 80、实时点光 ≤ 6、
 *  FogExp2 + 1 张 2048 阴影贴图、入口 5m 内不放阻挡物。
 * ============================================================
 */
export class TowerFloor implements WorldV3 {
  readonly group = new THREE.Group()

  halfSize = 15
  spawnPoints: Vec2[] = []
  propColliders: Circle[] = []
  /** 入口（南墙中点内侧）：5m 内不放任何阻挡物 */
  entrance: Vec2 = { x: 0, z: 0 }

  private readonly scene: THREE.Scene
  /** 整层内容的父节点（build 时整体清空重建） */
  private readonly root = new THREE.Group()

  private def: SceneDef | null = null
  private theme: ThemeV3 | null = null
  private tex: TextureBook | null = null
  private props: PropSet | null = null

  private torches: TorchEntry[] = []
  /** 四面墙网格：相机退到墙外时直接隐藏对应那面，避免挡视线 */
  private wallMeshes: Partial<Record<'south' | 'north' | 'east' | 'west', THREE.Mesh>> = {}
  private corniceMeshes: Partial<Record<'south' | 'north' | 'east' | 'west', THREE.Mesh>> = {}
  private wallMat: THREE.MeshStandardMaterial | null = null
  private keyLight: THREE.DirectionalLight | null = null
  private pillarMeshes: THREE.InstancedMesh[] = []
  private bannerMeshes: THREE.InstancedMesh[] = []
  private bannerSides: ('south' | 'north' | 'east' | 'west')[] = []
  private bannerBaseMatrices: THREE.Matrix4[][] = []
  private readonly hiddenWalls = new Set<'south' | 'north' | 'east' | 'west'>()

  /** 场地边界警示线：墙体被镜头隐掉时，仍然能看出“走到这里就停” */
  private boundaryMesh: THREE.InstancedMesh | null = null
  private boundaryMat: THREE.MeshBasicMaterial | null = null

  /** 中央地标（替换塔心信标）；null = 该层仍用旧信标 */
  private landmarkSpin: THREE.Group | null = null
  private landmarkSpinAxis: 'y' | 'z' = 'y'
  private landmarkBacklight: THREE.Mesh | null = null
  private landmarkGlowIndex = -1
  private landmarkBacklightY = 3.2
  private hasLandmark = false

  /** 六层细节：墙裙 / 墙裙压边（随墙体显隐同步）、地面光斑 */
  private dadoMesh: THREE.InstancedMesh | null = null
  private dadoTrimMesh: THREE.InstancedMesh | null = null
  private dadoSides: ('south' | 'north' | 'east' | 'west')[] = []
  private dadoBaseMatrices: THREE.Matrix4[] = []
  private dadoTrimBaseMatrices: THREE.Matrix4[] = []
  private lightPatchMat: THREE.MeshBasicMaterial | null = null
  private lightPatchBaseOpacity = 0.24

  private altarRune: THREE.Mesh | null = null
  private crystal: THREE.Mesh | null = null
  private crystalBaseY = 1.4
  private altarLight: THREE.PointLight | null = null
  private altarBeam: THREE.Mesh | null = null
  private altarHalo: THREE.Mesh | null = null
  private altarGlowIndex = -1
  private altarUsed = false
  private altarFlash = 0
  private altarInteractR = 4.8
  private altarSteps: THREE.Mesh[] = []
  private altarCollider: Circle | null = null
  private altarRuneSize = 1
  private altarRuneBaseY = 0.79
  private altarRuneBaseColor = 0xffffff
  private caches: TowerCache[] = []

  /** 房间 preset 状态：null = 普通战斗层 */
  private roomPreset: TunnelRoom | null = null
  private roomFocus = { x: 0, z: 0 }
  private roomAccent = 0
  private floorMat: THREE.MeshStandardMaterial | null = null
  private bannerClothMat: THREE.MeshStandardMaterial | null = null
  private bannerCrestMat: THREE.MeshBasicMaterial | null = null
  private torchFlameBase = 0xffffff
  private torchLightBase = 0xffffff
  private boundaryBaseColor = 0xffffff
  private roomDecorBox: THREE.InstancedMesh | null = null
  private roomDecorCyl: THREE.InstancedMesh | null = null

  /** 场景中的发光 sprite 全部合批：光晕 / 火焰 / 塔藏箱符文各 1 个 drawcall */
  private glowBatch: BillboardBatch | null = null
  private flameBatch: BillboardBatch | null = null
  private sealBatch: BillboardBatch | null = null

  private airBatch: BillboardBatch | null = null
  private airParticles: {
    x: number
    y: number
    z: number
    size: number
    color: number
    alpha: number
    phase: number
    secondary: boolean
  }[] = []
  private airWallH = 4
  private airAccum = 0
  /** 主题专属程序化视觉元素（仅装饰，0 碰撞 / 0 点光） */
  private sigSpinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = []
  private sigPulses: { mat: THREE.MeshBasicMaterial; base: number; amp: number; freq: number }[] = []
  private sigDrifters: {
    mesh: THREE.InstancedMesh
    items: { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; yaw: number; pitch: number }[]
    lim: number
  } | null = null

  private dropRng = new Rng(0x1f123bb5)
  private built = false
  private time = 0

  /**
   * 入口净空半径（米）：契约 §5 要求「入口 5m 内不放阻挡物」。
   * 这里按**道具中心**判定，所以额外加上最大道具半径（≈1.8m），
   * 保证碰撞体表面到入口也至少有 5m。
   */
  private static readonly ENTRANCE_CLEAR = 6.8

  constructor(scene: THREE.Scene) {
    this.scene = scene
    this.group.name = 'TowerFloor'
    this.root.name = 'FloorContent'
    this.group.add(this.root)
    scene.add(this.group)
  }

  /* ================================================================ */
  /*  构建                                                             */
  /* ================================================================ */

  build(def: SceneDef): void {
    this.clear()

    const theme = themeFor(def.themeId)
    this.def = def
    this.theme = theme
    this.halfSize = def.halfSize
    const half = def.halfSize
    // SceneDef 不单独给墙高：按场地大小等比，矮墙保持俯视可读性
    const wallH = Math.round((3.2 + half * 0.07) * 100) / 100
    const size = half * 2
    /**
     * 镜头允许跟到南墙外（否则玩家走到下半区时，相机被墙夹住、水平距离缩短，
     * 画面会滑成俯视）。地面向墙外多铺一圈，镜头退出去时看到的是延续的石板，
     * 而不是背景色。墙体本身仍按 halfSize 摆放，不影响碰撞和战斗边界。
     */
    const floorApron = 24
    const floorSize = size + floorApron * 2

    if (this.group.parent !== this.scene) this.scene.add(this.group)

    const tex = new TextureBook(theme)
    this.tex = tex
    const props = new PropSet(theme)
    this.props = props

    // 发光 billboard 合批：数量按「祭坛 1 + 火把 8 + 塔藏箱 2」预留
    this.glowBatch = new BillboardBatch(this.root, tex.glow, 20, { renderOrder: 4 })
    this.flameBatch = new BillboardBatch(this.root, tex.flame, 8, { renderOrder: 5 })
    this.sealBatch = new BillboardBatch(this.root, tex.rune, 2, { renderOrder: 5 })

    /* ---------------- 场景光照与雾 ---------------- */
    // v4.7：角色是明亮像素二次元画风，场景不再走高对比黑箱；降低雾密度、
    // 抬高环境光与补光，让角色、道具和塔元素都能被一眼读清。
    const airColor = mixHex(theme.fogColor, 0xd9f3ef, 0.56)
    this.scene.fog = new THREE.FogExp2(airColor, theme.fogDensity * 0.46)
    const sky = mixHex(mixHex(theme.fogColor, theme.accentColor, 0.32), 0xe6fbf7, 0.48)
    this.scene.background = new THREE.Color(sky)

    // 清新化：环境光更亮、地面反光不再压黑
    const hemi = new THREE.HemisphereLight(
      mixHex(theme.ambientColor, 0xeafbff, 0.58),
      mixHex(theme.fogColor, theme.floorColor, 0.64),
      theme.ambientIntensity * 1.62,
    )
    this.root.add(hemi)

    // 主光：唯一投影光源（2048 阴影贴图）
    const key = new THREE.DirectionalLight(mixHex(theme.keyColor, 0xfff6e8, 0.28), theme.keyIntensity * 1.12)
    const kAng = theme.detail.keyAngleOffset
    const kBaseX = -half * 0.46
    const kBaseZ = half * 0.58
    const kCos = Math.cos(kAng)
    const kSin = Math.sin(kAng)
    key.position.set(kBaseX * kCos - kBaseZ * kSin, wallH * 4.6 + 7, kBaseX * kSin + kBaseZ * kCos)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    const sc = key.shadow.camera
    sc.left = -half * 1.45
    sc.right = half * 1.45
    sc.top = half * 1.45
    sc.bottom = -half * 1.45
    sc.near = 1
    sc.far = wallH * 7 + half * 5 + 30
    sc.updateProjectionMatrix()
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.035
    key.target.position.set(0, 0, 0)
    this.root.add(key)
    this.root.add(key.target)
    this.keyLight = key

    // 阶段化色温补光（不投影）：一阶晴空青、二阶星夜靛、三阶铜锈青紫，拉开暖主光与冷暗部体积感
    const fillTarget = theme.stage === 1 ? 0xbbeeff : theme.stage === 2 ? 0x9eb4ff : 0xa6d8d4
    const fill = new THREE.DirectionalLight(mixHex(theme.fogColor, fillTarget, 0.78), 0.9)
    fill.position.set(half * 0.72, wallH * 1.9, -half * 0.75)
    this.root.add(fill)

    /* ---------------- 地面 ---------------- */
    tex.floor.repeat.set(floorSize / 7.5, floorSize / 7.5)
    // 保持 TextureBook 的 16x 各向异性，斜视地面更稳，不再降回 8x
    tex.floor.anisotropy = 16
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex.floor,
      roughness: 0.95,
      metalness: 0.02,
      // 轻微抬亮并加入主题色自发光，避免角色像站在黑底贴纸上
      color: new THREE.Color(1.12, 1.12, 1.12),
      emissive: new THREE.Color(mixHex(theme.floorColor, theme.accentColor, 0.22)),
      emissiveIntensity: 0.075,
    })
    this.floorMat = floorMat
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)

    /* ---------------- 场地边界警示线 ---------------- */
    // 南墙/东墙等靠近镜头时会被隐藏，但碰撞边界仍在。没有墙可看时，
    // 玩家走到 halfSize 附近会以为按键失灵；这条常驻发光带负责把边界讲清楚。
    // v4.9：0.16m 细线在实际镜头里几乎看不见，改成 0.52m 内嵌光带 + 四角垫片。
    // 4 段边 + 4 个角仍共用一个 InstancedMesh = 1 drawcall，不新增光源。
    const boundaryInset = 0.72
    const boundaryWidth = 0.52
    const boundaryMat = new THREE.MeshBasicMaterial({
      // 偏白的暖色，避免在熔火/霜蚀主题里被同色地面吃掉；加法混合只提亮不投影。
      color: mixHex(theme.accentColor, 0xfff3d6, 0.6),
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.boundaryBaseColor = boundaryMat.color.getHex()
    const boundaryGeo = new THREE.BoxGeometry(1, 0.05, boundaryWidth)
    const boundaryMesh = new THREE.InstancedMesh(boundaryGeo, boundaryMat, 8)
    boundaryMesh.name = 'ArenaBoundary'
    boundaryMesh.renderOrder = 3
    const edge = half - boundaryInset
    const edgeLen = edge * 2
    const bm = new THREE.Matrix4()
    const bq = new THREE.Quaternion()
    // 南北两条沿 x 轴；东西两条转 90°
    bm.compose(new THREE.Vector3(0, 0.03, edge), bq, new THREE.Vector3(edgeLen, 1, 1))
    boundaryMesh.setMatrixAt(0, bm)
    bm.compose(new THREE.Vector3(0, 0.03, -edge), bq, new THREE.Vector3(edgeLen, 1, 1))
    boundaryMesh.setMatrixAt(1, bm)
    const rot90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)
    bm.compose(new THREE.Vector3(edge, 0.03, 0), rot90, new THREE.Vector3(edgeLen, 1, 1))
    boundaryMesh.setMatrixAt(2, bm)
    bm.compose(new THREE.Vector3(-edge, 0.03, 0), rot90, new THREE.Vector3(edgeLen, 1, 1))
    boundaryMesh.setMatrixAt(3, bm)
    // 四角垫片：让“角落”也有实体边界，而不是两条线在透视里断开
    const corner = 1.25
    const corners: [number, number][] = [
      [edge, edge],
      [edge, -edge],
      [-edge, edge],
      [-edge, -edge],
    ]
    for (let i = 0; i < corners.length; i += 1) {
      bm.compose(new THREE.Vector3(corners[i][0], 0.03, corners[i][1]), bq, new THREE.Vector3(corner, 1, corner))
      boundaryMesh.setMatrixAt(4 + i, bm)
    }
    boundaryMesh.instanceMatrix.needsUpdate = true
    boundaryMesh.frustumCulled = false
    this.boundaryMesh = boundaryMesh
    this.boundaryMat = boundaryMat
    this.root.add(boundaryMesh)

    /* ---------------- 墙体 + 压边 ---------------- */
    const thick = 1.6
    tex.wall.wrapS = THREE.RepeatWrapping
    tex.wall.wrapT = THREE.RepeatWrapping
    tex.wall.repeat.set(Math.max(2, Math.round(size / 3.4)), Math.max(1, Math.round(wallH / 3)))
    tex.wall.anisotropy = 8
    // 墙色必须跟主题走：早先为了提亮写死成纯白 (1.08,1.08,1.08)，
    // 结果第二阶段靛蓝地面配白墙，场景直接割裂。这里取主题墙色向白提 42%，
    // 再乘 1.04 保持原来的轻微过曝。
    const wallTint = new THREE.Color(mixHex(theme.wallColor, 0xffffff, 0.42))
    wallTint.multiplyScalar(1.04)
    const wallMat = new THREE.MeshStandardMaterial({
      map: tex.wall,
      roughness: 0.97,
      metalness: 0.02,
      color: wallTint,
      emissive: new THREE.Color(mixHex(theme.wallColor, theme.accentColor, 0.12)),
      emissiveIntensity: 0.045,
    })
    this.wallMat = wallMat

    const addWall = (w: number, d: number, x: number, z: number, side: 'south' | 'north' | 'east' | 'west'): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat)
      m.position.set(x, wallH / 2, z)
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
      this.wallMeshes[side] = m
    }
    addWall(size + thick * 2, thick, 0, half + thick / 2, 'south') // 南 (+z)
    addWall(size + thick * 2, thick, 0, -(half + thick / 2), 'north') // 北 (-z)
    addWall(thick, size, half + thick / 2, 0, 'east') // 东 (+x)
    addWall(thick, size, -(half + thick / 2), 0, 'west') // 西 (-x)

    const capMat = new THREE.MeshStandardMaterial({
      color: theme.wallTopColor,
      roughness: 0.72,
      metalness: 0.14,
      flatShading: true,
      emissive: new THREE.Color(mixHex(theme.wallTopColor, theme.accentColor, 0.25)),
      emissiveIntensity: 0.045,
    })
    const addCornice = (w: number, d: number, x: number, z: number, side: 'south' | 'north' | 'east' | 'west'): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, d), capMat)
      m.position.set(x, wallH - 0.21, z)
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
      this.corniceMeshes[side] = m
    }
    // 压边向内探出 0.55m，形成收口
    addCornice(size, 0.55, 0, half - 0.275, 'south')
    addCornice(size, 0.55, 0, -(half - 0.275), 'north')
    addCornice(0.55, size, half - 0.275, 0, 'east')
    addCornice(0.55, size, -(half - 0.275), 0, 'west')

    /* ---------------- 四角塔柱 ---------------- */
    const pillarMat = new THREE.MeshStandardMaterial({
      map: tex.wall,
      color: mixHex(theme.wallColor, theme.wallTopColor, 0.28),
      roughness: 0.92,
      metalness: 0.06,
      flatShading: true,
    })
    const pillarCapMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallTopColor, theme.accentColor, 0.22),
      roughness: 0.68,
      metalness: 0.24,
      flatShading: true,
      emissive: theme.accentColor,
      emissiveIntensity: 0.08,
    })
    const pillarTrimMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallTopColor, 0xffffff, 0.32),
      roughness: 0.45,
      metalness: 0.36,
      flatShading: true,
      emissive: new THREE.Color(mixHex(theme.accentColor, theme.wallTopColor, 0.5)),
      emissiveIntensity: 0.12,
    })
    const shaftH = wallH + 1.0
    const shaftGeo = new THREE.BoxGeometry(1.75, shaftH, 1.75)
    const baseGeo = new THREE.BoxGeometry(2.35, 0.6, 2.35)
    const capGeo = new THREE.BoxGeometry(2.25, 0.42, 2.25)
    const trimGeo = new THREE.BoxGeometry(1.94, 0.16, 1.94)
    const shaftMats: THREE.Matrix4[] = []
    const baseMats: THREE.Matrix4[] = []
    const capMats: THREE.Matrix4[] = []
    const trimMats: THREE.Matrix4[] = []
    const one = new THREE.Vector3(1, 1, 1)
    const noRot = new THREE.Quaternion()
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // 塔柱坐在墙角外侧（墙体中心线上），柱基不再探进可行走区域。
        // 旧位置在 half-0.95，和玩家边界重合，柱体被镜头隐掉后还会留下
        // 半径 1.7m 的“隐形墙”，贴墙走会像按键失灵；现在碰撞体完全在界外。
        const px = sx * (half + 0.9)
        const pz = sz * (half + 0.9)
        shaftMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH / 2, pz), noRot, one))
        baseMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.3, pz), noRot, one))
        capMats.push(
          new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH + 0.21, pz), noRot, one),
        )
        // 柱身上下金属/石棱高光束环（完全在塔柱轮廓内，不改碰撞）
        trimMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH * 0.52, pz), noRot, one))
        trimMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH - 0.18, pz), noRot, one))
        // 塔柱在本层范围内的碰撞体
        this.propColliders.push({ x: px, z: pz, r: 1.35 })
      }
    }
    this.pillarMeshes = [
      this.instanced(shaftGeo, pillarMat, shaftMats, true),
      this.instanced(baseGeo, pillarMat, baseMats, true),
      this.instanced(capGeo, pillarCapMat, capMats, true),
      this.instanced(trimGeo, pillarTrimMat, trimMats, false),
    ]
    for (const m of this.pillarMeshes) this.root.add(m)

    /* ---------------- 出生锚点（必须在道具之前） ---------------- */
    this.spawnPoints = makeSpawnPoints(half)

    // 入口：南墙中点内侧（玩家从这里进场，也是 5m 净空区的圆心）
    this.entrance = { x: 0, z: half - 2.4 }

    /* ---------------- 中央祭坛 / 地标 ---------------- */
    if (def.landmark) this.buildLandmark(def.landmark, half, tex)
    else this.buildAltar(half, wallH, tex)

    /* ---------------- 火把 ---------------- */
    this.buildTorches(half, wallH, tex)

    /* ---------------- 塔旗（强化“塔”的识别） ---------------- */
    this.buildTowerBanners(half, wallH, tex)

    /* ---------------- 主题道具 ---------------- */
    const seed = hashSeed(def.id)
    const layoutRng = new Rng(0x9e3779b9 ^ seed ^ (half << 3))
    this.dropRng = new Rng(0x1f123bb5 ^ seed ^ half)
    this.buildProps(def, props, layoutRng)

    /* ---------------- 六层细节（镶边地砖 / 墙裙 / 边缘堆积 / 地面光斑） ---------------- */
    const detailRng = new Rng(0x6c8e9cf5 ^ seed ^ (half << 2))
    this.buildFloorInlay(half)
    this.buildWallDado(half)
    this.buildWallDebris(half, detailRng)
    this.buildLightPatches(half, detailRng, tex)

    /* ---------------- 空气粒子（BillboardBatch 批处理，低频封顶 <= 48） ---------------- */
    this.buildMotes(half, wallH, tex)

    /* ---------------- 9 套主题专属程序化视觉元素（0 碰撞 / 0 点光） ---------------- */
    this.buildThemeSignature(half, wallH)

    /* ---------------- 房间布景（默认隐藏，进房间时才显示） ---------------- */
    this.buildRoomDecor()

    this.time = 0
    this.freezeShadows()
    this.built = true
  }

  /**
   * 可交互物的强调色：
   * 熔火主题的红色 accent 和地砖/裂缝太接近，祭坛与塔藏箱改用金色，
   * 让“可以按 E 交互的东西”从背景里跳出来；其他主题保持主题 accent。
   */
  private interactAccent(): number {
    const theme = this.theme
    if (!theme) return 0xffffff
    return theme.family === 'forge' ? mixHex(theme.accentColor, 0xffd166, 0.62) : theme.accentColor
  }

  /* ---------------- 祭坛 ---------------- */
  private buildAltar(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return

    const stoneMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallColor, theme.floorAltColor, 0.32),
      roughness: 0.94,
      metalness: 0.05,
      flatShading: true,
    })
    const stepR = Math.min(3.0, half * 0.2)

    // 三级八边形台阶（低矮）
    const steps = [
      { rTop: stepR * 0.82, rBot: stepR, h: 0.3, y: 0.15 },
      { rTop: stepR * 0.64, rBot: stepR * 0.76, h: 0.26, y: 0.43 },
      { rTop: stepR * 0.44, rBot: stepR * 0.56, h: 0.22, y: 0.67 },
    ]
    for (const st of steps) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(st.rTop, st.rBot, st.h, 8, 1), stoneMat)
      m.position.y = st.y
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
      this.altarSteps.push(m)
    }

    // 发光符文圈
    const accent = this.interactAccent()
    const runeMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: mixHex(accent, 0xffffff, 0.12),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.altarRuneSize = stepR * 1.62
    this.altarRuneBaseY = 0.79
    this.altarRuneBaseColor = runeMat.color.getHex()
    this.altarRune = new THREE.Mesh(new THREE.PlaneGeometry(this.altarRuneSize, this.altarRuneSize), runeMat)
    this.altarRune.rotation.x = -Math.PI / 2
    this.altarRune.position.y = this.altarRuneBaseY
    this.altarRune.renderOrder = 2
    this.root.add(this.altarRune)

    // 悬浮主题晶体（构图中心）
    const crystalMat = new THREE.MeshStandardMaterial({
      color: mixHex(accent, 0xffffff, 0.2),
      emissive: accent,
      emissiveIntensity: 1.35,
      roughness: 0.22,
      metalness: 0.25,
      flatShading: true,
    })
    this.crystalBaseY = 1.55
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 0), crystalMat)
    this.crystal.position.set(0, this.crystalBaseY, 0)
    this.crystal.rotation.set(0.3, 0.2, 0.1)
    this.crystal.castShadow = true
    this.root.add(this.crystal)

    // 塔心光柱：只增加一个透明自发光圆柱，不新增实时光源
    const beamMat = new THREE.MeshBasicMaterial({
      map: tex.beam,
      color: mixHex(accent, 0xffffff, 0.18),
      transparent: true,
      opacity: 0.13,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.altarBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, stepR * 0.82, wallH * 2.15, 16, 1, true),
      beamMat,
    )
    this.altarBeam.position.y = wallH * 1.06
    this.altarBeam.renderOrder = 3
    this.root.add(this.altarBeam)

    // 悬浮塔徽：复用符文贴图，作为“信标”的视觉核心
    const haloMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: mixHex(accent, 0xffffff, 0.28),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.altarHalo = new THREE.Mesh(new THREE.PlaneGeometry(stepR * 1.22, stepR * 1.22), haloMat)
    this.altarHalo.rotation.x = -Math.PI / 2
    this.altarHalo.position.y = this.crystalBaseY + 1.25
    this.altarHalo.renderOrder = 3
    this.root.add(this.altarHalo)

    this.altarGlowIndex = this.glowBatch?.acquire() ?? -1
    this.glowBatch?.set(
      this.altarGlowIndex,
      0,
      this.crystalBaseY + 0.25,
      0,
      5.4,
      5.4,
      accent,
      0.3,
    )

    this.altarLight = new THREE.PointLight(accent, 11, Math.max(13, half * 0.75), 2)
    this.altarLight.position.set(0, this.crystalBaseY + 0.3, 0)
    this.root.add(this.altarLight)

    // 塔心信标交互半径：站在台阶外沿也能按 E
    this.altarInteractR = stepR + 1.95

    // 祭坛单体碰撞（低矮但不可穿行）
    this.altarCollider = { x: 0, z: 0, r: stepR * 0.92 }
    this.propColliders.push(this.altarCollider)
  }

  /* ---------------- 火把 ---------------- */
  /* ---------------- 中央地标（替换塔心信标） ---------------- */
  /**
   * 每层中央放一个"一眼能认出这是什么地方"的地标。
   * 纯程序化几何 + 主题色，9 套主题共用同一套实现；不可交互，但有碰撞。
   */
  private buildLandmark(kind: 'windmill' | 'orrery' | 'gear', half: number, tex: TextureBook): void {
    void tex
    const theme = this.theme
    if (!theme) return
    this.hasLandmark = true

    const group = new THREE.Group()
    this.root.add(group)

    const stoneMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallColor, 0xffffff, 0.3),
      roughness: 0.92,
      metalness: 0.02,
    })
    const bodyMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.floorColor, 0xffffff, 0.5),
      roughness: 0.85,
    })
    const accentMat = new THREE.MeshStandardMaterial({
      color: theme.accentColor,
      roughness: 0.5,
      metalness: 0.18,
    })
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3c, roughness: 0.82 })

    const add = (mesh: THREE.Mesh, y: number): void => {
      mesh.position.y = y
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }

    const spin = new THREE.Group()
    this.landmarkSpin = spin
    this.landmarkSpinAxis = 'y'

    if (kind === 'windmill') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.35, 0.55, 14), stoneMat), 0.28)
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 1.3, 2.9, 12), bodyMat), 2.0)
      add(new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.95, 12), accentMat), 3.9)
      // 四片风车叶：几何沿 +Y 平移后绕 Z 轴均分；用深木色保证在浅色场景里有剪影
      const bladeGeo = new THREE.BoxGeometry(0.24, 2.0, 0.1)
      bladeGeo.translate(0, 1.1, 0)
      const sails = new THREE.Group()
      for (let i = 0; i < 4; i += 1) {
        const blade = new THREE.Mesh(bladeGeo, bladeMat)
        blade.rotation.z = (i * Math.PI) / 2
        blade.castShadow = true
        sails.add(blade)
      }
      sails.rotation.y = Math.PI / 2
      spin.add(sails)
      spin.position.set(0, 2.95, 1.15)
      group.add(spin)
    } else if (kind === 'orrery') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.8, 0.6, 14), stoneMat), 0.3)
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.6, 3.2, 10), stoneMat), 2.2)
      for (let i = 0; i < 3; i += 1) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1 - i * 0.35, 0.09, 8, 40), accentMat)
        ring.rotation.x = Math.PI / 2 + i * 0.42
        ring.rotation.z = i * 0.6
        ring.position.y = 4.1
        ring.castShadow = true
        spin.add(ring)
      }
      const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 1), accentMat)
      core.position.y = 4.1
      spin.add(core)
      group.add(spin)
    } else {
      // 齿轮地标：底座 + 退到后方的细立柱与横轴，正面 16:9 视角完全不遮挡巨型齿轮
      this.landmarkSpinAxis = 'z'
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.85, 0.72, 16), stoneMat), 0.36)

      const rearPost = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.46, 3.8, 10), stoneMat)
      rearPost.position.set(0, 2.1, -0.95)
      rearPost.castShadow = true
      rearPost.receiveShadow = true
      group.add(rearPost)

      const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.05, 10), stoneMat)
      axle.rotation.x = Math.PI / 2
      axle.position.set(0, 3.9, -0.45)
      axle.castShadow = true
      group.add(axle)

      // XY 平面朝向镜头的大齿轮：外环 + 轮毂 + 十字辐条 + 10 枚宽厚外齿（齿宽 0.66 >= 0.6，合批 1 drawcall）
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.34, 10, 28), accentMat)
      rim.castShadow = true
      spin.add(rim)

      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.56, 0.54, 12), accentMat)
      hub.rotation.x = Math.PI / 2
      hub.castShadow = true
      spin.add(hub)

      const spokeH = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.34, 0.26), accentMat)
      spokeH.castShadow = true
      spin.add(spokeH)
      const spokeV = new THREE.Mesh(new THREE.BoxGeometry(0.34, 3.6, 0.26), accentMat)
      spokeV.castShadow = true
      spin.add(spokeV)

      const toothCount = 10
      const toothGeo = new THREE.BoxGeometry(0.76, 0.66, 0.56)
      const toothMats: THREE.Matrix4[] = []
      const tq = new THREE.Quaternion()
      const tAxis = new THREE.Vector3(0, 0, 1)
      const tScale = new THREE.Vector3(1, 1, 1)
      for (let i = 0; i < toothCount; i += 1) {
        const a = (i / toothCount) * Math.PI * 2
        tq.setFromAxisAngle(tAxis, a)
        toothMats.push(
          new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * 2.42, Math.sin(a) * 2.42, 0), tq, tScale),
        )
      }
      const teethMesh = this.instanced(toothGeo, accentMat, toothMats, true)
      teethMesh.name = 'GearTeeth'
      spin.add(teethMesh)

      spin.position.set(0, 3.9, 0)
      spin.rotation.x = -0.14
      group.add(spin)
    }

    // 地标逆光描边环 + 背后柔光晕（保证 90 只怪同屏时仍能一眼认出当前区域）
    const backY = kind === 'windmill' ? 2.95 : kind === 'orrery' ? 4.1 : 3.9
    const rimOuter = kind === 'windmill' ? 2.55 : kind === 'orrery' ? 2.75 : 3.1
    const rimInner = rimOuter - 0.34
    const backMat = new THREE.MeshBasicMaterial({
      color: mixHex(theme.detail.backlightColor, 0xffffff, 0.32),
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const backRing = new THREE.Mesh(new THREE.RingGeometry(rimInner, rimOuter, 32), backMat)
    backRing.name = 'LandmarkBacklight'
    backRing.position.set(0, backY, -0.45)
    backRing.rotation.x = -0.22
    backRing.renderOrder = 3
    group.add(backRing)
    this.landmarkBacklight = backRing
    this.landmarkBacklightY = backY

    if (this.glowBatch) {
      this.landmarkGlowIndex = this.glowBatch.acquire()
      if (this.landmarkGlowIndex >= 0) {
        this.glowBatch.set(
          this.landmarkGlowIndex,
          0,
          backY,
          -0.55,
          rimOuter * 2.5,
          rimOuter * 2.5,
          theme.detail.backlightColor,
          0.34,
        )
      }
    }

    // 碰撞按底座半径，不按叶片：挡路但不挡视线
    this.propColliders.push({ x: 0, z: 0, r: Math.min(3.2, 2.6 + Math.max(0, half - 15) * 0.08) })
  }

  private buildTorches(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return
    const mountY = Math.max(1.5, Math.min(wallH * 0.66, wallH - 0.45))
    // S/E/N/W 四面，每面 2 支；每面只有 1 支带真实点光（4 盏 + 祭坛 1 盏 = 5 ≤ 6）
    const sides: { inx: number; inz: number; per: number }[] = [
      { inx: 0, inz: -1, per: 2 },
      { inx: -1, inz: 0, per: 2 },
      { inx: 0, inz: 1, per: 2 },
      { inx: 1, inz: 0, per: 2 },
    ]

    const bracketMats: THREE.Matrix4[] = []
    const cupMats: THREE.Matrix4[] = []
    const flameColor = mixHex(theme.torchColor, 0xffe4a8, 0.42)
    const glowColor = theme.torchColor
    this.torchFlameBase = flameColor
    this.torchLightBase = theme.torchColor

    this.torches = []

    for (const side of sides) {
      const along: number[] = []
      const spanHalf = half * 0.72
      for (let i = 0; i < side.per; i++) {
        const t = side.per === 1 ? 0 : -1 + (2 * i) / (side.per - 1)
        along.push(t * spanHalf)
      }
      // 每面亮度最高的火把带真实点光源
      const litIndex = Math.floor(along.length / 2)
      along.forEach((a, idx) => {
        let x = 0
        let z = 0
        if (side.inz !== 0) {
          x = a
          z = side.inz > 0 ? -(half - 0.5) : half - 0.5
        } else {
          z = a
          x = side.inx > 0 ? -(half - 0.5) : half - 0.5
        }
        const yaw = Math.atan2(side.inx, side.inz)

        // 铁托架（贴墙）+ 火盆
        bracketMats.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x + side.inx * 0.1, mountY, z + side.inz * 0.1),
            new THREE.Quaternion().setFromAxisAngle(UP, yaw),
            new THREE.Vector3(1, 1, 1),
          ),
        )
        cupMats.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x + side.inx * 0.4, mountY + 0.22, z + side.inz * 0.4),
            noRotQuat(),
            new THREE.Vector3(1, 1, 1),
          ),
        )

        const fx = x + side.inx * 0.48
        const fz = z + side.inz * 0.48
        const fy = mountY + 0.72
        const flameIndex = this.flameBatch?.acquire() ?? -1
        this.flameBatch?.set(flameIndex, fx, fy, fz, 0.52, 0.92, flameColor, 1)
        const glowIndex = this.glowBatch?.acquire() ?? -1
        this.glowBatch?.set(glowIndex, fx, mountY + 0.62, fz, 2.4, 2.4, glowColor, 0.34)

        let light: THREE.PointLight | null = null
        let baseIntensity = 0
        if (idx === litIndex) {
          baseIntensity = 16
          light = new THREE.PointLight(theme.torchColor, baseIntensity, Math.max(10, half * 0.55), 2)
          light.position.set(fx + side.inx * 0.25, mountY + 0.85, fz + side.inz * 0.25)
          this.root.add(light)
        }

        this.torches.push({
          flameIndex,
          seed: a * 1.7 + x * 0.13 + z * 0.07,
          light,
          baseIntensity,
          tx: fx,
          tz: fz,
          fy,
          color: flameColor,
        })
      })
    }

    // 所有墙面火把共用两个 InstancedMesh（托架/火盆）
    const bracketMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a30,
      roughness: 0.55,
      metalness: 0.7,
      flatShading: true,
    })
    const cupMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.accentColor, 0x3a2a1c, 0.6),
      roughness: 0.6,
      metalness: 0.55,
      flatShading: true,
    })
    this.root.add(
      this.instanced(new THREE.BoxGeometry(0.2, 0.34, 0.95), bracketMat, bracketMats, true),
    )
    this.root.add(
      this.instanced(new THREE.CylinderGeometry(0.3, 0.2, 0.32, 8), cupMat, cupMats, true),
    )
  }

  /* ---------------- 塔旗 ---------------- */
  private buildTowerBanners(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return

    const clothMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.accentColor, theme.wallColor, 0.7),
      roughness: 0.94,
      metalness: 0.02,
      emissive: theme.accentColor,
      emissiveIntensity: 0.05,
      side: THREE.DoubleSide,
      flatShading: true,
    })
    this.bannerClothMat = clothMat
    const rodMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallTopColor, 0x3a2a18, 0.42),
      roughness: 0.62,
      metalness: 0.55,
      flatShading: true,
    })
    const crestMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: mixHex(theme.accentColor, 0xffffff, 0.2),
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.bannerCrestMat = crestMat

    const clothGeo = new THREE.ShapeGeometry(
      (() => {
        const shape = new THREE.Shape()
        shape.moveTo(-0.85, 1.1)
        shape.lineTo(0.85, 1.1)
        shape.lineTo(0.85, -0.52)
        shape.lineTo(0, -1.1)
        shape.lineTo(-0.85, -0.52)
        shape.closePath()
        return shape
      })(),
    )
    const rodGeo = new THREE.BoxGeometry(2.0, 0.09, 0.09)
    const crestGeo = new THREE.PlaneGeometry(0.82, 0.82)
    const clothMats: THREE.Matrix4[] = []
    const rodMats: THREE.Matrix4[] = []
    const crestMats: THREE.Matrix4[] = []
    const y = wallH * 0.61
    const inset = 0.16
    const off = half * 0.52

    const spots: { x: number; z: number; ry: number }[] = [
      { x: -off, z: -half + inset, ry: 0 },
      { x: off, z: -half + inset, ry: 0 },
      { x: -off, z: half - inset, ry: Math.PI },
      { x: off, z: half - inset, ry: Math.PI },
      { x: half - inset, z: -off, ry: -Math.PI / 2 },
      { x: half - inset, z: off, ry: -Math.PI / 2 },
      { x: -half + inset, z: -off, ry: Math.PI / 2 },
      { x: -half + inset, z: off, ry: Math.PI / 2 },
    ]

    for (const s of spots) {
      const q = new THREE.Quaternion().setFromAxisAngle(UP, s.ry)
      const one = new THREE.Vector3(1, 1, 1)
      clothMats.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x, y, s.z), q, one))
      rodMats.push(
        new THREE.Matrix4().compose(new THREE.Vector3(s.x, y + 1.16, s.z), q, one),
      )
      // 塔徽略微向房间内侧偏移，避免与布料 z-fighting
      const nx = Math.sin(s.ry) * 0.026
      const nz = Math.cos(s.ry) * 0.026
      crestMats.push(
        new THREE.Matrix4().compose(new THREE.Vector3(s.x + nx, y + 0.16, s.z + nz), q, one),
      )
    }

    const cloth = this.instanced(clothGeo, clothMat, clothMats, false)
    const rod = this.instanced(rodGeo, rodMat, rodMats, true)
    const crest = this.instanced(crestGeo, crestMat, crestMats, false)
    crest.renderOrder = 3
    this.bannerMeshes.push(cloth, rod, crest)
    this.bannerBaseMatrices = [clothMats, rodMats, crestMats]
    this.bannerSides = [
      'north',
      'north',
      'south',
      'south',
      'east',
      'east',
      'west',
      'west',
    ]
    this.root.add(cloth)
    this.root.add(rod)
    this.root.add(crest)
  }

  /* ---------------- 道具 ---------------- */
  private buildProps(def: SceneDef, props: PropSet, rng: Rng): void {
    const half = def.halfSize
    const count = Math.max(0, def.props)
    const placements: PropPlacement[] = []
    const gap = 2.25
    const entrance = this.entrance
    const entryClear = TowerFloor.ENTRANCE_CLEAR

    const accept = (x: number, z: number): boolean => {
      // 留出墙边 + 不挡中央祭坛/出生点/入口
      if (Math.abs(x) > half - 2.5 || Math.abs(z) > half - 2.5) return false
      if (Math.hypot(x, z) < 4.5) return false
      // 契约 §5：入口 5m 内不许有阻挡物
      if (Math.hypot(x - entrance.x, z - entrance.z) < entryClear) return false
      for (const s of this.spawnPoints) {
        if (Math.hypot(x - s.x, z - s.z) < 2.5) return false
      }
      // 别和墙面火把打架
      for (const t of this.torches) {
        if (Math.hypot(x - t.tx, z - t.tz) < 1.9) return false
      }
      for (const p of placements) {
        if (Math.hypot(x - p.x, z - p.z) < gap) return false
      }
      for (const c of this.propColliders) {
        if (Math.hypot(x - c.x, z - c.z) < c.r + 0.9) return false
      }
      return true
    }

    const push = (x: number, z: number): void => {
      const kind = weightedPick(rng, props.kinds)
      const scale = rng.range(0.88, 1.16)
      const rot = rng.range(0, Math.PI * 2)
      placements.push({ x, z, scale, rot, kind })
      this.propColliders.push({ x, z, r: kind.colliderR * scale * 0.78 })
    }

    // 放射状三环布置：内环 → 外环，形成对称放射构图
    const rings = [0.38, 0.58, 0.77]
    for (const rf of rings) {
      if (placements.length >= count) break
      const r = half * rf
      const n = Math.max(6, Math.round((Math.PI * r) / 2.7))
      const off = Math.PI / n + rng.range(-0.12, 0.12)
      for (let i = 0; i < n; i++) {
        if (placements.length >= count) break
        const a = off + (i * Math.PI * 2) / n
        const jr = r + rng.range(-0.55, 0.55)
        const x = Math.cos(a) * jr
        const z = Math.sin(a) * jr
        if (accept(x, z)) push(x, z)
      }
    }

    // 兜底：随机补位
    let guard = 0
    while (placements.length < count && guard < 2500) {
      guard++
      const x = rng.range(-half + 2.6, half - 2.6)
      const z = rng.range(-half + 2.6, half - 2.6)
      if (accept(x, z)) push(x, z)
    }

    // 按"道具类型 + 零件序号"合并 InstancedMesh
    interface Bucket {
      geo: THREE.BufferGeometry
      mat: THREE.Material
      matrices: THREE.Matrix4[]
    }
    const buckets = new Map<string, Bucket>()
    const partQuat = new THREE.Quaternion()
    const partEuler = new THREE.Euler()

    for (const pl of placements) {
      const propM = new THREE.Matrix4().compose(
        new THREE.Vector3(pl.x, 0, pl.z),
        new THREE.Quaternion().setFromAxisAngle(UP, pl.rot),
        new THREE.Vector3(pl.scale, pl.scale, pl.scale),
      )
      for (let idx = 0; idx < pl.kind.parts.length; idx++) {
        const part = pl.kind.parts[idx]
        // 按「几何 + 材质」合并：不同道具只要零件几何/材质相同就能进同一个 InstancedMesh
        const key = part.geo.uuid + '|' + part.mat.uuid
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = { geo: part.geo, mat: part.mat, matrices: [] }
          buckets.set(key, bucket)
        }
        const pr = part.rot
        partEuler.set(pr ? pr[0] : 0, pr ? pr[1] : 0, pr ? pr[2] : 0)
        partQuat.setFromEuler(partEuler)
        const local = new THREE.Matrix4().compose(
          new THREE.Vector3(part.pos[0], part.pos[1], part.pos[2]),
          partQuat,
          new THREE.Vector3(part.scale[0], part.scale[1], part.scale[2]),
        )
        bucket.matrices.push(new THREE.Matrix4().multiplyMatrices(propM, local))
      }
    }

    for (const bucket of buckets.values()) {
      const im = new THREE.InstancedMesh(bucket.geo, bucket.mat, bucket.matrices.length)
      for (let i = 0; i < bucket.matrices.length; i++) im.setMatrixAt(i, bucket.matrices[i])
      im.instanceMatrix.needsUpdate = true
      im.castShadow = true
      im.receiveShadow = true
      im.frustumCulled = false
      this.root.add(im)
    }

    // 塔藏箱：贴着现有障碍生成，让“绕开障碍”变成值得探索的路线
    this.buildTowerCaches(def, placements, rng)
  }

  /** 在已有大型道具旁放置 2 个可开启的塔藏箱 */
  private buildTowerCaches(def: SceneDef, placements: PropPlacement[], rng: Rng): void {
    const theme = this.theme
    const tex = this.tex
    if (!theme || !tex) return
    const half = def.halfSize
    const chosen: Vec2[] = []
    const candidates = placements
      .filter((p) => Math.hypot(p.x, p.z) > half * 0.28)
      .slice()
      .sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z))

    const valid = (x: number, z: number): boolean => {
      if (Math.abs(x) > half - 2.25 || Math.abs(z) > half - 2.25) return false
      if (Math.hypot(x, z) < 4.8) return false
      if (Math.hypot(x - this.entrance.x, z - this.entrance.z) < TowerFloor.ENTRANCE_CLEAR) return false
      for (const s of this.spawnPoints) if (Math.hypot(x - s.x, z - s.z) < 2.6) return false
      for (const t of this.torches) if (Math.hypot(x - t.tx, z - t.tz) < 2.1) return false
      for (const c of chosen) if (Math.hypot(x - c.x, z - c.z) < 4.5) return false
      for (const c of this.propColliders) {
        if (Math.hypot(x - c.x, z - c.z) < c.r + 0.92) return false
      }
      return true
    }

    for (const pl of candidates) {
      if (chosen.length >= 2) break
      const base = Math.atan2(pl.z, pl.x)
      const offsets = [0, Math.PI * 0.62, -Math.PI * 0.62, Math.PI]
      for (const off of offsets) {
        const a = base + off
        const x = pl.x + Math.cos(a) * 2.15
        const z = pl.z + Math.sin(a) * 2.15
        if (!valid(x, z)) continue
        chosen.push({ x, z })
        this.spawnTowerCache(x, z, rng.range(0, Math.PI * 2), chosen.length - 1)
        break
      }
    }

    // 极端情况下（超小场景/道具全挤在中心）至少给一个，保证塔藏玩法存在
    if (chosen.length === 0) {
      for (let i = 0; i < 48 && chosen.length === 0; i++) {
        const a = (i / 48) * Math.PI * 2
        const r = half * 0.56
        const x = Math.cos(a) * r
        const z = Math.sin(a) * r
        if (!valid(x, z)) continue
        chosen.push({ x, z })
        this.spawnTowerCache(x, z, a, 0)
      }
    }
  }

  /** 木箱 + 金属箍 + 发光封印；开箱时只翻盖，不产生额外实时灯光 */
  private spawnTowerCache(x: number, z: number, rot: number, index: number): void {
    const theme = this.theme
    const tex = this.tex
    if (!theme || !tex) return

    const woodMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.propColors[0], 0x6b4a2d, 0.42),
      roughness: 0.88,
      metalness: 0.03,
      flatShading: true,
    })
    const bandMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallTopColor, 0x5a4028, 0.5),
      roughness: 0.48,
      metalness: 0.68,
      flatShading: true,
    })
    const accent = this.interactAccent()
    const sealColor = mixHex(accent, 0xffffff, 0.2)

    const group = new THREE.Group()
    group.position.set(x, 0, z)
    group.rotation.y = rot

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.64, 0.76), woodMat)
    body.position.y = 0.33
    body.castShadow = true
    body.receiveShadow = true
    group.add(body)

    for (const bx of [-0.25, 0.25]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.72, 0.8), bandMat)
      band.position.set(bx, 0.36, 0)
      band.castShadow = true
      group.add(band)
    }

    const lidPivot = new THREE.Group()
    lidPivot.position.set(0, 0.61, 0.35)
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.14, 0.82), woodMat)
    lid.position.set(0, 0.07, -0.35)
    lid.castShadow = true
    lidPivot.add(lid)
    const lidBand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.155, 0.84), bandMat)
    lidBand.position.set(0.24, 0.07, -0.35)
    lidPivot.add(lidBand)
    group.add(lidPivot)

    // 光晕/封印走合批：坐标是世界空间，不挂在 group 上（group 只放实体箱体）
    const glowIndex = this.glowBatch?.acquire() ?? -1
    this.glowBatch?.set(glowIndex, x, 0.42, z, 2.1, 2.1, accent, 0.3)
    const sealIndex = this.sealBatch?.acquire() ?? -1
    this.sealBatch?.set(sealIndex, x, 1.05, z, 0.92, 0.92, sealColor, 0.9)

    this.root.add(group)
    const collider: Circle = { x, z, r: 0.72 }
    this.propColliders.push(collider)
    this.caches.push({
      x,
      z,
      used: false,
      hidden: false,
      open: 0,
      group,
      lidPivot,
      glowIndex,
      sealIndex,
      sealColor,
      sealBaseY: 1.05,
      phase: index * 1.9 + rot,
      collider,
    })
  }

  /* ---------------- 细节层 1：地面镶边拼砖（+1 drawcall） ---------------- */
  private buildFloorInlay(half: number): void {
    const theme = this.theme
    if (!theme) return
    const detail = theme.detail
    const mats: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const edge = half - 2.4
    const len = edge * 2

    // 四周镶边石道 + 中央地标外框（与主地砖形成双拼层次）
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.012, edge), q, new THREE.Vector3(len, 0.02, 0.95)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.012, -edge), q, new THREE.Vector3(len, 0.02, 0.95)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(edge, 0.012, 0), q, new THREE.Vector3(0.95, 0.02, len)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(-edge, 0.012, 0), q, new THREE.Vector3(0.95, 0.02, len)))
    // 中央八角/十字镶边铺路
    const plaza = 4.2
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.013, plaza), q, new THREE.Vector3(plaza * 2, 0.02, 0.65)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.013, -plaza), q, new THREE.Vector3(plaza * 2, 0.02, 0.65)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(plaza, 0.013, 0), q, new THREE.Vector3(0.65, 0.02, plaza * 2)))
    mats.push(new THREE.Matrix4().compose(new THREE.Vector3(-plaza, 0.013, 0), q, new THREE.Vector3(0.65, 0.02, plaza * 2)))

    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshStandardMaterial({
      color: detail.inlayColor,
      roughness: 0.88,
      metalness: detail.airKind === 'clocktower' ? 0.22 : 0.04,
    })
    const mesh = this.instanced(geo, mat, mats, false)
    mesh.name = 'FloorInlay'
    mesh.receiveShadow = true
    this.root.add(mesh)
  }

  /* ---------------- 细节层 2：墙裙 0.6m + 独立压边（+2 drawcall） ---------------- */
  private buildWallDado(half: number): void {
    const theme = this.theme
    if (!theme) return
    const detail = theme.detail
    const size = half * 2
    const dadoH = 0.6
    const dadoD = 0.2
    const trimH = 0.11
    const trimD = 0.28

    const sides: ('south' | 'north' | 'east' | 'west')[] = ['south', 'north', 'east', 'west']
    const q = new THREE.Quaternion()
    const dadoBases: THREE.Matrix4[] = []
    const trimBases: THREE.Matrix4[] = []

    const specs: [number, number, number, number, number, number][] = [
      [size, dadoD, 0, half - dadoD / 2, size, trimD],
      [size, dadoD, 0, -(half - dadoD / 2), size, trimD],
      [dadoD, size, half - dadoD / 2, 0, trimD, size],
      [dadoD, size, -(half - dadoD / 2), 0, trimD, size],
    ]
    for (let i = 0; i < sides.length; i += 1) {
      const [dw, dd, x, z, tw, td] = specs[i]
      dadoBases.push(new THREE.Matrix4().compose(new THREE.Vector3(x, dadoH / 2, z), q, new THREE.Vector3(dw, dadoH, dd)))
      const tx = i === 2 ? half - trimD / 2 : i === 3 ? -(half - trimD / 2) : x
      const tz = i === 0 ? half - trimD / 2 : i === 1 ? -(half - trimD / 2) : z
      trimBases.push(
        new THREE.Matrix4().compose(new THREE.Vector3(tx, dadoH + trimH / 2, tz), q, new THREE.Vector3(tw, trimH, td)),
      )
    }

    const dadoMat = new THREE.MeshStandardMaterial({
      color: detail.dadoColor,
      roughness: 0.92,
      metalness: detail.airKind === 'clocktower' ? 0.26 : 0.05,
      flatShading: true,
    })
    const trimMat = new THREE.MeshStandardMaterial({
      color: detail.dadoTrimColor,
      roughness: 0.72,
      metalness: detail.airKind === 'clocktower' ? 0.35 : 0.1,
      flatShading: true,
    })

    const dadoMesh = this.instanced(new THREE.BoxGeometry(1, 1, 1), dadoMat, dadoBases, false)
    dadoMesh.name = 'WallDado'
    dadoMesh.receiveShadow = true
    const trimMesh = this.instanced(new THREE.BoxGeometry(1, 1, 1), trimMat, trimBases, false)
    trimMesh.name = 'WallDadoTrim'
    trimMesh.receiveShadow = true

    this.dadoSides = sides
    this.dadoBaseMatrices = dadoBases
    this.dadoTrimBaseMatrices = trimBases
    this.dadoMesh = dadoMesh
    this.dadoTrimMesh = trimMesh
    this.root.add(dadoMesh)
    this.root.add(trimMesh)
  }

  /* ---------------- 细节层 3：沿墙边缘堆积 0.1~0.2m（+1 drawcall，无碰撞） ---------------- */
  private buildWallDebris(half: number, rng: Rng): void {
    const theme = this.theme
    if (!theme) return
    const detail = theme.detail
    const perWall = 9
    const mats: THREE.Matrix4[] = []
    const colors: number[] = []
    const q = new THREE.Quaternion()
    const inset = half - 0.52

    for (let side = 0; side < 4; side += 1) {
      for (let i = 0; i < perWall; i += 1) {
        const t = -half + 2.0 + ((half * 2 - 4.0) * (i + rng.range(0.15, 0.85))) / perWall
        const x = side === 0 || side === 1 ? t : side === 2 ? inset : -inset
        const z = side === 0 ? inset : side === 1 ? -inset : t
        // 入口处留空，不压住进场动线
        if (side === 0 && Math.abs(x) < 2.6) continue
        const h = rng.range(0.11, 0.2)
        const sx = rng.range(0.42, 0.92)
        const sz = rng.range(0.32, 0.65)
        q.setFromAxisAngle(UP, rng.range(0, Math.PI * 2))
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h * 0.45, z), q, new THREE.Vector3(sx, h, sz)))
        colors.push(detail.debrisColors[rng.int(0, detail.debrisColors.length - 1)])
      }
    }
    if (mats.length === 0) return

    const geo = new THREE.DodecahedronGeometry(0.55, 0)
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: detail.debrisKind === 'stardust' ? 0.55 : 0.94,
      metalness: detail.debrisKind === 'rubble' ? 0.18 : 0.04,
      flatShading: true,
      emissive: detail.debrisKind === 'stardust' ? detail.debrisColors[1] : 0x000000,
      emissiveIntensity: detail.debrisKind === 'stardust' ? 0.16 : 0,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, mats.length)
    mesh.name = 'WallDebris'
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const c = new THREE.Color()
    for (let i = 0; i < mats.length; i += 1) {
      mesh.setMatrixAt(i, mats[i])
      mesh.setColorAt(i, c.setHex(colors[i]))
    }
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.root.add(mesh)
  }

  /* ---------------- 细节层 4：地面多边形亮斑（+1 drawcall，无新点光） ---------------- */
  private buildLightPatches(half: number, rng: Rng, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return
    const detail = theme.detail
    const count = 16
    const mats: THREE.Matrix4[] = []
    const q = new THREE.Quaternion()
    const rotX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
    const rotY = new THREE.Quaternion()

    for (let i = 0; i < count; i += 1) {
      const ring = i % 2 === 0 ? rng.range(half * 0.24, half * 0.48) : rng.range(half * 0.5, half * 0.78)
      const angle = (i / count) * Math.PI * 2 + detail.lightPatchAngle * 0.5 + rng.range(-0.18, 0.18)
      const x = Math.cos(angle) * ring
      const z = Math.sin(angle) * ring
      const w = rng.range(3.0, 5.2)
      const l = rng.range(3.6, 6.4)
      rotY.setFromAxisAngle(UP, detail.lightPatchAngle + rng.range(-0.18, 0.18))
      q.copy(rotY).multiply(rotX)
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.022, z), q, new THREE.Vector3(w, l, 1)))
    }

    const mat = new THREE.MeshBasicMaterial({
      map: tex.lightPatch,
      color: detail.lightPatchColor,
      transparent: true,
      opacity: detail.lightPatchOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    this.lightPatchMat = mat
    this.lightPatchBaseOpacity = detail.lightPatchOpacity

    const mesh = this.instanced(new THREE.PlaneGeometry(1, 1), mat, mats, false)
    mesh.name = 'FloorLightPatches'
    mesh.renderOrder = 2
    this.root.add(mesh)
  }

  /* ---------------- 细节层 5：场景空气粒子（低频更新 + 硬封顶 <= 48，保可读性） ---------------- */
  private buildMotes(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return
    const detail = theme.detail
    const MAX_AIR_PARTICLES = 48
    const count = Math.min(MAX_AIR_PARTICLES, Math.max(12, detail.airCount))
    this.airWallH = wallH
    this.airAccum = 0
    this.airBatch = new BillboardBatch(this.root, tex.airParticle, MAX_AIR_PARTICLES, { renderOrder: 4 })
    this.airParticles = []

    const rng = new Rng(0x51ed2701 ^ hashSeed(theme.id) ^ half)
    for (let i = 0; i < count; i += 1) {
      const secondary = i % 3 === 0
      const x = rng.range(-half + 1.2, half - 1.2)
      const y = rng.range(0.55, wallH + 0.95)
      const z = rng.range(-half + 1.2, half - 1.2)
      const size = secondary ? rng.range(0.11, 0.18) : rng.range(0.2, 0.32)
      const color = secondary ? detail.airColors[1] : detail.airColors[0]
      const alpha = secondary ? rng.range(0.35, 0.56) : rng.range(0.42, 0.68)
      const phase = rng.range(0, Math.PI * 2)
      this.airParticles.push({ x, y, z, size, color, alpha, phase, secondary })
      const slot = this.airBatch.acquire()
      if (slot >= 0) {
        this.airBatch.set(slot, x, y, z, size, size, color, alpha)
      }
    }
    this.airBatch.flush()
  }

  /* ---------------- 细节层 6：9 套主题各自专属程序化视觉元素（1~2 drawcall，0 碰撞/0 点光） ---------------- */
  private buildThemeSignature(half: number, wallH: number): void {
    const theme = this.theme
    if (!theme) return
    const rng = new Rng(0x27d4eb2f ^ hashSeed(theme.id) ^ half)
    const id = theme.id
    const rotX90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)

    if (id === 'stage1-hall') {
      // 云上花庭 · 晨光：斜射柔和晨光束 + 沿墙上缘晨露花蔓
      const beamMats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0.35, -0.22))
      for (let i = 0; i < 6; i += 1) {
        const ang = (i / 6) * Math.PI * 2 + 0.35
        const r = half * rng.range(0.42, 0.72)
        const h = wallH * 1.45
        q.copy(tilt)
        beamMats.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(ang) * r, h * 0.5, Math.sin(ang) * r), q, new THREE.Vector3(1.1, h, 1.1)))
      }
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xfff5cf,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      const beams = this.instanced(new THREE.CylinderGeometry(0.45, 1.15, 1, 8, 1, true), beamMat, beamMats, false)
      beams.name = 'SigMorningBeams'
      beams.renderOrder = 3
      this.root.add(beams)
      this.sigPulses.push({ mat: beamMat, base: 0.11, amp: 0.03, freq: 1.1 })

      // 墙檐花簇点缀
      const blossomMats: THREE.Matrix4[] = []
      const edge = half - 0.55
      for (let i = 0; i < 16; i += 1) {
        const side = i % 4
        const t = ((Math.floor(i / 4) + 0.5) / 4 - 0.5) * (half * 1.55)
        const x = side === 0 || side === 1 ? t : side === 2 ? edge : -edge
        const z = side === 0 ? -edge : side === 1 ? edge : t
        const s = rng.range(0.26, 0.42)
        blossomMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, wallH - 0.48, z), new THREE.Quaternion(), new THREE.Vector3(s, s * 0.7, s)))
      }
      const blossomMat = new THREE.MeshStandardMaterial({
        color: 0xffadc4,
        emissive: 0xff8fae,
        emissiveIntensity: 0.22,
        roughness: 0.7,
        flatShading: true,
      })
      const blossoms = this.instanced(new THREE.DodecahedronGeometry(1, 0), blossomMat, blossomMats, false)
      blossoms.name = 'SigMorningBlossoms'
      this.root.add(blossoms)
    } else if (id === 'stage1-candle') {
      // 云上花庭 · 风起：高空横掠风纹带 + 飘浮金色蒲公英伞冠
      const count = 14
      const items: { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; yaw: number; pitch: number }[] = []
      const mats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      for (let i = 0; i < count; i += 1) {
        const x = rng.range(-half + 1.5, half - 1.5)
        const y = rng.range(wallH * 0.45, wallH + 1.4)
        const z = rng.range(-half + 1.5, half - 1.5)
        const len = rng.range(1.6, 3.2)
        const yaw = 0.32
        items.push({ x, y, z, vx: 3.1, vy: 0, vz: 1.05, sx: len, sy: 0.08, sz: 0.24, yaw, pitch: 0 })
        q.setFromEuler(new THREE.Euler(0, yaw, 0))
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(len, 0.08, 0.24)))
      }
      const windMat = new THREE.MeshBasicMaterial({
        color: 0xfff0b8,
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const windMesh = this.instanced(new THREE.BoxGeometry(1, 1, 1), windMat, mats, false)
      windMesh.name = 'SigWindRibbons'
      windMesh.renderOrder = 4
      this.root.add(windMesh)
      this.sigDrifters = { mesh: windMesh, items, lim: half - 0.8 }
    } else if (id === 'stage1-courtyard') {
      // 云上花庭 · 花落：贴地落樱花毯 + 慢转空中樱瓣环
      const carpetMats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      const rotY = new THREE.Quaternion()
      for (let i = 0; i < 36; i += 1) {
        const ang = rng.range(0, Math.PI * 2)
        const r = half * rng.range(0.22, 0.86)
        const s = rng.range(0.18, 0.36)
        rotY.setFromAxisAngle(UP, rng.range(0, Math.PI * 2))
        q.copy(rotY).multiply(rotX90)
        carpetMats.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(ang) * r, 0.028, Math.sin(ang) * r), q, new THREE.Vector3(s, s * 0.65, 1)))
      }
      const petalMat = new THREE.MeshBasicMaterial({
        color: 0xffa4c2,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      })
      const carpet = this.instanced(new THREE.CircleGeometry(1, 5), petalMat, carpetMats, false)
      carpet.name = 'SigPetalCarpet'
      carpet.renderOrder = 2
      this.root.add(carpet)

      const ringGroup = new THREE.Group()
      ringGroup.position.set(0, wallH * 0.72, 0)
      const ringMats: THREE.Matrix4[] = []
      for (let i = 0; i < 16; i += 1) {
        const a = (i / 16) * Math.PI * 2
        const r = half * 0.38
        q.setFromEuler(new THREE.Euler(rng.range(-0.6, 0.6), a, rng.range(-0.5, 0.5)))
        ringMats.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, Math.sin(i * 1.3) * 0.55, Math.sin(a) * r), q, new THREE.Vector3(0.24, 0.14, 0.04)))
      }
      const swirl = this.instanced(new THREE.BoxGeometry(1, 1, 1), petalMat, ringMats, false)
      swirl.name = 'SigPetalSwirl'
      ringGroup.add(swirl)
      this.root.add(ringGroup)
      this.sigSpinners.push({ obj: ringGroup, axis: 'y', speed: 0.28 })
    } else if (id === 'stage2-forge') {
      // 星砂观星台 · 暮色：悬空双层黄道星轨环 + 发光星点
      const astroGroup = new THREE.Group()
      astroGroup.position.set(0, wallH + 1.85, 0)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffdc82,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const outer = new THREE.Mesh(new THREE.TorusGeometry(half * 0.44, 0.06, 6, 48), ringMat)
      outer.rotation.x = Math.PI / 2 + 0.18
      astroGroup.add(outer)
      const inner = new THREE.Mesh(new THREE.TorusGeometry(half * 0.28, 0.045, 6, 36), ringMat)
      inner.rotation.x = Math.PI / 2 - 0.24
      inner.rotation.y = 0.4
      astroGroup.add(inner)
      this.root.add(astroGroup)
      this.sigSpinners.push({ obj: astroGroup, axis: 'y', speed: 0.18 })
      this.sigPulses.push({ mat: ringMat, base: 0.36, amp: 0.08, freq: 1.4 })
    } else if (id === 'stage2-slag') {
      // 星砂观星台 · 砂河：贴地青白发光星砂河带 + 沿河微光砂晶
      const segMats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      const rotY = new THREE.Quaternion()
      const segs = 12
      for (let i = 0; i < segs; i += 1) {
        const u = (i / (segs - 1)) * 2 - 1
        const x = u * (half - 2.2)
        const z = Math.sin(u * 2.1) * (half * 0.28)
        const slope = Math.cos(u * 2.1) * 2.1 * (half * 0.28) / (half - 2.2)
        rotY.setFromAxisAngle(UP, -Math.atan(slope))
        q.copy(rotY).multiply(rotX90)
        segMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 0.026, z), q, new THREE.Vector3((half * 2) / segs * 1.25, 2.1, 1)))
      }
      const riverMat = new THREE.MeshBasicMaterial({
        color: 0x9cf0ff,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const river = this.instanced(new THREE.PlaneGeometry(1, 1), riverMat, segMats, false)
      river.name = 'SigStardustRiver'
      river.renderOrder = 2
      this.root.add(river)
      this.sigPulses.push({ mat: riverMat, base: 0.18, amp: 0.045, freq: 1.5 })
    } else if (id === 'stage2-ember') {
      // 星砂观星台 · 流星：高空统一斜角划过的粉紫/银白流星拖尾光梭
      const count = 10
      const items: { x: number; y: number; z: number; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; yaw: number; pitch: number }[] = []
      const mats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      for (let i = 0; i < count; i += 1) {
        const x = rng.range(-half, half)
        const y = rng.range(wallH + 1.1, wallH + 3.0)
        const z = rng.range(-half, half)
        const len = rng.range(2.2, 3.8)
        items.push({ x, y, z, vx: -4.2, vy: -0.45, vz: 1.8, sx: len, sy: 0.09, sz: 0.09, yaw: -0.4, pitch: -0.14 })
        q.setFromEuler(new THREE.Euler(-0.14, -0.4, 0))
        mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(len, 0.09, 0.09)))
      }
      const meteorMat = new THREE.MeshBasicMaterial({
        color: 0xffc2e2,
        transparent: true,
        opacity: 0.46,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const meteors = this.instanced(new THREE.BoxGeometry(1, 1, 1), meteorMat, mats, false)
      meteors.name = 'SigMeteorStreaks'
      meteors.renderOrder = 4
      this.root.add(meteors)
      this.sigDrifters = { mesh: meteors, items, lim: half + 1.5 }
    } else if (id === 'stage3-frost') {
      // 黄铜钟塔 · 齿轮厅：墙缘慢转黄铜齿轮组 + 贴地青绿齿轮雾环
      const gearMat = new THREE.MeshStandardMaterial({
        color: 0xd4ad6a,
        roughness: 0.42,
        metalness: 0.58,
        emissive: 0x5c4218,
        emissiveIntensity: 0.16,
        flatShading: true,
      })
      const gearSpots: [number, number, number, number][] = [
        [-half * 0.58, wallH * 0.65, -half + 0.18, 1.35],
        [half * 0.58, wallH * 0.65, -half + 0.18, -1.15],
      ]
      for (const [gx, gy, gz, spd] of gearSpots) {
        const g = new THREE.Group()
        g.position.set(gx, gy, gz)
        const rim = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.14, 6, 16), gearMat)
        g.add(rim)
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 0.14), gearMat)
        g.add(spoke)
        const spoke2 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.2, 0.14), gearMat)
        g.add(spoke2)
        this.root.add(g)
        this.sigSpinners.push({ obj: g, axis: 'z', speed: spd * 0.35 })
      }
      const mistMat = new THREE.MeshBasicMaterial({
        color: 0x72e6c8,
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const mist = new THREE.Mesh(new THREE.TorusGeometry(half * 0.68, 0.45, 6, 40), mistMat)
      mist.rotation.x = Math.PI / 2
      mist.position.y = 0.18
      mist.name = 'SigGearMist'
      this.root.add(mist)
      this.sigPulses.push({ mat: mistMat, base: 0.14, amp: 0.04, freq: 1.2 })
    } else if (id === 'stage3-iron') {
      // 黄铜钟塔 · 熔金槽：外圈嵌地熔金沟槽带 + 热浪微光
      const edge = half - 2.1
      const len = edge * 2
      const mats: THREE.Matrix4[] = []
      const q0 = rotX90.clone()
      const q90 = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2).multiply(rotX90)
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.027, edge), q0, new THREE.Vector3(len, 0.55, 1)))
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 0.027, -edge), q0, new THREE.Vector3(len, 0.55, 1)))
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(edge, 0.027, 0), q90, new THREE.Vector3(len, 0.55, 1)))
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(-edge, 0.027, 0), q90, new THREE.Vector3(len, 0.55, 1)))
      const moltenMat = new THREE.MeshBasicMaterial({
        color: 0xff8c2b,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const channels = this.instanced(new THREE.PlaneGeometry(1, 1), moltenMat, mats, false)
      channels.name = 'SigMoltenChannels'
      channels.renderOrder = 2
      this.root.add(channels)
      this.sigPulses.push({ mat: moltenMat, base: 0.34, amp: 0.09, freq: 1.9 })
    } else if (id === 'stage3-throne') {
      // 黄铜钟塔 · 塔心：悬空紫金钟面天穹环 + 12 刻度块 + 慢转指针
      const dialGroup = new THREE.Group()
      dialGroup.position.set(0, wallH + 2.0, 0)
      const dialMat = new THREE.MeshBasicMaterial({
        color: 0xffd066,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
      const ring = new THREE.Mesh(new THREE.TorusGeometry(half * 0.42, 0.075, 6, 48), dialMat)
      ring.rotation.x = Math.PI / 2
      dialGroup.add(ring)
      const tickMats: THREE.Matrix4[] = []
      const q = new THREE.Quaternion()
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * Math.PI * 2
        const r = half * 0.42
        q.setFromAxisAngle(UP, -a)
        tickMats.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q, new THREE.Vector3(0.55, 0.06, 0.14)))
      }
      const ticks = this.instanced(new THREE.BoxGeometry(1, 1, 1), dialMat, tickMats, false)
      ticks.name = 'SigClockDialTicks'
      dialGroup.add(ticks)
      this.root.add(dialGroup)
      this.sigSpinners.push({ obj: dialGroup, axis: 'y', speed: 0.14 })
      this.sigPulses.push({ mat: dialMat, base: 0.34, amp: 0.08, freq: 1.3 })
    }
  }

  /* ================================================================ */
  /*  房间 preset：同一竞技场的低成本辨识度层                            */
  /* ================================================================ */

  /**
   * 进入/离开房间时切换整层布景。
   * - 非祭坛房隐藏中央祭坛，避免“每个房间都有一座塔心信坛”
   * - 祭坛符文移到 NPC/篝火脚下，作为房间色环（仍是原来那 1 个 drawcall）
   * - 非宝藏房隐藏塔藏箱，宝藏房保留
   * - 火把、旗帜、地面自发光、边界线按房间色轻微染色
   * - 房间布景由 2 个 InstancedMesh 承载（盒/柱），最多 +2 drawcall
   */
  setRoomPreset(kind: TunnelRoom | null, focusX = 0, focusZ = 0): void {
    if (!this.built) return
    this.roomPreset = kind
    this.roomAccent = kind ? ROOM_ACCENT[kind] : 0
    const altarRoom = kind === 'altar'
    this.roomFocus.x = altarRoom ? 0 : focusX
    this.roomFocus.z = altarRoom ? 0 : focusZ
    this.setAltarRoomMode(kind === null || altarRoom)
    this.setCachesRoomMode(kind === null || kind === 'chest')
    this.applyRoomPalette(kind)
    this.applyRoomDecor(kind)
  }

  private addCollider(target: Circle | null): void {
    if (target && !this.propColliders.includes(target)) this.propColliders.push(target)
  }

  private removeCollider(target: Circle | null): void {
    if (!target) return
    const index = this.propColliders.indexOf(target)
    if (index >= 0) this.propColliders.splice(index, 1)
  }

  private setAltarRoomMode(visible: boolean): void {
    for (const step of this.altarSteps) step.visible = visible
    if (this.crystal) this.crystal.visible = visible
    if (this.altarBeam) this.altarBeam.visible = visible
    if (this.altarHalo) this.altarHalo.visible = visible

    if (this.altarRune) {
      const mat = this.altarRune.material as THREE.MeshBasicMaterial
      if (visible) {
        this.altarRune.position.set(0, this.altarRuneBaseY, 0)
        this.altarRune.scale.set(1, 1, 1)
        mat.color.setHex(this.altarRuneBaseColor)
      } else {
        // 7.2m 直径的地面印记：NPC/篝火站在环心，玩家远远就能读出房间类型
        const scale = 7.2 / Math.max(0.001, this.altarRuneSize)
        this.altarRune.position.set(this.roomFocus.x, 0.045, this.roomFocus.z)
        this.altarRune.scale.set(scale, scale, 1)
        mat.color.setHex(this.roomAccent || this.altarRuneBaseColor)
      }
    }

    if (visible) this.addCollider(this.altarCollider)
    else this.removeCollider(this.altarCollider)

    if (this.altarLight) {
      if (visible) {
        this.altarLight.position.set(0, this.crystalBaseY + 0.3, 0)
        this.altarLight.color.setHex(this.interactAccent())
        this.altarLight.intensity = 10.5
      } else {
        this.altarLight.position.set(this.roomFocus.x, 1.6, this.roomFocus.z)
        this.altarLight.color.setHex(this.roomAccent)
        this.altarLight.intensity = 7.5
      }
    }

    if (this.altarGlowIndex >= 0 && this.glowBatch) {
      if (visible) {
        this.glowBatch.set(this.altarGlowIndex, 0, this.crystalBaseY + 0.25, 0, 5.4, 5.4, this.interactAccent(), 0.3)
      } else {
        this.glowBatch.set(
          this.altarGlowIndex,
          this.roomFocus.x,
          1.35,
          this.roomFocus.z,
          3.8,
          3.8,
          this.roomAccent,
          0.2,
        )
      }
    }
  }

  private setCachesRoomMode(visible: boolean): void {
    for (const cache of this.caches) {
      cache.hidden = !visible
      cache.group.visible = visible
      if (visible) {
        this.addCollider(cache.collider)
        if (!cache.used) {
          this.sealBatch?.setAlpha(cache.sealIndex, 0.9)
          this.glowBatch?.setAlpha(cache.glowIndex, 0.3)
        }
      } else {
        this.removeCollider(cache.collider)
        this.sealBatch?.setAlpha(cache.sealIndex, 0)
        this.glowBatch?.setAlpha(cache.glowIndex, 0)
      }
    }
  }

  private applyRoomPalette(kind: TunnelRoom | null): void {
    const theme = this.theme
    if (!theme) return
    const accent = kind ? ROOM_ACCENT[kind] : 0
    const clothBase = mixHex(theme.accentColor, theme.wallColor, 0.7)
    const crestBase = mixHex(theme.accentColor, 0xffffff, 0.2)
    const floorBase = mixHex(theme.floorColor, theme.accentColor, 0.22)

    for (const torch of this.torches) {
      torch.color = kind ? mixHex(this.torchFlameBase, accent, 0.28) : this.torchFlameBase
      if (torch.light) {
        torch.light.color.setHex(kind ? mixHex(this.torchLightBase, accent, 0.22) : this.torchLightBase)
      }
    }
    if (this.bannerClothMat) {
      this.bannerClothMat.color.setHex(kind ? mixHex(clothBase, accent, 0.42) : clothBase)
    }
    if (this.bannerCrestMat) {
      this.bannerCrestMat.color.setHex(kind ? mixHex(crestBase, accent, 0.35) : crestBase)
    }
    if (this.floorMat) {
      this.floorMat.emissive.setHex(kind ? mixHex(theme.floorColor, accent, 0.2) : floorBase)
      this.floorMat.emissiveIntensity = kind ? 0.085 : 0.075
    }
    if (this.boundaryMat) {
      this.boundaryMat.color.setHex(kind ? mixHex(this.boundaryBaseColor, accent, 0.55) : this.boundaryBaseColor)
    }
  }

  private applyRoomDecor(kind: TunnelRoom | null): void {
    const box = this.roomDecorBox
    const cyl = this.roomDecorCyl
    if (!box || !cyl) return
    if (!kind) {
      box.count = 0
      cyl.count = 0
      box.visible = false
      cyl.visible = false
      return
    }

    const specs = roomDecorPieces(kind)
    const matrix = new THREE.Matrix4()
    const quat = new THREE.Quaternion()
    const pos = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const color = new THREE.Color()
    let boxCount = 0
    let cylCount = 0

    for (const spec of specs) {
      const mesh = spec.shape === 'box' ? box : cyl
      const index = spec.shape === 'box' ? boxCount++ : cylCount++
      pos.set(spec.x, spec.y, spec.z)
      quat.setFromAxisAngle(UP, spec.ry ?? 0)
      scale.set(spec.sx, spec.sy, spec.sz)
      matrix.compose(pos, quat, scale)
      mesh.setMatrixAt(index, matrix)
      color.setHex(this.decorColor(spec.tone, this.roomAccent))
      // 逐件轻微明度差，避免同色家具像一整块塑料
      color.offsetHSL(0, 0, ((index % 5) - 2) * 0.012)
      mesh.setColorAt(index, color)
    }

    box.count = boxCount
    cyl.count = cylCount
    box.visible = boxCount > 0
    cyl.visible = cylCount > 0
    box.instanceMatrix.needsUpdate = true
    cyl.instanceMatrix.needsUpdate = true
    if (box.instanceColor) box.instanceColor.needsUpdate = true
    if (cyl.instanceColor) cyl.instanceColor.needsUpdate = true
  }

  private decorColor(tone: DecorTone, accent: number): number {
    const theme = this.theme
    if (!theme) return 0xffffff
    const p0 = theme.propColors[0] ?? theme.wallColor
    const p1 = theme.propColors[1] ?? theme.wallColor
    const p2 = theme.propColors[2] ?? theme.wallColor
    switch (tone) {
      case 'wood':
        return mixHex(mixHex(p1, 0x5c3a24, 0.45), accent, 0.06)
      case 'gold':
        return mixHex(mixHex(theme.accentColor, 0xffd166, 0.55), 0x3a2a16, 0.18)
      case 'stone':
        return mixHex(mixHex(mixHex(theme.wallColor, p0, 0.6), p2, 0.3), accent, 0.08)
      case 'dark':
        return mixHex(mixHex(theme.wallColor, p2, 0.4), 0x0e1118, 0.35)
      case 'accent':
      default:
        // 檐口/灯火帽：保留房间色，但压进石色里，避免大块高饱和色块
        return mixHex(mixHex(theme.accentColor, accent, 0.7), theme.wallColor, 0.38)
    }
  }

  private buildRoomDecor(): void {
    const boxGeo = new THREE.BoxGeometry(1, 1, 1)
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1)
    const boxMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    })
    const cylMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0.02,
      flatShading: true,
    })
    // 最多的一间是精英房：20 个盒件；留 4 个余量给后续微调。
    const box = new THREE.InstancedMesh(boxGeo, boxMat, 24)
    const cyl = new THREE.InstancedMesh(cylGeo, cylMat, 8)
    box.name = 'RoomDecorBox'
    cyl.name = 'RoomDecorCyl'
    const zero = new THREE.Matrix4().makeScale(0, 0, 0)
    const white = new THREE.Color(0xffffff)
    for (const [mesh, cap] of [
      [box, 24],
      [cyl, 8],
    ] as const) {
      mesh.frustumCulled = false
      // 阴影贴图已在 build 末尾冻结；房间布景不进阴影，避免进房时重算导致闪影。
      mesh.castShadow = false
      mesh.receiveShadow = true
      for (let i = 0; i < cap; i += 1) {
        mesh.setMatrixAt(i, zero)
        mesh.setColorAt(i, white)
      }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.count = 0
      mesh.visible = false
      this.root.add(mesh)
    }
    this.roomDecorBox = box
    this.roomDecorCyl = cyl
  }

  /* ================================================================ */
  /*  每帧更新                                                          */
  /* ================================================================ */

  update(dt: number, _elapsed: number): void {
    if (!this.built) return
    this.time += dt
    const t = this.time
    if (this.landmarkSpin) {
      const spinSpeed = this.theme?.detail.landmarkSpinSpeed ?? 0.5
      if (this.landmarkSpinAxis === 'z') this.landmarkSpin.rotation.z -= dt * spinSpeed
      else this.landmarkSpin.rotation.y += dt * spinSpeed
    }
    if (this.landmarkBacklight) {
      const mat = this.landmarkBacklight.material as THREE.MeshBasicMaterial
      mat.opacity = 0.38 + Math.sin(t * 1.9) * 0.08
    }
    if (this.landmarkGlowIndex >= 0 && this.glowBatch && this.theme) {
      const pulse = 6.2 + Math.sin(t * 1.5) * 0.45
      this.glowBatch.set(
        this.landmarkGlowIndex,
        0,
        this.landmarkBacklightY,
        -0.55,
        pulse,
        pulse,
        this.theme.detail.backlightColor,
        0.3 + Math.sin(t * 1.8) * 0.05,
      )
    }
    if (this.lightPatchMat) {
      const shimmer = this.theme?.detail.lightPatchKind === 'canopy' ? 0.045 : 0.02
      this.lightPatchMat.opacity = this.lightPatchBaseOpacity + Math.sin(t * 1.3) * shimmer
    }
    if (this.boundaryMat) {
      // 很轻的呼吸，不抢角色；墙被隐藏时这条光带就是唯一的边界提示。
      this.boundaryMat.opacity = 0.3 + Math.sin(t * 1.7) * 0.05
    }
    this.altarFlash = Math.max(0, this.altarFlash - dt * 0.7)

    // 塔心信标：符文旋转 + 晶体呼吸 + 光柱脉冲。
    // 进房间后非祭坛房会把符文移到 NPC 脚下当地面印记，动效也换成更慢的呼吸。
    const roomRing = this.roomPreset !== null && this.roomPreset !== 'altar'
    if (this.altarRune) {
      this.altarRune.rotation.z = t * (roomRing ? 0.06 : this.altarUsed ? 0.18 : 0.12)
      const mat = this.altarRune.material as THREE.MeshBasicMaterial
      mat.opacity = roomRing
        ? 0.42 + Math.sin(t * 1.2) * 0.05
        : 0.66 + (this.altarUsed ? 0.12 : 0) + this.altarFlash * 0.18
    }
    if (this.crystal) {
      this.crystal.rotation.y = t * 0.55
      this.crystal.position.y = this.crystalBaseY + Math.sin(t * 1.1) * 0.12 + this.altarFlash * 0.18
    }
    if (this.altarBeam) {
      const mat = this.altarBeam.material as THREE.MeshBasicMaterial
      mat.opacity = 0.1 + (this.altarUsed ? 0.07 : 0.02) + Math.sin(t * 1.4) * 0.018 + this.altarFlash * 0.24
      this.altarBeam.rotation.y = t * 0.14
    }
    if (this.altarHalo) {
      this.altarHalo.rotation.z = -t * (this.altarUsed ? 0.45 : 0.26)
      const mat = this.altarHalo.material as THREE.MeshBasicMaterial
      mat.opacity = 0.46 + Math.sin(t * 1.6) * 0.08 + this.altarFlash * 0.3
    }
    if (this.altarGlowIndex >= 0 && this.glowBatch) {
      const fx = roomRing ? this.roomFocus.x : 0
      const fz = roomRing ? this.roomFocus.z : 0
      const s = (roomRing ? 3.8 : 5.2) + Math.sin(t * 1.2) * 0.35 + this.altarFlash * 1.4
      const alpha = (roomRing ? 0.2 : 0.27) + Math.sin(t * 1.7) * 0.04 + this.altarFlash * 0.2
      const c = roomRing ? this.roomAccent : this.interactAccent()
      this.glowBatch.set(this.altarGlowIndex, fx, roomRing ? 1.35 : this.crystalBaseY + 0.25, fz, s, s, c, alpha)
    }
    if (this.altarLight) {
      const base = roomRing ? 7.5 : this.altarUsed ? 13.5 : 10.5
      this.altarLight.intensity = base + Math.sin(t * 1.5) * 0.7 + this.altarFlash * 6
    }

    // 塔藏箱：未开启时封印悬浮旋转，开启后箱盖翻开
    for (const cache of this.caches) {
      if (cache.hidden) continue
      if (cache.used) {
        cache.open = Math.min(1, cache.open + dt * 3.8)
        const e = 1 - (1 - cache.open) * (1 - cache.open)
        cache.lidPivot.rotation.x = 1.18 * e
        if (cache.open > 0.15) this.sealBatch?.setAlpha(cache.sealIndex, 0)
      } else {
        const y = cache.sealBaseY + Math.sin(t * 1.7 + cache.phase) * 0.08
        const s = 0.9 + Math.sin(t * 2.1 + cache.phase) * 0.06
        const alpha = 0.82 + Math.sin(t * 2.3 + cache.phase) * 0.08
        this.sealBatch?.set(cache.sealIndex, cache.x, y, cache.z, s, s, cache.sealColor, alpha, 0, 0, 1, 1, t * 0.65 + cache.phase)
      }
    }

    // 火把：火焰缩放抖动 + 真实点光源闪烁
    for (const torch of this.torches) {
      const s = torch.seed
      const f =
        0.95 +
        Math.sin(t * 1.6 + s) * 0.05 +
        Math.sin(t * 0.9 + s * 1.7) * 0.03 +
        Math.sin(t * 2.3 + s * 0.4) * 0.02
      this.flameBatch?.set(torch.flameIndex, torch.tx, torch.fy, torch.tz, 0.42 + f * 0.1, 0.7 + f * 0.22, torch.color, 1)
      if (torch.light) {
        torch.light.intensity = torch.baseIntensity
      }
    }

    // 熔岩/冰晶等主题自发光材质呼吸
    if (this.props && this.props.pulse) {
      this.props.pulse.emissiveIntensity = 1.35
    }

    // 主题专属程序化元素动画（低开销慢转 / 呼吸 / 漂移）
    for (const sp of this.sigSpinners) {
      sp.obj.rotation[sp.axis] += dt * sp.speed
    }
    for (const pl of this.sigPulses) {
      pl.mat.opacity = pl.base + Math.sin(t * pl.freq) * pl.amp
    }
    if (this.sigDrifters) {
      const { mesh, items, lim } = this.sigDrifters
      const span = lim * 2
      const m = new THREE.Matrix4()
      const q = new THREE.Quaternion()
      const e = new THREE.Euler()
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]
        it.x += it.vx * dt
        it.y += it.vy * dt
        it.z += it.vz * dt
        if (it.x > lim) it.x -= span
        else if (it.x < -lim) it.x += span
        if (it.z > lim) it.z -= span
        else if (it.z < -lim) it.z += span
        if (it.y < this.airWallH * 0.4) it.y = this.airWallH + 2.6
        e.set(it.pitch, it.yaw, 0)
        q.setFromEuler(e)
        m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz))
        mesh.setMatrixAt(i, m)
      }
      mesh.instanceMatrix.needsUpdate = true
    }

    // 场景空气粒子低频更新（~30Hz 刷新，封顶 <= 48，兼顾流畅与可读性）
    this.airAccum += dt
    if (this.airBatch && this.airParticles.length > 0 && this.theme && this.airAccum >= 1 / 30) {
      const step = this.airAccum
      this.airAccum = 0
      const drift = this.theme.detail.airDrift
      const lim = Math.max(2, this.halfSize - 1.1)
      const minY = 0.45
      const maxY = this.airWallH + 1.0
      const span = lim * 2
      const spanY = maxY - minY
      for (let i = 0; i < this.airParticles.length; i += 1) {
        const pt = this.airParticles[i]
        const speedMul = pt.secondary ? 1.35 : 1.0
        pt.x += (drift.vx * speedMul + Math.sin(t * 0.9 + pt.phase) * drift.sway * 0.45) * step
        pt.y += (drift.vy * speedMul + Math.cos(t * 1.1 + pt.phase * 1.3) * 0.18) * step
        pt.z += (drift.vz * speedMul + Math.cos(t * 0.8 + pt.phase * 0.7) * drift.sway * 0.45) * step
        if (pt.x > lim) pt.x -= span
        else if (pt.x < -lim) pt.x += span
        if (pt.z > lim) pt.z -= span
        else if (pt.z < -lim) pt.z += span
        if (pt.y > maxY) pt.y -= spanY
        else if (pt.y < minY) pt.y += spanY
        const twinkle = pt.secondary ? 0.72 + Math.sin(t * 3.4 + pt.phase) * 0.28 : 0.85 + Math.sin(t * 1.6 + pt.phase) * 0.15
        this.airBatch.set(i, pt.x, pt.y, pt.z, pt.size, pt.size, pt.color, pt.alpha * twinkle, 0, 0, 1, 1, t * 0.6 + pt.phase)
      }
      this.airBatch.flush()
    }

    this.glowBatch?.flush()
    this.flameBatch?.flush()
    this.sealBatch?.flush()
  }

  /* ================================================================ */
  /*  塔内交互                                                          */
  /* ================================================================ */

  /** 玩家附近可交互对象；没有则返回 null（HUD 据此隐藏 E 提示） */
  interactionAt(px: number, pz: number): TowerInteraction | null {
    if (!this.built) return null
    let best: TowerInteraction | null = null
    let bestD = Infinity

    if (!this.altarUsed && !this.hasLandmark) {
      const d = Math.hypot(px, pz)
      if (d <= this.altarInteractR) {
        best = {
          kind: 'altar',
          index: -1,
          x: 0,
          z: 0,
          title: '塔心信标',
          hint: '共鸣',
        }
        bestD = d
      }
    }

    for (let i = 0; i < this.caches.length; i++) {
      const c = this.caches[i]
      if (c.used || c.hidden) continue
      const d = Math.hypot(px - c.x, pz - c.z)
      if (d > 2.2 || d >= bestD) continue
      best = {
        kind: 'cache',
        index: i,
        x: c.x,
        z: c.z,
        title: '塔藏箱',
        hint: '开启',
      }
      bestD = d
    }
    return best
  }

  /** 执行交互；返回本次交互信息，失败返回 null。奖励由 Game 结算。 */
  interactAt(px: number, pz: number): TowerInteraction | null {
    const info = this.interactionAt(px, pz)
    if (!info) return null
    if (info.kind === 'altar') {
      this.altarUsed = true
      this.altarFlash = 1
      return info
    }
    const cache = this.caches[info.index]
    if (!cache || cache.used) return null
    cache.used = true
    cache.open = 0
    return info
  }

  get altarConsumed(): boolean {
    return this.altarUsed
  }

  get cacheTotal(): number {
    return this.caches.length
  }

  /* ================================================================ */
  /*  查询类 API                                                        */
  /* ================================================================ */

  isInside(x: number, z: number, radius: number): boolean {
    const r = Math.max(0, radius)
    const lim = this.halfSize - r
    if (lim <= 0) return Math.abs(x) <= 0.001 && Math.abs(z) <= 0.001
    return Math.abs(x) <= lim && Math.abs(z) <= lim
  }

  clampToArena(x: number, z: number, radius: number): Vec2 {
    const r = Math.max(0, radius)
    const lim = Math.max(0, this.halfSize - r)
    return {
      x: Math.max(-lim, Math.min(lim, x)),
      z: Math.max(-lim, Math.min(lim, z)),
    }
  }

  /** 某点是否被道具/祭坛/入口净空区占据（pad 为额外安全距离） */
  private blocked(x: number, z: number, pad: number): boolean {
    for (const c of this.propColliders) {
      if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true
    }
    // 入口净空区（掉落物也别堆在出生点脚下）：5m 净空再内缩 1.2m
    if (Math.hypot(x - this.entrance.x, z - this.entrance.z) < TowerFloor.ENTRANCE_CLEAR - 1.2) {
      return true
    }
    return false
  }

  scatterPoints(count: number, minFromCenter = 0): Vec2[] {
    const out: Vec2[] = []
    if (!this.built || count <= 0) return out
    const half = this.halfSize
    const center = Math.max(minFromCenter, 3.9)
    const margin = 1.5
    const minGap = 1.35

    let guard = 0
    const maxGuard = count * 140 + 300
    while (out.length < count && guard < maxGuard) {
      guard++
      const x = this.dropRng.range(-half + margin, half - margin)
      const z = this.dropRng.range(-half + margin, half - margin)
      if (Math.hypot(x, z) < center) continue
      if (this.blocked(x, z, 0.95)) continue
      let ok = true
      for (const p of out) {
        if (Math.hypot(x - p.x, z - p.z) < minGap) {
          ok = false
          break
        }
      }
      if (ok) out.push({ x, z })
    }

    // 极端情况下用网格兜底，保证返回数量
    if (out.length < count) {
      const lim = half - margin
      const n = Math.ceil(Math.sqrt(count * 3)) + 2
      outer: for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          if (out.length >= count) break outer
          const x = -lim + (2 * lim * (i + 0.5)) / n
          const z = -lim + (2 * lim * (j + 0.5)) / n
          if (Math.hypot(x, z) < center) continue
          if (this.blocked(x, z, 0.8)) continue
          let ok = true
          for (const p of out) {
            if (Math.hypot(x - p.x, z - p.z) < minGap * 0.8) {
              ok = false
              break
            }
          }
          if (ok) out.push({ x, z })
        }
      }
    }

    return out
  }

  /* ================================================================ */
  /*  清理                                                             */
  /* ================================================================ */

  private clear(): void {
    this.built = false
    this.torches.length = 0
    this.bannerMeshes.length = 0
    this.bannerSides.length = 0
    this.bannerBaseMatrices.length = 0
    this.hiddenWalls.clear()
    this.boundaryMesh = null
    this.boundaryMat = null
    this.altarRune = null
    this.crystal = null
    this.altarLight = null
    this.altarBeam = null
    this.altarHalo = null
    this.altarGlowIndex = -1
    this.altarUsed = false
    this.altarFlash = 0
    this.altarSteps.length = 0
    this.altarCollider = null
    this.caches.length = 0
    this.keyLight = null
    this.floorMat = null
    this.bannerClothMat = null
    this.bannerCrestMat = null
    this.roomDecorBox = null
    this.roomDecorCyl = null
    this.roomPreset = null
    this.roomAccent = 0
    this.roomFocus.x = 0
    this.roomFocus.z = 0
    this.landmarkSpin = null
    this.landmarkBacklight = null
    this.landmarkGlowIndex = -1
    this.dadoMesh = null
    this.dadoTrimMesh = null
    this.dadoSides.length = 0
    this.dadoBaseMatrices.length = 0
    this.dadoTrimBaseMatrices.length = 0
    this.lightPatchMat = null
    this.airParticles.length = 0
    this.airAccum = 0
    this.sigSpinners.length = 0
    this.sigPulses.length = 0
    this.sigDrifters = null

    this.airBatch?.dispose()
    this.airBatch = null
    this.glowBatch?.dispose()
    this.flameBatch?.dispose()
    this.sealBatch?.dispose()
    this.glowBatch = null
    this.flameBatch = null
    this.sealBatch = null

    disposeTree(this.root)

    if (this.tex) {
      this.tex.dispose()
      this.tex = null
    }
    if (this.props) {
      this.props.dispose()
      this.props = null
    }

    this.propColliders.length = 0
    this.spawnPoints = []
    this.scene.fog = null
    this.scene.background = null
  }

  /**
   * 相机退到墙外时直接隐藏那一面墙。
   * 注意：不要在这里刷新阴影贴图。阴影贴图冻结后如果跟着墙体显隐反复重算，
   * 墙边地面就会在「有影/无影」之间跳动，看起来像地板一直闪。
   * 保留静态墙面阴影，只隐藏颜色网格，是更稳的取舍。
   */
  setWallHidden(side: 'south' | 'north' | 'east' | 'west', hidden: boolean): void {
    const m = this.wallMeshes[side]
    const c = this.corniceMeshes[side]
    if (m) m.visible = !hidden
    if (c) c.visible = !hidden
    const changed = hidden !== this.hiddenWalls.has(side)
    if (hidden) this.hiddenWalls.add(side)
    else this.hiddenWalls.delete(side)
    if (!changed) return
    // 塔旗挂在墙上：把对应墙面的实例缩到 0，既隐藏悬空旗帜又不增加 drawcall
    for (let meshIndex = 0; meshIndex < this.bannerMeshes.length; meshIndex += 1) {
      const mesh = this.bannerMeshes[meshIndex]
      const bases = this.bannerBaseMatrices[meshIndex]
      if (!bases) continue
      for (let i = 0; i < this.bannerSides.length; i += 1) {
        const visible = !this.hiddenWalls.has(this.bannerSides[i])
        mesh.setMatrixAt(i, visible ? bases[i] : ZERO_BANNER)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    // 墙裙与墙裙压边随对应墙面同步显隐
    if (this.dadoMesh && this.dadoTrimMesh) {
      for (let i = 0; i < this.dadoSides.length; i += 1) {
        const visible = !this.hiddenWalls.has(this.dadoSides[i])
        this.dadoMesh.setMatrixAt(i, visible ? this.dadoBaseMatrices[i] : ZERO_BANNER)
        this.dadoTrimMesh.setMatrixAt(i, visible ? this.dadoTrimBaseMatrices[i] : ZERO_BANNER)
      }
      this.dadoMesh.instanceMatrix.needsUpdate = true
      this.dadoTrimMesh.instanceMatrix.needsUpdate = true
    }
  }

  /** 相机退到墙外时逐面隐藏 + 同时隐藏四角塔柱，避免任何方向挡视线 */
  setOutdoorView(hidden: boolean): void {
    for (const side of ['south', 'north', 'east', 'west'] as const) {
      this.setWallHidden(side, hidden)
    }
    for (const m of this.pillarMeshes) m.visible = !hidden
  }

  /** 只隐藏塔柱（相机贴边时角柱最容易糊住角色）；同样不触发阴影重算 */
  setPillarsHidden(hidden: boolean): void {
    for (const m of this.pillarMeshes) m.visible = !hidden
  }

  /** 方向光阴影冻结（场景静态，避免每帧重算导致地面阴影闪烁） */
  freezeShadows(): void {
    const light = this.keyLight
    if (!light) return
    light.shadow.autoUpdate = false
    light.shadow.needsUpdate = true
  }

  /** 0 = 实体墙，1 = 完全透明（相机退到墙外时调用） */
  fadeWalls(t: number): void {
    const m = this.wallMat
    if (!m) return
    const k = Math.max(0, Math.min(1, t))
    m.transparent = k > 0.01
    m.opacity = 1 - k
    m.depthWrite = k < 0.5
    m.needsUpdate = true
  }

  dispose(): void {
    this.clear()
    this.scene.remove(this.group)
    this.def = null
    this.theme = null
  }

  /* ---------------- 小工具 ---------------- */

  private instanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    matrices: THREE.Matrix4[],
    castShadow: boolean,
  ): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length))
    for (let i = 0; i < matrices.length; i++) im.setMatrixAt(i, matrices[i])
    im.count = matrices.length
    im.instanceMatrix.needsUpdate = true
    im.castShadow = castShadow
    im.receiveShadow = true
    im.frustumCulled = false
    return im
  }
}

/* ================================================================== */
/*  纯函数辅助                                                         */
/* ================================================================== */

function noRotQuat(): THREE.Quaternion {
  return new THREE.Quaternion()
}

/** 字符串 → 32 位种子（FNV-1a 变体），保证同一场景重建布局一致 */
function hashSeed(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 贴墙内 16 个出生锚点（四面各 4 个，均匀分布） */
function makeSpawnPoints(half: number): Vec2[] {
  const inset = 1.5
  const pts: Vec2[] = []
  const a0 = -half + inset
  const span = (half - inset) * 2
  for (let i = 0; i < 16; i++) {
    const side = i % 4
    const slot = Math.floor(i / 4)
    const f = (slot + 0.5) / 4
    const a = a0 + span * f
    if (side === 0) pts.push({ x: a, z: half - inset })
    else if (side === 1) pts.push({ x: half - inset, z: a })
    else if (side === 2) pts.push({ x: a, z: -(half - inset) })
    else pts.push({ x: -(half - inset), z: a })
  }
  return pts
}

/** 按权重挑道具 */
function weightedPick(rng: Rng, kinds: PropKind[]): PropKind {
  let total = 0
  for (const k of kinds) total += k.weight
  let r = rng.range(0, total)
  for (const k of kinds) {
    r -= k.weight
    if (r <= 0) return k
  }
  return kinds[kinds.length - 1]
}
