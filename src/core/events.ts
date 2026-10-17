/** 极简类型安全事件总线：系统之间不互相持有引用 */
export class Emitter<T extends Record<string, unknown>> {
  private map = new Map<keyof T, Set<(payload: never) => void>>()

  on<K extends keyof T>(key: K, fn: (payload: T[K]) => void): () => void {
    let set = this.map.get(key)
    if (!set) {
      set = new Set()
      this.map.set(key, set)
    }
    set.add(fn as (payload: never) => void)
    return () => set!.delete(fn as (payload: never) => void)
  }

  emit<K extends keyof T>(key: K, payload: T[K]): void {
    const set = this.map.get(key)
    if (!set) return
    for (const fn of set) {
      try {
        ;(fn as (p: T[K]) => void)(payload)
      } catch (err) {
        console.error(`[event:${String(key)}] handler failed`, err)
      }
    }
  }

  clear(): void {
    this.map.clear()
  }
}

export interface GameEvents extends Record<string, unknown> {
  'run:start': { difficulty: string }
  'floor:enter': { floor: number; name: string; subtitle: string }
  'floor:cleared': { floor: number }
  'stairs:unlock': { floor: number }
  'level:up': { level: number }
  'level:choice': { id: string }
  'xp:gain': { amount: number }
  'gold:gain': { amount: number }
  'enemy:killed': { x: number; z: number; xp: number; gold: number; boss: boolean }
  'player:hit': { amount: number; hp: number }
  'player:died': Record<string, never>
  'pickup:collect': { kind: string; value: number }
  'boss:spawn': { name: string; hp: number; maxHp: number }
  'boss:hp': { hp: number; maxHp: number }
  'boss:dead': Record<string, never>
  'scroll:found': Record<string, never>
  'game:win': Record<string, never>
  'game:restart': Record<string, never>
  'toast': { text: string; kind: 'info' | 'good' | 'bad' }
}

export const gameEvents = new Emitter<GameEvents>()
