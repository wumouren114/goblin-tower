/**
 * 黄铜钟塔 · 「齿轮啮合」
 *
 * 两个 8 齿黄铜齿轮，玩家用上下方向键（或 W/S）微调右侧齿轮的齿角，
 * 按空格确认；与左侧基准齿轮啮合误差 <5° 即通关，30 秒倒计时，失败无惩罚。
 */
import {
  BOARD_H,
  BOARD_W,
  createMiniGameShell,
  makePixelButton,
  pxCircle,
  pxLine,
  pxRect,
  resolvePalette,
  type MiniGame,
  type MiniGameContext,
  type MiniGameResult,
  type MiniGameShell,
} from './shared'

const TEETH = 8
const PITCH_DEG = 360 / TEETH // 45°
const TOLERANCE_DEG = 5
const TIME_LIMIT_S = 30

/**
 * 计算两齿轮在啮合点的齿角误差 [0, PITCH_DEG / 2]：
 * 左侧基准轮齿角在 0°（正右方）处为齿尖，右侧齿轮在 180°（正左方）处需落入齿谷，
 * 即右侧轮相位与 (leftAngle + PITCH_DEG / 2) 同余 mod PITCH_DEG 时完全啮合。
 */
function meshErrorDeg(leftAngle: number, rightAngle: number): number {
  const ideal = leftAngle + PITCH_DEG / 2
  const diff = (((rightAngle - ideal) % PITCH_DEG) + PITCH_DEG) % PITCH_DEG
  return Math.min(diff, PITCH_DEG - diff)
}

class GearsMiniGame implements MiniGame {
  readonly id = 'gears'
  readonly title = '齿轮啮合'

  private shell: MiniGameShell | null = null
  private rafId = 0
  private finishTimer = 0
  private keyDownHandler: ((e: KeyboardEvent) => void) | null = null
  private keyUpHandler: ((e: KeyboardEvent) => void) | null = null
  private resolveFn: ((res: MiniGameResult) => void) | null = null
  private settled = false

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.unmount()
    this.settled = false

    const palette = resolvePalette(3)

    return new Promise<MiniGameResult>((resolve) => {
      this.resolveFn = resolve

      const leftAngle = Math.round(ctx.rng() * PITCH_DEG)
      // 初始有意错开 12°~22°，避免开局即啮合
      const initOffset = 12 + ctx.rng() * 10
      let rightAngle = leftAngle + PITCH_DEG / 2 + (ctx.rng() < 0.5 ? initOffset : -initOffset)
      let timeLeft = TIME_LIMIT_S
      let heldDir = 0 // -1 逆时针 / +1 顺时针
      let clankUntil = 0
      let meshedSpin = false
      let lastTs = performance.now()

      const finish = (res: MiniGameResult, delayMs = 0) => {
        if (this.settled) return
        this.settled = true
        if (delayMs > 0) {
          this.finishTimer = window.setTimeout(() => {
            this.cleanup()
            resolve(res)
          }, delayMs)
        } else {
          this.cleanup()
          resolve(res)
        }
      }

      const shell = createMiniGameShell(root, {
        palette,
        title: this.title,
        lore: '黄铜钟塔的齿环卡在了半格之外。塔在称量你的手感——微调右侧齿轮与主轮严丝咬合，它便松开一点库藏；超时也无妨，钟塔不会留难。',
        hint: '按 ↑ / ↓（或 W / S）微调右侧齿角，按 空格 确认啮合（误差 <5°，30 秒限时）· ESC 退出',
        onAbort: () => finish({ win: false }),
      })
      this.shell = shell

      const confirmMesh = () => {
        if (this.settled) return
        const err = meshErrorDeg(leftAngle, rightAngle)
        if (err < TOLERANCE_DEG) {
          meshedSpin = true
          const score = Math.max(20, Math.round(60 + timeLeft * 1.2 + (TOLERANCE_DEG - err) * 4))
          shell.setStatus(
            `齿轮清脆咬合（误差 ${err.toFixed(1)}°）！钟塔松开了一格库藏。`,
            palette.good,
          )
          finish({ win: true, score }, 850)
        } else {
          clankUntil = performance.now() + 450
          shell.setStatus(
            `齿尖尚未对齐（当前偏差 ${err.toFixed(1)}°，需 <5°），请继续微调`,
            palette.warn,
          )
        }
      }

      const nudge = (deg: number) => {
        if (this.settled) return
        rightAngle = (rightAngle + deg + 360) % 360
      }

      shell.controlsEl.append(
        makePixelButton('↑ 顺调', palette, () => nudge(1.5)),
        makePixelButton('↓ 逆调', palette, () => nudge(-1.5)),
        makePixelButton('空格 确认啮合', palette, confirmMesh, true),
      )

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish({ win: false })
          return
        }
        if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
          e.preventDefault()
          e.stopPropagation()
          if (!e.repeat) nudge(1.2)
          heldDir = 1
        } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
          e.preventDefault()
          e.stopPropagation()
          if (!e.repeat) nudge(-1.2)
          heldDir = -1
        } else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          confirmMesh()
        }
      }
      const onKeyUp = (e: KeyboardEvent) => {
        if (
          (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') &&
          heldDir === 1
        ) {
          heldDir = 0
        } else if (
          (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') &&
          heldDir === -1
        ) {
          heldDir = 0
        }
      }
      this.keyDownHandler = onKeyDown
      this.keyUpHandler = onKeyUp
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('keyup', onKeyUp, true)

      const drawGear = (
        g: CanvasRenderingContext2D,
        cx: number,
        cy: number,
        baseR: number,
        angleDeg: number,
        bodyColor: string,
        rimColor: string,
      ) => {
        // 轮盘本体
        pxCircle(g, cx, cy, baseR, bodyColor, true)
        pxCircle(g, cx, cy, baseR, rimColor, false)
        pxCircle(g, cx, cy, 5, palette.bg, true)
        pxCircle(g, cx, cy, 5, rimColor, false)

        // 8 个方齿
        for (let i = 0; i < TEETH; i += 1) {
          const rad = ((angleDeg + i * PITCH_DEG) * Math.PI) / 180
          const tx = cx + Math.cos(rad) * (baseR + 3)
          const ty = cy + Math.sin(rad) * (baseR + 3)
          pxLine(
            g,
            cx + Math.cos(rad) * (baseR - 1),
            cy + Math.sin(rad) * (baseR - 1),
            tx,
            ty,
            rimColor,
            3,
          )
        }
        // 轮辐十字
        for (let i = 0; i < 4; i += 1) {
          const rad = ((angleDeg + i * 90) * Math.PI) / 180
          pxLine(
            g,
            cx + Math.cos(rad) * 5,
            cy + Math.sin(rad) * 5,
            cx + Math.cos(rad) * (baseR - 2),
            cy + Math.sin(rad) * (baseR - 2),
            rimColor,
            1,
          )
        }
      }

      let visualLeft = leftAngle
      const draw = (now: number) => {
        const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000))
        lastTs = now

        if (!this.settled) {
          timeLeft = Math.max(0, timeLeft - dt)
          if (heldDir !== 0) {
            rightAngle = (rightAngle + heldDir * 34 * dt + 360) % 360
          }
          if (timeLeft <= 0) {
            shell.setStatus('三十秒已尽，钟摆归静。塔放你继续前行。', palette.muted)
            finish({ win: false, score: 0 }, 850)
          } else if (now >= clankUntil) {
            const err = meshErrorDeg(leftAngle, rightAngle)
            const aligned = err < TOLERANCE_DEG
            shell.setStatus(
              `剩余 ${Math.ceil(timeLeft)} 秒 · ${aligned ? '齿位接近咬合，按空格确认' : '请用 ↑ / ↓ 对齐啮合齿槽'}`,
              aligned ? palette.good : palette.ink,
            )
          }
        } else if (meshedSpin) {
          visualLeft = (visualLeft + 48 * dt) % 360
          rightAngle = (rightAngle - 48 * dt + 360) % 360
        }

        const g = shell.ctx2d
        pxRect(g, 0, 0, BOARD_W, BOARD_H, palette.bg)

        // 顶部倒计时像素进度条
        const barW = Math.round(((BOARD_W - 16) * timeLeft) / TIME_LIMIT_S)
        pxRect(g, 8, 5, BOARD_W - 16, 4, '#362a20')
        pxRect(g, 8, 5, barW, 4, timeLeft < 8 ? palette.bad : palette.accent)

        // 左基准轮 + 右可调轮（圆心距 = 2*baseR + 4，齿尖恰好交错咬合）
        const leftCx = 39
        const rightCx = 81
        const cy = 40
        const baseR = 19

        const isClank = now < clankUntil
        drawGear(g, leftCx, cy, baseR, visualLeft, '#6e502d', '#d6a45c')
        drawGear(
          g,
          rightCx,
          cy,
          baseR,
          rightAngle,
          isClank ? '#7a332b' : '#856032',
          meshedSpin ? palette.good : isClank ? palette.bad : palette.accent,
        )

        // 中央啮合视窗提示框
        const err = meshErrorDeg(leftAngle, rightAngle)
        const boxColor = meshedSpin
          ? palette.good
          : err < TOLERANCE_DEG
            ? palette.good
            : palette.border
        pxRect(g, 56, 30, 8, 1, boxColor)
        pxRect(g, 56, 50, 8, 1, boxColor)
        pxRect(g, 56, 30, 1, 4, boxColor)
        pxRect(g, 63, 30, 1, 4, boxColor)
        pxRect(g, 56, 47, 1, 4, boxColor)
        pxRect(g, 63, 47, 1, 4, boxColor)

        this.rafId = window.requestAnimationFrame(draw)
      }

      this.rafId = window.requestAnimationFrame(draw)
    })
  }

  unmount(): void {
    const resolve = this.resolveFn
    this.cleanup()
    if (!this.settled && resolve) {
      this.settled = true
      resolve({ win: false })
    }
  }

  private cleanup(): void {
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
    if (this.finishTimer) {
      window.clearTimeout(this.finishTimer)
      this.finishTimer = 0
    }
    if (this.keyDownHandler) {
      window.removeEventListener('keydown', this.keyDownHandler, true)
      this.keyDownHandler = null
    }
    if (this.keyUpHandler) {
      window.removeEventListener('keyup', this.keyUpHandler, true)
      this.keyUpHandler = null
    }
    this.shell?.destroy()
    this.shell = null
    this.resolveFn = null
  }
}

export const gearsMiniGame: MiniGame = new GearsMiniGame()
