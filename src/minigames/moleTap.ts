/**
 * 探索类 · 小游戏「哥布林打点」（全地图通用，打地鼠）。
 *
 * 玩法：3×3 洞口随机冒出哥布林，鼠标点击敲中得分；共 30 只，
 * 冒头间隔与停留时间逐渐加快（950ms → 380ms）。ESC 随时退出。
 * 结算：result.score = 敲中数；win = 坚持打完全部 30 只（中途 ESC 视为放弃）。
 * 奖励分层由调用方按 score 决定：<15 初等 / 15~29 中等 / 30 高等。
 */
import type { MiniGame, MiniGameContext, MiniGameResult } from './shared'
import { BOARD_H, BOARD_W, createMiniGameShell, PIXEL_SCALE, resolvePalette, type MiniGameShell } from './shared'

const TOTAL_MOLES = 30

class MoleTapMiniGame implements MiniGame {
  id = 'mole-tap'
  title = '哥布林打点'
  private shell: MiniGameShell | null = null
  private resolveFn: ((r: MiniGameResult) => void) | null = null
  private settled = false
  private rafId = 0
  private lastMs = 0
  private pal = resolvePalette(1)
  /** 每个洞的状态：>0 表示该洞有哥布林剩余停留时间（秒） */
  private holes = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  private currentHole = -1
  private spawnTimer = 0
  private spawned = 0
  private hits = 0
  private whackFlash: { hole: number; age: number } | null = null

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.settled = false
    this.resolveFn = null
    this.holes = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    this.currentHole = -1
    this.spawnTimer = 0.6
    this.spawned = 0
    this.hits = 0
    this.whackFlash = null
    this.pal = resolvePalette(1)

    this.shell = createMiniGameShell(root, {
      palette: this.pal,
      title: this.title,
      lore: '通风管的洞口里钻出哥布林，点它！30 只打完结算，打得越多奖得越多。',
      hint: '鼠标点击冒头的哥布林 · ESC 退出',
      onAbort: () => this.settle({ win: false, score: this.hits }),
    })
    this.shell?.setStatus(`0 / ${TOTAL_MOLES} · 点击冒头的哥布林`, this.pal.muted)

    this.lastMs = performance.now()
    const draw = (ms: number): void => {
      if (!this.shell || this.settled) return
      const dt = Math.min(0.05, Math.max(0.001, (ms - this.lastMs) / 1000))
      this.lastMs = ms
      this.tick(dt)
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
    if (!this.settled && resolve) resolve({ win: false, score: this.hits })
    this.teardown()
  }

  /** 点击命中判定：把屏幕点击换算回 120×72 逻辑坐标 */
  handleCanvasClick(clientX: number, clientY: number): void {
    const shell = this.shell
    if (!shell || this.settled || this.currentHole < 0) return
    const rect = shell.canvas.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return
    const lx = ((clientX - rect.left) / rect.width) * BOARD_W
    const ly = ((clientY - rect.top) / rect.height) * BOARD_H
    const col = Math.floor((lx - 15) / 32)
    const row = Math.floor((ly - 18) / 19)
    const hole = row * 3 + col
    if (hole < 0 || hole > 8 || hole !== this.currentHole) return
    this.hits += 1
    this.holes[this.currentHole] = 0
    this.whackFlash = { hole, age: 0 }
    this.currentHole = -1
    this.shell.setStatus(`${this.hits} / ${TOTAL_MOLES}`, this.pal.good)
  }

  private tick(dt: number): void {
    if (this.whackFlash) {
      this.whackFlash.age += dt
      if (this.whackFlash.age > 0.18) this.whackFlash = null
    }
    for (let i = 0; i < 9; i += 1) {
      if (this.holes[i] > 0) {
        this.holes[i] -= dt
        if (this.holes[i] <= 0 && i === this.currentHole) this.currentHole = -1
      }
    }
    if (this.currentHole < 0) {
      this.spawnTimer -= dt
      if (this.spawnTimer <= 0 && this.spawned < TOTAL_MOLES) {
        // 30 只逐渐加快：冒头间隔 950ms → 380ms，停留 820ms → 340ms
        const k = this.spawned / (TOTAL_MOLES - 1)
        const hole = Math.floor(Math.random() * 9)
        this.holes[hole] = 0.82 - k * 0.48
        this.currentHole = hole
        this.spawned += 1
        this.spawnTimer = 0.95 - k * 0.57
      }
    }
    if (this.spawned >= TOTAL_MOLES && this.currentHole < 0) {
      this.settle({ win: true, score: this.hits })
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
    for (let i = 0; i < 9; i += 1) {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = 15 + col * 32
      const y = 18 + row * 19
      // 洞口
      ctx2d.fillStyle = palette.panel
      ctx2d.fillRect(x + 2, y + 8, 26, 9)
      ctx2d.fillStyle = palette.muted
      ctx2d.fillRect(x + 2, y + 8, 26, 1)
      // 哥布林：冒头时画头 + 耳朵
      if (this.holes[i] > 0) {
        ctx2d.fillStyle = '#6fbf73'
        ctx2d.fillRect(x + 7, y + 2, 16, 10)
        ctx2d.fillStyle = '#4e9457'
        ctx2d.fillRect(x + 5, y + 4, 3, 5)
        ctx2d.fillRect(x + 22, y + 4, 3, 5)
        ctx2d.fillStyle = '#ff5a5a'
        ctx2d.fillRect(x + 11, y + 5, 3, 3)
        ctx2d.fillRect(x + 17, y + 5, 3, 3)
      }
      // 命中闪光：黄星
      if (this.whackFlash?.hole === i) {
        ctx2d.fillStyle = palette.accent
        ctx2d.fillRect(x + 12, y, 4, 4)
        ctx2d.fillRect(x + 6, y + 6, 3, 3)
        ctx2d.fillRect(x + 21, y + 6, 3, 3)
      }
    }
    // 进度条
    ctx2d.fillStyle = palette.muted
    ctx2d.fillRect(10, 66, BOARD_W - 20, 3)
    ctx2d.fillStyle = palette.accent
    ctx2d.fillRect(10, 66, ((BOARD_W - 20) * this.spawned) / TOTAL_MOLES, 3)
    ctx2d.restore()
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
    this.shell?.destroy()
    this.shell = null
  }
}

export const moleTapMiniGame: MiniGame = new MoleTapMiniGame()
