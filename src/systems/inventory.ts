/**
 * 12 格背包：添加 / 移除 / 使用 / 合成（同级同种 → 下一级，数值 ×2，最高 3 级）。
 * 纯数据层：不 import three.js、不碰 DOM。卡片面板统一由 `cards` 汇总。
 */
import type { CardStat, CharacterId, InventoryItem } from '../types'
import { BALANCE } from '../data/balance'
import { makeCardItem, makeWeaponItem } from './economy'

interface BackpackCfg {
  slots: number
  maxMergeTier: 1 | 2 | 3
}

const BACKPACK = (BALANCE as unknown as { backpack: BackpackCfg }).backpack
const DEFAULT_SLOTS = BACKPACK.slots
const MAX_MERGE_TIER = BACKPACK.maxMergeTier

const WEAPONS = (BALANCE as unknown as {
  weapons: Record<string, { name: string }>
}).weapons

/** 从专武券名字反查角色（三把专武名互不相同） */
function weaponCharOf(item: InventoryItem): CharacterId | null {
  for (const [charId, def] of Object.entries(WEAPONS)) {
    if (item.name.startsWith(def.name)) return charId as CharacterId
  }
  return null
}

function tidy(v: number): number {
  return Number(v.toFixed(3))
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

  /** 五维汇总：只累计「已进背包」的增益卡（消耗品/专武券不进面板） */
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

  remove(uid: string): InventoryItem | null {
    const index = this.items.findIndex((it) => it.uid === uid)
    if (index < 0) return null
    const [removed] = this.items.splice(index, 1)
    return removed
  }

  /** 两张同级同种可合成：增益卡同 stat 同 tier(<3)；专武券同名同等级(<5)；消耗品不合成 */
  canMerge(uidA: string, uidB: string): boolean {
    if (uidA === uidB) return false
    const a = this.get(uidA)
    const b = this.get(uidB)
    if (!a || !b) return false
    if (a.kind !== b.kind) return false
    if (a.kind === 'consumable') return false
    if (a.kind === 'weapon') {
      const lv = a.value ?? 0
      return lv >= 1 && lv < 5 && lv === b.value && a.name === b.name
    }
    if (!a.stat || a.stat !== b.stat) return false
    if (a.tier !== b.tier) return false
    return a.tier < MAX_MERGE_TIER
  }

  /** 合成：消耗两张，在靠前格子生成下一级；数值按「同名同级两份 → ×2」结算 */
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
      const nextTier = Math.min(3, a.tier + 1) as 1 | 2 | 3
      merged = makeCardItem(a.stat ?? '', nextTier)
      merged.value = tidy((a.value ?? 0) * 2)
    } else if (a.kind === 'weapon') {
      const charId = weaponCharOf(a)
      if (charId) merged = makeWeaponItem(charId, (a.value ?? 1) + 1)
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
