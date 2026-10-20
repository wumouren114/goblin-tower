/**
 * 12 格背包：添加 / 丢弃 / 使用 / 合成（同名同级增益卡 → 下一级，数值 ×2）。
 * 合成上限来自数据层：增益卡按 tier（backpack.maxMergeTier）。
 * 纯数据层：不 import three.js、不碰 DOM。卡片面板统一由 `cards` 汇总。
 */
import type { CardStat, InventoryItem } from '../types'
import { BALANCE } from '../data/balance'
import { makeCardItem } from './economy'

interface BackpackCfg {
  slots: number
  maxMergeTier: 1 | 2 | 3
}

const BACKPACK = (BALANCE as unknown as { backpack: BackpackCfg }).backpack
const DEFAULT_SLOTS = BACKPACK.slots
const MAX_MERGE_TIER = BACKPACK.maxMergeTier

function tidy(v: number): number {
  return Number(v.toFixed(3))
}

/**
 * 两张物品能否合成（纯函数，HUD 与数据层共用同一份判定，避免两处规则漂移）。
 * - 增益卡：同 stat、同 tier，且 tier < backpack.maxMergeTier
 * - 消耗品：不合成
 */
export function canMergeItems(a: InventoryItem, b: InventoryItem): boolean {
  if (a.uid === b.uid) return false
  if (a.kind !== b.kind) return false
  if (a.kind !== 'buff-card') return false
  if (!a.stat || a.stat !== b.stat) return false
  if (a.tier !== b.tier) return false
  return a.tier < MAX_MERGE_TIER
}

export class Inventory {
  readonly items: InventoryItem[] = []
  private readonly capacity: number

  constructor(max: number = DEFAULT_SLOTS) {
    this.capacity = Math.max(1, Math.round(max))
  }

  get count(): number {
    return this.items.length
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity
  }

  /** 格子上限（HUD 显示 x/12 用） */
  get maxSlots(): number {
    return this.capacity
  }

  /** 五维汇总：只累计「已进背包」的增益卡（消耗品不进面板） */
  get cards(): Record<CardStat, number> {
    const acc: Record<CardStat, number> = {
      magic: 0,
      stamina: 0,
      intelligence: 0,
      hp: 0,
      moveSpeed: 0,
      chargeMax: 0,
      chargeGain: 0,
      dodge: 0,
      armor: 0,
      crit: 0,
    }
    for (const item of this.items) {
      if (item.kind !== 'buff-card' || !item.stat) continue
      if (typeof item.value !== 'number') continue
      acc[item.stat] = tidy(acc[item.stat] + item.value)
    }
    return acc
  }

  get(uid: string): InventoryItem | undefined {
    return this.items.find((it) => it.uid === uid)
  }

  add(item: InventoryItem): boolean {
    if (this.isFull) return false
    this.items.push(item)
    return true
  }

  /**
   * 购买/拾取入口：满包时先把可合成的两张自动合掉腾格子，再尝试放入。
   * @returns 是否成功进包；false 表示满包且没有可合成对（调用方应提示玩家丢弃/合成）
   */
  addOrMerge(item: InventoryItem): boolean {
    if (this.isFull) this.autoMerge()
    return this.add(item)
  }

  /** 丢弃：语义化 remove（丢弃不退金币，金币结算由调用方负责） */
  discard(uid: string): InventoryItem | null {
    return this.remove(uid)
  }

  remove(uid: string): InventoryItem | null {
    const index = this.items.findIndex((it) => it.uid === uid)
    if (index < 0) return null
    const [removed] = this.items.splice(index, 1)
    return removed
  }

  /** 两张同级同种可合成：判定见模块级 canMergeItems（HUD 复用同一份规则） */
  canMerge(uidA: string, uidB: string): boolean {
    const a = this.get(uidA)
    const b = this.get(uidB)
    if (!a || !b) return false
    return canMergeItems(a, b)
  }

  /**
   * 自动合成：反复找出当前可合成的两张（靠前格子优先）并合成，直到没有可合成对。
   * 每次合成净减少 1 格，所以循环上限取当前格数即可保证不死循环。
   * @returns 本次合成出的物品（按合成顺序，供上层提示/同步面板）
   */
  autoMerge(): InventoryItem[] {
    const merged: InventoryItem[] = []
    const guardLimit = this.items.length
    for (let guard = 0; guard < guardLimit; guard += 1) {
      const pair = this.findMergePair()
      if (!pair) break
      const item = this.merge(pair[0], pair[1])
      if (!item) break
      merged.push(item)
    }
    return merged
  }

  /** 找出第一对可合成的 uid（i<j，靠前格子优先）；没有则返回 null */
  private findMergePair(): [string, string] | null {
    for (let i = 0; i < this.items.length; i += 1) {
      for (let j = i + 1; j < this.items.length; j += 1) {
        if (canMergeItems(this.items[i], this.items[j])) {
          return [this.items[i].uid, this.items[j].uid]
        }
      }
    }
    return null
  }

  /** 合成：消耗两张增益卡，在靠前格子生成下一级；数值按「同名同级两份 → ×2」结算 */
  merge(uidA: string, uidB: string): InventoryItem | null {
    if (!this.canMerge(uidA, uidB)) return null
    const a = this.get(uidA)
    if (!a) return null
    const index = Math.min(
      this.items.findIndex((it) => it.uid === uidA),
      this.items.findIndex((it) => it.uid === uidB),
    )

    let merged: InventoryItem | null = null
    if (a.kind === 'buff-card') {
      const nextTier = Math.min(MAX_MERGE_TIER, a.tier + 1) as 1 | 2 | 3
      merged = makeCardItem(a.stat ?? '', nextTier)
      merged.value = tidy((a.value ?? 0) * 2)
    }
    if (!merged) return null

    this.remove(uidA)
    this.remove(uidB)
    this.items.splice(index, 0, merged)
    return merged
  }

  /** 使用消耗品：从背包移除并返回该物品，具体生效（回血/回充能）由 game.ts 结算 */
  use(uid: string): InventoryItem | null {
    const item = this.get(uid)
    if (!item || item.kind !== 'consumable') return null
    this.remove(uid)
    return item
  }
}
