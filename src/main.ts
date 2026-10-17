import { createHud } from './ui/hud'
import { Game } from './game'
import type { HudHandlers } from './types'

const canvas = document.getElementById('game') as HTMLCanvasElement | null

function showFatal(title: string, detail: string): void {
  const old = document.getElementById('fatal-overlay')
  if (old) old.remove()
  const box = document.createElement('div')
  box.id = 'fatal-overlay'
  box.style.cssText =
    'position:fixed;inset:0;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;padding:32px;color:#ffd9a0;background:rgba(14,9,18,.94);font-family:"Microsoft YaHei",sans-serif;text-align:center;white-space:pre-wrap;z-index:99999;line-height:1.6'
  box.textContent = `${title}\n\n${detail}\n\n建议使用最新版 Edge / Chrome，并确认浏览器已开启硬件加速。`
  document.body.appendChild(box)
}

window.addEventListener('error', (event) => {
  showFatal('运行时报错', String(event.message))
})
window.addEventListener('unhandledrejection', (event) => {
  showFatal('未处理的异步错误', String(event.reason))
})

let game: Game | null = null

const handlers: HudHandlers = {
  onStart: (difficulty) => game?.startRun(difficulty),
  onUpgradePick: (id) => game?.chooseUpgrade(id),
  onRestart: () => game?.restart(),
}

if (!canvas) {
  showFatal('启动失败', '找不到 #game 画布，index.html 可能未正确加载')
} else {
  try {
    const hud = createHud(handlers)
    game = new Game(canvas, hud)
    game.showTitle()
    // 便于调试：控制台可访问当前游戏实例
    ;(window as unknown as { __goblinTower?: Game }).__goblinTower = game

    // 联调/截图入口：?autostart=normal&floor=3 可直接进入指定层
    const params = new URLSearchParams(window.location.search)
    const autostart = params.get('autostart')
    if (autostart === 'casual' || autostart === 'normal' || autostart === 'nightmare') {
      const floor = Math.min(5, Math.max(1, Number(params.get('floor') ?? '1') || 1))
      game.debugJump(floor, autostart)
    }
  } catch (err) {
    console.error('[GoblinTower] 启动失败', err)
    showFatal('游戏启动失败', String((err as Error)?.stack ?? err))
  }
}
