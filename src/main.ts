import './styles.css'
import { createHud, type HudV3 } from './ui/hud'
import { Game } from './game'
import { preloadArt } from './art/atlasImport'
import { audio } from './core/audio'
import type { CharacterId, DifficultyId } from './types'

function fatal(message: string): void {
  let el = document.getElementById('fatal-overlay')
  if (!el) {
    el = document.createElement('div')
    el.id = 'fatal-overlay'
    el.style.cssText =
      'position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:#0b0d0c;color:#f3d9a4;font-family:system-ui,sans-serif;padding:32px;text-align:center'
    document.body.appendChild(el)
  }
  el.innerHTML = `<h2 style="margin:0">游戏启动失败</h2><pre style="max-width:80vw;white-space:pre-wrap;color:#ff8f8f">${message}</pre><p style="opacity:.7">建议使用 Edge / Chrome 并开启硬件加速。</p>`
}

window.onerror = (_e, _src, _line, _col, err) => {
  fatal(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
}
window.addEventListener('beforeunload', (ev) => {
  const g = (window as any).__goblinTower as { phase?: string } | null
  if (g && (g.phase === 'playing' || g.phase === 'tunnel' || g.phase === 'shop')) {
    ev.preventDefault()
    ev.returnValue = ''
  }
})

window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason as unknown
  fatal(r instanceof Error ? `${r.message}\n${r.stack ?? ''}` : String(r))
})

const canvas = document.getElementById('game') as HTMLCanvasElement | null
if (!canvas) {
  fatal('找不到 #game canvas')
  throw new Error('canvas missing')
}

/** 原画加载遮罩：只在等 PNG 解码时出现，避免标题页闪一下程序化占位图 */
function showBootOverlay(): HTMLElement {
  const el = document.createElement('div')
  el.id = 'boot-overlay'
  el.style.cssText =
    'position:fixed;inset:0;z-index:99998;display:flex;align-items:center;justify-content:center;gap:10px;background:#0b0d0c;color:#f3d9a4;font:14px/1.6 system-ui,sans-serif;letter-spacing:.08em;transition:opacity .25s'
  el.textContent = '载入原画…'
  document.body.appendChild(el)
  return el
}

let game: Game | null = null

const hud: HudV3 = createHud({
  onStart: (character, difficulty) => game?.startRun(character, difficulty),
  onContinue: (slot) => game?.continueRun(slot),
  onTunnelPick: (id) => game?.pickTunnel(id),
  onShopBuy: (id) => game?.buyOffer(id),
  onShopRefresh: () => game?.refreshShop(),
  onShopClose: () => game?.leaveShop(),
  onOpenInventory: () => game?.openInventory(),
  onCloseInventory: () => game?.closeInventory(),
  onMergeItem: (a, b) => game?.mergeItems(a, b),
  onUseItem: (uid) => game?.useItem(uid),
  onSave: (slot) => game?.manualSave(slot),
  onLoad: (slot) => game?.manualLoad(slot),
  onPauseToggle: () => game?.togglePausePublic(),
  onRetryLayer: () => game?.retryLayer(),
  onRestart: () => game?.quitToTitle(),
  onQuitToTitle: () => game?.quitToTitle(),
})

async function boot(): Promise<void> {
  const overlay = showBootOverlay()
  try {
    // 原画是外置 PNG：必须先解码完，贴图 getter 才会同步返回，否则会闪一帧程序化图
    await preloadArt()
  } catch {
    /* 缺图/解码失败都无妨，全部回退程序化像素图 */
  }
  overlay.remove()

  try {
    game = new Game(canvas!, hud)
    game.quitToTitle()
    ;(window as unknown as { __goblinTower: Game | null }).__goblinTower = game

  // 调试入口：?char=mutsumi|murasame|fish &autostart=easy|normal|hard &floor=N &warmup=秒
  const params = new URLSearchParams(location.search)
  const char = (params.get('char') ?? 'mutsumi') as CharacterId
  const diff = (params.get('autostart') ?? '') as DifficultyId | ''
  const floor = Number(params.get('floor') ?? '1')
  const warmup = Number(params.get('warmup') ?? '0')
  if (diff) {
    game.debugJump(Number.isFinite(floor) ? floor : 1, diff, char)
    if (params.get('px') || params.get('pz')) {
      const g = (window as any).__goblinTower
      if (g?.player) {
        g.player.x = Number(params.get('px') ?? 0)
        g.player.z = Number(params.get('pz') ?? 0)
      }
    }
    if (params.get('autoattack') === '1') game.debugAutoAttack(true)
    if (warmup > 0) game.debugAdvance(warmup)
    if (params.get('pickbonus') === '1') game.debugPickFirstBonus()
    if (params.get('saveloop') === '1') {
      game.debugSaveLoadLoop()
      game.debugAdvance(1)
    }
  }
  if (params.get('debug') === '1') {
    const box = document.createElement('pre')
    box.id = 'debug-overlay'
    box.style.cssText = 'position:fixed;left:8px;bottom:60px;z-index:99999;color:#0f0;font:11px monospace;background:#000a;padding:6px;max-width:520px;white-space:pre-wrap'
    document.body.appendChild(box)
    const g = (window as any).__goblinTower as Record<string, any>
    const render = (): string =>
      JSON.stringify(
      {
        phase: g.phase,
        audio: audio.status(),
        layer: g.run?.layer,
        stage: g.run?.stage,
        boss: g.boss ? { hp: g.boss.hp, max: g.boss.maxHp, x: g.boss.x, z: g.boss.z, alive: g.boss.alive } : null,
        goblins: g.goblins?.length,
        total: g.layerTotal,
        killed: g.layerKilled,
        timeLeft: Math.round(g.timeLeft ?? 0),
        char: g.run?.character,
        weapon: g.run?.weaponLv,
        gold: g.run?.gold,
        hp: Math.round(g.player?.hp ?? 0),
        transform: g.combat?.transformActive,
        shots: ((g.enemyShots ?? []) as { x: number; z: number }[]).map((s) => [Number(s.x.toFixed(1)), Number(s.z.toFixed(1))]),
        slots: g.debugSaveSlots ? g.debugSaveSlots() : null,
        bossGroup: g.boss?.group ? { visible: g.boss.group.visible, children: g.boss.group.children.length, y: g.boss.group.position.y } : null,
        bossSprite: g.boss?.sprite
          ? {
              visible: g.boss.sprite.visible,
              x: Number(g.boss.sprite.position.x.toFixed(2)),
              y: Number(g.boss.sprite.position.y.toFixed(2)),
              z: Number(g.boss.sprite.position.z.toFixed(2)),
              sx: Number(g.boss.sprite.scale.x.toFixed(2)),
              sy: Number(g.boss.sprite.scale.y.toFixed(2)),
              opacity: g.boss.mat?.opacity,
              hasMap: !!g.boss.sprite.material?.map,
            }
          : null,
        bossBar: (() => {
          const bar = document.querySelector('.boss-bar')
          if (!bar) return null
          const cs = getComputedStyle(bar)
          return { cn: bar.className, hidden: bar.hasAttribute('hidden'), opacity: cs.opacity, visibility: cs.visibility, display: cs.display }
        })(),
      },
      null,
      1,
    )
    box.textContent = render()
    window.setInterval(() => {
      box.textContent = render()
    }, 500)
  }

    const screen = params.get('screen')
    if (screen) game.debugScreen(screen)
  } catch (err) {
    fatal(err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err))
  }
}

void boot()

