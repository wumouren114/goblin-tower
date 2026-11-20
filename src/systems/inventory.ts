/**
 * 无格数上限背包（v5 P0-a）：
 * - 取消 18 格上限与二合一合成（删除 canMergeItems / canMerge / 合成逻辑）。
 * - 道具卡「同名唯一」：再拿到同名卡 = 原地升一档（蓝→紫→金），允许跳级直达更高档；
 *   已满金（tier 3）时不再重复入包，返回 false。
 * - 消耗品可无限持有，use() 消耗并返回。
 * 纯数据层：不 import three.js、不碰 DOM。卡片面板统一由 `cards` 汇总。
 */
import type { CardStat, InventoryItem } from '../types'
import { cardIdOfItem } from '../data/cards'
import { emptyCards, makeCardItem } from './economy'

function tidy(v: number): number {
  return Number(v.toFixed(3))
}

export class Inventory {
  readonly items: InventoryItem[] = []

  constructor() {
    // 背包取消格数上限（P0-a §2.2）
  }

  get count(): number {
    return this.items.length
  }

  /** 背包不限格，永不为满 */
  get isFull(): boolean {
    return false
  }

  /**
   * @deprecated P0-a 已取消背包格数上限；仅保留只读属性兼容未改动的 game.ts，待 B 线清理后移除。
   */
  get maxSlots(): number {
    return Number.POSITIVE_INFINITY
  }

  /** 五维汇总：只累计「已进背包」的增益卡（消耗品与未并入 CardStat 的 hpRegen 不进此表） */
  get cards(): Record<CardStat, number> {
    const acc = emptyCards()
    for (const item of this.items) {
      if (item.kind !== 'buff-card' || !item.stat) continue
      if (typeof item.value !== 'number') continue
      acc[item.stat] = tidy(acc[item.stat] + item.value)
    }
    return acc
  }

  /** 生命之源（hpRegen）每 5 秒回复的最大生命比例（未持有返回 0） */
  get hpRegen(): number {
    for (const item of this.items) {
      if (item.kind === 'buff-card' && cardIdOfItem(item) === 'hpRegen' && typeof item.value === 'number') {
        return item.value
      }
    }
    return 0
  }

  get(uid: string): InventoryItem | undefined {
    return this.items.find((it) => it.uid === uid)
  }

  /** 查询某张卡当前持有的档位（0=未持有，1=蓝，2=紫，3=金） */
  tierOf(cardId: string): 0 | 1 | 2 | 3 {
    const existing = this.items.find((it) => it.kind === 'buff-card' && cardIdOfItem(it) === cardId)
    return existing ? existing.tier : 0
  }

  /** 当前已持有的全部道具卡档位快照（供商店池过滤与出档使用） */
  heldTiers(): Partial<Record<string, 1 | 2 | 3>> {
    const map: Partial<Record<string, 1 | 2 | 3>> = {}
    for (const item of this.items) {
      if (item.kind !== 'buff-card') continue
      const id = cardIdOfItem(item)
      if (id) map[id] = item.tier
    }
    return map
  }

  /** 当前持有的全部道具卡列表 */
  ownedCards(): InventoryItem[] {
    return this.items.filter((it) => it.kind === 'buff-card')
  }

  /**
   * 放入物品：
   * - 消耗品：直接加入（不限格）。
   * - 道具卡：同名唯一；若已持有同名卡，原地升档（至少 +1 档，跳级卡直达目标档，最高金档 3）；
   *   若该卡已满金（tier 3），返回 false 且不重复入包。
   */
  add(item: InventoryItem): boolean {
    if (item.kind !== 'buff-card') {
      this.items.push(item)
      return true
    }

    const cardId = cardIdOfItem(item)
    if (!cardId) {
      this.items.push(item)
      return true
    }

    const existingIdx = this.items.findIndex(
      (entry) => entry.kind === 'buff-card' && cardIdOfItem(entry) === cardId,
    )
    if (existingIdx < 0) {
      this.items.push(item)
      return true
    }

    const existing = this.items[existingIdx]
    if (existing.tier >= 3) return false

    const targetTier = Math.min(3, Math.max(existing.tier + 1, item.tier)) as 1 | 2 | 3
    const upgraded = makeCardItem(cardId, targetTier)
    this.items[existingIdx] = { ...upgraded, uid: existing.uid }
    return true
  }

  /**
   * 原地替换指定 uid 的道具卡（供商人「交换」使用）。
   * 拒绝将卡牌替换为背包中已持有的同名卡，保证同名唯一不变式。
   */
  replaceCard(uid: string, nextItem: InventoryItem): boolean {
    if (nextItem.kind !== 'buff-card') return false
    const idx = this.items.findIndex((it) => it.uid === uid)
    if (idx < 0 || this.items[idx].kind !== 'buff-card') return false
    const nextId = cardIdOfItem(nextItem)
    if (nextId) {
      const conflict = this.items.some(
        (it, i) => i !== idx && it.kind === 'buff-card' && cardIdOfItem(it) === nextId,
      )
      if (conflict) return false
    }
    this.items[idx] = { ...nextItem, uid }
    return true
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

  /** 使用消耗品：从背包移除并返回该物品，具体生效（回血/回充能）由 game.ts 结算 */
  use(uid: string): InventoryItem | null {
    const item = this.get(uid)
    if (!item || item.kind !== 'consumable') return null
    this.remove(uid)
    return item
  }

  /**
   * @deprecated P0-a 已移除二合一合成；空壳仅用于避免触碰 B 线 src/game.ts，待 B 线清理后删除。
   */
  autoMerge(): InventoryItem[] {
    return []
  }

  /**
   * @deprecated P0-a 已移除二合一合成；空壳仅用于避免触碰 B 线 src/game.ts，待 B 线清理后删除。
   */
  merge(_uidA: string, _uidB: string): InventoryItem | null {
    return null
  }
}
