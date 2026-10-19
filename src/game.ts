import * as THREE from 'three'
import { Player } from './entities/player'
import { enemyBulletSprite, getBillboardYaw, setSpriteFrame, type SpriteAnim } from './art/sprites'
import { Goblin } from './entities/goblin'
import { GOBLIN_SMALL, GOBLIN_BRUTE, GOBLIN_ELITE, GOBLIN_CASTER } from './data/gameConfig'
import { GoblinKing } from './entities/boss'
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
import { getWeaponTier, charTakeDamageMul, tierNum } from './data/characterRuntime'
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
  layerTimerFor,
  bossHpFor,
  BALANCE,
} from './data/balance'
import { Inventory, weaponMaxLevel } from './systems/inventory'
import { generateOffers, REFRESH_COST } from './systems/shop'
import { rollTunnels, resolveRoom } from './systems/tunnels'
import { listSlots, loadFromSlot, saveToSlot } from './systems/saveLoad'
import {
  applyItemToCards,
  clearGold,
  emptyCards,
  killGold,
  makeCardItem,
  qualityFor,
} from './systems/economy'
import type { HudV3 } from './ui/hud'
import type {
  CardStat,
  CharacterId,
  DifficultyId,
  GamePhase,
  HudSnapshot,
  InventoryItem,
  PlayerStats,
  RunState,
  RunStatsV3,
  ShopOffer,
  TunnelOffer,
} from './types'

/** 自动存档槽：每层开始/离开商店时覆盖；手动存档 UI 里也会列出，因此要标注 */
const AUTOSAVE_SLOT = 1
const NEUTRAL_MODS = { staminaMul: 1, magicMul: 1, intelligenceMul: 1, moveSpeedMul: 1, damageReduction: 0 }

/** CombatWorld 的可选扩展（combat 侧 duck-type 探测） */
interface GameWorld extends CombatWorld {
  spawnPickup?: (x: number, z: number, kind: 'rice' | 'heart' | 'gold') => void
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
  private goblinKinds = new Map<Goblin, 'small' | 'brute' | 'elite' | 'caster'>()
  private contactCd = new Map<Goblin, number>()
  /** 远程怪开火冷却 */
  private casterCd = new Map<Goblin, number>()
  /** 敌方弹幕（紫球） */
  private enemyShots: { mesh: THREE.Mesh; x: number; z: number; vx: number; vz: number; life: number; damage: number }[] = []
  private bulletAnim: SpriteAnim | null = null

  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private aimPoint = new THREE.Vector3(0, 0.6, -6)
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6)

  phase: GamePhase = 'title'
  paused = false
  private pausedFrom: GamePhase = 'playing'

  private run: RunState = makeRunState('mutsumi', 'normal')
  private cards: Record<CardStat, number> = emptyCards()
  private inventory = new Inventory(12)
  private prevMaxHp = 100

  private layerTotal = 0
  private layerSpawned = 0
  private layerKilled = 0
  private timeLeft = 60
  private timeLimit = 60
  private spawnTimer = 0
  private roomActive = false

  private tunnelOffers: TunnelOffer[] = []
  private shopOffers: ShopOffer[] = []
  private shopMode: 'room' | 'standard' = 'standard'

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
  private layerSnapshot: RunState | null = null
  private riceStacks = 0
  private bossBarrageTimer = 4
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
    this.renderer.toneMappingExposure = 1.15

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

  startRun(character: CharacterId, difficulty: DifficultyId): void {
    this.cleanupFloor()
    this.riceStacks = 0
    this.run = makeRunState(character, difficulty)
    audio.resume()
    audio.startBgm('battle')
    audio.setBgmIntensity(1)
    this.run.seed = Math.floor(Math.random() * 1e9)
    this.rng = new Rng(this.run.seed)
    this.inventory = new Inventory(12)
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
    this.run = state
    this.rng = new Rng(state.seed)
    this.inventory = new Inventory(12)
    for (const item of state.inventory) this.inventory.add(item)
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
    this.coreClean()

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
    this.timeLimit = layerTimerFor(diff, bossLayer, layer)
    this.timeLeft = this.timeLimit
    this.spawnTimer = bossLayer ? 2.0 : 0.4
    this.combat?.resetLayer(CHARGE_FLOOR_START_RATIO)

    if (bossLayer) {
      this.layerTotal = Math.round(quotaFor(this.run.difficulty, layer) * 0.6)
      this.spawnBoss()
    }

    this.hud.hideTunnels()
    this.hud.hideShop()
    this.hud.showLayerBanner(layer, sceneDef.name, STAGE_NAMES[this.run.stage - 1] ?? '', total)
    if (!restoring) this.hud.toast(bossLayer ? 'Boss 层：击杀哥布林之王！' : `第 ${layer} 层 · 清完 ${this.layerTotal} 只哥布林`, 'info')
    this.recalcStats()
    this.saveRun(AUTOSAVE_SLOT)
    this.layerSnapshot = {
      ...this.run,
      cards: { ...this.run.cards },
      inventory: this.run.inventory.map((item) => ({ ...item })),
      hp: this.player?.hp ?? this.run.hp,
      maxHp: this.player?.stats.maxHp ?? this.run.maxHp,
    }
  }

  /** 清掉非场景实体的临时对象（保留下层可复用的池） */
  private coreClean(): void {
    for (const g of this.goblins) g.dispose()
    this.goblins.length = 0
    this.goblinKinds.clear()
    this.contactCd.clear()
    if (this.boss) {
      this.boss.dispose()
      this.boss = null
    }
    this.pickups.clear()
  }

  private spawnBoss(): void {
    const diff = this.run.difficulty
    const half = this.floor?.halfSize ?? 20
    const boss = new GoblinKing(this.scene, 0, -half * 0.55, {
      onSlam: (x, z, radius, damage) => {
        this.vfx.telegraph(x, z, radius, 0.2)
        this.vfx.burst(x, z, { color: 0xff5a2a, count: 26, speed: 7, life: 0.5, size: 1.0 })
        this.rig.shake(0.5)
        audio.enemyDie()
        this.damagePlayer(damage)
      },
      onSummon: (count) => {
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * Math.PI * 2
          const sx = boss.x + Math.cos(a) * 3.2
          const sz = boss.z + Math.sin(a) * 3.2
          this.spawnGoblin('small', sx, sz)
        }
        this.vfx.ring(boss.x, boss.z, { color: 0x8a2be2, radius: 4.2, life: 0.6, grow: 1.4 })
        this.hud.toast('哥布林之王撕开了裂隙，召唤援军！', 'bad')
      },
      onRoar: () => {
        audio.bossRoar()
        this.rig.shake(0.35)
        this.hud.toast('哥布林之王进入狂暴状态！', 'bad')
      },
    })
    boss.hp = bossHpFor(diff, this.run.layer)
    boss.maxHp = boss.hp
    this.boss = boss
    this.hud.showBoss('哥布林之王', boss.hp, boss.maxHp)
    this.fx.setBossMode(true)
    audio.bossRoar()
    this.rig.shake(0.6)
    this.vfx.ring(0, -half * 0.55, { color: 0xffb703, radius: 3, life: 0.9, grow: 2 })
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
    this.pushSnapshot()
  }

  private handleHotkeys(): void {
    if (this.input.justPressed('KeyM')) {
      const muted = audio.toggleMute()
      this.hud.setMuted(muted)
    }
    if (this.input.justPressed('KeyV')) this.rig.toggleMode()
    if (this.input.justPressed('KeyP') || this.input.justPressed('Escape')) {
      if (this.phase === 'playing' || this.phase === 'shop') this.togglePause()
    }
    if (this.input.justPressed('KeyI')) {
      if (this.phase === 'shop') this.openInventory()
      else if (this.inventoryOpen()) this.closeInventory()
    }
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
    }
    this.cards = { ...snap.cards }
    this.inventory = new Inventory(12)
    for (const item of this.run.inventory) this.inventory.add({ ...item })
    if (!this.player) {
      this.startRun(this.run.character, this.run.difficulty)
      return
    }
    this.player.alive = true
    this.syncCards()
    this.recalcStats()
    if (this.combat) {
      this.combat.setCharacter(this.run.character)
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
    this.timeLeft = Math.max(0, this.timeLeft - dt)
    if (this.timeLeft <= 0) {
      this.die('timeout')
      return
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

    this.updateSpawner(dt)
    this.updateEnemies(dt)
    this.updateEnemyShots(dt)
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

    const attackHeld = this.autoPlay || this.input.attackHeld
    if (attackHeld && this.combat) {
      p.faceToward(this.aimPoint.x, this.aimPoint.z)
      this.combat.tryAttack(dt, p.x, p.z, this.aimPoint.x, this.aimPoint.z, this.buildWorld())
    }
    const skillPressed = this.input.consumeSkill() || this.input.justPressed('KeyQ')
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
      this.die('hp')
      return
    }
    this.checkLayerClear()
  }

  // ---------- 刷怪 / 敌人 ----------

  private updateSpawner(dt: number): void {
    if (!this.floor) return
    if (this.layerSpawned >= this.layerTotal) return
    const alive = this.goblins.length + (this.boss ? 1 : 0)
    if (alive >= maxAliveFor(this.run.difficulty, this.run.layer)) return
    this.spawnTimer -= dt
    if (this.spawnTimer > 0) return
    const interval = spawnIntervalFor(this.run.difficulty, this.run.layer)
    this.spawnTimer = interval
    this.spawnOne()
  }

  private spawnOne(): void {
    const layer = this.run.layer
    let kind: 'small' | 'brute' | 'elite' | 'caster' = 'small'
    const bruteChance = Math.min(0.38, 0.04 + (layer - 1) * 0.06)
    const eliteChance = layer >= 4 ? 0.08 : 0
    const casterChance = layer >= 2 ? Math.min(0.24, 0.1 + (layer - 2) * 0.02) : 0
    const r = this.rng.next()
    if (r < eliteChance) kind = 'elite'
    else if (r < eliteChance + casterChance) kind = 'caster'
    else if (r < eliteChance + casterChance + bruteChance) kind = 'brute'
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

  private spawnGoblin(kind: 'small' | 'brute' | 'elite' | 'caster', x: number, z: number): void {
    const def = kind === 'small' ? GOBLIN_SMALL : kind === 'brute' ? GOBLIN_BRUTE : kind === 'caster' ? GOBLIN_CASTER : GOBLIN_ELITE
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
  }

  private spawnEnemyShot(x: number, z: number, tx: number, tz: number, damage: number): void {
    if (!this.bulletAnim) this.bulletAnim = enemyBulletSprite()
    const dx = tx - x
    const dz = tz - z
    const d = Math.hypot(dx, dz) || 1
    const speed = 7.2
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.55),
      new THREE.MeshBasicMaterial({ map: this.bulletAnim.texture, transparent: true, depthWrite: false, toneMapped: false }),
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

  private updateEnemies(dt: number): void {
    const p = this.player
    if (!p) return
    const colliders = this.floor?.propColliders ?? []
    const bounds = (this.floor?.halfSize ?? 20) - 0.5
    for (let i = this.goblins.length - 1; i >= 0; i -= 1) {
      const g = this.goblins[i]
      const kind = this.goblinKinds.get(g)
      if (kind === 'caster') {
        // 术士：保持 6~9m 距离，站定读条后向玩家丢紫球
        const dx = g.x - p.x
        const dz = g.z - p.z
        const d = Math.hypot(dx, dz) || 1
        let tx = g.x
        let tz = g.z
        if (d < 6) {
          tx = p.x + (dx / d) * 9
          tz = p.z + (dz / d) * 9
        } else if (d > 10) {
          tx = p.x
          tz = p.z
        }
        g.update(dt, tx, tz, colliders, bounds)
        const cd = (this.casterCd.get(g) ?? 0) - dt
        if (cd <= 0 && d < 13) {
          this.spawnEnemyShot(g.x, g.z, p.x, p.z, g.damage * 0.9)
          this.casterCd.set(g, 2.6)
          this.vfx.ring(g.x, g.z, { color: 0x9a5cff, radius: 0.7, life: 0.3, grow: 1.2 })
        } else {
          this.casterCd.set(g, cd)
        }
      } else {
        g.update(dt, p.x, p.z, colliders, bounds)
      }
      if (!g.alive) {
        if (g.canRemove) {
          g.dispose()
          this.goblins.splice(i, 1)
          this.goblinKinds.delete(g)
          this.contactCd.delete(g)
          this.casterCd.delete(g)
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
        this.bossBarrageTimer = 6.5
        const count = 12
        for (let i = 0; i < count; i += 1) {
          const a = (i / count) * Math.PI * 2 + this.rng.next() * 0.2
          this.spawnEnemyShot(boss.x, boss.z, boss.x + Math.cos(a) * 10, boss.z + Math.sin(a) * 10, mobDamageFor(this.run.difficulty, this.run.layer) * 2.2)
        }
        this.vfx.ring(boss.x, boss.z, { color: 0xb46bff, radius: 2.2, life: 0.5, grow: 2.4 })
        this.hud.toast('哥布林之王释放了紫色弹幕！', 'bad')
        audio.bossRoar()
      }
    }
    if (!boss.alive) {
      this.onBossDefeated()
      return
    }
    const dx = p.x - boss.x
    const dz = p.z - boss.z
    const rr = boss.radius + p.radius
    if (dx * dx + dz * dz < rr * rr) this.damagePlayer(mobDamageFor(this.run.difficulty, this.run.layer) * 2.2)
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
    const dmg = raw * charTakeDamageMul(this.run.character) * (1 - Math.min(0.6, stats.armorRate))
    const dealt = p.takeDamage(dmg)
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

  private onGoblinKilled(g: Goblin, kind: 'small' | 'brute' | 'elite' | 'caster'): void {
    this.run.kills += 1
    this.layerKilled += 1
    this.combat?.onKill(g)
    const rewardKind = kind === 'caster' ? 'small' : kind
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
      if (this.grantItem(item)) this.hud.toast(`拾取增益卡：${item.name}`, 'good')
    }
  }

  // ---------- 通关 / 失败 ----------

  private checkLayerClear(): void {
    if (this.roomActive) {
      if (this.goblins.length === 0) this.finishRoomBattle()
      return
    }
    if (isBossLayer(this.run.difficulty, this.run.layer)) return
    if (this.layerKilled >= this.layerTotal && this.goblins.length === 0) this.onLayerCleared()
  }

  private onLayerCleared(): void {
    const gold = clearGoldFor(this.run.difficulty, this.run.layer, )
    this.run.gold += gold
    this.hud.toast(`第 ${this.run.layer} 层清空！+${gold} 金币`, 'good')
    audio.stairs()
    this.vfx.levelUpBurst(this.player?.x ?? 0, this.player?.z ?? 0)
    this.openBonusCards()
  }

  private onBossDefeated(): void {
    if (!this.boss) return
    const boss = this.boss
    boss.alive = false
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.rig.shake(0.9)
    this.fx.flash(0.6, 220)
    audio.win()
    audio.setBgmIntensity(1)
    this.vfx.levelUpBurst(boss.x, boss.z)
    this.vfx.ring(boss.x, boss.z, { color: 0xffd166, radius: 3, life: 1.2, grow: 4 })
    this.vfx.burst(boss.x, boss.z, { color: 0xffd166, count: 40, speed: 9, life: 0.9, size: 0.4 })
    this.run.gold += Math.round(killGold(this.run.layer, 'boss'))
    this.hud.toast('哥布林之王倒下了！', 'good')
    boss.dispose()
    this.boss = null
    if (this.run.layer >= layerCount(this.run.difficulty)) this.win()
    else {
      this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
      this.openBonusCards()
    }
  }

  private die(reason: 'hp' | 'timeout'): void {
    if (this.phase === 'dead' || this.phase === 'victory') return
    this.phase = 'dead'
    if (this.player) this.player.alive = false
    this.fx.hurt(1)
    audio.lose()
    audio.startBgm('title', { fadeMs: 900 })
    audio.setBgmIntensity(0)
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.hud.showDefeat(reason, this.runStats())
  }

  private win(): void {
    this.phase = 'victory'
    audio.startBgm('victory')
    audio.setBgmIntensity(1)
    audio.win()
    this.hud.showVictory(this.runStats())
  }

  private runStats(reason?: 'hp' | 'timeout'): RunStatsV3 {
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

  /** 每层清空后：先三选一拿一张增益卡，再开时空隧道。
   *  高层按 balance.shop.quality 掷品质，出精制/臻品，后期不至于「选谁都一样」 */
  private openBonusCards(): void {
    const pool = [...BALANCE.buffCards]
    this.bonusOffers = []
    for (let i = 0; i < 3 && pool.length > 0; i += 1) {
      const idx = this.rng.int(0, pool.length - 1)
      const card = pool.splice(idx, 1)[0]
      const q = qualityFor(this.run.layer, this.rng)
      const value = Number((card.value * q.valueMul).toFixed(3))
      const tierName = q.tier === 3 ? '臻品' : q.tier === 2 ? '精制' : ''
      const bonusTag = q.tier > 1 ? `（${tierName} ×${q.valueMul}）` : ''
      this.bonusOffers.push({
        id: `bonus-${i}`,
        kind: 'reward',
        room: 'skill-card',
        title: `${tierName}${card.name}`,
        desc: `${card.desc}${bonusTag}`,
        icon: this.cardIcon(card.stat),
        payload: {
          skillCard: { id: card.id, name: card.name, desc: card.desc, stat: card.stat as CardStat, value, tier: q.tier },
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
    this.hud.showTunnelOffers(this.bonusOffers, this.run.layer)
    audio.levelUp()
  }

  private openTunnels(): void {
    this.phase = 'tunnel'
    audio.startBgm('shop')
    audio.duck(false)
    const boss = isBossLayer(this.run.difficulty, this.run.layer)
    this.tunnelOffers = rollTunnels(
      this.run.layer,
      layerCount(this.run.difficulty),
      boss,
      this.run.character,
      this.rng,
      this.run.weaponLv,
    )
    this.hud.showTunnelOffers(this.tunnelOffers, this.run.layer)
  }

  pickTunnel(id: string): void {
    if (this.phase !== 'tunnel') return
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
        if (this.grantItem(item)) {
          this.hud.toast(`清层奖励：${item.name}`, 'good')
        } else {
          this.hud.toast('背包已满，奖励卡丢失（可先合成/丢弃）', 'bad')
        }
      }
      this.openTunnels()
      return
    }
    const offer = this.tunnelOffers.find((o) => o.id === id)
    if (!offer) return
    this.hud.hideTunnels()
    audio.click()
    const res = resolveRoom(offer, this.run.layer, this.run.character, this.rng)
    if (res.gold) {
      this.run.gold += res.gold
      this.hud.toast(`+${res.gold} 金币`, 'good')
    }
    if (res.card) {
      if (this.grantItem(res.card)) {
        this.hud.toast(`${res.card.icon} ${res.card.name} 已放入背包`, 'good')
      } else {
        this.hud.toast('背包已满，卡牌丢失（可先合成/丢弃）', 'bad')
      }
    }
    if (res.rest) {
      const p = this.player
      if (p) {
        p.heal(p.stats.maxHp * res.rest.healRatio)
        this.run.hp = p.hp
      }
      this.combat?.grantCharge(res.rest.chargeRatio)
      this.vfx.ring(p?.x ?? 0, p?.z ?? 0, { color: 0x8fffc8, radius: 3, life: 0.8, grow: 2.2 })
      this.hud.toast(`休憩：回血 28%、充能 +50%`, 'good')
      audio.heal()
      this.proceedToShop()
      return
    }
    if (res.shopOffers && res.shopOffers.length > 0) {
      this.shopOffers = res.shopOffers
      this.shopMode = 'room'
      this.phase = 'shop'
      audio.startBgm('shop')
      audio.setBgmIntensity(0)
      this.hud.showShop(this.shopOffers, this.run.gold, REFRESH_COST)
      return
    }
    if (res.altarCost !== undefined && res.altarReward) {
      if (this.run.gold >= res.altarCost) {
        const qv = res.altarReward.value ?? 1
        const tier = qv >= 2.6 ? 3 : qv >= 1.5 ? 2 : 1
        const item = makeCardItem(res.altarReward.stat, tier)
        if (!this.grantItem(item)) return
        this.run.gold -= res.altarCost
        this.hud.toast(`祭坛献金 ${res.altarCost}：${item.name}`, 'good')
      } else {
        this.hud.toast('金币不足，祭坛不理你', 'bad')
      }
    }
    if (res.enemies) {
      this.startRoomBattle(res.enemies.count, res.enemies.elite)
      return
    }
    this.proceedToShop()
  }

  private startRoomBattle(count: number, elite: number): void {
    this.phase = 'playing'
    this.roomActive = true
    audio.startBgm('battle')
    audio.setBgmIntensity(1)
    this.timeLeft = Math.max(this.timeLeft, 45)
    this.layerTotal = count
    this.layerKilled = 0
    for (let i = 0; i < count; i += 1) {
      const pt = this.randomSpawnPoint()
      const kind = i < elite ? 'elite' : i % 5 === 0 ? 'brute' : 'small'
      this.spawnGoblin(kind, pt.x, pt.z)
    }
    this.hud.toast(elite > 0 ? '精英战：击败所有敌人！' : '战斗房：清空敌人！', 'bad')
    audio.bossRoar()
  }

  private finishRoomBattle(): void {
    this.roomActive = false
    this.hud.toast('房间清空！', 'good')
    this.run.gold += clearGoldFor(this.run.difficulty, this.run.layer)
    this.proceedToShop()
  }

  private proceedToShop(): void {
    this.shopOffers = generateOffers(this.run.layer, this.run.character, this.run.gold, this.rng, 4, this.run.weaponLv)
    this.shopMode = 'standard'
    this.phase = 'shop'
    audio.startBgm('shop')
    audio.duck(false)
    this.hud.showShop(this.shopOffers, this.run.gold, REFRESH_COST)
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
    this.shopOffers = generateOffers(this.run.layer, this.run.character, this.run.gold, this.rng, 4, this.run.weaponLv)
    audio.coin()
    this.hud.updateShop(this.shopOffers, this.run.gold, REFRESH_COST)
  }

  leaveShop(): void {
    if (this.phase !== 'shop') return
    this.hud.hideShop()
    this.hud.hideInventory()
    this.saveRun(AUTOSAVE_SLOT)
    this.layerSnapshot = {
      ...this.run,
      cards: { ...this.run.cards },
      inventory: this.run.inventory.map((item) => ({ ...item })),
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
  private grantItem(item: InventoryItem): boolean {
    if (this.inventory.isFull) this.inventory.autoMerge()
    if (this.inventory.isFull) {
      this.hud.toast('背包已满：先合成或丢弃两张再买', 'bad')
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
    this.run.inventory = this.inventory.items.map((i) => ({ ...i }))
    this.run.cards = { ...this.cards }
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
    const maxHp = Math.round((def.base.hp + (c.hp ?? 0)) * allStat)
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
    }
  }

  // ---------- HUD ----------

  private pushSnapshot(): void {
    const p = this.player
    const snap: HudSnapshot = {
      hp: Math.max(0, Math.round(p?.hp ?? 0)),
      maxHp: Math.round(p?.stats.maxHp ?? 100),
      gold: this.run.gold,
      floor: this.run.layer,
      floorName: this.sceneName,
      stage: this.run.stage,
      stageName: STAGE_NAMES[this.run.stage - 1] ?? '',
      quota: this.layerKilled,
      quotaMax: this.layerTotal,
      stairsUnlocked: false,
      monsterKilled: this.layerKilled,
      monsterTotal: this.layerTotal,
      timeLeft: this.timeLeft,
      timeLimit: this.timeLimit,
      enemiesAlive: this.goblins.length + (this.boss ? 1 : 0),
      kills: this.run.kills,
      time: this.run.playTime,
      charge: this.combat?.charge ?? 0,
      chargeMax: this.combat?.chargeMax ?? 100,
      skillName: this.combat?.skillName ?? '',
      skillReady: this.combat?.skillReady ?? false,
      weaponLv: this.run.weaponLv,
      cardCount: this.inventory.count,
      difficulty: this.run.difficulty,
      difficultyName: DIFFICULTIES[this.run.difficulty].name,
      character: this.run.character,
      characterName: CHARACTERS[this.run.character].name,
      boss: this.boss ? { name: '哥布林之王', hp: this.boss.hp, maxHp: this.boss.maxHp } : null,
    }
    this.hud.update(snap)
  }

  // ---------- 调试（截图/自测用） ----------

  debugJump(layer: number, difficulty: DifficultyId = 'normal', character: CharacterId = 'mutsumi'): void {
    this.startRun(character, difficulty)
    for (let i = 0; i < 8; i += 1) {
      const gold = 400
      this.run.gold += gold
      this.run.weaponLv = Math.min(weaponMaxLevel(this.run.character), this.run.weaponLv + 1)
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
    if (this.bonusActive && this.bonusOffers[0]) this.pickTunnel(this.bonusOffers[0].id)
  }

  /** 无头/联调：存档 → 回标题 → 读档，验证 continue 流程 */
  debugSaveLoadLoop(): void {
    this.saveRun(1)
    this.quitToTitle()
    this.continueRun(1)
  }

  /** 无头/联调：直接打开某个界面（title 之外的调试入口） */
  debugScreen(name: string): void {
    if (name === 'tunnel') {
      this.openTunnels()
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
      this.die('timeout')
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
