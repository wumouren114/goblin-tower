/**
 * 3 槽存档（localStorage，key 前缀取 balance.save.storageKey）：序列化 RunState（version 3）。
 * listSlots 返回元信息；读档校验 version 与字段完整性，坏档删除并返回 null。
 * 纯数据层：不 import three.js、不碰 DOM（localStorage 通过 globalThis 取，便于 Node 冒烟用假实现）。
 */
import type { CardStat, CharacterId, DifficultyId, InventoryItem, RunState, SaveSlotMeta } from '../types'
import { BALANCE } from '../data/balance'

export const SAVE_VERSION = 3

interface SaveCfg {
  slots: number
  storageKey: string
  autosaveOnLayerStart: boolean
  autosaveOnShopExit: boolean
}

const SAVE_CFG = (BALANCE as unknown as { save: SaveCfg }).save

/** 槽位数量（balance.save.slots） */
export const SAVE_SLOTS: number = SAVE_CFG.slots
const KEY_PREFIX = SAVE_CFG.storageKey

const CHARACTER_IDS: CharacterId[] = ['mutsumi', 'murasame', 'fish']
const DIFFICULTY_IDS: DifficultyId[] = ['easy', 'normal', 'hard']
const CARD_STAT_KEYS: CardStat[] = [
  'magic',
  'stamina',
  'intelligence',
  'hp',
  'moveSpeed',
  'chargeMax',
  'chargeGain',
  'dodge',
  'armor',
]
const NUMERIC_FIELDS = [
  'layer',
  'stage',
  'gold',
  'hp',
  'maxHp',
  'weaponLv',
  'kills',
  'playTime',
  'seed',
  'savedAt',
] as const

function storage(): Storage | null {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage
    return store && typeof store.getItem === 'function' ? store : null
  } catch {
    return null
  }
}

function keyOf(slot: number): string {
  return `${KEY_PREFIX}:${slot}`
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= SAVE_SLOTS
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isCards(value: unknown): value is Record<CardStat, number> {
  if (!value || typeof value !== 'object') return false
  const cards = value as Record<string, unknown>
  return CARD_STAT_KEYS.every((key) => isNum(cards[key]))
}

function isItem(value: unknown): value is InventoryItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  if (typeof item.uid !== 'string') return false
  if (item.kind !== 'weapon' && item.kind !== 'buff-card' && item.kind !== 'consumable') return false
  if (typeof item.name !== 'string' || typeof item.desc !== 'string' || typeof item.icon !== 'string') {
    return false
  }
  if (item.tier !== 1 && item.tier !== 2 && item.tier !== 3) return false
  if (item.stat !== undefined && !CARD_STAT_KEYS.includes(item.stat as CardStat)) return false
  if (item.value !== undefined && !isNum(item.value)) return false
  return true
}

/** 字段完整性校验：version=3、角色/难度合法、数值齐全、背包物品结构正确 */
export function isRunState(value: unknown): value is RunState {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  if (state.version !== SAVE_VERSION) return false
  if (!CHARACTER_IDS.includes(state.character as CharacterId)) return false
  if (!DIFFICULTY_IDS.includes(state.difficulty as DifficultyId)) return false
  for (const field of NUMERIC_FIELDS) {
    if (!isNum(state[field])) return false
  }
  if ((state.layer as number) < 1 || (state.stage as number) < 1) return false
  if (!isCards(state.cards)) return false
  if (!Array.isArray(state.inventory) || !state.inventory.every(isItem)) return false
  return true
}

function readSlot(slot: number): RunState | null {
  const store = storage()
  if (!store) return null
  let raw: string | null = null
  try {
    raw = store.getItem(keyOf(slot))
  } catch {
    return null
  }
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 坏档：删除，避免每次读都炸
    deleteSlot(slot)
    return null
  }
  if (!isRunState(parsed)) {
    deleteSlot(slot)
    return null
  }
  return parsed
}

export function listSlots(): SaveSlotMeta[] {
  const metas: SaveSlotMeta[] = []
  for (let slot = 1; slot <= SAVE_SLOTS; slot += 1) {
    const state = readSlot(slot)
    if (!state) {
      metas.push({ slot, empty: true })
      continue
    }
    metas.push({
      slot,
      empty: false,
      character: state.character,
      difficulty: state.difficulty,
      layer: state.layer,
      stage: state.stage,
      weaponLv: state.weaponLv,
      gold: state.gold,
      playTime: state.playTime,
      savedAt: state.savedAt,
    })
  }
  return metas
}

export function saveToSlot(slot: number, state: RunState): boolean {
  if (!isValidSlot(slot)) return false
  const store = storage()
  if (!store) return false
  try {
    const payload: RunState = { ...state, version: SAVE_VERSION, savedAt: Date.now() }
    store.setItem(keyOf(slot), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function loadFromSlot(slot: number): RunState | null {
  if (!isValidSlot(slot)) return null
  return readSlot(slot)
}

export function deleteSlot(slot: number): void {
  if (!isValidSlot(slot)) return
  const store = storage()
  if (!store) return
  try {
    store.removeItem(keyOf(slot))
  } catch {
    // 存储不可用时静默失败：删除是尽力而为
  }
}
