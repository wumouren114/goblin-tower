import type * as THREE from 'three'

export type DifficultyId = 'casual' | 'normal' | 'nightmare'
export type GamePhase = 'title' | 'playing' | 'levelup' | 'dead' | 'victory'
export type Facing = 'down' | 'up' | 'left' | 'right'
export type PickupKind = 'xp' | 'gold' | 'scroll' | 'heart'
export type ThemeId = 'moss' | 'candle' | 'forge' | 'frost' | 'throne'

export interface Vec2 {
  x: number
  z: number
}

export interface Circle {
  x: number
  z: number
  r: number
}

/** 主角面板：所有战斗/经济系统只通过这份数值读取玩家强度 */
export interface PlayerStats {
  maxHp: number
  moveSpeed: number
  /** 单次伤害 */
  damage: number
  /** 攻击频率倍率（影响回旋刃角速度与命中冷却） */
  attackSpeed: number
  /** 回旋刃轨道半径 */
  attackRadius: number
  critChance: number
  critMultiplier: number
  pickupRadius: number
  xpGain: number
  goldGain: number
  /** 固定减伤 */
  armor: number
  dashCooldown: number
  /** 回旋刃数量 */
  blades: number
}

export type Rarity = 'common' | 'rare' | 'epic'

/** 升级三选一的选项定义 */
export interface UpgradeDef {
  id: string
  name: string
  icon: string
  desc: string
  rarity: Rarity
  maxStacks: number
  weight: number
  add?: Partial<PlayerStats>
  mul?: Partial<PlayerStats>
}

export interface FloorDef {
  index: number
  name: string
  subtitle: string
  theme: ThemeId
  /** 方形场地半边长（米） */
  halfSize: number
  wallHeight: number
  /** 解锁楼梯所需击杀数 */
  quota: number
  /** 兜底计时（秒）：到达后楼梯也会开启，防止卡关 */
  timeLimit: number
  spawnInterval: number
  spawnBatch: number
  maxAlive: number
  hpScale: number
  damageScale: number
  speedScale: number
  props: number
  coinPiles: number
  boss: boolean
}

export interface ThemeDef {
  id: ThemeId
  name: string
  floorColor: number
  floorAltColor: number
  wallColor: number
  wallTopColor: number
  accentColor: number
  fogColor: number
  fogDensity: number
  ambientColor: number
  ambientIntensity: number
  keyColor: number
  keyIntensity: number
  propColors: number[]
  torchColor: number
}

export interface EnemyDef {
  id: string
  name: string
  hp: number
  speed: number
  damage: number
  radius: number
  xp: number
  goldChance: number
  scale: number
  model: 'goblin' | 'goblin-big' | 'king'
}

export interface HudSnapshot {
  hp: number
  maxHp: number
  xp: number
  xpToNext: number
  level: number
  gold: number
  kills: number
  floor: number
  floorName: string
  quota: number
  quotaMax: number
  stairsUnlocked: boolean
  enemiesAlive: number
  time: number
  boss: { name: string; hp: number; maxHp: number } | null
}

export interface RunStats {
  floor: number
  level: number
  kills: number
  gold: number
  time: number
  difficulty: DifficultyId
}

export interface HudHandlers {
  onStart(difficulty: DifficultyId): void
  onUpgradePick(id: string): void
  onRestart(): void
}

/** 世界层（TowerFloor）对外暴露的接口 */
export interface WorldApi {
  readonly group: THREE.Group
  readonly halfSize: number
  readonly stairs: {
    x: number
    z: number
    unlocked: boolean
    setUnlocked(v: boolean): void
    update(dt: number, elapsed: number): void
  }
  readonly spawnPoints: Vec2[]
  readonly propColliders: Circle[]
  build(def: FloorDef, theme: ThemeDef, difficulty: DifficultyId): void
  update(dt: number, elapsed: number): void
  isInside(x: number, z: number, radius: number): boolean
  clampToArena(x: number, z: number, radius: number): Vec2
  scatterPoints(count: number, minFromCenter?: number): Vec2[]
  dispose(): void
}
