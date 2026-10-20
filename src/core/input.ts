/**
 * 键盘 / 鼠标输入（v3：左键点击普攻、右键技能、中键拖拽转视角）
 *
 * - 左键点击 = 单次普攻（attackQueued，仅边沿触发；不再按住连发）
 * - 右键按下 = 技能（skillPressed，仅边沿触发）
 * - 中键拖拽 / 滚轮 = 转视角 / 缩放
 * - 方向键 / WASD / Space / Tab 拦截浏览器默认行为（Tab 防止焦点跳走）
 * - 鼠标位置以 NDC 暴露，game.ts 用它把准星投到地面
 */
export class Input {
  private down = new Set<string>()
  private pressedThisFrame = new Set<string>()
  private pointerDown = false
  private button = -1
  private lastX = 0
  private lastY = 0
  /** NDC：(-1..1)，y 向上 */
  ndcX = 0
  ndcY = 0
  private attackQueued = false
  skillPressed = false
  private skillQueued = false
  dragX = 0
  dragY = 0
  wheel = 0
  private el: HTMLElement
  private disposers: (() => void)[] = []

  constructor(el: HTMLElement) {
    this.el = el

    const onKeyDown = (e: KeyboardEvent) => {
      // HUD 的 keydown 先注册、先执行；它已处理的按键（Enter/Escape/数字等）
      // 不再写入游戏输入，避免同一次按键被 UI 和游戏各处理一次。
      if (e.defaultPrevented) return
      const code = e.code
      if (
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(code)
      ) {
        e.preventDefault()
      }
      if (e.repeat) return
      this.down.add(code)
      this.pressedThisFrame.add(code)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      this.down.delete(e.code)
    }
    const onBlur = () => {
      this.down.clear()
      this.pointerDown = false
      this.attackQueued = false
    }
    const isUi = (t: EventTarget | null): boolean => !!t && !!(t as HTMLElement).closest('#ui-root')

    const onPointerDown = (e: PointerEvent) => {
      if (isUi(e.target)) return
      this.updatePointer(e)
      this.button = e.button
      if (e.button === 3 || e.button === 4) {
        // 鼠标侧键在 Edge/Chrome 里是前进/后退，会直接离开游戏页面
        e.preventDefault()
        return
      }
      if (e.button === 0) {
        this.attackQueued = true
      } else if (e.button === 2) {
        this.skillQueued = true
      } else if (e.button === 1) {
        this.pointerDown = true
        this.lastX = e.clientX
        this.lastY = e.clientY
        this.el.setPointerCapture?.(e.pointerId)
        e.preventDefault()
      }
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.button === 1) this.pointerDown = false
      this.button = -1
    }
    const onPointerMove = (e: PointerEvent) => {
      this.updatePointer(e)
      if (this.pointerDown) {
        this.dragX += e.clientX - this.lastX
        this.dragY += e.clientY - this.lastY
        this.lastX = e.clientX
        this.lastY = e.clientY
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (isUi(e.target)) return
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
    const onAux = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) e.preventDefault()
    }
    el.addEventListener('contextmenu', onContext)
    window.addEventListener('auxclick', onAux)
    window.addEventListener('mouseup', onAux)

    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
      () => el.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => el.removeEventListener('wheel', onWheel),
      () => el.removeEventListener('contextmenu', onContext),
      () => window.removeEventListener('auxclick', onAux),
      () => window.removeEventListener('mouseup', onAux),
    )
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    this.ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1
  }

  isDown(code: string): boolean {
    return this.down.has(code)
  }

  /** 本帧是否刚按下（每帧末尾自动清空） */
  justPressed(code: string): boolean {
    return this.pressedThisFrame.has(code)
  }

  /** 本帧是否点击了左键（边沿触发，读取后消费；按住不会连发） */
  consumeAttack(): boolean {
    const v = this.attackQueued
    this.attackQueued = false
    return v
  }

  /** 本帧是否按下了右键（边沿触发，读取后消费） */
  consumeSkill(): boolean {
    const v = this.skillQueued
    this.skillQueued = false
    return v
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
    this.skillPressed = false
    // 暂停/商店等非战斗阶段不接受残留的点击，避免恢复后突然开火
    this.attackQueued = false
  }

  dispose(): void {
    for (const d of this.disposers) d()
    this.disposers.length = 0
    this.down.clear()
  }
}
