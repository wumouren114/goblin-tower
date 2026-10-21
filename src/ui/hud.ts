/**
 * 哥布林之塔 v3 · UI 层
 *
 * 约定：
 * - 界面切换只改 class（.is-open），不重建 DOM；update() 每帧只改文本和宽度。
 * - 所有动态卡片（难度/角色/隧道/商店/背包格）构造时预创建，之后复用节点。
 * - 不再显示经验条、等级、楼梯 —— v3 用「击杀进度 / 难度 / 技能充能」代替。
 */

import * as THREE from 'three'
import type {
  CardStat,
  CharacterId,
  DefeatReason,
  DifficultyId,
  HudSnapshot,
  HudV3,
  HudV3Handlers,
  InventoryItem,
  RunStatsV3,
  SaveSlotMeta,
  ShopMode,
  ShopOffer,
  TunnelOffer,
  TunnelRoom,
  TunnelScreenMode,
  TunnelType,
} from '../types'
import { CHARACTERS } from '../data/characters'
import { artReady, artUrl, type ArtKey } from '../art/atlasImport'
import { BALANCE, DIFFICULTIES, DIFFICULTY_IDS } from '../data/balance'
import { canMergeItems } from '../systems/inventory'
import {
  clamp01,
  div,
  el,
  fmtDelta,
  fmtInt,
  fmtPct,
  fmtTime,
  restartAnim,
  setBarFill,
  setText,
  span,
} from './dom'

/** 契约类型统一从 types.ts 再导出，game.ts / main.ts 只依赖这里 */
export type { HudSnapshot, HudV3, HudV3Handlers } from '../types'

/** 同屏最多飘字数量（超出复用最老的） */
const MAX_FLOATERS = 24
/** Boss 血条狂暴阈值 */
const BOSS_PHASE2_RATIO = 0.55
/** 选卡/按钮防连点间隔 */
const PICK_DELAY_MS = 150
/** 丢弃按钮防连点间隔（避免一次双击把移位后的下一件物品也丢掉） */
const DISCARD_GUARD_MS = 250
/** 飘字上飘距离（px）与存活时长（s） */
const FLOATER_RISE_PX = 42
const FLOATER_LIFE = 0.72
/** 同一落点连续飘字的扇形错位（px），避免 2929 这类四位数叠成一坨 */
const FLOATER_FAN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [-34, 10],
  [34, -10],
  [-17, 20],
  [17, -20],
  [-51, 0],
  [51, 0],
  [-34, -18],
  [34, 18],
  [-17, -28],
  [17, 28],
  [-51, 20],
]

type DmgKind = 'normal' | 'crit' | 'heal' | 'gold' | 'dodge'

interface Floater {
  el: HTMLDivElement
  world: THREE.Vector3
  age: number
  life: number
  kind: DmgKind
  drift: number
  offsetX: number
  offsetY: number
  rise: number
  active: boolean
}

interface TunnelCardRef {
  card: HTMLButtonElement
  band: HTMLSpanElement
  icon: HTMLSpanElement
  room: HTMLSpanElement
  title: HTMLDivElement
  desc: HTMLDivElement
  preview: HTMLDivElement
  key: HTMLElement
}

interface ShopCardRef {
  card: HTMLButtonElement
  icon: HTMLSpanElement
  kind: HTMLSpanElement
  tier: HTMLSpanElement
  name: HTMLDivElement
  desc: HTMLDivElement
  price: HTMLSpanElement
  buy: HTMLSpanElement
}

interface InvCellRef {
  cell: HTMLButtonElement
  tier: HTMLSpanElement
  icon: HTMLSpanElement
  name: HTMLSpanElement
  meta: HTMLSpanElement
  discard: HTMLButtonElement
}

/* ------------------------------------------------------------------ */
/* 静态数据                                                            */
/* ------------------------------------------------------------------ */

const CHAR_ORDER: CharacterId[] = ['mutsumi', 'murasame', 'fish']
const CHAR_EMOJI: Record<CharacterId, string> = { mutsumi: '🥒', murasame: '🗡️', fish: '🐟' }

/** 卡牌维度 → 原画图标（充能上限 / 充能效率共用一张充能图标） */
const CARD_ART: Record<CardStat, ArtKey> = {
  magic: 'icon_card_magic',
  stamina: 'icon_card_stamina',
  intelligence: 'icon_card_intelligence',
  hp: 'icon_card_hp',
  moveSpeed: 'icon_card_moveSpeed',
  chargeMax: 'icon_card_charge',
  chargeGain: 'icon_card_charge',
  dodge: 'icon_card_dodge',
  armor: 'icon_card_armor',
  crit: 'icon_card_crit',
}

/** 角色 → 专武图标 */
const WEAPON_ART: Record<CharacterId, ArtKey> = {
  mutsumi: 'icon_weapon_mutsumi',
  murasame: 'icon_weapon_murasame',
  fish: 'icon_weapon_fish',
}

/** 角色 → 立绘头像（睦为常服像，Mortis 另有 portrait_mortis） */
const PORTRAIT_ART: Record<CharacterId, ArtKey> = {
  mutsumi: 'portrait_mutsumi',
  murasame: 'portrait_murasame',
  fish: 'portrait_fish',
}

const DIFF_META: Record<DifficultyId, { icon: string; tag: string }> = {
  easy: { icon: '🌿', tag: '轻松' },
  normal: { icon: '⚔️', tag: '推荐' },
  hard: { icon: '💀', tag: '挑战' },
}

const TUNNEL_META: Record<TunnelType, { label: string; hint: string }> = {
  reward: { label: '奖励', hint: '宝箱与技能卡' },
  trade: { label: '交易', hint: '商人或祭坛' },
  battle: { label: '对战', hint: '怪潮与精英' },
  rest: { label: '休息', hint: '回血与充能' },
}

const ROOM_LABEL: Record<TunnelRoom, string> = {
  chest: '宝箱密室',
  'skill-card': '技能圣所',
  merchant: '流浪商人',
  altar: '低语祭坛',
  'mob-wave': '哥布林怪潮',
  'elite-fight': '精英巢穴',
  boss: '首领之间',
  rest: '休憩营地',
}

const STAT_ORDER: CardStat[] = [
  'magic',
  'stamina',
  'intelligence',
  'hp',
  'moveSpeed',
  'chargeMax',
  'chargeGain',
  'dodge',
  'armor',
  'crit',
]

const STAT_LABEL: Record<CardStat, string> = {
  magic: '魔力',
  stamina: '耐力',
  intelligence: '智力',
  hp: '生命上限',
  moveSpeed: '移速',
  chargeMax: '充能上限',
  chargeGain: '充能效率',
  dodge: '闪避',
  armor: '减伤',
  crit: '暴击率',
}

/** 用百分比展示的维度 */
const STAT_IS_PCT: Partial<Record<CardStat, boolean>> = { chargeGain: true, dodge: true, armor: true, crit: true }

const SHOP_KIND_LABEL: Record<ShopOffer['kind'], string> = {
  weapon: '专武升级',
  'buff-card': '增益卡',
  consumable: '消耗品',
}

/** 品质名从 balance 读取，读不到就回退 */
const QUALITY_NAMES = (BALANCE.shop as unknown as { quality?: { tier2?: { name?: string }; tier3?: { name?: string } } }).quality
const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: '普通',
  2: QUALITY_NAMES?.tier2?.name ?? '精制',
  3: QUALITY_NAMES?.tier3?.name ?? '臻品',
}

/** 五维数值文本：18 -> +18、-8 -> -8、0.03 -> +3% */
function formatStatValue(stat: CardStat, value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (STAT_IS_PCT[stat]) return `${fmtDelta(value * 100)}%`
  if (stat === 'moveSpeed') return fmtDelta(value, 2)
  return fmtDelta(value)
}

/** 品质 label：1 普通 / 2 精制 / 3 臻品 */
function tierLabel(tier: number): string {
  const t = Math.max(1, Math.min(3, Math.round(tier || 1))) as 1 | 2 | 3
  return TIER_LABEL[t]
}

function tierClass(tier: number): string {
  const t = Math.max(1, Math.min(3, Math.round(tier || 1)))
  return t >= 3 ? 'tier-3' : t === 2 ? 'tier-2' : 'tier-1'
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0')
}

function digitFromEvent(event: KeyboardEvent): number {
  if (/^Digit[1-9]$/.test(event.code)) return Number(event.code.slice(5))
  if (/^Numpad[1-9]$/.test(event.code)) return Number(event.code.slice(6))
  if (/^[1-9]$/.test(event.key)) return Number(event.key)
  return 0
}

/* ------------------------------------------------------------------ */
/* 原画图标：有图用图，没有则保留 emoji / CSS 兜底                      */
/* ------------------------------------------------------------------ */

/** preload 完成前 artUrl() 恒为 null：轮询间隔与最长等待次数 */
const ART_POLL_MS = 300
const ART_POLL_TRIES = 44

interface ArtIconParts {
  img: HTMLImageElement
  emoji: HTMLSpanElement
}

const artIconCache = new WeakMap<HTMLElement, ArtIconParts>()

/** 图标容器里的两层：原画 <img>（默认隐藏）+ emoji 兜底 */
function artIconParts(host: HTMLElement): ArtIconParts {
  const cached = artIconCache.get(host)
  if (cached) return cached
  // 建图标时往往先塞了 emoji 文本（span('sc-icon','✦')），留着会和原画叠成两行
  for (const node of [...host.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) node.remove()
  }
  const img = document.createElement('img')
  img.className = 'art-img'
  img.alt = ''
  img.decoding = 'async'
  img.draggable = false
  const emoji = span('art-emoji')
  host.append(img, emoji)
  const parts: ArtIconParts = { img, emoji }
  artIconCache.set(host, parts)
  return parts
}

/**
 * 写入图标：登记 data-art-key 并立刻尝试取图；
 * 原画未就绪时先显示兜底 emoji，由 HUD 的轮询稍后补上。
 * @returns 仍在等待原画时为 true
 */
function setArtIcon(host: HTMLElement, key: ArtKey | null, fallback: string): boolean {
  const parts = artIconParts(host)
  setText(parts.emoji, fallback)
  if (!key) {
    delete host.dataset.artKey
    host.classList.remove('has-art')
    parts.img.removeAttribute('src')
    return false
  }
  host.dataset.artKey = key
  return syncArtIcon(host)
}

/** 若 data-art-key 对应的原画可用则切换成 <img>；返回是否仍在等待 */
function syncArtIcon(host: HTMLElement): boolean {
  const key = host.dataset.artKey as ArtKey | undefined
  if (!key) return false
  const url = artUrl(key)
  if (!url) return true
  const parts = artIconParts(host)
  if (parts.img.getAttribute('src') !== url) parts.img.src = url
  host.classList.add('has-art')
  return false
}

function weaponArtKey(character: CharacterId): ArtKey {
  return WEAPON_ART[character] ?? 'icon_weapon_mutsumi'
}

function cardArtKey(stat: CardStat | undefined): ArtKey | null {
  return stat ? CARD_ART[stat] ?? null : null
}

/** 背包 / 奖励卡 → 原画 key（消耗品没有专属原画，保留 emoji） */
function itemArtKey(item: InventoryItem): ArtKey | null {
  if (item.kind === 'buff-card') return cardArtKey(item.stat)
  return null
}

/** 隧道预览行：有原画的行会额外渲染 16px 图标 */
interface TunnelPreviewLine {
  text: string
  art: ArtKey | null
}

/* ------------------------------------------------------------------ */
/* 模板                                                                */
/* ------------------------------------------------------------------ */

const UI_TEMPLATE = /* html */ `
  <div class="hud js-hud">
    <div class="hud-floor js-floor">
      <div class="floor-line">
        <span class="floor-index">第 <b class="js-floor-num">1</b> 层</span>
        <span class="stage-chip">阶段 <b class="js-stage">1</b></span>
        <span class="floor-name js-floor-name">未知区域</span>
      </div>
      <div class="quota-row">
        <div class="bar bar-quota"><i class="js-quota-fill"></i></div>
        <span class="quota-text js-quota-text">击杀 0 / 0</span>
      </div>
      <div class="alive-row"><span class="live-dot"></span>场上 <b class="js-alive">0</b> 只 · 累计击杀 <b class="js-kills">0</b></div>
    </div>

    <div class="hud-right">
      <div class="hud-stats">
        <div class="stat stat-gold"><span class="stat-label">金币</span><span class="stat-val js-gold">0</span></div>
        <div class="stat stat-diff"><span class="stat-label">难度</span><span class="stat-val js-diff">—</span></div>
        <div class="stat stat-alive"><span class="stat-label">场上敌人</span><span class="stat-val js-alive-stat">0</span></div>
        <div class="stat stat-kill"><span class="stat-label">累计击杀</span><span class="stat-val js-kills-stat">0</span></div>
      </div>
      <div class="mute-chip js-mute" hidden>🔇 已静音</div>
    </div>

    <div class="hud-vitals">
      <div class="vital vital-hp js-hp-block">
        <div class="vital-head">
          <span class="vital-label">生命</span>
          <span class="vital-num js-hp-text">100 / 100</span>
        </div>
        <div class="bar bar-hp">
          <i class="js-hp-fill"></i>
          <span class="bar-ticks"></span>
        </div>
      </div>
      <div class="vital vital-skill js-skill-block">
        <div class="skill-badge">专武 <b class="js-weapon-lv">1</b></div>
        <div class="skill-main">
          <div class="vital-head">
            <span class="vital-label js-skill-name">技能</span>
            <span class="vital-num js-charge-text">0 / 100</span>
          </div>
          <div class="bar bar-charge"><i class="js-charge-fill"></i><span class="bar-sheen"></span></div>
        </div>
      </div>
    </div>

    <div class="hud-bottom">
      <div class="key-hints">
        <span class="key-hint"><kbd>WASD/方向键</kbd>移动</span>
        <span class="key-hint"><kbd>左键</kbd>点击普攻</span>
        <span class="key-hint"><kbd>右键</kbd>技能</span>
        <button class="key-hint js-hud-pause" type="button"><kbd>P</kbd>暂停</button>
      </div>
      <div class="objective js-objective">清空本层敌人</div>
    </div>
  </div>

  <div class="boss-bar js-boss" hidden>
    <div class="boss-portrait js-boss-portrait" aria-hidden="true"></div>
    <div class="boss-main">
      <div class="boss-head">
        <span class="boss-name js-boss-name">首领</span>
        <span class="boss-tag">首领</span>
      </div>
      <div class="boss-track"><i class="boss-fill js-boss-fill"></i><span class="boss-ticks"></span></div>
    </div>
  </div>

  <div class="dmg-layer js-dmg-layer"></div>
  <div class="floor-banner js-banner" hidden>
    <div class="fb-line"></div>
    <div class="fb-floor js-banner-floor">LAYER 01 / 12</div>
    <div class="fb-name js-banner-name"></div>
    <div class="fb-sub js-banner-sub"></div>
  </div>
  <div class="toast-layer js-toast-layer"></div>

  <section class="screen title-screen js-title" aria-label="标题页">
    <div class="title-bg" aria-hidden="true">
      <img class="title-keyart js-title-keyart" alt="" decoding="async" />
      <span class="title-stars"></span>
      <span class="moon"></span>
      <span class="ridge-far"></span>
      <span class="ridge-near"></span>
      <span class="tower-left"><i class="tower-pole"></i><i class="tower-crenel"></i><i class="tower-shaft"></i><i class="tower-win"></i><i class="tower-crack"></i><i class="tower-foot"></i></span>
      <span class="tower-right"><i class="tower-pole"></i><i class="tower-crenel"></i><i class="tower-shaft"></i><i class="tower-win"></i><i class="tower-crack"></i><i class="tower-foot"></i></span>
      <span class="fog"></span>
      <span class="fog fog-b"></span>
    </div>
    <div class="title-inner js-title-inner">
      <header class="title-logo">
        <div class="title-kicker">GOBLIN TOWER</div>
        <h1 class="title-cn">哥布林之塔</h1>
        <p class="title-en">Tower of the Goblin King · v3</p>
      </header>
      <div class="title-tagline">一局约 8–12 分钟 · 清空每层 · 在血尽前登顶</div>

      <div class="title-lower">
        <div class="title-row">
          <section class="title-panel panel-char">
            <h2 class="panel-label">选择角色</h2>
            <div class="char-cards js-char-cards"></div>
          </section>
          <section class="title-panel panel-diff">
            <h2 class="panel-label">选择难度</h2>
            <div class="diff-cards js-diff-cards"></div>
          </section>
        </div>

        <div class="title-start-row">
          <button class="btn-start js-start" type="button">开始爬塔</button>
          <p class="diff-tip js-diff-tip"></p>
          <p class="title-platform"><strong>仅支持桌面浏览器 + 键鼠</strong> · 手机/平板可浏览，暂不可游玩</p>
        </div>

        <section class="title-panel panel-continue js-continue" hidden>
          <h2 class="panel-label">继续游戏</h2>
          <div class="slot-list js-continue-list"></div>
        </section>

        <section class="title-panel panel-howto">
          <div class="howto-list">
            <div class="howto-row"><span class="howto-keys"><kbd>WASD / 方向键</kbd></span><span>移动躲闪，左键点击普攻（自动锁敌）</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>右键</kbd></span><span>释放专武技能，充能靠击杀</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>Shift / 空格</kbd></span><span>冲刺，短暂无敌</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>TAB / I</kbd></span><span>商店中查看背包，两张同级同类卡可合成，点格子右上角 × 可丢弃</span></div>
            <div class="howto-row"><span class="howto-keys"><kbd>P</kbd></span><span>暂停 / 存档</span></div>
          </div>
          <p class="howto-note">清空全部敌人后从时空隧道三选一前进 · V 切视角 · M 静音。</p>
        </section>
      </div>
    </div>
  </section>

  <section class="screen tunnel-screen is-tunnel js-tunnel" aria-label="时空隧道">
    <div class="tunnel-inner">
      <div class="tunnel-mode-head">
        <span class="tunnel-mode-mark js-tunnel-mode-mark" aria-hidden="true">🧭</span>
        <p class="tunnel-kicker js-tunnel-kicker">STEP 2 / 2 · TIME RIFT</p>
      </div>
      <h2 class="tunnel-title js-tunnel-title">时空隧道 · 选择路线</h2>
      <p class="tunnel-sub js-tunnel-sub">选择前进的路线</p>
      <div class="tunnel-cards js-tunnel-cards"></div>
      <div class="tunnel-actions">
        <button class="tunnel-confirm js-tunnel-confirm" type="button" disabled>请先选择一条路线</button>
      </div>
      <p class="tunnel-hint js-tunnel-hint">选中一条路线，再点「确认路线」或按 <kbd>Enter</kbd> / <kbd>E</kbd> / <kbd>空格</kbd>（<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 可直接选中，防误触）</p>
    </div>
  </section>

  <section class="screen shop-screen js-shop" aria-label="商店">
    <div class="shop-panel">
      <header class="shop-head">
        <div class="shop-head-main">
          <p class="shop-kicker">WANDERING MERCHANT</p>
          <h2 class="shop-title">流浪商人</h2>
        </div>
        <div class="shop-gold"><span class="shop-gold-label">金币</span><b class="js-shop-gold">0</b></div>
      </header>
      <div class="shop-grid js-shop-grid"></div>
      <footer class="shop-foot">
        <button class="btn-ghost js-shop-refresh" type="button">重掷 <b class="js-refresh-cost">25</b> 金</button>
        <button class="btn-ghost js-shop-inv" type="button">进入背包 <kbd>TAB / I</kbd></button>
        <button class="btn-primary js-shop-continue" type="button">继续前进</button>
      </footer>
    </div>
  </section>

  <section class="screen inv-screen js-inv" aria-label="背包">
    <div class="inv-panel">
      <header class="inv-head">
        <div class="shop-head-main">
          <p class="inv-kicker">BACKPACK</p>
          <h2 class="inv-title">背包</h2>
        </div>
        <div class="inv-head-right">
          <div class="inv-count js-inv-count">0 / 12</div>
          <div class="shop-gold"><span class="shop-gold-label">金币</span><b class="js-inv-gold">0</b></div>
        </div>
      </header>
      <div class="inv-body">
        <div class="inv-grid js-inv-grid"></div>
        <aside class="inv-summary">
          <h3 class="inv-summary-title">已获卡片汇总</h3>
          <div class="inv-stats js-inv-stats"></div>
          <p class="inv-hint js-inv-hint">点击两张同级同种的卡牌合成；消耗品点击即使用；点格子右上角 × 丢弃。</p>
          <p class="inv-warn js-inv-warn" hidden>背包已满：可合成/丢弃，或在商店购买时自动合成。</p>
        </aside>
      </div>
      <footer class="inv-foot">
        <span class="inv-tip">同类同级增益卡可合成，最高 3 级；点 × 可丢弃，丢弃不退金币。TAB / I / Esc 关闭</span>
        <button class="btn-primary js-inv-close" type="button">关闭</button>
      </footer>
    </div>
  </section>

  <section class="screen pause-screen js-pause" aria-label="暂停">
    <div class="pause-box">
      <span class="pause-icon">II</span>
      <h2>已暂停</h2>
      <p>按 <kbd>P</kbd> / <kbd>Esc</kbd> 继续，进度只在你点头时才继续流动</p>
      <div class="pause-actions">
        <button class="btn-primary js-pause-resume" type="button">继续游戏</button>
        <button class="btn-ghost js-pause-save" type="button">存档</button>
        <button class="btn-ghost js-pause-load" type="button">读档</button>
        <button class="btn-ghost js-pause-mute" type="button">静音：关</button>
        <button class="btn-ghost btn-danger js-pause-quit" type="button">返回标题</button>
      </div>
    </div>
  </section>

  <section class="screen slots-screen js-slots" aria-label="存档槽位">
    <div class="slots-box">
      <h2 class="slots-title js-slots-title">选择存档槽位</h2>
      <p class="slots-sub js-slots-sub">存档会覆盖同槽位的旧记录</p>
      <div class="slot-list js-slot-list"></div>
      <button class="btn-ghost js-slots-close" type="button">返回</button>
    </div>
  </section>

  <section class="screen end-screen js-end" aria-label="结算">
    <div class="end-rays" aria-hidden="true"></div>
    <div class="end-inner">
      <p class="end-kicker js-end-kicker">RUN OVER</p>
      <h2 class="end-title js-end-title">你倒在了塔中</h2>
      <p class="end-sub js-end-sub"></p>
      <div class="end-stats js-end-stats"></div>
      <button class="btn-primary js-end-retry" type="button">重试本层</button>
      <button class="btn-restart js-restart" type="button">重新爬塔</button>
      <button class="btn-ghost js-end-title-btn" type="button">返回标题</button>
      <p class="end-tip">按 <kbd>R</kbd> 立即重开 · 按 <kbd>Enter</kbd> 返回标题</p>
    </div>
  </section>
`

/* ------------------------------------------------------------------ */
/* 实现                                                                */
/* ------------------------------------------------------------------ */

class HudImpl implements HudV3 {
  private readonly handlers: HudV3Handlers
  private readonly shell: HTMLDivElement
  private readonly cameraHolder: { camera: THREE.Camera | null } = { camera: null }
  private destroyed = false

  /* ---------- HUD ---------- */
  private hudEl!: HTMLElement
  private floorEl!: HTMLElement
  private floorNumEl!: HTMLElement
  private stageEl!: HTMLElement
  private floorNameEl!: HTMLElement
  private quotaFillEl!: HTMLElement
  private quotaTextEl!: HTMLElement
  private aliveEl!: HTMLElement
  private aliveStatEl!: HTMLElement
  private goldEl!: HTMLElement
  private diffEl!: HTMLElement
  private killsEl!: HTMLElement
  private killsStatEl!: HTMLElement
  private muteChipEl!: HTMLElement
  private hpBlockEl!: HTMLElement
  private hpFillEl!: HTMLElement
  private hpTextEl!: HTMLElement
  private skillBlockEl!: HTMLElement
  private skillNameEl!: HTMLElement
  private chargeFillEl!: HTMLElement
  private chargeTextEl!: HTMLElement
  private weaponLvEl!: HTMLElement
  private objectiveEl!: HTMLElement

  private bossEl!: HTMLElement
  private bossNameEl!: HTMLElement
  private bossFillEl!: HTMLElement
  private bossPortraitEl!: HTMLElement
  private dmgLayerEl!: HTMLElement
  private bannerEl!: HTMLElement
  private bannerFloorEl!: HTMLElement
  private bannerNameEl!: HTMLElement
  private bannerSubEl!: HTMLElement
  private toastLayerEl!: HTMLElement

  /* ---------- 标题 ---------- */
  private titleEl!: HTMLElement
  private titleInnerEl!: HTMLElement
  private titleKeyartEl!: HTMLImageElement
  private charCardsEl!: HTMLElement
  private readonly charCardEls: HTMLButtonElement[] = []
  private diffCardsEl!: HTMLElement
  private readonly diffCardEls: HTMLButtonElement[] = []
  private diffTipEl!: HTMLElement
  private startBtnEl!: HTMLButtonElement
  private continuePanelEl!: HTMLElement
  private continueListEl!: HTMLElement
  private selectedCharacter: CharacterId = 'mutsumi'
  private selectedDifficulty: DifficultyId = 'normal'
  private startLocked = false
  private lastSlots: SaveSlotMeta[] = []
  /** 当前这局使用的角色：决定专武图标，随 snapshot.character 同步 */
  private runCharacter: CharacterId = 'mutsumi'

  /* ---------- 隧道 ---------- */
  private tunnelEl!: HTMLElement
  private tunnelModeMarkEl!: HTMLElement
  private tunnelKickerEl!: HTMLElement
  private tunnelTitleEl!: HTMLElement
  private tunnelSubEl!: HTMLElement
  private tunnelHintEl!: HTMLElement
  private tunnelCardsEl!: HTMLElement
  private readonly tunnelCardRefs: TunnelCardRef[] = []
  private tunnelOffers: TunnelOffer[] = []
  private tunnelMode: TunnelScreenMode = 'tunnel'
  private tunnelLocked = false
  private tunnelSelected = -1
  private tunnelConfirmEl: HTMLButtonElement | null = null

  /* ---------- 商店 ---------- */
  private shopEl!: HTMLElement
  private shopKickerEl!: HTMLElement
  private shopTitleEl!: HTMLElement
  private shopGridEl!: HTMLElement
  private shopGoldEl!: HTMLElement
  private refreshBtnEl!: HTMLButtonElement
  private refreshCostEl!: HTMLElement
  private shopContinueEl!: HTMLButtonElement
  private readonly shopCardRefs: ShopCardRef[] = []
  private shopOffers: ShopOffer[] = []
  private shopRefreshCost = 0
  private shopGold = 0

  /* ---------- 背包 ---------- */
  private invEl!: HTMLElement
  private invGridEl!: HTMLElement
  private invCountEl!: HTMLElement
  private invGoldEl!: HTMLElement
  private invStatsEl!: HTMLElement
  private invHintEl!: HTMLElement
  private invWarnEl!: HTMLElement
  private readonly invCellRefs: InvCellRef[] = []
  private readonly invStatValueEls = new Map<CardStat, HTMLElement>()
  private invItems: InventoryItem[] = []
  private invMaxSlots = 12
  private invSelected: string | null = null
  private invGold = 0
  /** 上次丢弃的时间戳：防连点把下一格物品也丢掉 */
  private invDiscardMs = 0

  /* ---------- 暂停 / 存档 ---------- */
  private pauseEl!: HTMLElement
  private pauseMuteEl!: HTMLButtonElement
  private slotsEl!: HTMLElement
  private slotsTitleEl!: HTMLElement
  private slotsSubEl!: HTMLElement
  private slotListEl!: HTMLElement
  private slotMode: 'save' | 'load' = 'save'
  private paused = false

  /* ---------- 结算 ---------- */
  private endEl!: HTMLElement
  private endRetryEl!: HTMLButtonElement
  private endKickerEl!: HTMLElement
  private endTitleEl!: HTMLElement
  private endSubEl!: HTMLElement
  private endStatsEl!: HTMLElement
  private readonly endStatValueEls: HTMLElement[] = []
  private endLocked = false

  /* ---------- 内部状态 ---------- */
  private readonly floaters: Floater[] = []
  private floaterCursor = 0
  private floaterSeq = 0
  private lastFrame = 0
  private readonly barCache = new WeakMap<HTMLElement, number>()
  private bossPinned = false
  private bossRatio = -1
  private bannerTimer: number | null = null
  private artPollTimer: number | null = null
  private artPollTries = 0
  private muted = false
  private readonly scratchWorld = new THREE.Vector3()
  private readonly scratchProject = new THREE.Vector3()

  constructor(handlers: HudV3Handlers) {
    this.handlers = handlers
    this.shell = div('ui-shell')

    const root = this.ensureRoot()
    this.shell.innerHTML = UI_TEMPLATE
    root.appendChild(this.shell)

    this.wireHud()
    this.wireTitle()
    this.wireTunnel()
    this.wireShop()
    this.wireInventory()
    this.wirePause()
    this.wireEnd()
    this.buildFloaters()

    this.selectCharacter('mutsumi')
    this.selectDifficulty('normal')
    this.syncArt()

    window.addEventListener('keydown', this.onKeyDown)
    this.refreshHud()
  }

  /* ================================================================ */
  /* HudV3 接口                                                        */
  /* ================================================================ */

  setCamera(camera: THREE.Camera): void {
    this.cameraHolder.camera = camera ?? null
  }

  update(snapshot: HudSnapshot): void {
    if (this.destroyed) return
    if (snapshot.character) this.runCharacter = snapshot.character
    const now = performance.now()
    const dt = this.lastFrame > 0 ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0
    this.lastFrame = now

    const floor = Math.max(1, Math.floor(snapshot.floor || 1))
    setText(this.floorNumEl, String(floor))
    if (snapshot.stage != null) setText(this.stageEl, String(Math.max(1, Math.floor(snapshot.stage))))
    setText(this.floorNameEl, snapshot.floorName || '未知区域')

    const bossLayer = snapshot.bossLayer === true
    const total = Math.max(0, Math.floor(snapshot.monsterTotal ?? snapshot.quotaMax ?? 0))
    const killed = Math.max(0, Math.floor(snapshot.monsterKilled ?? snapshot.quota ?? 0))
    const cleared = !bossLayer && total > 0 && killed >= total
    this.floorEl.classList.toggle('is-boss-layer', bossLayer)
    this.floorEl.classList.toggle('is-cleared', cleared)
    setText(
      this.quotaTextEl,
      bossLayer ? '首领层 · 击败哥布林之王' : total > 0 ? `击杀 ${Math.min(killed, total)} / ${total}` : '首领层 · 击败首领',
    )
    setBarFill(this.quotaFillEl, bossLayer ? 0 : total > 0 ? clamp01(killed / total) : 0, this.barCache)

    const alive = Math.max(0, Math.floor(snapshot.enemiesAlive || 0))
    setText(this.aliveEl, String(alive))
    setText(this.aliveStatEl, String(alive))
    setText(this.killsEl, fmtInt(snapshot.kills || 0))
    setText(this.killsStatEl, fmtInt(snapshot.kills || 0))
    setText(this.goldEl, fmtInt(snapshot.gold || 0))
    const diffName =
      snapshot.difficultyName ||
      (snapshot.difficulty ? DIFFICULTIES[snapshot.difficulty]?.name : '') ||
      '—'
    setText(this.diffEl, diffName)

    // 生命
    const maxHp = Math.max(1, snapshot.maxHp || 1)
    const hp = Math.max(0, Math.min(snapshot.hp || 0, maxHp))
    setText(this.hpTextEl, `${Math.ceil(hp)} / ${Math.ceil(maxHp)}`)
    setBarFill(this.hpFillEl, clamp01(hp / maxHp), this.barCache)
    this.hpBlockEl.classList.toggle('is-danger', hp / maxHp <= 0.3)

    // 技能充能
    const chargeMax = Math.max(1, snapshot.chargeMax ?? 100)
    const charge = Math.max(0, Math.min(snapshot.charge ?? 0, chargeMax))
    setText(this.chargeTextEl, `${Math.floor(charge)} / ${Math.round(chargeMax)}`)
    setText(this.skillNameEl, snapshot.skillName || '技能')
    setText(this.weaponLvEl, String(Math.max(1, Math.floor(snapshot.weaponLv ?? 1))))
    setBarFill(this.chargeFillEl, clamp01(charge / chargeMax), this.barCache)
    this.skillBlockEl.classList.toggle('is-ready', Boolean(snapshot.skillReady))

    // 目标提示
    setText(
      this.objectiveEl,
      bossLayer
        ? '击败哥布林之王 · 本层通关'
        : total <= 0
          ? '击败本层首领'
          : cleared
            ? '本层已清空 · 前往时空隧道'
            : `剩余 ${total - killed} 只 · 清空后进入时空隧道`,
    )

    this.updateBossFromSnapshot(snapshot)
    this.updateFloaters(dt)
  }

  showTitle(slots: SaveSlotMeta[]): void {
    this.lastSlots = slots.slice()
    this.startLocked = false
    this.tunnelLocked = false
    this.endLocked = false
    this.hideEnd()
    this.hidePause()
    this.hideTunnels()
    this.hideShop()
    this.hideInventory()
    this.hideSaveSlots()
    this.renderContinueSlots()
    this.selectCharacter(this.selectedCharacter, true)
    this.selectDifficulty(this.selectedDifficulty, true)
    this.titleEl.classList.add('is-open')
    this.syncArt()
    this.refreshHud()
  }

  hideTitle(): void {
    this.titleEl.classList.remove('is-open')
    this.titleInnerEl.classList.remove('is-char-focus')
    this.hideEnd()
    this.hidePause()
    this.hideTunnels()
    this.hideShop()
    this.hideInventory()
    this.hideSaveSlots()
    this.refreshHud()
  }

  showCharacterSelect(): void {
    this.titleEl.classList.add('is-open')
    this.titleInnerEl.classList.add('is-char-focus')
    this.refreshHud()
  }

  hideCharacterSelect(): void {
    this.titleInnerEl.classList.remove('is-char-focus')
  }

  showTunnelOffers(offers: TunnelOffer[], layer: number, mode: TunnelScreenMode = 'tunnel'): void {
    const hasLayer = layer > 0
    const isBonus = mode === 'bonus'
    this.tunnelMode = mode
    this.tunnelOffers = offers.slice(0, this.tunnelCardRefs.length)
    this.tunnelEl.classList.toggle('is-bonus', isBonus)
    this.tunnelEl.classList.toggle('is-tunnel', !isBonus)
    this.tunnelEl.dataset.mode = mode
    this.tunnelEl.setAttribute('aria-label', isBonus ? '清层奖励三选一' : '时空隧道路线选择')
    setText(this.tunnelModeMarkEl, isBonus ? '🎁' : '🧭')
    setText(this.tunnelKickerEl, isBonus ? 'STEP 1 / 2 · LAYER REWARD' : 'STEP 2 / 2 · TIME RIFT')
    setText(this.tunnelTitleEl, isBonus ? '清层奖励 · 三选一' : '时空隧道 · 选择路线')
    setText(
      this.tunnelSubEl,
      isBonus
        ? hasLayer
          ? `第 ${layer} 层清层奖励 · 领取后进入时空隧道选路线`
          : '本层清层奖励 · 领取后进入时空隧道选路线'
        : hasLayer
          ? `第 ${layer} 层已清空 · 选择前进的路线`
          : '选择前进的路线',
    )
    this.tunnelHintEl.innerHTML = isBonus
      ? '选中一张奖励卡，再点「领取奖励」或按 <kbd>Enter</kbd> / <kbd>E</kbd> / <kbd>空格</kbd>（<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 可直接选中，防误触）'
      : '选中一条路线，再点「确认路线」或按 <kbd>Enter</kbd> / <kbd>E</kbd> / <kbd>空格</kbd>（<kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> 可直接选中，防误触）'
    for (let i = 0; i < this.tunnelCardRefs.length; i += 1) {
      const ref = this.tunnelCardRefs[i]
      const offer = this.tunnelOffers[i]
      if (!offer) {
        ref.card.hidden = true
        continue
      }
      ref.card.hidden = false
      ref.card.disabled = false
      ref.card.dataset.offerId = offer.id
      ref.card.className = `tunnel-card kind-${offer.kind}`
      setText(ref.band, isBonus ? '清层奖励' : TUNNEL_META[offer.kind]?.label ?? '未知')
      setArtIcon(ref.icon, this.tunnelIconArt(offer), offer.icon || '✦')
      setText(ref.room, isBonus ? '本层奖励 · 增益卡' : ROOM_LABEL[offer.room] ?? '未知房间')
      setText(ref.title, offer.title)
      setText(ref.desc, offer.desc)
      const lines = this.tunnelPreviewLines(offer, mode)
      ref.preview.replaceChildren(...lines.map((line) => this.makePreviewRow(line)))
      setText(ref.key, String(i + 1))
    }
    this.tunnelSelected = -1
    this.applyTunnelSelection()
    this.tunnelEl.classList.add('is-open')
    this.syncArt()
    this.refreshHud()
  }

  hideTunnels(): void {
    this.tunnelEl.classList.remove('is-open')
    this.tunnelLocked = false
    this.refreshHud()
  }

  showShop(offers: ShopOffer[], gold: number, refreshCost: number, mode: ShopMode = 'standard'): void {
    const roomShop = mode === 'room'
    this.shopKickerEl.textContent = roomShop ? 'WANDERING MERCHANT · EXTRA SHELF' : 'WANDERING MERCHANT'
    this.shopTitleEl.textContent = roomShop ? '流浪商人 · 额外货架' : '流浪商人'
    this.shopContinueEl.textContent = roomShop ? '结束选购 → 标准商店' : '继续前进'
    this.shopOffers = offers.slice(0, 4)
    this.shopRefreshCost = Math.max(0, refreshCost)
    this.renderShop(gold)
    this.shopEl.classList.add('is-open')
    this.refreshHud()
  }

  updateShop(offers: ShopOffer[], gold: number, refreshCost: number): void {
    this.shopOffers = offers.slice(0, 4)
    this.shopRefreshCost = Math.max(0, refreshCost)
    this.renderShop(gold)
  }

  hideShop(): void {
    this.shopEl.classList.remove('is-open')
    this.refreshHud()
  }

  showInventory(items: InventoryItem[], gold: number, maxSlots: number): void {
    this.invMaxSlots = Math.max(1, Math.min(24, Math.floor(maxSlots) || 12))
    this.ensureInvCells(this.invMaxSlots)
    this.invSelected = null
    this.invItems = items.slice()
    this.renderInventory(gold)
    this.invEl.classList.add('is-open')
    this.refreshHud()
  }

  updateInventory(items: InventoryItem[], gold: number): void {
    this.invItems = items.slice()
    if (this.invSelected && !this.invItems.some((item) => item.uid === this.invSelected)) {
      this.invSelected = null
    }
    this.renderInventory(gold)
  }

  hideInventory(): void {
    this.invEl.classList.remove('is-open')
    this.invSelected = null
    this.refreshHud()
  }

  isInventoryOpen(): boolean {
    return this.invEl.classList.contains('is-open')
  }

  showPause(slots: SaveSlotMeta[]): void {
    this.lastSlots = slots.slice()
    this.paused = true
    this.pauseEl.classList.add('is-open')
    this.refreshHud()
  }

  hidePause(): void {
    this.paused = false
    this.pauseEl.classList.remove('is-open')
    this.slotsEl.classList.remove('is-open')
    this.refreshHud()
  }

  showSaveSlots(mode: 'save' | 'load', slots: SaveSlotMeta[]): void {
    this.slotMode = mode
    this.lastSlots = slots.slice()
    setText(this.slotsTitleEl, mode === 'save' ? '选择存档槽位' : '选择读档槽位')
    setText(this.slotsSubEl, mode === 'save' ? '存档会覆盖同槽位的旧记录' : '读取存档会放弃当前进度')
    this.renderSlotList()
    this.slotsEl.classList.add('is-open')
    this.refreshHud()
  }

  hideSaveSlots(): void {
    this.slotsEl.classList.remove('is-open')
  }

  showDefeat(_reason: DefeatReason, stats: RunStatsV3): void {
    this.renderEnd(stats, false)
  }

  showVictory(stats: RunStatsV3): void {
    this.renderEnd(stats, true)
  }

  hideEnd(): void {
    this.endEl.classList.remove('is-open')
    this.endLocked = false
    this.refreshHud()
  }

  showLayerBanner(layer: number, name: string, subtitle: string, total: number): void {
    setText(this.bannerFloorEl, `LAYER ${pad2(layer)} / ${pad2(Math.max(layer, total))}`)
    setText(this.bannerNameEl, name)
    setText(this.bannerSubEl, subtitle)
    this.bannerEl.hidden = false
    restartAnim(this.bannerEl)
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer)
    this.bannerTimer = window.setTimeout(() => {
      this.bannerTimer = null
      if (!this.destroyed) this.bannerEl.hidden = true
    }, 2400)
  }

  showBoss(name: string, hp: number, maxHp: number): void {
    this.bossPinned = true
    this.bossEl.hidden = false
    this.bossEl.dataset.maxHp = String(Math.max(1, maxHp))
    this.bossEl.classList.add('is-open')
    setText(this.bossNameEl, name)
    this.setBossRatio(maxHp > 0 ? hp / maxHp : 0)
  }

  updateBoss(hp: number): void {
    const maxHp = Number(this.bossEl.dataset.maxHp || 0)
    this.setBossRatio(maxHp > 0 ? hp / maxHp : 0)
  }

  hideBoss(): void {
    this.bossPinned = false
    this.bossEl.hidden = true
    this.bossEl.classList.remove('is-open')
    this.bossRatio = -1
  }

  floatText(worldPos: THREE.Vector3, text: string, kind: DmgKind = 'normal'): void {
    this.spawnFloater(worldPos, text, kind)
  }
  damageNumber(worldPos: THREE.Vector3, amount: number, kind: 'normal' | 'crit' | 'heal' | 'gold'): void {
    this.spawnFloater(worldPos, this.formatDamage(amount, kind), kind)
  }

  /** 所有飘字共用的生成入口：错位、寿命和上飘高度都在这里决定 */
  private spawnFloater(worldPos: THREE.Vector3, text: string, kind: DmgKind): void {
    if (this.destroyed || this.floaters.length === 0) return
    const floater = this.acquireFloater()
    const fan = FLOATER_FAN[this.floaterSeq++ % FLOATER_FAN.length]
    floater.world.copy(worldPos)
    floater.age = 0
    floater.life = FLOATER_LIFE + Math.random() * 0.14
    floater.kind = kind
    floater.drift = (Math.random() - 0.5) * 8
    floater.offsetX = fan[0] + (Math.random() - 0.5) * 4
    floater.offsetY = fan[1] + (Math.random() - 0.5) * 3
    floater.rise = FLOATER_RISE_PX * (0.82 + Math.random() * 0.3)
    floater.active = true
    floater.el.className = `dmg kind-${kind}`
    floater.el.textContent = text
    this.renderFloater(floater)
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info'): void {
    if (this.destroyed || !text) return
    while (this.toastLayerEl.childElementCount >= 4) {
      this.toastLayerEl.firstElementChild?.remove()
    }
    const node = div(`toast kind-${kind}`, text)
    this.toastLayerEl.appendChild(node)
    window.setTimeout(() => node.remove(), 2150)
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    if (paused) {
      this.pauseEl.classList.add('is-open')
    } else {
      this.pauseEl.classList.remove('is-open')
      this.slotsEl.classList.remove('is-open')
    }
    this.refreshHud()
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.muteChipEl.hidden = !muted
    setText(this.pauseMuteEl, muted ? '静音：开' : '静音：关')
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('keydown', this.onKeyDown)
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer)
    this.bannerTimer = null
    if (this.artPollTimer !== null) window.clearTimeout(this.artPollTimer)
    this.artPollTimer = null
    this.floaters.length = 0
    this.shell.remove()
  }

  /* ================================================================ */
  /* 构造：绑定各块                                                    */
  /* ================================================================ */

  private ensureRoot(): HTMLElement {
    let root = document.getElementById('ui-root')
    if (!root) {
      root = div('')
      root.id = 'ui-root'
      document.body.appendChild(root)
    }
    return root
  }

  private q<T extends HTMLElement>(selector: string): T {
    const node = this.shell.querySelector<T>(selector)
    if (!node) throw new Error(`[hud] 模板缺少节点：${selector}`)
    return node
  }

  private wireHud(): void {
    this.hudEl = this.q('.js-hud')
    this.floorEl = this.q('.js-floor')
    this.floorNumEl = this.q('.js-floor-num')
    this.stageEl = this.q('.js-stage')
    this.floorNameEl = this.q('.js-floor-name')
    this.quotaFillEl = this.q('.js-quota-fill')
    this.quotaTextEl = this.q('.js-quota-text')
    this.aliveEl = this.q('.js-alive')
    this.aliveStatEl = this.q('.js-alive-stat')
    this.goldEl = this.q('.js-gold')
    this.diffEl = this.q('.js-diff')
    this.killsEl = this.q('.js-kills')
    this.killsStatEl = this.q('.js-kills-stat')
    this.muteChipEl = this.q('.js-mute')
    const hudPauseBtn = this.q('.js-hud-pause')
    if (hudPauseBtn) hudPauseBtn.addEventListener('click', () => this.handlers.onPauseToggle())
    this.hpBlockEl = this.q('.js-hp-block')
    this.hpFillEl = this.q('.js-hp-fill')
    this.hpTextEl = this.q('.js-hp-text')
    this.skillBlockEl = this.q('.js-skill-block')
    this.skillNameEl = this.q('.js-skill-name')
    this.chargeFillEl = this.q('.js-charge-fill')
    this.chargeTextEl = this.q('.js-charge-text')
    this.weaponLvEl = this.q('.js-weapon-lv')
    this.objectiveEl = this.q('.js-objective')
    this.bossEl = this.q('.js-boss')
    this.bossNameEl = this.q('.js-boss-name')
    this.bossFillEl = this.q('.js-boss-fill')
    this.bossPortraitEl = this.q('.js-boss-portrait')
    setArtIcon(this.bossPortraitEl, 'portrait_boss', '👑')
    this.dmgLayerEl = this.q('.js-dmg-layer')
    this.bannerEl = this.q('.js-banner')
    this.bannerFloorEl = this.q('.js-banner-floor')
    this.bannerNameEl = this.q('.js-banner-name')
    this.bannerSubEl = this.q('.js-banner-sub')
    this.toastLayerEl = this.q('.js-toast-layer')
  }

  private wireTitle(): void {
    this.titleEl = this.q('.js-title')
    this.titleInnerEl = this.q('.js-title-inner')
    this.titleKeyartEl = this.q<HTMLImageElement>('.js-title-keyart')
    this.charCardsEl = this.q('.js-char-cards')
    this.diffCardsEl = this.q('.js-diff-cards')
    this.diffTipEl = this.q('.js-diff-tip')
    this.startBtnEl = this.q('.js-start')
    this.continuePanelEl = this.q('.js-continue')
    this.continueListEl = this.q('.js-continue-list')

    for (const id of CHAR_ORDER) {
      const def = CHARACTERS[id]
      if (!def) continue
      const card = el('button', 'char-card')
      card.type = 'button'
      card.dataset.char = id
      const avatarWrap = div('char-avatar-wrap')
      const avatar = div(`char-avatar avatar-${id}`)
      setArtIcon(avatar, PORTRAIT_ART[id], CHAR_EMOJI[id] ?? '✦')
      avatarWrap.appendChild(avatar)
      if (id === 'mutsumi') {
        // 睦 = 双形态：右下角挂 Mortis 小像说明「可切换」（挂在圆形裁切框外，避免被裁）
        const form = div('char-form-badge')
        const formIcon = span('char-form-icon')
        setArtIcon(formIcon, 'portrait_mortis', '🌑')
        form.append(formIcon, span('char-form-text', '双形态'))
        avatarWrap.appendChild(form)
      }
      const info = div('char-info')
      info.appendChild(span('char-name', def.name))
      info.appendChild(span('char-title', def.title))
      info.appendChild(span('char-role', def.role))
      card.append(avatarWrap, info)
      card.addEventListener('click', () => this.selectCharacter(id))
      this.charCardsEl.appendChild(card)
      this.charCardEls.push(card)
    }

    for (const id of DIFFICULTY_IDS) {
      const def = DIFFICULTIES[id]
      if (!def) continue
      const meta = DIFF_META[id] ?? { icon: '✦', tag: '' }
      const card = el('button', 'diff-card')
      card.type = 'button'
      card.dataset.diff = id
      const head = div('diff-head')
      head.append(span('diff-icon', meta.icon), span('diff-name', def.name), span('diff-tag', meta.tag))
      const desc = div('diff-desc', def.note)
      const mods = div('diff-mods')
      mods.append(
        span('diff-mod', `敌人 ×${def.stages?.length ?? 1} 阶段`),
        span('diff-mod', `生命 ×${def.hpMul}`),
        span('diff-mod', `数量 ×${def.countMul}`),
      )
      const check = span('diff-check', '✓')
      card.append(head, desc, mods, check)
      card.addEventListener('click', () => this.selectDifficulty(id))
      this.diffCardsEl.appendChild(card)
      this.diffCardEls.push(card)
    }

    this.startBtnEl.addEventListener('click', () => this.startGame())

    this.q('.js-end-title-btn').addEventListener('click', () => {
      this.hideEnd()
      this.handlers.onQuitToTitle()
    })
  }

  private wireTunnel(): void {
    this.tunnelEl = this.q('.js-tunnel')
    this.tunnelModeMarkEl = this.q('.js-tunnel-mode-mark')
    this.tunnelKickerEl = this.q('.js-tunnel-kicker')
    this.tunnelTitleEl = this.q('.js-tunnel-title')
    this.tunnelSubEl = this.q('.js-tunnel-sub')
    this.tunnelHintEl = this.q('.js-tunnel-hint')
    this.tunnelCardsEl = this.q('.js-tunnel-cards')
    for (let i = 0; i < 3; i += 1) {
      const card = el('button', 'tunnel-card')
      card.type = 'button'
      const band = span('tc-band', '奖励')
      const key = span('tc-key', String(i + 1))
      const head = div('tc-head')
      const icon = span('tc-icon', '✦')
      const room = span('tc-room', '未知房间')
      head.append(icon, room)
      const title = div('tc-title', '')
      const desc = div('tc-desc', '')
      const preview = div('tc-preview')
      card.append(band, key, head, title, desc, preview)
      card.addEventListener('click', () => this.selectTunnel(i))
      this.tunnelCardsEl.appendChild(card)
      this.tunnelCardRefs.push({ card, band, icon, room, title, desc, preview, key })
    }
    this.tunnelConfirmEl = this.q('.js-tunnel-confirm') as HTMLButtonElement
    this.tunnelConfirmEl.addEventListener('click', () => this.commitTunnel())
  }

  /** 选中一张隧道卡（不立即生效，防止战斗中狂点误选） */
  private selectTunnel(index: number): void {
    if (this.tunnelLocked || this.destroyed) return
    if (!this.tunnelOffers[index]) return
    this.tunnelSelected = index
    this.applyTunnelSelection()
  }

  private applyTunnelSelection(): void {
    const isBonus = this.tunnelMode === 'bonus'
    for (let i = 0; i < this.tunnelCardRefs.length; i += 1) {
      this.tunnelCardRefs[i].card.classList.toggle('is-selected', i === this.tunnelSelected)
    }
    if (this.tunnelConfirmEl) {
      this.tunnelConfirmEl.disabled = this.tunnelSelected < 0
      this.tunnelConfirmEl.textContent = this.tunnelSelected >= 0
        ? (isBonus ? '领取奖励' : '确认路线')
        : (isBonus ? '请先选择一张奖励卡' : '请先选择一条路线')
    }
  }

  private commitTunnel(): void {
    if (this.tunnelSelected < 0) return
    this.pickTunnel(this.tunnelSelected)
  }

  private wireShop(): void {
    this.shopEl = this.q('.js-shop')
    this.shopKickerEl = this.q('.shop-kicker')
    this.shopTitleEl = this.q('.shop-title')
    this.shopGridEl = this.q('.js-shop-grid')
    this.shopGoldEl = this.q('.js-shop-gold')
    this.refreshBtnEl = this.q('.js-shop-refresh')
    this.refreshCostEl = this.q('.js-refresh-cost')
    this.shopContinueEl = this.q<HTMLButtonElement>('.js-shop-continue')

    this.refreshBtnEl.addEventListener('click', () => {
      if (this.shopGold < this.shopRefreshCost) return
      this.handlers.onShopRefresh()
    })
    this.q('.js-shop-inv').addEventListener('click', () => this.handlers.onOpenInventory())
    this.shopContinueEl.addEventListener('click', () => {
      this.hideShop()
      this.handlers.onShopClose()
    })
  }

  private wireInventory(): void {
    this.invEl = this.q('.js-inv')
    this.invGridEl = this.q('.js-inv-grid')
    this.invCountEl = this.q('.js-inv-count')
    this.invGoldEl = this.q('.js-inv-gold')
    this.invStatsEl = this.q('.js-inv-stats')
    this.invHintEl = this.q('.js-inv-hint')
    this.invWarnEl = this.q('.js-inv-warn')
    this.q('.js-inv-close').addEventListener('click', () => {
      this.hideInventory()
      this.handlers.onCloseInventory()
    })

    for (const stat of STAT_ORDER) {
      const row = div('inv-stat')
      const label = div('inv-stat-name')
      const icon = span('inv-stat-icon')
      setArtIcon(icon, CARD_ART[stat], '·')
      label.append(icon, span('inv-stat-label', STAT_LABEL[stat]))
      row.appendChild(label)
      const value = span('inv-stat-value', '0')
      row.appendChild(value)
      this.invStatsEl.appendChild(row)
      this.invStatValueEls.set(stat, value)
    }
  }

  private wirePause(): void {
    this.pauseEl = this.q('.js-pause')
    this.pauseMuteEl = this.q('.js-pause-mute')
    this.slotsEl = this.q('.js-slots')
    this.slotsTitleEl = this.q('.js-slots-title')
    this.slotsSubEl = this.q('.js-slots-sub')
    this.slotListEl = this.q('.js-slot-list')

    this.q('.js-pause-resume').addEventListener('click', () => this.handlers.onPauseToggle())
    this.q('.js-pause-save').addEventListener('click', () => this.showSaveSlots('save', this.lastSlots))
    this.q('.js-pause-load').addEventListener('click', () => this.showSaveSlots('load', this.lastSlots))
    this.q('.js-pause-quit').addEventListener('click', () => {
      this.hidePause()
      this.handlers.onQuitToTitle()
    })
    this.pauseMuteEl.addEventListener('click', () => this.toggleMute())
    this.q('.js-slots-close').addEventListener('click', () => this.hideSaveSlots())
  }

  private wireEnd(): void {
    this.endEl = this.q('.js-end')
    this.endRetryEl = this.q('.js-end-retry') as HTMLButtonElement
    this.endRetryEl.addEventListener('click', () => this.handlers.onRetryLayer())
    this.endKickerEl = this.q('.js-end-kicker')
    this.endTitleEl = this.q('.js-end-title')
    this.endSubEl = this.q('.js-end-sub')
    this.endStatsEl = this.q('.js-end-stats')

    const labels = ['角色', '难度', '层数', '击杀', '金币', '专武', '卡片', '用时']
    for (const label of labels) {
      const cell = div('end-stat')
      cell.appendChild(span('end-stat-label', label))
      const value = span('end-stat-value', '—')
      cell.appendChild(value)
      this.endStatsEl.appendChild(cell)
      this.endStatValueEls.push(value)
    }

    this.q('.js-restart').addEventListener('click', () => this.restart())
  }

  private buildFloaters(): void {
    for (let i = 0; i < MAX_FLOATERS; i += 1) {
      const node = div('dmg')
      this.dmgLayerEl.appendChild(node)
      this.floaters.push({
        el: node,
        world: new THREE.Vector3(),
        age: 0,
        life: FLOATER_LIFE,
        kind: 'normal',
        drift: 0,
        offsetX: 0,
        offsetY: 0,
        rise: FLOATER_RISE_PX,
        active: false,
      })
    }
  }

  /* ================================================================ */
  /* 标题页                                                            */
  /* ================================================================ */

  private selectCharacter(id: CharacterId, silent = false): void {
    this.selectedCharacter = id
    for (const card of this.charCardEls) {
      card.classList.toggle('is-active', card.dataset.char === id)
    }
    if (!silent) this.updateDiffTip()
  }

  private selectDifficulty(id: DifficultyId, silent = false): void {
    this.selectedDifficulty = id
    for (const card of this.diffCardEls) {
      card.classList.toggle('is-active', card.dataset.diff === id)
    }
    if (!silent) this.updateDiffTip()
  }

  private updateDiffTip(): void {
    const def = DIFFICULTIES[this.selectedDifficulty]
    if (!def) {
      setText(this.diffTipEl, '')
      return
    }
    setText(this.diffTipEl, `${def.name} · ${def.note}`)
  }

  private startGame(): void {
    if (this.startLocked || this.destroyed) return
    this.startLocked = true
    window.setTimeout(() => {
      this.startLocked = false
    }, PICK_DELAY_MS * 2)
    this.hideTitle()
    this.handlers.onStart(this.selectedCharacter, this.selectedDifficulty)
  }

  private renderContinueSlots(): void {
    const rows = this.lastSlots.filter((meta) => !meta.empty)
    this.continueListEl.replaceChildren()
    if (rows.length === 0) {
      this.continuePanelEl.hidden = true
      return
    }
    this.continuePanelEl.hidden = false
    for (const meta of rows) {
      const row = this.makeSlotRow(meta, 'continue')
      row.addEventListener('click', () => {
        if (this.startLocked) return
        this.startLocked = true
        this.hideTitle()
        this.handlers.onContinue(meta.slot)
      })
      this.continueListEl.appendChild(row)
    }
  }

  /* ================================================================ */
  /* 时空隧道                                                          */
  /* ================================================================ */

  /** 隧道卡大图标：优先首领像 / 卡牌 / 专武，商人等保留 emoji */
  private tunnelIconArt(offer: TunnelOffer): ArtKey | null {
    const payload = offer.payload ?? {}
    if (payload.bossLayer) return 'portrait_boss'
    if (payload.card) return itemArtKey(payload.card)
    if (payload.skillCard) return cardArtKey(payload.skillCard.stat)
    if (payload.altarReward) return cardArtKey(payload.altarReward.stat)
    return null
  }

  /** 一条预览行：有原画的条目额外渲染 16px 图标 */
  private makePreviewRow(line: TunnelPreviewLine): HTMLSpanElement {
    if (!line.art) return span('tc-row', line.text)
    const row = span('tc-row has-icon')
    const icon = span('tc-row-icon')
    setArtIcon(icon, line.art, '▸')
    row.append(icon, document.createTextNode(line.text))
    return row
  }

  private tunnelPreviewLines(offer: TunnelOffer, mode: TunnelScreenMode = 'tunnel'): TunnelPreviewLine[] {
    const payload = offer.payload ?? {}
    const lines: TunnelPreviewLine[] = []
    if (typeof payload.gold === 'number' && payload.gold > 0) {
      lines.push({ text: `金币 +${fmtInt(payload.gold)}`, art: null })
    }
    if (payload.card) {
      const card = payload.card
      lines.push({ text: `卡牌 · ${card.name}`, art: itemArtKey(card) })
      if (card.desc) lines.push({ text: `效果 · ${card.desc}`, art: null })
      if (card.stat && typeof card.value === 'number') {
        lines.push({
          text: `数值 · ${STAT_LABEL[card.stat]} ${formatStatValue(card.stat, card.value)}`,
          art: null,
        })
      }
      if (card.tier > 1) lines.push({ text: `品质 · ${tierLabel(card.tier)}`, art: null })
    }
    if (payload.skillCard) {
      const skill = payload.skillCard
      const label = mode === 'bonus' ? '增益卡' : '技能卡'
      lines.push({ text: `${label} · ${skill.name}`, art: cardArtKey(skill.stat) })
      if (skill.desc) lines.push({ text: `效果 · ${skill.desc}`, art: null })
      // 技能卡房的 stat/value 只是折算背包卡用的占位数值，不能当作实际增益展示
      if (mode === 'bonus' && typeof skill.value === 'number') {
        lines.push({
          text: `数值 · ${STAT_LABEL[skill.stat]} ${formatStatValue(skill.stat, skill.value)}`,
          art: null,
        })
      }
      if (mode === 'bonus' && skill.tier && skill.tier > 1) {
        const mul = typeof skill.valueMul === 'number' ? ` ×${skill.valueMul}` : ''
        lines.push({ text: `品质 · ${tierLabel(skill.tier)}${mul}`, art: null })
      }
    }
    if (payload.shopOffers && payload.shopOffers.length > 0) {
      lines.push({ text: `商会 · ${payload.shopOffers.length} 件商品`, art: null })
    }
    if (typeof payload.altarCost === 'number') {
      const reward = payload.altarReward
        ? ` → ${STAT_LABEL[payload.altarReward.stat]} ${formatStatValue(payload.altarReward.stat, payload.altarReward.value)}`
        : ''
      lines.push({
        text: `献祭 ${fmtInt(payload.altarCost)} 金币${reward}`,
        art: cardArtKey(payload.altarReward?.stat),
      })
    }
    if (typeof payload.enemyCount === 'number') {
      lines.push({
        text: `${payload.bossLayer ? '首领' : '敌人'} ${payload.enemyCount} 只`,
        art: payload.bossLayer ? 'portrait_boss' : null,
      })
    } else if (payload.bossLayer) {
      lines.push({ text: '首领战', art: 'portrait_boss' })
    }
    if (lines.length === 0) lines.push({ text: TUNNEL_META[offer.kind]?.hint ?? '未知的际遇', art: null })
    return lines
  }

  private pickTunnel(index: number): void {
    if (this.tunnelLocked || this.destroyed) return
    const offer = this.tunnelOffers[index]
    if (!offer) return
    this.tunnelLocked = true
    window.setTimeout(() => {
      this.tunnelLocked = false
    }, PICK_DELAY_MS)
    for (const ref of this.tunnelCardRefs) ref.card.disabled = true
    this.tunnelCardRefs[index]?.card.classList.add('is-picked')
    this.tunnelEl.classList.remove('is-open')
    this.handlers.onTunnelPick(offer.id)
  }

  /* ================================================================ */
  /* 商店                                                              */
  /* ================================================================ */

  private growShopCards(count: number): void {
    while (this.shopCardRefs.length < count) {
      const index = this.shopCardRefs.length
      const card = el('button', 'shop-card')
      card.type = 'button'
      const icon = span('sc-icon', '✦')
      const kind = span('sc-kind', '商品')
      const tier = span('sc-tier', '普通')
      const name = div('sc-name', '')
      const desc = div('sc-desc', '')
      const price = span('sc-price', '0')
      const buy = span('sc-buy', '购买')
      const head = div('sc-head')
      head.append(icon, kind, tier)
      const foot = div('sc-foot')
      foot.append(price, buy)
      card.append(head, name, desc, foot)
      card.addEventListener('click', () => {
        const offer = this.shopOffers[index]
        if (!offer) return
        this.handlers.onShopBuy(offer.id)
      })
      this.shopGridEl.appendChild(card)
      this.shopCardRefs.push({ card, icon, kind, tier, name, desc, price, buy })
    }
  }

  /** 商店条目 → 原画 key：专武按当前角色，增益卡按维度 */
  private shopOfferArt(offer: ShopOffer): ArtKey | null {
    if (offer.kind === 'weapon') return weaponArtKey(this.runCharacter)
    if (offer.kind === 'buff-card') return cardArtKey(offer.stat)
    return null
  }

  private renderShop(gold: number): void {
    this.shopGold = Math.max(0, gold)
    setText(this.shopGoldEl, fmtInt(this.shopGold))
    setText(this.refreshCostEl, fmtInt(this.shopRefreshCost))
    const canRefresh = this.shopGold >= this.shopRefreshCost
    this.refreshBtnEl.disabled = !canRefresh
    this.refreshBtnEl.classList.toggle('is-poor', !canRefresh)

    this.growShopCards(this.shopOffers.length)
    for (let i = 0; i < this.shopCardRefs.length; i += 1) {
      const ref = this.shopCardRefs[i]
      const offer = this.shopOffers[i]
      if (!offer) {
        ref.card.hidden = true
        continue
      }
      ref.card.hidden = false
      ref.card.className = `shop-card ${tierClass(offer.tier)}`
      const poor = this.shopGold < offer.price
      ref.card.classList.toggle('is-poor', poor)
      ref.card.dataset.offerId = offer.id
      setArtIcon(ref.icon, this.shopOfferArt(offer), offer.icon || '✦')
      setText(ref.kind, SHOP_KIND_LABEL[offer.kind] ?? '商品')
      setText(ref.tier, tierLabel(offer.tier))
      setText(ref.name, offer.name)
      setText(ref.desc, offer.desc)
      setText(ref.price, fmtInt(offer.price))
      setText(ref.buy, poor ? '金币不足' : '购买')
    }
    this.syncArt()
  }

  /* ================================================================ */
  /* 背包                                                              */
  /* ================================================================ */

  private ensureInvCells(count: number): void {
    while (this.invCellRefs.length < count) {
      const index = this.invCellRefs.length
      const cell = el('button', 'inv-cell is-empty')
      cell.type = 'button'
      const tier = span('ic-tier', '')
      const icon = span('ic-icon', '')
      const name = span('ic-name', '空')
      const meta = span('ic-meta', '')
      // 丢弃按钮：放在格子右上角，阻止冒泡避免触发「选中/合成」
      const discard = el('button', 'ic-discard')
      discard.type = 'button'
      discard.textContent = '×'
      discard.title = '丢弃'
      discard.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        this.onInvDiscard(index)
      })
      cell.append(tier, icon, name, meta, discard)
      cell.addEventListener('click', () => this.onInvCellClick(index))
      this.invGridEl.appendChild(cell)
      this.invCellRefs.push({ cell, tier, icon, name, meta, discard })
    }
  }

  private onInvCellClick(index: number): void {
    const item = this.invItems[index]
    if (!item) {
      this.invSelected = null
      this.renderInventory(this.invGold)
      return
    }
    if (item.kind === 'consumable') {
      this.handlers.onUseItem(item.uid)
      return
    }
    const selected = this.invSelected ? this.invItems.find((entry) => entry.uid === this.invSelected) : null
    if (selected && canMergeItems(selected, item)) {
      this.invSelected = null
      this.handlers.onMergeItem(selected.uid, item.uid)
      return
    }
    this.invSelected = item.uid === this.invSelected ? null : item.uid
    this.renderInventory(this.invGold)
  }

  /** 丢弃指定格子的物品（防误触：仅格子右上角 × 触发；随后重绘面板） */
  private onInvDiscard(index: number): void {
    const item = this.invItems[index]
    if (!item) return
    const now = performance.now()
    if (now - this.invDiscardMs < DISCARD_GUARD_MS) return
    this.invDiscardMs = now
    if (this.invSelected === item.uid) this.invSelected = null
    this.handlers.onDiscardItem?.(item.uid)
    // 回调通常已让 game 触发 updateInventory；这里兜底重绘，确保丢弃后立即从面板消失
    this.renderInventory(this.invGold)
  }

  private renderInventory(gold: number): void {
    this.invGold = Math.max(0, gold)
    setText(this.invGoldEl, fmtInt(this.invGold))
    setText(this.invCountEl, `${this.invItems.length} / ${this.invMaxSlots}`)
    setText(this.invHintEl, '点击两张同级同种的卡牌合成；消耗品点击即使用；点格子右上角 × 丢弃。')
    const full = this.invItems.length >= this.invMaxSlots
    this.invWarnEl.hidden = !full

    const selectedItem = this.invSelected
      ? this.invItems.find((item) => item.uid === this.invSelected) ?? null
      : null

    for (let i = 0; i < this.invCellRefs.length; i += 1) {
      const ref = this.invCellRefs[i]
      if (i >= this.invMaxSlots) {
        ref.cell.hidden = true
        continue
      }
      ref.cell.hidden = false
      const item = this.invItems[i]
      if (!item) {
        ref.cell.className = 'inv-cell is-empty'
        ref.discard.hidden = true
        setText(ref.tier, '')
        setArtIcon(ref.icon, null, '＋')
        setText(ref.name, '空')
        setText(ref.meta, '')
        continue
      }
      ref.cell.className = `inv-cell ${tierClass(item.tier)}`
      if (item.uid === this.invSelected) ref.cell.classList.add('is-selected')
      if (selectedItem && canMergeItems(selectedItem, item)) ref.cell.classList.add('is-mergeable')
      if (item.kind === 'consumable') ref.cell.classList.add('is-consumable')
      ref.discard.hidden = false
      ref.discard.setAttribute('aria-label', `丢弃 ${item.name}`)
      ref.discard.title = `丢弃 ${item.name}`
      setText(ref.tier, tierLabel(item.tier))
      setArtIcon(ref.icon, itemArtKey(item), item.icon || '✦')
      setText(ref.name, item.name)
      const bits: string[] = [SHOP_KIND_LABEL[item.kind] ?? '物品']
      if (item.stat && typeof item.value === 'number') {
        bits.push(`${STAT_LABEL[item.stat]} ${formatStatValue(item.stat, item.value)}`)
      } else if (typeof item.value === 'number' && item.kind === 'consumable') {
        bits.push(`${fmtDelta(item.value)}`)
      }
      setText(ref.meta, bits.join(' · '))
    }

    if (selectedItem) {
      setText(
        this.invHintEl,
        `已选中「${selectedItem.name}」：点击另一张同级同种的卡牌合成；点右上角 × 丢弃；再次点击取消选中。`,
      )
    }

    // 汇总五维
    const totals = new Map<CardStat, number>()
    for (const stat of STAT_ORDER) totals.set(stat, 0)
    for (const item of this.invItems) {
      if (!item.stat || typeof item.value !== 'number') continue
      totals.set(item.stat, (totals.get(item.stat) ?? 0) + item.value)
    }
    for (const stat of STAT_ORDER) {
      const valueEl = this.invStatValueEls.get(stat)
      if (!valueEl) continue
      const total = totals.get(stat) ?? 0
      setText(valueEl, total === 0 ? '0' : formatStatValue(stat, total))
      valueEl.classList.toggle('is-zero', total === 0)
    }
    this.syncArt()
  }

  /* ================================================================ */
  /* 暂停 / 存档                                                       */
  /* ================================================================ */

  private toggleMute(): void {
    const muted = !this.muted
    this.setMuted(muted)
    this.handlers.onToggleMute?.(muted)
  }

  private makeSlotRow(meta: SaveSlotMeta, variant: 'continue' | 'save' | 'load'): HTMLButtonElement {
    const row = el('button', 'slot-row')
    row.type = 'button'
    const no = span('slot-no', `S${meta.slot + 1}`)
    const main = div('slot-main')
    row.append(no, main)

    if (meta.empty) {
      row.classList.add('is-empty')
      main.appendChild(div('slot-title', '空槽位'))
      main.appendChild(div('slot-meta', variant === 'save' ? '点击保存当前进度' : '暂无存档'))
      if (variant === 'load') row.disabled = true
      row.append(span('slot-go', variant === 'save' ? '保存' : '空'))
      return row
    }

    const character = meta.character ? CHARACTERS[meta.character] : undefined
    const difficulty = meta.difficulty ? DIFFICULTIES[meta.difficulty] : undefined
    main.appendChild(div('slot-title', `${character?.name ?? '未知角色'} · ${difficulty?.name ?? '未知难度'}`))
    const bits: string[] = []
    if (meta.layer != null) bits.push(`第 ${meta.layer} 层`)
    if (meta.stage != null) bits.push(`阶段 ${meta.stage}`)
    if (meta.weaponLv != null) bits.push(`专武 Lv${meta.weaponLv}`)
    if (meta.gold != null) bits.push(`${fmtInt(meta.gold)} 金`)
    if (meta.playTime != null) bits.push(fmtTime(meta.playTime))
    main.appendChild(div('slot-meta', bits.join(' · ') || '存档记录'))
    row.append(span('slot-go', variant === 'continue' ? '继续' : variant === 'save' ? '覆盖' : '读取'))
    return row
  }

  private renderSlotList(): void {
    this.slotListEl.replaceChildren()
    const slots = this.lastSlots.length > 0 ? this.lastSlots : []
    const count = Math.max(slots.length, 3)
    for (let i = 0; i < count; i += 1) {
      const meta: SaveSlotMeta = slots[i] ?? { slot: i, empty: true }
      const row = this.makeSlotRow(meta, this.slotMode)
      row.addEventListener('click', () => {
        if (this.slotMode === 'save') {
          this.handlers.onSave(meta.slot)
          this.hideSaveSlots()
        } else if (!meta.empty) {
          this.handlers.onLoad(meta.slot)
          this.hideSaveSlots()
        }
      })
      this.slotListEl.appendChild(row)
    }
  }

  /* ================================================================ */
  /* 结算                                                              */
  /* ================================================================ */

  private restart(): void {
    if (this.endLocked || this.destroyed) return
    this.endLocked = true
    window.setTimeout(() => {
      this.endLocked = false
    }, PICK_DELAY_MS * 2)
    this.hideEnd()
    this.handlers.onRestart()
  }

  private renderEnd(stats: RunStatsV3, victory: boolean): void {
    this.endLocked = false
    this.endRetryEl.hidden = victory
    this.endEl.classList.toggle('is-victory', victory)
    setText(this.endKickerEl, victory ? 'VICTORY · 通关' : 'RUN OVER · 失败')

    if (victory) {
      setText(this.endTitleEl, '塔顶的黎明')
      setText(this.endSubEl, '你带着战利品走出了哥布林之塔。')
    } else {
      setText(this.endTitleEl, '生命耗尽')
      setText(this.endSubEl, '你倒在了塔中，哥布林的笑声在石壁间回荡。')
    }

    const character = CHARACTERS[stats.character]
    const difficulty = DIFFICULTIES[stats.difficulty]
    const values = [
      character?.name ?? '—',
      difficulty?.name ?? '—',
      `第 ${stats.layer} / ${stats.totalLayers} 层`,
      fmtInt(stats.kills),
      fmtInt(stats.gold),
      `Lv.${stats.weaponLv}`,
      `${stats.cardCount} 张`,
      fmtTime(stats.time),
    ]
    for (let i = 0; i < this.endStatValueEls.length; i += 1) {
      setText(this.endStatValueEls[i], values[i] ?? '—')
    }

    this.endEl.classList.add('is-open')
    this.refreshHud()
  }

  /* ================================================================ */
  /* Boss / 飘字 / 状态                                                */
  /* ================================================================ */

  /**
   * 把已登记的原画挂到界面上：标题主视觉 + 所有 data-art-key 图标。
   * 图片未就绪时保留 emoji / CSS 兜底，并按 ART_POLL_MS 轮询补齐。
   */
  private syncArt(): void {
    if (this.destroyed) return
    const keyart = artUrl('keyart_title')
    if (keyart) {
      if (this.titleKeyartEl.getAttribute('src') !== keyart) this.titleKeyartEl.src = keyart
      this.titleEl.classList.add('has-keyart')
    }

    let pending = false
    for (const node of this.shell.querySelectorAll<HTMLElement>('[data-art-key]')) {
      if (syncArtIcon(node)) pending = true
    }
    if (pending && !artReady()) this.scheduleArtPoll()
  }

  private scheduleArtPoll(): void {
    if (this.artPollTimer !== null || this.destroyed) return
    if (this.artPollTries >= ART_POLL_TRIES) return
    this.artPollTries += 1
    this.artPollTimer = window.setTimeout(() => {
      this.artPollTimer = null
      this.syncArt()
    }, ART_POLL_MS)
  }

  private updateBossFromSnapshot(snapshot: HudSnapshot): void {
    if (this.bossPinned) return
    const boss = snapshot.boss
    if (!boss || boss.maxHp <= 0 || boss.hp <= 0) {
      this.bossEl.hidden = true
      this.bossEl.classList.remove('is-open')
      this.bossRatio = -1
      return
    }
    this.bossEl.hidden = false
    this.bossEl.classList.add('is-open')
    setText(this.bossNameEl, boss.name)
    this.bossEl.dataset.maxHp = String(boss.maxHp)
    this.setBossRatio(boss.hp / boss.maxHp)
  }

  private setBossRatio(rawRatio: number): void {
    const ratio = clamp01(Number.isFinite(rawRatio) ? rawRatio : 0)
    if (Math.abs(ratio - this.bossRatio) < 0.0005) return
    this.bossRatio = ratio
    this.bossFillEl.style.transform = `scaleX(${ratio.toFixed(4)})`
    this.bossEl.classList.toggle('is-phase2', ratio <= BOSS_PHASE2_RATIO)
  }

  private acquireFloater(): Floater {
    for (let i = 0; i < this.floaters.length; i += 1) {
      const candidate = this.floaters[(this.floaterCursor + i) % this.floaters.length]
      if (!candidate.active) {
        this.floaterCursor = (this.floaterCursor + i + 1) % this.floaters.length
        return candidate
      }
    }
    const oldest = this.floaters[this.floaterCursor]
    this.floaterCursor = (this.floaterCursor + 1) % this.floaters.length
    return oldest
  }

  private formatDamage(amount: number, kind: DmgKind): string {
    const value = Number.isFinite(amount) ? amount : 0
    if (kind === 'gold') return `+${fmtInt(Math.abs(value))}`
    if (kind === 'heal') return `+${Math.round(Math.abs(value))}`
    return String(Math.round(value))
  }

  private renderFloater(floater: Floater): void {
    if (!floater.active) return
    const camera = this.cameraHolder.camera
    const node = floater.el
    if (!camera) {
      node.style.opacity = '0'
      return
    }
    const t = floater.age / floater.life
    if (t >= 1) {
      floater.active = false
      node.style.opacity = '0'
      return
    }
    this.scratchWorld.copy(floater.world)
    this.scratchProject.copy(this.scratchWorld).project(camera)
    if (this.scratchProject.z > 1) {
      node.style.opacity = '0'
      return
    }
    const rect = this.dmgLayerEl.getBoundingClientRect()
    const halfW = rect.width * 0.5
    const halfH = rect.height * 0.5
    const rise = floater.rise * Math.min(1, t * 1.35)
    node.style.left = `${(
      this.scratchProject.x * halfW +
      halfW +
      floater.offsetX +
      floater.drift * t
    ).toFixed(1)}px`
    node.style.top = `${(
      -this.scratchProject.y * halfH +
      halfH -
      rise +
      floater.offsetY
    ).toFixed(1)}px`

    let opacity = 1
    if (t > 0.65) opacity = Math.max(0, 1 - (t - 0.65) / 0.35)
    // 缩小后的数字不再做大幅弹跳，避免 4 位数在弹跳瞬间又叠在一起
    const pop = t < 0.16 ? 0.86 + (t / 0.16) * 0.18 : 1.04 - Math.min(0.04, (t - 0.16) * 0.15)
    node.style.opacity = opacity.toFixed(3)
    node.style.transform = `translate(-50%, -50%) scale(${pop.toFixed(3)})`
  }

  private updateFloaters(dt: number): void {
    if (this.floaters.length === 0) return
    for (const floater of this.floaters) {
      if (!floater.active) continue
      floater.age += dt
      this.renderFloater(floater)
    }
  }

  private refreshHud(): void {
    const titleOpen = this.titleEl.classList.contains('is-open')
    const endOpen = this.endEl.classList.contains('is-open')
    this.hudEl.hidden = titleOpen || endOpen
  }

  /* ================================================================ */
  /* 键盘                                                              */
  /* ================================================================ */

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (this.destroyed) return
    if (event.repeat) return

    if (this.slotsEl.classList.contains('is-open')) {
      if (event.code === 'Escape') {
        event.preventDefault()
        this.hideSaveSlots()
      }
      return
    }

    if (this.tunnelEl.classList.contains('is-open')) {
      const index = digitFromEvent(event) - 1
      if (index >= 0 && index < this.tunnelOffers.length) {
        event.preventDefault()
        this.selectTunnel(index)
      } else if (event.code === 'Enter' || event.code === 'KeyE' || event.code === 'Space') {
        event.preventDefault()
        this.commitTunnel()
      }
      return
    }

    if (this.invEl.classList.contains('is-open')) {
      // TAB / I 由 game.ts 统一处理开关，这里只保留 Esc 关闭，避免双重处理。
      if (event.code === 'Escape') {
        event.preventDefault()
        this.hideInventory()
        this.handlers.onCloseInventory()
      }
      return
    }

    if (this.endEl.classList.contains('is-open')) {
      if (event.code === 'KeyR') {
        event.preventDefault()
        this.restart()
      } else if (event.code === 'Enter') {
        event.preventDefault()
        this.hideEnd()
        this.handlers.onQuitToTitle()
      }
      return
    }

    if (this.titleEl.classList.contains('is-open')) {
      const index = digitFromEvent(event) - 1
      if (index >= 0 && index < this.diffCardEls.length) {
        const id = this.diffCardEls[index]?.dataset.diff
        if (id) {
          event.preventDefault()
          this.selectDifficulty(id as DifficultyId)
        }
        return
      }
      if (event.code === 'Enter' || event.code === 'Space') {
        event.preventDefault()
        this.startGame()
      }
      return
    }

    if (this.pauseEl.classList.contains('is-open')) {
      if (event.code === 'Escape' || event.code === 'KeyP') {
        event.preventDefault()
        this.hidePause()
        this.handlers.onPauseToggle()
      }
    }
  }
}

/**
 * 创建 v3 HUD。整个 UI 只挂载一次，之后通过 class 切换界面。
 */
export function createHud(handlers: HudV3Handlers): HudV3 {
  return new HudImpl(handlers)
}
