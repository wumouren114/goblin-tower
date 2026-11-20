/**
 * 敌人行为状态机与纯函数式寻路/选敌工具（P1 骨架版，未接入战斗）。
 *
 * 约束：
 * - 纯逻辑层：不 import three.js、不碰 DOM。
 * - 状态集合：chase / windup / attack / recover / reposition / dead。
 * - 非法状态转移一律抛出 Error，防止隐式跳态导致卡死或逃逸状态机。
 */
import type { EnemyArchetypeDef } from '../data/enemyArchetypes'
import { TODO_MELEE_ATTACK_RANGE } from '../data/enemyArchetypes'

/* ── TODO 占位时长与移动参数（集中放顶部，P1 接入时调参） ──────── */

export const TODO_ATTACK_DURATION_MS = 250 // TODO
export const TODO_RECOVER_DURATION_MS = 400 // TODO
export const TODO_REPOSITION_DURATION_MS = 600 // TODO
export const TODO_STOPPING_TOLERANCE = 0.6 // TODO
export const TODO_DETOUR_PROBE_DIST = 2.0 // TODO

/* ── 状态机定义 ─────────────────────────────────────────────────── */

export type EnemyBehaviorState =
  | 'chase'
  | 'windup'
  | 'attack'
  | 'recover'
  | 'reposition'
  | 'dead'

export const ENEMY_BEHAVIOR_STATES: readonly EnemyBehaviorState[] = [
  'chase',
  'windup',
  'attack',
  'recover',
  'reposition',
  'dead',
]

export interface EnemyStateSpec {
  readonly state: EnemyBehaviorState
  /** 进入该状态的语义条件 */
  readonly enterCondition: string
  /** 默认持续时长（ms）；null 表示由外部条件或原型字段驱动 */
  readonly durationMs: number | null
  /** 是否允许被硬直/击退/重选目标打断（死亡除外，死亡永远最高优先级） */
  readonly interruptible: boolean
  /** 合法的出边状态集合 */
  readonly allowedTransitions: readonly EnemyBehaviorState[]
}

export const ENEMY_STATE_SPECS: Record<EnemyBehaviorState, EnemyStateSpec> = {
  chase: {
    state: 'chase',
    enterCondition: '存活且目标超出偏好作战距离或技能仍在冷却中',
    durationMs: null,
    interruptible: true,
    allowedTransitions: ['windup', 'reposition', 'dead'],
  },
  windup: {
    state: 'windup',
    enterCondition: '目标进入偏好作战距离且冷却归零，开始前摇读条（时长取 archetype.windupMs）',
    durationMs: null,
    interruptible: true,
    allowedTransitions: ['attack', 'chase', 'reposition', 'dead'],
  },
  attack: {
    state: 'attack',
    enterCondition: '前摇读条结束，正式执行原型招式/发射/冲锋/召唤/引爆',
    durationMs: TODO_ATTACK_DURATION_MS,
    interruptible: false,
    allowedTransitions: ['recover', 'dead'],
  },
  recover: {
    state: 'recover',
    enterCondition: '攻击帧结束，进入后摇硬直',
    durationMs: TODO_RECOVER_DURATION_MS,
    interruptible: false,
    allowedTransitions: ['reposition', 'chase', 'dead'],
  },
  reposition: {
    state: 'reposition',
    enterCondition: '后摇结束需拉扯距离，或冷却中与目标过近需要走位换位',
    durationMs: TODO_REPOSITION_DURATION_MS,
    interruptible: true,
    allowedTransitions: ['chase', 'windup', 'dead'],
  },
  dead: {
    state: 'dead',
    enterCondition: '生命值归零（hp <= 0），终态不可再转移',
    durationMs: null,
    interruptible: false,
    allowedTransitions: [],
  },
}

export interface EnemyStateMachine {
  readonly state: EnemyBehaviorState
  readonly elapsedMs: number
  readonly durationMs: number
  readonly cooldownLeftMs: number
}

export interface EnemyStepContext {
  readonly hp: number
  readonly hasTarget: boolean
  readonly distanceToTarget: number
  readonly rangeTolerance?: number
}

function defaultDurationFor(state: EnemyBehaviorState, archetype?: EnemyArchetypeDef): number {
  if (state === 'windup') return archetype ? archetype.windupMs : 0
  return ENEMY_STATE_SPECS[state].durationMs ?? 0
}

export function createEnemyStateMachine(
  initial: EnemyBehaviorState = 'chase',
  archetype?: EnemyArchetypeDef,
): EnemyStateMachine {
  if (!(initial in ENEMY_STATE_SPECS)) {
    throw new Error(`非法初始状态: ${String(initial)}`)
  }
  return {
    state: initial,
    elapsedMs: 0,
    durationMs: defaultDurationFor(initial, archetype),
    cooldownLeftMs: 0,
  }
}

export function canTransitionState(from: EnemyBehaviorState, to: EnemyBehaviorState): boolean {
  const spec = ENEMY_STATE_SPECS[from]
  if (!spec) return false
  return spec.allowedTransitions.includes(to)
}

/**
 * 显式状态转移（纯函数）。
 * 非法转移直接抛出 Error，保证状态机拓扑严格受控。
 */
export function transitionState(
  machine: EnemyStateMachine,
  next: EnemyBehaviorState,
  archetype?: EnemyArchetypeDef,
  cooldownLeftMs?: number,
): EnemyStateMachine {
  if (!canTransitionState(machine.state, next)) {
    throw new Error(`非法状态转移: ${machine.state} -> ${next}`)
  }
  return {
    state: next,
    elapsedMs: 0,
    durationMs: defaultDurationFor(next, archetype),
    cooldownLeftMs: cooldownLeftMs ?? machine.cooldownLeftMs,
  }
}

/**
 * 推进一帧状态机（纯函数）。
 * 任意存活状态在目标可达的前提下，均会在有限帧内进入 attack（或因 hp<=0 进入 dead）。
 */
export function stepEnemyBehavior(
  machine: EnemyStateMachine,
  archetype: EnemyArchetypeDef,
  ctx: EnemyStepContext,
  dtMs: number,
): EnemyStateMachine {
  const dt = Math.max(0, dtMs)
  if (machine.state === 'dead') return machine
  if (ctx.hp <= 0) return transitionState(machine, 'dead', archetype, 0)

  const elapsedMs = machine.elapsedMs + dt
  const cooldownLeftMs = Math.max(0, machine.cooldownLeftMs - dt)
  const current: EnemyStateMachine = {
    ...machine,
    elapsedMs,
    cooldownLeftMs,
  }

  const tol = ctx.rangeTolerance ?? TODO_STOPPING_TOLERANCE
  const inAttackRange = ctx.hasTarget && ctx.distanceToTarget <= archetype.preferredRange + tol

  switch (current.state) {
    case 'chase': {
      if (inAttackRange && cooldownLeftMs <= 0) {
        return transitionState(current, 'windup', archetype, 0)
      }
      return current
    }
    case 'windup': {
      const windupDuration = current.durationMs > 0 ? current.durationMs : archetype.windupMs
      if (elapsedMs >= windupDuration) {
        return transitionState(current, 'attack', archetype, archetype.cooldownMs)
      }
      return current
    }
    case 'attack': {
      const attackDuration = current.durationMs > 0 ? current.durationMs : TODO_ATTACK_DURATION_MS
      if (elapsedMs >= attackDuration) {
        return transitionState(current, 'recover', archetype, cooldownLeftMs)
      }
      return current
    }
    case 'recover': {
      const recoverDuration = current.durationMs > 0 ? current.durationMs : TODO_RECOVER_DURATION_MS
      if (elapsedMs >= recoverDuration) {
        const next: EnemyBehaviorState =
          archetype.preferredRange > TODO_MELEE_ATTACK_RANGE ? 'reposition' : 'chase'
        return transitionState(current, next, archetype, cooldownLeftMs)
      }
      return current
    }
    case 'reposition': {
      const repoDuration =
        current.durationMs > 0 ? current.durationMs : TODO_REPOSITION_DURATION_MS
      if (elapsedMs >= repoDuration) {
        const next: EnemyBehaviorState = inAttackRange && cooldownLeftMs <= 0 ? 'windup' : 'chase'
        return transitionState(current, next, archetype, cooldownLeftMs)
      }
      return current
    }
    case 'dead':
      return current
  }
}

/* ── 纯函数式工具：选目标 / 算朝向 / 保持距离 / 绕行 ─────────────── */

export interface Vec2 {
  readonly x: number
  readonly z: number
}

export interface TargetCandidate extends Vec2 {
  readonly id: string
  readonly alive: boolean
  /** 仇恨/嘲讽优先级（越大越优先，默认 0） */
  readonly priority?: number
}

export interface CircleObstacle extends Vec2 {
  readonly radius: number
}

export interface FacingResult {
  readonly dx: number
  readonly dz: number
  readonly yaw: number
  readonly distance: number
}

export interface DistanceSteerResult {
  readonly dx: number
  readonly dz: number
  readonly mode: 'approach' | 'hold' | 'retreat'
  readonly distance: number
}

function normalize(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z)
  if (len <= 1e-6) return { x: 0, z: 0 }
  return { x: x / len, z: z / len }
}

/** 选目标：过滤存活候选，按 priority 降序，同优先级取欧氏距离最近者 */
export function selectTarget(
  origin: Vec2,
  candidates: readonly TargetCandidate[],
): TargetCandidate | null {
  let best: TargetCandidate | null = null
  let bestPriority = -Infinity
  let bestDistSq = Infinity

  for (const c of candidates) {
    if (!c.alive) continue
    const prio = c.priority ?? 0
    const dx = c.x - origin.x
    const dz = c.z - origin.z
    const distSq = dx * dx + dz * dz
    if (prio > bestPriority || (prio === bestPriority && distSq < bestDistSq)) {
      best = c
      bestPriority = prio
      bestDistSq = distSq
    }
  }
  return best
}

/** 计算从 origin 指向 target 的单位朝向、偏航角（atan2(dx, dz)）与距离 */
export function computeFacing(origin: Vec2, target: Vec2): FacingResult {
  const rx = target.x - origin.x
  const rz = target.z - origin.z
  const distance = Math.hypot(rx, rz)
  if (distance <= 1e-6) {
    return { dx: 0, dz: 1, yaw: 0, distance: 0 }
  }
  const dx = rx / distance
  const dz = rz / distance
  return { dx, dz, yaw: Math.atan2(dx, dz), distance }
}

/**
 * 保持距离（stopping distance）：
 * - distance > preferredRange + tolerance → approach（靠近）
 * - distance < preferredRange - tolerance → retreat（后撤拉开）
 * - 区间内 → hold（驻停）
 */
export function maintainDistance(
  origin: Vec2,
  target: Vec2,
  preferredRange: number,
  tolerance: number = TODO_STOPPING_TOLERANCE,
): DistanceSteerResult {
  const facing = computeFacing(origin, target)
  const tol = Math.max(0, tolerance)
  if (facing.distance > preferredRange + tol) {
    return { dx: facing.dx, dz: facing.dz, mode: 'approach', distance: facing.distance }
  }
  if (facing.distance < Math.max(0, preferredRange - tol)) {
    return { dx: -facing.dx, dz: -facing.dz, mode: 'retreat', distance: facing.distance }
  }
  return { dx: 0, dz: 0, mode: 'hold', distance: facing.distance }
}

/**
 * 绕行（局部避障）：沿 desiredDir 前瞻 probeDist，若被最近圆形障碍阻挡，
 * 则切向偏移绕开障碍物中心，返回归一化方向。
 */
export function computeDetourDirection(
  origin: Vec2,
  desiredDir: Vec2,
  selfRadius: number,
  obstacles: readonly CircleObstacle[],
  probeDist: number = TODO_DETOUR_PROBE_DIST,
): Vec2 {
  const dir = normalize(desiredDir.x, desiredDir.z)
  if (dir.x === 0 && dir.z === 0) return dir

  let nearestHit: { obs: CircleObstacle; proj: number; cross: number } | null = null

  for (const obs of obstacles) {
    const ox = obs.x - origin.x
    const oz = obs.z - origin.z
    const proj = ox * dir.x + oz * dir.z
    const clearance = Math.max(0, selfRadius) + Math.max(0, obs.radius)
    if (proj <= -clearance || proj > probeDist + clearance) continue
    // 有向垂距（cross > 0 表示障碍在右侧，应向左绕）
    const cross = dir.x * oz - dir.z * ox
    if (Math.abs(cross) >= clearance) continue
    if (!nearestHit || proj < nearestHit.proj) {
      nearestHit = { obs, proj, cross }
    }
  }

  if (!nearestHit) return dir

  // 垂直于 dir 的左右切向量：(-dir.z, dir.x) 与 (dir.z, -dir.x)
  const side = nearestHit.cross >= 0 ? -1 : 1
  const tx = -dir.z * side
  const tz = dir.x * side
  return normalize(dir.x * 0.35 + tx * 0.95, dir.z * 0.35 + tz * 0.95)
}
