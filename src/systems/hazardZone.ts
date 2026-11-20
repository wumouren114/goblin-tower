/**
 * 持续伤害区域（hazard zone）——「封路」原型的核心机制。
 *
 * 纯逻辑层：不 import three.js、不碰 DOM。渲染与接线由 game.ts 负责。
 * 口径（HANDOFF §2.9）：封路靠魔法类小怪铺持续伤害区域，不做实体挡路。
 */

export interface HazardSpec {
  /** 圆心（世界坐标） */
  x: number
  z: number
  /** 半径（米） */
  radius: number
  /** 每秒伤害（玩家站在区域内） */
  dps: number
  /** 存活时间（秒） */
  life: number
  /** 出现后多久开始生效（秒），用于给玩家反应时间 */
  armDelay?: number
}

export interface HazardState extends Required<HazardSpec> {
  /** 已经存在的时间 */
  age: number
  /** 累计但尚未结算的伤害 */
  pending: number
}

export interface HazardTick {
  /** 本帧应交给玩家结算的整数伤害（已含所有区域） */
  damage: number
  /** 玩家本帧是否站在任一区域内 */
  inside: boolean
  /** 本帧内到期的区域数量 */
  expired: number
}

const MIN_DPS = 0
const MIN_LIFE = 0

export class HazardField {
  private readonly zones: HazardState[] = []

  get count(): number {
    return this.zones.length
  }

  /** 当前所有区域（只读快照，渲染用） */
  get all(): readonly HazardState[] {
    return this.zones
  }

  spawn(spec: HazardSpec): HazardState {
    const zone: HazardState = {
      x: spec.x,
      z: spec.z,
      radius: Math.max(0.1, spec.radius),
      dps: Math.max(MIN_DPS, spec.dps),
      life: Math.max(MIN_LIFE, spec.life),
      armDelay: Math.max(0, spec.armDelay ?? 0),
      age: 0,
      pending: 0,
    }
    this.zones.push(zone)
    return zone
  }

  /** 清空（换层 / 重开时调用） */
  clear(): void {
    this.zones.length = 0
  }

  /**
   * 推进一帧：
   * - 年龄超过 life 的区域移除；
   * - 玩家在区域内时按 dps × dt 累计，累计满 1 点才结算（避免每帧掉小数被无敌帧吞掉）。
   */
  update(dt: number, player: { x: number; z: number }): HazardTick {
    let inside = false
    let expired = 0
    let damage = 0

    for (let i = this.zones.length - 1; i >= 0; i -= 1) {
      const zone = this.zones[i]
      zone.age += dt
      if (zone.age >= zone.life) {
        this.zones.splice(i, 1)
        expired += 1
        continue
      }
      if (zone.age < zone.armDelay) continue

      const dx = player.x - zone.x
      const dz = player.z - zone.z
      if (Math.hypot(dx, dz) > zone.radius) continue

      inside = true
      zone.pending += zone.dps * dt
      if (zone.pending >= 1) {
        const whole = Math.floor(zone.pending)
        zone.pending -= whole
        damage += whole
      }
    }

    return { damage, inside, expired }
  }
}
