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
import { ProjectileSystem, type ProjectileHitContext } from './projectiles'
import { MinionSystem, type Minion } from './minions'
import { getBillboardYaw } from '../art/sprites'
import { createProjectileMesh, disposeProjectileArt, type ProjectileArtKind } from '../art/projectiles'
import { disposeMinionArt } from '../art/minions'
import { pickConeTargets, pickLineTargets, gatherTo, pullToward } from './attack'

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
}

interface Effect {
  mesh: THREE.Mesh
  life: number
  maxLife: number
  grow: number
  opacity: number
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

  /** 普攻冷却（秒），tryAttack/update 内部按 dt 递减 */
  private cooldownLeft = 0
  /** 硬直：丛雨突进后 0.2s 不能攻击 */
  private lockedLeft = 0
  /** Mortis 变身剩余时间 */
  private transformTime = 0
  private pulseLeft = 0
  private mods = { ...IDENTITY_MODS }
  private readonly effects: Effect[] = []
  private readonly rice: RiceDrop[] = []
  private riceTimer = 0
  private readonly pendingBursts: PendingBurst[] = []

  constructor(scene: THREE.Scene, hooks: CombatHooks) {
    this.scene = scene
    this.hooks = hooks
    this.projectiles = new ProjectileSystem(scene, {
      resolveHit: (t, damage, ctx) => this.applyProjectileHit(t, damage, ctx),
      burst: (x, z, color, count) => this.burstAt(x, z, color, count),
    })
    this.minions = new MinionSystem(scene, this.projectiles, {
      burst: (x, z, color, count) => this.burstAt(x, z, color, count),
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
    this.clearTransient()
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

  /** 击杀充能：game.ts 在击杀结算里调 */
  onKill(t: Hittable): void {
    const kind = this.killKind(t)
    const base = CHARGE_PER_KILL[kind]
    const charMul = CHARACTERS[this.charId]?.chargeGainMul ?? 1
    this.meter.add(base * charMul * (1 + Math.max(0, this.stats.chargeGain)))
  }

  /** 每层开始：清场 + 起手充能（层间 50%） */
  resetLayer(chargeRatio: number): void {
    this.clearTransient()
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
    const interval = attackInterval(this.stats.stamina, def.attack.minInterval)
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
    const damage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), magic)
    const sizeMul = tierNum(tier, 'sizeMul', 1)
    const hitMul = tierNum(tier, 'hitRadiusMul', 1)

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
        range: baseRange * 1.25,
        hitRadius: 0.9,
        pierce: bounce > 0 ? 0 : 99,
        bounce,
        bounceMul: 0.8,
        bounceRange: 5,
        canCrit: true,
      })
      return
    }

    const count = Math.max(1, Math.floor(tierNum(tier, 'projectiles', 1)))
    const spread = (tierNum(tier, 'spread', 0) * Math.PI) / 180
    const bounce = Math.floor(tierNum(tier, 'bounce', 0))
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
        range: baseRange,
        hitRadius: 0.26 * hitMul,
        scale: sizeMul,
        pierce: 0,
        bounce,
        bounceMul,
        canCrit: true,
      })
    }
  }

  private attackMurasame(
    px: number,
    pz: number,
    dir: { x: number; z: number },
    tier: WeaponTier,
    world: CombatWorld,
  ): void {
    const def = CHARACTERS.murasame
    const range = skillRange(def.attack.baseRange, this.stats.intelligence) * tierNum(tier, 'radiusMul', 1)
    const damage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic)
    const targets = pickConeTargets(world.enemies, px, pz, dir.x, dir.z, range, def.attack.angle ?? 110, 8)
    const crit = rng.chance(this.stats.critChance)
    const amount = crit ? damage * this.stats.critMultiplier : damage
    if (crit) this.hooks.onSfx('crit')
    const gather = tierNum(tier, 'gatherOnHit', 0)
    const lifesteal = tierNum(tier, 'lifesteal', 0)
    let leeched = 0
    for (const t of targets) {
      const killed = t.hit(amount, dir.x * 2.2, dir.z * 2.2)
      if (gather > 0) pullToward(t, px, pz, gather)
      this.hooks.onHit(t, amount, crit, killed)
      if (lifesteal > 0) leeched += amount * lifesteal
    }
    if (lifesteal > 0 && leeched > 0) world.heal(leeched)
    this.spawnEffect(
      'slash',
      px + dir.x * range * 0.55,
      pz + dir.z * range * 0.55,
      Math.max(0.7, range / 2.6),
      0.18,
      0x9ff6e2,
    )
    // lv4+ 普攻带前冲
    const stepLen = tierNum(tier, 'stepOnAttack', 0)
    if (stepLen > 0) {
      const ext = world as CombatWorldExt
      if (typeof ext.movePlayer === 'function') ext.movePlayer(dir.x, dir.z, stepLen, 0.12)
      else world.dashPlayer(dir.x, dir.z, stepLen, 0.12)
    }
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
    const damage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic)
    const pierce = Math.floor(tierNum(tier, 'pierce', 0))
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
      hitRadius: 0.3 + pierce * 0.05,
      scale: 1 + pierce * 0.18,
      pierce,
      canCrit: true,
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
    this.transformTime = def.skill.duration ?? 8
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
      (p.pulseBaseRadius ?? 5.6) *
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
    this.spawnEffect('slash', px, pz, Math.max(1, radius / 2.2), 0.35, 0xd7b6ff)
    this.burstAt(px, pz, 0xd7b6ff, 30)
    this.burstAt(px, pz, 0x8a5cff, 18)
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
    const distance = p.distance ?? 7.5
    const end = world.clamp(px + dir.x * distance, pz + dir.z * distance)
    const width = p.pathWidth ?? 1.8
    const hits = pickLineTargets(world.enemies, px, pz, end.x, end.z, width)
    const skillMul = tierNum(tier, 'skillDamageMul', 1)
    const amount = hitDamage(p.damage ?? 45, this.stats.magic) * skillMul
    const crit = rng.chance(this.stats.critChance)
    const dmg = crit ? amount * this.stats.critMultiplier : amount
    if (crit) this.hooks.onSfx('crit')
    for (const t of hits) {
      const killed = t.hit(dmg, dir.x * 1.2, dir.z * 1.2)
      this.hooks.onHit(t, dmg, crit, killed)
    }
    // 终点聚怪：2.4m 内全部拉到终点附近
    const gatherRadius = p.gatherRadius ?? 2.4
    for (const t of world.enemies) {
      if (!t.alive) continue
      if (Math.hypot(t.x - end.x, t.z - end.z) > gatherRadius) continue
      gatherTo(t, end.x, end.z, 0.9)
    }
    const heal = tierNum(tier, 'skillHeal', p.heal ?? 15) + (hits.length >= 3 ? 5 : 0)
    world.heal(heal)
    world.grantInvuln(p.invulnerable ?? 0.3)
    world.dashPlayer(dir.x, dir.z, distance, p.dashDuration ?? 0.24)
    this.lockedLeft = Math.max(this.lockedLeft, p.recovery ?? 0.2)
    this.spawnEffect('slash', end.x, end.z, 1.6, 0.3, 0xbffcf0)
    this.burstAt(end.x, end.z, 0xbffcf0, 16)
    this.hooks.onSfx('dash')
    this.hooks.onSfx('skill')
  }

  private skillSummon(px: number, pz: number, tier: WeaponTier, world: CombatWorld): void {
    const def = CHARACTERS.fish
    const p = def.skill.params
    const count = Math.max(1, Math.floor(tierNum(tier, 'minionCount', p.count ?? 3)))
    const baseDamage = hitDamage(tierNum(tier, 'damage', def.attack.baseDamage), this.stats.magic)
    const specs = []
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + 0.4
      specs.push({
        x: px + Math.cos(ang) * 1.15,
        z: pz + Math.sin(ang) * 1.15,
        hp: Math.max(1, this.stats.maxHp * (p.minionHpRatio ?? 0.35)),
        damage: baseDamage * (p.minionDamageRatio ?? 0.4),
        interval: p.minionInterval ?? 0.6,
        speed: p.minionSpeed ?? 5.2,
        followRange: 5,
        range: p.minionRange ?? 7,
        duration: def.skill.duration ?? 10,
        bubbleSpeed: 9,
        bubbleRange: p.minionRange ?? 7,
        bubbleHitRadius: 0.3,
        scale: 1,
        taunt: tierNum(tier, 'minionTaunt', 0) > 0,
        slow: tierNum(tier, 'minionSlow', 0) > 0 ? tierNum(tier, 'minionSlow', 0) : undefined,
      })
    }
    this.minions.spawn(specs)
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
    this.burstAt(px, pz, 0x9fe8ff, 18)
    this.hooks.onSfx('summon')
  }

  // ───────────────────────── 每帧 ─────────────────────────

  update(dt: number, px: number, pz: number, world: CombatWorld): void {
    const step = Math.max(0, Math.min(dt, 0.1))
    this.cooldownLeft = Math.max(0, this.cooldownLeft - step)
    this.lockedLeft = Math.max(0, this.lockedLeft - step)

    if (this.transformTime > 0) {
      this.transformTime -= step
      if (this.transformTime <= 0) {
        this.transformTime = 0
        this.mods = { ...IDENTITY_MODS }
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
    this.updateEffects(step)
    this.flushBursts(world)
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
    const radius =
      (p.pulseBaseRadius ?? 5.6) *
      (this.stats.intelligence / 100) *
      tierNum(tier, 'mortisRadiusMul', 1)
    const amount = hitDamage(p.pulseBaseDamage ?? 11, this.stats.magic) * tierNum(tier, 'mortisPulseMul', 1)
    const lifesteal = tierNum(tier, 'mortisLifesteal', 0)
    let drained = 0
    for (const t of world.enemies) {
      if (!t.alive) continue
      if (Math.hypot(t.x - px, t.z - pz) > radius + t.radius) continue
      const killed = t.hit(amount, 0, 0)
      drained += amount
      this.slowTarget(t, p.slow ?? 0, p.slowDuration ?? 0.15)
      this.hooks.onHit(t, amount, false, killed)
    }
    if (lifesteal > 0 && drained > 0) world.heal(drained * lifesteal)
    this.spawnEffect('slash', px, pz, Math.max(0.8, radius / 3.2), 0.22, 0xd7b6ff)
    this.burstAt(px, pz, 0xbf8dff, 6)
  }

  private applyProjectileHit(t: Hittable, damage: number, ctx: ProjectileHitContext): void {
    const crit = ctx.canCrit && rng.chance(this.stats.critChance)
    const amount = crit ? damage * this.stats.critMultiplier : damage
    const killed = t.hit(amount, ctx.dirX * 1.4, ctx.dirZ * 1.4)
    if (ctx.slow && ctx.slow > 0) this.slowTarget(t, ctx.slow, 0.8)
    if (crit) this.hooks.onSfx('crit')
    this.hooks.onHit(t, amount, crit, killed)
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

  private spawnEffect(
    kind: ProjectileArtKind,
    x: number,
    z: number,
    scale: number,
    life: number,
    color: number,
  ): void {
    const mesh = createProjectileMesh(kind, scale, { color, additive: true })
    mesh.position.set(x, 0.35, z)
    mesh.rotation.set(0, getBillboardYaw(), 0)
    this.scene.add(mesh)
    this.effects.push({ mesh, life, maxLife: life, grow: 0.9, opacity: 0.9 })
  }

  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      e.life -= dt
      const t = 1 - Math.max(0, e.life) / e.maxLife
      e.mesh.scale.multiplyScalar(1 + e.grow * dt)
      const mat = e.mesh.material as THREE.MeshBasicMaterial
      mat.opacity = e.opacity * (1 - t)
      if (e.life <= 0) {
        this.scene.remove(e.mesh)
        e.mesh.geometry.dispose()
        mat.dispose()
        this.effects.splice(i, 1)
      }
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

  private clearTransient(): void {
    this.projectiles.clear()
    this.minions.clear()
    this.pendingBursts.length = 0
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]
      this.scene.remove(e.mesh)
      e.mesh.geometry.dispose()
      ;(e.mesh.material as THREE.Material).dispose()
    }
    this.effects.length = 0
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
    this.projectiles.dispose()
    this.minions.dispose()
    disposeProjectileArt()
    disposeMinionArt()
  }
}
