/**
 * 探索类 · 小游戏「落点校准」（全地图通用）。
 *
 * 玩法：横条上的标记左右往返移动，按 空格 / 点击按钮 停住；
 * 停在目标区内算命中，连续 3 轮命中即胜利；总失误 2 次则失败。
 * 目标区宽度逐轮收窄，层数越高越窄；ESC 随时退出（resolve { win:false }）。
 *
 * 与风车校准的差异：风车是旋转对准，本作是线性往返的时机把握，
 * 两者可以出现在同一张地图，避免玩家在每个阶段都只玩同一种。
 */
import type { MiniGame, MiniGameContext, MiniGameResult } from './shared'
import { BOARD_H, BOARD_W, createMiniGameShell, PIXEL_SCALE, resolvePalette, type MiniGameShell } from './shared'

const TOTAL_ROUNDS = 3
const MISS_LIMIT = 2

class TowerDropMiniGame implements MiniGame {
  id = 'tower-drop'
  title = '落点校准'
  private shell: MiniGameShell | null = null
  private resolveFn: ((r: MiniGameResult) => void) | null = null
  private settled = false
  private rafId = 0
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private lastMs = 0
  private marker = 0
  private markerDir = 1
  private markerSpeed = 46
  private round = 0
  private misses = 0
  private zoneCenter = 0.5
  private zoneHalf = 0.16
  private lastRoundResult: 'hit' | 'miss' | null = null
  private pal = resolvePalette(1)

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.settled = false
    this.resolveFn = null
    this.round = 0
    this.misses = 0
    this.marker = 0.12
    this.markerDir = 1
    this.lastRoundResult = null
    // 高层更快、更窄：39 层封顶，防反人类
    const layerFactor = Math.min(1, Math.max(0, (ctx.layer - 1) / 38))
    this.markerSpeed = 40 + layerFactor * 34
    this.zoneHalf = Math.max(0.085, 0.17 - layerFactor * 0.055)
    this.zoneCenter = 0.2 + (ctx.rng() ?? Math.random()) * 0.6

    const palette = this.pal
    this.shell = createMiniGameShell(root, {
      palette,
      title: this.title,
      lore: '升降平台正在失控摆动。在合适的时机按下，让浮标停进光带。',
      hint: '空格 / 点击按钮 → 停住浮标；落在光带内算命中 · ESC 退出',
      onAbort: () => this.settle({ win: false }),
    })
    this.shell.setStatus(`第 1 / ${TOTAL_ROUNDS} 轮 · 失误 ${this.misses}/${MISS_LIMIT}`, palette.muted)
    

    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        this.tryLock()
      }
    }
    this.keyHandler = onKey
    window.addEventListener('keydown', onKey, true)
    const actionBtn = document.createElement('button')
    actionBtn.type = 'button'
    actionBtn.textContent = '停住浮标（空格）'
    actionBtn.addEventListener('click', () => this.tryLock())
    this.shell.controlsEl.appendChild(actionBtn)

    this.lastMs = performance.now()
    const draw = (ms: number): void => {
      if (!this.shell || this.settled) return
      const dt = Math.min(0.05, Math.max(0.001, (ms - this.lastMs) / 1000))
      this.lastMs = ms
      this.marker += this.markerDir * this.markerSpeed * dt
      if (this.marker >= 1) {
        this.marker = 1
        this.markerDir = -1
      } else if (this.marker <= 0) {
        this.marker = 0
        this.markerDir = 1
      }
      this.render()
      this.rafId = window.requestAnimationFrame(draw)
    }
    this.rafId = window.requestAnimationFrame(draw)

    return new Promise<MiniGameResult>((resolve) => {
      this.resolveFn = resolve
    })
  }

  unmount(): void {
    const resolve = this.resolveFn
    if (!this.settled && resolve) resolve({ win: false })
    this.teardown()
  }

  private settle(result: MiniGameResult): void {
    if (this.settled) return
    this.settled = true
    const resolve = this.resolveFn
    this.teardown()
    resolve?.(result)
  }

  private teardown(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true)
      this.keyHandler = null
    }
    this.shell?.destroy()
    this.shell = null
  }

  private tryLock(): void {
    if (!this.shell || this.settled) return
    const dist = Math.abs(this.marker - this.zoneCenter)
    const hit = dist <= this.zoneHalf
    if (hit) {
      this.round += 1
      this.lastRoundResult = 'hit'
      this.zoneHalf = Math.max(0.06, this.zoneHalf * 0.8)
      this.zoneCenter = 0.15 + Math.random() * 0.7
      this.shell.setStatus(
        this.round >= TOTAL_ROUNDS ? '校准完成！' : `命中！第 ${this.round + 1} / ${TOTAL_ROUNDS} 轮`,
        this.pal.good,
      )
      if (this.round >= TOTAL_ROUNDS) this.settle({ win: true, score: this.round })
    } else {
      this.misses += 1
      this.lastRoundResult = 'miss'
      this.shell.setStatus(`未命中 · 失误 ${this.misses}/${MISS_LIMIT}`, this.pal.bad)
      if (this.misses >= MISS_LIMIT) this.settle({ win: false, score: this.round })
    }
  }

  private render(): void {
    const shell = this.shell
    if (!shell) return
    const { ctx2d } = shell
    const palette = this.pal
    ctx2d.save()
    ctx2d.scale(PIXEL_SCALE, PIXEL_SCALE)
    ctx2d.fillStyle = palette.bg
    ctx2d.fillRect(0, 0, BOARD_W, BOARD_H)
    // 轨道
    const trackY = 40
    ctx2d.fillStyle = palette.panel
    ctx2d.fillRect(6, trackY, BOARD_W - 12, 8)
    // 目标区
    const zx = 6 + (BOARD_W - 12) * (this.zoneCenter - this.zoneHalf)
    const zw = (BOARD_W - 12) * this.zoneHalf * 2
    ctx2d.fillStyle = this.lastRoundResult === 'miss' ? palette.bad : palette.good
    ctx2d.globalAlpha = 0.85
    ctx2d.fillRect(zx, trackY - 3, zw, 14)
    ctx2d.globalAlpha = 1
    // 刻度
    ctx2d.fillStyle = palette.muted
    for (let i = 1; i < 10; i += 1) {
      ctx2d.fillRect(6 + ((BOARD_W - 12) * i) / 10, trackY + 9, 1, 3)
    }
    // 浮标
    const mx = 6 + (BOARD_W - 12) * this.marker
    ctx2d.fillStyle = palette.accent
    ctx2d.fillRect(mx - 2, trackY - 8, 4, 24)
    // 轮次点
    for (let i = 0; i < TOTAL_ROUNDS; i += 1) {
      ctx2d.fillStyle = i < this.round ? palette.good : palette.muted
      ctx2d.fillRect(BOARD_W / 2 - 9 + i * 7, 14, 5, 5)
    }
    ctx2d.restore()
  }
}

export const towerDropMiniGame: MiniGame = new TowerDropMiniGame()
