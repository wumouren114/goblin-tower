/**
 * 探索类 · 小游戏「回声记忆」（全地图通用）。
 *
 * 玩法：
 * - 屏幕在 120×72 像素画布上依次闪现 3~5 个符文符号（每个 0.5s）；
 * - 玩家按相同顺序点击符号（支持点画布、点下方按钮或按 1~4 键）；
 * - 3 轮递进，全对 resolve { win: true }；
 * - 点错允许重试 1 次（重播本轮序列），第 2 次失误则 resolve { win: false }；
 * - 单局限时 25 秒，超时或按 ESC 放弃均 resolve { win: false }。
 */
import type { MiniGame, MiniGameContext, MiniGameResult } from './shared'
import { BOARD_H, BOARD_W, createMiniGameShell, resolvePalette, type MiniGamePalette, type MiniGameShell } from './shared'

export const ECHO_TOTAL_ROUNDS = 3
export const ECHO_FLASH_SEC = 0.5
export const ECHO_GAP_SEC = 0.14
export const ECHO_TIME_LIMIT_SEC = 25
export const ECHO_RETRY_LIMIT = 1

export interface EchoSymbolDef {
  id: number
  key: 'moon' | 'star' | 'bell' | 'leaf'
  label: string
  glyph: string
  color: string
}

export const ECHO_SYMBOLS: readonly EchoSymbolDef[] = [
  { id: 0, key: 'moon', label: '月纹', glyph: '☾', color: '#8ad8ff' },
  { id: 1, key: 'star', label: '星芒', glyph: '✦', color: '#ffe07d' },
  { id: 2, key: 'bell', label: '铜铃', glyph: '❖', color: '#ff9eb8' },
  { id: 3, key: 'leaf', label: '花叶', glyph: '❀', color: '#8cf0b4' },
]

/**
 * 计算指定层数、押注与轮次（0..2）对应的符号序列长度，严格控制在 3~5 之间：
 * - 低层（≤6 且低押注）：3 → 4 → 4
 * - 中层（7..14 或中等押注）：3 → 4 → 5
 * - 高层（≥15 或高押注）：4 → 4 → 5
 */
export function sequenceLengthFor(layer: number, stake: number, roundIndex: number): number {
  const r = Math.max(0, Math.min(ECHO_TOTAL_ROUNDS - 1, Math.floor(roundIndex)))
  const safeLayer = Math.max(1, Math.floor(layer))
  const highStake = stake >= 120 ? 1 : 0
  const tier = safeLayer >= 15 ? 2 : safeLayer >= 7 || highStake > 0 ? 1 : 0
  const table: readonly (readonly [number, number, number])[] = [
    [3, 4, 4],
    [3, 4, 5],
    [4, 4, 5],
  ]
  return Math.max(3, Math.min(5, table[tier][r]))
}

export type EchoPhase = 'show' | 'input' | 'done'

export interface EchoSession {
  readonly round: number
  readonly totalRounds: number
  readonly retriesLeft: number
  readonly elapsed: number
  readonly timeLimit: number
  readonly phase: EchoPhase
  readonly sequence: readonly number[]
  readonly inputIndex: number
  readonly activeSymbol: number
  readonly lastFeedback: 'none' | 'ok' | 'retry' | 'fail'
  readonly result: MiniGameResult | null
  tick(dt: number): MiniGameResult | null
  submit(symbolId: number): MiniGameResult | null
  abort(): MiniGameResult
}

/** 生成不连续重复过多的符号序列，提升记忆可读性 */
function rollSequence(len: number, rng: () => number): number[] {
  const seq: number[] = []
  for (let i = 0; i < len; i += 1) {
    let pick = Math.floor(Math.max(0, Math.min(0.999999, rng())) * ECHO_SYMBOLS.length)
    if (i >= 2 && seq[i - 1] === pick && seq[i - 2] === pick) {
      pick = (pick + 1) % ECHO_SYMBOLS.length
    }
    seq.push(pick)
  }
  return seq
}

/** 纯状态机：供 UI 驱动与无头冒烟测试共享 */
export function createEchoSession(ctx: MiniGameContext): EchoSession {
  const rng = ctx.rng ?? Math.random
  let round = 0
  let retriesLeft = ECHO_RETRY_LIMIT
  let elapsed = 0
  let phase: EchoPhase = 'show'
  let sequence: number[] = rollSequence(sequenceLengthFor(ctx.layer, ctx.stake, 0), rng)
  let inputIndex = 0
  let showIndex = 0
  let showTimer = ECHO_FLASH_SEC
  let inGap = false
  let lastFeedback: 'none' | 'ok' | 'retry' | 'fail' = 'none'
  let result: MiniGameResult | null = null

  const startPlayback = (): void => {
    phase = 'show'
    inputIndex = 0
    showIndex = 0
    showTimer = ECHO_FLASH_SEC
    inGap = false
  }

  const finish = (res: MiniGameResult): MiniGameResult => {
    if (!result) {
      result = res
      phase = 'done'
    }
    return result
  }

  return {
    get round() {
      return round
    },
    get totalRounds() {
      return ECHO_TOTAL_ROUNDS
    },
    get retriesLeft() {
      return retriesLeft
    },
    get elapsed() {
      return elapsed
    },
    get timeLimit() {
      return ECHO_TIME_LIMIT_SEC
    },
    get phase() {
      return phase
    },
    get sequence() {
      return sequence
    },
    get inputIndex() {
      return inputIndex
    },
    get activeSymbol() {
      if (phase !== 'show' || inGap) return -1
      return sequence[showIndex] ?? -1
    },
    get lastFeedback() {
      return lastFeedback
    },
    get result() {
      return result
    },
    tick(dt: number): MiniGameResult | null {
      if (result) return result
      const step = Math.max(0, dt)
      elapsed += step
      if (elapsed >= ECHO_TIME_LIMIT_SEC) {
        lastFeedback = 'fail'
        return finish({ win: false, score: round })
      }
      if (phase === 'show') {
        showTimer -= step
        while (showTimer <= 1e-9 && phase === 'show') {
          if (!inGap) {
            inGap = true
            showTimer += ECHO_GAP_SEC
          } else {
            inGap = false
            showIndex += 1
            if (showIndex >= sequence.length) {
              phase = 'input'
              showTimer = 0
            } else {
              showTimer += ECHO_FLASH_SEC
            }
          }
        }
      }
      return null
    },
    submit(symbolId: number): MiniGameResult | null {
      if (result || phase !== 'input') return result
      const expected = sequence[inputIndex]
      if (symbolId === expected) {
        inputIndex += 1
        lastFeedback = 'ok'
        if (inputIndex >= sequence.length) {
          round += 1
          if (round >= ECHO_TOTAL_ROUNDS) {
            return finish({ win: true, score: ECHO_TOTAL_ROUNDS })
          }
          sequence = rollSequence(sequenceLengthFor(ctx.layer, ctx.stake, round), rng)
          startPlayback()
        }
        return null
      }
      if (retriesLeft > 0) {
        retriesLeft -= 1
        lastFeedback = 'retry'
        startPlayback()
        return null
      }
      lastFeedback = 'fail'
      return finish({ win: false, score: round })
    },
    abort(): MiniGameResult {
      lastFeedback = 'fail'
      return finish({ win: false, score: round })
    },
  }
}

/** 在 120×72 像素画布上绘制单个符文像素图标（中心 cx, cy） */
function drawPixelGlyph(ctx2d: CanvasRenderingContext2D, key: EchoSymbolDef['key'], cx: number, cy: number, color: string): void {
  ctx2d.fillStyle = color
  const x = Math.round(cx)
  const y = Math.round(cy)
  if (key === 'moon') {
    ctx2d.fillRect(x - 3, y - 4, 4, 2)
    ctx2d.fillRect(x - 5, y - 2, 3, 4)
    ctx2d.fillRect(x - 3, y + 2, 4, 2)
    ctx2d.fillRect(x + 1, y - 3, 2, 2)
    ctx2d.fillRect(x + 1, y + 1, 2, 2)
  } else if (key === 'star') {
    ctx2d.fillRect(x - 1, y - 5, 2, 10)
    ctx2d.fillRect(x - 5, y - 1, 10, 2)
    ctx2d.fillRect(x - 3, y - 3, 6, 6)
  } else if (key === 'bell') {
    ctx2d.fillRect(x - 2, y - 5, 4, 2)
    ctx2d.fillRect(x - 4, y - 3, 8, 5)
    ctx2d.fillRect(x - 5, y + 2, 10, 2)
    ctx2d.fillRect(x - 1, y + 4, 2, 2)
  } else {
    ctx2d.fillRect(x - 1, y - 5, 2, 3)
    ctx2d.fillRect(x - 1, y + 2, 2, 3)
    ctx2d.fillRect(x - 5, y - 1, 3, 2)
    ctx2d.fillRect(x + 2, y - 1, 3, 2)
    ctx2d.fillRect(x - 2, y - 2, 4, 4)
  }
}

const SLOT_RECTS = [
  { x: 10, y: 26, w: 22, h: 28 },
  { x: 36, y: 26, w: 22, h: 28 },
  { x: 62, y: 26, w: 22, h: 28 },
  { x: 88, y: 26, w: 22, h: 28 },
] as const

class EchoMemoryMiniGame implements MiniGame {
  id = 'echo-memory'
  title = '回声记忆'
  private shell: MiniGameShell | null = null
  private session: EchoSession | null = null
  private resolveFn: ((r: MiniGameResult) => void) | null = null
  private settled = false
  private rafId = 0
  private lastMs = 0
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private canvasClickHandler: ((e: MouseEvent) => void) | null = null
  private flashId = -1
  private flashUntilMs = 0
  private palette: MiniGamePalette = resolvePalette(1)

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.settled = false
    this.resolveFn = null
    this.flashId = -1
    this.flashUntilMs = 0
    const stageFallback = (ctx.layer >= 13 ? 3 : ctx.layer >= 7 ? 2 : 1) as 1 | 2 | 3
    this.palette = resolvePalette(stageFallback)
    const palette = this.palette
    const session = createEchoSession(ctx)
    this.session = session

    this.shell = createMiniGameShell(root, {
      palette,
      title: this.title,
      lore: '塔壁浮现出转瞬即逝的旧日回声。记住符号闪现的顺序，按原样复现 3 轮。',
      hint: '点击画布或下方符号（或按 1~4 键）按顺序复现 · 容错 1 次 · ESC 放弃',
      onAbort: () => this.settle(session.abort()),
    })

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.settle(session.abort())
        return
      }
      if (e.key >= '1' && e.key <= '4') {
        e.preventDefault()
        e.stopPropagation()
        this.handlePick(Number(e.key) - 1)
      }
    }
    this.keyHandler = onKey
    window.addEventListener('keydown', onKey, true)

    const onCanvasClick = (e: MouseEvent): void => {
      const canvas = this.shell?.canvas
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const lx = ((e.clientX - rect.left) / rect.width) * BOARD_W
      const ly = ((e.clientY - rect.top) / rect.height) * BOARD_H
      for (let i = 0; i < SLOT_RECTS.length; i += 1) {
        const s = SLOT_RECTS[i]
        if (lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h) {
          this.handlePick(i)
          return
        }
      }
    }
    this.canvasClickHandler = onCanvasClick
    this.shell.canvas.addEventListener('click', onCanvasClick)

    for (const sym of ECHO_SYMBOLS) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = `${sym.id + 1}. ${sym.glyph} ${sym.label}`
      btn.style.cssText = [
        'cursor:pointer',
        `background:${palette.bg}`,
        `color:${sym.color}`,
        `border:3px solid ${palette.border}`,
        'padding:5px 10px',
        'font-size:12px',
        'font-weight:700',
      ].join(';')
      btn.addEventListener('click', () => this.handlePick(sym.id))
      this.shell.controlsEl.appendChild(btn)
    }

    this.syncStatus()
    this.lastMs = performance.now()
    const loop = (ms: number): void => {
      if (!this.shell || !this.session || this.settled) return
      const dt = Math.min(0.05, Math.max(0.001, (ms - this.lastMs) / 1000))
      this.lastMs = ms
      const res = this.session.tick(dt)
      this.syncStatus()
      this.render(ms)
      if (res) {
        this.settle(res)
        return
      }
      this.rafId = window.requestAnimationFrame(loop)
    }
    this.rafId = window.requestAnimationFrame(loop)

    return new Promise<MiniGameResult>((resolve) => {
      this.resolveFn = resolve
    })
  }

  unmount(): void {
    const resolve = this.resolveFn
    const res = this.session ? this.session.abort() : { win: false }
    if (!this.settled && resolve) {
      this.settled = true
      this.teardown()
      resolve(res)
      return
    }
    this.teardown()
  }

  private handlePick(symbolId: number): void {
    if (!this.session || this.settled) return
    if (this.session.phase !== 'input') return
    this.flashId = symbolId
    this.flashUntilMs = performance.now() + 220
    const res = this.session.submit(symbolId)
    this.syncStatus()
    if (res) this.settle(res)
  }

  private syncStatus(): void {
    if (!this.shell || !this.session) return
    const s = this.session
    const left = Math.max(0, Math.ceil(s.timeLimit - s.elapsed))
    const rText = `第 ${Math.min(s.round + 1, s.totalRounds)}/${s.totalRounds} 轮`
    if (s.phase === 'show') {
      const prefix = s.lastFeedback === 'retry' ? '点错了，已触发重播（剩余 0 次重试）· ' : '记住闪现顺序 · '
      this.shell.setStatus(`${prefix}${rText}（共 ${s.sequence.length} 个）· 剩余 ${left}s`, s.lastFeedback === 'retry' ? this.palette.warn : this.palette.accent)
    } else if (s.phase === 'input') {
      this.shell.setStatus(
        `请按顺序点击（${s.inputIndex}/${s.sequence.length}）· ${rText} · 容错 ${s.retriesLeft} · 剩余 ${left}s`,
        this.palette.good,
      )
    }
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
    if (this.canvasClickHandler && this.shell) {
      this.shell.canvas.removeEventListener('click', this.canvasClickHandler)
      this.canvasClickHandler = null
    }
    this.shell?.destroy()
    this.shell = null
    this.session = null
  }

  private render(nowMs: number): void {
    const shell = this.shell
    const s = this.session
    if (!shell || !s) return
    const { ctx2d } = shell
    const pal = this.palette

    ctx2d.fillStyle = pal.bg
    ctx2d.fillRect(0, 0, BOARD_W, BOARD_H)

    // 顶部计时条
    const ratio = Math.max(0, 1 - s.elapsed / s.timeLimit)
    ctx2d.fillStyle = pal.panel
    ctx2d.fillRect(8, 6, BOARD_W - 16, 4)
    ctx2d.fillStyle = ratio > 0.3 ? pal.accent : pal.bad
    ctx2d.fillRect(8, 6, Math.round((BOARD_W - 16) * ratio), 4)

    // 轮次点（3 轮）
    for (let i = 0; i < s.totalRounds; i += 1) {
      ctx2d.fillStyle = i < s.round ? pal.good : i === s.round ? pal.accent : pal.muted
      ctx2d.fillRect(Math.round(BOARD_W / 2) - 11 + i * 9, 14, 5, 5)
    }

    // 4 个符文槽位
    const litId = s.phase === 'show' ? s.activeSymbol : nowMs < this.flashUntilMs ? this.flashId : -1
    for (let i = 0; i < ECHO_SYMBOLS.length; i += 1) {
      const sym = ECHO_SYMBOLS[i]
      const slot = SLOT_RECTS[i]
      const lit = litId === i
      ctx2d.fillStyle = lit ? sym.color : pal.panel
      ctx2d.fillRect(slot.x, slot.y, slot.w, slot.h)
      ctx2d.strokeStyle = lit ? '#ffffff' : pal.border
      ctx2d.lineWidth = 1
      ctx2d.strokeRect(slot.x + 0.5, slot.y + 0.5, slot.w - 1, slot.h - 1)
      drawPixelGlyph(ctx2d, sym.key, slot.x + slot.w / 2, slot.y + slot.h / 2, lit ? pal.bg : sym.color)
    }

    // 底部序列进度点
    const total = s.sequence.length
    const startX = Math.round(BOARD_W / 2 - (total * 7 - 3) / 2)
    for (let i = 0; i < total; i += 1) {
      ctx2d.fillStyle = s.phase === 'input' && i < s.inputIndex ? pal.good : pal.muted
      ctx2d.fillRect(startX + i * 7, 61, 4, 4)
    }
  }
}

export const echoMemoryMiniGame: MiniGame = new EchoMemoryMiniGame()
