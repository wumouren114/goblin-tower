/**
 * 星砂观星台 · 「星轨连线」
 *
 * 屏幕亮起 5~8 颗星，按顺序闪烁一遍后由玩家按相同顺序点击；
 * 全部记住即通关，错一次可重来（共 2 次机会），失败无惩罚。
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

interface StarNode {
  x: number
  y: number
}

const MAX_CHANCES = 2

class StarlinesMiniGame implements MiniGame {
  readonly id = 'starlines'
  readonly title = '星轨连线'

  private shell: MiniGameShell | null = null
  private rafId = 0
  private timers: number[] = []
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private resolveFn: ((res: MiniGameResult) => void) | null = null
  private settled = false

  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult> {
    this.unmount()
    this.settled = false

    const palette = resolvePalette(2)

    return new Promise<MiniGameResult>((resolve) => {
      this.resolveFn = resolve

      const count = 5 + Math.floor(ctx.rng() * 4) // 5~8 颗星
      const stars: StarNode[] = []
      let guard = 0
      while (stars.length < count && guard < 400) {
        guard += 1
        const x = 14 + Math.floor(ctx.rng() * (BOARD_W - 28))
        const y = 12 + Math.floor(ctx.rng() * (BOARD_H - 24))
        const tooClose = stars.some((s) => Math.hypot(s.x - x, s.y - y) < 18)
        if (!tooClose) stars.push({ x, y })
      }
      // 兜底：若随机拥挤未放满，按网格补齐
      while (stars.length < count) {
        const i = stars.length
        stars.push({ x: 18 + (i % 4) * 26, y: 18 + Math.floor(i / 4) * 32 })
      }

      // 背景装饰尘星
      const dust = Array.from({ length: 18 }, () => ({
        x: Math.floor(ctx.rng() * BOARD_W),
        y: Math.floor(ctx.rng() * BOARD_H),
      }))

      // 闪烁顺序：打乱 0..count-1
      const sequence = stars.map((_, i) => i)
      for (let i = sequence.length - 1; i > 0; i -= 1) {
        const j = Math.floor(ctx.rng() * (i + 1))
        const tmp = sequence[i]!
        sequence[i] = sequence[j]!
        sequence[j] = tmp
      }

      let phase: 'show' | 'input' | 'done' = 'show'
      let litIdx = -1
      let progress = 0
      let wrongIdx = -1
      let chancesLeft = MAX_CHANCES

      const schedule = (fn: () => void, ms: number) => {
        const id = window.setTimeout(() => {
          this.timers = this.timers.filter((t) => t !== id)
          if (!this.settled) fn()
        }, ms)
        this.timers.push(id)
      }

      const finish = (res: MiniGameResult, delayMs = 0) => {
        if (this.settled) return
        this.settled = true
        phase = 'done'
        if (delayMs > 0) {
          const id = window.setTimeout(() => {
            this.cleanup()
            resolve(res)
          }, delayMs)
          this.timers.push(id)
        } else {
          this.cleanup()
          resolve(res)
        }
      }

      const shell = createMiniGameShell(root, {
        palette,
        title: this.title,
        lore: '星砂观星台的旧星图只亮一瞬。塔在称量你的记性——按闪烁的次序重新连起星轨，它便漏出一点星屑；记错也无妨，星光会照常退去。',
        hint: '先记住亮起的星序，再用鼠标依次点击星星 · 错一次可重来（共 2 次机会）· ESC 退出',
        onAbort: () => finish({ win: false }),
      })
      this.shell = shell

      const playSequence = () => {
        phase = 'show'
        progress = 0
        wrongIdx = -1
        litIdx = -1
        shell.setStatus(`观星中（共 ${count} 颗）· 请记住亮起顺序…`, palette.accent)

        const stepMs = 680
        sequence.forEach((starIdx, step) => {
          schedule(() => {
            litIdx = starIdx
          }, 350 + step * stepMs)
          schedule(() => {
            litIdx = -1
          }, 350 + step * stepMs + 480)
        })

        schedule(() => {
          litIdx = -1
          phase = 'input'
          shell.setStatus(
            `请按顺序点击星星（0/${count}）· 剩余机会 ${chancesLeft}/${MAX_CHANCES}`,
            palette.ink,
          )
        }, 350 + sequence.length * stepMs + 120)
      }

      const replayBtn = makePixelButton('重看一次（不扣机会）', palette, () => {
        if (phase === 'input' && progress === 0) playSequence()
      })
      shell.controlsEl.append(replayBtn)

      shell.canvas.style.cursor = 'pointer'
      shell.canvas.addEventListener('click', (e) => {
        if (phase !== 'input' || this.settled) return
        const rect = shell.canvas.getBoundingClientRect()
        const mx = ((e.clientX - rect.left) / rect.width) * BOARD_W
        const my = ((e.clientY - rect.top) / rect.height) * BOARD_H

        // 找点击半径内最近的星
        let picked = -1
        let bestDist = 11
        stars.forEach((s, idx) => {
          const d = Math.hypot(s.x - mx, s.y - my)
          if (d < bestDist) {
            bestDist = d
            picked = idx
          }
        })
        if (picked < 0) return

        const expected = sequence[progress]
        if (picked === expected) {
          progress += 1
          wrongIdx = -1
          if (progress >= sequence.length) {
            const score = 70 + count * 4 + (chancesLeft - 1) * 10
            shell.setStatus('星轨首尾相连，观星台漏下一缕旧日星砂。', palette.good)
            finish({ win: true, score }, 750)
          } else {
            shell.setStatus(
              `星轨已连 ${progress}/${count} · 剩余机会 ${chancesLeft}/${MAX_CHANCES}`,
              palette.good,
            )
          }
        } else {
          wrongIdx = picked
          chancesLeft -= 1
          if (chancesLeft <= 0) {
            shell.setStatus('星轨散入了砂海。塔未责难，放你继续往上走。', palette.muted)
            finish({ win: false, score: progress * 10 }, 850)
          } else {
            phase = 'show'
            shell.setStatus('星序偏移，再看一遍星光重来（剩余 1 次机会）…', palette.warn)
            schedule(() => {
              playSequence()
            }, 850)
          }
        }
      })

      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          finish({ win: false })
        }
      }
      this.keyHandler = onKey
      window.addEventListener('keydown', onKey, true)

      const draw = (now: number) => {
        const g = shell.ctx2d
        pxRect(g, 0, 0, BOARD_W, BOARD_H, palette.bg)

        // 背景星尘
        for (let i = 0; i < dust.length; i += 1) {
          const d = dust[i]!
          const tw = Math.sin(now * 0.004 + i) > 0.35
          pxRect(g, d.x, d.y, 1, 1, tw ? '#5a5687' : '#2f2d52')
        }

        // 已连成的星轨线
        for (let i = 1; i < progress; i += 1) {
          const a = stars[sequence[i - 1]!]!
          const b = stars[sequence[i]!]!
          pxLine(g, a.x, a.y, b.x, b.y, palette.good, 1)
        }

        // 观星阶段高亮当前星与上一颗星的虚线指引
        if (phase === 'show' && litIdx >= 0) {
          const pos = sequence.indexOf(litIdx)
          if (pos > 0) {
            const prev = stars[sequence[pos - 1]!]!
            const cur = stars[litIdx]!
            pxLine(g, prev.x, prev.y, cur.x, cur.y, '#5a5494', 1)
          }
        }

        // 绘制所有星体
        const completedSet = new Set(sequence.slice(0, progress))
        stars.forEach((s, idx) => {
          const isLit = idx === litIdx
          const isDone = completedSet.has(idx)
          const isWrong = idx === wrongIdx

          if (isLit) {
            pxCircle(g, s.x, s.y, 6, palette.accent, false)
            pxCircle(g, s.x, s.y, 3, '#fff9d6', true)
            pxRect(g, s.x - 5, s.y, 11, 1, palette.accent)
            pxRect(g, s.x, s.y - 5, 1, 11, palette.accent)
          } else if (isWrong) {
            pxCircle(g, s.x, s.y, 5, palette.bad, false)
            pxCircle(g, s.x, s.y, 2, palette.bad, true)
          } else if (isDone) {
            pxCircle(g, s.x, s.y, 4, palette.good, false)
            pxCircle(g, s.x, s.y, 2, '#d8fff4', true)
          } else {
            pxCircle(g, s.x, s.y, 3, '#4c497a', false)
            pxRect(g, s.x - 1, s.y - 1, 3, 3, palette.muted)
            pxRect(g, s.x, s.y, 1, 1, palette.ink)
          }
        })

        this.rafId = window.requestAnimationFrame(draw)
      }

      playSequence()
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
    for (const t of this.timers) window.clearTimeout(t)
    this.timers = []
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true)
      this.keyHandler = null
    }
    this.shell?.destroy()
    this.shell = null
    this.resolveFn = null
  }
}

export const starlinesMiniGame: MiniGame = new StarlinesMiniGame()
