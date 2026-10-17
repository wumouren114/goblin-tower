/**
 * 极简像素画布（纯数据，不依赖 DOM / three）。
 *
 * 角色精灵先用这个画布在「逻辑分辨率」下逐像素绘制（主角 32×40、哥布林 28×32、王 52×60），
 * 追加 1px 深色描边后再以最近邻整数倍放大成图集，交给 sprites.ts 包装成 CanvasTexture。
 * 全部程序化绘制、无外部素材。
 */
export class PixelCanvas {
  readonly width: number
  readonly height: number
  /** RGBA8，长度 = width * height * 4 */
  readonly data: Uint8ClampedArray

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }

  /** 单像素写入（颜色 0xRRGGBB，alpha 固定 255） */
  set(x: number, y: number, color: number): void {
    x |= 0
    y |= 0
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = (y * this.width + x) * 4
    this.data[i] = (color >> 16) & 0xff
    this.data[i + 1] = (color >> 8) & 0xff
    this.data[i + 2] = color & 0xff
    this.data[i + 3] = 255
  }

  /** 仅当该像素透明时写入（用于叠加细节，不覆盖已有内容） */
  setIfEmpty(x: number, y: number, color: number): void {
    x |= 0
    y |= 0
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    if (this.data[(y * this.width + x) * 4 + 3] !== 0) return
    this.set(x, y, color)
  }

  getAlpha(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.data[(y * this.width + x) * 4 + 3]
  }

  fill(color: number): void {
    for (let y = 0; y < this.height; y++) this.fillRect(0, y, this.width, 1, color)
  }

  fillRect(x: number, y: number, w: number, h: number, color: number): void {
    x |= 0
    y |= 0
    w |= 0
    h |= 0
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) {
        this.set(xx, yy, color)
      }
    }
  }

  /** 水平线，x0/x1 均包含 */
  hLine(x0: number, x1: number, y: number, color: number): void {
    const a = Math.min(x0, x1)
    const b = Math.max(x0, x1)
    this.fillRect(a, y, b - a + 1, 1, color)
  }

  /** 垂直线，y0/y1 均包含 */
  vLine(x: number, y0: number, y1: number, color: number): void {
    const a = Math.min(y0, y1)
    const b = Math.max(y0, y1)
    this.fillRect(x, a, 1, b - a + 1, color)
  }

  /** 实心椭圆（逐行扫描，保证像素边缘干净） */
  ellipse(cx: number, cy: number, rx: number, ry: number, color: number): void {
    if (rx <= 0 || ry <= 0) return
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const ny = (y + 0.5 - cy) / ry
      const t = 1 - ny * ny
      if (t <= 0) continue
      const half = rx * Math.sqrt(t)
      const x0 = Math.round(cx - half)
      const x1 = Math.round(cx + half) - 1
      if (x1 >= x0) this.hLine(x0, x1, y, color)
    }
  }

  /** 实心圆 */
  circle(cx: number, cy: number, r: number, color: number): void {
    this.ellipse(cx, cy, r, r, color)
  }

  /** 斜线（Bresenham），含端点 */
  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    let x = Math.round(x0)
    let y = Math.round(y0)
    const ex = Math.round(x1)
    const ey = Math.round(y1)
    const dx = Math.abs(ex - x)
    const dy = -Math.abs(ey - y)
    const sx = x < ex ? 1 : -1
    const sy = y < ey ? 1 : -1
    let err = dx + dy
    for (;;) {
      this.set(x, y, color)
      if (x === ex && y === ey) break
      const e2 = 2 * err
      if (e2 >= dy) {
        err += dy
        x += sx
      }
      if (e2 <= dx) {
        err += dx
        y += sy
      }
    }
  }

  /** 三角形（扫描线填充），顶点为像素中心 */
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, color: number): void {
    const minY = Math.floor(Math.min(ay, by, cy))
    const maxY = Math.ceil(Math.max(ay, by, cy))
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area === 0) return
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5
      let lo = Infinity
      let hi = -Infinity
      const edges: [number, number, number, number][] = [
        [ax, ay, bx, by],
        [bx, by, cx, cy],
        [cx, cy, ax, ay],
      ]
      for (const [x0, y0, x1, y1] of edges) {
        if ((y0 <= py && y1 > py) || (y1 <= py && y0 > py)) {
          const t = (py - y0) / (y1 - y0)
          const x = x0 + t * (x1 - x0)
          lo = Math.min(lo, x)
          hi = Math.max(hi, x)
        }
      }
      if (hi > lo) this.hLine(Math.round(lo), Math.round(hi) - 1, y, color)
    }
  }

  /**
   * 给当前内容加 1px 外描边：所有紧贴不透明像素的透明像素涂成 color。
   * 4 邻域，保证描边只有 1px。
   */
  outline(color: number): void {
    const src = new Uint8ClampedArray(this.width * this.height * 4)
    src.set(this.data)
    const edge: number[] = []
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const a = src[(y * this.width + x) * 4 + 3]
        if (a !== 0) continue
        const l = x > 0 ? src[(y * this.width + x - 1) * 4 + 3] : 0
        const r = x < this.width - 1 ? src[(y * this.width + x + 1) * 4 + 3] : 0
        const u = y > 0 ? src[((y - 1) * this.width + x) * 4 + 3] : 0
        const d = y < this.height - 1 ? src[((y + 1) * this.width + x) * 4 + 3] : 0
        if (l !== 0 || r !== 0 || u !== 0 || d !== 0) edge.push(x, y)
      }
    }
    for (let i = 0; i < edge.length; i += 2) this.set(edge[i], edge[i + 1], color)
  }

  /** 水平镜像（用于侧向帧复用：右 → 左） */
  mirrored(): PixelCanvas {
    const out = new PixelCanvas(this.width, this.height)
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const sx = this.width - 1 - x
        const si = (y * this.width + sx) * 4
        const di = (y * this.width + x) * 4
        out.data[di] = this.data[si]
        out.data[di + 1] = this.data[si + 1]
        out.data[di + 2] = this.data[si + 2]
        out.data[di + 3] = this.data[si + 3]
      }
    }
    return out
  }

  /** 把另一张画布贴到 (dx,dy)，alpha 直接覆盖（不做混合，像素画够用） */
  blit(src: PixelCanvas, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const si = (y * src.width + x) * 4
        if (src.data[si + 3] === 0) continue
        const tx = dx + x
        const ty = dy + y
        if (tx < 0 || ty < 0 || tx >= this.width || ty >= this.height) continue
        const di = (ty * this.width + tx) * 4
        this.data[di] = src.data[si]
        this.data[di + 1] = src.data[si + 1]
        this.data[di + 2] = src.data[si + 2]
        this.data[di + 3] = src.data[si + 3]
      }
    }
  }
}

/**
 * 精灵图集数据：cols×rows 个逻辑像素格子。
 * rows 顺序固定为 down / up / left / right，cols 顺序固定为 idleA / idleB / runA / runB。
 */
export interface AtlasData {
  canvas: PixelCanvas
  cols: number
  rows: number
  cellW: number
  cellH: number
  /** worldW/worldH 是「1 倍体型」时的世界尺寸（米），实体再乘自己的 scale */
  worldW: number
  worldH: number
}

export const FRAME_COLS = 4
export const FRAME_ROWS = 4
