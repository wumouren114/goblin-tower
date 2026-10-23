import type * as THREE from 'three'
import type { AwakeningId, StyleId } from './data/awakenings'

export type DifficultyId = 'easy' | 'normal' | 'hard'
export type GamePhase = 'title' | 'select' | 'playing' | 'tunnel' | 'shop' | 'dead' | 'victory'
export type Facing = 'down' | 'up' | 'left' | 'right'
/** v3 掉落物：金币 / 回血心 / 白米饭（肥鱼专武，回充能）/ 掉落卡 */
export type PickupKind = 'gold' | 'heart' | 'rice' | 'card'
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
  /** 攻击频率倍率（旧回旋刃字段，v3 已废弃，保留以免旧模块类型报错） */
  attackSpeed: number
  /** 攻击半径（旧回旋刃字段，v3 已废弃） */
  attackRadius: number
  critChance: number
  critMultiplier: number
  pickupRadius: number
  xpGain: number
  goldGain: number
  /** 固定减伤 */
  armor: number
  dashCooldown: number
  /** 回旋刃数量（旧字段，v3 已废弃） */
  blades: number
  // ── v3 五维（魔力=伤害、耐力=攻速、智力=范围、充能上限、以及防御派生） ──
  magic: number
  stamina: number
  intelligence: number
  /** 比例减伤（0~0.6） */
  armorRate: number
  /** 闪避率（0~0.24） */
  dodge: number
  chargeMax: number
  chargeGain: number
}

// ══════════════════════════════════════════════════════════════════
// v3：金币经济 · 关卡流程 · 时空隧道 · 商店 · 存档
// ══════════════════════════════════════════════════════════════════

export type CharacterId = 'mutsumi' | 'murasame' | 'fish'

export type CardStat =
  | 'magic'
  | 'stamina'
  | 'intelligence'
  | 'hp'
  | 'moveSpeed'
  | 'chargeMax'
  | 'chargeGain'
  | 'dodge'
  | 'armor'
  | 'crit'

export type DefeatReason = 'hp'

export type TunnelType = 'reward' | 'trade' | 'battle' | 'rest'

export type TunnelRoom =
  | 'chest'
  | 'skill-card'
  | 'merchant'
  | 'altar'
  | 'mob-wave'
  | 'elite-fight'
  | 'rest'
  | 'boss'

/** 一条「时空隧道」路线（层末三选一） */
export interface TunnelOffer {
  id: string
  kind: TunnelType
  room: TunnelRoom
  title: string
  desc: string
  icon: string
  /** 房间内的具体奖励预览（由 tunnels.ts 生成，结算时直接用） */
  payload: TunnelPayload
}

/** 层末流程：清层奖励卡 → 时空隧道门；v4.6 在 3/6/9 层插入角色觉醒 */
export type TunnelScreenMode = 'bonus' | 'tunnel' | 'awakening'

/** 一次觉醒二选一：获得新觉醒，或深化已有觉醒 */
export interface AwakeningChoice {
  id: AwakeningId
  styleId: StyleId
  name: string
  icon: string
  styleName: string
  action: 'acquire' | 'upgrade'
  /** 选择后达到的等级（1..3） */
  level: number
  /** 选择后的效果描述 */
  desc: string
  /** 深化前的效果描述；acquire 时为空 */
  currentDesc?: string
}

export interface TunnelPayload {
  /** v4.6 角色觉醒二选一（复用隧道卡 UI） */
  awakening?: AwakeningChoice
  gold?: number
  card?: InventoryItem
  skillCard?: {
    id: string
    name: string
    desc: string
    stat: CardStat
    value: number
    tier?: 1 | 2 | 3
    /** 清层奖励增益卡的品质数值倍率；技能卡房不填 */
    valueMul?: number
  }
  /** 商人/祭坛的报价（该房间内可购买的商品） */
  shopOffers?: ShopOffer[]
  altarCost?: number
  altarReward?: { stat: CardStat; value: number }
  enemyCount?: number
  /** 精英房前几只敌人是精英；普通战斗房/Boss 房不填 */
  eliteCount?: number
  bossLayer?: boolean
  rest?: { healRatio: number; chargeRatio: number }
}

export interface ShopOffer {
  id: string
  kind: 'weapon' | 'buff-card' | 'consumable' | 'training'
  name: string
  desc: string
  icon: string
  price: number
  tier: 1 | 2 | 3
  stat?: CardStat
  value?: number
  /** kind==='weapon' 时，购买后专武到达的等级 */
  weaponLevel?: number
  /** kind==='training' 时可持续购买，价格随购买次数上涨 */
  repeatable?: boolean
  /** kind==='training' 时展示用的属性名（如「魔力」） */
  trainingLabel?: string
}

/** 商店来源：隧道商人的额外货架 / 每层固定的标准商店 */
export type ShopMode = 'room' | 'standard'

export interface InventoryItem {
  uid: string
  kind: 'buff-card' | 'consumable'
  name: string
  desc: string
  icon: string
  tier: 1 | 2 | 3
  stat?: CardStat
  /** 该物品提供的数值（进入背包即计入面板，按 tier 已放大） */
  value?: number
}

/** 一局游戏的完整可存档状态（saveLoad.ts 序列化的就是它） */
export interface RunState {
  version: 3
  difficulty: DifficultyId
  character: CharacterId
  /** 当前层（1 起），已进入但未通关 */
  layer: number
  stage: number
  gold: number
  hp: number
  maxHp: number
  weaponLv: number
  cards: Record<CardStat, number>
  inventory: InventoryItem[]
  kills: number
  playTime: number
  seed: number
  savedAt: number
  /** 商店金币训练的永久属性加成（不占背包） */
  training?: Partial<Record<CardStat, number>>
  /** 已购买训练次数：用于跨商店累计涨价 */
  trainingBuys?: number
  /** v4.6 战斗风格；旧档缺省时按角色默认风格补齐 */
  style?: StyleId
  /** v4.6 已拥有觉醒 → 等级（1..3）；旧档缺省为空 */
  awakenings?: Partial<Record<AwakeningId, number>>
  /** 已经领取过觉醒的层数（3/6/9），防止读档后重复领取 */
  awakeningLayers?: number[]
}

/** v3 场景定义：每一层从本阶段的 3 种场景里随机取一种 */
export interface SceneDef {
  id: string
  name: string
  subtitle: string
  /** 主题 id，映射到 world/themes.ts 里的 THEME_V3 */
  themeId: string
  /** 所属阶段（1 起） */
  stage: number
  /** 方形场地半边长（米） */
  halfSize: number
  /** 场景小道具数量 */
  props: number
  /** 地面色调提示（HUD/横幅用） */
  accent: string
}

/** v3 世界层接口（world/floor.ts 实现） */
export interface WorldV3 {
  readonly group: import('three').Group
  readonly halfSize: number
  readonly spawnPoints: Vec2[]
  readonly propColliders: Circle[]
  build(def: SceneDef): void
  update(dt: number, elapsed: number): void
  isInside(x: number, z: number, radius: number): boolean
  clampToArena(x: number, z: number, radius: number): Vec2
  scatterPoints(count: number, minFromCenter?: number): Vec2[]
  dispose(): void
}

export interface SaveSlotMeta {
  slot: number
  empty: boolean
  character?: CharacterId
  difficulty?: DifficultyId
  layer?: number
  stage?: number
  weaponLv?: number
  gold?: number
  playTime?: number
  savedAt?: number
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
  model: 'goblin' | 'goblin-big' | 'king' | 'caster'
}

/** 角色风格资源（节拍 / 剑意 / 泡泡） */
export interface ResourceSnapshot {
  name: string
  value: number
  max: number
  ready: boolean
  styleName: string
  hint: string
}

export interface HudSnapshot {
  hp: number
  maxHp: number
  /** v4.6 护盾值（吸收伤害后归零） */
  shield?: number
  /** v4.6 当前风格资源 */
  resource?: ResourceSnapshot
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
  // ── v3 新增（经验/等级已废弃，xp 字段保留以兼容旧 HUD 代码） ──
  xp?: number
  xpToNext?: number
  level?: number
  character?: CharacterId
  stage?: number
  stageName?: string
  difficultyName?: string
  characterName?: string
  /** 本层固定怪物总数（=quotaMax），已击杀（=quota） */
  monsterKilled?: number
  monsterTotal?: number
  /** 当前层是否为阶段 Boss 层；Boss 层以击杀首领为唯一通关条件 */
  bossLayer?: boolean
  charge?: number
  chargeMax?: number
  weaponLv?: number
  skillName?: string
  skillReady?: boolean
  cardCount?: number
  difficulty?: DifficultyId
}

/** v3 HUD 契约：ui/hud.ts 的 createHud 返回对象必须实现它（game.ts 只依赖这个接口） */
export interface HudV3 {
  setCamera(camera: import('three').Camera): void
  update(snapshot: HudSnapshot): void
  showTitle(slots: SaveSlotMeta[]): void
  hideTitle(): void
  showCharacterSelect(): void
  hideCharacterSelect(): void
  showTunnelOffers(offers: TunnelOffer[], layer: number, mode?: TunnelScreenMode): void
  hideTunnels(): void
  showShop(offers: ShopOffer[], gold: number, refreshCost: number, mode?: ShopMode): void
  updateShop(offers: ShopOffer[], gold: number, refreshCost: number): void
  hideShop(): void
  isInventoryOpen?(): boolean
  showInventory(items: InventoryItem[], gold: number, maxSlots: number): void
  updateInventory(items: InventoryItem[], gold: number): void
  hideInventory(): void
  showPause(slots: SaveSlotMeta[]): void
  hidePause(): void
  showSaveSlots(mode: 'save' | 'load', slots: SaveSlotMeta[]): void
  hideSaveSlots(): void
  showDefeat(reason: DefeatReason, stats: RunStatsV3): void
  showVictory(stats: RunStatsV3): void
  hideEnd(): void
  showLayerBanner(layer: number, name: string, subtitle: string, total: number): void
  showBoss(name: string, hp: number, maxHp: number): void
  updateBoss(hp: number): void
  hideBoss(): void
  damageNumber(worldPos: import('three').Vector3, amount: number, kind: 'normal' | 'crit' | 'heal' | 'gold'): void
  /** 文字飘字（闪避、免疫等） */
  floatText(worldPos: import('three').Vector3, text: string, kind?: 'normal' | 'crit' | 'heal' | 'gold' | 'dodge'): void
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void
  setInteractPrompt(text: string | null): void
  setPaused(paused: boolean): void
  setMuted(muted: boolean): void
  destroy(): void
}

export interface HudV3Handlers {
  onStart(character: CharacterId, difficulty: DifficultyId, styleId: StyleId): void
  onContinue(slot: number): void
  onTunnelPick(offerId: string): void
  onShopBuy(offerId: string): void
  onShopRefresh(): void
  onShopClose(): void
  onOpenInventory(): void
  onCloseInventory(): void
  onMergeItem(uidA: string, uidB: string): void
  onUseItem(uid: string): void
  /** 丢弃背包里的物品（丢弃不退金币）；可选：未接线的模式/HUD 预览可不实现 */
  onDiscardItem?: (uid: string) => void
  onSave(slot: number): void
  onLoad(slot: number): void
  /** 暂停菜单 / HUD 的静音按钮；HUD 只负责显示，音频由外部接线 */
  onToggleMute?: (muted: boolean) => void
  onPauseToggle(): void
  onRetryLayer(): void
  onRestart(): void
  onQuitToTitle(): void
}

export interface RunStatsV3 {
  character: CharacterId
  difficulty: DifficultyId
  layer: number
  totalLayers: number
  gold: number
  kills: number
  weaponLv: number
  cardCount: number
  time: number
  reason?: DefeatReason
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
