/**
 * 哥布林之塔 · UI 模块
 * ------------------------------------------------------------
 * 唯一对外入口：createHud(handlers) -> Hud
 * 负责：标题页 / HUD / 升级三选一 / Boss 血条 / 飘字 / 楼层横幅 /
 *       交互提示 / Toast / 结算 / 暂停 / 静音角标。
 *
 * 约定：
 * - 所有 DOM 只在 createHud 内创建一次，update() 只做文本与 transform 更新；
 * - #ui-root 整体 pointer-events:none，只有标题、升级、结算等全屏界面在打开时
 *   重新开启 pointer-events（见 styles.css），因此不会拦截鼠标拖拽视角；
 * - 飘字需要 setCamera(camera) 注入相机，每帧 update 时把世界坐标投影到屏幕。
 */

import * as THREE from 'three'
import type {
  DifficultyId,
  HudHandlers,
  HudSnapshot,
  RunStats,
  UpgradeDef,
} from '../types'
import { DIFFICULTY } from '../data/gameConfig'
import { RARITY_LABEL } from '../data/upgrades'
import { clamp01, div, el, fmtInt, fmtTime, restartAnim, setBarFill, setText, span } from './dom'

// ============================================================
// 对外接口（与 docs/INTERFACES.md 第 4 节严格一致）
// ============================================================

export interface Hud {
  setCamera(camera: THREE.PerspectiveCamera): void
  update(s: HudSnapshot): void
  showTitle(): void
  hideTitle(): void
  showLevelUp(level: number, choices: UpgradeDef[]): void
  hideLevelUp(): void
  showBoss(name: string, hp: number, maxHp: number): void
  updateBoss(hp: number): void
  hideBoss(): void
  damageNumber(worldPos: THREE.Vector3, amount: number, kind: 'normal' | 'crit' | 'heal' | 'gold'): void
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void
  showPrompt(text: string | null): void
  showFloorBanner(floor: number, name: string, subtitle: string): void
  showGameOver(stats: RunStats): void
  showVictory(stats: RunStats): void
  hideEnd(): void
  setPaused(paused: boolean): void
  setMuted(muted: boolean): void
  destroy(): void
}

/** 同屏飘字上限（契约要求 ≤40） */
const MAX_FLOATERS = 40
/** 进入二阶段的 Boss 血量比例 */
const BOSS_PHASE2_RATIO = 0.55
/** 升级卡片点击后的确认延时，防止连点 / 键盘重复触发 */
const PICK_DELAY_MS = 150

type DmgKind = 'normal' | 'crit' | 'heal' | 'gold'

interface Floater {
  el: HTMLDivElement
  world: THREE.Vector3
  age: number
  life: number
  kind: DmgKind
  drift: number
  active: boolean
}

const DIFF_ORDER: DifficultyId[] = ['casual', 'normal', 'nightmare']

const DIFF_META: Record<DifficultyId, { icon: string; tag: string }> = {
  casual: { icon: '🌿', tag: '轻松' },
  normal: { icon: '⚔️', tag: '推荐' },
  nightmare: { icon: '💀', tag: '挑战' },
}

// ============================================================
// 静态结构模板：只创建一次，之后全部通过缓存的元素引用更新
// ============================================================

const UI_TEMPLATE = /* html */ `
  <!-- ===================== HUD ===================== -->
  <div class="hud js-hud" hidden>
    <div class="hud-floor js-floor">
      <div class="floor-line">
        <span class="floor-index">第 <b class="js-floor-num">1</b> 层</span>
        <span class="floor-name js-floor-name">苔石前厅</span>
      </div>
      <div class="quota-row">
        <div class="bar bar-quota"><i class="js-quota-fill"></i></div>
        <span class="quota-text js-quota-text">击杀 0 / 25</span>
      </div>
      <div class="alive-row"><span class="live-dot"></span>场上 <b class="js-alive">0</b> 只</div>
    </div>

    <div class="hud-right">
      <div class="hud-stats">
        <div class="stat stat-gold"><span class="stat-label">金币</span><span class="stat-val js-gold">0</span></div>
        <div class="stat stat-level"><span class="stat-label">等级</span><span class="stat-val js-level">1</span></div>
        <div class="stat stat-time"><span class="stat-label">计时</span><span class="stat-val js-time">00:00</span></div>
        <div class="stat stat-kill"><span class="stat-label">击杀</span><span class="stat-val js-kills">0</span></div>
      </div>
      <div class="mute-chip js-mute" hidden>🔇 已静音</div>
    </div>

    <div class="hud-vitals">
      <div class="vital vital-hp js-hp-block">
        <div class="vital-head">
          <span class="vital-label">生命</span>
          <span class="vital-num js-hp-text">120 / 120</span>
        </div>
        <div class="bar bar-hp"><i class="js-hp-fill"></i><span class="bar-ticks"></span></div>
      </div>
      <div class="vital vital-xp">
        <div class="lv-badge">Lv<b class="js-lv-badge">1</b></div>
        <div class="xp-main">
          <div class="vital-head">
            <span class="vital-label">经验</span>
            <span class="vital-num js-xp-text">0 / 9</span>
          </div>
          <div class="bar bar-xp"><i class="js-xp-fill"></i></div>
        </div>
      </div>
    </div>

    <div class="hud-prompt js-prompt" aria-live="polite"></div>

    <div class="hud-bottom">
      <div class="key-hints">
        <span class="key-hint"><kbd>WASD</kbd>移动</span>
        <span class="key-hint"><kbd>Shift</kbd>冲刺</span>
        <span class="key-hint"><kbd>E</kbd>交互</span>
        <span class="key-hint"><kbd>V</kbd>视角</span>
        <span class="key-hint"><kbd>P</kbd>暂停</span>
      </div>
      <div class="objective js-objective">还需击杀 25 只哥布林解锁楼梯</div>
    </div>
  </div>

  <!-- ===================== Boss 血条 ===================== -->
  <div class="boss-bar js-boss" aria-hidden="true">
    <div class="boss-head">
      <span class="boss-name js-boss-name">哥布林之王</span>
      <span class="boss-tag js-boss-tag">第一阶段</span>
    </div>
    <div class="boss-track">
      <i class="boss-fill js-boss-fill"></i>
      <span class="boss-ticks"></span>
    </div>
  </div>

  <!-- ===================== 飘字层 ===================== -->
  <div class="dmg-layer js-dmg-layer"></div>

  <!-- ===================== 楼层横幅 ===================== -->
  <div class="floor-banner js-banner" aria-hidden="true">
    <div class="fb-line"></div>
    <p class="fb-floor js-banner-floor">FLOOR 01</p>
    <h2 class="fb-name js-banner-name">第 1 层 · 苔石前厅</h2>
    <p class="fb-sub js-banner-sub">哥布林把守着塔的第一道门</p>
    <div class="fb-line"></div>
  </div>

  <!-- ===================== Toast ===================== -->
  <div class="toast-layer js-toast-layer" aria-live="polite"></div>

  <!-- ===================== 标题页 ===================== -->
  <section class="screen title-screen js-title" aria-label="标题页">
    <div class="title-bg" aria-hidden="true">
      <div class="title-stars"></div>
      <div class="moon"></div>
      <div class="ridge ridge-far"></div>
      <div class="ridge ridge-near"></div>

      <div class="tower tower-left">
        <div class="tower-pole"></div>
        <div class="tower-crenel"></div>
        <div class="tower-shaft">
          <i class="tower-win"></i><i class="tower-win"></i><i class="tower-win"></i>
          <i class="tower-crack"></i>
        </div>
        <div class="tower-foot"></div>
      </div>

      <div class="tower tower-right">
        <div class="tower-pole"></div>
        <div class="tower-crenel"></div>
        <div class="tower-shaft">
          <i class="tower-win"></i><i class="tower-win"></i>
          <i class="tower-crack"></i>
        </div>
        <div class="tower-foot"></div>
      </div>

      <div class="fog fog-a"></div>
      <div class="fog fog-b"></div>
    </div>

    <div class="title-inner">
      <header class="title-logo">
        <p class="title-kicker">PIXEL ROGUELIKE · 爬塔割草</p>
        <h1 class="title-cn">哥布林之塔</h1>
        <p class="title-en">GOBLIN TOWER</p>
        <p class="title-tagline">杀死哥布林之王，夺回逃离世界的卷轴</p>
      </header>

      <div class="title-lower">
        <section class="title-panel panel-diff">
          <h2 class="panel-label">选择难度</h2>
          <div class="diff-cards js-diff-cards"></div>
          <button class="btn-start js-start" type="button">开始爬塔</button>
          <p class="diff-tip js-diff-tip"></p>
        </section>

        <section class="title-panel panel-howto">
          <h2 class="panel-label">操作说明</h2>
          <div class="howto-list">
            <div class="howto-row"><span class="howto-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>移动</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>Shift</kbd></span><span>冲刺（短暂无敌）</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>E</kbd></span><span>交互 / 进入下一层</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>V</kbd></span><span>切换视角</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>P</kbd></span><span>暂停</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>鼠标</kbd></span><span>拖拽旋转镜头</span></div>
          </div>
          <p class="howto-note">击杀哥布林填满进度条，楼梯就会亮起；每上一层，怪物都会更凶狠。</p>
        </section>
      </div>
    </div>
  </section>

  <!-- ===================== 升级三选一 ===================== -->
  <section class="screen levelup-screen js-levelup" aria-label="升级选择">
    <div class="levelup-inner">
      <p class="levelup-kicker">LEVEL UP</p>
      <h2 class="levelup-title">等级提升！</h2>
      <p class="levelup-sub js-levelup-sub">达到 Lv.2 · 选择一项强化</p>
      <div class="upgrade-cards js-upgrade-cards"></div>
      <p class="levelup-hint">点击卡片，或按 <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 选择</p>
    </div>
  </section>

  <!-- ===================== 结算页 ===================== -->
  <section class="screen end-screen js-end" aria-label="本局结算">
    <div class="end-rays" aria-hidden="true"></div>
    <div class="end-inner">
      <p class="end-kicker js-end-kicker">RUN OVER · 阵亡</p>
      <h2 class="end-title js-end-title">你倒在了塔中</h2>
      <p class="end-sub js-end-sub"></p>
      <div class="end-stats">
        <div class="end-stat"><span class="end-stat-label">层数</span><span class="end-stat-value js-stat">第 1 层</span></div>
        <div class="end-stat"><span class="end-stat-label">等级</span><span class="end-stat-value js-stat">Lv.1</span></div>
        <div class="end-stat"><span class="end-stat-label">击杀</span><span class="end-stat-value js-stat">0</span></div>
        <div class="end-stat"><span class="end-stat-label">金币</span><span class="end-stat-value js-stat">0</span></div>
        <div class="end-stat"><span class="end-stat-label">用时</span><span class="end-stat-value js-stat">00:00</span></div>
        <div class="end-stat"><span class="end-stat-label">难度</span><span class="end-stat-value js-stat">标准</span></div>
      </div>
      <button class="btn-restart js-restart" type="button">重新开始</button>
      <p class="end-tip">按 <kbd>Enter</kbd> 或 <kbd>R</kbd> 再爬一次</p>
    </div>
  </section>

  <!-- ===================== 暂停 ===================== -->
  <section class="screen pause-screen js-pause" aria-label="暂停">
    <div class="pause-box">
      <span class="pause-icon">II</span>
      <h2>已暂停</h2>
      <p>按 <kbd>P</kbd> 继续爬塔</p>
    </div>
  </section>
`

// ============================================================
// 实现
// ============================================================

class HudImpl implements Hud {
  private readonly handlers: HudHandlers
  private readonly root: HTMLElement
  private readonly shell: HTMLDivElement
  private readonly cameraHolder: { camera: THREE.PerspectiveCamera | null } = { camera: null }

  private destroyed = false

  // ---------- 标题 ----------
  private titleEl!: HTMLElement
  private diffCardsEl!: HTMLElement
  private diffTipEl!: HTMLElement
  private startBtnEl!: HTMLButtonElement
  private readonly diffCardEls: HTMLButtonElement[] = []
  private selectedDifficulty: DifficultyId = 'normal'
  private startLocked = false

  // ---------- HUD ----------
  private hudEl!: HTMLElement
  private floorEl!: HTMLElement
  private floorNumEl!: HTMLElement
  private floorNameEl!: HTMLElement
  private quotaFillEl!: HTMLElement
  private quotaTextEl!: HTMLElement
  private aliveEl!: HTMLElement
  private goldEl!: HTMLElement
  private levelEl!: HTMLElement
  private timeEl!: HTMLElement
  private killsEl!: HTMLElement
  private muteEl!: HTMLElement
  private hpBlockEl!: HTMLElement
  private hpFillEl!: HTMLElement
  private hpTextEl!: HTMLElement
  private xpFillEl!: HTMLElement
  private xpTextEl!: HTMLElement
  private lvBadgeEl!: HTMLElement
  private objectiveEl!: HTMLElement
  private promptEl!: HTMLElement
  private readonly barCache = new WeakMap<HTMLElement, number>()
  private hpDanger = false

  // ---------- 升级 ----------
  private levelUpEl!: HTMLElement
  private levelUpSubEl!: HTMLElement
  private upgradeCardsEl!: HTMLElement
  private choices: UpgradeDef[] = []
  private pickLocked = false
  private pickTimer: number | null = null

  // ---------- Boss ----------
  private bossEl!: HTMLElement
  private bossNameEl!: HTMLElement
  private bossTagEl!: HTMLElement
  private bossFillEl!: HTMLElement
  private bossMaxHp = 1
  private bossVisible = false
  /** 显式 showBoss 后由 hideBoss 关闭；快照驱动的血条则跟随 snapshot 自动显隐 */
  private bossPinned = false

  // ---------- 飘字 ----------
  private dmgLayerEl!: HTMLElement
  private readonly floaters: Floater[] = []
  private floaterCursor = 0
  private readonly scratch = new THREE.Vector3()
  private lastFrameMs = 0

  // ---------- 楼层横幅 ----------
  private bannerEl!: HTMLElement
  private bannerFloorEl!: HTMLElement
  private bannerNameEl!: HTMLElement
  private bannerSubEl!: HTMLElement
  private bannerTimer: number | null = null

  // ---------- Toast ----------
  private toastLayerEl!: HTMLElement
  private readonly toastTimers = new Set<number>()

  // ---------- 结算 ----------
  private endEl!: HTMLElement
  private endKickerEl!: HTMLElement
  private endTitleEl!: HTMLElement
  private endSubEl!: HTMLElement
  private readonly endStatEls: HTMLElement[] = []
  private restartLocked = false

  // ---------- 暂停 ----------
  private pauseEl!: HTMLElement

  constructor(handlers: HudHandlers) {
    this.handlers = handlers

    // #ui-root 由 index.html 提供；缺失时兜底创建，保证模块独立可测
    const existing = document.getElementById('ui-root')
    if (existing) {
      this.root = existing
    } else {
      const created = div()
      created.id = 'ui-root'
      document.body.appendChild(created)
      this.root = created
    }

    this.shell = div('ui-shell')
    this.shell.innerHTML = UI_TEMPLATE
    this.root.appendChild(this.shell)

    this.cacheElements()
    this.bindEvents()
    this.buildDifficultyCards()
    this.createFloaterPool()
    this.selectDifficulty('normal')

    // 默认停在标题页；Lead 之后调用 showTitle/hideTitle 都是幂等的
    this.showTitle()
  }

  // ==========================================================
  // 初始化
  // ==========================================================

  private q<T extends HTMLElement>(selector: string): T {
    const node = this.shell.querySelector<T>(selector)
    if (!node) throw new Error(`[hud] 缺少界面节点：${selector}`)
    return node
  }

  private cacheElements(): void {
    this.titleEl = this.q('.js-title')
    this.diffCardsEl = this.q('.js-diff-cards')
    this.diffTipEl = this.q('.js-diff-tip')
    this.startBtnEl = this.q('.js-start')

    this.hudEl = this.q('.js-hud')
    this.floorEl = this.q('.js-floor')
    this.floorNumEl = this.q('.js-floor-num')
    this.floorNameEl = this.q('.js-floor-name')
    this.quotaFillEl = this.q('.js-quota-fill')
    this.quotaTextEl = this.q('.js-quota-text')
    this.aliveEl = this.q('.js-alive')
    this.goldEl = this.q('.js-gold')
    this.levelEl = this.q('.js-level')
    this.timeEl = this.q('.js-time')
    this.killsEl = this.q('.js-kills')
    this.muteEl = this.q('.js-mute')
    this.hpBlockEl = this.q('.js-hp-block')
    this.hpFillEl = this.q('.js-hp-fill')
    this.hpTextEl = this.q('.js-hp-text')
    this.xpFillEl = this.q('.js-xp-fill')
    this.xpTextEl = this.q('.js-xp-text')
    this.lvBadgeEl = this.q('.js-lv-badge')
    this.objectiveEl = this.q('.js-objective')
    this.promptEl = this.q('.js-prompt')

    this.levelUpEl = this.q('.js-levelup')
    this.levelUpSubEl = this.q('.js-levelup-sub')
    this.upgradeCardsEl = this.q('.js-upgrade-cards')

    this.bossEl = this.q('.js-boss')
    this.bossNameEl = this.q('.js-boss-name')
    this.bossTagEl = this.q('.js-boss-tag')
    this.bossFillEl = this.q('.js-boss-fill')

    this.dmgLayerEl = this.q('.js-dmg-layer')

    this.bannerEl = this.q('.js-banner')
    this.bannerFloorEl = this.q('.js-banner-floor')
    this.bannerNameEl = this.q('.js-banner-name')
    this.bannerSubEl = this.q('.js-banner-sub')

    this.toastLayerEl = this.q('.js-toast-layer')

    this.endEl = this.q('.js-end')
    this.endKickerEl = this.q('.js-end-kicker')
    this.endTitleEl = this.q('.js-end-title')
    this.endSubEl = this.q('.js-end-sub')
    this.endStatEls.push(...Array.from(this.shell.querySelectorAll<HTMLElement>('.js-stat')))

    this.pauseEl = this.q('.js-pause')
  }

  private bindEvents(): void {
    this.startBtnEl.addEventListener('click', () => this.startGame())
    this.q<HTMLButtonElement>('.js-restart').addEventListener('click', () => this.restart())
    document.addEventListener('keydown', this.onKeyDown)
  }

  /** 三个难度卡片：名称/描述取自 gameConfig，保证与数值一致 */
  private buildDifficultyCards(): void {
    for (const id of DIFF_ORDER) {
      const data = DIFFICULTY[id]
      const meta = DIFF_META[id]
      const card = el('button', 'diff-card')
      card.type = 'button'
      card.dataset.diff = id
      card.setAttribute('aria-pressed', 'false')

      const head = div('diff-head')
      head.append(
        span('diff-icon', meta.icon),
        span('diff-name', data.name),
        span('diff-tag', meta.tag),
      )

      const mods = div('diff-mods')
      mods.append(
        span('diff-mod', `敌人生命 ${Math.round(data.hp * 100)}%`),
        span('diff-mod', `敌人伤害 ${Math.round(data.damage * 100)}%`),
        span('diff-mod', `刷怪量 ${Math.round(data.spawn * 100)}%`),
      )

      card.append(head, span('diff-desc', data.desc), mods, span('diff-check', '已选择'))
      card.addEventListener('click', () => this.selectDifficulty(id))

      this.diffCardsEl.appendChild(card)
      this.diffCardEls.push(card)
    }
  }

  /** 预创建 40 个飘字节点，运行时只复用，不增删 DOM */
  private createFloaterPool(): void {
    for (let i = 0; i < MAX_FLOATERS; i += 1) {
      const node = div('dmg')
      node.style.opacity = '0'
      this.dmgLayerEl.appendChild(node)
      this.floaters.push({
        el: node,
        world: new THREE.Vector3(),
        age: 0,
        life: 1,
        kind: 'normal',
        drift: 0,
        active: false,
      })
    }
  }

  // ==========================================================
  // 标题页
  // ==========================================================

  private selectDifficulty(id: DifficultyId): void {
    if (!DIFF_ORDER.includes(id)) return
    this.selectedDifficulty = id
    for (const card of this.diffCardEls) {
      const active = card.dataset.diff === id
      card.classList.toggle('is-active', active)
      card.setAttribute('aria-pressed', active ? 'true' : 'false')
    }
    const data = DIFFICULTY[id]
    setText(this.diffTipEl, `当前选择：${data.name} — ${data.desc}`)
  }

  private startGame(): void {
    if (this.destroyed || this.startLocked) return
    this.startLocked = true
    const difficulty = this.selectedDifficulty
    this.hideTitle()
    this.handlers.onStart(difficulty)
  }

  showTitle(): void {
    if (this.destroyed) return
    this.startLocked = false
    this.hideLevelUp()
    this.hideEnd()
    this.hideBoss()
    this.hideFloorBanner()
    this.showPrompt(null)
    this.setPaused(false)
    this.titleEl.classList.add('is-open')
    this.hudEl.hidden = true
  }

  hideTitle(): void {
    if (this.destroyed) return
    this.titleEl.classList.remove('is-open')
    this.hudEl.hidden = false
  }

  // ==========================================================
  // HUD 每帧更新
  // ==========================================================

  update(s: HudSnapshot): void {
    if (this.destroyed) return

    // 帧间隔只用于飘字动画；暂停或切后台时夹紧，避免一帧跳太远
    const now = performance.now()
    const dt =
      this.lastFrameMs === 0 ? 1 / 60 : Math.min(0.1, Math.max(0, (now - this.lastFrameMs) / 1000))
    this.lastFrameMs = now

    // ---- 左上：楼层 / 击杀目标 ----
    const floor = Math.max(1, Math.floor(s.floor))
    setText(this.floorNumEl, String(floor))
    setText(this.floorNameEl, s.floorName)

    const quotaMax = Math.max(0, Math.floor(s.quotaMax))
    const quota = Math.max(0, Math.floor(s.quota))
    setBarFill(this.quotaFillEl, quotaMax > 0 ? quota / quotaMax : s.stairsUnlocked ? 1 : 0, this.barCache)
    if (quotaMax > 0) {
      setText(this.quotaTextEl, `击杀 ${Math.min(quota, quotaMax)} / ${quotaMax}`)
    } else {
      setText(this.quotaTextEl, '首领层 · 击败哥布林之王')
    }
    this.floorEl.classList.toggle('stairs-open', s.stairsUnlocked)
    setText(this.aliveEl, String(Math.max(0, Math.floor(s.enemiesAlive))))

    // ---- 右上：金币 / 等级 / 计时 / 击杀 ----
    setText(this.goldEl, fmtInt(s.gold))
    setText(this.levelEl, String(Math.max(1, Math.floor(s.level))))
    setText(this.timeEl, fmtTime(s.time))
    setText(this.killsEl, fmtInt(s.kills))

    // ---- 左下：HP / XP ----
    const maxHp = Math.max(1, s.maxHp)
    const hp = Math.max(0, Math.min(s.hp, maxHp))
    const hpRatio = clamp01(hp / maxHp)
    setBarFill(this.hpFillEl, hpRatio, this.barCache)
    setText(this.hpTextEl, `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`)

    const danger = hpRatio <= 0.3
    if (danger !== this.hpDanger) {
      this.hpDanger = danger
      this.hpBlockEl.classList.toggle('is-danger', danger)
    }

    const nextXp = Math.max(1, Math.floor(s.xpToNext))
    const xp = Math.max(0, s.xp)
    setBarFill(this.xpFillEl, xp / nextXp, this.barCache)
    setText(this.xpTextEl, `${Math.floor(xp)} / ${nextXp}`)
    setText(this.lvBadgeEl, String(Math.max(1, Math.floor(s.level))))

    // ---- 底部目标提示 ----
    let objective: string
    if (quotaMax <= 0) {
      objective = s.stairsUnlocked ? '楼梯已开启 · 按 E 离开' : '目标：击败哥布林之王，夺回卷轴'
    } else if (s.stairsUnlocked) {
      objective = '楼梯已开启 · 按 E 进入下一层'
    } else {
      const remain = Math.max(0, quotaMax - Math.min(quota, quotaMax))
      objective = `还需击杀 ${remain} 只哥布林解锁楼梯`
    }
    setText(this.objectiveEl, objective)
    this.objectiveEl.classList.toggle('is-ready', s.stairsUnlocked)

    // ---- Boss 血条（快照驱动；显式 showBoss 后的 pinned 状态交给 hideBoss） ----
    if (s.boss) {
      const bossMax = Math.max(1, s.boss.maxHp)
      const same =
        this.bossVisible &&
        this.bossNameEl.textContent === s.boss.name &&
        Math.abs(this.bossMaxHp - bossMax) < 0.5
      if (same) {
        this.applyBossHp(s.boss.hp)
      } else {
        this.showBoss(s.boss.name, s.boss.hp, bossMax)
        this.bossPinned = false
      }
    } else if (!this.bossPinned) {
      this.hideBoss()
    }

    // ---- 世界坐标飘字投影 ----
    this.updateFloaters(dt)
  }

  // ==========================================================
  // 升级三选一
  // ==========================================================

  showLevelUp(level: number, choices: UpgradeDef[]): void {
    if (this.destroyed) return

    this.pickLocked = false
    this.clearPickTimer()
    this.choices = choices.slice(0, 3)
    this.upgradeCardsEl.replaceChildren()
    this.choices.forEach((def, index) => {
      this.upgradeCardsEl.appendChild(this.buildUpgradeCard(def, index))
    })

    setText(this.levelUpSubEl, `达到 Lv.${Math.max(1, Math.floor(level))} · 选择一项强化`)
    this.levelUpEl.classList.add('is-open')
    this.showPrompt(null)
  }

  hideLevelUp(): void {
    if (this.destroyed) return
    this.levelUpEl.classList.remove('is-open')
    this.choices = []
    this.upgradeCardsEl.replaceChildren()
    this.pickLocked = false
    this.clearPickTimer()
  }

  private buildUpgradeCard(def: UpgradeDef, index: number): HTMLButtonElement {
    const card = el('button', `upgrade-card rarity-${def.rarity}`)
    card.type = 'button'
    card.dataset.id = def.id
    card.dataset.index = String(index)
    card.style.setProperty('--i', String(index))
    card.setAttribute('aria-label', `${RARITY_LABEL[def.rarity] ?? def.rarity}：${def.name}，${def.desc}`)

    const top = div('uc-top')
    top.append(span('uc-icon', def.icon), span('uc-rarity', RARITY_LABEL[def.rarity] ?? def.rarity))

    const key = div('uc-key')
    key.appendChild(el('kbd', '', String(index + 1)))
    key.appendChild(document.createTextNode('选择'))

    card.append(top, div('uc-name', def.name), div('uc-desc', def.desc), key)
    card.addEventListener('click', () => this.pickUpgrade(index))
    return card
  }

  private pickUpgrade(index: number): void {
    if (this.destroyed || this.pickLocked) return
    if (!this.levelUpEl.classList.contains('is-open')) return
    const def = this.choices[index]
    if (!def) return

    this.pickLocked = true
    const cards = Array.from(this.upgradeCardsEl.children) as HTMLElement[]
    cards.forEach((card, i) => {
      card.classList.toggle('is-picked', i === index)
      card.classList.toggle('is-dim', i !== index)
    })

    // 留一点确认反馈时间，同时锁住重复点击/按键
    this.clearPickTimer()
    this.pickTimer = window.setTimeout(() => {
      this.pickTimer = null
      if (this.destroyed) return
      const id = def.id
      this.hideLevelUp()
      this.handlers.onUpgradePick(id)
    }, PICK_DELAY_MS)
  }

  private clearPickTimer(): void {
    if (this.pickTimer === null) return
    window.clearTimeout(this.pickTimer)
    this.pickTimer = null
  }

  // ==========================================================
  // Boss 血条
  // ==========================================================

  showBoss(name: string, hp: number, maxHp: number): void {
    if (this.destroyed) return
    this.bossMaxHp = Number.isFinite(maxHp) && maxHp > 0 ? maxHp : 1
    setText(this.bossNameEl, name)
    this.applyBossHp(hp)
    this.bossEl.classList.add('is-open')
    this.bossVisible = true
    this.bossPinned = true
  }

  updateBoss(hp: number): void {
    if (this.destroyed || !this.bossVisible) return
    this.applyBossHp(hp)
  }

  hideBoss(): void {
    if (this.destroyed) return
    this.bossEl.classList.remove('is-open')
    this.bossVisible = false
    this.bossPinned = false
  }

  private applyBossHp(hp: number): void {
    const ratio = clamp01((Number.isFinite(hp) ? hp : 0) / this.bossMaxHp)
    setBarFill(this.bossFillEl, ratio, this.barCache)
    const phase2 = ratio <= BOSS_PHASE2_RATIO
    this.bossEl.classList.toggle('is-phase2', phase2)
    setText(this.bossTagEl, phase2 ? '第二阶段 · 狂暴' : '第一阶段')
  }

  // ==========================================================
  // 相机注入 & 世界坐标飘字
  // ==========================================================

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.cameraHolder.camera = camera
  }

  damageNumber(
    worldPos: THREE.Vector3,
    amount: number,
    kind: 'normal' | 'crit' | 'heal' | 'gold',
  ): void {
    if (this.destroyed) return
    const floater = this.floaters[this.floaterCursor]
    if (!floater) return
    this.floaterCursor = (this.floaterCursor + 1) % this.floaters.length

    // 必须拷贝：调用方的 Vector3 很可能被复用/改写
    floater.world.copy(worldPos)
    floater.age = 0
    floater.kind = kind
    floater.life = kind === 'crit' ? 1 : kind === 'gold' || kind === 'heal' ? 0.95 : 0.88
    floater.drift = Math.random() * 2 - 1
    floater.active = true

    const value = Math.max(0, Math.round(Number.isFinite(amount) ? amount : 0))
    const text = kind === 'gold' || kind === 'heal' ? `+${fmtInt(value)}` : fmtInt(value)
    floater.el.className = `dmg kind-${kind}`
    floater.el.textContent = text
    floater.el.style.opacity = '1'
    this.renderFloater(floater)
  }

  private updateFloaters(dt: number): void {
    const camera = this.cameraHolder.camera
    // 每帧刷新一次相机的世界逆矩阵，保证投影不会落后一帧
    if (camera) camera.updateMatrixWorld()

    for (const floater of this.floaters) {
      if (!floater.active) continue
      floater.age += dt
      if (floater.age >= floater.life) {
        floater.active = false
        floater.el.style.opacity = '0'
        continue
      }
      this.renderFloater(floater)
    }
  }

  /** 投影一个飘字：上飘 + 淡出 + 出生放大，超出视锥直接隐藏 */
  private renderFloater(floater: Floater): void {
    const camera = this.cameraHolder.camera
    if (!camera) {
      floater.el.style.opacity = '0'
      return
    }

    const t = clamp01(floater.age / floater.life)
    const v = this.scratch.copy(floater.world).project(camera)

    if (
      !Number.isFinite(v.x) ||
      !Number.isFinite(v.y) ||
      !Number.isFinite(v.z) ||
      v.z > 1 ||
      v.z < -1 ||
      v.x < -1.15 ||
      v.x > 1.15 ||
      v.y < -1.15 ||
      v.y > 1.15
    ) {
      floater.el.style.opacity = '0'
      return
    }

    const width = window.innerWidth
    const height = window.innerHeight
    const screenX = (v.x * 0.5 + 0.5) * width
    const screenY = (-v.y * 0.5 + 0.5) * height
    const rise = 52 + floater.drift * 16
    const y = screenY - t * rise

    // 0~0.16 弹出，之后轻微回落，形成"顿一下再飘"的手感
    const pop =
      t < 0.16 ? 0.72 + (t / 0.16) * 0.43 : 1.15 - Math.min(0.15, (t - 0.16) * 0.32)
    const opacity = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35

    floater.el.style.transform =
      `translate3d(${screenX.toFixed(1)}px, ${y.toFixed(1)}px, 0) ` +
      `translate(-50%, -50%) scale(${pop.toFixed(3)})`
    floater.el.style.opacity = opacity.toFixed(3)
  }

  // ==========================================================
  // 交互提示 / Toast / 楼层横幅
  // ==========================================================

  showPrompt(text: string | null): void {
    if (this.destroyed) return
    if (text !== null && text.trim().length > 0) {
      setText(this.promptEl, text)
      this.promptEl.classList.add('is-open')
    } else {
      this.promptEl.classList.remove('is-open')
    }
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    if (this.destroyed || text.trim().length === 0) return
    const node = div(`toast kind-${kind}`, text)
    this.toastLayerEl.appendChild(node)

    // 同屏最多 4 条，超出先移除最旧的
    while (this.toastLayerEl.childElementCount > 4) {
      const first = this.toastLayerEl.firstElementChild
      if (!first) break
      first.remove()
    }

    const timer = window.setTimeout(() => {
      this.toastTimers.delete(timer)
      node.remove()
    }, 2150)
    this.toastTimers.add(timer)
  }

  showFloorBanner(floor: number, name: string, subtitle: string): void {
    if (this.destroyed) return
    const index = Math.max(1, Math.floor(floor))
    setText(this.bannerFloorEl, `FLOOR ${String(index).padStart(2, '0')}`)
    setText(this.bannerNameEl, `第 ${index} 层 · ${name}`)
    setText(this.bannerSubEl, subtitle)

    // 先清掉上一条横幅的计时器，再重播进场（不能调用 hideFloorBanner，否则会移除 is-open）
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }
    this.bannerEl.classList.remove('is-open')
    restartAnim(this.bannerEl)
    this.bannerEl.classList.add('is-open')

    this.bannerTimer = window.setTimeout(() => {
      this.bannerTimer = null
      if (!this.destroyed) this.bannerEl.classList.remove('is-open')
    }, 2000)
  }

  private hideFloorBanner(): void {
    if (this.bannerTimer !== null) {
      window.clearTimeout(this.bannerTimer)
      this.bannerTimer = null
    }
    this.bannerEl.classList.remove('is-open')
  }

  // ==========================================================
  // 结算
  // ==========================================================

  showGameOver(stats: RunStats): void {
    this.showEnd(stats, false)
  }

  showVictory(stats: RunStats): void {
    this.showEnd(stats, true)
  }

  private showEnd(stats: RunStats, victory: boolean): void {
    if (this.destroyed) return

    this.restartLocked = false
    this.hideLevelUp()
    this.hideBoss()
    this.showPrompt(null)
    this.setPaused(false)

    const floor = Math.max(1, Math.floor(stats.floor))
    const level = Math.max(1, Math.floor(stats.level))
    this.endEl.classList.toggle('is-victory', victory)
    setText(this.endKickerEl, victory ? 'ESCAPED · 通关' : 'RUN OVER · 阵亡')
    setText(this.endTitleEl, victory ? '你逃出了哥布林之塔' : '你倒在了塔中')
    setText(
      this.endSubEl,
      victory
        ? '你带着卷轴逃出了哥布林之塔，塔顶只剩下不甘的咆哮。'
        : '哥布林的笑声在塔中回荡，卷轴还在塔顶等待下一位挑战者。',
    )

    const diffName = DIFFICULTY[stats.difficulty]?.name ?? stats.difficulty
    const values = [
      `第 ${floor} 层`,
      `Lv.${level}`,
      fmtInt(stats.kills),
      fmtInt(stats.gold),
      fmtTime(stats.time),
      diffName,
    ]
    this.endStatEls.forEach((node, index) => setText(node, values[index] ?? '—'))

    this.hudEl.hidden = true
    this.endEl.classList.add('is-open')
  }

  hideEnd(): void {
    if (this.destroyed) return
    this.endEl.classList.remove('is-open')
    this.restartLocked = false
    this.hudEl.hidden = this.titleEl.classList.contains('is-open')
  }

  private restart(): void {
    if (this.destroyed || this.restartLocked) return
    this.restartLocked = true
    this.hideEnd()
    this.handlers.onRestart()
  }

  // ==========================================================
  // 暂停 / 静音
  // ==========================================================

  setPaused(paused: boolean): void {
    if (this.destroyed) return
    this.pauseEl.classList.toggle('is-open', paused)
  }

  setMuted(muted: boolean): void {
    if (this.destroyed) return
    this.muteEl.hidden = !muted
  }

  // ==========================================================
  // 键盘：标题页 1/2/3 选难度、Enter 开始；升级 1/2/3；结算 Enter/R
  // ==========================================================

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed || event.repeat) return

    if (this.titleEl.classList.contains('is-open')) {
      const digit = digitFromEvent(event)
      if (digit >= 0 && digit < DIFF_ORDER.length) {
        const id = DIFF_ORDER[digit]
        if (id) this.selectDifficulty(id)
        event.preventDefault()
        return
      }
      if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') {
        event.preventDefault()
        this.startGame()
      }
      return
    }

    if (this.levelUpEl.classList.contains('is-open')) {
      const digit = digitFromEvent(event)
      if (digit >= 0) {
        event.preventDefault()
        this.pickUpgrade(digit)
      }
      return
    }

    if (this.endEl.classList.contains('is-open')) {
      if (
        event.code === 'Enter' ||
        event.code === 'NumpadEnter' ||
        event.code === 'KeyR'
      ) {
        event.preventDefault()
        this.restart()
      }
    }
  }

  // ==========================================================
  // 销毁
  // ==========================================================

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true

    document.removeEventListener('keydown', this.onKeyDown)
    this.clearPickTimer()
    this.hideFloorBanner()
    for (const timer of this.toastTimers) window.clearTimeout(timer)
    this.toastTimers.clear()

    this.floaters.length = 0
    this.cameraHolder.camera = null
    this.shell.remove()
    this.hudEl.hidden = true
  }
}

/** 从键盘事件取 0/1/2，兼容数字行与小键盘 */
function digitFromEvent(event: KeyboardEvent): number {
  switch (event.code) {
    case 'Digit1':
    case 'Numpad1':
      return 0
    case 'Digit2':
    case 'Numpad2':
      return 1
    case 'Digit3':
    case 'Numpad3':
      return 2
    default:
      break
  }
  if (event.key === '1') return 0
  if (event.key === '2') return 1
  if (event.key === '3') return 2
  return -1
}

/** 创建 HUD。若重复调用，由调用方负责先销毁旧实例。 */
export function createHud(handlers: HudHandlers): Hud {
  return new HudImpl(handlers)
}
