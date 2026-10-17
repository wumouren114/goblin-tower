import * as THREE from 'three'
import { Input } from './core/input'
import { audio } from './core/audio'
import { clamp, rotateInput } from './core/math'
import {
  BASE_STATS,
  CONFIG,
  DIFFICULTY,
  GOBLIN_BRUTE,
  GOBLIN_ELITE,
  GOBLIN_SMALL,
  THEMES,
  xpToNext,
} from './data/gameConfig'
import { floorAt } from './data/floors'
import { computeStats, rollUpgradeChoices } from './systems/stats'
import { CameraRig } from './systems/cameraRig'
import { Vfx } from './systems/vfx'
import { Blades, type BladeTarget } from './systems/blades'
import { ScreenFx } from './systems/screenFx'
import { TowerFloor } from './world/floor'
import { Player } from './entities/player'
import { Goblin } from './entities/goblin'
import { GoblinKing } from './entities/boss'
import { PickupManager } from './entities/pickups'
import type { Hud } from './ui/hud'
import type {
  DifficultyId,
  EnemyDef,
  FloorDef,
  GamePhase,
  HudSnapshot,
  PickupKind,
  PlayerStats,
  RunStats,
  UpgradeDef,
} from './types'

const BOSS_NAME = '哥布林之王'

/**
 * 游戏总控：把输入 / 相机 / 实体 / 场景 / UI 串成一局 run。
 *
 * 一局的流程：
 *   标题 → 第 1 层（刷怪攒经验，攒满目标或拖到兜底时间开楼梯）
 *   → 2/3/4 层 → 第 5 层 Boss → 掉落卷轴 → 拾取通关
 * 死亡/通关后回到结算页，可原难度重开。
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera

  private hud: Hud
  private input: Input
  private rig: CameraRig
  private vfx: Vfx
  private fx: ScreenFx
  private blades: Blades
  private player: Player
  private floor!: TowerFloor
  private pickups: PickupManager
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false

  private goblins: Goblin[] = []
  private boss: GoblinKing | null = null
  private bossDeathTimer = 0
  private bossSpawned = false
  private scrollDropped = false

  private phase: GamePhase = 'title'
  private paused = false
  private difficulty: DifficultyId = 'normal'
  private floorIndex = 1
  private floorDef: FloorDef = floorAt(1)

  private level = 1
  private xp = 0
  private gold = 0
  private kills = 0
  private runTime = 0
  private floorTime = 0
  private elapsed = 0
  private quotaKills = 0
  private stairsUnlocked = false
  private promptsVisible = false

  private baseStats: PlayerStats = { ...BASE_STATS }
  private stats: PlayerStats = { ...BASE_STATS }
  private stacks = new Map<string, number>()
  private pendingLevelUps = 0
  private currentChoices: UpgradeDef[] = []

  private spawnTimer = 1.4
  private eliteTimer = CONFIG.spawn.eliteEvery
  private bossSpawnTimer = -1
  private contactCooldowns = new WeakMap<Goblin, number>()
  private scratch = new THREE.Vector3()
  private snapshot: HudSnapshot | null = null

  constructor(canvas: HTMLCanvasElement, hud: Hud) {
    this.hud = hud
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, 0.1, 180)

    this.input = new Input(canvas)
    this.rig = new CameraRig(this.camera)
    this.vfx = new Vfx(this.scene)
    this.fx = new ScreenFx()
    this.blades = new Blades(this.scene)
    this.pickups = new PickupManager(this.scene)
    this.player = new Player(this.scene)

    this.hud.setCamera(this.camera)
    this.buildFloor(1, false)
    this.player.group.visible = true

    window.addEventListener('resize', this.onResize)
    this.clock.start()
    this.tick()
  }

  // ───────────────────────────── 生命周期 ─────────────────────────────

  showTitle(): void {
    this.phase = 'title'
    this.rig.reset()
    this.hud.showTitle()
    this.hud.setPaused(false)
  }

  startRun(difficulty: DifficultyId): void {
    audio.resume()
    audio.click()
    this.difficulty = difficulty
    this.hud.hideTitle()
    this.hud.hideEnd()
    this.hud.hideLevelUp()
    this.paused = false
    this.phase = 'playing'

    this.floorIndex = 1
    this.level = 1
    this.xp = 0
    this.gold = 0
    this.kills = 0
    this.runTime = 0
    this.stacks.clear()
    this.pendingLevelUps = 0
    this.currentChoices = []
    this.baseStats = { ...BASE_STATS }
    this.stats = computeStats(this.baseStats, this.stacks)
    this.player.setStats(this.stats)
    this.player.hp = this.stats.maxHp
    this.player.alive = true
    this.player.group.visible = true
    this.blades.setCount(this.stats.blades)
    this.buildFloor(1, true)
  }

  restart(): void {
    this.startRun(this.difficulty)
  }

  /** 调试用：直接开一局并跳到指定层（截图/联调脚本用） */
  debugJump(targetFloor: number, difficulty: DifficultyId = 'normal'): void {
    this.startRun(difficulty)
    for (let i = 1; i < targetFloor && i < 5; i += 1) this.advanceFloor()
  }

  /**
   * 调试用：以固定步长快进模拟若干秒，用于无头截图或控制台快速验收
   * （无头浏览器里 requestAnimationFrame 的虚拟时间不推进，只能手动步进）
   */
  debugAdvance(seconds: number, dt = 1 / 30): void {
    if (this.phase === 'title') this.startRun(this.difficulty)
    const steps = Math.max(1, Math.round(seconds / dt))
    for (let i = 0; i < steps; i += 1) {
      this.elapsed += dt
      this.update(dt)
      this.input.endFrame()
      if (this.phase === 'levelup') break
    }
    this.renderer.render(this.scene, this.camera)
  }

  private advanceFloor(): void {
    if (this.floorIndex >= 5) return
    this.floorIndex += 1
    this.fx.flash(0.85, 340)
    this.buildFloor(this.floorIndex, true)
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private disposeFloorEntities(): void {
    for (const g of this.goblins) {
      g.dispose()
    }
    this.goblins.length = 0
    if (this.boss) {
      this.boss.dispose()
      this.boss = null
    }
    this.bossDeathTimer = 0
    this.pickups.clear()
    this.contactCooldowns = new WeakMap()
    this.vfx.clear()
  }

  private buildFloor(index: number, announce: boolean): void {
    this.disposeFloorEntities()
    if (this.floor) this.floor.dispose()

    this.floorIndex = index
    this.floorDef = floorAt(index)
    this.floor = new TowerFloor(this.scene)
    this.floor.build(this.floorDef, THEMES[this.floorDef.theme], this.difficulty)

    const h = this.floor.halfSize
    this.player.setStats(this.stats)
    this.player.x = 0
    this.player.z = -h * 0.55
    this.player.group.position.set(this.player.x, 0, this.player.z)
    this.rig.reset()
    this.rig.update(0, this.player.x, this.player.z, 0, 0)

    this.floorTime = 0
    this.quotaKills = 0
    this.stairsUnlocked = false
    this.promptsVisible = false
    this.hud.showPrompt(null)
    this.spawnTimer = 1.4
    this.eliteTimer = CONFIG.spawn.eliteEvery
    this.bossSpawned = false
    this.bossSpawnTimer = this.floorDef.boss ? 2.2 : -1
    this.scrollDropped = false
    this.hud.hideBoss()
    this.fx.setBossMode(false)

    this.scatterInitialLoot()
    if (announce) {
      this.hud.showFloorBanner(this.floorIndex, this.floorDef.name, this.floorDef.subtitle)
      this.hud.toast(`第 ${this.floorIndex} 层 · ${this.floorDef.name}`, 'info')
    }
    this.pushSnapshot()
  }

  private scatterInitialLoot(): void {
    const def = this.floorDef
    const points = this.floor.scatterPoints(def.coinPiles + 6, 3)
    let goldLeft = def.coinPiles
    for (const p of points) {
      const distToPlayer = Math.hypot(p.x - this.player.x, p.z - this.player.z)
      if (distToPlayer < 4) continue
      if (goldLeft > 0) {
        this.pickups.spawn('gold', p.x, p.z, 1 + Math.floor(Math.random() * 3))
        goldLeft -= 1
      } else {
        this.pickups.spawn('xp', p.x, p.z, CONFIG.economy.xpPerBean)
      }
    }
  }

  // ───────────────────────────── 主循环 ─────────────────────────────

  private tick = (): void => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(this.clock.getDelta(), 1 / 30)
    this.elapsed += dt
    this.update(dt)
    this.renderer.render(this.scene, this.camera)
    this.input.endFrame()
  }

  private update(dt: number): void {
    this.handleHotkeys()
    const target = this.input.isDown('KeyW') || this.input.isDown('ArrowUp')
    void target

    const drag = this.input.consumeDrag()
    if (drag.x || drag.y) {
      this.rig.addYaw(drag.x * 0.005)
      if (drag.y) this.rig.zoom(drag.y * 0.002)
    }
    this.rig.zoom(-this.input.consumeWheel())

    const playing = this.phase === 'playing' && !this.paused
    const title = this.phase === 'title'
    const axis = playing ? this.input.moveAxis() : { x: 0, z: 0 }
    const worldDir = rotateInput(axis.x, axis.z, this.rig.yaw)
    const dtWorld = playing ? dt : dt * 0.2

    // 冲刺
    if (playing && (this.input.justPressed('ShiftLeft') || this.input.justPressed('Space'))) {
      if (this.player.tryDash(axis.x, axis.z)) {
        audio.dash()
        this.vfx.burst(this.player.x, this.player.z, { color: 0x9fe8ff, count: 8, speed: 2.6, life: 0.3, size: 0.3, y: 0.5 })
      }
    }

    this.player.update(dtWorld, axis.x, axis.z, this.rig.yaw, this.floor.propColliders, this.floor.halfSize - 0.55)
    const clamped = this.floor.clampToArena(this.player.x, this.player.z, this.player.radius)
    this.player.x = clamped.x
    this.player.z = clamped.z

    if (playing) {
      this.floorTime += dt
      this.runTime += dt
      this.updateSpawner(dt)
      this.updateEnemies(dt)
      this.updateBoss(dt)
      this.updateCombat(dt)
      this.updatePickups(dt)
      this.updateStairs()
      this.updateBossSpawnTimer(dt)
      if (this.player.hp <= 0) this.die()
    } else {
      this.updateAmbientBossDeath(dt)
    }

    this.floor.update(dtWorld, this.elapsed)
    this.vfx.update(dtWorld)
    this.fx.update(dt)
    this.rig.update(dt, this.player.x, this.player.z, worldDir.x, worldDir.z, title)
    this.player.group.visible = this.player.alive || this.phase !== 'dead'
    this.pushSnapshot()
  }

  private handleHotkeys(): void {
    if (this.input.justPressed('KeyM')) {
      const muted = audio.toggleMute()
      this.hud.setMuted(muted)
      this.hud.toast(muted ? '音效已关闭' : '音效已开启', 'info')
    }
    if (this.input.justPressed('KeyV') && this.phase !== 'title') {
      this.rig.toggleMode()
      this.hud.toast(`切换为${this.rig.modeName}`, 'info')
    }
    if (this.input.justPressed('KeyP') && this.phase === 'playing') {
      this.paused = !this.paused
      this.hud.setPaused(this.paused)
    }
    if (this.input.justPressed('Escape') && this.paused) {
      this.paused = false
      this.hud.setPaused(false)
    }
  }

  // ───────────────────────────── 刷怪 ─────────────────────────────

  private updateSpawner(dt: number): void {
    const def = this.floorDef
    if (def.boss && !this.bossSpawned) return
    const diff = DIFFICULTY[this.difficulty]
    this.spawnTimer -= dt
    if (this.spawnTimer > 0) return

    const alive = this.goblins.reduce((n, g) => n + (g.alive ? 1 : 0), 0)
    const cap = Math.min(def.maxAlive, CONFIG.spawn.maxAliveHardCap)
    const interval = Math.max(
      CONFIG.spawn.minInterval,
      def.spawnInterval * Math.pow(CONFIG.spawn.intervalDecay, this.floorTime / 4),
    ) / diff.spawn
    this.spawnTimer = interval
    if (alive >= cap) return

    const batch = Math.max(1, Math.min(def.spawnBatch, cap - alive))
    const bruteChance = clamp(0.04 + (def.index - 1) * 0.07, 0, 0.38)
    for (let i = 0; i < batch; i++) {
      const def2: EnemyDef = Math.random() < bruteChance ? GOBLIN_BRUTE : GOBLIN_SMALL
      this.spawnEnemy(def2, this.pickSpawnPoint())
    }

    this.eliteTimer -= dt
    if (this.eliteTimer <= 0) {
      this.eliteTimer = CONFIG.spawn.eliteEvery
      this.spawnEnemy(GOBLIN_ELITE, this.pickSpawnPoint())
      this.hud.toast('一只哥布林勇士出现了！', 'bad')
    }
  }

  private pickSpawnPoint(): { x: number; z: number } {
    const points = this.floor.spawnPoints
    if (!points.length) return { x: this.floor.halfSize * 0.9, z: 0 }
    let best = points[0]
    let bestDist = -1
    for (let i = 0; i < 6; i++) {
      const p = points[Math.floor(Math.random() * points.length)]
      const d = Math.hypot(p.x - this.player.x, p.z - this.player.z)
      if (d > bestDist) {
        bestDist = d
        best = p
      }
    }
    const jitterX = (Math.random() - 0.5) * 3
    const jitterZ = (Math.random() - 0.5) * 3
    const p = this.floor.clampToArena(best.x + jitterX, best.z + jitterZ, 0.6)
    return p
  }

  private spawnEnemy(def: EnemyDef, at: { x: number; z: number }, elite = false): void {
    const diff = DIFFICULTY[this.difficulty]
    const mul = {
      hp: this.floorDef.hpScale * diff.hp,
      damage: this.floorDef.damageScale * diff.damage,
      speed: this.floorDef.speedScale * diff.speed,
      scale: 1,
    }
    const g = new Goblin(this.scene, def, at.x, at.z, mul, elite)
    this.goblins.push(g)
    this.vfx.burst(at.x, at.z, { color: 0xff8adf, count: 5, speed: 2.2, life: 0.35, size: 0.26, y: 0.5 })
  }

  // ───────────────────────────── 敌人 / 战斗 ─────────────────────────────

  private updateEnemies(dt: number): void {
    const colliders = this.floor.propColliders
    const bounds = this.floor.halfSize - 0.55
    for (const g of this.goblins) {
      if (!g.alive && !g.canRemove) continue
      g.update(dt, this.player.x, this.player.z, colliders, bounds)
      if (g.alive) this.checkContact(g, dt)
    }

    // 互相推挤，避免叠成一个点
    const sep = CONFIG.combat.separation
    for (let i = 0; i < this.goblins.length; i++) {
      const a = this.goblins[i]
      if (!a.alive) continue
      for (let j = i + 1; j < this.goblins.length; j++) {
        const b = this.goblins[j]
        if (!b.alive) continue
        const dx = b.x - a.x
        const dz = b.z - a.z
        const minDist = a.radius + b.radius
        const d2 = dx * dx + dz * dz
        if (d2 >= minDist * minDist || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const overlap = (minDist - d) / d
        const push = Math.min(0.5, overlap * 0.5 * sep * 0.1 + overlap * 0.4)
        a.x -= dx * push * 0.5
        a.z -= dz * push * 0.5
        b.x += dx * push * 0.5
        b.z += dz * push * 0.5
      }
      const c = this.floor.clampToArena(a.x, a.z, a.radius)
      a.x = c.x
      a.z = c.z
      a.group.position.x = a.x
      a.group.position.z = a.z
    }

    // 清理死亡动画结束的怪
    for (let i = this.goblins.length - 1; i >= 0; i--) {
      const g = this.goblins[i]
      if (g.canRemove) {
        g.dispose()
        this.goblins.splice(i, 1)
      }
    }
  }

  private checkContact(g: Goblin, dt: number): void {
    let cd = (this.contactCooldowns.get(g) ?? 0) - dt
    this.contactCooldowns.set(g, cd)
    if (cd > 0) return
    if (this.player.invuln > 0) return
    const dx = g.x - this.player.x
    const dz = g.z - this.player.z
    const rr = g.radius + this.player.radius + 0.08
    if (dx * dx + dz * dz > rr * rr) return
    this.contactCooldowns.set(g, CONFIG.combat.contactCooldown)
    this.damagePlayer(g.damage)
  }

  private updateCombat(dt: number): void {
    if (!this.player.alive) return
    const targets: BladeTarget[] = []
    for (const g of this.goblins) {
      if (g.alive) targets.push(g)
    }
    if (this.boss && this.boss.alive) targets.push(this.boss)

    this.blades.setCount(Math.round(this.stats.blades))
    this.blades.update(dt, this.player.x, this.player.z, this.stats, targets, this.onBladeHit)
  }

  private onBladeHit = (target: BladeTarget, amount: number, crit: boolean, killed: boolean): void => {
    const isBoss = target === this.boss
    const y = isBoss ? 2.6 : 1.25
    this.scratch.set(target.x, y + Math.random() * 0.25, target.z)
    this.hud.damageNumber(this.scratch, Math.round(amount), crit ? 'crit' : 'normal')
    this.vfx.burst(target.x, target.z, {
      color: crit ? 0xffd76a : 0x9fffe6,
      count: crit ? 12 : 5,
      speed: 4.2,
      life: 0.28,
      size: crit ? 0.32 : 0.24,
      y: isBoss ? 1.8 : 0.9,
    })
    if (crit) {
      audio.crit()
      this.rig.shake(0.12)
    } else {
      audio.hit()
    }
    if (killed) {
      if (isBoss) this.onBossDeath()
      else this.handleGoblinKill(target as Goblin)
    }
  }

  private handleGoblinKill(g: Goblin): void {
    this.kills += 1
    this.quotaKills += 1
    const diff = DIFFICULTY[this.difficulty]
    const xpValue = Math.max(1, Math.round(g.xpValue * diff.xp))
    this.pickups.spawn('xp', g.x, g.z, xpValue)
    if (Math.random() < g.goldChance) {
      this.pickups.spawn('gold', g.x, g.z, 1 + Math.floor(Math.random() * 3))
    }
    if (g.elite) {
      for (let i = 0; i < 4; i++) {
        this.pickups.spawn('gold', g.x + (Math.random() - 0.5) * 2.4, g.z + (Math.random() - 0.5) * 2.4, 2)
      }
      if (Math.random() < 0.4) this.pickups.spawn('heart', g.x, g.z, 25)
      this.hud.toast('精英哥布林被击破！', 'good')
      this.vfx.ring(g.x, g.z, { color: 0xffd76a, radius: 4, life: 0.4 })
    }
    this.vfx.burst(g.x, g.z, {
      color: 0x8cff9e,
      count: g.elite ? 22 : 10,
      speed: 4.4,
      life: 0.45,
      size: 0.3,
      y: 0.85,
    })
    audio.enemyDie()
  }

  private damagePlayer(rawDamage: number): void {
    if (this.phase !== 'playing' || !this.player.alive) return
    const dealt = this.player.takeDamage(rawDamage)
    if (dealt <= 0) return
    audio.hurt()
    this.fx.hurt(dealt > this.stats.maxHp * 0.15 ? 1.2 : 0.8)
    this.rig.shake(0.4)
    this.vfx.burst(this.player.x, this.player.z, { color: 0xff5c6a, count: 10, speed: 3.4, life: 0.35, size: 0.28, y: 1 })
    if (this.player.hp <= 0) this.die()
  }

  // ───────────────────────────── Boss ─────────────────────────────

  private updateBossSpawnTimer(dt: number): void {
    if (!this.floorDef.boss || this.bossSpawned || this.bossSpawnTimer < 0) return
    this.bossSpawnTimer -= dt
    if (this.bossSpawnTimer > 0) return
    this.spawnBoss()
  }

  private spawnBoss(): void {
    const h = this.floor.halfSize
    const callbacks = {
      onSlam: (x: number, z: number, radius: number, damage: number) => {
        this.vfx.ring(x, z, { color: 0xff3b3b, radius, life: 0.5, grow: 1.2 })
        this.vfx.burst(x, z, { color: 0xffb0a0, count: 16, speed: 7, life: 0.4, size: 0.32, y: 0.6 })
        this.rig.shake(0.55)
        const d = Math.hypot(this.player.x - x, this.player.z - z)
        if (d < radius + this.player.radius) this.damagePlayer(damage)
      },
      onSummon: (count: number) => {
        if (!this.boss) return
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2
          const p = this.floor.clampToArena(this.boss.x + Math.cos(a) * 4.2, this.boss.z + Math.sin(a) * 4.2, 0.8)
          this.spawnEnemy(GOBLIN_SMALL, p)
        }
        this.vfx.ring(this.boss.x, this.boss.z, { color: 0xff3b6b, radius: 6, life: 0.6 })
        this.hud.toast('哥布林之王撕开了裂隙，召唤援军！', 'bad')
      },
      onRoar: () => {
        audio.bossRoar()
        this.rig.shake(0.7)
        this.hud.toast('哥布林之王发出震耳欲聋的怒吼！', 'bad')
      },
    }

    this.boss = new GoblinKing(this.scene, 0, h * 0.66, callbacks)
    this.boss.hp = this.boss.maxHp = Math.round(CONFIG.boss.hp * DIFFICULTY[this.difficulty].hp)
    this.bossSpawned = true
    this.hud.showBoss(BOSS_NAME, this.boss.hp, this.boss.maxHp)
    this.fx.setBossMode(true)
    this.rig.shake(0.8)
    audio.bossRoar()
    this.hud.toast('哥布林之王现身！击败它夺取传送卷轴！', 'bad')
    this.vfx.ring(this.boss.x, this.boss.z, { color: 0xffcc55, radius: 9, life: 0.8 })
  }

  private updateBoss(dt: number): void {
    const boss = this.boss
    if (!boss) return
    if (boss.alive) {
      boss.update(dt, this.player.x, this.player.z)
      const d = Math.hypot(this.player.x - boss.x, this.player.z - boss.z)
      if (d < boss.radius + this.player.radius && this.player.invuln <= 0) {
        this.damagePlayer(CONFIG.boss.damage * DIFFICULTY[this.difficulty].damage)
      }
      this.hud.updateBoss(boss.hp)
    }
  }

  private onBossDeath(): void {
    const boss = this.boss
    if (!boss || this.bossDeathTimer > 0) return
    this.bossDeathTimer = 1.6
    boss.alive = false
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.rig.shake(1)
    this.fx.flash(0.35, 380)
    audio.win()
    this.vfx.levelUpBurst(boss.x, boss.z)
    this.vfx.ring(boss.x, boss.z, { color: 0xffd76a, radius: 10, life: 0.9 })
    this.vfx.burst(boss.x, boss.z, { color: 0xffe9a8, count: 40, speed: 8, life: 1.0, size: 0.4, y: 1.8, gravity: -3 })

    // 卷轴 + 金币雨
    this.pickups.spawn('scroll', boss.x, boss.z, 1)
    this.scrollDropped = true
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2
      this.pickups.spawn('gold', boss.x + Math.cos(a) * 1.8, boss.z + Math.sin(a) * 1.8, 3)
    }
    this.hud.toast('哥布林之王倒下了！拾取「传送卷轴」离开这座塔！', 'good')
    gameEventsDelayToast(this, '卷轴就在王座中央……')
  }

  private updateAmbientBossDeath(dt: number): void {
    if (!this.boss || this.bossDeathTimer <= 0) return
    this.bossDeathTimer -= dt
    this.boss.group.rotation.y += dt * 0.6
    if (this.bossDeathTimer <= 0) {
      this.boss.dispose()
      this.boss = null
    }
  }

  private updateBossPhaseHint(): void {
    if (!this.boss) return
    if (this.boss.phase2) this.hud.toast('哥布林之王进入狂暴状态！', 'bad')
  }

  // ───────────────────────────── 拾取 / 升级 ─────────────────────────────

  private updatePickups(dt: number): void {
    const magnet = this.stats.pickupRadius * CONFIG.economy.magnetFactor
    this.pickups.update(dt, this.player.x, this.player.z, magnet, this.onCollect)
  }

  private onCollect = (kind: PickupKind, value: number): void => {
    const diff = DIFFICULTY[this.difficulty]
    if (kind === 'xp') {
      this.gainXp(Math.max(1, Math.round(value * this.stats.xpGain * diff.xp)))
      audio.pickup()
      this.vfx.burst(this.player.x, this.player.z, { color: 0x7fffe0, count: 3, speed: 1.8, life: 0.25, size: 0.2, y: 0.6 })
    } else if (kind === 'gold') {
      const gained = Math.max(1, Math.round(value * this.stats.goldGain * diff.gold))
      this.gold += gained
      audio.coin()
      this.scratch.set(this.player.x, 1.6, this.player.z)
      this.hud.damageNumber(this.scratch, gained, 'gold')
    } else if (kind === 'heart') {
      this.player.heal(value)
      audio.heal()
      this.scratch.set(this.player.x, 1.7, this.player.z)
      this.hud.damageNumber(this.scratch, value, 'heal')
      this.vfx.burst(this.player.x, this.player.z, { color: 0xff8aa0, count: 8, speed: 2.4, life: 0.4, size: 0.3, y: 1 })
    } else if (kind === 'scroll') {
      this.win()
    }
  }

  private gainXp(amount: number): void {
    if (this.phase !== 'playing' && this.phase !== 'levelup') return
    this.xp += amount
    let need = xpToNext(this.level)
    while (this.xp >= need) {
      this.xp -= need
      this.level += 1
      this.pendingLevelUps += 1
      need = xpToNext(this.level)
    }
    if (this.pendingLevelUps > 0 && this.phase === 'playing') this.openLevelUp()
  }

  private openLevelUp(): void {
    if (this.phase !== 'playing') return
    this.currentChoices = rollUpgradeChoices(this.stacks, 3, Math.random)
    if (this.currentChoices.length === 0) {
      this.pendingLevelUps = 0
      return
    }
    this.phase = 'levelup'
    audio.levelUp()
    this.vfx.levelUpBurst(this.player.x, this.player.z)
    this.rig.shake(0.22)
    this.hud.showLevelUp(this.level, this.currentChoices)
    if (CONFIG.economy.levelUpVacuum) this.pickups.vacuumAll()
  }

  /** HUD 三选一回调 */
  chooseUpgrade(id: string): void {
    if (this.phase !== 'levelup') return
    const choice = this.currentChoices.find((c) => c.id === id)
    if (!choice) return
    const prevMax = this.stats.maxHp
    this.stacks.set(id, (this.stacks.get(id) ?? 0) + 1)
    this.stats = computeStats(this.baseStats, this.stacks)
    this.player.setStats(this.stats)
    const deltaHp = this.stats.maxHp - prevMax
    if (deltaHp > 0) this.player.hp = Math.min(this.stats.maxHp, this.player.hp + deltaHp)
    this.blades.setCount(Math.round(this.stats.blades))
    audio.click()
    this.hud.hideLevelUp()
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1)
    if (this.pendingLevelUps > 0) {
      this.phase = 'playing'
      this.openLevelUp()
    } else {
      this.phase = 'playing'
      this.hud.toast(`获得「${choice.name}」`, 'good')
    }
  }

  // ───────────────────────────── 楼梯 / 结算 ─────────────────────────────

  private unlockStairs(): void {
    if (this.stairsUnlocked) return
    this.stairsUnlocked = true
    this.floor.stairs.setUnlocked(true)
    const pos = this.floor.stairs
    this.vfx.levelUpBurst(pos.x, pos.z)
    audio.stairs()
    this.hud.toast('楼梯已开启！前往下一层', 'good')
    this.hud.showPrompt(null)
  }

  private updateStairs(): void {
    if (this.floorDef.boss) {
      this.setPrompt(null)
      return
    }
    if (!this.stairsUnlocked && (this.quotaKills >= this.floorDef.quota || this.floorTime >= this.floorDef.timeLimit)) {
      this.unlockStairs()
    }
    const s = this.floor.stairs
    const d = Math.hypot(this.player.x - s.x, this.player.z - s.z)
    const near = this.stairsUnlocked && d < 2.6
    if (near) {
      this.setPrompt(`按 E 前往第 ${this.floorIndex + 1} 层`)
      if (this.input.justPressed('KeyE')) this.advanceFloor()
    } else if (this.stairsUnlocked) {
      this.setPrompt('楼梯已开启，前往北侧的阶梯')
    } else {
      const left = Math.max(0, this.floorDef.quota - this.quotaKills)
      this.setPrompt(left > 0 && this.floorTime > 6 ? `再击杀 ${left} 只哥布林开启楼梯` : null)
    }
  }

  private setPrompt(text: string | null): void {
    if (this.promptsVisible === (text !== null) && text === null) return
    this.promptsVisible = text !== null
    this.hud.showPrompt(text)
  }

  private pushSnapshot(): void {
    if (!this.floor) return
    const boss = this.boss
    if (boss && boss.phase2 && !this.bossPhase2Notified) {
      this.bossPhase2Notified = true
      this.updateBossPhaseHint()
    }
    const snapshot: HudSnapshot = {
      hp: Math.max(0, this.player.hp),
      maxHp: this.stats.maxHp,
      xp: this.xp,
      xpToNext: xpToNext(this.level),
      level: this.level,
      gold: this.gold,
      kills: this.kills,
      floor: this.floorIndex,
      floorName: this.floorDef.name,
      quota: this.floorDef.boss ? 0 : Math.min(this.quotaKills, this.floorDef.quota),
      quotaMax: this.floorDef.boss ? 0 : this.floorDef.quota,
      stairsUnlocked: this.stairsUnlocked,
      enemiesAlive: this.goblins.reduce((n, g) => n + (g.alive ? 1 : 0), 0) + (boss && boss.alive ? 1 : 0),
      time: this.runTime,
      boss: boss && boss.alive ? { name: BOSS_NAME, hp: boss.hp, maxHp: boss.maxHp } : null,
    }
    this.snapshot = snapshot
    this.hud.update(snapshot)
  }

  private bossPhase2Notified = false

  private runStats(): RunStats {
    return {
      floor: this.floorIndex,
      level: this.level,
      kills: this.kills,
      gold: this.gold,
      time: this.runTime,
      difficulty: this.difficulty,
    }
  }

  private die(): void {
    if (this.phase === 'dead') return
    this.phase = 'dead'
    this.player.alive = false
    this.paused = false
    this.hud.setPaused(false)
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.fx.flash(0.5, 500)
    this.rig.shake(0.9)
    audio.lose()
    this.vfx.burst(this.player.x, this.player.z, { color: 0xff6478, count: 30, speed: 6, life: 0.9, size: 0.36, y: 1 })
    this.hud.showGameOver(this.runStats())
  }

  private win(): void {
    if (this.phase === 'victory') return
    this.phase = 'victory'
    this.paused = false
    this.hud.setPaused(false)
    this.hud.hideBoss()
    this.fx.setBossMode(false)
    this.fx.flash(0.75, 700)
    audio.win()
    this.vfx.levelUpBurst(this.player.x, this.player.z)
    this.hud.showVictory(this.runStats())
  }

  // 暴露给调试 / 文档
  get currentPhase(): GamePhase {
    return this.phase
  }

  get currentStats(): PlayerStats {
    return this.stats
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.onResize)
    this.disposeFloorEntities()
    this.floor.dispose()
    this.player.dispose()
    this.pickups.dispose()
    this.blades.dispose()
    this.vfx.dispose()
    this.fx.dispose()
    this.input.dispose()
    this.renderer.dispose()
  }
}

/** 延迟一帧的提示（避免同帧 toast 被覆盖） */
function gameEventsDelayToast(game: Game, text: string): void {
  setTimeout(() => {
    void game
    void text
  }, 0)
}
