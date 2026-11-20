/**
 * 敌人威胁原型数据骨架（P1 骨架版，未接入战斗 / 实体）。
 *
 * 约束（HANDOFF §2.6 / §5 P1）：
 * - 纯数据层：不 import three.js、不碰 DOM。
 * - 所有数值集中为顶部 TODO 常量，待 P1 实装与手感测试时统一调参。
 * - 玩家已取消冲刺，所有原型动作必须能在无冲刺前提下靠走位化解（charger 前摇 >= 800ms）。
 */

/* ── TODO 占位数值常量（统一放顶部，P1 调参时只改这里） ────────── */

/** 近战攻击距离参考口径（TODO: 接入时与 gameConfig.player.attackRadius 对齐） */
export const TODO_MELEE_ATTACK_RANGE = 2.7

/** 远程压制（ranged-pressure）TODO 常量 */
export const TODO_RANGED_PREFERRED_RANGE = 8.0 // TODO: 必须严格大于近战攻击距离
export const TODO_RANGED_WINDUP_MS = 500 // TODO
export const TODO_RANGED_COOLDOWN_MS = 1600 // TODO

/** 封路（blocker）TODO 常量 */
export const TODO_BLOCKER_PREFERRED_RANGE = 3.2 // TODO
export const TODO_BLOCKER_WINDUP_MS = 600 // TODO
export const TODO_BLOCKER_COOLDOWN_MS = 2400 // TODO

/** 冲锋线（charger）TODO 常量：硬约束 windup >= 800ms（无冲刺可走位躲避） */
export const TODO_CHARGER_PREFERRED_RANGE = 6.5 // TODO
export const TODO_CHARGER_WINDUP_MS = 900 // TODO: 不可低于 800ms
export const TODO_CHARGER_COOLDOWN_MS = 2200 // TODO

/** 召唤（summoner）TODO 常量 */
export const TODO_SUMMONER_PREFERRED_RANGE = 9.0 // TODO
export const TODO_SUMMONER_WINDUP_MS = 700 // TODO
export const TODO_SUMMONER_COOLDOWN_MS = 3500 // TODO

/** 自爆（bomber）TODO 常量 */
export const TODO_BOMBER_PREFERRED_RANGE = 1.6 // TODO
export const TODO_BOMBER_WINDUP_MS = 650 // TODO
export const TODO_BOMBER_COOLDOWN_MS = 1000 // TODO

/* ── 类型与 5 类原型骨架 ────────────────────────────────────────── */

export type EnemyArchetypeId =
  | 'ranged-pressure'
  | 'blocker'
  | 'charger'
  | 'summoner'
  | 'bomber'

export interface EnemyArchetypeDef {
  readonly id: EnemyArchetypeId
  readonly name: string
  /** 期望作战距离（米） */
  readonly preferredRange: number
  /** 攻击前摇时长（毫秒） */
  readonly windupMs: number
  /** 两次动作之间的冷却（毫秒） */
  readonly cooldownMs: number
  /** 威胁分工标签（供刷怪编排 / AI / UI 识别） */
  readonly tags: readonly string[]
}

export const ENEMY_ARCHETYPES: readonly EnemyArchetypeDef[] = [
  {
    id: 'ranged-pressure',
    name: '远程压制',
    preferredRange: TODO_RANGED_PREFERRED_RANGE,
    windupMs: TODO_RANGED_WINDUP_MS,
    cooldownMs: TODO_RANGED_COOLDOWN_MS,
    tags: ['ranged', 'pressure', 'projectile'],
  },
  {
    id: 'blocker',
    name: '封路',
    preferredRange: TODO_BLOCKER_PREFERRED_RANGE,
    windupMs: TODO_BLOCKER_WINDUP_MS,
    cooldownMs: TODO_BLOCKER_COOLDOWN_MS,
    tags: ['blocker', 'zone-control', 'hazard'],
  },
  {
    id: 'charger',
    name: '冲锋线',
    preferredRange: TODO_CHARGER_PREFERRED_RANGE,
    windupMs: TODO_CHARGER_WINDUP_MS,
    cooldownMs: TODO_CHARGER_COOLDOWN_MS,
    tags: ['charger', 'telegraph', 'line-attack'],
  },
  {
    id: 'summoner',
    name: '召唤',
    preferredRange: TODO_SUMMONER_PREFERRED_RANGE,
    windupMs: TODO_SUMMONER_WINDUP_MS,
    cooldownMs: TODO_SUMMONER_COOLDOWN_MS,
    tags: ['summoner', 'backline', 'priority'],
  },
  {
    id: 'bomber',
    name: '自爆',
    preferredRange: TODO_BOMBER_PREFERRED_RANGE,
    windupMs: TODO_BOMBER_WINDUP_MS,
    cooldownMs: TODO_BOMBER_COOLDOWN_MS,
    tags: ['bomber', 'kamikaze', 'aoe'],
  },
]

const ARCHETYPE_MAP: ReadonlyMap<EnemyArchetypeId, EnemyArchetypeDef> = new Map(
  ENEMY_ARCHETYPES.map((def) => [def.id, def]),
)

export function archetypeOf(id: EnemyArchetypeId): EnemyArchetypeDef {
  const def = ARCHETYPE_MAP.get(id)
  if (!def) throw new Error(`未知敌人原型: ${String(id)}`)
  return def
}
