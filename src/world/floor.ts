import * as THREE from 'three'
import type { Circle, SceneDef, Vec2, WorldV3 } from '../types'
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
  open: number
  group: THREE.Group
  lidPivot: THREE.Group
  glowIndex: number
  sealIndex: number
  sealColor: number
  sealBaseY: number
  phase: number
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
  private caches: TowerCache[] = []

  /** 场景中的发光 sprite 全部合批：光晕 / 火焰 / 塔藏箱符文各 1 个 drawcall */
  private glowBatch: BillboardBatch | null = null
  private flameBatch: BillboardBatch | null = null
  private sealBatch: BillboardBatch | null = null

  private mote: THREE.Points | null = null
  private moteBase: Float32Array | null = null
  private motePhase: Float32Array | null = null

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
    this.glowBatch = new BillboardBatch(this.root, tex.glow, 16, { renderOrder: 4 })
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
    key.position.set(-half * 0.46, wallH * 4.6 + 7, half * 0.58)
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

    // 冷色补光（不投影），拉开体积感
    const fill = new THREE.DirectionalLight(mixHex(theme.fogColor, 0xbfe9ff, 0.82), 0.86)
    fill.position.set(half * 0.7, wallH * 1.8, -half * 0.75)
    this.root.add(fill)

    /* ---------------- 地面 ---------------- */
    tex.floor.repeat.set(floorSize / 4, floorSize / 4)
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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)

    /* ---------------- 场地边界警示线 ---------------- */
    // 南墙/东墙等靠近镜头时会被隐藏，但碰撞边界仍在。没有墙可看时，
    // 玩家走到 halfSize 附近会以为按键失灵；这条常驻发光细线负责把边界讲清楚。
    // 4 段共用一个 InstancedMesh = 1 drawcall，不新增光源。
    const boundaryInset = 0.95
    const boundaryMat = new THREE.MeshBasicMaterial({
      // 偏白的暖色，避免在熔火/霜蚀主题里被同色地面吃掉；加法混合只提亮不投影。
      color: mixHex(theme.accentColor, 0xfff3d6, 0.74),
      transparent: true,
      opacity: 0.46,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const boundaryGeo = new THREE.BoxGeometry(1, 0.05, 0.16)
    const boundaryMesh = new THREE.InstancedMesh(boundaryGeo, boundaryMat, 4)
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
    const wallMat = new THREE.MeshStandardMaterial({
      map: tex.wall,
      roughness: 0.97,
      metalness: 0.02,
      color: new THREE.Color(1.08, 1.08, 1.08),
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
      roughness: 0.9,
      metalness: 0.04,
      flatShading: true,
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
      color: mixHex(theme.wallColor, theme.wallTopColor, 0.22),
      roughness: 0.95,
      flatShading: true,
    })
    const pillarCapMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.wallTopColor, theme.accentColor, 0.18),
      roughness: 0.85,
      flatShading: true,
      emissive: theme.accentColor,
      emissiveIntensity: 0.05,
    })
    const shaftH = wallH + 1.0
    const shaftGeo = new THREE.BoxGeometry(1.75, shaftH, 1.75)
    const baseGeo = new THREE.BoxGeometry(2.35, 0.6, 2.35)
    const capGeo = new THREE.BoxGeometry(2.25, 0.42, 2.25)
    const shaftMats: THREE.Matrix4[] = []
    const baseMats: THREE.Matrix4[] = []
    const capMats: THREE.Matrix4[] = []
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
        // 塔柱在本层范围内的碰撞体
        this.propColliders.push({ x: px, z: pz, r: 1.35 })
      }
    }
    this.pillarMeshes = [
      this.instanced(shaftGeo, pillarMat, shaftMats, true),
      this.instanced(baseGeo, pillarMat, baseMats, true),
      this.instanced(capGeo, pillarCapMat, capMats, true),
    ]
    for (const m of this.pillarMeshes) this.root.add(m)

    /* ---------------- 出生锚点（必须在道具之前） ---------------- */
    this.spawnPoints = makeSpawnPoints(half)

    // 入口：南墙中点内侧（玩家从这里进场，也是 5m 净空区的圆心）
    this.entrance = { x: 0, z: half - 2.4 }

    /* ---------------- 中央祭坛 ---------------- */
    this.buildAltar(half, wallH, tex)

    /* ---------------- 火把 ---------------- */
    this.buildTorches(half, wallH, tex)

    /* ---------------- 塔旗（强化“塔”的识别） ---------------- */
    this.buildTowerBanners(half, wallH, tex)

    /* ---------------- 主题道具 ---------------- */
    const seed = hashSeed(def.id)
    const layoutRng = new Rng(0x9e3779b9 ^ seed ^ (half << 3))
    this.dropRng = new Rng(0x1f123bb5 ^ seed ^ half)
    this.buildProps(def, props, layoutRng)

    /* ---------------- 空气浮尘 ---------------- */
    this.buildMotes(half, wallH, tex)

    this.time = 0
    this.freezeShadows()
    this.built = true
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
    }

    // 发光符文圈
    const runeMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: mixHex(theme.accentColor, 0xffffff, 0.12),
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.altarRune = new THREE.Mesh(new THREE.PlaneGeometry(stepR * 1.62, stepR * 1.62), runeMat)
    this.altarRune.rotation.x = -Math.PI / 2
    this.altarRune.position.y = 0.79
    this.altarRune.renderOrder = 2
    this.root.add(this.altarRune)

    // 悬浮主题晶体（构图中心）
    const crystalMat = new THREE.MeshStandardMaterial({
      color: mixHex(theme.accentColor, 0xffffff, 0.2),
      emissive: theme.accentColor,
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
      color: mixHex(theme.accentColor, 0xffffff, 0.18),
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
      color: mixHex(theme.accentColor, 0xffffff, 0.28),
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
      theme.accentColor,
      0.3,
    )

    this.altarLight = new THREE.PointLight(theme.accentColor, 11, Math.max(13, half * 0.75), 2)
    this.altarLight.position.set(0, this.crystalBaseY + 0.3, 0)
    this.root.add(this.altarLight)

    // 塔心信标交互半径：站在台阶外沿也能按 E
    this.altarInteractR = stepR + 1.95

    // 祭坛单体碰撞（低矮但不可穿行）
    this.propColliders.push({ x: 0, z: 0, r: stepR * 0.92 })
  }

  /* ---------------- 火把 ---------------- */
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
    const sealColor = mixHex(theme.accentColor, 0xffffff, 0.2)

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
    this.glowBatch?.set(glowIndex, x, 0.42, z, 2.1, 2.1, theme.accentColor, 0.3)
    const sealIndex = this.sealBatch?.acquire() ?? -1
    this.sealBatch?.set(sealIndex, x, 1.05, z, 0.92, 0.92, sealColor, 0.9)

    this.root.add(group)
    this.propColliders.push({ x, z, r: 0.72 })
    this.caches.push({
      x,
      z,
      used: false,
      open: 0,
      group,
      lidPivot,
      glowIndex,
      sealIndex,
      sealColor,
      sealBaseY: 1.05,
      phase: index * 1.9 + rot,
    })
  }

  /* ---------------- 浮尘 ---------------- */
  private buildMotes(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return
    // 浮尘改为低密度、低亮度，避免贴着地面看时像地板在闪星
    const count = 22
    const pos = new Float32Array(count * 3)
    this.moteBase = new Float32Array(count * 3)
    this.motePhase = new Float32Array(count)
    const rng = new Rng(0x51ed2701 ^ half)
    for (let i = 0; i < count; i++) {
      const x = rng.range(-half + 1.2, half - 1.2)
      const y = rng.range(0.4, wallH * 0.92)
      const z = rng.range(-half + 1.2, half - 1.2)
      this.moteBase[i * 3] = x
      this.moteBase[i * 3 + 1] = y
      this.moteBase[i * 3 + 2] = z
      this.motePhase[i] = rng.range(0, Math.PI * 2)
      pos[i * 3] = x
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = z
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const mat = new THREE.PointsMaterial({
      map: tex.mote,
      color: mixHex(theme.accentColor, 0xffffff, 0.6),
      size: 0.075,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    })
    this.mote = new THREE.Points(geo, mat)
    this.mote.frustumCulled = false
    this.mote.renderOrder = 3
    this.root.add(this.mote)
  }

  /* ================================================================ */
  /*  每帧更新                                                          */
  /* ================================================================ */

  update(dt: number, _elapsed: number): void {
    if (!this.built) return
    this.time += dt
    const t = this.time
    if (this.boundaryMat) {
      // 很轻的呼吸，不抢角色；墙被隐藏时这条线就是唯一的边界提示。
      this.boundaryMat.opacity = 0.4 + Math.sin(t * 1.7) * 0.06
    }
    this.altarFlash = Math.max(0, this.altarFlash - dt * 0.7)

    // 塔心信标：符文旋转 + 晶体呼吸 + 光柱脉冲
    if (this.altarRune) {
      this.altarRune.rotation.z = t * (this.altarUsed ? 0.18 : 0.12)
      const mat = this.altarRune.material as THREE.MeshBasicMaterial
      mat.opacity = 0.66 + (this.altarUsed ? 0.12 : 0) + this.altarFlash * 0.18
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
      const s = 5.2 + Math.sin(t * 1.2) * 0.35 + this.altarFlash * 1.4
      const alpha = 0.27 + Math.sin(t * 1.7) * 0.04 + this.altarFlash * 0.2
      const c = this.theme?.accentColor ?? 0xffffff
      this.glowBatch.set(this.altarGlowIndex, 0, this.crystalBaseY + 0.25, 0, s, s, c, alpha)
    }
    if (this.altarLight) {
      this.altarLight.intensity = (this.altarUsed ? 13.5 : 10.5) + Math.sin(t * 1.5) * 0.7 + this.altarFlash * 6
    }

    // 塔藏箱：未开启时封印悬浮旋转，开启后箱盖翻开
    for (const cache of this.caches) {
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

    // 浮尘缓慢漂移
    if (this.mote && this.moteBase && this.motePhase) {
      const attr = this.mote.geometry.getAttribute('position') as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const base = this.moteBase
      const ph = this.motePhase
      const n = ph.length
      for (let i = 0; i < n; i++) {
        const p = ph[i]
        arr[i * 3] = base[i * 3] + Math.sin(t * 0.23 + p) * 0.9
        arr[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.41 + p * 1.7) * 0.5
        arr[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.19 + p * 0.8) * 0.9
      }
      attr.needsUpdate = true
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

    if (!this.altarUsed) {
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
      if (c.used) continue
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
    this.caches.length = 0
    this.mote = null
    this.moteBase = null
    this.motePhase = null

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
