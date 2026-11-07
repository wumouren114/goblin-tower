/**
 * 探索事件面板（原型）：自包含 DOM + 内联样式，不走 index.html 模板。
 *
 * 为什么单独写：事件面板是"临时覆层"，和隧道/商店那种常驻面板结构不同；
 * 先用它把流程点通，之后要接进设计系统再迁到 styles.css。
 */
import type { EventDef, EventOption, EventOutcome, EventRole } from '../data/events'
import type { EventState } from '../systems/eventState'

export interface EventPanelContext {
  gold: number
  cards: number
  /** 抽好的隐藏真身；null 表示该事件没有真身 */
  role: EventRole | null
}

export interface EventPanelHandlers {
  /** 玩家选定一个选项，返回该选项的结果（由调用方抽 + 结算） */
  onPick: (option: EventOption) => EventOutcome | null
  /** 结果面板被关闭 */
  onClose: () => void
}

const FONT = "system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"

export class EventPanel {
  private root: HTMLDivElement | null = null
  private body: HTMLDivElement | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private options: EventOption[] = []
  private selected = -1

  get isOpen(): boolean {
    return this.root !== null
  }

  open(event: EventDef, state: EventState, ctx: EventPanelContext, handlers: EventPanelHandlers): void {
    this.close(false)
    this.options = event.options.filter((o) => state.canPick(o, { gold: ctx.gold, cards: ctx.cards }))
    this.selected = -1

    const root = document.createElement('div')
    root.style.cssText = [
      'position:fixed',
      'inset:0',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(6,8,14,.74)',
      'z-index:900',
      `font-family:${FONT}`,
      'color:#e8ecf8',
    ].join(';')

    const card = document.createElement('div')
    card.style.cssText = [
      'width:min(680px,92vw)',
      'max-height:86vh',
      'overflow:auto',
      'background:#141a2c',
      'border:1px solid #36406a',
      'border-radius:14px',
      'padding:22px 24px',
      'box-shadow:0 18px 60px rgba(0,0,0,.55)',
    ].join(';')

    const kicker = document.createElement('div')
    kicker.textContent = event.kind === 'info' ? 'SOMETHING ON THE WALL' : 'A CHANCE ENCOUNTER'
    kicker.style.cssText = 'font-size:11px;letter-spacing:.18em;color:#7d8bb8'

    const title = document.createElement('h2')
    title.textContent = event.title
    title.style.cssText = 'margin:6px 0 10px;font-size:22px;font-weight:700'

    const intro = document.createElement('p')
    intro.textContent = event.intro
    intro.style.cssText = 'margin:0 0 14px;font-size:14px;line-height:1.7;color:#c3ccdf'

    const clueBox = document.createElement('div')
    clueBox.style.cssText = 'margin:0 0 18px;padding:10px 12px;border-left:3px solid #4a7ad0;background:#101627;border-radius:6px'
    for (const clue of event.clues) {
      const line = document.createElement('div')
      line.textContent = `· ${clue}`
      line.style.cssText = 'font-size:13px;line-height:1.7;color:#9fd8ff'
      clueBox.appendChild(line)
    }

    this.body = document.createElement('div')
    this.body.append(kicker, title, intro, clueBox)

    const list = document.createElement('div')
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px'

    this.options.forEach((option, index) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.dataset.index = String(index)
      const cost = option.costGold ? `（${option.costGold} 金）` : option.costCard ? '（消耗一张卡）' : ''
      btn.textContent = `${index + 1}. ${option.label}${cost}`
      btn.style.cssText = [
        'text-align:left',
        'padding:12px 14px',
        'font-size:14px',
        'color:#e8ecf8',
        'background:#1c2238',
        'border:1px solid #33406b',
        'border-radius:10px',
        'cursor:pointer',
        `font-family:${FONT}`,
      ].join(';')
      btn.addEventListener('pointerenter', () => {
        this.selected = index
        this.paint()
      })
      btn.addEventListener('pointerleave', () => {
        if (this.selected === index) this.selected = -1
        this.paint()
      })
      btn.addEventListener('click', () => pick(index))
      list.appendChild(btn)
    })

    const hint = document.createElement('div')
    hint.textContent = '按 1–4 选择，Enter 确认，Esc 离开'
    hint.style.cssText = 'margin-top:16px;font-size:12px;color:#6f7ba0'

    this.body.appendChild(list)
    this.body.appendChild(hint)
    card.appendChild(this.body)
    root.appendChild(card)
    document.body.appendChild(root)
    this.root = root

    const pick = (index: number): void => {
      const option = this.options[index]
      if (!option) return
      const outcome = handlers.onPick(option)
      this.showResult(event, option, outcome, handlers)
    }
    this.pickHandler = pick

    this.keyHandler = (e: KeyboardEvent): void => {
      if (!this.isOpen) return
      if (e.code === 'Escape') {
        e.preventDefault()
        this.close(true, handlers)
        return
      }
      if (e.code === 'Enter') {
        e.preventDefault()
        if (this.selected < 0) this.selected = 0
        pick(this.selected)
        return
      }
      const num = /^Digit([1-4])$/.exec(e.code)
      if (num) {
        e.preventDefault()
        const index = Number(num[1]) - 1
        if (index < this.options.length) {
          this.selected = index
          this.paint()
          pick(index)
        }
      }
    }
    window.addEventListener('keydown', this.keyHandler)
    this.paint()
  }

  /** 调试：直接选第 index 个选项（?eventpick=1 用） */
  pickIndex(index: number): void {
    this.pickHandler?.(index)
  }

  private pickHandler: ((index: number) => void) | null = null

  private paint(): void {
    if (!this.body) return
    const buttons = this.body.querySelectorAll<HTMLButtonElement>('button[data-index]')
    buttons.forEach((btn) => {
      const index = Number(btn.dataset.index)
      const active = index === this.selected
      btn.style.background = active ? '#2a3557' : '#1c2238'
      btn.style.borderColor = active ? '#6f8de0' : '#33406b'
    })
  }

  private showResult(
    event: EventDef,
    option: EventOption,
    outcome: EventOutcome | null,
    handlers: EventPanelHandlers,
  ): void {
    if (!this.body) return
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler)
      this.keyHandler = null
    }
    this.body.replaceChildren()

    const kicker = document.createElement('div')
    kicker.textContent = `${event.title} · ${option.label}`
    kicker.style.cssText = 'font-size:11px;letter-spacing:.16em;color:#7d8bb8'

    const text = document.createElement('p')
    text.textContent = outcome ? outcome.text : '什么也没发生。'
    text.style.cssText = 'margin:14px 0 22px;font-size:16px;line-height:1.9;color:#e8ecf8'

    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '继续 · Enter'
    close.style.cssText = [
      'padding:10px 18px',
      'font-size:14px',
      'color:#0d1220',
      'background:#9fd8ff',
      'border:0',
      'border-radius:10px',
      'cursor:pointer',
      `font-family:${FONT}`,
    ].join(';')
    close.addEventListener('click', () => this.close(true, handlers))

    this.body.append(kicker, text, close)

    this.keyHandler = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' || e.code === 'Escape' || e.code === 'Space') {
        e.preventDefault()
        this.close(true, handlers)
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  close(notify: boolean, handlers?: EventPanelHandlers): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler)
      this.keyHandler = null
    }
    this.root?.remove()
    this.root = null
    this.body = null
    this.options = []
    this.pickHandler = null
    if (notify) handlers?.onClose()
  }
}
