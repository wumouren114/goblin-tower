/**
 * 云上花庭 · 「风车校准」
 *
 * 三片风车叶片依次旋转，玩家按 A/D 或左右方向键在风向标记 ±10° 内停住叶片；
 * 三片全部校准即通关，共 3 次尝试，失败无惩罚。
 */
import {
  BOARD_H,
  BOARD_W,
  angleDiffDeg,
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

interface BladeState {
  cx: number
  cy: number
  angle: number
  target: number
  speed: number // 度/秒
  locked: boolean
  lastError: number | null
}

const TOLERANCE_DEG = 10
const MAX_ATTEMPTS = 3

class WindmillMiniGame implements MiniGame {
  readonly id = 'windmill'
  readonly title = '风车校准'

  private shell: MiniGameShell | null = null
  private rafId = 0
  private finishTimer = 0
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private resolveFn: ((res: MiniGameResult) => void) | null = null
  private settled = false

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.unmount()
    this.settled = false

    const palette = resolvePalette(1)

    return new Promise<MiniGameResult>((resolve) => {
      this.resolveFn = resolve

      const blades: BladeState[] = [0, 1, 2].map((i) => {
        const target = Math.round(ctx.rng() * 360)
        const dir = i % 2 === 0 ? 1 : -1
        const speed = (100 + i * 20 + ctx.rng() * 18) * dir
        return {
          cx: 24 + i * 36,
          cy: 38,
          angle: (target + 110 + ctx.rng() * 140) % 360,
          target,
          speed,
          locked: false,
          lastError: null,
        }
      })

      let activeIdx = 0
      let attemptsLeft = MAX_ATTEMPTS
      let pauseUntil = 0
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
        lore: '云上花庭的旧风仍在原地打转。塔在称量你的眼力——让三片风翼顺着风标停稳，它便漏出一点旧日余温；失手也无妨，风会放你走。',
        hint: '按 A / D 或 ← / →（或点击停转）在风向标记 ±10° 内停住叶片 · ESC 退出',
        onAbort: () => finish({ win: false }),
      })
      this.shell = shell

      const updateStatus = (msg?: string, color?: string) => {
        if (msg) {
          shell.setStatus(msg, color)
          return
        }
        const done = blades.filter((b) => b.locked).length
        shell.setStatus(`已校准 ${done}/3 片风翼 · 剩余尝试 ${attemptsLeft}/${MAX_ATTEMPTS}`)
      }

      const attemptStop = () => {
        if (this.settled) return
        const now = performance.now()
        if (now < pauseUntil) return
        const blade = blades[activeIdx]
        if (!blade || blade.locked) return

        const err = angleDiffDeg(blade.angle, blade.target)
        blade.lastError = err

        if (err <= TOLERANCE_DEG) {
          blade.locked = true
          blade.angle = blade.target
          activeIdx += 1
          if (activeIdx >= blades.length) {
            const avgErr =
              blades.reduce((s, b) => s + (b.lastError ?? 0), 0) / blades.length
            const score = Math.max(10, Math.round(100 - avgErr * 4 + (attemptsLeft - 1) * 10))
            updateStatus('三片风翼顺风停稳，花庭的旧风松开了一缕余温。', palette.good)
            finish({ win: true, score }, 750)
          } else {
            updateStatus(
              `第 ${activeIdx} 片校准成功（误差 ${err.toFixed(1)}°）· 继续第 ${activeIdx + 1} 片`,
              palette.good,
            )
          }
        } else {
          attemptsLeft -= 1
          if (attemptsLeft <= 0) {
            updateStatus(
              `偏离风标 ${err.toFixed(1)}°。塔收回了目光，放你继续往上走。`,
              palette.muted,
            )
            finish({ win: false, score: activeIdx * 25 }, 850)
          } else {
            pauseUntil = now + 450
            updateStatus(
              `偏差 ${err.toFixed(1)}°（需 ≤10°）· 剩余尝试 ${attemptsLeft} 次`,
              palette.warn,
            )
          }
        }
      }

      const stopBtn = makePixelButton('停住当前叶片 [A / D]', palette, attemptStop, true)
      shell.controlsEl.append(stopBtn)
      shell.canvas.style.cursor = 'pointer'
      shell.canvas.addEventListener('click', attemptStop)

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish({ win: false })
          return
        }
        if (
          e.key === 'a' ||
          e.key === 'A' ||
          e.key === 'd' ||
          e.key === 'D' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === ' '
        ) {
          e.preventDefault()
          e.stopPropagation()
          attemptStop()
        }
      }
      this.keyHandler = onKey
      window.addEventListener('keydown', onKey, true)

      const draw = (now: number) => {
        const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000))
        lastTs = now

        if (!this.settled && now >= pauseUntil) {
          const active = blades[activeIdx]
          if (active && !active.locked) {
            active.angle = (active.angle + active.speed * dt + 360) % 360
          }
        }

        const g = shell.ctx2d
        pxRect(g, 0, 0, BOARD_W, BOARD_H, palette.bg)

        // 背景淡云带与花庭地平线
        pxRect(g, 0, 62, BOARD_W, 10, '#1e334d')
        pxRect(g, 0, 61, BOARD_W, 1, palette.border)
        for (let i = 0; i < 6; i += 1) {
          const px = (i * 23 + Math.floor(now * 0.01)) % BOARD_W
          pxRect(g, px, 8 + (i % 3) * 6, 2, 1, '#a9d6ff')
        }

        // 绘制三座风车
        blades.forEach((b, idx) => {
          const isCurrent = idx === activeIdx && !this.settled
          const r = 14

          // 塔柱
          pxRect(g, b.cx - 2, b.cy + 2, 4, 21, '#2d4766')
          pxRect(g, b.cx - 1, b.cy + 2, 2, 21, '#4c6d94')

          // 外环
          pxCircle(
            g,
            b.cx,
            b.cy,
            r,
            b.locked ? palette.good : isCurrent ? palette.border : '#374c6b',
            false,
          )

          // 风向目标 ±10° 扇区标记
          for (let off = -TOLERANCE_DEG; off <= TOLERANCE_DEG; off += 5) {
            const rad = ((b.target + off - 90) * Math.PI) / 180
            const tx = b.cx + Math.cos(rad) * r
            const ty = b.cy + Math.sin(rad) * r
            pxRect(g, tx - 1, ty - 1, 2, 2, b.locked ? palette.good : palette.accent)
          }
          // 风向标外指尖
          const tRad = ((b.target - 90) * Math.PI) / 180
          pxRect(
            g,
            b.cx + Math.cos(tRad) * (r + 3) - 1,
            b.cy + Math.sin(tRad) * (r + 3) - 1,
            3,
            3,
            palette.accent,
          )

          // 当前叶片（主翼 + 副翼）
          const aRad = ((b.angle - 90) * Math.PI) / 180
          const wingColor = b.locked ? palette.good : isCurrent ? palette.ink : palette.muted
          pxLine(
            g,
            b.cx,
            b.cy,
            b.cx + Math.cos(aRad) * (r - 1),
            b.cy + Math.sin(aRad) * (r - 1),
            wingColor,
            2,
          )
          // 其余两片装饰翼（间隔 120°）
          for (const extra of [120, 240]) {
            const eRad = ((b.angle + extra - 90) * Math.PI) / 180
            pxLine(
              g,
              b.cx,
              b.cy,
              b.cx + Math.cos(eRad) * (r - 4),
              b.cy + Math.sin(eRad) * (r - 4),
              '#4b6588',
              1,
            )
          }
          // 轴心
          pxRect(g, b.cx - 1, b.cy - 1, 3, 3, isCurrent ? palette.accent : palette.ink)

          // 底部指示灯（当前/已完成）
          pxRect(
            g,
            b.cx - 3,
            65,
            6,
            3,
            b.locked ? palette.good : isCurrent ? palette.accent : '#334663',
          )
        })

        this.rafId = window.requestAnimationFrame(draw)
      }

      updateStatus()
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
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true)
      this.keyHandler = null
    }
    this.shell?.destroy()
    this.shell = null
    this.resolveFn = null
  }
}

export const windmillMiniGame: MiniGame = new WindmillMiniGame()
