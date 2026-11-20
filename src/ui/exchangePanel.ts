/**
 * 流浪商人「交换」面板（原型）：自包含覆层，内联样式，不走 index.html 模板。
 *
 * 流程：列出背包里的卡 → 选一张作为代价 → 同档不同名三选一 → 扣钱替换。
 * 规则与价格由 shop.ts 的 MerchantExchange 决定，这里只负责呈现与点击。
 */
import type { InventoryItem } from '../types'

export interface ExchangeChoice {
  id: string
  name: string
  desc: string
  icon: string
}

export interface ExchangeHandlers {
  /** 选中一张卡作为代价：返回该档位可换的三张候选（无可换目标返回 null） */
  onPickSource: (uid: string) => { price: number; choices: ExchangeChoice[] } | null
  /** 确认换取某张：返回结果文案 */
  onCommit: (sourceUid: string, cardId: string) => string
  onClose: () => void
}

const FONT = "system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif"

export class ExchangePanel {
  private root: HTMLDivElement | null = null
  private body: HTMLDivElement | null = null
  private keyHandler: ((e: KeyboardEvent) => void) | null = null
  private handlers: ExchangeHandlers | null = null

  get isOpen(): boolean {
    return this.root !== null
  }

  open(gold: number, cards: InventoryItem[], handlers: ExchangeHandlers): void {
    this.close(false)
    this.handlers = handlers

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
      'width:min(620px,92vw)',
      'max-height:84vh',
      'overflow:auto',
      'background:#141a2c',
      'border:1px solid #36406a',
      'border-radius:14px',
      'padding:22px 24px',
      'box-shadow:0 18px 60px rgba(0,0,0,.55)',
    ].join(';')

    this.body = document.createElement('div')
    this.body.append(...this.renderSources(gold, cards))
    card.appendChild(this.body)
    root.appendChild(card)
    document.body.appendChild(root)
    this.root = root

    this.keyHandler = (e: KeyboardEvent): void => {
      if (!this.isOpen) return
      if (e.code === 'Escape') {
        e.preventDefault()
        this.close(true)
      }
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  private renderSources(gold: number, cards: InventoryItem[]): HTMLElement[] {
    const title = document.createElement('h2')
    title.textContent = '交换'
    title.style.cssText = 'margin:0 0 6px;font-size:20px'

    const hint = document.createElement('p')
    hint.textContent = `同档、不同名、三选一。当前金币 ${gold}。选一张卡作为代价：`
    hint.style.cssText = 'margin:0 0 16px;font-size:13px;color:#9aa6c8'

    const nodes: HTMLElement[] = [title, hint]
    if (cards.length === 0) {
      const empty = document.createElement('div')
      empty.textContent = '背包里还没有可交换的卡。'
      empty.style.cssText = 'font-size:14px;color:#8b96b8'
      nodes.push(empty)
      return nodes
    }

    cards.forEach((item) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = `${item.icon} ${item.name} — ${item.desc}`
      btn.style.cssText = this.btnStyle()
      btn.addEventListener('click', () => this.pickSource(item))
      nodes.push(btn)
    })

    const foot = document.createElement('div')
    foot.textContent = 'Esc 取消'
    foot.style.cssText = 'margin-top:14px;font-size:12px;color:#6f7ba0'
    nodes.push(foot)
    return nodes
  }

  private pickSource(item: InventoryItem): void {
    const handlers = this.handlers
    if (!handlers || !this.body) return
    const offer = handlers.onPickSource(item.uid)
    if (!offer || offer.choices.length === 0) {
      this.showResult('没有可换的同档卡（同档不同名且未持有）。', false)
      return
    }
    this.body.replaceChildren(...this.renderChoices(item, offer.price, offer.choices))
  }

  private renderChoices(item: InventoryItem, price: number, choices: ExchangeChoice[]): HTMLElement[] {
    const title = document.createElement('h2')
    title.textContent = `用「${item.name}」换一张`
    title.style.cssText = 'margin:0 0 6px;font-size:19px'

    const hint = document.createElement('p')
    hint.textContent = `代价 ${price === 0 ? '免费（本房间首次）' : `${price} 金币`} · 换取后原卡消失`
    hint.style.cssText = 'margin:0 0 16px;font-size:13px;color:#9aa6c8'

    const nodes: HTMLElement[] = [title, hint]
    choices.forEach((c) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = `${c.icon} ${c.name} — ${c.desc}`
      btn.style.cssText = this.btnStyle()
      btn.addEventListener('click', () => {
        const handlers = this.handlers
        if (!handlers) return
        const text = handlers.onCommit(item.uid, c.id)
        this.showResult(text, true)
      })
      nodes.push(btn)
    })
    return nodes
  }

  private showResult(text: string, ok: boolean): void {
    if (!this.body) return
    const title = document.createElement('div')
    title.textContent = ok ? '交换完成' : '无法交换'
    title.style.cssText = `font-size:11px;letter-spacing:.16em;color:${ok ? '#8fd8ff' : '#ff8a8a'}`

    const body = document.createElement('p')
    body.textContent = text
    body.style.cssText = 'margin:12px 0 20px;font-size:15px;line-height:1.8'

    const close = document.createElement('button')
    close.type = 'button'
    close.textContent = '继续 · Esc'
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
    close.addEventListener('click', () => this.close(true))

    this.body.replaceChildren(title, body, close)
  }

  private btnStyle(): string {
    return [
      'display:block',
      'width:100%',
      'text-align:left',
      'margin:0 0 10px',
      'padding:12px 14px',
      'font-size:14px',
      'color:#e8ecf8',
      'background:#1c2238',
      'border:1px solid #33406b',
      'border-radius:10px',
      'cursor:pointer',
      `font-family:${FONT}`,
    ].join(';')
  }

  close(notify: boolean): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler)
      this.keyHandler = null
    }
    this.root?.remove()
    this.root = null
    this.body = null
    if (notify) this.handlers?.onClose()
    this.handlers = null
  }
}
