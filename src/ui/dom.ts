/**
 * UI 小工具集：元素创建、文本/数值格式化。
 * 约定：所有节点只在本模块的调用点（createHud 内部）创建，更新循环里只改内容与样式。
 */

type TagName = keyof HTMLElementTagNameMap

/** 创建元素（可带 class 与文本），避免 innerHTML 注入用户数据 */
export function el<K extends TagName>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function div(className = '', text?: string): HTMLDivElement {
  return el('div', className, text)
}

export function span(className = '', text?: string): HTMLSpanElement {
  return el('span', className, text)
}

/** 0~1 之间的安全比例（NaN / 负数 / 超过 1 都夹紧） */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/** 整数千分位格式化：12345 -> "12,345" */
export function fmtInt(value: number): string {
  const n = Math.round(Number.isFinite(value) ? value : 0)
  if (Math.abs(n) < 1000) return String(n)
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 带符号整数/小数格式化：18 -> "+18"，-8 -> "-8"，0.25 -> "+0.25" */
export function fmtDelta(value: number, digits = 0): string {
  const v = Number.isFinite(value) ? value : 0
  const abs = digits > 0 ? Math.abs(v).toFixed(digits) : String(Math.round(Math.abs(v)))
  return v < 0 ? `-${abs}` : `+${abs}`
}

/** 0~1 比例 -> 百分比文本：0.03 -> "3%" */
export function fmtPct(ratio: number, digits = 0): string {
  const v = Number.isFinite(ratio) ? ratio * 100 : 0
  return `${v.toFixed(digits)}%`
}

/** 秒 -> "mm:ss"（超过一小时也能正常显示） */
export function fmtTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 仅在文本真的变化时才写 DOM，减少无谓的样式/布局开销 */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent === text) return
  node.textContent = text
}

/** 进度条用 transform:scaleX 驱动，缓存上一次比例避免每帧写入 */
export function setBarFill(
  fill: HTMLElement,
  ratio: number,
  cache: WeakMap<HTMLElement, number>,
): void {
  const value = clamp01(ratio)
  const prev = cache.get(fill)
  if (prev !== undefined && Math.abs(prev - value) < 0.0008) return
  cache.set(fill, value)
  fill.style.transform = `scaleX(${value.toFixed(4)})`
}

/** 强制一次样式重排（用于让 CSS 动画重新播放） */
export function restartAnim(host: HTMLElement): void {
  // 读取 offsetWidth 触发 reflow，动画类名重新挂上时才会播放
  void host.offsetWidth
}
