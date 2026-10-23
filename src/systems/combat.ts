import * as THREE from 'three'
import type { CharacterId, PlayerStats } from '../types'
import {
  CHARACTERS,
  CHARGE_PER_KILL,
  attackInterval,
  hitDamage,
  skillRange,
} from '../data/characters'
import { BASE_STATS } from '../data/gameConfig'
import { getWeaponTier, tierNum, MAX_WEAPON_LV, type WeaponTier } from '../data/characterRuntime'
import { rng } from '../core/rng'
import { ChargeMeter } from './charge'
import { ProjectileSystem, type ProjectileBurstContext, type ProjectileHitContext } from './projectiles'
import { MinionSystem, type Minion } from './minions'
import { CharacterFx } from './characterFx'
import { getBillboardYaw } from '../art/sprites'
import { createProjectileMesh, disposeProjectileArt } from '../art/projectiles'
import { disposeMinionArt } from '../art/minions'
import { pickConeTargets, pickLineTargets, gatherTo, pullToward } from './attack'
import {
  awakeningLevel,
  defaultStyle,
  styleForCharacter,
  type AwakeningId,
  type StyleDef,
  type StyleId,
} from '../data/awakenings'

/**
 * ============================================================
 *  v3 战斗系统门面（契约 docs/05 §2）
 *  - 只有这里应用伤害公式：伤害 = 武器基础伤害 * 魔力/100，
 *    范围 = 基础范围 * 智力/100，间隔 = max(minInterval, 0.55*100/耐力)
 *  - 面板只认 setStats()；modifiers 由 game.ts 乘进面板，本类不再乘
 *  - 击杀结算（金币/掉落/音效）不在这里，onKill 只加充能
 * ============================================================
 */

/** 可被命中的目标（哥布林 / boss / 召唤物都实现它） */
export interface Hittable {
  x: number
  z: number
  radius: number
  alive: boolean
  /** 返回：这一下是否把它打死了 */
  hit(amount: number, kx: number, kz: number): boolean
}

/** game.ts 提供给战斗系统的世界操作 */
export interface CombatWorld {
  enemies: Hittable[]
  halfSize: number
  clamp(x: number, z: number): { x: number; z: number }
  heal(n: number): void
  grantInvuln(seconds: number): void
  dashPlayer(dirX: number, dirZ: number, distance: number, duration: number): void
  burst(x: number, z: number, color: number, count?: number): void
}

/** 事件回给 game.ts：飘字/音效/结算都归它 */
export interface CombatHooks {
  onHit(t: Hittable, amount: number, crit: boolean, killed: boolean): void
  onSfx(name: 'attack' | 'crit' | 'skill' | 'summon' | 'dash'): void
}

/** CombatWorld 的可选扩展（game.ts 实现即可生效，不实现走兜底） */
interface CombatWorldExt extends CombatWorld {
  /** 肥鱼白米饭交给 game.ts 的拾取物系统 */
  spawnPickup?(x: number, z: number, kind: string): void
  /** 丛雨 lv4 普攻前冲（不带无敌）；不实现则退回 dashPlayer */
  movePlayer?(dirX: number, dirZ: number, distance: number, duration: number): void
  /** 白米饭在游戏侧结算（回充能/加 buff）；返回 true 表示已处理 */
  onRice?(x: number, z: number): boolean
  /** v4.6 护盾（守护风格 / 泡沫护盾） */
  grantShield?(amount: number, seconds: number): void
  /** v4.6 血刃残血增伤需要读取当前生命比例 */
  playerHpRatio?(): number
}

/** v4.6 风格资源快照，交给 HUD 显示 */
export interface CombatResource {
  name: string
  value: number
  max: number
  ready: boolean
  styleName: string
  hint: string
}

interface RiceDrop {
  mesh: THREE.Mesh
  x: number
  z: number
}

interface PendingBurst {
  x: number
  z: number
  color: number
  count?: number
}

interface DamageMark {
  until: number
  amp: number
}

interface ResonanceField {
  x: number
  z: number
  radius: number
  damage: number
  until: number
  tickLeft: number
  slow: number
}

interface Bleed {
  until: number
  dps: number
  tickLeft: number
}

const IDENTITY_MODS = {
  staminaMul: 1,
  magicMul: 1,
  intelligenceMul: 1,
  moveSpeedMul: 1,
  damageReduction: 0,
}

/** 三角色 Lv1 面板（setCharacter 先给一份，game.ts 随后 setStats 覆盖） */
function baseStatsFor(id: CharacterId): PlayerStats {
  const def = CHARACTERS[id]
  return {
    ...BASE_STATS,
    maxHp: def.base.hp,
    moveSpeed: def.base.moveSpeed,
    magic: def.base.magic,
    stamina: def.base.stamina,
    intelligence: def.base.intelligence,
    chargeMax: def.base.chargeMax,
    chargeGain: 0,
    attackSpeed: def.base.stamina / 55,
    attackRadius: def.attack.baseRange,
  }
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

export class Combat {
  private readonly scene: THREE.Scene
  private readonly hooks: CombatHooks
  private charId: CharacterId = 'mutsumi'
  private lv = 1
  private stats: PlayerStats = baseStatsFor('mutsumi')
  private readonly meter = new ChargeMeter()
  private readonly projectiles: ProjectileSystem
  private readonly minions: MinionSystem
  /** v4.7 角色专属特效与觉醒武器光环（对象池，无新增光源） */
  private readonly characterFx: CharacterFx

  /** 普攻冷却（秒），tryAttack/update 内部按 dt 递减 */
  private cooldownLeft = 0
  /** 硬直：丛雨突进后 0.2s 不能攻击 */
  private lockedLeft = 0
  /** Mortis 变身剩余时间 */
  private transformTime = 0
  private pulseLeft = 0
  private mods = { ...IDENTITY_MODS }
  private readonly rice: RiceDrop[] = []
  private riceTimer = 0
  private readonly pendingBursts: PendingBurst[] = []

  /* ── v4.6 角色觉醒 ── */
  private style: StyleDef = defaultStyle('mutsumi')
  private awakenings: Partial<Record<AwakeningId, number>> = {}
  private resourceValue = 0
  private activeWorld: CombatWorld | null = null
  private combatTime = 0
  private readonly resonanceMarks = new Map<Hittable, DamageMark>()
  private readonly foamMarks = new Map<Hittable, DamageMark>()
  private readonly resonanceFields: ResonanceField[] = []
  private readonly bleeds = new Map<Hittable, Bleed>()
  private soloTarget: Hittable | null = null
  private soloStacks = 0
  private soloTimer = 0
  private murasameAttackCount = 0
  private lastFishTarget: Hittable | null = null
  private readonly minionExpiryQueue: Minion[] = []
  private encoreExtension = 0

  constructor(scene: THREE.Scene, hooks: CombatHooks) {
    this.scene = scene
    this.hooks = hooks
    this.characterFx = new CharacterFx(scene)
    this.projectiles = new ProjectileSystem(scene, {
      resolveHit: (t, damage, ctx) => this.applyProjectileHit(t, damage, ctx),
      burst: (x, z, color, count, ctx) => this.projectileBurst(x, z, color, count, ctx),
    })
    this.minions = new MinionSystem(scene, this.projectiles, {
      burst: (x, z, color, count) => this.burstAt(x, z, color, count),
      onExpire: (m) => this.minionExpiryQueue.push(m),
    })
  }

  // ───────────────────────── 面板/武器 ─────────────────────────

  /** game.ts 唯一面板入口：换角色、买卡、专武升级、变身 modifiers 都在这里同步 */
  setStats(stats: PlayerStats): void {
    const ratio = this.meter.ratio
    this.stats = { ...stats }
    this.meter.reset(Math.max(1, stats.chargeMax), ratio)
  }

  setCharacter(id: CharacterId): void {
    this.charId = id
    this.lv = 1
    this.stats = baseStatsFor(id)
    this.meter.reset(this.stats.chargeMax, 0)
    this.transformTime = 0
    this.pulseLeft = 0
    this.mods = { ...IDENTITY_MODS }
    this.cooldownLeft = 0
    this.lockedLeft = 0
    this.riceTimer = 0
    this.style = defaultStyle(id)
    this.awakenings = {}
    this.clearTransient()
    this.clearBuildTransient()
  }

  /** v4.6：开局/读档/重试时设置风格与觉醒，并清空短循环资源 */
  setBuild(styleId: StyleId | string | undefined, awakenings: Partial<Record<AwakeningId, number>> | undefined): void {
    this.style = styleForCharacter(this.charId, styleId)
    this.awakenings = { ...(awakenings ?? {}) }
    this.clearBuildTransient()
  }

  private al(id: AwakeningId): number {
    return awakeningLevel(this.awakenings, id)
  }

  get resourceMax(): number {
    return this.style?.resourceMax ?? 4
  }

  get resource(): CombatResource {
    return {
      name: this.style.resourceName,
      value: Math.max(0, Math.min(this.resourceValue, this.resourceMax)),
      max: this.resourceMax,
      ready: this.resourceValue >= this.resourceMax,
      styleName: this.style.name,
      hint: this.style.resourceHint,
    }
  }

  get styleId(): StyleId {
    return this.style.id
  }

  private gainResource(amount = 1): void {
    this.resourceValue = Math.max(0, Math.min(this.resourceMax, this.resourceValue + amount))
  }

  private spendResource(amount: number): boolean {
    if (this.resourceValue < amount) return false
    this.resourceValue -= amount
    return true
  }

  private playerHpRatio(): number {
    const ext = this.activeWorld as CombatWorldExt | null
    return typeof ext?.playerHpRatio === 'function' ? Math.max(0, Math.min(1, ext.playerHpRatio())) : 1
  }

  private bloodDamageMul(): number {
    let mul = 1
    if (this.style.id === 'murasame-blood') mul *= 1 + (1 - this.playerHpRatio()) * 0.2
    const price = this.al('murasame-blood-price')
    if (price > 0 && this.playerHpRatio() < 0.4) mul *= 1 + [0, 0.08, 0.12, 0.18][price]
    return mul
  }

  private styleAttackIntervalMul(): number {
    if (this.style.id === 'mutsumi-requiem') return 1.1
    if (this.style.id === 'murasame-guard') return 1.08
    return 1
  }

  setWeaponLv(level: number): void {
    this.lv = Math.max(1, Math.min(MAX_WEAPON_LV, Math.floor(level)))
  }

  get weaponLv(): number {
    return this.lv
  }

  get characterId(): CharacterId {
    return this.charId
  }

  // ───────────────────────── 充能/技能状态 ─────────────────────────

  get charge(): number {
    return this.meter.value
  }

  get chargeMax(): number {
    return this.meter.max
  }

  get chargeRatio(): number {
    return this.meter.ratio
  }

  get skillName(): string {
    return CHARACTERS[this.charId].skill.name
  }

  get skillReady(): boolean {
    return this.meter.ready && !this.transformActive
  }

  get transformActive(): boolean {
    return this.transformTime > 0
  }

  get transformLeft(): number {
    return Math.max(0, this.transformTime)
  }

  /** 只在 Mortis 变身期间非 1；game.ts 负责乘进面板 */
  get modifiers(): {
    staminaMul: number
    magicMul: number
    intelligenceMul: number
    moveSpeedMul: number
    damageReduction: number
  } {
    return this.transformActive ? this.mods : IDENTITY_MODS
  }

  /** 击杀充能：game.ts 在击杀结算里调；world 可选，供狂血/安可等觉醒使用 */
  onKill(t: Hittable, world?: CombatWorld): void {
    const kind = this.killKind(t)
    const base = CHARGE_PER_KILL[kind]
    const charMul = CHARACTERS[this.charId]?.chargeGainMul ?? 1
    this.meter.add(base * charMul * (1 + Math.max(0, this.stats.chargeGain)))

    if (world) this.activeWorld = world
    // 丛雨·狂血：击杀回血 + 剑意
    if (this.charId === 'murasame' && this.style.id === 'murasame-blood') {
      const lust = this.al('murasame-blood-lust')
      if (lust > 0) {
        const ratio = [0, 0.015, 0.025, 0.04][lust]
        this.activeWorld?.heal(this.stats.maxHp * ratio)
        this.gainResource(1)
        if (lust >= 3) this.meter.add(5)
      }
    }
    // 睦·安可：Mortis 期间击杀概率延长变身并回充能
    if (this.charId === 'mutsumi' && this.transformActive) {
      const encore = this.al('mutsumi-duet-encore')
      if (encore > 0 && this.encoreExtension < 2 && rng.chance([0, 0.25, 0.35, 0.45][encore])) {
        const add = [0, 0.25, 0.3, 0.35][encore]
        const extend = Math.min(add, 2 - this.encoreExtension)
        if (extend > 0) {
          this.transformTime += extend
          this.encoreExtension += extend
          this.meter.add([0, 8, 12, 16][encore])
          this.hooks.onSfx('crit')
        }
      }
    }
  }

  /** 每层开始：清场 + 起手充能（层间 50%） */
  resetLayer(chargeRatio: number): void {
    this.clearTransient()
    this.clearBuildTransient()
    this.resourceValue = 0
    this.transformTime = 0
    this.pulseLeft = 0
    this.mods = { ...IDENTITY_MODS }
    this.cooldownLeft = 0
    this.lockedLeft = 0
    this.meter.reset(this.stats.chargeMax, clamp01(chargeRatio))
    this.riceTimer = 0
  }

  /** 白米饭等掉落：ratio 0..1 按充能上限折算 */
  grantCharge(ratio: number): void {
    this.meter.add(this.meter.max * clamp01(ratio))
  }

  // ───────────────────────── 普攻 ─────────────────────────

  tryAttack(
    dt: number,
    px: number,
    pz: number,
    aimX: number,
    aimZ: number,
    world: CombatWorld,
  ): boolean {
    if (this.lockedLeft > 0) return false
    this.cooldownLeft = Math.max(0, this.cooldownLeft - dt)
    if (this.cooldownLeft > 0) return false
    const def = CHARACTERS[this.charId]
    const interval = attackInterval(this.stats.stamina, def.attack.minInterval) * this.styleAttackIntervalMul()
    this.cooldownLeft = Math.max(0.01, interval)
    const dir = this.dirFromAim(px, pz, aimX, aimZ)
    const tier = getWeaponTier(this.charId, this.lv)
    this.hooks.onSfx('attack')
    if (this.charId === 'murasame') {
      this.attackMurasame(px, pz, dir, tier, world)
      return true
    }
    if (this.charId === 'fish') {
      this.attackFish(px, pz, dir, tier, world)
      return true
    }
    this.attackMutsumi(px, pz, dir, tier, world)
    return true
  }

  private attackMutsumi(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    void world
    const def = CHARACTERS.mutsumi
    const magic = this.stats.magic
    const baseRange = skillRange(def.attack.baseRange, this.stats.intelligence)
    const baseDamage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), magic)
    const sizeMul = tierNum(tier, 'sizeMul', 1)
    const hitMul = tierNum(tier, 'hitRadiusMul', 1)

    const requiem = this.style.id === 'mutsumi-requiem'
    const chord = this.resourceValue >= this.resourceMax
    if (chord) this.spendResource(this.resourceMax)
    const chordMul = chord ? (requiem ? 2.2 : 1.6) : 1
    const rangeMul = chord ? (requiem ? 1.4 : 1.2) : 1
    const chordPierce = chord ? (requiem ? 5 : 3) : 0
    const damage = baseDamage * chordMul * (!this.transformActive && this.style.id === 'mutsumi-duet' ? 0.9 : 1)
    const chordColor = chord ? 0xffe6ad : undefined
    this.characterFx.mutsumiShot(px, pz, dir.x, dir.z, chord)

    // lv4/5 变身期：普攻改为向前音波剑气
    if (this.transformActive && tierNum(tier, 'mortisWave', 0) > 0) {
      const bounce = tierNum(tier, 'waveBounce', 0)
      this.projectiles.spawn({
        kind: 'wave',
        x: px + dir.x * 0.6,
        z: pz + dir.z * 0.6,
        y: 0.8,
        dirX: dir.x,
        dirZ: dir.z,
        speed: 15,
        damage: damage * tierNum(tier, 'mortisWave', 1),
        range: baseRange * 1.25 * rangeMul,
        hitRadius: 0.9 * (chord ? 1.25 : 1),
        pierce: chord ? chordPierce : bounce > 0 ? 0 : 99,
        bounce,
        bounceMul: 0.8,
        bounceRange: 5,
        canCrit: true,
        chord,
        color: chordColor,
      })
      if (!chord) this.gainResource(1)
      return
    }

    const count = chord ? 1 : Math.max(1, Math.floor(tierNum(tier, 'projectiles', 1)))
    const spread = (tierNum(tier, 'spread', 0) * Math.PI) / 180
    const bounce = chord ? 0 : Math.floor(tierNum(tier, 'bounce', 0))
    const bounceMul = tierNum(tier, 'bounceMul', 0.6)
    const speed = def.attack.projectileSpeed ?? 18
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : i / (count - 1) - 0.5
      const ang = t * spread
      const cos = Math.cos(ang)
      const sin = Math.sin(ang)
      this.projectiles.spawn({
        kind: 'cucumber',
        x: px + dir.x * 0.5,
        z: pz + dir.z * 0.5,
        y: 0.7,
        dirX: dir.x * cos - dir.z * sin,
        dirZ: dir.x * sin + dir.z * cos,
        speed,
        damage,
        range: baseRange * rangeMul,
        hitRadius: 0.26 * hitMul,
        scale: sizeMul * (chord ? 1.45 : 1),
        pierce: chordPierce,
        bounce,
        bounceMul,
        canCrit: true,
        chord,
        color: chordColor,
      })
    }
    if (!chord) this.gainResource(1)
  }

  private attackMurasame(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    const def = CHARACTERS.murasame
    this.murasameAttackCount += 1
    if (this.style.id === 'murasame-iai' && this.murasameAttackCount % 3 === 0) {
      this.attackMurasameIai(px, pz, dir, tier, world)
      return
    }
    const range =
      skillRange(def.attack.baseRange, this.stats.intelligence) *
      tierNum(tier, 'radiusMul', 1) *
      (this.style.id === 'murasame-iai' ? 0.9 : 1)
    const baseDamage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic) * this.bloodDamageMul()
    const targets = pickConeTargets(world.enemies, px, pz, dir.x, dir.z, range, def.attack.angle ?? 110, 8)
    const crit = rng.chance(this.stats.critChance)
    const amount = crit ? baseDamage * this.stats.critMultiplier : baseDamage
    if (crit) this.hooks.onSfx('crit')
    const gather = tierNum(tier, 'gatherOnHit', 0)
    let lifesteal = tierNum(tier, 'lifesteal', 0)
    if (this.style.id === 'murasame-blood') lifesteal += 0.06
    if (this.style.id === 'murasame-blood') lifesteal += [0, 0.03, 0.05, 0.08][this.al('murasame-blood-price')]
    let leeched = 0
    for (const t of targets) {
      const killed = t.hit(amount, dir.x * 2.2, dir.z * 2.2)
      if (gather > 0) pullToward(t, px, pz, gather)
      this.hooks.onHit(t, amount, crit, killed)
      if (lifesteal > 0) leeched += amount * lifesteal
    }
    if (lifesteal > 0 && leeched > 0) world.heal(leeched)
    if (targets.length > 0) this.gainResource(1)
    this.characterFx.murasameSlash(px, pz, dir.x, dir.z, range, this.style.id, targets.length > 0)
    // lv4+ 普攻带前冲
    const stepLen = tierNum(tier, 'stepOnAttack', 0)
    if (stepLen > 0) {
      const ext = world as CombatWorldExt
      if (typeof ext.movePlayer === 'function') ext.movePlayer(dir.x, dir.z, stepLen, 0.12)
      else world.dashPlayer(dir.x, dir.z, stepLen, 0.12)
    }
  }

  /** 居合：第 3 次普攻变成 6m 直线拔刀，可命中路径上的敌人 */
  private attackMurasameIai(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    const def = CHARACTERS.murasame
    const range = skillRange(6, this.stats.intelligence)
    const width = 1.4
    const damage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic) * 1.4 * this.bloodDamageMul()
    const targets = pickLineTargets(world.enemies, px, pz, px + dir.x * range, pz + dir.z * range, width)
    const crit = rng.chance(this.stats.critChance)
    const amount = crit ? damage * this.stats.critMultiplier : damage
    if (crit) this.hooks.onSfx('crit')
    let lifesteal = this.style.id === 'murasame-blood' ? 0.06 : 0
    if (this.style.id === 'murasame-blood') lifesteal += [0, 0.03, 0.05, 0.08][this.al('murasame-blood-price')]
    let leeched = 0
    for (const t of targets) {
      const killed = t.hit(amount, dir.x * 2.4, dir.z * 2.4)
      this.hooks.onHit(t, amount, crit, killed)
      if (lifesteal > 0) leeched += amount * lifesteal
      const bleed = this.al('murasame-iai-bleed')
      if (bleed > 0) this.applyBleed(t, amount * [0, 0.18, 0.26, 0.36][bleed], [0, 3, 3.5, 4][bleed])
    }
    if (lifesteal > 0 && leeched > 0) world.heal(leeched)
    const mind = this.al('murasame-iai-mind')
    if (mind > 0) {
      this.gainResource(mind >= 3 ? 2 : 1)
      this.meter.add([0, 4, 7, 10][mind])
      this.hooks.onSfx('crit')
    }
    if (targets.length > 0) this.gainResource(1)
    this.characterFx.murasameIai(px, pz, dir.x, dir.z, range, this.style.id)
  }

  private attackFish(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    void world
    const def = CHARACTERS.fish
    const baseDamage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic)
    const pierce = Math.floor(tierNum(tier, 'pierce', 0))
    const big = this.resourceValue >= this.resourceMax
    if (big) this.spendResource(this.resourceMax)
    const damage = baseDamage * (big ? 1.6 : 1)
    this.characterFx.fishShot(px, pz, dir.x, dir.z, big)
    this.projectiles.spawn({
      kind: 'bubble',
      x: px + dir.x * 0.45,
      z: pz + dir.z * 0.45,
      y: 0.72,
      dirX: dir.x,
      dirZ: dir.z,
      speed: def.attack.projectileSpeed ?? 13,
      damage,
      range: skillRange(def.attack.baseRange, this.stats.intelligence),
      hitRadius: 0.3 + pierce * 0.05 + (big ? 0.16 : 0),
      scale: 1 + pierce * 0.18 + (big ? 0.55 : 0),
      pierce: big ? 0 : pierce,
      canCrit: true,
      big,
      source: 'player',
      color: big ? 0x8ff6ff : undefined,
    })
  }

  // ───────────────────────── 技能 ─────────────────────────

  trySkill(px: number, pz: number, aimX: number, aimZ: number, world: CombatWorld, dashDir?: { x: number; z: number }): boolean {
    if (this.transformActive) return false
    const def = CHARACTERS[this.charId]
    const tier = getWeaponTier(this.charId, this.lv)
    const rawCost = this.skillCost(tier, def.skill.chargeCost)
    // 兜底：任何专武档位的消耗都不能超过当前充能上限，否则会出现「满了却放不出」
    const cost = Math.min(this.meter.max, Math.max(20, rawCost))
    if (this.charge < cost) return false
    const dir = dashDir ?? this.dirFromAim(px, pz, aimX, aimZ)
    if (this.charId === 'mutsumi') {
      if (!this.meter.spend(cost)) return false
      this.startTransform(px, pz, tier, world)
      return true
    }
    if (this.charId === 'murasame') {
      if (!this.meter.spend(cost)) return false
      this.skillDash(px, pz, dir, tier, world)
      return true
    }
    if (!this.meter.spend(cost)) return false
    this.skillSummon(px, pz, tier, world)
    return true
  }

  private skillCost(tier: WeaponTier, fallback: number): number {
    if (this.charId === 'murasame') return Math.max(20, tierNum(tier, 'skillCharge', fallback))
    return Math.max(20, fallback)
  }

  private startTransform(
    px: number,
    pz: number,
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    const def = CHARACTERS.mutsumi
    const p = def.skill.params
    const baseDuration = def.skill.duration ?? 8
    this.transformTime = Math.max(2, baseDuration - (this.style.id === 'mutsumi-solo' ? 2 : 0))
    this.encoreExtension = 0
    this.pulseLeft = p.pulseInterval ?? 0.5
    this.mods = {
      staminaMul: p.staminaMul ?? 1.6,
      magicMul: p.magicMul ?? 1.7,
      intelligenceMul: p.intelligenceMul ?? 0.6,
      moveSpeedMul: p.moveSpeedMul ?? 0.9,
      damageReduction: p.damageReduction ?? 0.15,
    }
    // 变身瞬间：半径爆发 + 击退
    const radius =
      (p.pulseBaseRadius ?? 4.3) *
      (this.stats.intelligence / 100) *
      tierNum(tier, 'mortisRadiusMul', 1)
    const amount = hitDamage(p.burstDamage ?? 40, this.stats.magic)
    const knocked = p.burstKnockback ?? 3
    for (const t of world.enemies) {
      if (!t.alive) continue
      const d = Math.hypot(t.x - px, t.z - pz)
      if (d > radius + t.radius) continue
      const kx = d > 1e-4 ? ((t.x - px) / d) * knocked : 0
      const kz = d > 1e-4 ? ((t.z - pz) / d) * knocked : 0
      const killed = t.hit(amount, kx, kz)
      this.hooks.onHit(t, amount, false, killed)
    }
    this.characterFx.mutsumiCast(px, pz, radius, this.style.id)
    this.hooks.onSfx('skill')
  }

  private skillDash(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    const def = CHARACTERS.murasame
    const p = def.skill.params
    const empowered = this.resourceValue >= this.resourceMax
    if (empowered) this.spendResource(this.resourceMax)
    const distance = p.distance ?? 7.5
    const end = world.clamp(px + dir.x * distance, pz + dir.z * distance)
    const width = (p.pathWidth ?? 1.8) * (empowered ? 1.4 : 1)
    const hits = pickLineTargets(world.enemies, px, pz, end.x, end.z, width)
    const skillMul = tierNum(tier, 'skillDamageMul', 1)
    const amount =
      hitDamage(p.damage ?? 45, this.stats.magic) *
      skillMul *
      this.bloodDamageMul() *
      (empowered ? 1.5 : 1)
    const crit = rng.chance(this.stats.critChance)
    const dmg = crit ? amount * this.stats.critMultiplier : amount
    if (crit) this.hooks.onSfx('crit')
    let dealt = 0
    for (const t of hits) {
      const killed = t.hit(dmg, dir.x * 1.2, dir.z * 1.2)
      this.hooks.onHit(t, dmg, crit, killed)
      dealt += dmg
      // 技能把路径上命中的敌人也拉到终点，方便接普攻
      if (t.alive) gatherTo(t, end.x, end.z, 0.95)
    }
    // 燕返：满剑意时在落点追加一次回旋斩
    if (empowered) {
      const follow = dmg * 0.6
      for (const t of world.enemies) {
        if (!t.alive) continue
        if (Math.hypot(t.x - end.x, t.z - end.z) > 3.2) continue
        const killed = t.hit(follow, dir.x * 1.8, dir.z * 1.8)
        this.hooks.onHit(t, follow, crit, killed)
        dealt += follow
        if (t.alive) gatherTo(t, end.x, end.z, 1.1)
      }
    }
    // 终点聚怪：范围内的敌人一起收拢
    const gatherRadius = p.gatherRadius ?? 2.8
    for (const t of world.enemies) {
      if (!t.alive) continue
      if (Math.hypot(t.x - end.x, t.z - end.z) > gatherRadius) continue
      gatherTo(t, end.x, end.z, 0.95)
    }
    // 血刃：技能伤害也吸血
    if (this.style.id === 'murasame-blood' && dealt > 0) {
      let lifesteal = 0.06 + [0, 0.03, 0.05, 0.08][this.al('murasame-blood-price')]
      world.heal(dealt * lifesteal)
    }
    // 守护：突进护盾
    if (this.style.id === 'murasame-guard') {
      const wall = this.al('murasame-guard-wall')
      const shieldRatio = 0.12 + [0, 0.06, 0.1, 0.15][wall]
      const shieldTime = 4 + [0, 1, 1.5, 2][wall]
      const ext = world as CombatWorldExt
      ext.grantShield?.(this.stats.maxHp * shieldRatio, shieldTime)
    }
    // 余震：落点冲击波
    const aftershock = this.al('murasame-guard-aftershock')
    if (aftershock > 0) {
      const radius = [0, 3, 3.4, 3.8][aftershock]
      const ratio = [0, 0.4, 0.6, 0.85][aftershock]
      for (const t of world.enemies) {
        if (!t.alive) continue
        if (Math.hypot(t.x - end.x, t.z - end.z) > radius + t.radius) continue
        const killed = t.hit(dmg * ratio, dir.x * 2.6, dir.z * 2.6)
        this.hooks.onHit(t, dmg * ratio, false, killed)
      }
      this.characterFx.murasameGuard(end.x, end.z, empowered)
    }
    // 回血与命中数挂钩：每命中 1 个敌人回 healPerHit 血
    const healPerHit = tierNum(tier, 'skillHealPerHit', 7)
    world.heal(healPerHit * hits.length)
    world.grantInvuln(p.invulnerable ?? 0.3)
    world.dashPlayer(dir.x, dir.z, distance, p.dashDuration ?? 0.24)
    this.lockedLeft = Math.max(this.lockedLeft, p.recovery ?? 0.2)
    this.characterFx.murasameDash(px, pz, end.x, end.z, dir.x, dir.z, this.style.id, empowered)
    this.hooks.onSfx('dash')
    this.hooks.onSfx('skill')
  }

  private skillSummon(px: number, pz: number, tier: WeaponTier, world: CombatWorld): void {
    const def = CHARACTERS.fish
    const p = def.skill.params
    let count = Math.max(1, Math.floor(tierNum(tier, 'minionCount', p.count ?? 3)))
    if (this.style.id === 'fish-school') count += 1
    if (this.style.id === 'fish-burst' || this.style.id === 'fish-whale') count -= 1
    const tactics = this.al('fish-school-tactics')
    if (this.style.id === 'fish-school' && tactics >= 3) count += 1
    count = Math.max(1, count)
    const baseDamage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic)
    const hpMul = (this.style.id === 'fish-school' ? 0.85 : 1) * (this.style.id === 'fish-whale' ? 1.3 : 1)
    const damageMul = this.style.id === 'fish-whale' ? 1.2 : 1
    const intervalMul = this.style.id === 'fish-school' ? 1 - [0, 0.05, 0.1, 0.15][tactics] : 1
    const focus = this.style.id === 'fish-school' && this.lastFishTarget?.alive ? this.lastFishTarget : undefined
    const specs = []
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + 0.4
      specs.push({
        x: px + Math.cos(ang) * 1.15,
        z: pz + Math.sin(ang) * 1.15,
        hp: Math.max(1, this.stats.maxHp * (p.minionHpRatio ?? 0.35) * hpMul),
        damage: baseDamage * (p.minionDamageRatio ?? 0.4) * damageMul,
        interval: (p.minionInterval ?? 0.6) * intervalMul,
        speed: p.minionSpeed ?? 5.2,
        followRange: 5,
        range: p.minionRange ?? 7,
        duration: def.skill.duration ?? 10,
        bubbleSpeed: 9,
        bubbleRange: p.minionRange ?? 7,
        bubbleHitRadius: 0.3,
        scale: this.style.id === 'fish-whale' ? 1.18 : 1,
        taunt: tierNum(tier, 'minionTaunt', 0) > 0,
        slow: tierNum(tier, 'minionSlow', 0) > 0 ? tierNum(tier, 'minionSlow', 0) : undefined,
        focus,
      })
    }
    this.minions.spawn(specs)
    this.characterFx.fishSummon(px, pz, count, this.style.id)
    // 召唤瞬间的冲击波：给周围敌人一次伤害，避免「放了大招没反馈」
    const burstDamage = hitDamage(p.burstDamage ?? 26, this.stats.magic)
    const burstRadius = p.burstRadius ?? 4.2
    let hits = 0
    for (const t of world.enemies) {
      if (!t.alive) continue
      const dx = t.x - px
      const dz = t.z - pz
      if (dx * dx + dz * dz > burstRadius * burstRadius) continue
      t.hit(burstDamage, dx * 0.6, dz * 0.6)
      hits += 1
    }
    if (hits > 0) this.burstAt(px, pz, 0x9fe8ff, 16)
    this.hooks.onSfx('summon')
  }

  // ───────────────────────── 每帧 ─────────────────────────

  update(dt: number, px: number, pz: number, world: CombatWorld): void {
    const step = Math.max(0, Math.min(dt, 0.1))
    this.combatTime += step
    this.activeWorld = world
    this.cooldownLeft = Math.max(0, this.cooldownLeft - step)
    this.lockedLeft = Math.max(0, this.lockedLeft - step)

    if (this.transformTime > 0) {
      this.transformTime -= step
      if (this.transformTime <= 0) {
        this.transformTime = 0
        this.finishTransform(px, pz, world)
      } else {
        this.pulseLeft -= step
        while (this.pulseLeft <= 0) {
          this.pulseLeft += Math.max(0.2, CHARACTERS.mutsumi.skill.params.pulseInterval ?? 0.5)
          this.pulse(px, pz, world)
        }
      }
    }

    // 肥鱼专武 lv3 起：每 10s 掉一份白米饭
    const tier = getWeaponTier(this.charId, this.lv)
    const riceInterval = this.charId === 'fish' ? tierNum(tier, 'riceInterval', 0) : 0
    if (riceInterval > 0) {
      this.riceTimer -= step
      if (this.riceTimer <= 0) {
        this.riceTimer = riceInterval
        this.dropRice(px, pz, world)
      }
    }
    this.updateRice(px, pz, world)

    this.projectiles.update(step, world.enemies, world.halfSize)
    this.minions.update(step, px, pz, world)
    this.updateBuildEffects(step, world)
    this.characterFx.update(step, px, pz, {
      character: this.charId,
      styleId: this.style.id,
      awakenings: this.awakenings,
      resourceRatio: this.resourceMax > 0 ? this.resourceValue / this.resourceMax : 0,
      transformActive: this.transformActive,
      weaponLv: this.lv,
    })
    this.flushBursts(world)
  }

  /** 变身结束：谢幕觉醒在这里结算，然后恢复常驻面板 */
  private finishTransform(px: number, pz: number, world: CombatWorld): void {
    const curtain = this.al('mutsumi-duet-curtain')
    if (curtain > 0) {
      const beats = Math.max(0, Math.min(this.resourceValue, this.resourceMax))
      this.resourceValue = 0
      if (beats > 0) world.heal(this.stats.maxHp * [0, 0.02, 0.03, 0.04][curtain] * beats)
      const slow = [0, 0.3, 0.35, 0.4][curtain]
      const duration = [0, 1.5, 2, 2.5][curtain]
      for (const t of world.enemies) {
        if (!t.alive) continue
        if (Math.hypot(t.x - px, t.z - pz) > 4 + t.radius) continue
        this.slowTarget(t, slow, duration)
      }
      this.characterFx.mutsumiCurtain(px, pz, this.style.id)
    }
    this.encoreExtension = 0
    this.mods = { ...IDENTITY_MODS }
  }

  /** 持续伤害/音场/标记/召唤物到期等短循环效果 */
  private updateBuildEffects(step: number, world: CombatWorld): void {
    this.soloTimer = Math.max(0, this.soloTimer - step)
    if (this.soloTimer <= 0) {
      this.soloTarget = null
      this.soloStacks = 0
    }

    for (const [t, mark] of this.resonanceMarks) {
      if (!t.alive || mark.until <= this.combatTime) this.resonanceMarks.delete(t)
    }
    for (const [t, mark] of this.foamMarks) {
      if (!t.alive || mark.until <= this.combatTime) this.foamMarks.delete(t)
    }

    for (let i = this.resonanceFields.length - 1; i >= 0; i--) {
      const field = this.resonanceFields[i]
      if (field.until <= this.combatTime) {
        this.resonanceFields.splice(i, 1)
        continue
      }
      field.tickLeft -= step
      while (field.tickLeft <= 0) {
        field.tickLeft += 0.5
        for (const t of world.enemies) {
          if (!t.alive) continue
          if (Math.hypot(t.x - field.x, t.z - field.z) > field.radius + t.radius) continue
          const killed = t.hit(field.damage, 0, 0)
          this.slowTarget(t, field.slow, 0.35)
          this.hooks.onHit(t, field.damage, false, killed)
        }
        this.burstAt(field.x, field.z, 0xbfa6ff, 4)
      }
    }

    for (const [t, bleed] of this.bleeds) {
      if (!t.alive || bleed.until <= this.combatTime) {
        this.bleeds.delete(t)
        continue
      }
      bleed.tickLeft -= step
      while (bleed.tickLeft <= 0 && bleed.until > this.combatTime) {
        bleed.tickLeft += 0.5
        const tick = bleed.dps * 0.5
        const killed = t.hit(tick, 0, 0)
        this.hooks.onHit(t, tick, false, killed)
        if (killed) {
          this.bleeds.delete(t)
          break
        }
      }
    }

    if (this.minionExpiryQueue.length > 0) {
      const expired = this.minionExpiryQueue.splice(0)
      for (const m of expired) this.onMinionExpire(m, world)
    }
  }

  /** 鲸落风格：召唤物消失时爆炸；深海回响追加回血/充能 */
  private onMinionExpire(m: Minion, world: CombatWorld): void {
    if (this.style.id === 'fish-whale') {
      const fall = this.al('fish-whale-fall')
      const radius = 2.2 + [0, 0.8, 1.2, 1.6][fall]
      const damage = m.damage * (1.2 + [0, 0.4, 0.7, 1.1][fall])
      for (const t of world.enemies) {
        if (!t.alive) continue
        if (Math.hypot(t.x - m.x, t.z - m.z) > radius + t.radius) continue
        const killed = t.hit(damage, 0, 0)
        this.hooks.onHit(t, damage, false, killed)
      }
      this.characterFx.fishMinionExpire(m.x, m.z, this.style.id)
    }
    const echo = this.al('fish-whale-echo')
    if (echo > 0) {
      world.heal(this.stats.maxHp * [0, 0.015, 0.025, 0.04][echo])
      this.meter.add([0, 5, 8, 12][echo])
    }
  }

  get projectileCount(): number {
    return this.projectiles.count
  }

  get minionCount(): number {
    return this.minions.count
  }

  get minionsList(): readonly Minion[] {
    return this.minions.minions
  }

  get riceCount(): number {
    return this.rice.length
  }

  // ───────────────────────── 内部实现 ─────────────────────────

  private pulse(px: number, pz: number, world: CombatWorld): void {
    const p = CHARACTERS.mutsumi.skill.params
    const tier = getWeaponTier(this.charId, this.lv)
    const requiem = this.style.id === 'mutsumi-requiem'
    const chord = this.resourceValue >= this.resourceMax
    if (chord) this.spendResource(this.resourceMax)
    const radius =
      (p.pulseBaseRadius ?? 4.3) *
      (this.stats.intelligence / 100) *
      tierNum(tier, 'mortisRadiusMul', 1) *
      (chord ? (requiem ? 1.4 : 1.2) : 1)
    const baseAmount = hitDamage(p.pulseBaseDamage ?? 11, this.stats.magic) * tierNum(tier, 'mortisPulseMul', 1)
    const amount = baseAmount * (chord ? (requiem ? 2.2 : 1.6) : 1)
    const lifesteal = tierNum(tier, 'mortisLifesteal', 0)
    let drained = 0
    for (const t of world.enemies) {
      if (!t.alive) continue
      if (Math.hypot(t.x - px, t.z - pz) > radius + t.radius) continue
      let hitAmount = amount * (1 + this.mutsumiAmp(t))
      if (chord) hitAmount *= this.chordToughMul(t)
      const killed = t.hit(hitAmount, 0, 0)
      drained += hitAmount
      if (chord) this.onChordHit(t, hitAmount, killed, t.x, t.z)
      this.slowTarget(t, p.slow ?? 0, p.slowDuration ?? 0.15)
      this.hooks.onHit(t, hitAmount, false, killed)
    }
    if (!chord) this.gainResource(this.style.id === 'mutsumi-duet' ? 2 : 1)
    if (lifesteal > 0 && drained > 0) world.heal(drained * lifesteal)
    this.characterFx.mutsumiPulse(px, pz, radius, chord, this.style.id)
  }

  private applyProjectileHit(t: Hittable, damage: number, ctx: ProjectileHitContext): void {
    if (this.charId === 'fish' && ctx.source === 'player' && t.alive) this.lastFishTarget = t
    let amount = damage
    if (this.charId === 'mutsumi' && this.style.id === 'mutsumi-solo' && !ctx.chord && ctx.source === 'player') {
      if (this.soloTarget === t) amount *= 1 + Math.min(5, this.soloStacks) * 0.06
      if (this.soloTarget === t) this.soloStacks = Math.min(6, this.soloStacks + 1)
      else {
        this.soloTarget = t
        this.soloStacks = 1
      }
      this.soloTimer = 2.5
    }
    if (this.charId === 'mutsumi') amount *= 1 + this.mutsumiAmp(t)
    if (this.charId === 'fish') amount *= 1 + this.foamAmp(t)
    if (this.charId === 'mutsumi' && ctx.chord) amount *= this.chordToughMul(t)
    const crit = ctx.canCrit && rng.chance(this.stats.critChance)
    if (crit) amount *= this.stats.critMultiplier
    const killed = t.hit(amount, ctx.dirX * 1.4, ctx.dirZ * 1.4)
    if (ctx.slow && ctx.slow > 0) this.slowTarget(t, ctx.slow, 0.8)
    if (crit) this.hooks.onSfx('crit')
    this.hooks.onHit(t, amount, crit, killed)

    if (this.charId === 'mutsumi' && ctx.chord) {
      this.onChordHit(t, amount, killed, t.x, t.z)
    }

    if (this.charId === 'fish' && ctx.source === 'player') {
      if (!ctx.big) this.gainResource(1)
      this.applyFoamMark(t)
      if (ctx.big) this.bigBubbleBurst(t, amount)
    }
  }

  /** 弹道命中：按角色语言选择音符/泡泡，而不是所有弹道共用同一套火花。 */
  private projectileBurst(
    x: number,
    z: number,
    color: number,
    count?: number,
    ctx?: ProjectileBurstContext,
  ): void {
    if (ctx && ctx.kind === 'bubble') {
      this.characterFx.fishHit(x, z, ctx.big)
      return
    }
    if (ctx && (ctx.kind === 'cucumber' || ctx.kind === 'wave')) {
      this.characterFx.mutsumiHit(x, z, ctx.chord)
      return
    }
    this.burstAt(x, z, color, count)
  }

  /** 睦的普通和弦命中：共鸣标记 + 余音音场 + 葬送爆炸 + 残响返还 */
  private onChordHit(t: Hittable, amount: number, killed: boolean, x: number, z: number): void {
    const resonance = this.al('mutsumi-solo-resonance')
    if (resonance > 0) {
      this.resonanceMarks.set(t, {
        until: this.combatTime + [0, 3, 3.5, 4][resonance],
        amp: [0, 0.08, 0.12, 0.18][resonance],
      })
    }
    const aftertone = this.al('mutsumi-solo-aftertone')
    if (aftertone > 0) {
      this.spawnResonanceField(
        x,
        z,
        amount * [0, 0.2, 0.3, 0.45][aftertone],
        [0, 2, 2.5, 3][aftertone],
        [0, 0.2, 0.25, 0.3][aftertone],
      )
    }
    if (!killed) return
    const funeral = this.al('mutsumi-requiem-funeral')
    if (funeral > 0) {
      this.damageArea(x, z, [0, 3, 3.4, 3.8][funeral], amount * [0, 0.4, 0.6, 0.85][funeral], 0, 0)
      this.characterFx.mutsumiExplosion(x, z, [0, 3, 3.4, 3.8][funeral])
    }
    const echo = this.al('mutsumi-requiem-echo')
    if (echo > 0) {
      this.gainResource([0, 2, 3, 4][echo])
      if (echo >= 3) this.meter.add(8)
    }
  }

  private spawnResonanceField(x: number, z: number, damage: number, duration: number, slow: number): void {
    const existing = this.resonanceFields.find((f) => f.until > this.combatTime && Math.hypot(f.x - x, f.z - z) < 1.8)
    if (existing) {
      existing.damage = Math.max(existing.damage, damage)
      existing.until = Math.max(existing.until, this.combatTime + duration)
      return
    }
    this.resonanceFields.push({
      x,
      z,
      radius: 2.4,
      damage,
      until: this.combatTime + duration,
      tickLeft: 0.5,
      slow,
    })
  }

  private mutsumiAmp(t: Hittable): number {
    const mark = this.resonanceMarks.get(t)
    return mark && mark.until > this.combatTime ? mark.amp : 0
  }

  private foamAmp(t: Hittable): number {
    const mark = this.foamMarks.get(t)
    return mark && mark.until > this.combatTime ? mark.amp : 0
  }

  private applyFoamMark(t: Hittable): void {
    const mark = this.al('fish-school-mark')
    if (mark <= 0 || !t.alive) return
    this.foamMarks.set(t, {
      until: this.combatTime + [0, 3, 3.5, 4][mark],
      amp: [0, 0.08, 0.12, 0.18][mark],
    })
  }

  private chordToughMul(t: Hittable): number {
    const echo = this.al('mutsumi-requiem-echo')
    if (echo <= 0) return 1
    const kind = this.killKind(t)
    if (kind !== 'elite' && kind !== 'boss') return 1
    return 1 + [0, 0.15, 0.25, 0.4][echo]
  }

  /** 大泡泡命中：范围爆炸 + 爆裂强化/泡沫护盾 */
  private bigBubbleBurst(t: Hittable, amount: number): void {
    const world = this.activeWorld
    const burstStyle = this.style.id === 'fish-burst'
    const radiusLevel = this.al('fish-burst-radius')
    const radius = 2.4 * (burstStyle ? 1.3 : 1) * (1 + [0, 0.15, 0.25, 0.4][radiusLevel])
    const ratio = 0.65 * (1 + [0, 0.1, 0.2, 0.35][radiusLevel])
    if (world) {
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy === t) continue
        if (Math.hypot(enemy.x - t.x, enemy.z - t.z) > radius + enemy.radius) continue
        const damage = amount * ratio * (1 + this.foamAmp(enemy))
        const killed = enemy.hit(damage, 0, 0)
        this.hooks.onHit(enemy, damage, false, killed)
      }
    }
    this.characterFx.fishBurst(t.x, t.z, radius, this.style.id)
    const shield = this.al('fish-burst-shield')
    if (shield > 0 && world) {
      const ext = world as CombatWorldExt
      ext.grantShield?.(this.stats.maxHp * [0, 0.05, 0.08, 0.12][shield], [0, 4, 4.5, 5][shield])
    }
  }

  /** 流血：刷新时取更高的每秒伤害与更长的持续时间 */
  private applyBleed(t: Hittable, dps: number, duration: number): void {
    if (!t.alive || dps <= 0 || duration <= 0) return
    const existing = this.bleeds.get(t)
    this.bleeds.set(t, {
      until: Math.max(existing?.until ?? 0, this.combatTime + duration),
      dps: Math.max(existing?.dps ?? 0, dps),
      tickLeft: Math.min(existing?.tickLeft ?? 0.5, 0.5),
    })
  }

  private damageArea(
    x: number,
    z: number,
    radius: number,
    damage: number,
    kx: number,
    kz: number,
    exclude?: Hittable,
  ): void {
    const world = this.activeWorld
    if (!world) return
    for (const t of world.enemies) {
      if (!t.alive || t === exclude) continue
      if (Math.hypot(t.x - x, t.z - z) > radius + t.radius) continue
      const killed = t.hit(damage, kx, kz)
      this.hooks.onHit(t, damage, false, killed)
    }
  }

  /** 敌人若实现 slow(mul, seconds) 就减速；没有就跳过 */
  private slowTarget(t: Hittable, mul: number, duration: number): void {
    if (mul <= 0) return
    const withSlow = t as Hittable & { slow?: (mul: number, duration: number) => void }
    if (typeof withSlow.slow === 'function') withSlow.slow(mul, duration)
  }

  private dropRice(px: number, pz: number, world: CombatWorld): void {
    const ext = world as CombatWorldExt
    const x = px + rng.range(-1.6, 1.6)
    const z = pz + rng.range(-1.6, 1.6)
    if (typeof ext.spawnPickup === 'function') {
      ext.spawnPickup(x, z, 'rice')
      return
    }
    const mesh = createProjectileMesh('rice', 1, { color: 0xfff4d6 })
    mesh.position.set(x, 0.35, z)
    this.scene.add(mesh)
    this.rice.push({ mesh, x, z })
  }

  private updateRice(px: number, pz: number, world: CombatWorld): void {
    for (let i = this.rice.length - 1; i >= 0; i--) {
      const r = this.rice[i]
      r.mesh.rotation.set(0, getBillboardYaw(), 0)
      r.mesh.position.y = 0.35 + Math.sin(r.x * 5 + r.z * 3) * 0.05
      if (Math.hypot(r.x - px, r.z - pz) > 1.4) continue
      const ext = world as CombatWorldExt
      let handled = false
      if (typeof ext.onRice === 'function') handled = ext.onRice(r.x, r.z)
      if (!handled) this.meter.add(20)
      this.scene.remove(r.mesh)
      r.mesh.geometry.dispose()
      ;(r.mesh.material as THREE.Material).dispose()
      this.rice.splice(i, 1)
    }
  }

  private burstAt(x: number, z: number, color: number, count?: number): void {
    this.pendingBursts.push({ x, z, color, count })
  }

  /** 本帧积累的粒子请求，由 update 末尾转交 world.burst */
  private flushBursts(world: CombatWorld): void {
    if (this.pendingBursts.length === 0) return
    for (const b of this.pendingBursts) world.burst(b.x, b.z, b.color, b.count)
    this.pendingBursts.length = 0
  }

  private dirFromAim(px: number, pz: number, aimX: number, aimZ: number): { x: number; z: number } {
    const alen = Math.hypot(aimX, aimZ)
    let dx: number
    let dz: number
    if (alen > 0.2 && alen < 1.5) {
      // 约定：传入单位方向（长度约 1）
      dx = aimX
      dz = aimZ
    } else {
      dx = aimX - px
      dz = aimZ - pz
    }
    const len = Math.hypot(dx, dz)
    if (len < 1e-4) return { x: 0, z: -1 }
    return { x: dx / len, z: dz / len }
  }

  private killKind(t: Hittable): 'small' | 'brute' | 'elite' | 'boss' {
    const tag = t as Hittable & { kind?: string; elite?: boolean; boss?: boolean }
    if (tag.kind === 'boss' || tag.boss) return 'boss'
    if (tag.kind === 'elite' || tag.elite) return 'elite'
    if (tag.kind === 'brute') return 'brute'
    if (t.radius >= 1.2) return 'boss'
    if (t.radius >= 0.58) return 'brute'
    return 'small'
  }

  /** 清空风格/觉醒依赖的短状态（换层、读档、重试、换风格） */
  private clearBuildTransient(): void {
    this.resonanceMarks.clear()
    this.foamMarks.clear()
    this.resonanceFields.length = 0
    this.bleeds.clear()
    this.minionExpiryQueue.length = 0
    this.soloTarget = null
    this.soloStacks = 0
    this.soloTimer = 0
    this.murasameAttackCount = 0
    this.lastFishTarget = null
    this.resourceValue = 0
    this.transformTime = 0
    this.pulseLeft = 0
    this.encoreExtension = 0
    this.mods = { ...IDENTITY_MODS }
  }

  private clearTransient(): void {
    this.projectiles.clear()
    this.minions.clear()
    this.characterFx.clearTransient()
    this.pendingBursts.length = 0
    for (let i = this.rice.length - 1; i >= 0; i--) {
      const r = this.rice[i]
      this.scene.remove(r.mesh)
      r.mesh.geometry.dispose()
      ;(r.mesh.material as THREE.Material).dispose()
    }
    this.rice.length = 0
  }

  dispose(): void {
    this.clearTransient()
    this.clearBuildTransient()
    this.projectiles.dispose()
    this.minions.dispose()
    this.characterFx.dispose()
    disposeProjectileArt()
    disposeMinionArt()
  }
}
