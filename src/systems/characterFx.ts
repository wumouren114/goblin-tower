import * as THREE from 'three'
import { fxTexture, type FxTextureKind } from '../art/fxTextures'
import { particleTexture } from '../art/sprites'
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
  sprite: THREE.Sprite
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
  spin: number
  active: boolean
}

interface GroundFx {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
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

/** 贴地平面的「上方」映射到本地 -Z；让纹理正面朝 dir。 */
function groundYaw(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, -dirZ)
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export class CharacterFx {
  private readonly scene: THREE.Scene
  private readonly particles: FxParticle[] = []
  private readonly grounds: GroundFx[] = []
  private readonly groundGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
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
      const mat = new THREE.SpriteMaterial({
        map: fxTexture('note'),
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        color: 0xffffff,
      })
      const sprite = new THREE.Sprite(mat)
      sprite.visible = false
      sprite.frustumCulled = false
      sprite.renderOrder = 7
      scene.add(sprite)
      this.particles.push({
        sprite,
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
        spin: 0,
        active: false,
      })
    }

    for (let i = 0; i < 30; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: fxTexture('slash'),
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        color: 0xffffff,
        side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(this.groundGeometry, mat)
      mesh.visible = false
      mesh.renderOrder = 5
      scene.add(mesh)
      this.grounds.push({
        mesh,
        mat,
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
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      if (!p.active) continue
      p.life -= dt
      if (p.life <= 0) {
        p.active = false
        p.sprite.visible = false
        continue
      }
      const t = Math.max(0, p.life / p.maxLife)
      const drag = Math.exp(-p.drag * dt)
      p.vx *= drag
      p.vz *= drag
      p.vy += p.gravity * dt
      p.sprite.position.x += p.vx * dt
      p.sprite.position.y += p.vy * dt
      p.sprite.position.z += p.vz * dt
      if (p.sprite.position.y < 0.045) {
        p.sprite.position.y = 0.045
        p.vy *= -0.18
      }
      const size = p.size1 + (p.size0 - p.size1) * t
      p.sprite.scale.setScalar(Math.max(0.001, size))
      p.sprite.material.rotation += p.spin * dt
      p.sprite.material.opacity = p.opacity * Math.min(1, t * 3.4)
    }
  }

  private updateGrounds(dt: number): void {
    for (const g of this.grounds) {
      if (!g.active) continue
      if (g.delay > 0) {
        g.delay -= dt
        if (g.delay > 0) {
          g.mesh.visible = false
          continue
        }
        g.mesh.visible = true
      }
      g.life -= dt
      if (g.life <= 0) {
        g.active = false
        g.mesh.visible = false
        continue
      }
      const t = 1 - Math.max(0, g.life) / g.maxLife
      const ease = 1 - Math.pow(1 - t, 2.2)
      const w = g.startW + (g.endW - g.startW) * ease
      const l = g.startL + (g.endL - g.startL) * ease
      g.mesh.scale.set(w, 1, l)
      g.mesh.rotation.y = g.yaw + g.spin * t
      g.mat.opacity = g.startOpacity + (g.endOpacity - g.startOpacity) * t
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
    const mat = p.sprite.material as THREE.SpriteMaterial
    mat.map = spriteTexture(kind)
    mat.color.setHex(color)
    mat.opacity = opts.opacity ?? 1
    mat.rotation = opts.rotation ?? rand(0, TAU)
    p.sprite.position.set(x, y, z)
    p.sprite.scale.setScalar(Math.max(0.001, size))
    p.sprite.visible = true
    p.vx = opts.vx ?? 0
    p.vy = opts.vy ?? 0
    p.vz = opts.vz ?? 0
    p.gravity = opts.gravity ?? 0
    p.drag = opts.drag ?? 2
    p.life = p.maxLife = opts.life ?? 0.45
    p.size0 = size
    p.size1 = opts.size1 ?? size * 0.12
    p.opacity = opts.opacity ?? 1
    p.spin = opts.spin ?? 0
    p.active = true
  }

  private ground(kind: FxTextureKind, x: number, z: number, opts: GroundOpts): void {
    const g = this.grounds[this.groundIndex]
    this.groundIndex = (this.groundIndex + 1) % this.grounds.length
    const length = opts.length ?? opts.width
    const startScale = opts.startScale ?? 1
    const endScale = opts.endScale ?? 1.05
    g.mat.map = fxTexture(kind)
    g.mat.color.setHex(opts.color)
    g.mat.opacity = opts.opacity ?? 0.9
    g.mat.needsUpdate = true
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
    g.mesh.position.set(x, opts.y ?? 0.06, z)
    g.mesh.rotation.set(0, g.yaw, 0)
    g.mesh.scale.set(g.startW, 1, g.startL)
    g.mesh.visible = g.delay <= 0
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
      p.sprite.visible = false
    }
    for (const g of this.grounds) {
      g.active = false
      g.mesh.visible = false
    }
    this.auraKey = ''
  }

  dispose(): void {
    for (const p of this.particles) {
      this.scene.remove(p.sprite)
      p.sprite.material.dispose()
    }
    this.particles.length = 0
    for (const g of this.grounds) {
      this.scene.remove(g.mesh)
      g.mat.dispose()
    }
    this.grounds.length = 0
    this.groundGeometry.dispose()

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
    this.scene.remove(this.aura)
  }
}
