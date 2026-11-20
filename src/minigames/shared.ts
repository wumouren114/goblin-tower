/**
 * 小游戏公共接口、像素画布工具与主题色板解析。
 *
 * 视觉口径：
 * - 统一 4px 像素网格（逻辑画布 120×72，CSS 放大 4 倍至 480×288，最近邻渲染）；
 * - 优先从 document.body.dataset 读取当前场景主题色，缺省按阶段回退到三大层色板；
 * - 所有小游戏均支持 ESC 随时退出（无惩罚，resolve { win: false }）。
 */

export interface MiniGameContext {
  layer: number
  rng: () => number
  stake: number
}

export interface MiniGameResult {
  win: boolean
  score?: number
}

export interface MiniGame {
  id: string
  title: string
  /** 挂载到给定容器；返回 Promise，玩家完成/放弃后 resolve */
  mount(root: HTMLElement, ctx: MiniGameContext): Promise<MiniGameResult>
  /** 主动卸载（ESC 放弃时调用），resolve win:false */
  unmount(): void
}

export interface MiniGamePalette {
  stageName: string
  bg: string
  panel: string
  border: string
  ink: string
  muted: string
  accent: string
  good: string
  warn: string
  bad: string
}

const STAGE_PALETTES: Record<1 | 2 | 3, MiniGamePalette> = {
  // 云上花庭：晴空淡蓝 + 暖金花瓣
  1: {
    stageName: '云上花庭',
    bg: '#162236',
    panel: '#1d2d46',
    border: '#78b8e8',
    ink: '#eef6ff',
    muted: '#9ec4e2',
    accent: '#ffd26b',
    good: '#7ef0b2',
    warn: '#ffbe66',
    bad: '#ff7b89',
  },
  // 星砂观星台：深靛夜空 + 星砂琥珀
  2: {
    stageName: '星砂观星台',
    bg: '#14152b',
    panel: '#1d1f3d',
    border: '#9888e8',
    ink: '#f1efff',
    muted: '#b3abd8',
    accent: '#ffe07d',
    good: '#7ce8d8',
    warn: '#ffbe6b',
    bad: '#ff7a90',
  },
  // 黄铜钟塔：暗铜深褐 + 熔金高光
  3: {
    stageName: '黄铜钟塔',
    bg: '#1e1814',
    panel: '#2b221b',
    border: '#d6a45c',
    ink: '#fbf2e4',
    muted: '#cbb392',
    accent: '#ffcf6e',
    good: '#9be88a',
    warn: '#ffaa55',
    bad: '#ff7369',
  },
}

function isHexColor(v: string | undefined): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())
}

/** 根据层数与 document.body.dataset 解析当前小游戏主题色板 */
export function resolvePalette(stageFallback: 1 | 2 | 3): MiniGamePalette {
  let stage: 1 | 2 | 3 = stageFallback
  const ds = typeof document !== 'undefined' ? document.body?.dataset : undefined
  const rawTheme = ds?.theme ?? ds?.scene ?? ''
  if (rawTheme.includes('stage1')) stage = 1
  else if (rawTheme.includes('stage2')) stage = 2
  else if (rawTheme.includes('stage3')) stage = 3
  else if (ds?.stage === '1' || ds?.stage === '2' || ds?.stage === '3') {
    stage = Number(ds.stage) as 1 | 2 | 3
  }

  const base = { ...STAGE_PALETTES[stage] }
  if (isHexColor(ds?.accent)) base.accent = ds.accent.trim()
  if (isHexColor(ds?.border)) base.border = ds.border.trim()
  return base
}

export const PIXEL_SCALE = 4
export const BOARD_W = 120
export const BOARD_H = 72

export interface MiniGameShell {
  overlay: HTMLDivElement
  canvas: HTMLCanvasElement
  ctx2d: CanvasRenderingContext2D
  statusEl: HTMLDivElement
  hintEl: HTMLDivElement
  controlsEl: HTMLDivElement
  setStatus(text: string, color?: string): void
  destroy(): void
}

const PIXEL_FONT = "'Courier New', 'Microsoft YaHei', 'PingFang SC', monospace"

/** 创建统一 4px 像素风小游戏外壳（居中弹窗 + 像素画布 + 状态/按钮区） */
export function createMiniGameShell(
  root: HTMLElement,
  opts: {
    palette: MiniGamePalette
    title: string
    lore: string
    hint: string
    onAbort: () => void
  },
): MiniGameShell {
  const { palette } = opts

  const overlay = document.createElement('div')
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'background:rgba(8,10,18,0.78)',
    'z-index:920',
    `font-family:${PIXEL_FONT}`,
    `color:${palette.ink}`,
    'user-select:none',
  ].join(';')

  const frame = document.createElement('div')
  frame.style.cssText = [
    'width:min(544px,94vw)',
    `background:${palette.panel}`,
    `border:4px solid ${palette.border}`,
    'box-shadow:0 0 0 4px #090b12, 0 16px 48px rgba(0,0,0,0.65)',
    'padding:16px 20px',
    'box-sizing:border-box',
  ].join(';')

  // 顶栏：阶段名 + 标题 + ESC 退出按钮
  const header = document.createElement('div')
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px'

  const titleWrap = document.createElement('div')
  const kicker = document.createElement('div')
  kicker.textContent = `${palette.stageName} · 塔之称量`
  kicker.style.cssText = `font-size:12px;letter-spacing:2px;color:${palette.muted};margin-bottom:4px`

  const titleEl = document.createElement('div')
  titleEl.textContent = opts.title
  titleEl.style.cssText = `font-size:20px;font-weight:700;color:${palette.accent};letter-spacing:1px`
  titleWrap.append(kicker, titleEl)

  const exitBtn = document.createElement('button')
  exitBtn.type = 'button'
  exitBtn.textContent = 'ESC 离开'
  exitBtn.style.cssText = [
    'cursor:pointer',
    `background:${palette.bg}`,
    `color:${palette.muted}`,
    `border:4px solid ${palette.border}`,
    'padding:4px 10px',
    'font-size:12px',
    `font-family:${PIXEL_FONT}`,
  ].join(';')
  exitBtn.addEventListener('click', opts.onAbort)

  header.append(titleWrap, exitBtn)

  const loreEl = document.createElement('div')
  loreEl.textContent = opts.lore
  loreEl.style.cssText = `font-size:12px;line-height:1.65;color:${palette.muted};margin-bottom:12px`

  // 4px 网格像素画布（120×72 → 480×288）
  const canvasWrap = document.createElement('div')
  canvasWrap.style.cssText = [
    'display:flex',
    'justify-content:center',
    `background:${palette.bg}`,
    `border:4px solid ${palette.border}`,
    'padding:4px',
    'margin-bottom:12px',
  ].join(';')

  const canvas = document.createElement('canvas')
  canvas.width = BOARD_W
  canvas.height = BOARD_H
  canvas.style.cssText = [
    `width:${BOARD_W * PIXEL_SCALE}px`,
    `height:${BOARD_H * PIXEL_SCALE}px`,
    'max-width:100%',
    'height:auto',
    'image-rendering:pixelated',
    'display:block',
  ].join(';')
  canvasWrap.append(canvas)

  const ctx2d = canvas.getContext('2d')
  if (!ctx2d) throw new Error('无法初始化 2D 像素画布')
  ctx2d.imageSmoothingEnabled = false

  const statusEl = document.createElement('div')
  statusEl.style.cssText = `min-height:22px;font-size:13px;font-weight:700;color:${palette.ink};margin-bottom:8px;text-align:center`

  const controlsEl = document.createElement('div')
  controlsEl.style.cssText = 'display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-bottom:8px'

  const hintEl = document.createElement('div')
  hintEl.textContent = opts.hint
  hintEl.style.cssText = `font-size:11px;color:${palette.muted};text-align:center;letter-spacing:0.5px`

  frame.append(header, loreEl, canvasWrap, statusEl, controlsEl, hintEl)
  overlay.append(frame)
  root.append(overlay)

  return {
    overlay,
    canvas,
    ctx2d,
    statusEl,
    hintEl,
    controlsEl,
    setStatus(text: string, color?: string) {
      statusEl.textContent = text
      statusEl.style.color = color ?? palette.ink
    },
    destroy() {
      overlay.remove()
    },
  }
}

/** 创建统一样式的像素按钮 */
export function makePixelButton(
  label: string,
  palette: MiniGamePalette,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.style.cssText = [
    'cursor:pointer',
    `background:${primary ? palette.accent : palette.bg}`,
    `color:${primary ? '#14161f' : palette.ink}`,
    `border:4px solid ${primary ? palette.ink : palette.border}`,
    'padding:6px 14px',
    'font-size:13px',
    'font-weight:700',
    `font-family:${PIXEL_FONT}`,
  ].join(';')
  btn.addEventListener('click', onClick)
  return btn
}

/** 在逻辑像素画布上画整数像素方块（保证 4px 网格锐利） */
export function pxRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h))
}

/** Bresenham 像素直线（避免抗锯齿发虚） */
export function pxLine(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  thickness = 1,
): void {
  let ix0 = Math.round(x0)
  let iy0 = Math.round(y0)
  const ix1 = Math.round(x1)
  const iy1 = Math.round(y1)
  const dx = Math.abs(ix1 - ix0)
  const dy = Math.abs(iy1 - iy0)
  const sx = ix0 < ix1 ? 1 : -1
  const sy = iy0 < iy1 ? 1 : -1
  let err = dx - dy
  const half = Math.floor(thickness / 2)
  ctx.fillStyle = color
  while (true) {
    ctx.fillRect(ix0 - half, iy0 - half, thickness, thickness)
    if (ix0 === ix1 && iy0 === iy1) break
    const e2 = err * 2
    if (e2 > -dy) {
      err -= dy
      ix0 += sx
    }
    if (e2 < dx) {
      err += dx
      iy0 += sy
    }
  }
}

/** 像素圆环 */
export function pxCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  fill = false,
): void {
  const icx = Math.round(cx)
  const icy = Math.round(cy)
  const ir = Math.round(r)
  ctx.fillStyle = color
  for (let y = -ir; y <= ir; y += 1) {
    for (let x = -ir; x <= ir; x += 1) {
      const d2 = x * x + y * y
      if (fill ? d2 <= ir * ir : d2 <= ir * ir && d2 >= (ir - 1) * (ir - 1)) {
        ctx.fillRect(icx + x, icy + y, 1, 1)
      }
    }
  }
}

/** 计算两个角度（度）之间的最小无符号夹角 [0, 180] */
export function angleDiffDeg(a: number, b: number): number {
  let d = ((a - b) % 360 + 540) % 360 - 180
  if (d < 0) d = -d
  return d
}
