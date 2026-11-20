import * as THREE from 'three'
import { fxTexture, type FxTextureKind } from '../art/fxTextures'
import { particleTexture } from '../art/sprites'
import { BillboardBatch } from '../art/billboardBatch'
import { GroundBatch } from '../art/groundBatch'
import { awakeningLevel, type AwakeningId, type StyleId } from '../data/awakenings'
import type { CharacterId } from '../types'

/**
 * v4.7 角色专属战斗特效。
 *
 * 和通用 Vfx 的区别：
 * - 这里的形态是「角色语言」而不是通用爆点：睦用音符/五线谱/同心音波，
 *   丛雨用贴地弧形刀光/居合长线/樱花血滴，肥鱼用泡泡/鱼影/鲸影；
 * - 所有临时对象池化，觉醒武器光环常驻但只在拥有觉醒后显示；
 * - 不创建任何 Light，保持场景光照预算不变。
 */

type SpriteKind = FxTextureKind | 'spark'

interface FxParticle {
  /** 合批容器 + 实例位（每次换贴图时重新取位） */
  batch: BillboardBatch | null
  index: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  gravity: number
  drag: number
  life: number
  maxLife: number
  size0: number
  size1: number
  opacity: number
  color: number
  rotation: number
  spin: number
  active: boolean
}

interface GroundFx {
  batch: GroundBatch | null
  index: number
  x: number
  y: number
  z: number
  color: number
  life: number
  maxLife: number
  delay: number
  startW: number
  startL: number
  endW: number
  endL: number
  startOpacity: number
  endOpacity: number
  spin: number
  yaw: number
  active: boolean
}

interface GroundOpts {
  width: number
  length?: number
  startScale?: number
  endScale?: number
  life: number
  color: number
  y?: number
  yaw?: number
  spin?: number
  delay?: number
  opacity?: number
  endOpacity?: number
}

interface ParticleOpts {
  vx?: number
  vy?: number
  vz?: number
  gravity?: number
  drag?: number
  size1?: number
  life?: number
  rotation?: number
  spin?: number
  opacity?: number
}

interface StylePalette {
  main: number
  accent: number
  mote: SpriteKind
  ring: FxTextureKind
}

export interface StyleFxContext {
  character: CharacterId
  styleId: StyleId
  awakenings: Partial<Record<AwakeningId, number>>
  resourceRatio: number
  transformActive: boolean
  weaponLv: number
}

const TAU = Math.PI * 2

const STYLE_PALETTE: Record<StyleId, StylePalette> = {
  'mutsumi-solo': { main: 0xb18cff, accent: 0x76f2e4, mote: 'note', ring: 'staff' },
  'mutsumi-duet': { main: 0xff6b9e, accent: 0xf5ecff, mote: 'note', ring: 'staff' },
  'mutsumi-requiem': { main: 0xffcf6b, accent: 0xa98bff, mote: 'note', ring: 'staff' },
  'murasame-iai': { main: 0xff9ec7, accent: 0xfff2f7, mote: 'petal', ring: 'ring' },
  'murasame-blood': { main: 0xff3b55, accent: 0xffb0a5, mote: 'blood', ring: 'ring' },
  'murasame-guard': { main: 0xffd166, accent: 0xbffcf0, mote: 'spark', ring: 'ring' },
  'fish-school': { main: 0x9fe8ff, accent: 0x7fffd4, mote: 'fish', ring: 'ring' },
  'fish-burst': { main: 0x77e9ff, accent: 0xeaffff, mote: 'bubble', ring: 'ring' },
  'fish-whale': { main: 0x6ea8ff, accent: 0x9fe8ff, mote: 'bubble', ring: 'ring' },
}

const DEFAULT_PALETTE = STYLE_PALETTE['mutsumi-solo']

/** Mortis 变身期的暗色舞台：深紫、酒红、影色，只保留少量亮紫/暗金保证可读性 */
const MORTIS_DARK = {
  shadow: 0x120616,
  violet: 0x572a86,
  wine: 0x8f2748,
  bone: 0xb9a5e6,
  gold: 0xa87f34,
} as const

function isMortisStyle(styleId: StyleId): boolean {
  return styleId.startsWith('mutsumi')
}

function paletteFor(styleId: StyleId): StylePalette {
  return STYLE_PALETTE[styleId] ?? DEFAULT_PALETTE
}

function spriteTexture(kind: SpriteKind): THREE.Texture {
  return kind === 'spark' ? particleTexture('spark') : fxTexture(kind)
}

function styleAngle(dirX: number, dirZ: number): number {
  return Math.atan2(dirZ, dirX)
}

/** 贴地平面的上方映射到本地 +Z；让纹理正面朝 dir。 */
function groundYaw(dirX: number, dirZ: number): number {
  return Math.atan2(dirX, dirZ)
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class CharacterFx {
  private readonly scene: THREE.Scene
  private readonly particles: FxParticle[] = []
  private readonly grounds: GroundFx[] = []
  /** 常驻光环仍用独立 mesh：只有在拥有觉醒时才出现，数量固定且少 */
  private readonly groundGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  /** 每种贴图一个批次：粒子/地面特效各自单 drawcall */
  private readonly particleBatches = new Map<SpriteKind, BillboardBatch>()
  private readonly groundBatches = new Map<FxTextureKind, GroundBatch>()
  private particleIndex = 0
  private groundIndex = 0

  private readonly aura = new THREE.Group()
  private readonly auraMotes: THREE.Sprite[] = []
  private readonly auraRings: THREE.Mesh[] = []
  private readonly auraHex: THREE.Mesh
  private readonly auraWhale: THREE.Mesh
  private readonly auraBubble: THREE.Mesh
  private auraTime = 0
  private auraEmit = 0
  private auraKey = ''
  private auraReady = false
  private auraMoteKind: SpriteKind = 'note'
  private auraMain = 0xffffff
  private auraAccent = 0xffffff
  private auraCount = 0

  constructor(scene: THREE.Scene) {
    this.scene = scene

    for (let i = 0; i < 144; i++) {
      this.particles.push({
        batch: null,
        index: -1,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: 0,
        drag: 2,
        life: 0,
        maxLife: 1,
        size0: 0.3,
        size1: 0.05,
        opacity: 1,
        color: 0xffffff,
        rotation: 0,
        spin: 0,
        active: false,
      })
    }

    for (let i = 0; i < 30; i++) {
      this.grounds.push({
        batch: null,
        index: -1,
        x: 0,
        y: 0,
        z: 0,
        color: 0xffffff,
        life: 0,
        maxLife: 1,
        delay: 0,
        startW: 1,
        startL: 1,
        endW: 1,
        endL: 1,
        startOpacity: 1,
        endOpacity: 0,
        spin: 0,
        yaw: 0,
        active: false,
      })
    }

    this.aura.visible = false
    this.aura.position.y = 0
    this.scene.add(this.aura)

    for (let i = 0; i < 10; i++) {
      const mat = new THREE.SpriteMaterial({
        map: fxTexture('note'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
        opacity: 0.8,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.visible = false
      sprite.frustumCulled = false
      sprite.renderOrder = 7
      this.aura.add(sprite)
      this.auraMotes.push(sprite)
    }

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: fxTexture('ring'),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: 0xffffff,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.groundGeometry, mat)
      mesh.position.y = 0.025 + i * 0.004
      mesh.visible = false
      mesh.renderOrder = 4
      this.aura.add(mesh)
      this.auraRings.push(mesh)
    }

    const hexMat = new THREE.MeshBasicMaterial({
      map: fxTexture('hex'),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: 0xffffff,
      side: THREE.DoubleSide,
      opacity: 0.34,
    })
    this.auraHex = new THREE.Mesh(this.groundGeometry, hexMat)
    this.auraHex.position.y = 0.038
    this.auraHex.visible = false
    this.auraHex.renderOrder = 5
    this.aura.add(this.auraHex)

    const whaleMat = new THREE.MeshBasicMaterial({
      map: fxTexture('whale'),
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      color: 0x6ea8ff,
      side: THREE.DoubleSide,
      opacity: 0.26,
    })
    this.auraWhale = new THREE.Mesh(this.groundGeometry, whaleMat)
    this.auraWhale.position.y = 0.018
    this.auraWhale.visible = false
    this.auraWhale.renderOrder = 3
    this.aura.add(this.auraWhale)

    // 爆破流的巨型泡泡罩：半球形自发光，不产生光源
    const bubbleMat = new THREE.MeshBasicMaterial({
      color: 0x77e9ff,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      opacity: 0.07,
    })
    this.auraBubble = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 12, 0, TAU, 0, Math.PI * 0.52),
      bubbleMat,
    )
    this.auraBubble.position.y = 0.02
    this.auraBubble.visible = false
    this.auraBubble.renderOrder = 4
    this.aura.add(this.auraBubble)
  }

  // ───────────────────── 若叶睦：音乐 ─────────────────────

  /** 普攻起手：从琴弦/枪口位置飘出一枚音符，而不是通用火花。 */
  mutsumiShot(x: number, z: number, dirX: number, dirZ: number, chord: boolean): void {
    const color = chord ? 0xffe6ad : 0xc6a6ff
    this.spawnParticle('note', x + dirX * 0.55, 0.82, z + dirZ * 0.55, color, chord ? 0.46 : 0.34, {
      vx: dirX * 1.7,
      vy: rand(0.25, 0.7),
      vz: dirZ * 1.7,
      gravity: -0.4,
      drag: 2.8,
      life: chord ? 0.55 : 0.4,
      spin: rand(-2.4, 2.4),
      size1: 0.08,
    })
    if (chord) {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU)
        this.spawnParticle('spark', x + dirX * 0.45, 0.85, z + dirZ * 0.45, 0xfff1c2, 0.2, {
          vx: Math.cos(a) * rand(0.5, 1.8),
          vy: rand(0.4, 1.5),
          vz: Math.sin(a) * rand(0.5, 1.8),
          gravity: -2,
          drag: 4,
          life: 0.35,
          spin: 0,
        })
      }
    }
  }

  /** 音符命中：小范围音符回响，颜色跟随和弦/风格。 */
  mutsumiHit(x: number, z: number, chord: boolean): void {
    const color = chord ? 0xffd166 : 0xc6a6ff
    const count = chord ? 5 : 2
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU)
      this.spawnParticle(i === 0 && chord ? 'ring' : 'note', x + Math.cos(a) * 0.22, rand(0.55, 1.0), z + Math.sin(a) * 0.22, color, i === 0 && chord ? 0.65 : rand(0.18, 0.32), {
        vx: Math.cos(a) * rand(0.6, 1.8),
        vy: rand(0.5, 1.4),
        vz: Math.sin(a) * rand(0.6, 1.8),
        gravity: -1.6,
        drag: 3.2,
        life: rand(0.3, 0.55),
        spin: rand(-3, 3),
        size1: 0.02,
      })
    }
  }

  /** Mortis 变身：暗色五线谱领域展开 + 黑紫音符螺旋上升，保留极少量亮紫高光。 */
  mutsumiCast(x: number, z: number, radius: number, styleId: StyleId): void {
    const duet = styleId === 'mutsumi-duet'
    const requiem = styleId === 'mutsumi-requiem'
    const size = Math.max(2.8, radius * 2.25)
    const main = duet ? 0x6e2349 : requiem ? 0x5a2a66 : MORTIS_DARK.violet
    const accent = duet ? 0x9b3455 : requiem ? MORTIS_DARK.gold : MORTIS_DARK.wine
    // 先压一层暗影地纹，再叠音律法阵；这是「Mortis 变身」和普通技能最大的区别
    this.ground('hex', x, z, {
      width: size * 1.08,
      length: size * 1.08,
      life: 1.0,
      color: MORTIS_DARK.shadow,
      startScale: 0.3,
      endScale: 1.08,
      opacity: 0.64,
      spin: duet ? -0.34 : 0.28,
      y: 0.05,
    })
    this.ground('staff', x, z, {
      width: size,
      life: requiem ? 1.05 : 0.9,
      color: main,
      startScale: 0.42,
      endScale: 1.04,
      opacity: 0.96,
      spin: duet ? -0.9 : 0.55,
      y: 0.075,
    })
    this.ground('ring', x, z, {
      width: size * 0.88,
      life: 0.62,
      color: accent,
      startScale: 0.3,
      endScale: 1.12,
      opacity: 0.82,
      delay: 0.04,
      spin: duet ? 1.2 : -0.5,
      y: 0.065,
    })
    if (duet) {
      this.ground('staff', x, z, {
        width: size * 0.82,
        life: 0.72,
        color: accent,
        startScale: 0.4,
        endScale: 1.05,
        opacity: 0.52,
        delay: 0.08,
        spin: 1.1,
        y: 0.08,
      })
    }

    const notes = requiem ? 34 : duet ? 30 : 24
    for (let i = 0; i < notes; i++) {
      const a = (i / notes) * TAU + rand(-0.18, 0.18)
      const r = rand(0.25, 1.15)
      const color = i % 5 === 0 ? MORTIS_DARK.bone : i % 3 === 0 ? accent : main
      this.spawnParticle('note', x + Math.cos(a) * r, rand(0.35, 1.06), z + Math.sin(a) * r, color, rand(0.24, 0.46), {
        vx: Math.cos(a) * rand(2.4, 5.4),
        vy: rand(0.7, 2.4),
        vz: Math.sin(a) * rand(2.4, 5.4),
        gravity: -0.7,
        drag: 1.5,
        life: rand(0.55, 1.0),
        spin: rand(-3.4, 3.4),
        size1: 0.06,
      })
    }

    // 纵向暗影音浪：暗紫烟尘向上翻涌，只保留少量亮紫火星。
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU)
      const r = rand(0, 0.95)
      const color = i % 7 === 0 ? MORTIS_DARK.bone : i % 3 === 0 ? MORTIS_DARK.wine : i % 2 ? 0x3a174d : MORTIS_DARK.shadow
      this.spawnParticle('spark', x + Math.cos(a) * r, rand(0.12, 0.62), z + Math.sin(a) * r, color, rand(0.2, 0.38), {
        vx: Math.cos(a) * rand(0.18, 1.05),
        vy: rand(1.2, 3.4),
        vz: Math.sin(a) * rand(0.18, 1.05),
        gravity: -2.4,
        drag: 2.2,
        life: rand(0.42, 0.82),
        spin: 0,
        size1: 0.01,
      })
    }
    this.hooksPulseRing(x, z, radius, main, accent)
  }

  /** Mortis 脉冲：暗紫同心音波 + 酒红外扩音符；和弦保留一点暗金。 */
  mutsumiPulse(x: number, z: number, radius: number, chord: boolean, styleId: StyleId): void {
    const main = chord ? MORTIS_DARK.gold : MORTIS_DARK.violet
    const accent = chord ? 0xffe0a0 : MORTIS_DARK.wine
    const size = Math.max(1.4, radius * 2.15)
    this.ground('ring', x, z, {
      width: size,
      life: chord ? 0.52 : 0.4,
      color: main,
      startScale: 0.18,
      endScale: 1.02,
      opacity: chord ? 0.95 : 0.74,
      spin: styleId === 'mutsumi-duet' ? 0.8 : -0.55,
      y: 0.07,
    })
    this.ground('ring', x, z, {
      width: size * 0.58,
      life: chord ? 0.4 : 0.3,
      color: accent,
      startScale: 0.25,
      endScale: 0.9,
      opacity: 0.58,
      delay: 0.025,
      spin: 0.9,
      y: 0.075,
    })
    if (chord) {
      this.ground('hex', x, z, {
        width: size * 1.02,
        length: size * 1.02,
        life: 0.5,
        color: MORTIS_DARK.shadow,
        startScale: 0.34,
        endScale: 1.05,
        opacity: 0.42,
        spin: 0.3,
        y: 0.055,
      })
      this.ground('staff', x, z, {
        width: size * 0.95,
        life: 0.52,
        color: MORTIS_DARK.gold,
        startScale: 0.42,
        endScale: 1.0,
        opacity: 0.58,
        spin: 0.5,
        y: 0.078,
      })
    }

    const count = chord ? 10 : styleId === 'mutsumi-requiem' ? 8 : 5
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + this.auraTime * 0.2
      const r = radius * rand(0.28, 0.52)
      const color = i % 4 === 0 ? MORTIS_DARK.bone : i % 2 === 0 ? main : accent
      this.spawnParticle(chord && i === 0 ? 'ring' : 'note', x + Math.cos(a) * r, rand(0.4, 0.92), z + Math.sin(a) * r, color, chord && i === 0 ? 0.85 : rand(0.22, 0.38), {
        vx: Math.cos(a) * rand(1.7, 3.6),
        vy: rand(0.5, 1.6),
        vz: Math.sin(a) * rand(1.7, 3.6),
        gravity: -0.8,
        drag: 1.8,
        life: rand(0.38, 0.62),
        spin: rand(-2.8, 2.8),
        size1: 0.03,
      })
    }
    if (chord) {
      for (let i = 0; i < 10; i++) {
        const a = rand(0, TAU)
        this.spawnParticle('spark', x, rand(0.3, 1.0), z, i % 3 === 0 ? 0xffe0a0 : MORTIS_DARK.wine, rand(0.14, 0.26), {
          vx: Math.cos(a) * rand(1.5, 4),
          vy: rand(1, 3),
          vz: Math.sin(a) * rand(1.5, 4),
          gravity: -3,
          drag: 2,
          life: rand(0.3, 0.55),
          spin: 0,
        })
      }
    }
    this.hooksPulseRing(x, z, radius, main, accent)
  }

  /** 余音音场：落点留下一个小型五线谱法阵。 */
  mutsumiField(x: number, z: number, radius: number): void {
    this.ground('staff', x, z, {
      width: radius * 2.15,
      life: 0.7,
      color: 0xb18cff,
      startScale: 0.3,
      endScale: 1,
      opacity: 0.36,
      spin: 0.35,
      y: 0.052,
    })
  }

  /** 葬送爆炸：金色音符冲击。 */
  mutsumiExplosion(x: number, z: number, radius: number): void {
    this.ground('ring', x, z, {
      width: radius * 2.1,
      life: 0.35,
      color: 0xffd166,
      startScale: 0.16,
      endScale: 1.03,
      opacity: 0.9,
      spin: -0.8,
      y: 0.07,
    })
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU
      this.spawnParticle('note', x + Math.cos(a) * 0.5, 0.55, z + Math.sin(a) * 0.5, 0xffe6ad, rand(0.22, 0.36), {
        vx: Math.cos(a) * rand(2, 4),
        vy: rand(0.8, 2),
        vz: Math.sin(a) * rand(2, 4),
        gravity: -2,
        drag: 2,
        life: 0.5,
        spin: rand(-3, 3),
        size1: 0.03,
      })
    }
  }

  /** 谢幕：暗色音符向下飘落 + 一圈礼花式音波。 */
  mutsumiCurtain(x: number, z: number, styleId: StyleId): void {
    const p = paletteFor(styleId)
    this.ground('ring', x, z, {
      width: 4.1,
      life: 0.55,
      color: p.main,
      startScale: 0.22,
      endScale: 1.05,
      opacity: 0.8,
      spin: 1.1,
      y: 0.07,
    })
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU)
      const r = rand(0.6, 3.2)
      this.spawnParticle('note', x + Math.cos(a) * r, rand(1.1, 2.4), z + Math.sin(a) * r, i % 3 === 0 ? p.accent : p.main, rand(0.18, 0.34), {
        vx: rand(-0.3, 0.3),
        vy: rand(-0.6, -0.1),
        vz: rand(-0.3, 0.3),
        gravity: -2.4,
        drag: 0.8,
        life: rand(0.55, 0.95),
        spin: rand(-2.5, 2.5),
        size1: 0.03,
      })
    }
  }

  // ───────────────────── 丛雨：刀术 ─────────────────────

  /** 普通拔刀：贴地弧形刀光 + 刀锋前缘，和音乐环完全区分。 */
  murasameSlash(
    px: number,
    pz: number,
    dirX: number,
    dirZ: number,
    range: number,
    styleId: StyleId,
    hit: boolean,
  ): void {
    const p = paletteFor(styleId)
    const yaw = groundYaw(dirX, dirZ)
    const cx = px + dirX * range * 0.5
    const cz = pz + dirZ * range * 0.5
    const size = Math.max(2.4, range * 2.45)
    this.ground('slash', cx, cz, {
      width: size,
      length: size,
      life: 0.24,
      color: p.main,
      yaw,
      startScale: 0.8,
      endScale: 1.07,
      opacity: 0.95,
      spin: styleId === 'murasame-iai' ? -0.08 : 0.04,
      y: 0.08,
    })
    this.ground('slash', cx + dirX * range * 0.08, cz + dirZ * range * 0.08, {
      width: size * 1.08,
      length: size * 1.08,
      life: 0.17,
      color: p.accent,
      yaw,
      startScale: 0.9,
      endScale: 1.16,
      opacity: 0.55,
      delay: 0.025,
      spin: 0,
      y: 0.085,
    })
    // 刀锋前缘的细线，让斩击有「挥出去」的方向感
    this.ground('bladeLine', px + dirX * range * 0.55, pz + dirZ * range * 0.55, {
      width: 0.52,
      length: range * 1.08,
      life: 0.16,
      color: p.accent,
      yaw,
      startScale: 0.88,
      endScale: 1.06,
      opacity: 0.55,
      delay: 0.012,
      y: 0.09,
    })

    if (!hit) return
    const base = styleAngle(dirX, dirZ)
    for (let i = 0; i < 7; i++) {
      const a = base + rand(-1.08, 1.08)
      const r = range * rand(0.55, 0.98)
      this.spawnParticle(p.mote, px + Math.cos(a) * r, rand(0.35, 0.9), pz + Math.sin(a) * r, i % 3 === 0 ? p.accent : p.main, rand(0.13, 0.27), {
        vx: Math.cos(a) * rand(0.4, 1.8),
        vy: rand(0.4, 1.8),
        vz: Math.sin(a) * rand(0.4, 1.8),
        gravity: styleId === 'murasame-iai' ? -2.2 : -4,
        drag: 2.4,
        life: rand(0.35, 0.65),
        spin: rand(-2.8, 2.8),
        size1: 0.02,
      })
    }
  }

  /** 居合第三刀：一道贯穿型长线，端部再补一道窄弧光。 */
  murasameIai(px: number, pz: number, dirX: number, dirZ: number, range: number, styleId: StyleId): void {
    const p = paletteFor(styleId)
    const yaw = groundYaw(dirX, dirZ)
    const cx = px + dirX * range * 0.5
    const cz = pz + dirZ * range * 0.5
    this.ground('bladeLine', cx, cz, {
      width: 1.35,
      length: range * 1.16,
      life: 0.28,
      color: p.main,
      yaw,
      startScale: 0.92,
      endScale: 1.04,
      opacity: 1,
      y: 0.085,
    })
    this.ground('bladeLine', cx, cz, {
      width: 0.34,
      length: range * 1.18,
      life: 0.21,
      color: 0xffffff,
      yaw,
      startScale: 0.9,
      endScale: 1.05,
      opacity: 0.85,
      delay: 0.02,
      y: 0.09,
    })
    this.ground('slash', px + dirX * range * 0.94, pz + dirZ * range * 0.94, {
      width: 2.2,
      length: 2.2,
      life: 0.15,
      color: p.accent,
      yaw,
      startScale: 0.35,
      endScale: 0.85,
      opacity: 0.6,
      delay: 0.06,
      y: 0.09,
    })
    const base = styleAngle(dirX, dirZ)
    for (let i = 0; i < 12; i++) {
      const t = rand(0.08, 1.0)
      const side = rand(-0.65, 0.65)
      const x = px + dirX * range * t - dirZ * side
      const z = pz + dirZ * range * t + dirX * side
      this.spawnParticle(p.mote, x, rand(0.35, 1.0), z, i % 3 === 0 ? p.accent : p.main, rand(0.12, 0.25), {
        vx: dirX * rand(0.2, 1.4) + Math.cos(base + Math.PI / 2) * rand(-0.8, 0.8),
        vy: rand(0.3, 1.6),
        vz: dirZ * rand(0.2, 1.4) + Math.sin(base + Math.PI / 2) * rand(-0.8, 0.8),
        gravity: styleId === 'murasame-iai' ? -2.2 : -4,
        drag: 2.2,
        life: rand(0.35, 0.7),
        spin: rand(-2.6, 2.6),
        size1: 0.02,
      })
    }
  }

  /** 突进：全程速度线 + 落点收束刀光；燕返时追加交叉斩。 */
  murasameDash(
    fromX: number,
    fromZ: number,
    toX: number,
    toZ: number,
    dirX: number,
    dirZ: number,
    styleId: StyleId,
    empowered: boolean,
  ): void {
    const p = paletteFor(styleId)
    const dx = toX - fromX
    const dz = toZ - fromZ
    const dist = Math.max(0.01, Math.hypot(dx, dz))
    const yaw = groundYaw(dx / dist, dz / dist)
    const cx = (fromX + toX) / 2
    const cz = (fromZ + toZ) / 2
    this.ground('bladeLine', cx, cz, {
      width: empowered ? 2.6 : 1.8,
      length: dist * 1.1,
      life: 0.3,
      color: p.main,
      yaw,
      startScale: 0.96,
      endScale: 1.02,
      opacity: 0.8,
      y: 0.075,
    })
    this.ground('bladeLine', cx, cz, {
      width: 0.48,
      length: dist * 1.12,
      life: 0.24,
      color: p.accent,
      yaw,
      startScale: 0.98,
      endScale: 1.02,
      opacity: 0.9,
      delay: 0.02,
      y: 0.082,
    })
    this.ground('ring', toX, toZ, {
      width: empowered ? 4.4 : 3.1,
      life: 0.35,
      color: p.main,
      startScale: 0.18,
      endScale: 1.05,
      opacity: 0.75,
      spin: -0.6,
      y: 0.07,
    })
    const endYaw = groundYaw(dirX, dirZ)
    this.ground('slash', toX + dirX * 0.65, toZ + dirZ * 0.65, {
      width: empowered ? 4.0 : 2.8,
      length: empowered ? 4.0 : 2.8,
      life: 0.25,
      color: p.accent,
      yaw: endYaw,
      startScale: 0.7,
      endScale: 1.04,
      opacity: 0.8,
      delay: 0.05,
      y: 0.085,
    })
    if (empowered) {
      this.ground('slash', toX, toZ, {
        width: 4.6,
        length: 4.6,
        life: 0.3,
        color: p.main,
        yaw: endYaw + Math.PI * 0.72,
        startScale: 0.25,
        endScale: 0.96,
        opacity: 0.58,
        delay: 0.12,
        y: 0.08,
      })
    }
    const base = styleAngle(dx / dist, dz / dist)
    for (let i = 0; i < (empowered ? 16 : 9); i++) {
      const t = rand(0.08, 0.95)
      const side = rand(-0.5, 0.5)
      this.spawnParticle(p.mote, fromX + dx * t - (dz / dist) * side, rand(0.2, 0.9), fromZ + dz * t + (dx / dist) * side, i % 3 === 0 ? p.accent : p.main, rand(0.12, 0.25), {
        vx: Math.cos(base) * rand(0.4, 2.0),
        vy: rand(0.3, 1.8),
        vz: Math.sin(base) * rand(0.4, 2.0),
        gravity: styleId === 'murasame-iai' ? -2.4 : -3.6,
        drag: 2,
        life: rand(0.3, 0.62),
        spin: rand(-3, 3),
        size1: 0.02,
      })
    }
    if (styleId === 'murasame-guard') this.murasameGuard(toX, toZ, empowered)
  }

  /** 守护冲击波：六边形护盾纹 + 金色余震。 */
  murasameGuard(x: number, z: number, empowered: boolean): void {
    this.ground('hex', x, z, {
      width: empowered ? 4.8 : 3.3,
      life: 0.55,
      color: 0xffd166,
      startScale: 0.24,
      endScale: 1.05,
      opacity: 0.85,
      spin: 0.5,
      y: 0.075,
    })
    this.ground('ring', x, z, {
      width: empowered ? 5.1 : 3.7,
      life: 0.4,
      color: 0xbffcf0,
      startScale: 0.2,
      endScale: 1.08,
      opacity: 0.65,
      delay: 0.04,
      spin: -0.8,
      y: 0.065,
    })
    for (let i = 0; i < 10; i++) {
      const a = rand(0, TAU)
      this.spawnParticle('spark', x + Math.cos(a) * rand(0.5, 1.5), rand(0.25, 0.9), z + Math.sin(a) * rand(0.5, 1.5), 0xffe6ad, rand(0.12, 0.23), {
        vx: Math.cos(a) * rand(1, 3),
        vy: rand(0.6, 2.2),
        vz: Math.sin(a) * rand(1, 3),
        gravity: -4,
        drag: 2.2,
        life: rand(0.3, 0.6),
        spin: 0,
        size1: 0.01,
      })
    }
  }

  // ───────────────────── 肥鱼：水 / 泡泡 ─────────────────────

  fishShot(x: number, z: number, dirX: number, dirZ: number, big: boolean): void {
    if (big) {
      this.ground('ring', x + dirX * 0.5, z + dirZ * 0.5, {
        width: 1.15,
        life: 0.25,
        color: 0x8ff6ff,
        startScale: 0.4,
        endScale: 1.05,
        opacity: 0.65,
        y: 0.65,
      })
    }
    for (let i = 0; i < (big ? 6 : 2); i++) {
      const a = rand(0, TAU)
      this.spawnParticle('bubble', x + dirX * 0.4 + Math.cos(a) * 0.15, rand(0.65, 0.95), z + dirZ * 0.4 + Math.sin(a) * 0.15, 0x9fe8ff, rand(0.12, big ? 0.32 : 0.2), {
        vx: dirX * rand(0.7, 2.1) + Math.cos(a) * rand(0.1, 0.9),
        vy: rand(0.2, 1.2),
        vz: dirZ * rand(0.7, 2.1) + Math.sin(a) * rand(0.1, 0.9),
        gravity: -1.4,
        drag: 2.6,
        life: rand(0.3, 0.65),
        spin: 0,
        size1: 0.05,
      })
    }
  }

  fishHit(x: number, z: number, big: boolean): void {
    for (let i = 0; i < (big ? 5 : 2); i++) {
      const a = rand(0, TAU)
      this.spawnParticle('bubble', x, rand(0.45, 0.9), z, 0xbff8ff, rand(0.1, big ? 0.28 : 0.18), {
        vx: Math.cos(a) * rand(0.5, 2.4),
        vy: rand(0.3, 1.5),
        vz: Math.sin(a) * rand(0.5, 2.4),
        gravity: -1.2,
        drag: 2.6,
        life: rand(0.3, 0.6),
        spin: 0,
        size1: 0.02,
      })
    }
  }

  /** 大泡泡 / 鲸落：水环 + 泡泡爆点，巨大泡泡额外出现鲸影。 */
  fishBurst(x: number, z: number, radius: number, styleId: StyleId): void {
    const p = paletteFor(styleId)
    this.ground('ring', x, z, {
      width: Math.max(2, radius * 2.4),
      life: 0.38,
      color: p.main,
      startScale: 0.16,
      endScale: 1.02,
      opacity: 0.8,
      spin: 0.7,
      y: 0.065,
    })
    this.ground('ring', x, z, {
      width: Math.max(1.2, radius * 1.35),
      life: 0.28,
      color: 0xffffff,
      startScale: 0.3,
      endScale: 1.15,
      opacity: 0.45,
      delay: 0.03,
      spin: -1,
      y: 0.07,
    })
    const count = styleId === 'fish-burst' ? 22 : 14
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU)
      const r = radius * rand(0.2, 0.8)
      this.spawnParticle('bubble', x + Math.cos(a) * r, rand(0.25, 1.1), z + Math.sin(a) * r, i % 3 === 0 ? 0xffffff : p.main, rand(0.1, 0.3), {
        vx: Math.cos(a) * rand(0.8, 3.8),
        vy: rand(0.5, 2.6),
        vz: Math.sin(a) * rand(0.8, 3.8),
        gravity: -2,
        drag: 2,
        life: rand(0.35, 0.75),
        spin: 0,
        size1: 0.02,
      })
    }
    if (styleId === 'fish-whale') {
      this.ground('whale', x, z, {
        width: 6.6,
        length: 3.8,
        life: 0.95,
        color: 0x8fb8ff,
        startScale: 0.6,
        endScale: 1.05,
        opacity: 0.22,
        spin: 0.18,
        y: 0.032,
      })
    }
  }

  /** 召唤：水环散开 + 鱼影/鲸影，按风格切换表现重心。 */
  fishSummon(px: number, pz: number, count: number, styleId: StyleId): void {
    const p = paletteFor(styleId)
    this.ground('ring', px, pz, {
      width: 4.2,
      life: 0.58,
      color: p.main,
      startScale: 0.18,
      endScale: 1.06,
      opacity: 0.8,
      spin: -0.8,
      y: 0.065,
    })
    this.ground('ring', px, pz, {
      width: 2.4,
      life: 0.4,
      color: p.accent,
      startScale: 0.25,
      endScale: 1.15,
      opacity: 0.56,
      delay: 0.04,
      spin: 1.1,
      y: 0.07,
    })
    if (styleId === 'fish-whale') {
      this.ground('whale', px, pz, {
        width: 7.2,
        length: 4.2,
        life: 1.25,
        color: 0x6ea8ff,
        startScale: 0.5,
        endScale: 1.05,
        opacity: 0.26,
        spin: 0.12,
        y: 0.03,
      })
    }
    const fishCount = styleId === 'fish-school' ? Math.max(5, count + 2) : styleId === 'fish-whale' ? 3 : 2
    for (let i = 0; i < fishCount; i++) {
      const a = (i / fishCount) * TAU + rand(-0.2, 0.2)
      this.spawnParticle('fish', px + Math.cos(a) * 0.7, rand(0.4, 0.85), pz + Math.sin(a) * 0.7, styleId === 'fish-whale' ? 0x9fc6ff : p.accent, rand(0.28, 0.5), {
        vx: Math.cos(a) * rand(1.4, 3.2),
        vy: rand(0.2, 0.9),
        vz: Math.sin(a) * rand(1.4, 3.2),
        gravity: -0.7,
        drag: 1.3,
        life: rand(0.55, 0.95),
        spin: 0,
        size1: 0.06,
      })
    }
    const bubbleCount = styleId === 'fish-burst' ? 18 : 10
    for (let i = 0; i < bubbleCount; i++) {
      const a = rand(0, TAU)
      const r = rand(0.2, 1.7)
      this.spawnParticle('bubble', px + Math.cos(a) * r, rand(0.25, 1.0), pz + Math.sin(a) * r, i % 3 === 0 ? 0xffffff : p.main, rand(0.1, 0.26), {
        vx: Math.cos(a) * rand(0.4, 2.2),
        vy: rand(0.5, 2.1),
        vz: Math.sin(a) * rand(0.4, 2.2),
        gravity: -1.6,
        drag: 2,
        life: rand(0.35, 0.7),
        spin: 0,
        size1: 0.02,
      })
    }
  }

  /** 召唤物鲸落：小型水爆 + 可选鱼影。 */
  fishMinionExpire(x: number, z: number, styleId: StyleId): void {
    this.fishBurst(x, z, 2.2, styleId)
    this.spawnParticle('fish', x, 0.45, z, 0xc7f7ff, 0.38, {
      vx: 0,
      vy: 1.1,
      vz: 0,
      gravity: -0.5,
      drag: 1.5,
      life: 0.7,
      spin: 0,
      size1: 0.04,
    })
  }

  // ───────────────────── 觉醒武器光环 ─────────────────────

  /**
   * 9 套风格的觉醒武器光环：
   * 拥有任意觉醒后出现，等级越高越完整；资源满时环纹变亮并额外溢出音符/泡泡。
   * 守护会展开六边形护盾纹，鲸落会有一条在脚下游动的鲸影。
   */
  update(dt: number, px: number, pz: number, ctx: StyleFxContext): void {
    this.updateParticles(dt)
    this.updateGrounds(dt)
    this.updateAura(dt, px, pz, ctx)
    this.flush()
  }

  /** 每帧末统一上传合批实例数据 */
  flush(): void {
    for (const batch of this.particleBatches.values()) batch.flush()
    for (const batch of this.groundBatches.values()) batch.flush()
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        p.batch?.release(p.index)
        p.index = -1
        continue
      }
      const t = Math.max(0, p.life / p.maxLife)
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vz *= drag
      p.vy += p.gravity * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.045) {
        p.y = 0.045
        p.vy *= -0.18
      }
      const size = Math.max(0.001, p.size1 + (p.size0 - p.size1) * t)
      p.rotation += p.spin * dt
      const alpha = p.opacity * Math.min(1, t * 3.4)
      p.batch?.set(p.index, p.x, p.y, p.z, size, size, p.color, alpha, 0, 0, 1, 1, p.rotation)
    }
  }

  private updateGrounds(dt: number): void {
    for (const g of this.grounds) {
      if (!g.active) continue
      if (g.delay > 0) {
        g.delay -= dt
        if (g.delay > 0) {
          g.batch?.set(g.index, g.x, g.y, g.z, g.startW, g.startL, g.yaw, g.color, 0)
          continue
        }
      }
      g.life -= dt
      if (g.life <= 0) {
        g.active = false
        g.batch?.release(g.index)
        g.index = -1
        continue
      }
      const t = 1 - Math.max(0, g.life) / g.maxLife
      const ease = 1 - Math.pow(1 - t, 2.2)
      const w = g.startW + (g.endW - g.startW) * ease
      const l = g.startL + (g.endL - g.startL) * ease
      const alpha = g.startOpacity + (g.endOpacity - g.startOpacity) * t
      g.batch?.set(g.index, g.x, g.y, g.z, w, l, g.yaw + g.spin * t, g.color, alpha)
    }
  }

  private updateAura(dt: number, px: number, pz: number, ctx: StyleFxContext): void {
    this.auraTime += dt
    const power = Object.values(ctx.awakenings).reduce((sum, level) => sum + Math.max(0, level ?? 0), 0)
    // 变身期即使没有觉醒也亮起暗色光环：这是 Mortis 形态的轮廓，不额外增加对象
    const visible = power > 0 || ctx.transformActive
    this.aura.visible = visible
    if (!visible) {
      this.auraReady = false
      return
    }

    const p = paletteFor(ctx.styleId)
    const mortisDark = ctx.transformActive && isMortisStyle(ctx.styleId)
    const auraMain = mortisDark
      ? ctx.styleId === 'mutsumi-duet'
        ? 0x7a2348
        : ctx.styleId === 'mutsumi-requiem'
          ? 0x5a2438
          : 0x55247a
      : p.main
    const auraAccent = mortisDark
      ? ctx.styleId === 'mutsumi-duet'
        ? 0xa63e62
        : ctx.styleId === 'mutsumi-requiem'
          ? 0x9a7433
          : MORTIS_DARK.wine
      : p.accent
    const guardWall = awakeningLevel(ctx.awakenings, 'murasame-guard-wall')
    const key = `${ctx.styleId}:${Math.round(power)}:${guardWall}:${ctx.transformActive ? 1 : 0}`
    const ready = ctx.resourceRatio >= 0.999
    this.auraReady = ready
    if (key !== this.auraKey) {
      this.auraKey = key
      this.auraMain = auraMain
      this.auraAccent = auraAccent
      this.auraMoteKind = p.mote
      this.auraCount = Math.min(10, 4 + Math.round(power) + (ctx.transformActive ? 2 : 0))
      for (const mote of this.auraMotes) {
        const mat = mote.material as THREE.SpriteMaterial
        mat.map = spriteTexture(p.mote)
        mat.needsUpdate = true
      }
      const ringMap = fxTexture(p.ring)
      for (let i = 0; i < this.auraRings.length; i++) {
        const mat = this.auraRings[i].material as THREE.MeshBasicMaterial
        if (mat.map !== ringMap) {
          mat.map = ringMap
          mat.needsUpdate = true
        }
        mat.color.setHex(i === 1 ? auraAccent : auraMain)
      }
      this.auraHex.visible = ctx.styleId === 'murasame-guard' && guardWall > 0
      this.auraWhale.visible = ctx.styleId === 'fish-whale'
      this.auraBubble.visible = ctx.styleId === 'fish-burst'
    }

    this.aura.position.set(px, 0, pz)
    const boost = ready ? 1 : 0
    const orbitSpeed = 0.78 + Math.round(power) * 0.025 + (ready ? 0.18 : 0)
    const radius = 0.92 + Math.round(power) * 0.035 + boost * 0.12
    const baseScale = 0.22 + Math.round(power) * 0.015 + boost * 0.045
    for (let i = 0; i < this.auraMotes.length; i++) {
      const mote = this.auraMotes[i]
      const on = i < this.auraCount
      mote.visible = on
      if (!on) continue
      const phase = (i / this.auraCount) * TAU
      const a = this.auraTime * orbitSpeed + phase
      const rr = radius + Math.sin(this.auraTime * 1.6 + i * 1.7) * 0.08
      mote.position.set(Math.cos(a) * rr, 0.58 + Math.sin(this.auraTime * 1.9 + i) * 0.16 + boost * 0.05, Math.sin(a) * rr)
      const s = baseScale * (i % 4 === 0 ? 1.16 : 0.9)
      mote.scale.setScalar(s)
      const mat = mote.material as THREE.SpriteMaterial
      mat.color.setHex(i % 3 === 0 ? this.auraAccent : this.auraMain)
      mat.opacity = 0.62 + boost * 0.25
      mat.rotation = a + Math.PI / 2 + (ctx.styleId === 'fish-school' ? 0 : 0.15)
    }

    const ringBoost = 0.14 + Math.round(power) * 0.018 + boost * 0.18
    for (let i = 0; i < this.auraRings.length; i++) {
      const ring = this.auraRings[i]
      ring.visible = i < 2 || (ctx.styleId === 'mutsumi-requiem' && ready)
      if (!ring.visible) continue
      const scale = (i === 0 ? 2.55 : i === 1 ? 1.9 : 1.45) + boost * 0.12
      ring.scale.set(scale, 1, scale)
      ring.rotation.y = this.auraTime * (i % 2 === 0 ? 0.22 : -0.31) + i
      const mat = ring.material as THREE.MeshBasicMaterial
      mat.opacity = ringBoost * (i === 0 ? 1 : 0.72)
    }

    if (this.auraHex.visible) {
      this.auraHex.scale.set(2.25 + boost * 0.2, 1, 2.25 + boost * 0.2)
      this.auraHex.rotation.y = -this.auraTime * 0.38
      const mat = this.auraHex.material as THREE.MeshBasicMaterial
      mat.color.setHex(0xffd166)
      mat.opacity = 0.32 + boost * 0.2
    }
    if (this.auraWhale.visible) {
      const wobble = Math.sin(this.auraTime * 0.55) * 0.5
      this.auraWhale.position.set(wobble, 0.018, Math.cos(this.auraTime * 0.55) * 0.32)
      this.auraWhale.rotation.y = this.auraTime * 0.22
      this.auraWhale.scale.set(4.5, 1, 2.45)
      const mat = this.auraWhale.material as THREE.MeshBasicMaterial
      mat.color.setHex(0x8fb8ff)
      mat.opacity = 0.26 + boost * 0.1
    }

    if (this.auraBubble.visible) {
      const pulse = 2.15 + Math.sin(this.auraTime * 1.35) * 0.13 + boost * 0.18
      this.auraBubble.scale.set(pulse, pulse * 1.05, pulse)
      const mat = this.auraBubble.material as THREE.MeshBasicMaterial
      mat.opacity = 0.055 + boost * 0.045 + Math.sin(this.auraTime * 1.9) * 0.012
    }

    this.auraEmit -= dt
    if (this.auraEmit <= 0 && (ready || ctx.transformActive)) {
      this.auraEmit = ready ? 0.32 : 0.5
      const a = rand(0, TAU)
      this.spawnParticle(this.auraMoteKind, px + Math.cos(a) * 0.8, rand(0.65, 1.0), pz + Math.sin(a) * 0.8, this.auraAccent, rand(0.16, 0.26), {
        vx: Math.cos(a) * rand(0.2, 0.9),
        vy: rand(0.5, 1.3),
        vz: Math.sin(a) * rand(0.2, 0.9),
        gravity: ctx.styleId.startsWith('murasame') ? -2.4 : -0.7,
        drag: 1.5,
        life: rand(0.45, 0.8),
        spin: rand(-2.4, 2.4),
        size1: 0.02,
      })
    }
  }

  private spawnParticle(
    kind: SpriteKind,
    x: number,
    y: number,
    z: number,
    color: number,
    size: number,
    opts: ParticleOpts = {},
  ): void {
    const p = this.particles[this.particleIndex]
    this.particleIndex = (this.particleIndex + 1) % this.particles.length
    const batch = this.particleBatchFor(kind)
    if (p.index >= 0) p.batch?.release(p.index)
    p.batch = batch
    p.index = batch.acquire()
    p.color = color
    p.opacity = opts.opacity ?? 1
    p.rotation = opts.rotation ?? rand(0, TAU)
    p.x = x
    p.y = y
    p.z = z
    p.vx = opts.vx ?? 0
    p.vy = opts.vy ?? 0
    p.vz = opts.vz ?? 0
    p.gravity = opts.gravity ?? 0
    p.drag = opts.drag ?? 2
    p.life = p.maxLife = opts.life ?? 0.45
    p.size0 = size
    p.size1 = opts.size1 ?? size * 0.12
    p.spin = opts.spin ?? 0
    p.active = true
    const shown = Math.max(0.001, size)
    batch.set(p.index, x, y, z, shown, shown, color, p.opacity, 0, 0, 1, 1, p.rotation)
  }

  private ground(kind: FxTextureKind, x: number, z: number, opts: GroundOpts): void {
    const g = this.grounds[this.groundIndex]
    this.groundIndex = (this.groundIndex + 1) % this.grounds.length
    const batch = this.groundBatchFor(kind)
    if (g.index >= 0) g.batch?.release(g.index)
    g.batch = batch
    g.index = batch.acquire()
    const length = opts.length ?? opts.width
    const startScale = opts.startScale ?? 1
    const endScale = opts.endScale ?? 1.05
    g.x = x
    g.y = opts.y ?? 0.06
    g.z = z
    g.color = opts.color
    g.startW = opts.width * startScale
    g.startL = length * startScale
    g.endW = opts.width * endScale
    g.endL = length * endScale
    g.startOpacity = opts.opacity ?? 0.9
    g.endOpacity = opts.endOpacity ?? 0
    g.life = g.maxLife = Math.max(0.01, opts.life)
    g.delay = Math.max(0, opts.delay ?? 0)
    g.spin = opts.spin ?? 0
    g.yaw = opts.yaw ?? 0
    g.active = true
    batch.set(g.index, x, g.y, z, g.startW, g.startL, g.yaw, g.color, g.delay > 0 ? 0 : g.startOpacity)
  }

  private particleBatchFor(kind: SpriteKind): BillboardBatch {
    let batch = this.particleBatches.get(kind)
    if (!batch) {
      batch = new BillboardBatch(this.scene, spriteTexture(kind), 144, {
        renderOrder: 7,
        blending: THREE.NormalBlending,
      })
      this.particleBatches.set(kind, batch)
    }
    return batch
  }

  private groundBatchFor(kind: FxTextureKind): GroundBatch {
    let batch = this.groundBatches.get(kind)
    if (!batch) {
      batch = new GroundBatch(this.scene, fxTexture(kind), 30, 5)
      this.groundBatches.set(kind, batch)
    }
    return batch
  }

  /**
   * 兼容旧调用：脉冲/变身本来会在 0.35 高度再叠一轮通用 burst。
   * 现在改成低频的地面音波，避免和音符粒子争抢画面。
   */
  private hooksPulseRing(x: number, z: number, radius: number, color: number, accent: number): void {
    if (radius <= 0) return
    this.spawnParticle('ring', x, 0.18, z, color, Math.min(2.4, radius * 0.35), {
      vx: 0,
      vy: 0.25,
      vz: 0,
      gravity: 0,
      drag: 0,
      life: 0.32,
      spin: 0,
      size1: Math.min(3.1, radius * 0.76),
      opacity: 0.22,
      rotation: 0,
    })
    this.spawnParticle('spark', x, 0.3, z, accent, Math.min(0.9, radius * 0.16), {
      vx: 0,
      vy: 0.8,
      vz: 0,
      gravity: -1,
      drag: 1,
      life: 0.28,
      spin: 0,
      size1: 0.02,
      opacity: 0.5,
    })
  }

  /** 切层/换风格/重开时清掉临时特效；常驻光环由下一帧的 updateAura 重新决定。 */
  clearTransient(): void {
    for (const p of this.particles) {
      p.active = false
      if (p.index >= 0) p.batch?.release(p.index)
      p.index = -1
    }
    for (const g of this.grounds) {
      g.active = false
      if (g.index >= 0) g.batch?.release(g.index)
      g.index = -1
    }
    this.auraKey = ''
    this.flush()
  }

  dispose(): void {
    this.clearTransient()
    for (const batch of this.particleBatches.values()) batch.dispose()
    for (const batch of this.groundBatches.values()) batch.dispose()
    this.particleBatches.clear()
    this.groundBatches.clear()
    this.particles.length = 0
    this.grounds.length = 0

    for (const mote of this.auraMotes) {
      mote.material.dispose()
    }
    for (const ring of this.auraRings) {
      ;(ring.material as THREE.Material).dispose()
    }
    ;(this.auraHex.material as THREE.Material).dispose()
    ;(this.auraWhale.material as THREE.Material).dispose()
    ;(this.auraBubble.material as THREE.Material).dispose()
    this.auraBubble.geometry.dispose()
    this.groundGeometry.dispose()
    this.scene.remove(this.aura)
  }
}

// ───────────────────── 潜能独立特效（v5 程序化导出） ─────────────────────

export interface PotentialFxHandle {
  readonly group: THREE.Group
  readonly duration: number
  /** 手动推进一帧（用于离线测试/预览）；返回 true 表示仍在播放 */
  update(dt: number): boolean
  /** 立即移出场景并释放本次实例材质 */
  dispose(): void
}

interface ActivePotentialFx {
  update(dt: number): boolean
}

const activePotentialFx = new Set<ActivePotentialFx>()
let potentialFxRaf = 0
let potentialFxLastMs = 0

function drivePotentialFx(nowMs: number): void {
  const dt = potentialFxLastMs > 0 ? Math.min(0.05, Math.max(0.001, (nowMs - potentialFxLastMs) / 1000)) : 1 / 60
  potentialFxLastMs = nowMs
  for (const fx of [...activePotentialFx]) {
    if (!fx.update(dt)) activePotentialFx.delete(fx)
  }
  if (activePotentialFx.size > 0 && typeof requestAnimationFrame === 'function') {
    potentialFxRaf = requestAnimationFrame(drivePotentialFx)
  } else {
    potentialFxRaf = 0
    potentialFxLastMs = 0
  }
}

function registerPotentialFx(fx: ActivePotentialFx): void {
  if (typeof requestAnimationFrame !== 'function') return
  activePotentialFx.add(fx)
  if (!potentialFxRaf) {
    potentialFxLastMs = 0
    potentialFxRaf = requestAnimationFrame(drivePotentialFx)
  }
}

/** 共用轻量几何体缓存，避免频繁创建销毁 */
let sharedDropGeo: THREE.CircleGeometry | null = null
let sharedDiamondTex: THREE.DataTexture | null = null
let sharedRingTex: THREE.DataTexture | null = null
let sharedShieldArcGeo: THREE.CylinderGeometry | null = null
const sharedBadgeTexCache = new Map<string, THREE.DataTexture>()

function makeDataTex(size: number, paint: (x: number, y: number, buf: Uint8Array, idx: number) => void): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      paint(x, y, data, (y * size + x) * 4)
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

function diamondTexture(): THREE.DataTexture {
  if (sharedDiamondTex) return sharedDiamondTex
  sharedDiamondTex = makeDataTex(16, (x, y, buf, idx) => {
    const cx = Math.abs(x - 7.5)
    const cy = Math.abs(y - 7.5)
    const d = cx + cy
    if (d <= 6.2) {
      const core = d <= 2.6
      buf[idx] = 255
      buf[idx + 1] = core ? 240 : 168
      buf[idx + 2] = core ? 175 : 46
      buf[idx + 3] = d <= 5.2 ? 255 : 180
    }
  })
  return sharedDiamondTex
}

function beatPulseTexture(): THREE.DataTexture {
  if (sharedRingTex) return sharedRingTex
  sharedRingTex = makeDataTex(32, (x, y, buf, idx) => {
    const d = Math.hypot(x - 15.5, y - 15.5)
    if (d >= 11.2 && d <= 14.2) {
      const peak = 1 - Math.abs(d - 12.7) / 1.6
      buf[idx] = 255
      buf[idx + 1] = 255
      buf[idx + 2] = 255
      buf[idx + 3] = Math.round(Math.max(0, Math.min(1, peak)) * 255)
    }
  })
  return sharedRingTex
}

export interface ResonanceBadgeColors {
  primary: [number, number, number]
  secondary: [number, number, number]
  rim: [number, number, number]
}

const RESONANCE_PALETTES: Record<string, ResonanceBadgeColors> = {
  // 丛雨三组跨枝反应
  'murasame-res-bleed-mark': { primary: [224, 58, 82], secondary: [255, 158, 59], rim: [255, 224, 168] },
  'murasame-res-bleed-charge': { primary: [224, 58, 82], secondary: [124, 232, 255], rim: [232, 250, 255] },
  'murasame-res-mark-charge': { primary: [255, 158, 59], secondary: [255, 229, 143], rim: [255, 248, 214] },
  // 大肥鱼三组跨枝反应
  'fish-res-clone-swarm': { primary: [110, 226, 255], secondary: [255, 209, 102], rim: [236, 252, 255] },
  'fish-res-clone-bubble': { primary: [110, 226, 255], secondary: [255, 133, 192], rim: [255, 230, 244] },
  'fish-res-swarm-bubble': { primary: [92, 242, 214], secondary: [140, 158, 255], rim: [224, 246, 255] },
  // 若叶睦三组跨枝反应
  'mutsumi-res-rhythm-symphony': { primary: [255, 212, 121], secondary: [201, 168, 255], rim: [255, 244, 214] },
  'mutsumi-res-rhythm-duet': { primary: [255, 212, 121], secondary: [255, 107, 158], rim: [255, 230, 238] },
  'mutsumi-res-symphony-duet': { primary: [201, 168, 255], secondary: [118, 242, 228], rim: [236, 252, 250] },
}

const FALLBACK_COMBO_SETS: Record<CharacterId, readonly [ResonanceBadgeColors, ResonanceBadgeColors, ResonanceBadgeColors]> = {
  murasame: [
    RESONANCE_PALETTES['murasame-res-bleed-mark'],
    RESONANCE_PALETTES['murasame-res-bleed-charge'],
    RESONANCE_PALETTES['murasame-res-mark-charge'],
  ],
  fish: [
    RESONANCE_PALETTES['fish-res-clone-swarm'],
    RESONANCE_PALETTES['fish-res-clone-bubble'],
    RESONANCE_PALETTES['fish-res-swarm-bubble'],
  ],
  mutsumi: [
    RESONANCE_PALETTES['mutsumi-res-rhythm-symphony'],
    RESONANCE_PALETTES['mutsumi-res-rhythm-duet'],
    RESONANCE_PALETTES['mutsumi-res-symphony-duet'],
  ],
}

/** 供预览脚本与徽章贴图共用的三组配色解析 */
export function resonanceBadgePalette(charId: CharacterId, comboId: string): ResonanceBadgeColors {
  const direct = RESONANCE_PALETTES[comboId]
  if (direct) return direct
  const presets = FALLBACK_COMBO_SETS[charId] ?? FALLBACK_COMBO_SETS.mutsumi
  let hash = 0
  for (let i = 0; i < comboId.length; i += 1) hash = (hash * 31 + comboId.charCodeAt(i)) >>> 0
  return presets[hash % 3]
}

/** 生成 32×32 像素风「两分支图标交叠」RGBA 像素数据（可供预览脚本直接读取） */
export function buildResonanceBadgePixels(charId: CharacterId, comboId: string): Uint8Array {
  const pal = resonanceBadgePalette(charId, comboId)
  const size = 32
  const data = new Uint8Array(size * size * 4)
  const set = (x: number, y: number, r: number, g: number, b: number, a = 255): void => {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const idx = (y * size + x) * 4
    data[idx] = r
    data[idx + 1] = g
    data[idx + 2] = b
    data[idx + 3] = a
  }
  const [r1, g1, b1] = pal.primary
  const [r2, g2, b2] = pal.secondary
  const [rr, gr, br] = pal.rim

  // 左圆徽章（分支 A）+ 右圆徽章（分支 B）交叠，交汇处高亮白金缝线
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d1 = Math.hypot(x - 11.5, y - 15.5)
      const d2 = Math.hypot(x - 19.5, y - 15.5)
      const in1 = d1 <= 9.2
      const in2 = d2 <= 9.2
      if (!in1 && !in2) continue
      const rim1 = Math.abs(d1 - 8.4) <= 1.05
      const rim2 = Math.abs(d2 - 8.4) <= 1.05
      if (in1 && in2) {
        // 交叠中心：双色融合 + 亮芯
        const core = Math.abs(x - 15.5) <= 1.2 && Math.abs(y - 15.5) <= 5.5
        if (core) set(x, y, rr, gr, br, 255)
        else set(x, y, Math.min(255, Math.round((r1 + r2) * 0.55)), Math.min(255, Math.round((g1 + g2) * 0.55)), Math.min(255, Math.round((b1 + b2) * 0.55)), 250)
      } else if (in1) {
        if (rim1) set(x, y, rr, gr, br, 245)
        else set(x, y, r1, g1, b1, 230)
      } else if (in2) {
        if (rim2) set(x, y, rr, gr, br, 245)
        else set(x, y, r2, g2, b2, 230)
      }
    }
  }
  // 角色语言小刻纹：丛雨=斜刃 / 鱼=双泡 / 睦=菱形拍点
  if (charId === 'murasame') {
    for (let i = -4; i <= 4; i += 1) set(15 + i, 15 - i, 255, 252, 240, 255)
  } else if (charId === 'fish') {
    for (const [cx, cy] of [[10, 14], [21, 16]] as const) {
      set(cx, cy, 245, 255, 255, 255)
      set(cx + 1, cy, 245, 255, 255, 220)
      set(cx, cy + 1, 245, 255, 255, 220)
    }
  } else {
    for (let dy = -3; dy <= 3; dy += 1) {
      for (let dx = -3; dx <= 3; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) === 3) set(15 + dx, 15 + dy, 255, 248, 220, 255)
      }
    }
  }
  return data
}

/**
 * 1. 流血 tick 特效（流殇分支）：
 *    仅生成 2~3 颗暗红小血滴贴地溅落（0.25s），严格克制粒子量，
 *    避免一局数百跳流血把战斗画面糊成一团。
 */
export function fxBloodTick(scene: THREE.Scene, x: number, z: number): PotentialFxHandle {
  const duration = 0.25
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  if (!sharedDropGeo) {
    sharedDropGeo = new THREE.CircleGeometry(1, 8)
    sharedDropGeo.rotateX(-Math.PI / 2)
  }

  const count = Math.random() < 0.5 ? 2 : 3
  const drops: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; vx: number; vy: number; vz: number; size: number }[] = []
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * TAU + rand(-0.55, 0.55)
    const speed = rand(0.55, 1.15)
    const size = rand(0.055, 0.085)
    const mat = new THREE.MeshBasicMaterial({
      color: i === 0 ? 0xa8162a : 0x7c0f1e,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(sharedDropGeo, mat)
    mesh.position.set(0, rand(0.14, 0.24), 0)
    mesh.scale.setScalar(size)
    group.add(mesh)
    drops.push({ mesh, mat, vx: Math.cos(angle) * speed, vy: rand(0.45, 0.85), vz: Math.sin(angle) * speed, size })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      for (const d of drops) {
        d.vy -= 5.2 * dt
        d.mesh.position.x += d.vx * dt
        d.mesh.position.y = Math.max(0.035, d.mesh.position.y + d.vy * dt)
        d.mesh.position.z += d.vz * dt
        d.mat.opacity = 0.9 * (1 - k * k)
        d.mesh.scale.setScalar(d.size * (1 - k * 0.35))
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      for (const d of drops) d.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 2. 剑意标记特效（剑意分支）：
 *    在目标头顶横排亮出 1~3 枚橙色小菱形（严格对应当前层数），
 *    挂出瞬间做一次短促放大闪烁，便于玩家一眼读出可结算层数。
 */
export function fxMarkStack(scene: THREE.Scene, x: number, z: number, stacks: number): PotentialFxHandle {
  const duration = 0.65
  const count = Math.max(1, Math.min(3, Math.round(stacks)))
  const group = new THREE.Group()
  group.position.set(x, 1.62, z)
  scene.add(group)

  const tex = diamondTexture()
  const sprites: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; baseX: number }[] = []
  const spacing = 0.28
  for (let i = 0; i < count; i += 1) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: i === count - 1 ? 0xffb347 : 0xff8c24,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sprite = new THREE.Sprite(mat)
    const baseX = (i - (count - 1) * 0.5) * spacing
    sprite.position.set(baseX, 0, 0)
    sprite.scale.setScalar(0.32)
    group.add(sprite)
    sprites.push({ sprite, mat, baseX })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      // 前 18% 时间闪亮放大，随后稳定回落并渐隐
      const flash = k < 0.18 ? 1 + Math.sin((k / 0.18) * Math.PI) * 0.45 : 1
      const fade = k > 0.7 ? (1 - k) / 0.3 : 1
      for (const s of sprites) {
        s.sprite.scale.setScalar(0.24 * flash)
        s.sprite.position.set(s.baseX, Math.sin(age * 8) * 0.025, 0)
        s.mat.opacity = Math.max(0, Math.min(1, fade))
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      for (const s of sprites) s.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 3. 丛雨 F 格挡盾光：
 *    在角色面朝方向 0.75m 处展开一道 0.8s 的弧形青白盾光，
 *    边缘带高频微抖动感，明确传达「可弹反/减伤」的防护窗口。
 */
export function fxBlockShield(scene: THREE.Scene, x: number, z: number, facing: number): PotentialFxHandle {
  const duration = 0.8
  const group = new THREE.Group()
  group.position.set(x, 0.72, z)
  group.rotation.y = facing
  scene.add(group)

  if (!sharedShieldArcGeo) {
    // 100° 弧面盾片（面朝本地 +Z）
    sharedShieldArcGeo = new THREE.CylinderGeometry(0.85, 0.85, 0.95, 16, 1, true, -Math.PI * 0.28, Math.PI * 0.56)
  }

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0x8ef5ff,
    transparent: true,
    opacity: 0.42,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const rimMat = new THREE.MeshBasicMaterial({
    color: 0xeaffff,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    wireframe: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const coreMesh = new THREE.Mesh(sharedShieldArcGeo, coreMat)
  const rimMesh = new THREE.Mesh(sharedShieldArcGeo, rimMat)
  rimMesh.scale.set(1.03, 1.02, 1.03)
  group.add(coreMesh, rimMesh)

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      const intro = Math.min(1, age / 0.08)
      const outro = k > 0.78 ? (1 - k) / 0.22 : 1
      const jitter = Math.sin(age * 52) * 0.025 + Math.cos(age * 37) * 0.015
      coreMesh.scale.set(intro, 0.85 + intro * 0.15, intro)
      rimMesh.scale.set((1.03 + jitter) * intro, 1.02 + jitter * 0.6, (1.03 - jitter) * intro)
      coreMat.opacity = 0.42 * intro * outro
      rimMat.opacity = (0.68 + Math.sin(age * 44) * 0.12) * intro * outro
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      coreMat.dispose()
      rimMat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 4. 大肥鱼 Q 回收水线：
 *    count 道青蓝细水线从玩家四周（约 2.5m 处）沿微弧线汇向玩家中心（0.4s），
 *    呈现召唤物化水回流、兑换金币的收束感。
 */
export function fxRecallWater(scene: THREE.Scene, x: number, z: number, count: number): PotentialFxHandle {
  const duration = 0.4
  const n = Math.max(1, Math.min(12, Math.round(count)))
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  const streams: {
    line: THREE.Line
    geo: THREE.BufferGeometry
    mat: THREE.LineBasicMaterial
    startAngle: number
    startDist: number
    swirl: number
  }[] = []

  const segs = 10
  for (let i = 0; i < n; i += 1) {
    const startAngle = (i / n) * TAU + rand(-0.22, 0.22)
    const startDist = rand(2.1, 2.9)
    const swirl = (i % 2 === 0 ? 1 : -1) * rand(0.32, 0.55)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segs + 1) * 3), 3))
    const mat = new THREE.LineBasicMaterial({
      color: i % 2 === 0 ? 0x5ae2ff : 0xaef6ff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const line = new THREE.Line(geo, mat)
    group.add(line)
    streams.push({ line, geo, mat, startAngle, startDist, swirl })
  }

  let age = 0
  let disposed = false
  const updateStreams = (k: number): void => {
    const head = Math.min(1, k * 1.15)
    const tail = Math.max(0, k * 1.15 - 0.52)
    for (const st of streams) {
      const pos = st.geo.getAttribute('position') as THREE.BufferAttribute
      for (let j = 0; j <= segs; j += 1) {
        const u = tail + (head - tail) * (j / segs)
        const r = st.startDist * (1 - u)
        const a = st.startAngle + st.swirl * u
        const y = 0.22 + Math.sin(u * Math.PI) * 0.42 + u * 0.24
        pos.setXYZ(j, Math.cos(a) * r, y, Math.sin(a) * r)
      }
      pos.needsUpdate = true
      st.mat.opacity = Math.max(0, 0.92 * (1 - k * 0.85))
    }
  }
  updateStreams(0.05)

  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      updateStreams(age / duration)
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      for (const st of streams) {
        st.geo.dispose()
        st.mat.dispose()
      }
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 5. 若叶睦 F 强拍窗口脉冲：
 *    脚下 0.5s 贴地双环节拍脉冲（冰蓝外环收缩 + 暖金内环亮闪），
 *    与现有 HUD beat ring 保持统一视觉语言。
 */
export function fxStrongBeat(scene: THREE.Scene, x: number, z: number): PotentialFxHandle {
  const duration = 0.5
  const group = new THREE.Group()
  group.position.set(x, 0.055, z)
  scene.add(group)

  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const tex = beatPulseTexture()
  const outerMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0x9fd8ff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const innerMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xffd479,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const outer = new THREE.Mesh(geo, outerMat)
  const inner = new THREE.Mesh(geo, innerMat)
  inner.position.y = 0.004
  outer.scale.setScalar(2.4)
  inner.scale.setScalar(1.35)
  group.add(outer, inner)

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      // 外环随 0.5s 窗口向脚下收紧，内环做一次脉冲扩散
      const outerScale = 2.4 - k * 1.25
      const innerScale = 1.1 + Math.sin(k * Math.PI) * 0.7
      outer.scale.setScalar(outerScale)
      inner.scale.setScalar(innerScale)
      outerMat.opacity = 0.88 * (1 - k * 0.75)
      innerMat.opacity = 0.95 * Math.pow(1 - k, 1.3)
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      geo.dispose()
      outerMat.dispose()
      innerMat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 6. 跨枝反应常驻标识徽章：
 *    采用与 characterFx 一致的 Sprite billboard 手法，绘制两分支图标交叠的 32×32 像素徽章，
 *    按 comboId 区分三组专属配色，供调用方挂在血条下方跟随显示。
 */
export function fxResonanceBadge(scene: THREE.Scene, charId: CharacterId, comboId: string): THREE.Sprite {
  const cacheKey = `${charId}:${comboId}`
  let tex = sharedBadgeTexCache.get(cacheKey)
  if (!tex) {
    const pixels = buildResonanceBadgePixels(charId, comboId)
    tex = new THREE.DataTexture(pixels, 32, 32, THREE.RGBAFormat)
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.flipY = true
    tex.needsUpdate = true
    sharedBadgeTexCache.set(cacheKey, tex)
  }
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  })
  const sprite = new THREE.Sprite(mat)
  sprite.scale.set(0.56, 0.56, 1)
  sprite.position.set(0, 1.35, 0)
  sprite.userData = { charId, comboId }
  scene.add(sprite)
  return sprite
}

/**
 * 7. 丛雨 Q 处决特效（fxExecute）：
 *    赤红竖斩光自上而下劈落 + 地面赤红斩痕环 + 10 枚金色碎片四散（~0.4s），
 *    强化命中残血目标瞬间的「一刀两断」斩杀感。
 */
export function fxExecute(scene: THREE.Scene, x: number, z: number): PotentialFxHandle {
  const duration = 0.4
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  const bladeGeo = new THREE.PlaneGeometry(0.32, 3.2)
  const bladeMat = new THREE.MeshBasicMaterial({
    color: 0xe61e36,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const blade = new THREE.Mesh(bladeGeo, bladeMat)
  blade.position.set(0, 2.3, 0)
  blade.rotation.z = 0.16
  group.add(blade)

  const coreGeo = new THREE.PlaneGeometry(0.11, 3.0)
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xffe9b5,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const core = new THREE.Mesh(coreGeo, coreMat)
  core.position.set(0, 2.3, 0.02)
  core.rotation.z = 0.16
  group.add(core)

  const ringGeo = new THREE.PlaneGeometry(1, 1)
  ringGeo.rotateX(-Math.PI / 2)
  const ringMat = new THREE.MeshBasicMaterial({
    map: beatPulseTexture(),
    color: 0xff3b52,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const ring = new THREE.Mesh(ringGeo, ringMat)
  ring.position.y = 0.05
  ring.scale.setScalar(0.5)
  group.add(ring)

  const shardTex = diamondTexture()
  const shards: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; vx: number; vy: number; vz: number; size: number }[] = []
  const shardCount = 10
  for (let i = 0; i < shardCount; i += 1) {
    const ang = (i / shardCount) * TAU + (i % 2 ? 0.18 : -0.14)
    const spd = 2.0 + (i % 4) * 0.75
    const size = 0.2 + (i % 3) * 0.055
    const mat = new THREE.SpriteMaterial({
      map: shardTex,
      color: i % 3 === 0 ? 0xfff0b3 : 0xffc84a,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(0, 0.85, 0)
    sprite.scale.setScalar(size)
    group.add(sprite)
    shards.push({
      sprite,
      mat,
      vx: Math.cos(ang) * spd,
      vy: 1.5 + (i % 3) * 0.75,
      vz: Math.sin(ang) * spd,
      size,
    })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      const slam = Math.min(1, k / 0.32)
      const bladeY = 2.4 - slam * 1.15
      const bladeFade = k < 0.32 ? 1 : Math.max(0, 1 - (k - 0.32) / 0.68)
      blade.position.y = bladeY
      blade.scale.set(1 + (1 - slam) * 0.35, 0.85 + slam * 0.3, 1)
      bladeMat.opacity = 0.96 * bladeFade
      core.position.y = bladeY
      core.scale.set(1, 0.85 + slam * 0.3, 1)
      coreMat.opacity = 0.98 * bladeFade * bladeFade

      ring.scale.setScalar(0.5 + k * 2.1)
      ringMat.opacity = 0.88 * (1 - k * k)

      for (const s of shards) {
        s.vy -= 5.4 * dt
        s.sprite.position.x += s.vx * dt
        s.sprite.position.y = Math.max(0.06, s.sprite.position.y + s.vy * dt)
        s.sprite.position.z += s.vz * dt
        s.sprite.scale.setScalar(s.size * (1 - k * 0.45))
        s.mat.opacity = 1 - k * k
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      bladeGeo.dispose()
      bladeMat.dispose()
      coreGeo.dispose()
      coreMat.dispose()
      ringGeo.dispose()
      ringMat.dispose()
      for (const s of shards) s.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 8. 丛雨 F 完美格挡特效（fxBlockParry）：
 *    青白盾面碎裂飞散 + 一道从玩家指向攻击者方向的青白残影拖尾（~0.35s），
 *    清晰提示「完美格挡反身突进」的指向与瞬间反馈。
 */
export function fxBlockParry(
  scene: THREE.Scene,
  x: number,
  z: number,
  fromX: number,
  fromZ: number,
): PotentialFxHandle {
  const duration = 0.35
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  const rawDx = fromX - x
  const rawDz = fromZ - z
  const len = Math.hypot(rawDx, rawDz)
  const dx = len > 1e-4 ? rawDx / len : 0
  const dz = len > 1e-4 ? rawDz / len : -1
  const px = -dz
  const pz = dx
  const yaw = Math.atan2(dx, dz)

  // 青白盾面碎裂片（6 块围绕盾面飞散）
  const shardGeo = new THREE.PlaneGeometry(0.28, 0.22)
  const shards: {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    vx: number
    vy: number
    vz: number
    spin: number
  }[] = []
  for (let i = 0; i < 6; i += 1) {
    const side = (i - 2.5) * 0.26
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xa8f6ff : 0xeefeff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(shardGeo, mat)
    mesh.position.set(dx * 0.8 + px * side, 0.85 + (i % 3 - 1) * 0.22, dz * 0.8 + pz * side)
    mesh.rotation.y = yaw
    mesh.rotation.z = (i - 2.5) * 0.35
    group.add(mesh)
    shards.push({
      mesh,
      mat,
      vx: dx * (1.2 + (i % 2) * 0.8) + px * side * 4.5,
      vy: (i % 3 - 1) * 1.4 + 0.6,
      vz: dz * (1.2 + (i % 2) * 0.8) + pz * side * 4.5,
      spin: (i % 2 === 0 ? 1 : -1) * 8.5,
    })
  }

  // 指向攻击者方向的青白残影拖尾（4 段加速伸展）
  const streakGeo = new THREE.PlaneGeometry(0.22, 0.95)
  streakGeo.rotateX(-Math.PI / 2)
  const streaks: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; baseDist: number }[] = []
  for (let i = 0; i < 4; i += 1) {
    const mat = new THREE.MeshBasicMaterial({
      color: i === 3 ? 0xffffff : 0x7beeff,
      transparent: true,
      opacity: 0.88 - i * 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(streakGeo, mat)
    const baseDist = 0.45 + i * 0.52
    mesh.position.set(dx * baseDist, 0.72 + i * 0.04, dz * baseDist)
    mesh.rotation.y = yaw
    group.add(mesh)
    streaks.push({ mesh, mat, baseDist })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      const fade = 1 - k * k
      for (const s of shards) {
        s.vy -= 4.2 * dt
        s.mesh.position.x += s.vx * dt
        s.mesh.position.y = Math.max(0.08, s.mesh.position.y + s.vy * dt)
        s.mesh.position.z += s.vz * dt
        s.mesh.rotation.z += s.spin * dt
        s.mesh.scale.setScalar(1 - k * 0.45)
        s.mat.opacity = 0.95 * fade
      }
      for (let i = 0; i < streaks.length; i += 1) {
        const st = streaks[i]
        const dist = st.baseDist + k * (1.2 + i * 0.35)
        st.mesh.position.set(dx * dist, 0.72, dz * dist)
        st.mesh.scale.set(1 - k * 0.5, 1, 1 + k * 0.9)
        st.mat.opacity = (0.88 - i * 0.12) * fade
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      shardGeo.dispose()
      streakGeo.dispose()
      for (const s of shards) s.mat.dispose()
      for (const st of streaks) st.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 9. 鱼 F 水枪扫射特效（fxWatergun）：
 *    扇形青蓝水幕 + 24 道沿喷射方向持续推进的高速水柱粒子（默认 10s，按 duration 参数化），
 *    强调水流的动态喷射与扇面覆盖，避免静态贴图观感。
 */
export function fxWatergun(
  scene: THREE.Scene,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  duration = 10,
): PotentialFxHandle {
  const safeDuration = Math.max(0.2, duration)
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  const len = Math.hypot(dirX, dirZ)
  const dx = len > 1e-4 ? dirX / len : 0
  const dz = len > 1e-4 ? dirZ / len : -1
  const baseAngle = Math.atan2(dz, dx)

  // 扇形水幕底光（3 层细长半透明扇骨随水流脉动）
  const fanGeo = new THREE.PlaneGeometry(0.55, 4.6)
  fanGeo.rotateX(-Math.PI / 2)
  const fans: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; offset: number }[] = []
  for (const offset of [-0.26, 0, 0.26]) {
    const mat = new THREE.MeshBasicMaterial({
      color: offset === 0 ? 0x62e6ff : 0x26b6ea,
      transparent: true,
      opacity: offset === 0 ? 0.34 : 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(fanGeo, mat)
    const ang = baseAngle + offset
    mesh.position.set(Math.cos(ang) * 2.6, 0.55, Math.sin(ang) * 2.6)
    mesh.rotation.y = Math.atan2(Math.cos(ang), Math.sin(ang))
    group.add(mesh)
    fans.push({ mesh, mat, offset })
  }

  // 24 颗沿扇面高速推进的水流粒子（循环推进产生流动感）
  const dropGeo = new THREE.PlaneGeometry(0.18, 0.52)
  dropGeo.rotateX(-Math.PI / 2)
  const drops: {
    mesh: THREE.Mesh
    mat: THREE.MeshBasicMaterial
    spread: number
    phase: number
    speed: number
    height: number
  }[] = []
  const dropCount = 24
  for (let i = 0; i < dropCount; i += 1) {
    const spread = ((i % 9) / 8 - 0.5) * 0.72
    const phase = (i / dropCount) + ((i % 3) * 0.07)
    const speed = 1.9 + (i % 5) * 0.28
    const mat = new THREE.MeshBasicMaterial({
      color: i % 3 === 0 ? 0xd8fbff : i % 2 === 0 ? 0x5be3ff : 0x25a9e6,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(dropGeo, mat)
    group.add(mesh)
    drops.push({ mesh, mat, spread, phase, speed, height: 0.45 + (i % 4) * 0.14 })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration: safeDuration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= safeDuration) {
        handle.dispose()
        return false
      }
      const env = age < 0.12 ? age / 0.12 : age > safeDuration - 0.25 ? Math.max(0, (safeDuration - age) / 0.25) : 1
      for (const f of fans) {
        const wave = 0.88 + 0.18 * Math.sin(age * 18 + f.offset * 6)
        f.mat.opacity = (f.offset === 0 ? 0.34 : 0.22) * wave * env
        f.mesh.scale.set(0.92 + 0.14 * Math.sin(age * 14 + f.offset), 1, wave)
      }
      for (let i = 0; i < drops.length; i += 1) {
        const d = drops[i]
        const t = (age * d.speed + d.phase) % 1
        const ang = baseAngle + d.spread * (0.45 + t * 0.55)
        const dist = 0.55 + t * 4.85
        d.mesh.position.set(Math.cos(ang) * dist, d.height + Math.sin(t * Math.PI) * 0.22, Math.sin(ang) * dist)
        d.mesh.rotation.y = Math.atan2(Math.cos(ang), Math.sin(ang))
        d.mesh.scale.set(0.75 + t * 0.65, 1, 0.8 + (1 - t) * 0.7)
        d.mat.opacity = Math.sin(t * Math.PI) * 0.92 * env
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      fanGeo.dispose()
      dropGeo.dispose()
      for (const f of fans) f.mat.dispose()
      for (const d of drops) d.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}

/**
 * 10. 60 连击爆裂特效（fxComboBurst）：
 *     双层金色环爆扩散 + 12 枚星点向上冲起闪烁（~0.5s），
 *     视觉上突出达成高连击时的强奖励感与节庆氛围。
 */
export function fxComboBurst(scene: THREE.Scene, x: number, z: number): PotentialFxHandle {
  const duration = 0.5
  const group = new THREE.Group()
  group.position.set(x, 0, z)
  scene.add(group)

  const ringGeo = new THREE.PlaneGeometry(1, 1)
  ringGeo.rotateX(-Math.PI / 2)
  const tex = beatPulseTexture()

  const outerMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xffd479,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const outer = new THREE.Mesh(ringGeo, outerMat)
  outer.position.y = 0.055
  outer.scale.setScalar(0.55)
  group.add(outer)

  const innerMat = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const inner = new THREE.Mesh(ringGeo, innerMat)
  inner.position.y = 0.075
  inner.scale.setScalar(0.35)
  group.add(inner)

  const starTex = diamondTexture()
  const stars: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; vx: number; vy: number; vz: number; size: number; phase: number }[] = []
  const starCount = 12
  for (let i = 0; i < starCount; i += 1) {
    const ang = (i / starCount) * TAU
    const radial = 0.9 + (i % 3) * 0.55
    const size = 0.24 + (i % 3) * 0.06
    const mat = new THREE.SpriteMaterial({
      map: starTex,
      color: i % 4 === 0 ? 0xff9fd0 : i % 2 === 0 ? 0xffd479 : 0xfff6c8,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.position.set(Math.cos(ang) * 0.35, 0.25, Math.sin(ang) * 0.35)
    sprite.scale.setScalar(size)
    group.add(sprite)
    stars.push({
      sprite,
      mat,
      vx: Math.cos(ang) * radial,
      vy: 3.4 + (i % 4) * 0.75,
      vz: Math.sin(ang) * radial,
      size,
      phase: i * 0.9,
    })
  }

  let age = 0
  let disposed = false
  const handle: PotentialFxHandle = {
    group,
    duration,
    update(dt: number): boolean {
      if (disposed) return false
      age += dt
      if (age >= duration) {
        handle.dispose()
        return false
      }
      const k = age / duration
      const easeOut = 1 - (1 - k) * (1 - k)
      outer.scale.setScalar(0.55 + easeOut * 3.0)
      outerMat.opacity = 0.96 * (1 - k)
      inner.scale.setScalar(0.35 + easeOut * 2.15)
      innerMat.opacity = 0.92 * Math.max(0, 1 - k * 1.1)

      for (const s of stars) {
        s.vy -= 2.6 * dt
        s.sprite.position.x += s.vx * dt
        s.sprite.position.y += s.vy * dt
        s.sprite.position.z += s.vz * dt
        const twinkle = 0.8 + 0.35 * Math.sin(age * 28 + s.phase)
        s.sprite.scale.setScalar(s.size * twinkle * (1 - k * 0.35))
        s.mat.opacity = 1 - k * k
      }
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      activePotentialFx.delete(handle)
      ringGeo.dispose()
      outerMat.dispose()
      innerMat.dispose()
      for (const s of stars) s.mat.dispose()
      scene.remove(group)
    },
  }
  registerPotentialFx(handle)
  return handle
}
