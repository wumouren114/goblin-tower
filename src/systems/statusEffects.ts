/**
 * 纯逻辑状态效果系统（不依赖 three.js / DOM / game.ts）。
 *
 * 使用内部累计毫秒时钟推进时间，不调用 Date.now()，便于确定性仿真与单测。
 */

export type StatusKind = 'stun' | 'mark'

export interface StatusApplyOptions {
  /** 同一目标同类状态的抗性窗口（毫秒）；0 表示不设抗性 */
  resistWindowMs?: number
  /** 标记最多叠几层（stun 固定 1 层） */
  maxStacks?: number
}

interface ActiveStatus {
  expiresAtMs: number
  stacks: number
}

interface ResistRecord {
  lastAppliedAtMs: number
  resistUntilMs: number
}

interface TargetBucket {
  active: Partial<Record<StatusKind, ActiveStatus>>
  resist: Partial<Record<StatusKind, ResistRecord>>
}

export class StatusField {
  private nowMs = 0
  private readonly targets = new Map<string, TargetBucket>()

  /**
   * 施加状态；被抗性挡住返回 false。成功时刷新持续时间；
   * mark 叠层时刷新持续时间且不重置层数；stun 固定最多 1 层。
   */
  apply(kind: StatusKind, targetId: string, durationMs: number, opts?: StatusApplyOptions): boolean {
    if (!targetId || !Number.isFinite(durationMs) || durationMs <= 0) {
      return false
    }

    const bucket = this.ensureBucket(targetId)
    const resist = bucket.resist[kind]
    const rawWindow = opts?.resistWindowMs

    if (resist !== undefined && rawWindow !== 0) {
      const requestedWindow = rawWindow !== undefined && Number.isFinite(rawWindow)
        ? Math.max(0, rawWindow)
        : 0
      const blockedByPriorWindow = this.nowMs < resist.resistUntilMs
      const blockedByRequestedWindow = requestedWindow > 0 && (this.nowMs - resist.lastAppliedAtMs) < requestedWindow
      if (blockedByPriorWindow || blockedByRequestedWindow) {
        return false
      }
    }

    const existing = bucket.active[kind]
    const isActive = existing !== undefined && existing.expiresAtMs > this.nowMs && existing.stacks > 0

    let nextStacks: number
    if (kind === 'stun') {
      nextStacks = 1
    } else {
      const rawMax = opts?.maxStacks
      const maxStacks = rawMax !== undefined && Number.isFinite(rawMax)
        ? Math.max(1, Math.floor(rawMax))
        : 1
      nextStacks = isActive ? Math.min(maxStacks, existing.stacks + 1) : 1
    }

    bucket.active[kind] = {
      expiresAtMs: this.nowMs + durationMs,
      stacks: nextStacks,
    }

    const effectiveWindow = rawWindow !== undefined && Number.isFinite(rawWindow)
      ? Math.max(0, rawWindow)
      : 0
    bucket.resist[kind] = {
      lastAppliedAtMs: this.nowMs,
      resistUntilMs: effectiveWindow > 0 ? this.nowMs + effectiveWindow : 0,
    }

    return true
  }

  has(kind: StatusKind, targetId: string): boolean {
    return this.getActive(kind, targetId) !== undefined
  }

  /** 剩余毫秒；没有返回 0 */
  remaining(kind: StatusKind, targetId: string): number {
    const entry = this.getActive(kind, targetId)
    return entry ? entry.expiresAtMs - this.nowMs : 0
  }

  /** 标记层数（stun 恒为 0 或 1） */
  stacks(kind: StatusKind, targetId: string): number {
    const entry = this.getActive(kind, targetId)
    return entry ? entry.stacks : 0
  }

  /** 消耗标记（结算时调用），返回消耗的层数 */
  consume(kind: StatusKind, targetId: string): number {
    const bucket = this.targets.get(targetId)
    if (!bucket) return 0
    const entry = bucket.active[kind]
    if (!entry || entry.expiresAtMs <= this.nowMs || entry.stacks <= 0) {
      delete bucket.active[kind]
      return 0
    }
    const consumed = entry.stacks
    delete bucket.active[kind]
    return consumed
  }

  /** 推进时间，移除到期状态；dtMs <= 0 不改变任何状态 */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return
    this.nowMs += dtMs

    for (const bucket of this.targets.values()) {
      for (const kind of Object.keys(bucket.active) as StatusKind[]) {
        const entry = bucket.active[kind]
        if (entry && entry.expiresAtMs <= this.nowMs) {
          delete bucket.active[kind]
        }
      }
    }
  }

  /** 目标死亡/离场时清理 */
  clear(targetId: string): void {
    this.targets.delete(targetId)
  }

  clearAll(): void {
    this.targets.clear()
    this.nowMs = 0
  }

  /** 当前所有带某状态的目标 id（渲染用） */
  targetsWith(kind: StatusKind): string[] {
    const result: string[] = []
    for (const [targetId, bucket] of this.targets.entries()) {
      const entry = bucket.active[kind]
      if (entry && entry.expiresAtMs > this.nowMs && entry.stacks > 0) {
        result.push(targetId)
      }
    }
    return result
  }

  private ensureBucket(targetId: string): TargetBucket {
    let bucket = this.targets.get(targetId)
    if (!bucket) {
      bucket = { active: {}, resist: {} }
      this.targets.set(targetId, bucket)
    }
    return bucket
  }

  private getActive(kind: StatusKind, targetId: string): ActiveStatus | undefined {
    const bucket = this.targets.get(targetId)
    if (!bucket) return undefined
    const entry = bucket.active[kind]
    if (!entry || entry.expiresAtMs <= this.nowMs || entry.stacks <= 0) {
      return undefined
    }
    return entry
  }
}
