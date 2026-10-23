import * as THREE from 'three'
import { PixelCanvas } from '../art/pixels'
import { createShadowMesh, particleTexture, textureFromPixels } from '../art/sprites'
import { fxTexture } from '../art/fxTextures'
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
    // 提灯：长杆挑着一盏冷光风灯，金属框 + 内部小火焰
    cell.line(40, 18, 43, 56, p.robeDark)
    cell.line(41, 18, 44, 56, p.robeHi)
    cell.line(41, 18, 36, 15, p.robeDark)
    cell.fillRect(31, 12, 8, 10, p.robeDark)
    cell.fillRect(32, 13, 6, 8, p.robeHi)
    cell.fillRect(34, 15, 2, 5, p.glow)
    cell.vLine(31, 12, 21, p.trim)
    cell.vLine(38, 12, 21, p.trim)
    cell.hLine(31, 38, 12, p.trim)
    cell.hLine(31, 38, 21, p.trim)
    cell.hLine(30, 39, 10, p.trim)
    cell.hLine(30, 39, 11, p.robeDark)
    cell.hLine(30, 39, 22, p.robeDark)
    cell.set(34, 9, p.trim)
    cell.set(35, 8, p.glow)
    cell.set(33, 22, p.glow)
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
