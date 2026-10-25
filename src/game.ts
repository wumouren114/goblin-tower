import * as THREE from 'three'
import { Player } from './entities/player'
import { enemyBulletSprite, bombTexture, getBillboardYaw, setSpriteFrame, type SpriteAnim } from './art/sprites'
import { Goblin } from './entities/goblin'
import {
  GOBLIN_SMALL,
  GOBLIN_BRUTE,
  GOBLIN_ELITE,
  GOBLIN_CASTER,
  GOBLIN_SPEAR,
  GOBLIN_BOMBER,
} from './data/gameConfig'
import { GoblinKing, BOSS_TITLES } from './entities/boss'
import { RoomNpc, RoomPortal } from './entities/roomNpc'
import { PickupManager } from './entities/pickups'
import { CameraRig } from './systems/cameraRig'
import { Vfx } from './systems/vfx'
import { ScreenFx } from './systems/screenFx'
import { Combat, type CombatWorld, type Hittable } from './systems/combat'
import { Input } from './core/input'
import { audio } from './core/audio'
import { Rng } from './core/rng'
import { rotateInput } from './core/math'
import { TowerFloor } from './world/floor'
import { pickScene, STAGE_NAMES } from './data/stages'
import { CHARACTERS, CHARGE_FLOOR_START_RATIO } from './data/characters'
import { getWeaponTier, charTakeDamageMul, tierNum, MAX_WEAPON_LV } from './data/characterRuntime'
import {
  DIFFICULTIES,
  layerCount,
  isBossLayer,
  stageOfLayer,
  mobHpFor,
  mobDamageFor,
  mobSpeedMulFor,
  quotaFor,
  spawnIntervalFor,
  maxAliveFor,
  clearGoldFor,
  bossHpFor,
  BALANCE,
} from './data/balance'
import { Inventory } from './systems/inventory'
import { generateOffers, REFRESH_COST, trainingPriceFor } from './systems/shop'
import { rollTunnels, resolveRoom } from './systems/tunnels'
import { listSlots, loadFromSlot, saveToSlot } from './systems/saveLoad'
import {
  defaultStyle,
  normalizeAwakenings,
  normalizeAwakeningLayers,
  styleForCharacter,
  type AwakeningId,
  type StyleId,
} from './data/awakenings'
import {
  applyItemToCards,
  clearGold,
  emptyCards,
  killGold,
  makeCardItem,
  qualityFor,
  salvageGold,
} from './systems/economy'
import type { HudV3 } from './ui/hud'
import type {
  AwakeningChoice,
  BossKind,
  CardStat,
  CharacterId,
  DifficultyId,
  EnemyKind,
  GamePhase,
  HudSnapshot,
  InventoryItem,
  PlayerStats,
  RunState,
  RunStatsV3,
  ShopMode,
  ShopOffer,
  TunnelOffer,
} from './types'

/** 自动存档槽：每层开始/离开商店时覆盖；手动存档 UI 里也会列出，因此要标注 */
const AUTOSAVE_SLOT = 1
const NEUTRAL_MODS = { staminaMul: 1, magicMul: 1, intelligenceMul: 1, moveSpeedMul: 1, damageReduction: 0 }
/** Boss 层：玩家越过入场线（半场比例）后才生成 Boss，避免在入口提前看到 Boss/血条 */
const BOSS_ROOM_TRIGGER_RATIO = 0.12

/** CombatWorld 的可选扩展（combat 侧 duck-type 探测） */
interface GameWorld extends CombatWorld {
  spawnPickup?: (x: number, z: number, kind: 'rice' | 'heart' | 'gold') => void
  grantShield: (amount: number, seconds: number) => void
  playerHpRatio: () => number
}

/** 普通怪的战术招式状态机（brute 冲撞 / elite 震地 / spear 直线突刺） */
interface MobMove {
  kind: 'charge-windup' | 'charge' | 'slam-windup' | 'spear-windup'
  timer: number
  baseSpeed: number
  /** 冲锋、震地或突刺的锁定落点 */
  x: number
  z: number
}

/** 爆破手抛出的炸弹：从怪脚下划抛物线落到目标点 */
interface BombShot {
  sprite: THREE.Sprite
  startX: number
  startZ: number
  targetX: number
  targetZ: number
  x: number
  z: number
  t: number
  duration: number
  radius: number
  damage: number
}

/** 时空隧道房间：选完路线后玩家实际走进来，由 NPC 开启房间内容 */
interface RoomMapState {
  offer: TunnelOffer
  npc: RoomNpc
  portal: RoomPortal | null
  resolved: boolean
}

/** Boss 召唤的延迟刷怪，避免一帧内生成过多 drawcall */
interface PendingSpawn {
  kind: EnemyKind
  x: number
  z: number
  timer: number
}

function makeRunState(character: CharacterId, difficulty: DifficultyId): RunState {
  return {
    version: 3,
    difficulty,
    character,
    layer: 1,
    stage: 1,
    gold: 0,
    hp: 100,
    maxHp: 100,
    weaponLv: 1,
    cards: emptyCards(),
    inventory: [],
    kills: 0,
    playTime: 0,
    seed: Math.floor(Math.random() * 1e9),
    savedAt: Date.now(),
    training: {},
    trainingBuys: 0,
  }
}

export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly rig: CameraRig
  readonly fx: ScreenFx
  readonly vfx: Vfx
  readonly input: Input
  private hud: HudV3

  private player: Player | null = null
  private floor: TowerFloor | null = null
  private combat: Combat | null = null
  private pickups: PickupManager
  private goblins: Goblin[] = []
  private boss: GoblinKing | null = null
  private goblinKinds = new Map<Goblin, EnemyKind>()
  private contactCd = new Map<Goblin, number>()
  /** 普通怪的战术招式（冲撞 / 震地 / 突刺） */
  private mobMoves = new Map<Goblin, MobMove>()
  /** 普通怪下次可放招式的冷却 */
  private mobMoveCd = new Map<Goblin, number>()
  /** 远程怪开火冷却（术士 / 爆破手共用，怪只会是其中一种） */
  private casterCd = new Map<Goblin, number>()
  /** 术士开火次数：每第 3 发改为三连射 */
  private casterVolleys = new Map<Goblin, number>()
  /** 敌方弹幕（紫球） */
  private enemyShots: { mesh: THREE.Mesh; x: number; z: number; vx: number; vz: number; life: number; damage: number }[] = []
  private bulletAnim: SpriteAnim | null = null
  /** 爆破手的抛物线炸弹 */
  private bombShots: BombShot[] = []
  /** 延迟生成的召唤物 */
  private pendingSpawns: PendingSpawn[] = []
  /** 房间怪潮：分批进场，避免一次生成 30+ 只导致卡顿/drawcall 爆炸 */
  private roomSpawnRemaining = 0
  private roomSpawnIndex = 0
  private roomEliteCount = 0
  private roomSpawnTimer = 0
  /** 当前时空隧道房间；为 null 时就是普通战斗层 */
  private roomMap: RoomMapState | null = null

  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private aimPoint = new THREE.Vector3(0, 0.6, -6)
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6)

  phase: GamePhase = 'title'
  paused = false
  private pausedFrom: GamePhase = 'playing'
  /** 调试用固定随机种子（?seed=N），null = 每局随机 */
  private debugSeedValue: number | null = null

  private run: RunState = makeRunState('mutsumi', 'normal')
  private cards: Record<CardStat, number> = emptyCards()
  private inventory = new Inventory()
  private prevMaxHp = 100

  private layerTotal = 0
  private layerSpawned = 0
  private layerKilled = 0
  private spawnTimer = 0
  private roomActive = false

  private tunnelOffers: TunnelOffer[] = []
  private shopOffers: ShopOffer[] = []
  private shopMode: ShopMode = 'standard'
  /** 商人房货架 → 标准商店的切换防连点（毫秒时间戳） */
  private shopLeaveLockedUntil = 0

  private rng = new Rng(1)
  private moveInput = { x: 0, z: 0 }
  private elapsed = 0
  private deathTimer = 0
  private sceneName = ''
  private statDirty = false
  /** 墙/塔柱隐藏状态：带迟滞，避免相机在阈值附近抖动导致画面闪 */
  private wallHideState = { south: false, north: false, east: false, west: false, pillars: false }
  /** 命中顿帧（爽感）：击杀/暴击时短暂减速世界 */
  private hitStop = 0
  private mortisVisual = false
  private bonusOffers: TunnelOffer[] = []
  private bonusActive = false
  private awakeningOffers: TunnelOffer[] = []
  private awakeningActive = false
  private shieldHp = 0
  private shieldTime = 0
  private layerSnapshot: RunState | null = null
  private riceStacks = 0
  private bossBarrageTimer = 4
  /** Boss 层尚未走到祭坛区域时挂起生成，防止 Boss 在入口提前出现 */
  private bossSpawnPending = false
  /** Boss 身体接触伤害的冷却（避免每帧结算瞬间秒杀） */
  private bossContactCd = 0
  private autoPlay = false
  private disposed = false

  constructor(canvas: HTMLCanvasElement, hud: HudV3) {
    this.hud = hud
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.2

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 220)
    this.rig = new CameraRig(this.camera)
    this.fx = new ScreenFx()
    this.vfx = new Vfx(this.scene)
    this.input = new Input(canvas)
    this.pickups = new PickupManager(this.scene)

    this.hud.setCamera(this.camera)
    window.addEventListener('resize', this.onResize)
    const unlock = (): void => audio.resume()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    this.renderer.setAnimationLoop(() => this.frame())
  }

  // ---------- 生命周期 ----------

  startRun(character: CharacterId, difficulty: DifficultyId, styleId?: StyleId): void {
    this.cleanupFloor()
    // 重新爬塔/调试跳层时旧角色不能只从场景逻辑里移除，否则会留下幽灵立绘
    this.player?.dispose()
    this.player = null
    this.combat?.dispose()
    this.combat = null
    this.riceStacks = 0
    this.shieldHp = 0
    this.shieldTime = 0
    this.awakeningActive = false
    this.awakeningOffers = []
    this.bonusActive = false
    this.bonusOffers = []
    this.run = makeRunState(character, difficulty)
    const style = styleForCharacter(character, styleId)
    this.run.style = style.id
    this.run.awakenings = {}
    this.run.awakeningLayers = []
    audio.resume()
    audio.startBgm('battle')
    audio.setBgmIntensity(1)
    this.run.seed = this.debugSeedValue ?? Math.floor(Math.random() * 1e9)
    this.rng = new Rng(this.run.seed)
    this.inventory = new Inventory()
    this.cards = emptyCards()
    this.run.weaponLv = 1
    this.player = new Player(this.scene, 0, 0, character)
    this.player.setHp(CHARACTERS[character].base.hp)
    this.run.hp = CHARACTERS[character].base.hp
    this.combat = new Combat(this.scene, {
      onHit: (t, amount, crit, killed) => this.onCombatHit(t, amount, crit, killed),
      onSfx: (name) => {
        if (name === 'attack') audio.hit()
        else if (name === 'crit') audio.crit()
        else if (name === 'dash') audio.dash()
        else if (name === 'summon') audio.levelUp()
        else audio.click()
      },
    })
    this.combat.setCharacter(character)
    this.combat.setBuild(style.id, this.run.awakenings)
    this.combat.setWeaponLv(1)
    this.rig.reset()
    this.hud.hideTitle()
    this.hud.hideCharacterSelect()
    this.hud.hideEnd()
    this.enterLayer(1)
  }

  continueRun(slot: number): void {
    const state = loadFromSlot(slot)
    if (!state) {
      this.hud.toast('存档读取失败', 'bad')
      return
    }
    this.cleanupFloor()
    this.player?.dispose()
    this.player = null
    this.combat?.dispose()
    this.combat = null
    this.run = state
    // 旧档没有训练/风格字段：读档时补默认值，避免版本号升级。
    this.run.training = { ...(state.training ?? {}) }
    this.run.trainingBuys = Math.max(0, Math.round(state.trainingBuys ?? 0))
    const style = styleForCharacter(state.character, state.style)
    this.run.style = style.id
    this.run.awakenings = normalizeAwakenings(style.id, state.awakenings)
    this.run.awakeningLayers = normalizeAwakeningLayers(state.awakeningLayers)
    this.shieldHp = 0
    this.shieldTime = 0
    this.awakeningActive = false
    this.awakeningOffers = []
    this.bonusActive = false
    this.bonusOffers = []
    this.rng = new Rng(state.seed)
    this.inventory = new Inventory()
    for (const item of state.inventory) this.inventory.add(item)
    this.cards = emptyCards()
    this.player = new Player(this.scene, 0, 0, state.character)
    this.combat = new Combat(this.scene, {
      onHit: (t, amount, crit, killed) => this.onCombatHit(t, amount, crit, killed),
      onSfx: (name) => {
        if (name === 'attack') audio.hit()
        else if (name === 'crit') audio.crit()
        else if (name === 'dash') audio.dash()
        else if (name === 'summon') audio.levelUp()
        else audio.click()
      },
    })
    this.combat.setCharacter(state.character)
    this.combat.setBuild(this.run.style, this.run.awakenings)
    this.combat.setWeaponLv(state.weaponLv)
    this.rig.reset()
    this.hud.hideTitle()
    this.hud.hideEnd()
    this.enterLayer(state.layer, true)
    this.player.setHp(Math.max(1, Math.round(state.hp)))
    this.hud.toast(`读取存档：第 ${state.layer} 层`, 'good')
  }

  quitToTitle(): void {
    audio.startBgm('title')
    audio.setBgmIntensity(0)
    this.cleanupFloor()
    this.player?.dispose()
    this.player = null
    this.combat?.dispose()
    this.combat = null
    this.phase = 'title'
    this.paused = false
    this.shieldHp = 0
    this.shieldTime = 0
    this.awakeningActive = false
    this.awakeningOffers = []
    this.bonusActive = false
    this.bonusOffers = []
    this.hud.hideShop()
    this.hud.hideInventory()
    this.hud.hideTunnels()
    this.hud.hidePause()
    this.hud.hideEnd()
    this.hud.showTitle(listSlots())
  }

  private cleanupFloor(): void {
    for (const g of this.goblins) g.dispose()
    this.goblins.length = 0
    this.goblinKinds.clear()
    this.contactCd.clear()
    this.mobMoves.clear()
    this.mobMoveCd.clear()
    this.casterCd.clear()
    this.casterVolleys.clear()
    this.clearEnemyShots()
    this.clearBombShots()
    this.pendingSpawns.length = 0
    this.roomSpawnRemaining = 0
    this.roomSpawnIndex = 0
    this.roomEliteCount = 0
    this.roomSpawnTimer = 0
    this.disposeRoomMap()
    this.bossContactCd = 0
    this.bossSpawnPending = false
    if (this.boss) {
      this.boss.dispose()
      this.boss = null
    }
    this.pickups.clear()
    this.vfx.clear()
    if (this.floor) {
      this.floor.dispose()
      this.floor = null
    }
    this.hud.hideBoss()
    this.hud.setInteractPrompt(null)
    this.fx.setBossMode(false)
  }

  // ---------- 楼层 ----------

  private enterLayer(layer: number, restoring = false): void {
    // 进层先把 Boss 血条/狂暴色调清掉，避免调试跳层时残留
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    const diff = this.run.difficulty
    const total = layerCount(diff)
    this.run.layer = layer
    this.run.stage = stageOfLayer(diff, layer)
    this.phase = 'playing'
    this.roomActive = false
    this.shieldHp = 0
    this.shieldTime = 0
    // 必须连同旧楼层一起销毁：只清小怪会留下上一层的 TowerFloor，
    // 多层地面共面后从第 2 层起就会持续 z-fighting（表现为地板闪烁）。
    this.cleanupFloor()

    const bossLayer = isBossLayer(diff, layer)
    // BGM：Boss 层切 boss 曲并拉满强度，普通层回战斗曲
    if (bossLayer) {
      audio.startBgm('boss')
      audio.setBgmIntensity(2)
    } else {
      audio.startBgm('battle')
      audio.setBgmIntensity(1)
    }
    audio.duck(false)
    const sceneDef = pickScene(this.run.stage, bossLayer, this.rng)
    this.floor = new TowerFloor(this.scene)
    this.floor.build(sceneDef)

    const half = this.floor.halfSize
    if (this.player) {
      this.player.x = 0
      this.player.z = half * 0.22
    }
    this.rig.setArenaHalf(half)
    this.rig.fitForArena(half)
    this.sceneName = sceneDef.name
    this.player?.grantInvuln(1.0)
    this.rig.reset()

    this.layerTotal = quotaFor(this.run.difficulty, layer)
    this.layerSpawned = 0
    this.layerKilled = 0
    this.clearEnemyShots()
    this.casterCd.clear()
    this.spawnTimer = bossLayer ? 2.0 : 0.4
    this.combat?.resetLayer(CHARGE_FLOOR_START_RATIO)
    this.bossSpawnPending = false

    if (bossLayer) {
      this.layerTotal = Math.round(quotaFor(this.run.difficulty, layer) * 0.6)
      // 不在这里直接生成 Boss：先让玩家走进祭坛区域，避免一进 Boss 层
      // 就在入口看到远处的 Boss 和首领血条。
      this.bossSpawnPending = true
    }

    this.hud.hideTunnels()
    this.hud.hideShop()
    this.hud.showLayerBanner(layer, sceneDef.name, STAGE_NAMES[this.run.stage - 1] ?? '', total)
    if (!restoring) {
      const bossTitle = BOSS_TITLES[this.bossKindForStage()]
      this.hud.toast(
        bossLayer ? `Boss 层：前往祭坛，唤醒${bossTitle}！` : `第 ${layer} 层 · 清完 ${this.layerTotal} 只哥布林`,
        'info',
      )
    }
    // 读档后也要先按背包 + 金币训练重算一次，否则第一层会漏掉卡片/训练属性。
    this.syncCards()
    this.saveRun(AUTOSAVE_SLOT)
    this.layerSnapshot = {
      ...this.run,
      cards: { ...this.run.cards },
      inventory: this.run.inventory.map((item) => ({ ...item })),
      training: { ...(this.run.training ?? {}) },
      hp: this.player?.hp ?? this.run.hp,
      maxHp: this.player?.stats.maxHp ?? this.run.maxHp,
    }
  }

  private spawnBoss(): void {
    // 防御性校验：Boss 只能生成在真正的阶段 Boss 层，避免任何清理残留/调试调用把它带到普通层。
    if (!isBossLayer(this.run.difficulty, this.run.layer) || !this.floor) return
    const half = this.floor.halfSize
    const bossZ = -half * 0.74
    const kind = this.bossKindForStage()
    const boss = this.createBoss(0, bossZ, kind, true)
    this.hud.toast(`${boss.title}在祭坛前沉睡，靠近后才会苏醒`, 'info')
    this.vfx.ring(0, bossZ, { color: kind === 'witch' ? 0xb46bff : 0xffb703, radius: 3, life: 0.9, grow: 2 })
  }

  /** 生成并配置 Boss；普通 Boss 层和隧道首领房共用同一套招式/召唤回调 */
  private createBoss(x: number, z: number, kind: BossKind, dormant: boolean, hpMul = 1): GoblinKing {
    const accent = kind === 'witch' ? 0xb46bff : kind === 'warlord' ? 0xff5a36 : 0xff5a2a
    const boss = new GoblinKing(
      this.scene,
      x,
      z,
      {
        onSlam: (sx, sz, radius, damage) => {
          this.vfx.telegraph(sx, sz, radius, 0.2)
          this.vfx.burst(sx, sz, { color: accent, count: 26, speed: 7, life: 0.5, size: 1.0 })
          this.rig.shake(0.5)
          audio.bossSlam()
          this.damagePlayer(damage)
        },
        onSummon: (count, mobKind) => {
          for (let i = 0; i < count; i += 1) {
            const a = (i / count) * Math.PI * 2
            const sx = boss.x + Math.cos(a) * 3.2
            const sz = boss.z + Math.sin(a) * 3.2
            // 分批入场：召唤多只时避免一帧内瞬间堆积
            this.pendingSpawns.push({ kind: mobKind, x: sx, z: sz, timer: i * 0.16 })
          }
          this.vfx.ring(boss.x, boss.z, {
            color: kind === 'witch' ? 0x8a2be2 : kind === 'warlord' ? 0xff4b2e : 0x8a2be2,
            radius: 4.2,
            life: 0.6,
            grow: 1.4,
          })
          const mobName =
            mobKind === 'brute'
              ? '蛮兵'
              : mobKind === 'caster'
                ? '咒术师'
                : mobKind === 'spear'
                  ? '长矛手'
                  : mobKind === 'bomber'
                    ? '爆破手'
                    : '哥布林'
          this.hud.toast(`${boss.title}撕开裂隙，召唤${mobName}！`, 'bad')
        },
        onRoar: () => {
          audio.bossRoar()
          this.rig.shake(0.35)
          this.hud.toast(`${boss.title}进入狂暴状态！`, 'bad')
        },
      },
      kind,
    )
    const variantMul = kind === 'warlord' ? 1.12 : kind === 'witch' ? 1.06 : 1
    boss.hp = Math.max(1, Math.round(bossHpFor(this.run.difficulty, this.run.layer) * variantMul * hpMul))
    boss.maxHp = boss.hp
    boss.setDormant(dormant)
    this.boss = boss
    this.bossContactCd = dormant ? 0.8 : 0
    this.bossBarrageTimer = kind === 'witch' ? 2.4 : 4
    this.hud.showBoss(boss.title, boss.hp, boss.maxHp)
    this.fx.setBossMode(true)
    return boss
  }

  /** 阶段 Boss 变体：第一幕王、第二幕督军、第三幕巫王 */
  private bossKindForStage(): BossKind {
    if (this.run.stage >= 3) return 'witch'
    if (this.run.stage === 2) return 'warlord'
    return 'king'
  }

  // ---------- 帧 ----------

  private frame(): void {
    if (this.disposed) return
    const rawDt = Math.min(this.clock.getDelta(), 1 / 30)
    let dt = rawDt
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - rawDt)
      dt = rawDt * 0.22
    }
    this.elapsed += dt
    this.update(dt)
    this.renderer.render(this.scene, this.camera)
    this.input.endFrame()
  }

  private update(dt: number): void {
    if (this.paused) {
      this.input.consumeDrag()
      this.input.consumeWheel()
      this.input.endFrame()
      return
    }

    this.handleHotkeys()
    this.updateAim()
    if (this.phase === 'playing') this.updatePlaying(dt)
    else if (this.phase === 'dead' || this.phase === 'victory') this.updateEnd(dt)
    else this.idleScene(dt)

    const p = this.player
    if (p) {
      this.rig.update(dt, p.x, p.z, this.moveInput.x, this.moveInput.z, this.phase === 'title')
      this.updateWallVisibility()
      this.pickups.update(dt, p.x, p.z, 0, () => {})
    } else {
      this.rig.update(dt, 0, 0, 0, 0, this.phase === 'title')
    }
    this.fx.update(dt)
    this.vfx.update(dt)
    this.floor?.update(dt, this.elapsed)
    this.roomMap?.npc.update(dt)
    this.roomMap?.portal?.update(dt)
    this.pushSnapshot()
  }

  private handleHotkeys(): void {
    if (this.input.justPressed('KeyM')) {
      const muted = audio.toggleMute()
      this.hud.setMuted(muted)
    }
    if (this.input.justPressed('KeyV')) this.rig.toggleMode()
    if (!this.inventoryOpen() && (this.input.justPressed('KeyP') || this.input.justPressed('Escape'))) {
      if (this.phase === 'playing' || this.phase === 'shop') this.togglePause()
    }
    // TAB / I 共用同一个背包开关；HUD 不再单独处理 Tab，避免同一次按键开完又关。
    if (this.input.justPressed('KeyI') || this.input.justPressed('Tab')) {
      if (this.inventoryOpen()) this.closeInventory()
      else if (this.phase === 'shop') this.openInventory()
    }
    // 塔内互动：祭坛共鸣 / 开启塔藏箱。只在局内有效，避免和标题页、商店的 E 冲突。
    if (this.phase === 'playing' && !this.inventoryOpen() && this.input.justPressed('KeyE')) {
      this.tryTowerInteract()
    }
  }

  /** 结算页「重新爬塔」/ R：用当前角色与难度立刻开新局 */
  restartRun(): void {
    this.startRun(this.run.character, this.run.difficulty, this.run.style)
  }

  /** 失败后重试本层：回滚到进入本层时的状态 */
  retryLayer(): void {
    const snap = this.layerSnapshot
    if (!snap) {
      this.hud.toast('没有可回溯的层快照', 'bad')
      return
    }
    this.hud.hideEnd()
    this.run = {
      ...snap,
      cards: { ...snap.cards },
      inventory: snap.inventory.map((item) => ({ ...item })),
      training: { ...(snap.training ?? {}) },
    }
    this.cards = { ...snap.cards }
    this.inventory = new Inventory()
    for (const item of this.run.inventory) this.inventory.add({ ...item })
    if (!this.player) {
      this.startRun(this.run.character, this.run.difficulty, this.run.style)
      return
    }
    this.player.alive = true
    this.shieldHp = 0
    this.shieldTime = 0
    this.syncCards()
    this.recalcStats()
    if (this.combat) {
      this.combat.setCharacter(this.run.character)
      this.combat.setBuild(this.run.style, this.run.awakenings)
      this.combat.setWeaponLv(this.run.weaponLv)
    }
    this.player.setHp(Math.max(1, Math.min(this.player.stats.maxHp, snap.hp || this.player.stats.maxHp)))
    this.run.hp = this.player.hp
    this.enterLayer(this.run.layer, false)
    this.hud.toast('重试本层！', 'good')
  }

  togglePausePublic(): void {
    this.togglePause()
  }

  private togglePause(): void {
    if (this.paused) {
      this.paused = false
      this.phase = this.pausedFrom
      this.hud.hidePause()
      this.hud.setPaused(false)
      audio.duck(false)
      audio.click()
    } else {
      this.pausedFrom = this.phase
      this.paused = true
      this.hud.showPause(listSlots())
      this.hud.setPaused(true)
      audio.duck(true)
      audio.click()
    }
  }

  /** 相机退到哪面墙外，就隐藏那面墙（不做透明度渐变，避免材质每帧重编译导致闪烁） */
  private updateWallVisibility(): void {
    if (!this.floor) return
    const half = this.floor.halfSize
    const cp = this.camera.position
    // 迟滞：越过 half-2.0 就隐藏（更早，避免墙沿切进画面下缘挡角色），退回 half-3.6 才显示
    const check = (cur: boolean, over: number): boolean => (cur ? over > half - 2.0 : over > half - 3.6)
    const st = this.wallHideState
    st.south = check(st.south, cp.z)
    st.north = check(st.north, -cp.z)
    st.east = check(st.east, cp.x)
    st.west = check(st.west, -cp.x)
    this.floor.setWallHidden('south', st.south)
    this.floor.setWallHidden('north', st.north)
    this.floor.setWallHidden('east', st.east)
    this.floor.setWallHidden('west', st.west)
    // 角柱同理
    st.pillars = st.pillars ? Math.abs(cp.x) > half - 3.2 || Math.abs(cp.z) > half - 3.2 : Math.abs(cp.x) > half - 4.6 || Math.abs(cp.z) > half - 4.6
    this.floor.setPillarsHidden(st.pillars)
  }

  private updateAim(): void {
    const v = new THREE.Vector2(this.input.ndcX, this.input.ndcY)
    this.raycaster.setFromCamera(v, this.camera)
    const hit = this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)
    if (!hit) this.aimPoint.set(0, 0.6, -6)
  }

  private idleScene(dt: number): void {
    this.moveInput.x = 0
    this.moveInput.z = 0
    const p = this.player
    if (p) p.update(dt, 0, 0, this.rig.yaw, this.floor?.propColliders ?? [], (this.floor?.halfSize ?? 20) - 0.6)
  }

  private updateEnd(dt: number): void {
    this.moveInput.x = 0
    this.moveInput.z = 0
    this.deathTimer += dt
    const p = this.player
    if (p) p.update(dt, 0, 0, this.rig.yaw, [], (this.floor?.halfSize ?? 20) - 0.6)
    for (const g of this.goblins) g.update(dt, p?.x ?? 0, p?.z ?? 0, [], 0)
  }

  private updatePlaying(dt: number): void {
    const p = this.player
    if (!p || !this.floor) return
    this.run.playTime += dt
    if (this.shieldTime > 0) {
      this.shieldTime = Math.max(0, this.shieldTime - dt)
      if (this.shieldTime <= 0) this.shieldHp = 0
    }

    const axis = this.input.moveAxis()
    const worldMove = axis.x === 0 && axis.z === 0 ? null : rotateInput(axis.x, axis.z, this.rig.yaw)
    this.moveInput = axis
    p.update(dt, axis.x, axis.z, this.rig.yaw, this.floor.propColliders, this.floor.halfSize - 0.6)
    const clamped = this.floor.clampToArena(p.x, p.z, 0.4)
    p.x = clamped.x
    p.z = clamped.z

    if (this.input.justPressed('ShiftLeft') || this.input.justPressed('Space')) {
      if (p.tryDash(axis.x, axis.z)) audio.dash()
    }

    const drag = this.input.consumeDrag()
    this.rig.addYaw(drag.x * 0.005)
    this.rig.zoom(this.input.consumeWheel() * 0.9)

    // Boss 层：越过入场线才生成 Boss。此时与祭坛仍有 >9.5m，
    // 所以生成后仍会保持沉睡，玩家继续靠近才苏醒。
    if (this.bossSpawnPending && p.z <= this.floor.halfSize * BOSS_ROOM_TRIGGER_RATIO) {
      this.bossSpawnPending = false
      this.spawnBoss()
    }

    this.updateSpawner(dt)
    this.updateRoomWave(dt)
    this.updatePendingSpawns(dt)
    this.updateEnemies(dt)
    this.updateEnemyShots(dt)
    this.updateBombShots(dt)
    this.updateBoss(dt)
    this.combat?.update(dt, p.x, p.z, this.buildWorld())

    if (this.autoPlay) {
      const target = this.nearestEnemy(p.x, p.z)
      if (target) {
        this.aimPoint.set(target.x, 0.6, target.z)
      }
      // 调试自动驾驶：充能满了就放技能，方便截到 Mortis / 突进 / 召唤
      if (this.combat?.skillReady) {
        this.combat.trySkill(p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld(), worldMove ?? undefined)
      }
    }
    // 自动索敌：攻击与技能自动朝向最近的敌人（移动方向不受影响）
    // 自动索敌半径跟武器射程走（射程越短越近才锁）
    const baseRange = CHARACTERS[this.run.character].attack.baseRange
    const lockRange = Math.max(3.5, Math.min(16, baseRange * ((p.stats.intelligence || 100) / 100) + 2))
    const lockOn = this.nearestEnemy(p.x, p.z, lockRange)
    if (lockOn) this.aimPoint.set(lockOn.x, 0.6, lockOn.z)

    // 只有手动点击左键才会开火；自动索敌只负责把这一发对准最近敌人。
    const attackPressed = this.input.consumeAttack()
    if ((this.autoPlay || attackPressed) && this.combat) {
      p.faceToward(this.aimPoint.x, this.aimPoint.z)
      this.combat.tryAttack(dt, p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld())
    }
    // 右键为技能唯一鼠标键位；Q 不再绑定技能。
    const skillPressed = this.input.consumeSkill()
    if (skillPressed && this.combat) {
      p.faceToward(this.aimPoint.x, this.aimPoint.z)
      if (this.combat.trySkill(p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld(), worldMove ?? undefined)) {
        audio.click()
      } else {
        this.hud.toast('充能不足', 'bad')
      }
    }

    if (this.combat) {
      const mortis = !!this.combat.transformActive
      if (mortis !== this.mortisVisual) {
        this.mortisVisual = mortis
        this.player?.setVisual(mortis ? 'mortis' : this.run.character)
      }
    }

    this.pickups.update(dt, p.x, p.z, 2.0, (kind, value) => this.onCollect(kind, value))
    this.run.hp = p.hp
    if (p.hp <= 0) {
      this.die()
      return
    }
    this.updateInteractPrompt()
    this.checkLayerClear()
  }

  /** 每帧刷新塔心信标/塔藏箱的 E 提示；时空隧道房间里改成 NPC / 出口裂隙提示 */
  private updateInteractPrompt(): void {
    const p = this.player
    const floor = this.floor
    if (!p || !floor) {
      this.hud.setInteractPrompt(null)
      return
    }
    if (this.roomMap) {
      if (this.roomActive) {
        this.hud.setInteractPrompt(null)
        return
      }
      const room = this.roomMap
      const npcDist = Math.hypot(p.x - room.npc.x, p.z - room.npc.z)
      if (!room.resolved && npcDist <= 3.2) {
        this.hud.setInteractPrompt(`${room.npc.title} · ${room.npc.hint}`)
        return
      }
      if (room.resolved && room.portal) {
        const portalDist = Math.hypot(p.x - room.portal.x, p.z - room.portal.z)
        if (portalDist <= 3.4) {
          this.hud.setInteractPrompt(`${room.portal.title} · ${room.portal.hint}`)
          return
        }
      }
      this.hud.setInteractPrompt(null)
      return
    }
    const info = floor.interactionAt(p.x, p.z)
    this.hud.setInteractPrompt(info ? `${info.title} · ${info.hint}` : null)
  }

  /** 塔内互动结算：祭坛给护盾/治疗/充能，塔藏箱随机给金币/治疗/充能 */
  private tryTowerInteract(): void {
    const p = this.player
    const floor = this.floor
    if (!p || !floor) return
    if (this.roomMap) {
      this.tryRoomInteract()
      return
    }
    const info = floor.interactAt(p.x, p.z)
    if (!info) return
    audio.click()
    this.hud.setInteractPrompt(null)

    if (info.kind === 'altar') {
      const maxHp = p.stats.maxHp
      const heal = maxHp * 0.1
      p.heal(heal)
      this.shieldHp = Math.max(this.shieldHp, maxHp * 0.16)
      this.shieldTime = Math.max(this.shieldTime, 12)
      this.combat?.grantCharge(0.22)
      this.vfx.ring(info.x, info.z, { color: 0xffd166, radius: 4.8, life: 0.8, grow: 1.9, y: 0.08 })
      this.vfx.ring(info.x, info.z, { color: 0x9ff6e2, radius: 3.6, life: 0.5, grow: 2.6, y: 0.1 })
      this.vfx.burst(info.x, info.z, { color: 0xffe6ad, count: 30, speed: 5, life: 0.65, size: 0.3, y: 1.2 })
      this.hud.toast('塔心共鸣：护盾 + 充能 + 治疗', 'good')
      audio.heal()
      return
    }

    const layer = this.run.layer
    const roll = this.rng.next()
    if (roll < 0.55) {
      const gold = 18 + layer * 5 + this.rng.int(0, 8)
      this.run.gold += gold
      this.hud.toast(`塔藏箱：金币 +${gold}`, 'good')
      this.vfx.ring(info.x, info.z, { color: 0xffd166, radius: 2.4, life: 0.5, grow: 2.2 })
      this.vfx.burst(info.x, info.z, { color: 0xffd166, count: 22, speed: 4.2, life: 0.5, size: 0.28, y: 0.7 })
      audio.coin()
    } else if (roll < 0.82) {
      const maxHp = p.stats.maxHp
      p.heal(maxHp * 0.2)
      this.shieldHp = Math.max(this.shieldHp, maxHp * 0.08)
      this.shieldTime = Math.max(this.shieldTime, 6)
      this.hud.toast('塔藏箱：生命 +20% · 小护盾', 'good')
      this.vfx.ring(info.x, info.z, { color: 0x8fffc8, radius: 2.8, life: 0.6, grow: 2.1 })
      this.vfx.burst(info.x, info.z, { color: 0x8fffc8, count: 20, speed: 3.6, life: 0.55, size: 0.26, y: 0.7 })
      audio.heal()
    } else {
      this.combat?.grantCharge(0.32)
      this.hud.toast('塔藏箱：充能 +32%', 'good')
      this.vfx.ring(info.x, info.z, { color: 0x9fe8ff, radius: 2.6, life: 0.55, grow: 2.3 })
      this.vfx.burst(info.x, info.z, { color: 0x9fe8ff, count: 24, speed: 4.4, life: 0.55, size: 0.28, y: 0.7 })
      audio.levelUp()
    }
  }

  // ---------- 刷怪 / 敌人 ----------

  private updateSpawner(dt: number): void {
    if (!this.floor || this.roomMap) return
    if (this.layerSpawned >= this.layerTotal) return
    const alive = this.goblins.length + (this.boss ? 1 : 0)
    if (alive >= maxAliveFor(this.run.difficulty, this.run.layer)) return
    this.spawnTimer -= dt
    if (this.spawnTimer > 0) return
    const interval = spawnIntervalFor(this.run.difficulty, this.run.layer)
    this.spawnTimer = interval
    this.spawnOne()
  }

  /** 处理 Boss 召唤等延迟生成；不占用正常刷怪配额 */
  private updatePendingSpawns(dt: number): void {
    for (let i = this.pendingSpawns.length - 1; i >= 0; i -= 1) {
      const spawn = this.pendingSpawns[i]
      spawn.timer -= dt
      if (spawn.timer > 0) continue
      this.pendingSpawns.splice(i, 1)
      this.spawnGoblin(spawn.kind, spawn.x, spawn.z)
      this.vfx.ring(spawn.x, spawn.z, { color: 0x8a2be2, radius: 1.1, life: 0.35, grow: 1.7 })
    }
  }

  /** 房间怪潮分批进场，场面上最多 12 只，清掉一批再补下一批 */
  private updateRoomWave(dt: number): void {
    if (!this.roomActive || this.roomSpawnRemaining <= 0) return
    const cap = Math.min(12, Math.max(6, maxAliveFor(this.run.difficulty, this.run.layer)))
    if (this.goblins.length >= cap) return
    this.roomSpawnTimer -= dt
    if (this.roomSpawnTimer > 0) return
    this.roomSpawnTimer = 0.42
    this.spawnRoomWaveBatch()
  }

  private spawnRoomWaveBatch(): void {
    if (this.roomSpawnRemaining <= 0) return
    const cap = Math.min(12, Math.max(6, maxAliveFor(this.run.difficulty, this.run.layer)))
    const room = Math.max(0, cap - this.goblins.length)
    const batch = Math.min(this.roomSpawnRemaining, Math.min(4, Math.max(1, room)))
    for (let i = 0; i < batch; i += 1) {
      const index = this.roomSpawnIndex
      this.roomSpawnIndex += 1
      this.roomSpawnRemaining -= 1
      let kind: EnemyKind = 'small'
      if (index < this.roomEliteCount) kind = 'elite'
      else if ((index + 1) % 6 === 0) kind = 'bomber'
      else if ((index + 1) % 4 === 0) kind = 'spear'
      else if ((index + 1) % 5 === 0) kind = 'brute'
      else if ((index + 1) % 7 === 0) kind = 'caster'
      const pt = this.randomSpawnPoint()
      this.spawnGoblin(kind, pt.x, pt.z)
      this.layerSpawned += 1
    }
  }

  private spawnOne(): void {
    const layer = this.run.layer
    let kind: EnemyKind = 'small'
    const bruteChance = Math.min(0.28, 0.04 + (layer - 1) * 0.05)
    const eliteChance = layer >= 4 ? 0.08 : 0
    const casterChance = layer >= 2 ? Math.min(0.16, 0.07 + (layer - 2) * 0.015) : 0
    const spearChance = layer >= 2 ? Math.min(0.2, 0.08 + (layer - 2) * 0.02) : 0
    const bomberChance = layer >= 3 ? Math.min(0.16, 0.05 + (layer - 3) * 0.018) : 0
    const r = this.rng.next()
    if (r < eliteChance) kind = 'elite'
    else if (r < eliteChance + casterChance) kind = 'caster'
    else if (r < eliteChance + casterChance + spearChance) kind = 'spear'
    else if (r < eliteChance + casterChance + spearChance + bomberChance) kind = 'bomber'
    else if (r < eliteChance + casterChance + spearChance + bomberChance + bruteChance) kind = 'brute'
    if (this.layerSpawned + 1 >= this.layerTotal && layer >= 3) kind = 'elite'
    const point = this.randomSpawnPoint()
    this.spawnGoblin(kind, point.x, point.z)
    this.layerSpawned += 1
  }

  private randomSpawnPoint(): { x: number; z: number } {
    const pts = this.floor?.spawnPoints ?? []
    if (pts.length === 0) return { x: 0, z: -8 }
    const base = pts[this.rng.int(0, pts.length - 1)]
    return { x: base.x + (this.rng.next() - 0.5) * 3, z: base.z + (this.rng.next() - 0.5) * 3 }
  }

  private spawnGoblin(kind: EnemyKind, x: number, z: number): void {
    const def =
      kind === 'small'
        ? GOBLIN_SMALL
        : kind === 'brute'
          ? GOBLIN_BRUTE
          : kind === 'caster'
            ? GOBLIN_CASTER
            : kind === 'spear'
              ? GOBLIN_SPEAR
              : kind === 'bomber'
                ? GOBLIN_BOMBER
                : GOBLIN_ELITE
    const hpMul = mobHpFor(this.run.difficulty, this.run.layer) / GOBLIN_SMALL.hp
    const dmgMul = mobDamageFor(this.run.difficulty, this.run.layer) / GOBLIN_SMALL.damage
    const g = new Goblin(
      this.scene,
      def,
      x,
      z,
      { hp: hpMul, damage: dmgMul, speed: 1, scale: 1, layerSpeed: mobSpeedMulFor(this.run.layer) },
      kind === 'elite',
    )
    this.goblins.push(g)
    this.goblinKinds.set(g, kind)
    this.mobMoves.delete(g)
    this.casterVolleys.delete(g)
    if (kind === 'brute' || kind === 'elite' || kind === 'spear') {
      // 错开首次招式，避免刚出生就贴脸冲撞/震地/突刺
      this.mobMoveCd.set(g, 2.0 + this.rng.next() * 1.8)
    } else {
      this.mobMoveCd.delete(g)
    }
    if (kind === 'caster' || kind === 'bomber') {
      this.casterCd.set(g, kind === 'bomber' ? 1.6 + this.rng.next() * 1.2 : 1.2 + this.rng.next() * 1.4)
    } else {
      this.casterCd.delete(g)
    }
  }

  private spawnEnemyShot(x: number, z: number, tx: number, tz: number, damage: number, color = 0xffffff): void {
    if (!this.bulletAnim) this.bulletAnim = enemyBulletSprite()
    const dx = tx - x
    const dz = tz - z
    const d = Math.hypot(dx, dz) || 1
    const speed = 7.2
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ map: this.bulletAnim.texture, transparent: true, depthWrite: false, toneMapped: false, color }),
    )
    mesh.position.set(x, 0.8, z)
    mesh.renderOrder = 3
    setSpriteFrame(mesh, this.bulletAnim, 'down', 0)
    this.scene.add(mesh)
    this.enemyShots.push({ mesh, x, z, vx: (dx / d) * speed, vz: (dz / d) * speed, life: 4, damage })
  }

  private updateEnemyShots(dt: number): void {
    const p = this.player
    const yaw = getBillboardYaw()
    for (let i = this.enemyShots.length - 1; i >= 0; i -= 1) {
      const shot = this.enemyShots[i]
      shot.life -= dt
      shot.x += shot.vx * dt
      shot.z += shot.vz * dt
      shot.mesh.position.set(shot.x, 0.8 + Math.sin(shot.life * 12) * 0.05, shot.z)
      shot.mesh.rotation.y = yaw
      let dead = shot.life <= 0
      if (p && p.alive) {
        const dx = p.x - shot.x
        const dz = p.z - shot.z
        if (dx * dx + dz * dz < 0.55 * 0.55) {
          this.damagePlayer(shot.damage)
          this.vfx.burst(shot.x, shot.z, { color: 0x9a5cff, count: 8, speed: 3.5, life: 0.35, size: 0.3 })
          dead = true
        }
      }
      if (dead) {
        this.scene.remove(shot.mesh)
        shot.mesh.geometry.dispose()
        ;(shot.mesh.material as THREE.Material).dispose()
        this.enemyShots.splice(i, 1)
      }
    }
  }

  private clearEnemyShots(): void {
    for (const shot of this.enemyShots) {
      this.scene.remove(shot.mesh)
      shot.mesh.geometry.dispose()
      ;(shot.mesh.material as THREE.Material).dispose()
    }
    this.enemyShots.length = 0
  }

  /** 爆破手抛弹：落点先亮起预警圈，炸弹沿抛物线飞行后范围爆炸 */
  private throwBomb(sx: number, sz: number, tx: number, tz: number, damage: number): void {
    if (this.bombShots.length >= 10) return
    const mat = new THREE.SpriteMaterial({
      map: bombTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.center.set(0.5, 0.5)
    sprite.scale.set(0.98, 0.98, 1)
    sprite.position.set(sx, 0.55, sz)
    sprite.renderOrder = 4
    this.scene.add(sprite)
    this.bombShots.push({
      sprite,
      startX: sx,
      startZ: sz,
      targetX: tx,
      targetZ: tz,
      x: sx,
      z: sz,
      t: 0,
      duration: 0.82,
      radius: 2.35,
      damage,
    })
    this.vfx.telegraph(tx, tz, 2.35, 0.8)
  }

  private updateBombShots(dt: number): void {
    const p = this.player
    for (let i = this.bombShots.length - 1; i >= 0; i -= 1) {
      const bomb = this.bombShots[i]
      bomb.t += dt / bomb.duration
      const t = Math.min(1, bomb.t)
      bomb.x = bomb.startX + (bomb.targetX - bomb.startX) * t
      bomb.z = bomb.startZ + (bomb.targetZ - bomb.startZ) * t
      const y = 0.55 + Math.sin(Math.PI * t) * 2.05
      bomb.sprite.position.set(bomb.x, y, bomb.z)
      ;(bomb.sprite.material as THREE.SpriteMaterial).rotation += dt * 9
      if (bomb.t < 1) continue

      this.scene.remove(bomb.sprite)
      ;(bomb.sprite.material as THREE.Material).dispose()
      this.bombShots.splice(i, 1)
      this.vfx.telegraph(bomb.targetX, bomb.targetZ, bomb.radius, 0.2)
      this.vfx.ring(bomb.targetX, bomb.targetZ, {
        color: 0xff7a2f,
        radius: bomb.radius * 1.2,
        life: 0.32,
        grow: 2.4,
      })
      this.vfx.burst(bomb.targetX, bomb.targetZ, {
        color: 0xff8a3d,
        count: 24,
        speed: 6,
        life: 0.45,
        size: 0.55,
      })
      this.rig.shake(0.24)
      audio.bossSlam()
      if (p && p.alive) {
        const dx = p.x - bomb.targetX
        const dz = p.z - bomb.targetZ
        if (dx * dx + dz * dz < bomb.radius * bomb.radius) this.damagePlayer(bomb.damage)
      }
    }
  }

  private clearBombShots(): void {
    for (const bomb of this.bombShots) {
      this.scene.remove(bomb.sprite)
      ;(bomb.sprite.material as THREE.Material).dispose()
    }
    this.bombShots.length = 0
  }

  private updateEnemies(dt: number): void {
    const p = this.player
    if (!p) return
    const colliders = this.floor?.propColliders ?? []
    const bounds = (this.floor?.halfSize ?? 20) - 0.5
    for (let i = this.goblins.length - 1; i >= 0; i -= 1) {
      const g = this.goblins[i]
      const kind = this.goblinKinds.get(g) ?? 'small'
      let targetX = p.x
      let targetZ = p.z

      if (kind === 'caster' || kind === 'bomber') {
        // 术士：保持 6~10m 距离，站定读条后向玩家丢紫球；每第 3 发为三连射
        // 爆破手：保持 5~8m 距离，抛掷有落点预警的炸弹
        const dx = g.x - p.x
        const dz = g.z - p.z
        const d = Math.hypot(dx, dz) || 1
        const keepMin = kind === 'bomber' ? 5 : 6
        const keepMax = kind === 'bomber' ? 8 : 10
        let tx = g.x
        let tz = g.z
        if (d < keepMin) {
          tx = p.x + (dx / d) * (keepMin + 3)
          tz = p.z + (dz / d) * (keepMin + 3)
        } else if (d > keepMax) {
          tx = p.x
          tz = p.z
        }
        g.update(dt, tx, tz, colliders, bounds)
        const cd = (this.casterCd.get(g) ?? 0) - dt
        if (kind === 'bomber') {
          if (cd <= 0 && d < 12) {
            this.throwBomb(g.x, g.z, p.x, p.z, g.damage * 1.25)
            this.casterCd.set(g, 3.0 + this.rng.next() * 0.8)
            this.hud.floatText(new THREE.Vector3(g.x, 1.5, g.z), '炸弹来袭！', 'crit')
            this.vfx.ring(g.x, g.z, { color: 0xff7a2f, radius: 0.8, life: 0.35, grow: 1.6 })
          } else {
            this.casterCd.set(g, cd)
          }
        } else if (cd <= 0 && d < 13) {
          const volley = (this.casterVolleys.get(g) ?? 0) + 1
          this.casterVolleys.set(g, volley)
          if (volley % 3 === 0) {
            const base = Math.atan2(p.z - g.z, p.x - g.x)
            for (const off of [-0.24, 0, 0.24]) {
              this.spawnEnemyShot(
                g.x,
                g.z,
                g.x + Math.cos(base + off) * 11,
                g.z + Math.sin(base + off) * 11,
                g.damage * 0.72,
              )
            }
            this.casterCd.set(g, 3.1)
            this.hud.floatText(new THREE.Vector3(g.x, 1.5, g.z), '三连射', 'crit')
            this.vfx.ring(g.x, g.z, { color: 0x9a5cff, radius: 1.1, life: 0.38, grow: 1.8 })
          } else {
            this.spawnEnemyShot(g.x, g.z, p.x, p.z, g.damage * 0.9)
            this.casterCd.set(g, 2.6)
            this.vfx.ring(g.x, g.z, { color: 0x9a5cff, radius: 0.7, life: 0.3, grow: 1.2 })
          }
        } else {
          this.casterCd.set(g, cd)
        }
      } else {
        const move = this.mobMoves.get(g)
        if (move) {
          move.timer -= dt
          if (move.kind === 'charge-windup') {
            // 冲撞前摇：站定蓄力，地面亮圈提示
            targetX = g.x
            targetZ = g.z
            if (move.timer <= 0) {
              move.kind = 'charge'
              move.timer = 0.38
              targetX = move.x
              targetZ = move.z
              g.speed = move.baseSpeed * 3.4
              this.vfx.ring(g.x, g.z, { color: 0xff9f43, radius: 1.2, life: 0.3, grow: 2.1 })
              this.rig.shake(0.08)
            }
          } else if (move.kind === 'charge') {
            targetX = move.x
            targetZ = move.z
            if (move.timer <= 0) {
              g.speed = move.baseSpeed
              this.mobMoves.delete(g)
              this.mobMoveCd.set(g, 4.8)
            }
          } else if (move.kind === 'spear-windup') {
            // 长矛手：锁定直线，短暂前摇后沿直线突刺；横向走位可完全躲开
            targetX = g.x
            targetZ = g.z
            if (move.timer <= 0) {
              this.mobMoves.delete(g)
              g.speed = move.baseSpeed
              this.mobMoveCd.set(g, 4.2)
              this.contactCd.set(g, 0.5)
              const ox = g.x
              const oz = g.z
              const dx = move.x - ox
              const dz = move.z - oz
              const len = Math.hypot(dx, dz) || 1
              const reach = Math.min(10, len + 2.2)
              const ex = ox + (dx / len) * reach
              const ez = oz + (dz / len) * reach
              for (const t of [0.28, 0.58, 0.88]) {
                this.vfx.ring(ox + (ex - ox) * t, oz + (ez - oz) * t, {
                  color: 0xffd166,
                  radius: 0.9,
                  life: 0.28,
                  grow: 0.5,
                  y: 0.08,
                })
              }
              this.vfx.telegraph(ex, ez, 1.4, 0.2)
              this.vfx.burst((ox + ex) * 0.5, (oz + ez) * 0.5, {
                color: 0xffb703,
                count: 18,
                speed: 6,
                life: 0.4,
                size: 0.32,
                y: 0.5,
              })
              this.rig.shake(0.12)
              const reachDX = ex - ox
              const reachDZ = ez - oz
              const reachLen2 = reachDX * reachDX + reachDZ * reachDZ || 1
              const t = Math.max(
                0,
                Math.min(1, ((p.x - ox) * reachDX + (p.z - oz) * reachDZ) / reachLen2),
              )
              const px = ox + reachDX * t
              const pz = oz + reachDZ * t
              if (Math.hypot(p.x - px, p.z - pz) < 1.15) this.damagePlayer(g.damage * 1.45)
            }
          } else {
            // 精英震地前摇：锁定玩家当前位置，0.72s 后结算范围伤害
            targetX = g.x
            targetZ = g.z
            if (move.timer <= 0) {
              this.mobMoves.delete(g)
              g.speed = move.baseSpeed
              this.mobMoveCd.set(g, 5.2)
              this.contactCd.set(g, 0.9)
              this.vfx.telegraph(move.x, move.z, 3.2, 0.18)
              this.vfx.burst(move.x, move.z, { color: 0xffb703, count: 24, speed: 6, life: 0.5, size: 0.5 })
              this.rig.shake(0.32)
              const dx = p.x - move.x
              const dz = p.z - move.z
              if (dx * dx + dz * dz < 3.2 * 3.2) this.damagePlayer(g.damage * 1.35)
            }
          }
        } else {
          const cd = (this.mobMoveCd.get(g) ?? 0) - dt
          this.mobMoveCd.set(g, cd)
          if (cd <= 0) {
            const dx = p.x - g.x
            const dz = p.z - g.z
            const d = Math.hypot(dx, dz) || 1
            const baseSpeed = g.speed
            if (kind === 'brute' && d > 2.2 && d < 8.5) {
              // 蛮兵：锁定 8m 冲撞方向，给玩家侧移躲避的空间
              this.mobMoves.set(g, {
                kind: 'charge-windup',
                timer: 0.5,
                baseSpeed,
                x: g.x + (dx / d) * 8,
                z: g.z + (dz / d) * 8,
              })
              targetX = g.x
              targetZ = g.z
              this.hud.floatText(new THREE.Vector3(g.x, 1.4, g.z), '蓄力冲撞', 'crit')
              this.vfx.ring(g.x, g.z, { color: 0xffc857, radius: 1.0, life: 0.45, grow: 1.9 })
            } else if (kind === 'elite' && d < 6.2) {
              this.mobMoves.set(g, {
                kind: 'slam-windup',
                timer: 0.72,
                baseSpeed,
                x: p.x,
                z: p.z,
              })
              targetX = g.x
              targetZ = g.z
              this.vfx.telegraph(p.x, p.z, 3.2, 0.72)
              this.hud.floatText(new THREE.Vector3(g.x, 1.6, g.z), '震地！', 'crit')
            } else if (kind === 'spear' && d > 2.4 && d < 9.5) {
              // 长矛手：锁定玩家当前位置，0.55s 后沿直线突刺
              this.mobMoves.set(g, {
                kind: 'spear-windup',
                timer: 0.55,
                baseSpeed,
                x: p.x,
                z: p.z,
              })
              targetX = g.x
              targetZ = g.z
              this.vfx.telegraph(p.x, p.z, 1.5, 0.55)
              this.hud.floatText(new THREE.Vector3(g.x, 1.5, g.z), '突刺！', 'crit')
              this.vfx.ring(g.x, g.z, { color: 0xffd166, radius: 0.8, life: 0.35, grow: 1.4 })
            }
          }
        }
        g.update(dt, targetX, targetZ, colliders, bounds)
      }

      if (!g.alive) {
        this.mobMoves.delete(g)
        this.mobMoveCd.delete(g)
        if (g.canRemove) {
          g.dispose()
          this.goblins.splice(i, 1)
          this.goblinKinds.delete(g)
          this.contactCd.delete(g)
          this.casterCd.delete(g)
          this.casterVolleys.delete(g)
        }
        continue
      }
      const cd = (this.contactCd.get(g) ?? 0) - dt
      if (cd <= 0) {
        const dx = p.x - g.x
        const dz = p.z - g.z
        if (dx * dx + dz * dz < (g.radius + p.radius) * (g.radius + p.radius)) {
          this.damagePlayer(g.damage)
          this.contactCd.set(g, 0.7)
        } else {
          this.contactCd.set(g, 0)
        }
      } else {
        this.contactCd.set(g, cd)
      }
    }
    // 分离推挤，避免完全重叠
    for (let i = 0; i < this.goblins.length; i += 1) {
      const a = this.goblins[i]
      for (let j = i + 1; j < this.goblins.length; j += 1) {
        const b = this.goblins[j]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const rr = a.radius + b.radius
        const d2 = dx * dx + dz * dz
        if (d2 > rr * rr || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const push = Math.min((rr - d) * 0.5, 0.2)
        const nx = dx / d
        const nz = dz / d
        a.x -= nx * push
        a.z -= nz * push
        b.x += nx * push
        b.z += nz * push
      }
    }
  }

  private updateBoss(dt: number): void {
    const p = this.player
    const boss = this.boss
    if (!p || !boss) return
    // 沉睡的 Boss 待在后场，玩家靠近祭坛后才苏醒，不会一进场就追到门口。
    if (boss.dormant) {
      const dx = p.x - boss.x
      const dz = p.z - boss.z
      if (dx * dx + dz * dz < 9.5 * 9.5) {
        boss.setDormant(false)
        this.bossContactCd = 0.8
        this.hud.toast(`${boss.title}苏醒了！`, 'bad')
        this.vfx.ring(boss.x, boss.z, {
          color: boss.kind === 'witch' ? 0xb46bff : 0xffb703,
          radius: 3,
          life: 0.8,
          grow: 2.2,
        })
        this.rig.shake(0.45)
        audio.bossRoar()
      }
    }
    boss.update(dt, p.x, p.z)
    // boss.update 不接收道具碰撞，这里补推挤，避免王钻进祭坛/木桶里看不见
    if (this.floor) {
      for (const c of this.floor.propColliders) {
        const ox = boss.x - c.x
        const oz = boss.z - c.z
        const rr = c.r + boss.radius * 0.8
        const d2 = ox * ox + oz * oz
        if (d2 >= rr * rr || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        boss.x = c.x + (ox / d) * rr
        boss.z = c.z + (oz / d) * rr
      }
      const lim = this.floor.halfSize - boss.radius
      boss.x = Math.max(-lim, Math.min(lim, boss.x))
      boss.z = Math.max(-lim, Math.min(lim, boss.z))
    }
    this.hud.updateBoss(boss.hp)
    if (boss.phase2 && boss.alive) {
      this.bossBarrageTimer -= dt
      if (this.bossBarrageTimer <= 0) {
        this.bossBarrageTimer = boss.barrageEvery
        const count = boss.barrageCount
        const barrageColor = boss.kind === 'witch' ? 0xb46bff : boss.kind === 'warlord' ? 0xff6a3d : 0x9a5cff
        const barrageMul = boss.kind === 'witch' ? 1.7 : boss.kind === 'warlord' ? 2.5 : 2.2
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * Math.PI * 2 + this.rng.next() * 0.2
          this.spawnEnemyShot(
            boss.x,
            boss.z,
            boss.x + Math.cos(a) * 10,
            boss.z + Math.sin(a) * 10,
            mobDamageFor(this.run.difficulty, this.run.layer) * barrageMul,
            barrageColor,
          )
        }
        this.vfx.ring(boss.x, boss.z, { color: barrageColor, radius: 2.2, life: 0.5, grow: 2.4 })
        this.hud.toast(`${boss.title}释放了${boss.kind === 'witch' ? '巫术' : '紫色'}弹幕！`, 'bad')
        audio.bossRoar()
      }
    }
    if (!boss.alive) {
      this.onBossDefeated()
      return
    }
    this.bossContactCd = Math.max(0, this.bossContactCd - dt)
    const dx = p.x - boss.x
    const dz = p.z - boss.z
    const rr = boss.radius + p.radius
    if (dx * dx + dz * dz < rr * rr && this.bossContactCd <= 0) {
      this.damagePlayer(mobDamageFor(this.run.difficulty, this.run.layer) * 2.2)
      this.bossContactCd = 0.9
    }
  }

  private damagePlayer(raw: number): void {
    const p = this.player
    if (!p || !p.alive) return
    const stats = p.stats
    if (Math.random() < Math.min(0.3, stats.dodge)) {
      this.hud.floatText(new THREE.Vector3(p.x, 1.8, p.z), '闪避', 'dodge')
      this.vfx.ring(p.x, p.z, { color: 0x8fd8ff, radius: 0.9, life: 0.3, grow: 1.6 })
      return
    }
    let dmg = raw * charTakeDamageMul(this.run.character) * (1 - Math.min(0.6, stats.armorRate))
    if (this.run.style === 'murasame-guard') dmg *= 0.9
    let remaining = dmg
    if (this.shieldHp > 0 && remaining > 0) {
      const absorbed = Math.min(this.shieldHp, remaining)
      this.shieldHp -= absorbed
      remaining -= absorbed
      this.hud.floatText(new THREE.Vector3(p.x, 1.8, p.z), `护盾 -${Math.round(absorbed)}`, 'dodge')
      this.vfx.ring(p.x, p.z, { color: 0x8fd8ff, radius: 0.9, life: 0.3, grow: 1.6 })
      if (this.shieldHp <= 0) this.shieldTime = 0
    }
    if (remaining <= 0) return
    const dealt = p.takeDamage(remaining)
    if (dealt > 0) {
      this.fx.hurt(Math.min(1, dealt / Math.max(20, p.stats.maxHp * 0.2)))
      audio.hurt()
      this.rig.shake(0.18)
    }
  }

  // ---------- 战斗钩子 ----------

  private onCombatHit(t: Hittable, amount: number, crit: boolean, killed: boolean): void {
    const y = t === this.boss ? 3.2 : 1.35
    this.hud.damageNumber(new THREE.Vector3(t.x, y, t.z), Math.round(amount), crit ? 'crit' : 'normal')
    this.vfx.burst(t.x, t.z, {
      color: crit ? 0xffd166 : 0xffffff,
      count: crit ? 10 : 5,
      speed: 4,
      life: 0.3,
      size: 0.22,
    })
    if (crit) audio.crit()
    else audio.hit()
    this.hitStop = Math.max(this.hitStop, killed ? 0.05 : crit ? 0.03 : 0.012)
    if (killed) this.rig.shake(0.1)
    if (!killed) return
    if (t === this.boss) return
    const goblin = t as unknown as Goblin
    const kind = this.goblinKinds.get(goblin) ?? 'small'
    this.onGoblinKilled(goblin, kind)
  }

  private onGoblinKilled(g: Goblin, kind: EnemyKind): void {
    this.run.kills += 1
    this.layerKilled += 1
    this.combat?.onKill(g, this.buildWorld())
    const rewardKind = kind === 'elite' ? 'elite' : kind === 'brute' ? 'brute' : 'small'
    const gold = killGold(this.run.layer, rewardKind)
    this.pickups.spawn('gold', g.x, g.z, gold)
    if (kind === 'elite') {
      this.pickups.spawn('gold', g.x + 1, g.z, gold)
      this.pickups.spawn('gold', g.x - 1, g.z, gold)
      this.hud.toast('精英哥布林被击杀！', 'good')
      this.vfx.ring(g.x, g.z, { color: 0xffd166, radius: 1.2, life: 0.5, grow: 2 })
    } else if (this.rng.chance(0.05)) {
      this.pickups.spawn('heart', g.x, g.z, 20)
    }
    this.vfx.burst(g.x, g.z, { color: 0x6fbf73, count: 14, speed: 5, life: 0.45, size: 0.28 })
    audio.enemyDie()
  }

  private onCollect(kind: 'gold' | 'heart' | 'rice' | 'card', value: number): void {
    if (kind === 'gold') {
      this.run.gold += value
      this.hud.damageNumber(new THREE.Vector3(this.player?.x ?? 0, 2, this.player?.z ?? 0), value, 'gold')
      audio.coin()
    } else if (kind === 'heart') {
      this.player?.heal(value)
      audio.heal()
    } else if (kind === 'rice') {
      this.riceStacks = Math.min(8, this.riceStacks + 1)
      this.combat?.grantCharge(0.2)
      this.recalcStats()
      audio.pickup()
      this.hud.toast(`白米饭 ${this.riceStacks}/8：全属性 +${this.riceStacks * 7}%`, 'good')
    } else {
      const stat = this.rng.pick(['magic', 'stamina', 'intelligence', 'hp', 'moveSpeed', 'armor']) as CardStat
      const q = qualityFor(this.run.layer, this.rng)
      const item = makeCardItem(stat, q.tier)
      if (this.grantRewardItem(item)) this.hud.toast(`拾取增益卡：${item.name}`, 'good')
    }
  }

  // ---------- 通关 / 失败 ----------

  private checkLayerClear(): void {
    if (this.roomMap && !this.roomActive) return
    if (this.roomActive) {
      // Boss 房由 onBossDefeated 结算；只要 Boss 对象还在，就不走小怪清场逻辑
      if (this.boss) return
      if (this.roomSpawnRemaining === 0 && this.goblins.length === 0 && this.pendingSpawns.length === 0) {
        this.finishRoomBattle()
      }
      return
    }
    // Boss 层只以「哥布林之王死亡」结算（updateBoss → onBossDefeated）；
    // 小怪只是干扰，不参与清层，避免 HUD 显示「剩余 N 只」误导玩家。
    if (isBossLayer(this.run.difficulty, this.run.layer)) return
    if (this.layerKilled >= this.layerTotal && this.goblins.length === 0) this.onLayerCleared()
  }

  /**
   * 清层/离开战斗前，把地面剩余掉落一次性结算。
   * 必须在 enterLayer 的 pickups.clear() 之前调用，避免未拾取收益被吞掉。
   */
  private collectRemainingPickups(): { count: number; gold: number } {
    const drops = this.pickups.drainAll()
    if (drops.length === 0) return { count: 0, gold: 0 }

    let gold = 0
    let hearts = 0
    for (const drop of drops) {
      if (drop.kind === 'gold') gold += drop.value
      else if (drop.kind === 'heart') hearts += drop.value
      else this.onCollect(drop.kind, drop.value)
    }
    if (gold > 0) this.onCollect('gold', gold)
    if (hearts > 0) this.onCollect('heart', hearts)

    const p = this.player
    if (p) {
      this.vfx.ring(p.x, p.z, { color: 0xffd166, radius: 1.1, life: 0.55, grow: 3 })
      if (gold > 0) {
        this.vfx.burst(p.x, p.z, { color: 0xffd166, count: 16, speed: 5, life: 0.45, size: 0.22 })
      }
    }
    return { count: drops.length, gold }
  }

  private onLayerCleared(): void {
    const picked = this.collectRemainingPickups()
    const gold = clearGoldFor(this.run.difficulty, this.run.layer)
    this.run.gold += gold
    const autoNote = picked.count > 0
      ? `（自动吸取 ${picked.count} 件${picked.gold > 0 ? `，+${picked.gold} 金币` : ''}）`
      : ''
    this.hud.toast(`第 ${this.run.layer} 层清空！+${gold} 金币${autoNote}`, 'good')
    audio.stairs()
    this.vfx.levelUpBurst(this.player?.x ?? 0, this.player?.z ?? 0)
    this.openPostClearFlow()
  }

  private onBossDefeated(): void {
    if (!this.boss) return
    const boss = this.boss
    const title = boss.title
    const accent = boss.kind === 'witch' ? 0xb46bff : boss.kind === 'warlord' ? 0xff6a3d : 0xffd166
    boss.alive = false
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.rig.shake(0.9)
    this.fx.flash(0.6, 220)
    audio.win()
    audio.setBgmIntensity(1)
    this.vfx.levelUpBurst(boss.x, boss.z)
    this.vfx.ring(boss.x, boss.z, { color: accent, radius: 3, life: 1.2, grow: 4 })
    this.vfx.burst(boss.x, boss.z, { color: accent, count: 40, speed: 9, life: 0.9, size: 0.4 })
    this.run.gold += Math.round(killGold(this.run.layer, 'boss'))
    this.collectRemainingPickups()
    // Boss 也计入全局累计击杀；Boss 层的清层条件仍只看 Boss 死亡。
    this.run.kills += 1
    this.hud.toast(`${title}倒下了！`, 'good')
    boss.dispose()
    this.boss = null
    // 隧道首领房：Boss 倒下只完成房间，不推进整层流程
    if (this.roomMap && this.roomActive) {
      this.roomActive = false
      this.clearRoomAdds()
      audio.startBgm('shop')
      audio.setBgmIntensity(0)
      this.completeRoomMap(`${title}已被击败`)
      return
    }
    if (this.run.layer >= layerCount(this.run.difficulty)) this.win()
    else {
      this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
      this.openPostClearFlow()
    }
  }

  private die(): void {
    if (this.phase === 'dead' || this.phase === 'victory') return
    this.phase = 'dead'
    if (this.player) this.player.alive = false
    this.fx.hurt(1)
    audio.lose()
    audio.startBgm('title', { fadeMs: 900 })
    audio.setBgmIntensity(0)
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.hud.showDefeat('hp', this.runStats('hp'))
  }

  private win(): void {
    this.phase = 'victory'
    audio.startBgm('victory')
    audio.setBgmIntensity(1)
    audio.win()
    this.hud.showVictory(this.runStats())
  }

  private runStats(reason?: 'hp'): RunStatsV3 {
    return {
      difficulty: this.run.difficulty,
      character: this.run.character,
      layer: this.run.layer,
      totalLayers: layerCount(this.run.difficulty),
      kills: this.run.kills,
      gold: this.run.gold,
      time: this.run.playTime,
      weaponLv: this.run.weaponLv,
      cardCount: this.inventory.count,
      reason,
    }
  }

  // ---------- 隧道 / 商店 ----------

  private cardIcon(stat: string): string {
    const table: Record<string, string> = {
      magic: '✨',
      stamina: '⚡',
      intelligence: '🔮',
      hp: '❤️',
      moveSpeed: '👟',
      chargeMax: '🔋',
      armor: '🛡️',
      dodge: '💨',
      chargeGain: '🎯',
    }
    return table[stat] ?? '🎴'
  }

  /** 清层后的固定顺序：3/6/9 层先觉醒，再清层奖励卡，最后隧道门 */
  private openPostClearFlow(): void {
    const layer = this.run.layer
    const claimed = this.run.awakeningLayers ?? []
    if ((layer === 3 || layer === 6 || layer === 9) && !claimed.includes(layer)) {
      this.openAwakening()
      return
    }
    this.openBonusCards()
  }

  /**
   * 觉醒二选一：风格的两个觉醒中，未拥有的「获得 Lv1」，已拥有的「深化 Lv+1」。
   * 两个都满级时直接跳过，避免空界面。
   */
  private openAwakening(): void {
    const style = styleForCharacter(this.run.character, this.run.style)
    const current = normalizeAwakenings(style.id, this.run.awakenings)
    const offers: TunnelOffer[] = []
    for (const awakening of style.awakenings) {
      const level = current[awakening.id] ?? 0
      if (level >= 3) continue
      const next = level + 1
      const action: 'acquire' | 'upgrade' = level === 0 ? 'acquire' : 'upgrade'
      const choice: AwakeningChoice = {
        id: awakening.id,
        styleId: style.id,
        name: awakening.name,
        icon: awakening.icon,
        styleName: style.name,
        action,
        level: next,
        desc: awakening.levels[next - 1],
        currentDesc: level > 0 ? awakening.levels[level - 1] : undefined,
      }
      offers.push({
        id: `awakening-${awakening.id}`,
        kind: 'reward',
        room: 'skill-card',
        title: `${awakening.name} · Lv${next}`,
        desc: action === 'acquire' ? `获得觉醒 · ${style.name}` : `深化觉醒 · ${style.name}`,
        icon: awakening.icon,
        payload: { awakening: choice },
      })
    }
    if (offers.length === 0) {
      this.addAwakeningLayer()
      this.saveRun(AUTOSAVE_SLOT)
      this.openBonusCards()
      return
    }
    this.awakeningOffers = offers
    this.awakeningActive = true
    this.bonusActive = false
    this.bonusOffers = []
    this.phase = 'tunnel'
    audio.startBgm('shop')
    audio.duck(false)
    this.hud.showTunnelOffers(offers, this.run.layer, 'awakening')
    audio.levelUp()
  }

  private addAwakeningLayer(): void {
    const layer = this.run.layer
    const list = this.run.awakeningLayers ?? []
    if (!list.includes(layer)) list.push(layer)
    this.run.awakeningLayers = list
  }

  /** 每层清空后：先三选一拿一张增益卡，再开时空隧道。
   *  高层按 balance.shop.quality 掷品质，出精制/臻品，后期不至于「选谁都一样」 */
  private openBonusCards(): void {
    this.awakeningActive = false
    this.awakeningOffers = []
    const pool = [...BALANCE.buffCards]
    this.bonusOffers = []
    for (let i = 0; i < 3 && pool.length > 0; i += 1) {
      const idx = this.rng.int(0, pool.length - 1)
      const card = pool.splice(idx, 1)[0]
      const q = qualityFor(this.run.layer, this.rng)
      const value = Number((card.value * q.valueMul).toFixed(3))
      const tierName = q.tier === 3 ? '臻品' : q.tier === 2 ? '精制' : ''
      this.bonusOffers.push({
        id: `bonus-${i}`,
        kind: 'reward',
        room: 'skill-card',
        title: `${tierName}${card.name}`,
        desc: '选择后永久生效',
        icon: this.cardIcon(card.stat),
        payload: {
          skillCard: {
            id: card.id,
            name: card.name,
            desc: card.desc,
            stat: card.stat as CardStat,
            value,
            tier: q.tier,
            valueMul: q.valueMul,
          },
        },
      })
    }
    if (this.bonusOffers.length === 0) {
      this.openTunnels()
      return
    }
    this.bonusActive = true
    this.phase = 'tunnel'
    audio.startBgm('shop')
    audio.duck(false)
    this.hud.showTunnelOffers(this.bonusOffers, this.run.layer, 'bonus')
    audio.levelUp()
  }

  private openTunnels(): void {
    this.awakeningActive = false
    this.awakeningOffers = []
    this.phase = 'tunnel'
    audio.startBgm('shop')
    audio.duck(false)
    // 阶段 Boss 已被击杀时才继续留在 Boss 层结算；此时不能再刷「Boss 房间」门，
    // 否则会重复进入 Boss 房并刷出 1 只小怪冒充 Boss 房。Boss 战本身在 enterLayer 直接开始。
    const boss = isBossLayer(this.run.difficulty, this.run.layer) && this.boss !== null
    this.tunnelOffers = rollTunnels(
      this.run.layer,
      layerCount(this.run.difficulty),
      boss,
      this.run.character,
      this.rng,
      this.run.weaponLv,
      this.run.trainingBuys ?? 0,
    )
    this.hud.showTunnelOffers(this.tunnelOffers, this.run.layer, 'tunnel')
  }

  pickTunnel(id: string): void {
    if (this.phase !== 'tunnel') return
    if (this.awakeningActive) {
      const pick = this.awakeningOffers.find((o) => o.id === id)
      const choice = pick?.payload.awakening
      if (!choice) return
      this.awakeningActive = false
      this.awakeningOffers = []
      this.hud.hideTunnels()
      const next = normalizeAwakenings(choice.styleId, this.run.awakenings)
      next[choice.id] = choice.level
      this.run.awakenings = next
      this.combat?.setBuild(this.run.style ?? choice.styleId, next)
      this.addAwakeningLayer()
      this.saveRun(AUTOSAVE_SLOT)
      audio.levelUp()
      this.hud.toast(`觉醒：${choice.name} Lv${choice.level}`, 'good')
      this.openBonusCards()
      return
    }
    if (this.bonusActive) {
      const pick = this.bonusOffers.find((o) => o.id === id)
      if (!pick) return
      this.bonusActive = false
      this.bonusOffers = []
      this.hud.hideTunnels()
      audio.click()
      const card = pick.payload.skillCard
      if (card) {
        const item = makeCardItem(card.stat as CardStat, card.tier ?? 1)
        item.value = card.value
        if (this.grantRewardItem(item)) {
          this.hud.toast(`清层奖励：${item.name}`, 'good')
        }
      }
      this.openTunnels()
      return
    }
    const offer = this.tunnelOffers.find((o) => o.id === id)
    if (!offer) return
    this.hud.hideTunnels()
    audio.click()
    audio.tunnel()
    this.enterRoomMap(offer)
  }

  /** 选完路线后真正进入房间地图：玩家可以走动，找到 NPC 按 E 开启房间内容 */
  private enterRoomMap(offer: TunnelOffer): void {
    const p = this.player
    const floor = this.floor
    if (!p || !floor) return
    this.disposeRoomMap()
    // 防御性清场：正常流程是清层后才开隧道，但调试/异常状态下不能把上一波怪带进房间
    this.clearRoomAdds()
    this.phase = 'playing'
    this.roomActive = false
    this.layerTotal = 0
    this.layerKilled = 0
    this.layerSpawned = 0
    this.roomSpawnRemaining = 0
    this.roomSpawnIndex = 0
    this.roomEliteCount = 0
    this.roomSpawnTimer = 0
    this.clearEnemyShots()
    this.clearBombShots()
    this.pendingSpawns.length = 0
    this.hud.hideShop()
    this.hud.setInteractPrompt(null)
    this.fx.setBossMode(false)
    this.rig.reset()
    this.rig.setArenaHalf(floor.halfSize)
    this.rig.fitForArena(floor.halfSize)

    const half = floor.halfSize
    p.x = 0
    p.z = half * 0.56
    p.grantInvuln(0.9)
    const npcZ = Math.min(4.2, half * 0.22)
    const npc = new RoomNpc(this.scene, offer.room, 0, npcZ)
    this.roomMap = { offer, npc, portal: null, resolved: false }
    audio.startBgm('shop')
    audio.setBgmIntensity(0)
    audio.duck(false)
    this.hud.toast(`${offer.title} · ${npc.title}：${npc.hint}`, 'info')
    this.saveRun(AUTOSAVE_SLOT)
  }

  /** E 键在房间里的优先级：未完成时找 NPC，完成后找出口裂隙 */
  private tryRoomInteract(): void {
    const p = this.player
    const room = this.roomMap
    if (!p || !room || this.roomActive) return
    if (!room.resolved) {
      const d = Math.hypot(p.x - room.npc.x, p.z - room.npc.z)
      if (d <= 3.2) this.interactRoomNpc()
      return
    }
    if (!room.portal) return
    const d = Math.hypot(p.x - room.portal.x, p.z - room.portal.z)
    if (d <= 3.4) this.leaveRoomMap()
  }

  /** 由 NPC 触发的房间结算：商家开额外货架、祭坛献金、战鼓开怪、宝箱/休憩直接给奖励 */
  private interactRoomNpc(): void {
    const room = this.roomMap
    const p = this.player
    if (!room || !p || room.resolved) return
    audio.click()
    this.hud.setInteractPrompt(null)
    const res = resolveRoom(room.offer, this.run.layer, this.run.character, this.rng, this.run.trainingBuys ?? 0)

    if (res.gold) {
      this.run.gold += res.gold
      this.hud.toast(`+${res.gold} 金币`, 'good')
      this.vfx.burst(room.npc.x, room.npc.z, { color: 0xffd166, count: 18, speed: 4, life: 0.5, size: 0.3, y: 0.8 })
    }
    if (res.card) {
      if (this.grantRewardItem(res.card)) this.hud.toast(`${res.card.icon} ${res.card.name} 已放入背包`, 'good')
    }
    if (res.rest) {
      p.heal(p.stats.maxHp * res.rest.healRatio)
      this.run.hp = p.hp
      this.combat?.grantCharge(res.rest.chargeRatio)
      this.vfx.ring(p.x, p.z, { color: 0x8fffc8, radius: 3, life: 0.8, grow: 2.2 })
      this.vfx.burst(p.x, p.z, { color: 0x8fffc8, count: 20, speed: 3.5, life: 0.6, size: 0.28, y: 0.8 })
      this.hud.toast(
        `营地休整：回血 ${Math.round(res.rest.healRatio * 100)}%、充能 +${Math.round(res.rest.chargeRatio * 100)}%`,
        'good',
      )
      audio.heal()
      this.completeRoomMap('营地休整完成')
      return
    }
    if (res.shopOffers && res.shopOffers.length > 0) {
      room.resolved = true
      this.shopOffers = res.shopOffers
      this.shopMode = 'room'
      this.phase = 'shop'
      audio.startBgm('shop')
      audio.setBgmIntensity(0)
      this.hud.showShop(this.shopOffers, this.run.gold, REFRESH_COST, 'room')
      return
    }
    if (res.altarCost !== undefined && res.altarReward) {
      if (this.run.gold >= res.altarCost) {
        const qv = res.altarReward.value ?? 1
        const tier = qv >= 2.6 ? 3 : qv >= 1.5 ? 2 : 1
        const item = makeCardItem(res.altarReward.stat, tier)
        this.grantRewardItem(item)
        this.run.gold -= res.altarCost
        this.hud.toast(`祭坛献金 ${res.altarCost}：${item.name}`, 'good')
        this.vfx.ring(room.npc.x, room.npc.z, { color: 0xb46bff, radius: 2.8, life: 0.7, grow: 2.1 })
      } else {
        // 金币不够也给一点怜悯，保证房间不会变成死路
        p.heal(p.stats.maxHp * 0.12)
        this.run.hp = p.hp
        this.hud.toast('金币不足，祭坛只留下了一点回复', 'bad')
        this.vfx.ring(room.npc.x, room.npc.z, { color: 0x8fffc8, radius: 2.2, life: 0.6, grow: 1.8 })
      }
      this.completeRoomMap('祭坛的回应已结束')
      return
    }
    if (res.bossLayer) {
      this.startRoomBossBattle()
      return
    }
    if (res.enemies) {
      this.startRoomBattle(res.enemies.count, res.enemies.elite)
      return
    }
    this.completeRoomMap(room.offer.title)
  }

  /** 战斗房清空、宝箱打开、祭坛结算后：在房间入口生成裂隙 */
  private completeRoomMap(message: string): void {
    const room = this.roomMap
    const floor = this.floor
    if (!room || !floor) return
    room.resolved = true
    this.layerTotal = 0
    this.layerKilled = 0
    this.layerSpawned = 0
    this.roomSpawnRemaining = 0
    this.roomSpawnIndex = 0
    this.roomEliteCount = 0
    this.roomSpawnTimer = 0
    if (!room.portal) {
      const portalZ = floor.halfSize * 0.58
      room.portal = new RoomPortal(this.scene, 0, portalZ)
      this.vfx.ring(0, portalZ, { color: 0x3bd5b0, radius: 2.6, life: 0.8, grow: 2.4 })
      this.vfx.burst(0, portalZ, { color: 0x8fffe4, count: 26, speed: 4.5, life: 0.7, size: 0.3, y: 1.1 })
      audio.stairs()
    }
    this.hud.toast(`${message} · 出口裂隙已开启`, 'good')
    this.hud.setInteractPrompt(null)
  }

  private leaveRoomMap(): void {
    if (!this.roomMap) return
    this.disposeRoomMap()
    this.hud.setInteractPrompt(null)
    audio.click()
    this.proceedToShop()
    this.hud.toast('穿过裂隙，回到塔内商店', 'info')
  }

  private disposeRoomMap(): void {
    if (!this.roomMap) return
    this.roomMap.npc.dispose()
    this.roomMap.portal?.dispose()
    this.roomMap = null
    this.hud.setInteractPrompt(null)
  }

  private startRoomBattle(count: number, elite: number): void {
    this.phase = 'playing'
    this.roomActive = true
    this.clearEnemyShots()
    this.clearBombShots()
    this.pendingSpawns.length = 0
    audio.startBgm('battle')
    audio.setBgmIntensity(1)
    this.layerTotal = count
    this.layerKilled = 0
    this.layerSpawned = 0
    this.roomSpawnRemaining = count
    this.roomSpawnIndex = 0
    this.roomEliteCount = elite
    this.roomSpawnTimer = 0
    // 先放一小批，其余按存活上限分批进场
    this.spawnRoomWaveBatch()
    this.hud.toast(elite > 0 ? '精英战：击败所有敌人！' : '战斗房：清空敌人！', 'bad')
    audio.bossRoar()
  }

  private startRoomBossBattle(): void {
    const floor = this.floor
    if (!floor) return
    this.phase = 'playing'
    this.roomActive = true
    this.clearEnemyShots()
    this.clearBombShots()
    this.pendingSpawns.length = 0
    // 首领房不计入小怪配额，HUD 由 boss 血条 + roomObjective 表达
    this.layerTotal = 0
    this.layerKilled = 0
    this.layerSpawned = 0
    this.roomSpawnRemaining = 0
    this.roomSpawnIndex = 0
    this.roomEliteCount = 0
    this.roomSpawnTimer = 0
    audio.startBgm('boss')
    audio.setBgmIntensity(2)
    const boss = this.createBoss(0, -floor.halfSize * 0.42, this.bossKindForStage(), false, 0.72)
    this.hud.toast(`首领房：${boss.title}苏醒了！`, 'bad')
    audio.bossRoar()
    this.rig.shake(0.5)
    this.vfx.ring(boss.x, boss.z, { color: boss.kind === 'witch' ? 0xb46bff : 0xff6a3d, radius: 3.2, life: 0.9, grow: 2.4 })
  }

  /** 首领房结束后清掉 Boss 召唤的残余小怪与弹幕，避免玩家离开房间时把怪带进商店 */
  private clearRoomAdds(): void {
    for (const g of this.goblins) g.dispose()
    this.goblins.length = 0
    this.goblinKinds.clear()
    this.contactCd.clear()
    this.mobMoves.clear()
    this.mobMoveCd.clear()
    this.casterCd.clear()
    this.casterVolleys.clear()
    this.pendingSpawns.length = 0
    this.roomSpawnRemaining = 0
    this.clearEnemyShots()
    this.clearBombShots()
  }

  private finishRoomBattle(): void {
    this.roomActive = false
    const picked = this.collectRemainingPickups()
    if (this.roomMap) {
      // 战斗房的金币在 interactRoomNpc 里已按卡片预览结算；这里只收尾，
      // 不再叠加本层通关金（本层通关金已在清层时发放）。
      this.hud.toast(picked.count > 0 ? `房间清空！自动吸取 ${picked.count} 件掉落` : '房间清空！', 'good')
      this.completeRoomMap('战斗房已清空')
      return
    }
    this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
    this.hud.toast(picked.count > 0 ? `房间清空！自动吸取 ${picked.count} 件掉落` : '房间清空！', 'good')
    this.proceedToShop()
  }

  private proceedToShop(): void {
    this.shopOffers = generateOffers(
      this.run.layer,
      this.run.character,
      this.run.gold,
      this.rng,
      4,
      this.run.weaponLv,
      this.run.trainingBuys ?? 0,
    )
    this.shopMode = 'standard'
    this.phase = 'shop'
    audio.startBgm('shop')
    audio.duck(false)
    this.hud.showShop(this.shopOffers, this.run.gold, REFRESH_COST, 'standard')
  }

  buyOffer(id: string): void {
    if (this.phase !== 'shop') return
    const idx = this.shopOffers.findIndex((o) => o.id === id)
    if (idx < 0) return
    const offer = this.shopOffers[idx]
    if (this.run.gold < offer.price) {
      this.hud.toast('金币不足', 'bad')
      return
    }
    if (offer.kind === 'weapon') {
      if (offer.weaponLevel !== this.run.weaponLv + 1) {
        this.hud.toast('只能购买下一级专武', 'bad')
        return
      }
      this.run.gold -= offer.price
      this.run.weaponLv += 1
      this.combat?.setWeaponLv(this.run.weaponLv)
      this.recalcStats()
      this.shopOffers.splice(idx, 1)
      this.hud.toast(`专武升级到 Lv${this.run.weaponLv}`, 'good')
    } else if (offer.kind === 'training') {
      if (!offer.stat || typeof offer.value !== 'number') return
      const training = { ...(this.run.training ?? {}) }
      training[offer.stat] = Number(((training[offer.stat] ?? 0) + offer.value).toFixed(3))
      this.run.training = training
      this.run.trainingBuys = (this.run.trainingBuys ?? 0) + 1
      this.run.gold -= offer.price
      this.syncCards()
      // 可重复购买：不删格子，只更新价格与已训练次数。
      offer.price = trainingPriceFor(this.run.layer, this.run.trainingBuys)
      offer.desc = `永久 ${offer.trainingLabel ?? '属性'}强化，不占背包；可重复购买（已训练 ${this.run.trainingBuys} 次）`
      this.hud.toast(`金币训练：${offer.name}`, 'good')
    } else if (offer.kind === 'buff-card') {
      const item = makeCardItem(offer.stat as CardStat, offer.tier)
      if (!this.grantItem(item)) return
      this.run.gold -= offer.price
      this.shopOffers.splice(idx, 1)
      this.hud.toast(`获得 ${item.name}`, 'good')
    } else {
      const item: InventoryItem = {
        uid: `u${Date.now()}${this.rng.int(0, 999)}`,
        kind: 'consumable',
        name: offer.name,
        desc: offer.desc,
        icon: offer.icon,
        tier: 1,
        stat: undefined,
        value: 1,
      }
      if (!this.grantItem(item)) return
      this.run.gold -= offer.price
      this.hud.toast(`${offer.name} 放入背包`, 'good')
    }
    audio.coin()
    this.hud.updateShop(this.shopOffers, this.run.gold, REFRESH_COST)
    if (this.inventoryOpen()) this.hud.updateInventory(this.inventory.items, this.run.gold)
  }

  refreshShop(): void {
    if (this.phase !== 'shop') return
    if (this.run.gold < REFRESH_COST) {
      this.hud.toast('金币不足，无法重掷', 'bad')
      return
    }
    this.run.gold -= REFRESH_COST
    this.shopOffers = generateOffers(
      this.run.layer,
      this.run.character,
      this.run.gold,
      this.rng,
      4,
      this.run.weaponLv,
      this.run.trainingBuys ?? 0,
    )
    audio.coin()
    this.hud.updateShop(this.shopOffers, this.run.gold, REFRESH_COST)
  }

  /**
   * 离开商店。
   * 商人房是「额外货架」：收起后回到房间，由出口裂隙进入本层标准商店；
   * 标准商店离开后才存档并进入下一层。500ms 防连点，避免双击跳过标准商店。
   */
  leaveShop(): void {
    if (this.phase !== 'shop') return
    if (Date.now() < this.shopLeaveLockedUntil) return
    const fromRoom = this.shopMode === 'room'
    this.hud.hideShop()
    this.hud.hideInventory()
    if (fromRoom) {
      this.shopMode = 'standard'
      this.shopLeaveLockedUntil = Date.now() + 500
      // 房间商店只是隧道房间里的额外货架：收起后回到房间，由 NPC 旁的出口裂隙离开。
      if (this.roomMap) {
        this.phase = 'playing'
        audio.startBgm('shop')
        audio.setBgmIntensity(0)
        this.completeRoomMap('额外货架已收起')
        return
      }
      this.proceedToShop()
      this.hud.toast('额外货架结束，进入本层标准商店', 'good')
      return
    }
    this.saveRun(AUTOSAVE_SLOT)
    this.layerSnapshot = {
      ...this.run,
      cards: { ...this.run.cards },
      inventory: this.run.inventory.map((item) => ({ ...item })),
      training: { ...(this.run.training ?? {}) },
      hp: this.player?.hp ?? this.run.hp,
      maxHp: this.player?.stats.maxHp ?? this.run.maxHp,
    }
    const next = this.run.layer + 1
    if (next > layerCount(this.run.difficulty)) {
      this.win()
      return
    }
    this.enterLayer(next)
  }

  // ---------- 背包 ----------

  private inventoryOpen(): boolean {
    return this.hud.isInventoryOpen?.() ?? false
  }

  openInventory(): void {
    this.hud.showInventory(this.inventory.items, this.run.gold, this.inventory.maxSlots)
  }

  closeInventory(): void {
    this.hud.hideInventory()
  }

  /** 把物品放进背包：满了先自动合成腾格子，合成后仍满才拒绝（不再直接卡进度） */
  private grantItem(item: InventoryItem, notifyFull = true): boolean {
    if (this.inventory.isFull) this.inventory.autoMerge()
    if (this.inventory.isFull) {
      if (notifyFull) this.hud.toast('背包已满：先合成或丢弃两张再买', 'bad')
      return false
    }
    if (!this.inventory.add(item)) return false
    const merged = this.inventory.autoMerge()
    if (merged.length > 0) {
      const last = merged[merged.length - 1]
      this.hud.toast(`自动合成 ${last.name}`, 'good')
    }
    this.syncCards()
    if (this.inventoryOpen()) this.hud.updateInventory(this.inventory.items, this.run.gold)
    return true
  }

  /** 奖励卡入口：背包满且无法自动合成时，按当前层商店价 50% 折算金币，避免奖励直接消失 */
  private grantRewardItem(item: InventoryItem): boolean {
    if (this.grantItem(item, false)) return true
    const gold = salvageGold(item, this.run.layer)
    this.run.gold += gold
    this.hud.toast(`背包已满，「${item.name}」折算 +${gold} 金币`, 'good')
    if (this.inventoryOpen()) this.hud.updateInventory(this.inventory.items, this.run.gold)
    return false
  }

  discardItem(uid: string): void {
    const item = this.inventory.discard(uid)
    if (!item) return
    this.syncCards()
    this.hud.updateInventory(this.inventory.items, this.run.gold)
    this.hud.toast(`丢弃 ${item.name}（不退金币）`, 'info')
    audio.click()
  }

  mergeItems(a: string, b: string): void {
    const merged = this.inventory.merge(a, b)
    if (!merged) {
      this.hud.toast('只有同级同种才能合成', 'bad')
      return
    }
    this.syncCards()
    this.hud.updateInventory(this.inventory.items, this.run.gold)
    this.hud.toast(`合成 ${merged.name}`, 'good')
    audio.click()
  }

  useItem(uid: string): void {
    const item = this.inventory.get(uid)
    if (!item) return
    const used = this.inventory.use(uid)
    if (!used) return
    if (used.icon === '🧪' || used.name.includes('药水')) {
      this.player?.heal(this.player.stats.maxHp * 0.35)
      this.hud.toast('喝下治疗药水', 'good')
    } else if (used.icon === '🔋' || used.name.includes('电池')) {
      this.combat?.grantCharge(1)
      this.hud.toast('技能充能已满', 'good')
    } else {
      this.inventory.add(used)
      this.hud.toast('这个道具现在还不能用', 'bad')
      return
    }
    this.syncCards()
    this.hud.updateInventory(this.inventory.items, this.run.gold)
    audio.heal()
  }

  // ---------- 存档 ----------

  saveRun(slot: number): void {
    this.run.hp = this.player?.hp ?? this.run.hp
    this.run.maxHp = this.player?.stats.maxHp ?? this.run.maxHp
    this.run.style = this.combat?.styleId ?? this.run.style
    this.run.inventory = this.inventory.items.map((i) => ({ ...i }))
    this.run.cards = { ...this.cards }
    this.run.training = { ...(this.run.training ?? {}) }
    this.run.trainingBuys = Math.max(0, Math.round(this.run.trainingBuys ?? 0))
    this.run.savedAt = Date.now()
    saveToSlot(slot, this.run)
  }

  manualSave(slot: number): void {
    this.saveRun(slot)
    this.hud.toast(`已存入档位 ${slot}`, 'good')
    this.hud.showSaveSlots('save', listSlots())
  }

  manualLoad(slot: number): void {
    this.paused = false
    this.hud.hidePause()
    this.continueRun(slot)
  }

  // ---------- 数值 ----------

  private syncCards(): void {
    const cards = emptyCards()
    for (const item of this.inventory.items) {
      if (item.kind === 'buff-card') applyItemToCards(cards, item, 1)
    }
    // 金币训练属于「直接生效的永久属性」，不进背包，但与卡牌一起汇总。
    for (const [stat, value] of Object.entries(this.run.training ?? {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      const key = stat as CardStat
      if (key in cards) cards[key] = Number((cards[key] + value).toFixed(3))
    }
    this.cards = cards
    this.recalcStats()
  }

  private recalcStats(): void {
    const p = this.player
    if (!p) return
    const def = CHARACTERS[this.run.character]
    const tier = getWeaponTier(this.run.character, this.run.weaponLv) as Record<string, number>
    const allStat = (tier.allStatMul ?? 1) * (1 + this.riceStacks * 0.07)
    const mods = this.combat?.modifiers ?? NEUTRAL_MODS
    const c = this.cards
    const styleHpMul = this.run.style === 'murasame-blood' ? 0.9 : 1
    const maxHp = Math.round((def.base.hp + (c.hp ?? 0)) * allStat * styleHpMul)
    const stats: PlayerStats = {
      ...p.stats,
      maxHp,
      moveSpeed: (def.base.moveSpeed + (c.moveSpeed ?? 0)) * mods.moveSpeedMul,
      damage: (tier.damage ?? 10) * allStat,
      magic: (def.base.magic + (c.magic ?? 0)) * allStat * mods.magicMul,
      stamina: (def.base.stamina + (c.stamina ?? 0)) * allStat * mods.staminaMul,
      intelligence: (def.base.intelligence + (c.intelligence ?? 0)) * allStat * mods.intelligenceMul,
      chargeMax: Math.max(30, (def.base.chargeMax + (c.chargeMax ?? 0)) * allStat),
      chargeGain: c.chargeGain ?? 0,
      armor: 0,
      armorRate: Math.min(0.6, c.armor ?? 0),
      dodge: Math.min(0.24, (c.dodge ?? 0) + ((tier.dodgeChance as number) ?? 0)),
      critChance: Math.min(0.6, 0.08 + (c.crit ?? 0)),
      critMultiplier: 1.8,
      pickupRadius: 2.0,
      goldGain: 1,
      xpGain: 1,
      dashCooldown: 1.2,
      attackSpeed: 1,
      attackRadius: 0,
      blades: 0,
    }
    const gain = maxHp - this.prevMaxHp
    this.prevMaxHp = maxHp
    p.setStats(stats)
    if (gain > 0) p.heal(gain)
    this.run.maxHp = maxHp
    this.run.hp = p.hp
    this.combat?.setStats(stats)
  }

  private buildWorld(): GameWorld {
    const p = this.player
    const enemies: Hittable[] = []
    for (const g of this.goblins) if (g.alive) enemies.push(g as unknown as Hittable)
    if (this.boss && this.boss.alive) enemies.push(this.boss as unknown as Hittable)
    return {
      spawnPickup: (x, z, kind) => {
        this.pickups.spawn(kind, x, z, kind === 'gold' ? 1 : 20)
        if (kind === 'rice') {
          this.vfx.ring(x, z, { color: 0x8fffc8, radius: 1.1, life: 0.6, grow: 1.6 })
          this.hud.toast('白米饭出现了！拾取全属性 +7%', 'good')
        }
      },
      enemies,
      halfSize: this.floor?.halfSize ?? 20,
      clamp: (x, z) => this.floor?.clampToArena(x, z, 0.4) ?? { x, z },
      heal: (n) => this.player?.heal(n),
      grantInvuln: (s) => this.player?.grantInvuln(s),
      dashPlayer: (dx, dz, dist, dur) => this.player?.dashToward(dx, dz, dist, dur),
      burst: (x, z, color, count) => this.vfx.burst(x, z, { color, count: count ?? 8, speed: 4, life: 0.35, size: 0.25 }),
      grantShield: (amount, seconds) => this.grantShield(amount, seconds),
      playerHpRatio: () => {
        const cur = this.player
        if (!cur || cur.stats.maxHp <= 0) return 1
        return Math.max(0, Math.min(1, cur.hp / cur.stats.maxHp))
      },
    }
  }

  private grantShield(amount: number, seconds: number): void {
    if (amount <= 0 || seconds <= 0) return
    this.shieldHp = Math.max(this.shieldHp, amount)
    this.shieldTime = Math.max(this.shieldTime, seconds)
    const p = this.player
    if (p) this.vfx.ring(p.x, p.z, { color: 0x8fd8ff, radius: 0.9, life: 0.35, grow: 1.8 })
  }

  // ---------- HUD ----------

  private pushSnapshot(): void {
    const p = this.player
    const room = this.roomMap
    let roomObjective: string | undefined
    if (room) {
      if (this.roomActive) {
        roomObjective = this.boss
          ? `房间首领 · ${this.boss.title}`
          : `房间敌人 ${this.layerKilled} / ${this.layerTotal}`
      } else if (room.resolved) {
        roomObjective = '从出口裂隙离开房间'
      } else {
        roomObjective = `${room.npc.title} · ${room.npc.hint}`
      }
    }
    const snap: HudSnapshot = {
      hp: Math.max(0, Math.round(p?.hp ?? 0)),
      maxHp: Math.round(p?.stats.maxHp ?? 100),
      shield: Math.round(this.shieldHp),
      gold: this.run.gold,
      floor: this.run.layer,
      floorName: this.sceneName,
      room: !!room,
      roomName: room?.offer.title,
      roomObjective,
      stage: this.run.stage,
      stageName: STAGE_NAMES[this.run.stage - 1] ?? '',
      quota: this.layerKilled,
      quotaMax: this.layerTotal,
      stairsUnlocked: false,
      monsterKilled: this.layerKilled,
      monsterTotal: this.layerTotal,
      bossLayer: isBossLayer(this.run.difficulty, this.run.layer),
      enemiesAlive: this.goblins.length + (this.boss ? 1 : 0),
      kills: this.run.kills,
      time: this.run.playTime,
      charge: this.combat?.charge ?? 0,
      chargeMax: this.combat?.chargeMax ?? 100,
      skillName: this.combat?.skillName ?? '',
      skillReady: this.combat?.skillReady ?? false,
      resource: this.combat?.resource,
      weaponLv: this.run.weaponLv,
      cardCount: this.inventory.count,
      difficulty: this.run.difficulty,
      difficultyName: DIFFICULTIES[this.run.difficulty].name,
      character: this.run.character,
      characterName: CHARACTERS[this.run.character].name,
      boss: this.boss ? { name: this.boss.title, hp: this.boss.hp, maxHp: this.boss.maxHp } : null,
    }
    this.hud.update(snap)
  }

  // ---------- 调试（截图/自测用） ----------

  /** ?seed=N：固定开局随机种子，便于两次截图逐像素比对（排查地面闪烁） */
  setDebugSeed(seed: number | null): void {
    this.debugSeedValue = seed !== null && Number.isFinite(seed) ? seed : null
  }

  debugJump(
    layer: number,
    difficulty: DifficultyId = 'normal',
    character: CharacterId = 'mutsumi',
    styleId?: StyleId,
  ): void {
    this.startRun(character, difficulty, styleId)
    for (let i = 0; i < 8; i += 1) {
      const gold = 400
      this.run.gold += gold
      this.run.weaponLv = Math.min(MAX_WEAPON_LV, this.run.weaponLv + 1)
      this.combat?.setWeaponLv(this.run.weaponLv)
      if (i < 5) {
        const stat = (['magic', 'stamina', 'intelligence', 'hp', 'moveSpeed'] as CardStat[])[i % 5]
        const item = makeCardItem(stat, 1)
        this.inventory.add(item)
      }
      this.syncCards()
    }
    const target = Math.max(1, Math.min(layer, layerCount(difficulty)))
    while (this.run.layer < target) this.enterLayer(this.run.layer + 1)
  }

  /** 以固定步长快进模拟，用于无头截图验证战斗流程 */
  debugAdvance(seconds: number): void {
    const step = 1 / 30
    const n = Math.min(Math.round(seconds / step), 600 * 30)
    for (let i = 0; i < n; i += 1) {
      this.clock.getDelta()
      this.elapsed += step
      this.update(step)
      this.input.endFrame()
      if (this.phase !== 'playing' && this.phase !== 'title') break
    }
    this.renderer.render(this.scene, this.camera)
  }

  /** 无头/联调：自动朝最近敌人普攻，方便跑流程截图 */
  debugAutoAttack(on: boolean): void {
    this.autoPlay = on
  }

  private nearestEnemy(x: number, z: number, maxDist = 999): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null
    let bestD = maxDist * maxDist
    for (const g of this.goblins) {
      if (!g.alive) continue
      const d = (g.x - x) * (g.x - x) + (g.z - z) * (g.z - z)
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    if (!best && this.boss && this.boss.alive) best = this.boss
    return best
  }

  debugSaveSlots(): unknown[] {
    return listSlots()
  }

  /** 无头/联调：自动领取清层奖励卡（验证「先三选一，再传送门」） */
  debugPickFirstBonus(): void {
    if (this.awakeningActive && this.awakeningOffers[0]) this.pickTunnel(this.awakeningOffers[0].id)
    else if (this.bonusActive && this.bonusOffers[0]) this.pickTunnel(this.bonusOffers[0].id)
  }

  /** 无头/联调：存档 → 回标题 → 读档，验证 continue 流程 */
  debugSaveLoadLoop(): void {
    this.saveRun(1)
    this.quitToTitle()
    this.continueRun(1)
  }

  /** 无头/联调：切换风格，验证 9 套玩法/资源条 */
  debugSetStyle(styleId: StyleId): void {
    this.run.style = styleForCharacter(this.run.character, styleId).id
    this.run.awakenings = normalizeAwakenings(this.run.style, this.run.awakenings)
    this.combat?.setBuild(this.run.style, this.run.awakenings)
    this.syncCards()
  }

  /** 无头/联调：直接给某个觉醒等级（1..3），用于截图/验证效果 */
  debugAwaken(id: AwakeningId, level = 1): void {
    const style = styleForCharacter(this.run.character, this.run.style)
    if (!style.awakenings.some((awakening) => awakening.id === id)) return
    const next = normalizeAwakenings(style.id, this.run.awakenings)
    next[id] = Math.max(1, Math.min(3, Math.round(level)))
    this.run.awakenings = next
    this.combat?.setBuild(style.id, next)
  }

  /** 无头/联调：直接打开某个界面（title 之外的调试入口） */
  debugScreen(name: string): void {
    if (name === 'tunnel') {
      this.openTunnels()
    } else if (name === 'awakening') {
      this.openAwakening()
    } else if (name === 'shop') {
      this.proceedToShop()
    } else if (name === 'inventory') {
      if (this.inventory.add(makeCardItem('magic', 2))) this.syncCards()
      if (this.inventory.add(makeCardItem('stamina', 1))) this.syncCards()
      this.openInventory()
    } else if (name === 'pause') {
      this.togglePause()
    } else if (name === 'victory') {
      this.win()
    } else if (name === 'defeat') {
      this.die()
    } else if (name === 'skill') {
      if (this.combat && this.player) {
        this.combat.grantCharge(1)
        this.combat.trySkill(this.player.x, this.player.z, this.player.x, this.player.z - 3, this.buildWorld())
      }
    } else if (name === 'caster') {
      if (this.player) {
        for (let i = 0; i < 5; i += 1) {
          const a = (i / 5) * Math.PI * 2
          this.spawnGoblin('caster', Math.cos(a) * 6, this.player.z + Math.sin(a) * 6)
        }
      }
    } else if (name === 'save') {
      this.hud.showSaveSlots('save', listSlots())
    }
  }

  onResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    window.removeEventListener('resize', this.onResize)
    this.cleanupFloor()
    this.player?.dispose()
    this.combat?.dispose()
    this.pickups.dispose()
    this.vfx.dispose()
    this.fx.dispose()
    this.input.dispose()
    this.hud.destroy()
    this.renderer.dispose()
  }
}
