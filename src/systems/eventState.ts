/**
 * 事件运行时状态：线索 / 标记 / 伏笔 / 记忆碎片。
 *
 * 纯数据层（不碰 DOM、three.js），可存档、可在 sim 里断言。
 * 伏笔的口径见 docs/11：**挂上不等于兑现**——后续事件没出现，就"不了了之"。
 */
import type { EventOption, EventOutcome, EventRole } from '../data/events'
import type { Rng } from '../core/rng'

export interface EventSnapshot {
  flags: string[]
  arcs: { id: string; layer: number }[]
  memories: string[]
  clues: string[]
}

export class EventState {
  private readonly flagSet = new Set<string>()
  private readonly arcMap = new Map<string, number>()
  private readonly memorySet = new Set<string>()
  private readonly clueSet = new Set<string>()

  hasFlag(id: string): boolean {
    return this.flagSet.has(id)
  }

  addFlag(id: string): void {
    this.flagSet.add(id)
  }

  addClue(id: string): void {
    this.clueSet.add(id)
  }

  hasClue(id: string): boolean {
    return this.clueSet.has(id)
  }

  /** 挂一条伏笔；层数用于"已经挂了几层"，方便将来做超时失效 */
  addArc(id: string, layer: number): void {
    if (!this.arcMap.has(id)) this.arcMap.set(id, layer)
  }

  hasArc(id: string): boolean {
    return this.arcMap.has(id)
  }

  arcLayer(id: string): number | undefined {
    return this.arcMap.get(id)
  }

  /** 兑现一条伏笔：存在则消费并返回 true；不存在或已用过返回 false */
  takeArc(id: string): boolean {
    if (!this.arcMap.has(id)) return false
    this.arcMap.delete(id)
    return true
  }

  addMemory(id: string): void {
    this.memorySet.add(id)
  }

  get memories(): string[] {
    return [...this.memorySet]
  }

  get arcs(): { id: string; layer: number }[] {
    return [...this.arcMap].map(([id, layer]) => ({ id, layer }))
  }

  /** 选项是否可选：金币够、卡够、前置标记齐 */
  canPick(option: EventOption, ctx: { gold: number; cards: number }): boolean {
    if ((option.costGold ?? 0) > ctx.gold) return false
    if (option.costCard && ctx.cards <= 0) return false
    for (const need of option.requires ?? []) {
      if (need === 'memory:any') {
        if (this.memorySet.size === 0) return false
      } else if (!this.flagSet.has(need) && !this.clueSet.has(need)) {
        return false
      }
    }
    return true
  }

  /** 该选项在给定真身下的候选结果（role 为空的结果视为通用） */
  outcomesFor(option: EventOption, role: EventRole | null): EventOutcome[] {
    return option.outcomes.filter((o) => o.role === undefined || o.role === role)
  }

  /**
   * 抽一个结果。真身不匹配的结果会被过滤掉——所以"抽到哪个真身"直接决定了选项的上限。
   * 没有可用结果时返回 null（调用方按"什么都没发生"处理）。
   */
  pickOutcome(option: EventOption, role: EventRole | null, rng: Rng): EventOutcome | null {
    const pool = this.outcomesFor(option, role)
    if (pool.length === 0) return null
    return pool[rng.int(0, pool.length - 1)]
  }

  snapshot(): EventSnapshot {
    return {
      flags: [...this.flagSet],
      arcs: this.arcs,
      memories: [...this.memorySet],
      clues: [...this.clueSet],
    }
  }

  restore(data: EventSnapshot): void {
    this.flagSet.clear()
    this.arcMap.clear()
    this.memorySet.clear()
    this.clueSet.clear()
    for (const f of data.flags) this.flagSet.add(f)
    for (const a of data.arcs) this.arcMap.set(a.id, a.layer)
    for (const m of data.memories) this.memorySet.add(m)
    for (const c of data.clues) this.clueSet.add(c)
  }
}
