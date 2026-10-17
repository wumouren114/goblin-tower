/** 键盘 / 鼠标输入：帧内边沿触发 + 相机拖拽/滚轮 */
export class Input {
  private down = new Set<string>()
  private pressedThisFrame = new Set<string>()
  private pointerDown = false
  private lastX = 0
  private lastY = 0
  dragX = 0
  dragY = 0
  wheel = 0
  private el: HTMLElement
  private disposers: (() => void)[] = []

  constructor(el: HTMLElement) {
    this.el = el
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      const code = e.code
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)
      ) {
        e.preventDefault()
      }
      this.down.add(code)
      this.pressedThisFrame.add(code)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      this.down.delete(e.code)
    }
    const onBlur = () => {
      this.down.clear()
      this.pointerDown = false
    }
    const onPointerDown = (e: PointerEvent) => {
      if (e.target && (e.target as HTMLElement).closest('#ui-root')) return
      this.pointerDown = true
      this.lastX = e.clientX
      this.lastY = e.clientY
      this.el.setPointerCapture?.(e.pointerId)
    }
    const onPointerUp = () => {
      this.pointerDown = false
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!this.pointerDown) return
      this.dragX += e.clientX - this.lastX
      this.dragY += e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY
    }
    const onWheel = (e: WheelEvent) => {
      if (e.target && (e.target as HTMLElement).closest('#ui-root')) return
      this.wheel += Math.sign(e.deltaY)
      e.preventDefault()
    }
    const onContext = (e: Event) => e.preventDefault()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    el.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointermove', onPointerMove)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('contextmenu', onContext)

    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => el.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => el.removeEventListener('wheel', onWheel),
      () => el.removeEventListener('contextmenu', onContext),
    )
  }

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** 本帧是否刚按下（每帧末尾自动清空） */
  justPressed(code: string): boolean {
    return this.pressedThisFrame.has(code)
  }

  /** 屏幕坐标系方向：x 右，z 前（远离相机） */
  moveAxis(): { x: number; z: number } {
    let x = 0
    let z = 0
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) z += 1
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) z -= 1
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1
    const len = Math.hypot(x, z)
    if (len > 1) {
      x /= len
      z /= len
    }
    return { x, z }
  }

  consumeWheel(): number {
    const w = this.wheel
    this.wheel = 0
    return w
  }

  consumeDrag(): { x: number; y: number } {
    const d = { x: this.dragX, y: this.dragY }
    this.dragX = 0
    this.dragY = 0
    return d
  }

  endFrame(): void {
    this.pressedThisFrame.clear()
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers.length = 0
    this.down.clear()
  }
}
