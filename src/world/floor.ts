import * as THREE from 'three'
import type { Circle, SceneDef, Vec2, WorldV3 } from '../types'
import { Rng } from '../core/rng'
import { mixHex, TextureBook } from './textures'
import { PropSet } from './props'
import type { PropKind } from './props'
import type { ThemeV3 } from './themes'
import { themeFor } from './themes'
import { disposeTree } from './util'

const UP = new THREE.Vector3(0, 1, 0)

/** 火把运行时状态 */
interface TorchEntry {
  flame: THREE.Sprite
  seed: number
  light: THREE.PointLight | null
  /** 基础亮度，flicker 在其上抖动 */
  baseIntensity: number
  /** 火焰挂点（用于道具避让） */
  tx: number
  tz: number
}

/** 道具落位结果 */
interface PropPlacement {
  x: number
  z: number
  scale: number
  rot: number
  kind: PropKind
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
  /** 墙体材质：相机退到墙外时淡出，避免挡住角色 */
  private wallMat: THREE.MeshStandardMaterial | null = null

  private altarRune: THREE.Mesh | null = null
  private crystal: THREE.Mesh | null = null
  private crystalBaseY = 1.4
  private altarLight: THREE.PointLight | null = null

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

    if (this.group.parent !== this.scene) this.scene.add(this.group)

    const tex = new TextureBook(theme)
    this.tex = tex
    const props = new PropSet(theme)
    this.props = props

    /* ---------------- 场景光照与雾 ---------------- */
    this.scene.fog = new THREE.FogExp2(theme.fogColor, theme.fogDensity)

    const hemi = new THREE.HemisphereLight(
      theme.ambientColor,
      mixHex(theme.fogColor, 0x000000, 0.45),
      theme.ambientIntensity,
    )
    this.root.add(hemi)

    // 主光：唯一投影光源（2048 阴影贴图）
    const key = new THREE.DirectionalLight(theme.keyColor, theme.keyIntensity)
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

    // 冷色补光（不投影），拉开体积感
    const fill = new THREE.DirectionalLight(mixHex(theme.fogColor, 0x8fb4e6, 0.55), 0.42)
    fill.position.set(half * 0.7, wallH * 1.8, -half * 0.75)
    this.root.add(fill)

    /* ---------------- 地面 ---------------- */
    tex.floor.repeat.set(size / 4, size / 4)
    tex.floor.anisotropy = 8
    const floorMat = new THREE.MeshStandardMaterial({
      map: tex.floor,
      roughness: 0.95,
      metalness: 0.02,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.root.add(floor)

    /* ---------------- 墙体 + 压边 ---------------- */
    const thick = 1.6
    tex.wall.wrapS = THREE.RepeatWrapping
    tex.wall.wrapT = THREE.RepeatWrapping
    tex.wall.repeat.set(Math.max(2, Math.round(size / 3.4)), Math.max(1, Math.round(wallH / 3)))
    tex.wall.anisotropy = 8
    const wallMat = new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.97, metalness: 0.02 })
    this.wallMat = wallMat

    const addWall = (w: number, d: number, x: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), wallMat)
      m.position.set(x, wallH / 2, z)
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
    }
    addWall(size + thick * 2, thick, 0, half + thick / 2) // 南 (+z)
    addWall(size + thick * 2, thick, 0, -(half + thick / 2)) // 北 (-z)
    addWall(thick, size, half + thick / 2, 0) // 东 (+x)
    addWall(thick, size, -(half + thick / 2), 0) // 西 (-x)

    const capMat = new THREE.MeshStandardMaterial({
      color: theme.wallTopColor,
      roughness: 0.9,
      metalness: 0.04,
      flatShading: true,
    })
    const addCornice = (w: number, d: number, x: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.42, d), capMat)
      m.position.set(x, wallH - 0.21, z)
      m.castShadow = true
      m.receiveShadow = true
      this.root.add(m)
    }
    // 压边向内探出 0.55m，形成收口
    addCornice(size, 0.55, 0, half - 0.275)
    addCornice(size, 0.55, 0, -(half - 0.275))
    addCornice(0.55, size, half - 0.275, 0)
    addCornice(0.55, size, -(half - 0.275), 0)

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
        const px = sx * (half - 0.95)
        const pz = sz * (half - 0.95)
        shaftMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH / 2, pz), noRot, one))
        baseMats.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 0.3, pz), noRot, one))
        capMats.push(
          new THREE.Matrix4().compose(new THREE.Vector3(px, shaftH + 0.21, pz), noRot, one),
        )
        // 塔柱在本层范围内的碰撞体
        this.propColliders.push({ x: px, z: pz, r: 1.35 })
      }
    }
    this.root.add(this.instanced(shaftGeo, pillarMat, shaftMats, true))
    this.root.add(this.instanced(baseGeo, pillarMat, baseMats, true))
    this.root.add(this.instanced(capGeo, pillarCapMat, capMats, true))

    /* ---------------- 出生锚点（必须在道具之前） ---------------- */
    this.spawnPoints = makeSpawnPoints(half)

    // 入口：南墙中点内侧（玩家从这里进场，也是 5m 净空区的圆心）
    this.entrance = { x: 0, z: half - 2.4 }

    /* ---------------- 中央祭坛 ---------------- */
    this.buildAltar(half, wallH, tex)

    /* ---------------- 火把 ---------------- */
    this.buildTorches(half, wallH, tex)

    /* ---------------- 主题道具 ---------------- */
    const seed = hashSeed(def.id)
    const layoutRng = new Rng(0x9e3779b9 ^ seed ^ (half << 3))
    this.dropRng = new Rng(0x1f123bb5 ^ seed ^ half)
    this.buildProps(def, props, layoutRng)

    /* ---------------- 空气浮尘 ---------------- */
    this.buildMotes(half, wallH, tex)

    this.time = 0
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

    this.altarLight = new THREE.PointLight(theme.accentColor, 9, Math.max(12, half * 0.7), 2)
    this.altarLight.position.set(0, this.crystalBaseY + 0.3, 0)
    this.root.add(this.altarLight)

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
    const flameMat = new THREE.SpriteMaterial({
      map: tex.flame,
      color: mixHex(theme.torchColor, 0xffe4a8, 0.42),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const glowMat = new THREE.SpriteMaterial({
      map: tex.glow,
      color: theme.torchColor,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })

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
        const flame = new THREE.Sprite(flameMat)
        flame.position.set(fx, mountY + 0.72, fz)
        flame.scale.set(0.5, 0.85, 1)
        flame.renderOrder = 5
        this.root.add(flame)

        const glow = new THREE.Sprite(glowMat)
        glow.position.set(fx, mountY + 0.62, fz)
        glow.scale.set(2.4, 2.4, 1)
        glow.renderOrder = 4
        this.root.add(glow)

        let light: THREE.PointLight | null = null
        let baseIntensity = 0
        if (idx === litIndex) {
          baseIntensity = 16
          light = new THREE.PointLight(theme.torchColor, baseIntensity, Math.max(10, half * 0.55), 2)
          light.position.set(fx + side.inx * 0.25, mountY + 0.85, fz + side.inz * 0.25)
          this.root.add(light)
        }

        this.torches.push({
          flame,
          seed: a * 1.7 + x * 0.13 + z * 0.07,
          light,
          baseIntensity,
          tx: fx,
          tz: fz,
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
      this.propColliders.push({ x, z, r: kind.colliderR * scale * 0.98 })
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
        const key = pl.kind.key + '#' + idx
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
  }

  /* ---------------- 浮尘 ---------------- */
  private buildMotes(half: number, wallH: number, tex: TextureBook): void {
    const theme = this.theme
    if (!theme) return
    const count = 110
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
      size: 0.14,
      transparent: true,
      opacity: 0.5,
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

    // 祭坛符文旋转 + 晶体呼吸
    if (this.altarRune) {
      this.altarRune.rotation.z = t * 0.12
      const pulse = 0.62 + Math.sin(t * 1.5) * 0.1
      const mat = this.altarRune.material as THREE.MeshBasicMaterial
      mat.opacity = pulse
    }
    if (this.crystal) {
      this.crystal.rotation.y = t * 0.55
      this.crystal.position.y = this.crystalBaseY + Math.sin(t * 1.1) * 0.12
    }
    if (this.altarLight) {
      this.altarLight.intensity = 9 + Math.sin(t * 3.1) * 1.4 + Math.sin(t * 8.3) * 0.6
    }

    // 火把：火焰缩放抖动 + 真实点光源闪烁
    for (const torch of this.torches) {
      const s = torch.seed
      const f =
        0.9 +
        Math.sin(t * 9.3 + s) * 0.16 +
        Math.sin(t * 21.7 + s * 1.7) * 0.07 +
        Math.sin(t * 4.1 + s * 0.4) * 0.05
      torch.flame.scale.set(0.42 + f * 0.1, 0.7 + f * 0.22, 1)
      if (torch.light) {
        torch.light.intensity =
          torch.baseIntensity *
          (f * 0.72 + Math.sin(t * 17.1 + s * 2.3) * 0.12 + Math.sin(t * 5.7 + s) * 0.08)
      }
    }

    // 熔岩/冰晶等主题自发光材质呼吸
    if (this.props && this.props.pulse) {
      this.props.pulse.emissiveIntensity = 1.35 + Math.sin(t * 1.7) * 0.32 + Math.sin(t * 4.3) * 0.12
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
    this.altarRune = null
    this.crystal = null
    this.altarLight = null
    this.mote = null
    this.moteBase = null
    this.motePhase = null

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
