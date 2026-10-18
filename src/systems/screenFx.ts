/**
 * 全屏表现层：受击红晕、Boss 预警暗角、切层白闪。
 * 独立于 UI 模块，避免和 HUD 的 DOM 结构耦合。
 */
export class ScreenFx {
  private hurtEl: HTMLDivElement
  private flashEl: HTMLDivElement
  private vignetteEl: HTMLDivElement
  private styleEl: HTMLStyleElement
  private hurtTimer = 0

  constructor(parent: HTMLElement = document.body) {
    this.styleEl = document.createElement('style')
    this.styleEl.textContent = `
      .sfx-hurt, .sfx-flash, .sfx-vignette { position: fixed; inset: 0; pointer-events: none; }
      .sfx-hurt { background: radial-gradient(circle at 50% 55%, rgba(255,60,60,0.03) 40%, rgba(170,0,20,0.42) 100%); opacity: 0; transition: opacity 150ms ease-out; z-index: 40; }
      .sfx-flash { background: #fff; opacity: 0; transition: opacity 260ms ease-out; z-index: 45; }
      .sfx-vignette { background: radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 52%, rgba(8,4,14,0.55) 100%); z-index: 5; }
      .sfx-vignette.boss { box-shadow: inset 0 0 160px rgba(190,10,30,0.65); animation: sfxPulse 2.4s ease-in-out infinite; }
      @keyframes sfxPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
    `
    document.head.appendChild(this.styleEl)
    this.vignetteEl = document.createElement('div')
    this.vignetteEl.className = 'sfx-vignette'
    this.hurtEl = document.createElement('div')
    this.hurtEl.className = 'sfx-hurt'
    this.flashEl = document.createElement('div')
    this.flashEl.className = 'sfx-flash'
    parent.appendChild(this.vignetteEl)
    parent.appendChild(this.hurtEl)
    parent.appendChild(this.flashEl)
  }

  hurt(intensity = 1): void {
    // 0.16s 内重复受击不再叠加红屏，避免密集挨打时屏幕频闪
    if (this.hurtTimer > 0) return
    this.hurtEl.style.opacity = String(Math.min(0.32, 0.12 + 0.16 * intensity))
    this.hurtTimer = 0.16
  }

  flash(strength = 0.7, ms = 260): void {
    this.flashEl.style.transition = 'none'
    this.flashEl.style.opacity = String(strength)
    requestAnimationFrame(() => {
      this.flashEl.style.transition = `opacity ${ms}ms ease-out`
      this.flashEl.style.opacity = '0'
    })
  }

  setBossMode(on: boolean): void {
    this.vignetteEl.classList.toggle('boss', on)
  }

  update(dt: number): void {
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt
      if (this.hurtTimer <= 0) this.hurtEl.style.opacity = '0'
    }
  }

  dispose(): void {
    this.hurtEl.remove()
    this.flashEl.remove()
    this.vignetteEl.remove()
    this.styleEl.remove()
  }
}
