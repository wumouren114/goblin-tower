import * as THREE from 'three'
import { PixelCanvas } from '../art/pixels'
import { createShadowMesh, particleTexture, textureFromPixels } from '../art/sprites'
import { fxTexture } from '../art/fxTextures'
import { BillboardBatch } from '../art/billboardBatch'
import type { RoomNpcKind, TunnelRoom } from '../types'

interface NpcPalette {
  robe: number
  robeDark: number
  robeHi: number
  trim: number
  glow: number
  face: number
  eye: number
  metal: number
  skin: number
  skinHi: number
}

const PALETTES: Record<RoomNpcKind, NpcPalette> = {
  merchant: {
    robe: 0x5a3a22,
    robeDark: 0x342014,
    robeHi: 0x7d5736,
    trim: 0xf2c14e,
    glow: 0xffd166,
    face: 0x171017,
    eye: 0xffe6a0,
    metal: 0xb8aa8c,
    skin: 0x7a9a4c,
    skinHi: 0xa0c466,
  },
  oracle: {
    robe: 0x3a2454,
    robeDark: 0x1e112d,
    robeHi: 0x5c3b80,
    trim: 0xb46bff,
    glow: 0xc9a6ff,
    face: 0x110c19,
    eye: 0xe6d2ff,
    metal: 0x9c87b8,
    skin: 0x8290a8,
    skinHi: 0xb6c2d8,
  },
  warden: {
    robe: 0x5a231d,
    robeDark: 0x32100d,
    robeHi: 0x7f382b,
    trim: 0xd0a85a,
    glow: 0xff7a3d,
    face: 0x4a642e,
    eye: 0xffcf3d,
    metal: 0x9aa2b0,
    skin: 0x5f7d39,
    skinHi: 0x89a952,
  },
  guide: {
    robe: 0x2a5260,
    robeDark: 0x122b34,
    robeHi: 0x417d8c,
    trim: 0x9ff2dc,
    glow: 0x9ff2dc,
    face: 0x0a1418,
    eye: 0xe3fff8,
    metal: 0xb8d8d4,
    skin: 0x8fb8ae,
    skinHi: 0xc6e8de,
  },
}

const NPC_INFO: Record<TunnelRoom, { kind: RoomNpcKind; title: string; hint: string }> = {
  chest: { kind: 'guide', title: '宝藏守卫', hint: '按 E 领取密室宝藏' },
  'skill-card': { kind: 'guide', title: '刻文石灵', hint: '按 E 领取技能卡' },
  merchant: { kind: 'merchant', title: '流浪商人', hint: '按 E 查看额外货架' },
  altar: { kind: 'oracle', title: '古老祭坛', hint: '按 E 献金换取祝福' },
  'mob-wave': { kind: 'warden', title: '战鼓卫兵', hint: '按 E 敲响战鼓，迎接怪潮' },
  'elite-fight': { kind: 'warden', title: '战鼓卫兵', hint: '按 E 敲响战鼓，挑战精英' },
  boss: { kind: 'warden', title: '战鼓卫兵', hint: '按 E 敲响战鼓，唤醒首领' },
  rest: { kind: 'guide', title: '篝火守夜人', hint: '按 E 在营地休整' },
}

export function roomNpcInfo(room: TunnelRoom): { kind: RoomNpcKind; title: string; hint: string } {
  return NPC_INFO[room] ?? NPC_INFO.rest
}

/** 48×64 手绘像素引路人：兜帽、法杖、房间专属小道具 */
function drawNpcCell(kind: RoomNpcKind): PixelCanvas {
  const p = PALETTES[kind]
  const cell = new PixelCanvas(48, 64)

  // 长袍下摆：上窄下宽，底边留出破损的锯齿
  const robeSpans: [number, number, number][] = [
    [33, 15, 18],
    [36, 12, 24],
    [39, 10, 28],
    [42, 8, 32],
    [45, 7, 34],
    [48, 6, 36],
    [51, 7, 34],
    [54, 9, 30],
    [57, 12, 24],
  ]
  for (const [y, x, w] of robeSpans) cell.fillRect(x, y, w, 1, p.robe)
  // 袍面褶皱、下摆滚边与破损
  cell.vLine(21, 36, 57, p.robeDark)
  cell.vLine(27, 38, 57, p.robeDark)
  cell.hLine(7, 40, 51, p.robeHi)
  cell.hLine(8, 39, 52, p.trim)
  for (const x of [8, 13, 18, 24, 30, 35, 40]) cell.set(x, 57 + (x % 3), p.robeDark)
  for (const x of [11, 22, 33, 38]) cell.set(x, 58 + (x % 2), p.robeHi)

  // 上身与肩线
  const torso: [number, number, number][] = [
    [23, 17, 14],
    [25, 14, 20],
    [27, 13, 22],
    [29, 12, 24],
    [31, 12, 24],
    [33, 13, 22],
  ]
  for (const [y, x, w] of torso) cell.fillRect(x, y, w, 1, p.robeHi)
  cell.hLine(13, 34, 23, p.robe)
  cell.hLine(12, 35, 30, p.robeDark)
  cell.hLine(14, 33, 31, p.trim)
  cell.fillRect(22, 32, 4, 3, p.trim)
  cell.set(23, 32, p.robeDark)
  cell.set(24, 33, p.glow)

  // 两侧袖子与手
  cell.fillRect(9, 25, 4, 12, p.robeDark)
  cell.fillRect(36, 25, 4, 12, p.robeDark)
  cell.hLine(9, 12, 25, p.robeHi)
  cell.hLine(36, 39, 25, p.robeHi)
  cell.fillRect(10, 36, 3, 3, p.skin)
  cell.fillRect(36, 36, 3, 3, p.skin)
  cell.set(10, 37, p.skinHi)
  cell.set(38, 37, p.skinHi)

  // 兜帽 / 头
  if (kind === 'warden') {
    // 战鼓卫兵：绿皮、尖耳、獠牙，不戴兜帽
    cell.triangle(14, 12, 4, 7, 13, 22, p.skin)
    cell.triangle(34, 12, 44, 7, 35, 22, p.skin)
    cell.triangle(14, 13, 7, 9, 14, 20, p.skinHi)
    cell.triangle(34, 13, 41, 9, 34, 20, p.skinHi)
    cell.ellipse(24, 17, 11, 10, p.skin)
    cell.hLine(15, 33, 9, p.skinHi)
    cell.hLine(14, 34, 18, p.skinHi)
    cell.hLine(15, 33, 24, p.skin)
    cell.hLine(18, 30, 26, p.robeDark)
    // 红头巾
    cell.fillRect(13, 8, 22, 3, p.robeDark)
    cell.hLine(13, 34, 8, p.trim)
    cell.set(36, 9, p.robe)
    cell.set(37, 10, p.robeDark)
    // 眼睛、鼻子、獠牙
    cell.fillRect(18, 15, 3, 2, p.eye)
    cell.fillRect(28, 15, 3, 2, p.eye)
    cell.set(19, 16, p.face)
    cell.set(29, 16, p.face)
    cell.fillRect(22, 18, 4, 2, p.skin)
    cell.fillRect(21, 20, 6, 2, p.skin)
    cell.set(20, 23, p.robeHi)
    cell.set(28, 23, p.robeHi)
    cell.set(21, 25, p.robeHi)
    cell.set(27, 25, p.robeHi)
    // 战纹
    cell.set(16, 20, p.trim)
    cell.set(17, 21, p.trim)
    cell.set(31, 20, p.trim)
    cell.set(32, 21, p.trim)
  } else {
    // 兜帽外轮廓
    cell.ellipse(24, 17, 13, 13, p.robeDark)
    cell.ellipse(24, 16, 12, 12, p.robe)
    cell.hLine(14, 34, 6, p.robeHi)
    // 帽檐阴影里的脸
    cell.ellipse(24, 19, 8, 9, p.face)
    cell.hLine(18, 30, 12, p.robeDark)
    // 眼睛：两点冷光
    cell.fillRect(19, 17, 2, 2, p.eye)
    cell.fillRect(27, 17, 2, 2, p.eye)
    cell.set(20, 17, p.glow)
    cell.set(28, 17, p.glow)
    cell.hLine(21, 27, 26, p.robeDark)
    cell.set(24, 27, p.glow)

    if (kind === 'oracle') {
      // 祭坛巫祝：额间第三眼 + 兜帽金线
      cell.fillRect(23, 13, 3, 2, p.trim)
      cell.set(24, 13, p.glow)
      cell.hLine(16, 32, 9, p.trim)
      cell.set(15, 10, p.glow)
      cell.set(33, 10, p.glow)
      cell.set(16, 28, p.glow)
      cell.set(32, 28, p.glow)
    } else if (kind === 'merchant') {
      // 商人：兜帽边缘的铜扣与半张围巾
      cell.fillRect(15, 22, 18, 4, p.robeHi)
      cell.hLine(16, 31, 23, p.trim)
      cell.set(14, 21, p.trim)
      cell.set(34, 21, p.trim)
      cell.set(23, 25, p.glow)
    } else {
      // 提灯引路人：兜帽上的提灯纹章
      cell.fillRect(22, 29, 5, 4, p.robeDark)
      cell.hLine(23, 25, 30, p.trim)
      cell.set(24, 29, p.glow)
    }
  }

  // 法杖 / 道具
  if (kind === 'merchant') {
    // 背包 + 手杖 + 钱袋
    cell.fillRect(2, 27, 8, 19, p.robeDark)
    cell.hLine(2, 9, 27, p.robeHi)
    cell.vLine(7, 28, 44, p.robeHi)
    cell.set(4, 31, p.trim)
    cell.set(6, 35, p.trim)
    cell.line(40, 20, 42, 58, p.robeDark)
    cell.line(41, 20, 43, 58, p.robeHi)
    cell.ellipse(41, 17, 3, 3, p.trim)
    cell.set(40, 16, p.glow)
    cell.ellipse(10, 42, 3, 3, p.robeHi)
    cell.set(9, 41, p.trim)
  } else if (kind === 'oracle') {
    // 弯曲的祭司法杖，顶端悬浮紫色法球
    cell.line(40, 22, 38, 40, p.robeDark)
    cell.line(38, 40, 41, 58, p.robeHi)
    cell.line(39, 21, 35, 13, p.robeDark)
    cell.ellipse(33, 10, 4, 4, p.trim)
    cell.ellipse(33, 10, 2, 2, p.glow)
    cell.set(31, 8, 0xffffff)
    cell.set(35, 12, p.robeDark)
  } else if (kind === 'warden') {
    // 战鼓 + 鼓槌
    cell.ellipse(34, 42, 8, 7, p.robeDark)
    cell.ellipse(34, 41, 7, 6, p.robeHi)
    cell.ellipse(34, 41, 5, 4, p.robeDark)
    cell.hLine(28, 40, 44, p.trim)
    cell.set(30, 40, p.trim)
    cell.set(38, 40, p.trim)
    cell.line(38, 26, 44, 19, p.robeHi)
    cell.set(45, 18, p.trim)
    cell.set(44, 17, p.glow)
  } else {
    // 提灯：深色铁框 + 琥珀玻璃 + 小焰心，避免整块冷色亮斑
    const iron = 0x271d18
    const ironHi = 0x5e4636
    const amber = 0xffa64d
    const amberHi = 0xffd88a
    const flame = 0xfff1b8
    // 长杆与挑臂
    cell.line(40, 18, 43, 56, p.robeDark)
    cell.line(41, 18, 44, 56, p.robeHi)
    cell.line(41, 18, 37, 14, iron)
    cell.set(42, 18, ironHi)
    // 吊环 + 顶盖
    cell.set(35, 10, iron)
    cell.set(35, 11, ironHi)
    cell.hLine(32, 38, 12, iron)
    cell.hLine(33, 37, 12, ironHi)
    // 灯体：左右铁框 + 中间琥珀玻璃
    cell.fillRect(31, 14, 9, 9, iron)
    cell.fillRect(32, 15, 7, 7, amber)
    // 内部玻璃分格与高光
    cell.vLine(35, 15, 21, iron)
    cell.hLine(32, 38, 18, iron)
    cell.fillRect(33, 16, 1, 2, amberHi)
    // 焰心
    cell.fillRect(34, 17, 2, 4, flame)
    cell.set(35, 16, 0xfff7dd)
    cell.set(34, 20, 0xffcf6a)
    // 底盖与挂饰
    cell.hLine(31, 39, 22, iron)
    cell.hLine(30, 40, 23, ironHi)
    cell.set(33, 23, p.trim)
    cell.set(37, 23, p.trim)
  }

  // 角色脚下/周围的符文光点
  cell.set(5, 54, p.glow)
  cell.set(43, 34, p.glow)
  cell.set(6, 37, p.trim)
  cell.outline(0x090a10)
  return cell
}

/** 时空隧道里的可交互 NPC：一个精灵 + 地面光环 + 影子，共 3 个 drawcall */
export class RoomNpc {
  readonly group: THREE.Group
  readonly kind: RoomNpcKind
  readonly title: string
  readonly hint: string
  x: number
  z: number

  private readonly scene: THREE.Scene
  private readonly sprite: THREE.Sprite
  private readonly spriteMat: THREE.SpriteMaterial
  private readonly texture: THREE.CanvasTexture
  private readonly ring: THREE.Mesh
  private readonly ringMat: THREE.MeshBasicMaterial
  private readonly shadow: THREE.Mesh
  /** 引路人的提灯暖光（加法精灵，不新增实时点光） */
  private readonly lampGlow: THREE.Sprite | null
  private readonly lampGlowMat: THREE.SpriteMaterial | null
  private readonly phase = Math.random() * Math.PI * 2
  private clock = 0

  constructor(scene: THREE.Scene, room: TunnelRoom, x: number, z: number) {
    const info = roomNpcInfo(room)
    this.scene = scene
    this.kind = info.kind
    this.title = info.title
    this.hint = info.hint
    this.x = x
    this.z = z
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    this.texture = textureFromPixels(drawNpcCell(info.kind))
    this.spriteMat = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    this.sprite = new THREE.Sprite(this.spriteMat)
    this.sprite.center.set(0.5, 0)
    this.sprite.scale.set(1.18, 1.58, 1)
    this.sprite.position.y = 0.01
    this.sprite.renderOrder = 5
    this.group.add(this.sprite)

    this.shadow = createShadowMesh(0.82, 0.46)
    this.shadow.position.y = 0.016
    this.group.add(this.shadow)

    this.ringMat = new THREE.MeshBasicMaterial({
      map: particleTexture('ring'),
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: PALETTES[info.kind].glow,
      toneMapped: false,
    })
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.ringMat)
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.035
    this.ring.scale.set(1.55, 0.96, 1)
    this.ring.renderOrder = 3
    this.group.add(this.ring)

    // 提灯挂点：与 48×64 精灵里灯体的像素位置对齐，只给引路人加一层暖光
    let glow: THREE.Sprite | null = null
    let glowMat: THREE.SpriteMaterial | null = null
    if (info.kind === 'guide') {
      glowMat = new THREE.SpriteMaterial({
        map: particleTexture('glow'),
        color: 0xffb35c,
        transparent: true,
        opacity: 0.24,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      glow = new THREE.Sprite(glowMat)
      glow.position.set(0.29, 1.15, 0.02)
      glow.scale.set(0.62, 0.72, 1)
      glow.renderOrder = 6
      this.group.add(glow)
    }
    this.lampGlow = glow
    this.lampGlowMat = glowMat
  }

  update(dt: number): void {
    this.clock += dt
    const bob = Math.sin(this.clock * 1.45 + this.phase)
    this.sprite.position.y = 0.01 + bob * 0.03
    this.sprite.scale.set(1.18 + bob * 0.01, 1.58 + bob * 0.016, 1)
    const pulse = 1 + Math.sin(this.clock * 1.9 + this.phase) * 0.07
    this.ring.scale.set(1.55 * pulse, 0.96 * pulse, 1)
    this.ring.rotation.z = this.clock * 0.24
    this.ringMat.opacity = 0.28 + Math.max(0, Math.sin(this.clock * 1.9 + this.phase)) * 0.12
    if (this.lampGlow && this.lampGlowMat) {
      const flicker = Math.sin(this.clock * 5.2 + this.phase) * 0.5 + Math.sin(this.clock * 2.3) * 0.5
      this.lampGlowMat.opacity = 0.2 + Math.max(0, flicker) * 0.07
      this.lampGlow.scale.set(0.6 + flicker * 0.02, 0.7 + flicker * 0.025, 1)
    }
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.group.clear()
    this.ring.geometry.dispose()
    this.ringMat.dispose()
    this.shadow.geometry.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.spriteMat.dispose()
    this.texture.dispose()
    this.lampGlowMat?.dispose()
  }
}

/** 出口裂隙：竖直传送门 + 地面符文，共 2 个 drawcall，不新增光源 */
export class RoomPortal {
  readonly title = '时空裂隙'
  readonly hint = '按 E 离开房间'
  readonly group: THREE.Group
  x: number
  z: number

  private readonly scene: THREE.Scene
  private readonly spriteMat: THREE.SpriteMaterial
  private readonly sprite: THREE.Sprite
  private readonly groundMat: THREE.MeshBasicMaterial
  private readonly ground: THREE.Mesh
  private readonly phase = Math.random() * Math.PI * 2
  private clock = 0

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.scene = scene
    this.x = x
    this.z = z
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    this.spriteMat = new THREE.SpriteMaterial({
      map: fxTexture('ring'),
      color: 0x74f5d8,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.sprite = new THREE.Sprite(this.spriteMat)
    this.sprite.center.set(0.5, 0.5)
    this.sprite.scale.set(2.0, 3.1, 1)
    this.sprite.position.y = 1.45
    this.sprite.renderOrder = 6
    this.group.add(this.sprite)

    this.groundMat = new THREE.MeshBasicMaterial({
      map: fxTexture('hex'),
      color: 0x3bd5b0,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.groundMat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = 0.045
    this.ground.scale.set(2.8, 2.8, 1)
    this.ground.renderOrder = 3
    this.group.add(this.ground)
  }

  update(dt: number): void {
    this.clock += dt
    const pulse = 1 + Math.sin(this.clock * 2.2 + this.phase) * 0.06
    this.sprite.scale.set(2.0 * pulse, 3.1 * pulse, 1)
    this.spriteMat.rotation = this.clock * 0.35
    this.spriteMat.opacity = 0.68 + Math.max(0, Math.sin(this.clock * 2.2 + this.phase)) * 0.2
    this.ground.rotation.z = -this.clock * 0.22
    this.groundMat.opacity = 0.4 + Math.max(0, Math.sin(this.clock * 1.7 + this.phase)) * 0.16
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.group.clear()
    this.spriteMat.dispose()
    this.ground.geometry.dispose()
    this.groundMat.dispose()
  }
}

interface EmberSeed {
  x: number
  z: number
  phase: number
  speed: number
  sway: number
}

/**
 * 休憩营地的程序化篝火：石圈 + 交叉木柴 + 三层加法火焰 + 地面暖光 + 上升余烬。
 * 不新增实时点光：暖色氛围全部由自发光/加法贴图完成，整座篝火约 5 个 drawcall。
 */
export class RoomCampfire {
  readonly group: THREE.Group
  x: number
  z: number

  private readonly scene: THREE.Scene
  private readonly flames: BillboardBatch
  private readonly glow: THREE.Mesh
  private readonly glowMat: THREE.MeshBasicMaterial
  private readonly emberGeo: THREE.BufferGeometry
  private readonly emberMat: THREE.PointsMaterial
  private readonly embers: THREE.Points
  private readonly seeds: EmberSeed[] = []
  private readonly logMat: THREE.MeshStandardMaterial
  private readonly logGeo: THREE.BoxGeometry
  private readonly stoneGeo: THREE.DodecahedronGeometry
  private readonly stoneMat: THREE.MeshStandardMaterial
  private clock = 0

  constructor(scene: THREE.Scene, x: number, z: number) {
    this.scene = scene
    this.x = x
    this.z = z
    this.group = new THREE.Group()
    this.group.position.set(x, 0, z)
    scene.add(this.group)

    // 石圈：9 块低多边形石头，单 InstancedMesh = 1 drawcall
    this.stoneGeo = new THREE.DodecahedronGeometry(0.5, 0)
    this.stoneMat = new THREE.MeshStandardMaterial({
      color: 0x50453e,
      roughness: 1,
      metalness: 0,
      flatShading: true,
    })
    const stones = new THREE.InstancedMesh(this.stoneGeo, this.stoneMat, 9)
    const dummy = new THREE.Object3D()
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + 0.18
      const r = 0.82 + Math.sin(i * 2.13) * 0.06
      dummy.position.set(Math.cos(a) * r, 0.1, Math.sin(a) * r)
      dummy.rotation.set(Math.sin(i * 1.7) * 0.35, a * 1.7, Math.cos(i * 2.3) * 0.25)
      dummy.scale.set(0.3 + Math.sin(i * 1.1) * 0.05, 0.22 + Math.cos(i * 1.3) * 0.04, 0.32)
      dummy.updateMatrix()
      stones.setMatrixAt(i, dummy.matrix)
    }
    stones.instanceMatrix.needsUpdate = true
    this.group.add(stones)

    // 木柴：交叉码放，暗木 + 一点点余烬自发光，让底部不是纯黑
    this.logGeo = new THREE.BoxGeometry(1, 1, 1)
    this.logMat = new THREE.MeshStandardMaterial({
      color: 0x4a2e1c,
      roughness: 0.95,
      metalness: 0,
      flatShading: true,
      emissive: 0x3a1206,
      emissiveIntensity: 0.45,
    })
    const logs = new THREE.InstancedMesh(this.logGeo, this.logMat, 6)
    const logDefs: [number, number, number, number, number, number][] = [
      [-0.28, 0.14, 0.02, 0.78, 0.16, 0.28],
      [0.24, 0.14, -0.06, 0.72, -0.22, -0.24],
      [-0.04, 0.18, 0.28, 0.66, 1.22, 0.2],
      [0.06, 0.18, -0.27, 0.62, 1.36, -0.18],
      [-0.34, 0.26, -0.2, 0.56, 0.62, 0.55],
      [0.32, 0.25, 0.22, 0.54, -0.58, -0.5],
    ]
    for (let i = 0; i < logDefs.length; i += 1) {
      const [lx, ly, lz, len, ry, rz] = logDefs[i]
      dummy.position.set(lx, ly, lz)
      dummy.rotation.set(0, ry, rz)
      dummy.scale.set(len, 0.11, 0.11)
      dummy.updateMatrix()
      logs.setMatrixAt(i, dummy.matrix)
    }
    logs.instanceMatrix.needsUpdate = true
    this.group.add(logs)

    // 地面暖光：加法混合的径向光晕，负责把石圈和木柴边缘照亮
    this.glowMat = new THREE.MeshBasicMaterial({
      map: particleTexture('glow'),
      color: 0xff7a2e,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat)
    this.glow.rotation.x = -Math.PI / 2
    this.glow.position.y = 0.045
    this.glow.scale.set(3.1, 3.1, 1)
    this.glow.renderOrder = 2
    this.group.add(this.glow)

    // 三层火焰：外焰/内焰/焰心，全部走一个 billboard 批次
    this.flames = new BillboardBatch(this.group, particleTexture('glow'), 3, {
      renderOrder: 6,
      blending: THREE.AdditiveBlending,
    })

    // 上升余烬：单个 Points，1 drawcall
    const count = 18
    this.emberGeo = new THREE.BufferGeometry()
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const a = i * 2.399
      const r = 0.14 + ((i * 37) % 100) / 100 * 0.34
      this.seeds.push({
        x: Math.cos(a) * r,
        z: Math.sin(a) * r,
        phase: ((i * 0.618) % 1 + 1) % 1,
        speed: 0.34 + ((i * 53) % 100) / 100 * 0.34,
        sway: 0.04 + ((i * 29) % 100) / 100 * 0.07,
      })
      positions[i * 3] = this.seeds[i].x
      positions[i * 3 + 1] = 0.3 + this.seeds[i].phase * 1.2
      positions[i * 3 + 2] = this.seeds[i].z
    }
    this.emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.emberMat = new THREE.PointsMaterial({
      map: particleTexture('spark'),
      color: 0xffb35c,
      size: 0.09,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
    })
    this.embers = new THREE.Points(this.emberGeo, this.emberMat)
    this.embers.frustumCulled = false
    this.embers.renderOrder = 6
    this.group.add(this.embers)
  }

  update(dt: number): void {
    this.clock += dt
    const t = this.clock
    const flicker = Math.sin(t * 7.3) * 0.5 + Math.sin(t * 3.1 + 1.7) * 0.5
    const breathe = Math.sin(t * 2.4) * 0.5 + 0.5

    // 外焰 / 内焰 / 焰心
    this.flames.set(0, 0, 0.52, 0, 0.82 + flicker * 0.08, 1.22 + flicker * 0.16, 0xff5f1e, 0.46, 0, 0, 1, 1, t * 0.7)
    this.flames.set(1, 0.02, 0.46, 0, 0.5 + flicker * 0.05, 0.84 + flicker * 0.1, 0xffa53c, 0.58, 0, 0, 1, 1, -t * 0.9)
    this.flames.set(2, -0.01, 0.4, 0, 0.26 + breathe * 0.03, 0.5 + flicker * 0.06, 0xfff0b0, 0.8, 0, 0, 1, 1, t * 1.3)
    this.flames.flush()

    this.glowMat.opacity = 0.24 + breathe * 0.1
    this.logMat.emissiveIntensity = 0.38 + Math.max(0, flicker) * 0.22

    const pos = this.emberGeo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < this.seeds.length; i += 1) {
      const s = this.seeds[i]
      const life = (s.phase + t * s.speed) % 1
      pos.setXYZ(
        i,
        s.x + Math.sin(t * 1.7 + s.phase * 9) * s.sway,
        0.3 + life * 1.25,
        s.z + Math.cos(t * 1.4 + s.phase * 7) * s.sway,
      )
    }
    pos.needsUpdate = true
  }

  dispose(): void {
    this.scene.remove(this.group)
    this.group.clear()
    this.flames.dispose()
    this.glow.geometry.dispose()
    this.glowMat.dispose()
    this.emberGeo.dispose()
    this.emberMat.dispose()
    this.logGeo.dispose()
    this.logMat.dispose()
    this.stoneGeo.dispose()
    this.stoneMat.dispose()
  }
}
