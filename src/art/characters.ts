/**
 * 程序化像素角色：主角 / 哥布林 / 哥布林之王。
 *
 * 纯逻辑模块（不 import three / DOM），只输出「逻辑像素图集」AtlasData。
 * 图集固定 4 列 × 4 行：
 *   行（rows）= down / up / left / right
 *   列（cols）= idleA / idleB / runA / runB
 * 每格先独立绘制，再统一加 1px 深色外描边，最后由 sprites.ts 最近邻放大成纹理。
 */
import { PixelCanvas, FRAME_COLS, FRAME_ROWS, type AtlasData } from './pixels.ts'

/* ============================================================
 * 主角：红黑长发冒险者少女（chibi 比例）
 * 32×40 逻辑像素 / 1.75m 世界高度 / 15 色克制调色板
 * ============================================================ */
const PLAYER = {
  outline: 0x140f1b,
  hairDark: 0x2b1022,
  hairMid: 0x521a31,
  hairHi: 0xa02c4a,
  skin: 0xf6cfae,
  skinShade: 0xd9a184,
  cape: 0xf1ebe2,
  capeShade: 0xbfb6ad,
  dress: 0x2b2440,
  trim: 0x9c2a45,
  sock: 0x2b2735,
  sockTop: 0x3f3a4c,
  boot: 0x4b3038,
  eye: 0x5ff5da,
  eyeDark: 0x0d3b3c,
}

interface Pose {
  /** 上半身整体下移（呼吸 / 跑步起伏） */
  bob: number
  /** 上半身横向偏移（跑步侧倾） */
  lean: number
  /** 马尾摆动（-2..2） */
  tail: number
  /** 0 双脚着地；1 左腿抬起；2 右腿抬起（侧向：1 前腿向前、2 后腿向前） */
  legPhase: number
  /** -1/0/1 手臂摆动 */
  armPhase: number
}

function playerPose(frame: number): Pose {
  switch (frame) {
    case 0:
      return { bob: 0, lean: 0, tail: 0, legPhase: 0, armPhase: 0 }
    case 1:
      return { bob: 1, lean: 0, tail: 1, legPhase: 0, armPhase: 0 }
    case 2:
      return { bob: 0, lean: 1, tail: -3, legPhase: 1, armPhase: 2 }
    default:
      return { bob: 1, lean: -1, tail: 3, legPhase: 2, armPhase: -2 }
  }
}

/* ============================================================
 * 主角：正面
 * ============================================================ */

/** 单侧马尾（画在身体后面）：从左侧垂到腰下，跑步时下段甩动 */
function drawPonytailDown(cell: PixelCanvas, sway: number): void {
  const c = PLAYER
  const rows: [number, number, number][] = [
    [9, 10, 2], [10, 9, 3], [11, 8, 4], [12, 7, 4], [13, 6, 4],
    [14, 6, 4], [15, 5, 4], [16, 5, 4], [17, 4, 4], [18, 4, 4],
    [19, 4, 4], [20, 5, 4], [21, 5, 3], [22, 5, 3], [23, 6, 3],
    [24, 6, 2], [25, 7, 2], [26, 7, 2], [27, 8, 1],
  ]
  for (const [y, x0, w] of rows) {
    const d = y >= 12 ? Math.round((sway * (y - 11)) / 15) : 0
    const x = x0 + d
    cell.fillRect(x, y, w, 1, c.hairDark)
    // 受光面：外侧 1px 挑染
    if (y >= 12 && y <= 21) cell.set(x, y, c.hairMid)
    if (y >= 24) cell.set(x, y, c.hairHi)
  }
}

/** 正面披风：只从肩侧露出来，短披风盖住上背 */
function drawCapeDown(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  const rows: [number, number, number][] = [
    [17, 13, 6], [18, 11, 10], [19, 9, 14],
    [20, 9, 14], [21, 10, 12], [22, 11, 10],
  ]
  for (const [y, x, w] of rows) {
    cell.fillRect(x + ox, y + oy, w, 1, y >= 21 ? c.capeShade : c.cape)
  }
  // 肩线提亮 + 下摆红色内衬
  cell.hLine(11 + ox, 20 + ox, 18 + oy, c.cape)
  cell.hLine(12 + ox, 19 + ox, 21 + oy, c.trim)
}

/** 正面躯干：深色短裙连衣 + 红腰带 + 白领 */
function drawTorsoDown(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  cell.fillRect(12 + ox, 18 + oy, 8, 7, c.dress)
  // 白领
  cell.hLine(14 + ox, 17 + ox, 18 + oy, c.cape)
  cell.set(13 + ox, 18 + oy, c.trim)
  cell.set(18 + ox, 18 + oy, c.trim)
  // 胸前披风系带
  cell.set(15 + ox, 19 + oy, c.capeShade)
  cell.set(16 + ox, 19 + oy, c.capeShade)
  // 红腰带 + 金色扣
  cell.hLine(12 + ox, 19 + ox, 24 + oy, c.trim)
  cell.set(15 + ox, 24 + oy, c.hairHi)
  cell.set(16 + ox, 24 + oy, c.hairHi)
  // 衣褶
  cell.vLine(13 + ox, 19 + oy, 23 + oy, c.hairDark)
  cell.vLine(18 + ox, 19 + oy, 23 + oy, c.hairDark)
}

/** 正面手臂：跑步时一前一后摆 */
function drawArmsDown(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  const swing = Math.sign(p.armPhase)
  const lY = -swing
  const rY = swing
  // 左臂
  cell.fillRect(9 + ox, 19 + oy + lY, 2, 4, c.skin)
  cell.fillRect(8 + ox, 23 + oy + lY, 3, 2, c.skin)
  cell.set(9 + ox, 22 + oy + lY, c.skinShade)
  // 右臂
  cell.fillRect(21 + ox, 19 + oy + rY, 2, 4, c.skin)
  cell.fillRect(21 + ox, 23 + oy + rY, 3, 2, c.skin)
  cell.set(22 + ox, 22 + oy + rY, c.skinShade)
}

/** 正面短裙：A 字裙摆 + 红线裙边 */
function drawSkirtDown(cell: PixelCanvas): void {
  const c = PLAYER
  const rows: [number, number, number][] = [
    [25, 12, 8], [26, 11, 10], [27, 11, 10],
    [28, 10, 12], [29, 10, 12],
  ]
  for (const [y, x, w] of rows) cell.fillRect(x, y, w, 1, c.dress)
  cell.hLine(10, 21, 29, c.trim)
  cell.vLine(13, 26, 28, c.hairDark)
  cell.vLine(18, 26, 28, c.hairDark)
  cell.set(15, 28, c.trim)
  cell.set(16, 28, c.trim)
}

/** 单条腿：lifted = 抬腿（跑步帧），否则着地 */
function drawLegDown(cell: PixelCanvas, x: number, lifted: boolean): void {
  const c = PLAYER
  if (lifted) {
    // 大腿
    cell.fillRect(x, 28, 4, 2, c.skin)
    cell.set(x, 29, c.skinShade)
    // 过膝袜
    cell.fillRect(x, 30, 4, 3, c.sock)
    cell.hLine(x, x + 3, 30, c.sockTop)
    // 短靴（离地 4px）
    cell.fillRect(x - 1, 33, 5, 2, c.boot)
    cell.hLine(x - 1, x + 3, 33, c.trim)
    cell.hLine(x - 1, x + 3, 34, c.hairDark)
  } else {
    cell.fillRect(x, 30, 4, 2, c.skin)
    cell.set(x, 31, c.skinShade)
    cell.fillRect(x, 32, 4, 4, c.sock)
    cell.hLine(x, x + 3, 32, c.sockTop)
    cell.fillRect(x - 1, 36, 5, 3, c.boot)
    cell.hLine(x - 1, x + 3, 36, c.trim)
    cell.hLine(x - 1, x + 3, 38, c.hairDark)
  }
}

/** 正面头部：大头、齐刘海、3×2 发光青绿眼睛，最后叠加高光 */
function drawHeadDown(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  const X = (x: number) => x + ox
  const Y = (y: number) => y + oy

  // 后脑头发
  const hair: [number, number, number][] = [
    [3, 13, 6], [4, 11, 10], [5, 10, 12], [6, 9, 14], [7, 9, 14],
    [8, 9, 14], [9, 9, 14], [10, 9, 14], [11, 9, 14], [12, 9, 14],
    [13, 9, 14], [14, 9, 13], [15, 10, 12], [16, 11, 10],
  ]
  for (const [y, x, w] of hair) cell.fillRect(X(x), Y(y), w, 1, c.hairDark)

  // 脸
  cell.fillRect(X(11), Y(8), 10, 7, c.skin)
  cell.fillRect(X(13), Y(15), 6, 1, c.skin)
  cell.fillRect(X(15), Y(16), 2, 1, c.skin)
  cell.vLine(X(20), Y(10), Y(14), c.skinShade)
  cell.set(X(19), Y(15), c.skinShade)

  // 刘海 + 两侧长发
  cell.fillRect(X(10), Y(8), 12, 1, c.hairDark)
  cell.fillRect(X(10), Y(9), 2, 5, c.hairDark)
  cell.fillRect(X(20), Y(9), 2, 5, c.hairDark)
  cell.fillRect(X(9), Y(14), 2, 4, c.hairDark)
  cell.fillRect(X(21), Y(14), 2, 4, c.hairDark)

  // 眼睛（睫毛线 + 竖长瞳孔 + 高光）
  cell.hLine(X(12), X(14), Y(9), c.hairDark)
  cell.hLine(X(17), X(19), Y(9), c.hairDark)
  cell.fillRect(X(12), Y(10), 2, 3, c.eye)
  cell.fillRect(X(17), Y(10), 2, 3, c.eye)
  cell.set(X(12), Y(10), c.cape)
  cell.set(X(17), Y(10), c.cape)
  cell.set(X(13), Y(12), c.eyeDark)
  cell.set(X(18), Y(12), c.eyeDark)

  // 鼻子 / 嘴 / 腮红
  cell.set(X(16), Y(13), c.skinShade)
  cell.hLine(X(15), X(16), Y(14), c.trim)
  cell.set(X(12), Y(13), c.trim)
  cell.set(X(19), Y(13), c.trim)

  // 头发高光（左上受光，不对称）
  cell.hLine(X(13), X(17), Y(3), c.hairMid)
  cell.hLine(X(10), X(12), Y(5), c.hairMid)
  cell.set(X(12), Y(4), c.hairMid)
  cell.set(X(10), Y(6), c.hairMid)
  cell.set(X(11), Y(4), c.hairHi)
  // 呆毛
  cell.set(X(17), Y(2), c.hairHi)
  // 红色发带蝴蝶结（画面左侧）
  cell.fillRect(X(8), Y(5), 3, 1, c.trim)
  cell.set(X(9), Y(4), c.trim)
  cell.set(X(9), Y(6), c.trim)

  // 脖子
  cell.fillRect(X(14), Y(17), 4, 1, c.skin)
}

function drawPlayerDown(cell: PixelCanvas, p: Pose): void {
  drawPonytailDown(cell, p.tail)
  drawCapeDown(cell, p)
  drawLegDown(cell, 11, p.legPhase === 1)
  drawLegDown(cell, 18, p.legPhase === 2)
  drawSkirtDown(cell)
  drawTorsoDown(cell, p)
  drawArmsDown(cell, p)
  drawHeadDown(cell, p)
}

/* ============================================================
 * 主角：背面
 * ============================================================ */
function drawPlayerUp(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  const X = (x: number) => x + ox
  const Y = (y: number) => y + oy

  drawPonytailDown(cell, p.tail)
  drawLegDown(cell, 11, p.legPhase === 1)
  drawLegDown(cell, 18, p.legPhase === 2)
  drawSkirtDown(cell)

  // 披风整个盖住背部
  const cape: [number, number, number][] = [
    [17, 12, 8], [18, 10, 12], [19, 9, 14], [20, 9, 14],
    [21, 10, 12], [22, 11, 10], [23, 12, 8],
  ]
  for (const [y, x, w] of cape) {
    cell.fillRect(X(x), Y(y), w, 1, y >= 21 ? c.capeShade : c.cape)
  }
  cell.vLine(X(16), Y(19), Y(22), c.capeShade)
  // 红边下摆
  cell.hLine(X(12), X(19), Y(23), c.trim)

  // 手臂（与正面同款摆动）
  const swing = Math.sign(p.armPhase)
  const lY = -swing
  const rY = swing
  cell.fillRect(X(8), Y(19) + lY, 2, 5, c.skin)
  cell.fillRect(X(7), Y(23) + lY, 3, 2, c.skin)
  cell.fillRect(X(22), Y(19) + rY, 2, 5, c.skin)
  cell.fillRect(X(21), Y(23) + rY, 3, 2, c.skin)

  // 后脑与垂到背上的头发
  const hair: [number, number, number][] = [
    [3, 13, 6], [4, 11, 10], [5, 10, 12], [6, 9, 14], [7, 9, 14],
    [8, 9, 14], [9, 9, 14], [10, 9, 14], [11, 9, 14], [12, 9, 14],
    [13, 9, 14], [14, 9, 14], [15, 9, 14], [16, 10, 12], [17, 11, 10],
    [18, 12, 8], [19, 13, 6], [20, 14, 4],
  ]
  for (const [y, x, w] of hair) cell.fillRect(X(x), Y(y), w, 1, c.hairDark)

  // 发丝高光
  cell.hLine(X(13), X(17), Y(3), c.hairMid)
  cell.vLine(X(13), Y(6), Y(13), c.hairMid)
  cell.vLine(X(18), Y(8), Y(15), c.hairMid)
  cell.set(X(12), Y(4), c.hairMid)
  cell.set(X(11), Y(5), c.hairHi)
  cell.set(X(16), Y(4), c.hairHi)
  cell.set(X(15), Y(19), c.hairHi)
  // 红色发绳
  cell.fillRect(X(8), Y(11), 3, 2, c.trim)
  cell.set(X(9), Y(13), c.hairMid)
}

/* ============================================================
 * 主角：侧面（画朝右，朝左由 mirrored 得到）
 * ============================================================ */

/** 侧面后脑的马尾：从发根向左后方飘 */
function drawPonytailSide(cell: PixelCanvas, sway: number, oy: number): void {
  const c = PLAYER
  const rows: [number, number, number][] = [
    [8, 10, 3], [9, 9, 4], [10, 8, 4], [11, 7, 4], [12, 7, 4],
    [13, 6, 4], [14, 6, 4], [15, 5, 4], [16, 5, 4], [17, 5, 4],
    [18, 5, 4], [19, 5, 4], [20, 5, 4], [21, 5, 3], [22, 5, 3],
    [23, 6, 2], [24, 6, 2],
  ]
  for (const [y, x0, w] of rows) {
    const d = y >= 10 ? Math.round((sway * (y - 9)) / 15) : 0
    const x = x0 + d
    cell.fillRect(x, y + oy, w, 1, c.hairDark)
    if (y >= 12 && y <= 20) cell.set(x, y + oy, c.hairMid)
    if (y >= 22) cell.set(x, y + oy, c.hairHi)
  }
}

/** 侧面双腿：phase 1 后腿抬起、前腿在前着地；phase 2 前腿抬起、后腿着地 */
function drawLegSide(cell: PixelCanvas, phase: number): void {
  const c = PLAYER
  if (phase === 0) {
    // 后腿
    cell.fillRect(12, 30, 4, 2, c.skin)
    cell.fillRect(12, 32, 4, 4, c.sock)
    cell.hLine(12, 15, 32, c.sockTop)
    cell.fillRect(11, 36, 5, 3, c.boot)
    cell.hLine(11, 15, 36, c.trim)
    cell.hLine(11, 15, 38, c.hairDark)
    // 前腿
    cell.fillRect(18, 30, 4, 2, c.skin)
    cell.fillRect(18, 32, 4, 4, c.sock)
    cell.hLine(18, 21, 32, c.sockTop)
    cell.fillRect(17, 36, 6, 3, c.boot)
    cell.hLine(17, 22, 36, c.trim)
    cell.hLine(17, 22, 38, c.hairDark)
    return
  }
  if (phase === 1) {
    // 后腿抬起、向后蹬
    cell.fillRect(10, 28, 4, 2, c.skin)
    cell.fillRect(10, 30, 4, 3, c.sock)
    cell.hLine(10, 13, 30, c.sockTop)
    cell.fillRect(9, 33, 6, 2, c.boot)
    cell.hLine(9, 14, 33, c.trim)
    cell.hLine(9, 14, 34, c.hairDark)
    // 前腿在前着地
    cell.fillRect(20, 30, 4, 2, c.skin)
    cell.fillRect(20, 32, 4, 4, c.sock)
    cell.hLine(20, 23, 32, c.sockTop)
    cell.fillRect(19, 36, 6, 3, c.boot)
    cell.hLine(19, 24, 36, c.trim)
    cell.hLine(19, 24, 38, c.hairDark)
  } else {
    // 后腿着地
    cell.fillRect(12, 30, 4, 2, c.skin)
    cell.fillRect(12, 32, 4, 4, c.sock)
    cell.hLine(12, 15, 32, c.sockTop)
    cell.fillRect(11, 36, 6, 3, c.boot)
    cell.hLine(11, 16, 36, c.trim)
    cell.hLine(11, 16, 38, c.hairDark)
    // 前腿收起
    cell.fillRect(16, 28, 4, 2, c.skin)
    cell.fillRect(16, 30, 4, 3, c.sock)
    cell.hLine(16, 19, 30, c.sockTop)
    cell.fillRect(15, 33, 6, 2, c.boot)
    cell.hLine(15, 20, 33, c.trim)
    cell.hLine(15, 20, 34, c.hairDark)
  }
}

function drawPlayerSide(cell: PixelCanvas, p: Pose): void {
  const c = PLAYER
  const ox = p.lean
  const oy = p.bob
  const X = (x: number) => x + ox
  const Y = (y: number) => y + oy

  drawPonytailSide(cell, p.tail, oy)
  drawLegSide(cell, p.legPhase)

  // 短裙（后摆更长）
  const skirt: [number, number, number][] = [
    [25, 12, 9], [26, 11, 11], [27, 10, 12], [28, 10, 12], [29, 9, 13],
  ]
  for (const [y, x, w] of skirt) cell.fillRect(x, y, w, 1, c.dress)
  cell.hLine(9, 21, 29, c.trim)
  cell.vLine(12, 26, 28, c.hairDark)

  // 后臂
  cell.fillRect(12, 20, 2, 4, c.skin)
  cell.fillRect(11, 24, 3, 2, c.skin)

  // 披风（向后飘）
  const cape: [number, number, number][] = [
    [18, 13, 8], [19, 11, 10], [20, 9, 12],
    [21, 8, 13], [22, 8, 12], [23, 9, 10],
  ]
  for (const [y, x, w] of cape) {
    cell.fillRect(X(x), Y(y), w, 1, y >= 22 ? c.capeShade : c.cape)
  }
  cell.hLine(X(13), X(20), Y(18), c.cape)

  // 躯干
  cell.fillRect(X(14), Y(18), 7, 7, c.dress)
  cell.hLine(X(15), X(19), Y(18), c.cape)
  cell.hLine(X(14), X(20), Y(24), c.trim)
  cell.vLine(X(16), Y(20), Y(23), c.hairDark)
  // 脖子
  cell.fillRect(X(16), Y(16), 4, 2, c.skin)

  // 前臂（朝行进方向摆）
  const ay = p.armPhase === 1 ? -1 : p.armPhase === -1 ? 1 : 0
  cell.fillRect(X(20), Y(19) + ay, 2, 4, c.skin)
  cell.fillRect(X(20), Y(23) + ay, 3, 2, c.skin)
  cell.set(X(20), Y(22) + ay, c.skinShade)

  // 头部（侧脸）
  const hair: [number, number, number][] = [
    [3, 14, 5], [4, 12, 9], [5, 11, 11], [6, 10, 12], [7, 10, 12],
    [8, 10, 12], [9, 10, 12], [10, 10, 12], [11, 10, 12], [12, 10, 12],
    [13, 10, 11], [14, 10, 11], [15, 11, 10], [16, 12, 8], [17, 13, 6],
  ]
  for (const [y, x, w] of hair) cell.fillRect(X(x), Y(y), w, 1, c.hairDark)

  // 侧脸
  cell.fillRect(X(18), Y(8), 6, 7, c.skin)
  cell.fillRect(X(19), Y(15), 4, 1, c.skin)
  cell.fillRect(X(20), Y(16), 2, 1, c.skin)
  // 鼻尖 / 下巴阴影
  cell.set(X(23), Y(11), c.skin)
  cell.set(X(23), Y(12), c.skinShade)
  cell.set(X(22), Y(15), c.skinShade)

  // 刘海 + 前侧发
  cell.fillRect(X(16), Y(8), 7, 1, c.hairDark)
  cell.fillRect(X(21), Y(9), 2, 3, c.hairDark)
  // 眼睛（侧面一只）
  cell.hLine(X(19), X(21), Y(9), c.hairDark)
  cell.fillRect(X(19), Y(10), 2, 2, c.eye)
  cell.set(X(19), Y(10), c.cape)
  cell.set(X(20), Y(11), c.eyeDark)
  // 腮红 / 嘴
  cell.set(X(21), Y(12), c.trim)
  cell.set(X(22), Y(13), c.trim)
  cell.set(X(22), Y(14), c.skinShade)

  // 高光
  cell.hLine(X(14), X(17), Y(3), c.hairMid)
  cell.set(X(12), Y(4), c.hairMid)
  cell.set(X(11), Y(5), c.hairMid)
  cell.set(X(13), Y(4), c.hairHi)
  cell.set(X(12), Y(5), c.hairHi)
  cell.vLine(X(12), Y(6), Y(12), c.hairMid)
  // 红色发绳
  cell.fillRect(X(11), Y(7), 3, 2, c.trim)
}

/* ============================================================
 * 组装主角图集
 * ============================================================ */
export function buildPlayerAtlas(): AtlasData {
  const cellW = 32
  const cellH = 40
  const canvas = new PixelCanvas(cellW * FRAME_COLS, cellH * FRAME_ROWS)
  const dirs: FacingRow[] = ['down', 'up', 'left', 'right']
  for (let row = 0; row < FRAME_ROWS; row++) {
    const dir = dirs[row]
    for (let frame = 0; frame < FRAME_COLS; frame++) {
      const pose = playerPose(frame)
      let cell: PixelCanvas
      if (dir === 'up') {
        cell = new PixelCanvas(cellW, cellH)
        drawPlayerUp(cell, pose)
      } else if (dir === 'down') {
        cell = new PixelCanvas(cellW, cellH)
        drawPlayerDown(cell, pose)
      } else {
        cell = new PixelCanvas(cellW, cellH)
        drawPlayerSide(cell, pose)
        if (dir === 'left') cell = cell.mirrored()
      }
      cell.outline(PLAYER.outline)
      canvas.blit(cell, frame * cellW, row * cellH)
    }
  }
  return { canvas, cols: FRAME_COLS, rows: FRAME_ROWS, cellW, cellH, worldW: 1.4, worldH: 1.75 }
}

type FacingRow = 'down' | 'up' | 'left' | 'right'

/* ============================================================
 * 哥布林：small / brute / elite
 * 28×32 逻辑像素 / 世界高度 1.0m（实体再乘 def.scale × mul.scale）
 * ============================================================ */
export type GoblinKind = 'small' | 'brute' | 'elite'

const GOBLIN = {
  outline: 0x0f130c,
  skin: 0x7fa844,
  skinDark: 0x50722b,
  skinHi: 0xa9cd63,
  cloth: 0x6b4a2f,
  clothDark: 0x41301e,
  wood: 0x8a5a2e,
  woodDark: 0x53341a,
  tooth: 0xe8e0c4,
  eye: 0xffd23f,
  eyeDark: 0x1a1408,
  metal: 0xb0b6c0,
  metalDark: 0x676d78,
  accent: 0xa23a2f,
}

interface GoblinPose {
  bob: number
  /** 0 双脚着地；1 左腿抬起；2 右腿抬起 */
  legPhase: number
  /** -1/0/1 手臂/木棒摆动 */
  armSwing: number
}

function goblinPose(frame: number): GoblinPose {
  switch (frame) {
    case 0:
      return { bob: 0, legPhase: 0, armSwing: 0 }
    case 1:
      return { bob: 1, legPhase: 0, armSwing: 0 }
    case 2:
      return { bob: 0, legPhase: 1, armSwing: 1 }
    default:
      return { bob: 1, legPhase: 2, armSwing: -1 }
  }
}

function drawGoblinLeg(cell: PixelCanvas, x: number, w: number, lifted: boolean, oy: number): void {
  const c = GOBLIN
  if (lifted) {
    // 抬起的小短腿：脚离地 3px
    cell.fillRect(x, 25 + oy, w, 3, c.skin)
    cell.fillRect(x - 1, 26 + oy, w + 2, 2, c.skinDark)
    for (let i = 0; i < w + 2; i += 2) cell.set(x - 1 + i, 26 + oy, c.skin)
  } else {
    cell.fillRect(x, 25 + oy, w, 4, c.skin)
    cell.fillRect(x - 1, 29 + oy, w + 2, 2, c.skinDark)
    for (let i = 0; i < w + 2; i += 2) cell.set(x - 1 + i, 29 + oy, c.skin)
    cell.set(x, 28 + oy, c.skinDark)
  }
}

function drawGoblinLegs(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  const wide = kind !== 'small'
  const lx = wide ? 8 : 10
  const rx = 16
  const lw = wide ? 5 : 4
  drawGoblinLeg(cell, lx, lw, p.legPhase === 1, p.bob)
  drawGoblinLeg(cell, rx, lw, p.legPhase === 2, p.bob)
}

function drawGoblinTorso(cell: PixelCanvas, kind: GoblinKind, back: boolean, oy: number): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const rows: [number, number, number][] = wide
    ? [[17, 9, 10], [18, 7, 14], [19, 6, 16], [20, 6, 16], [21, 7, 14], [22, 8, 12]]
    : [[17, 10, 8], [18, 9, 10], [19, 8, 12], [20, 8, 12], [21, 8, 12], [22, 9, 10]]
  for (const [y, x, w] of rows) cell.fillRect(x, y + oy, w, 1, c.skin)
  if (back) {
    // 背部脊柱阴影
    cell.vLine(14, 18 + oy, 22 + oy, c.skinDark)
    cell.hLine(wide ? 9 : 11, wide ? 19 : 17, 22 + oy, c.skinDark)
    cell.set(wide ? 7 : 9, 19 + oy, c.skinHi)
  } else {
    // 鼓起的肚皮高光与肚脐
    cell.hLine(wide ? 9 : 10, wide ? 17 : 16, 20 + oy, c.skinHi)
    cell.set(14, 21 + oy, c.skinDark)
    cell.set(wide ? 6 : 8, 19 + oy, c.skinDark)
    cell.set(wide ? 21 : 19, 19 + oy, c.skinDark)
  }
}

function drawGoblinCloth(cell: PixelCanvas, kind: GoblinKind, oy: number): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const rows: [number, number, number][] = wide
    ? [[21, 7, 14], [22, 7, 14], [23, 8, 12], [24, 9, 10]]
    : [[22, 8, 12], [23, 8, 12], [24, 9, 10]]
  for (const [y, x, w] of rows) cell.fillRect(x, y + oy, w, 1, c.cloth)
  // 腰带
  cell.hLine(wide ? 7 : 8, wide ? 20 : 19, rows[0][0] + oy, c.clothDark)
  // 破布尖角
  const tips = wide ? [8, 11, 14, 17, 20] : [9, 12, 15, 18]
  for (const x of tips) cell.set(x, 25 + oy, c.cloth)
  cell.set(wide ? 13 : 14, 26 + oy, c.cloth)
}

/** 哥布林的木棒：up = 斜举过头顶；down = 拄在身前地上（侧面用） */
function drawGoblinClub(cell: PixelCanvas, hx: number, hy: number, big: boolean, mode: 'up' | 'down' = 'up'): void {
  const c = GOBLIN
  const len = big ? 12 : 9
  const cx = hx + (mode === 'up' ? (big ? 4 : 3) : 3)
  const cy = mode === 'up' ? hy - len : hy + 4
  // 2px 粗的木柄：外侧一根暗色，内侧一根亮色，显出圆柱感
  cell.line(hx, hy, cx, cy, c.woodDark)
  cell.line(hx + 1, hy, cx + 1, cy, c.wood)
  // 缠柄的破布
  cell.set(hx, hy - 2, c.clothDark)
  cell.set(hx + 1, hy - 3, c.clothDark)
  if (mode === 'up') cell.set(hx + 1, hy - 5, c.clothDark)
  // 木瘤（暗底 + 亮心 + 高光）
  const r = big ? 3 : 2
  cell.ellipse(cx, cy, r, r, c.woodDark)
  cell.ellipse(cx, cy - 1, r - 1, r - 1, c.wood)
  cell.set(cx - 1, cy - 2, c.wood)
  // 钉在木瘤上的木刺
  cell.set(cx + r + 1, cy - 1, c.woodDark)
  cell.set(cx - r, cy + 1, c.woodDark)
  cell.set(cx, cy - r - 1, c.woodDark)
}

function drawGoblinArms(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose, withClub: boolean): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const oy = p.bob
  const swing = p.armSwing
  if (wide) {
    // 左臂
    cell.fillRect(4, 18 + oy, 3, 5, c.skin)
    cell.fillRect(3, 23 + oy - swing, 4, 2, c.skin)
    cell.set(3, 24 + oy - swing, c.skinDark)
    // 右臂
    cell.fillRect(21, 18 + oy, 3, 5, c.skin)
    cell.fillRect(21, 23 + oy + swing, 4, 2, c.skin)
    cell.set(24, 24 + oy + swing, c.skinDark)
    if (withClub) drawGoblinClub(cell, 22, 24 + oy + swing, kind === 'brute')
  } else {
    cell.fillRect(6, 18 + oy, 2, 5, c.skin)
    cell.fillRect(5, 23 + oy - swing, 3, 2, c.skin)
    cell.set(5, 24 + oy - swing, c.skinDark)
    cell.fillRect(20, 18 + oy, 2, 5, c.skin)
    cell.fillRect(20, 23 + oy + swing, 3, 2, c.skin)
    cell.set(22, 24 + oy + swing, c.skinDark)
    if (withClub) drawGoblinClub(cell, 21, 24 + oy + swing, false)
  }
}

function drawPauldrons(cell: PixelCanvas, kind: GoblinKind, mode: 'full' | 'near' = 'full'): void {
  if (kind !== 'elite') return
  const c = GOBLIN
  // 金属护肩：扣在上臂最外侧的圆顶护甲
  if (mode === 'full') {
    cell.ellipse(4, 20, 2, 2, c.metal)
    cell.hLine(2, 6, 21, c.metalDark)
    cell.set(4, 19, c.tooth)
  }
  cell.ellipse(mode === 'full' ? 24 : 20, 20, 2, 2, c.metal)
  cell.hLine(mode === 'full' ? 22 : 18, mode === 'full' ? 26 : 22, 21, c.metalDark)
  cell.set(mode === 'full' ? 24 : 20, 19, c.tooth)
}

function drawGoblinHeadDown(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const oy = p.bob

  // 尖耳（先画，头骨压住耳根）
  if (wide) {
    cell.triangle(8, 8 + oy, 1, 10 + oy, 8, 14 + oy, c.skin)
    cell.triangle(19, 8 + oy, 26, 10 + oy, 19, 14 + oy, c.skin)
    cell.triangle(8, 9 + oy, 3, 10 + oy, 8, 13 + oy, c.skinDark)
    cell.triangle(19, 9 + oy, 24, 10 + oy, 19, 13 + oy, c.skinDark)
  } else {
    cell.triangle(9, 8 + oy, 1, 10 + oy, 9, 14 + oy, c.skin)
    cell.triangle(18, 8 + oy, 27, 10 + oy, 18, 14 + oy, c.skin)
    cell.triangle(9, 9 + oy, 3, 10 + oy, 9, 13 + oy, c.skinDark)
    cell.triangle(18, 9 + oy, 25, 10 + oy, 18, 13 + oy, c.skinDark)
  }

  // 头骨
  const rows: [number, number, number][] = wide
    ? [
        [5, 10, 6], [6, 8, 12], [7, 7, 14], [8, 6, 16], [9, 5, 18],
        [10, 5, 18], [11, 5, 18], [12, 5, 18], [13, 5, 18], [14, 6, 16],
        [15, 7, 14], [16, 8, 12], [17, 9, 10], [18, 10, 8],
      ]
    : [
        [5, 12, 4], [6, 10, 8], [7, 9, 10], [8, 8, 12], [9, 7, 14],
        [10, 7, 14], [11, 7, 14], [12, 7, 14], [13, 7, 14], [14, 8, 12],
        [15, 9, 10], [16, 10, 8], [17, 11, 6], [18, 12, 4],
      ]
  for (const [y, x, w] of rows) cell.fillRect(x, y + oy, w, 1, c.skin)

  // 头顶高光 + 眉骨阴影
  cell.hLine(wide ? 11 : 12, wide ? 13 : 14, 6 + oy, c.skinHi)
  cell.set(wide ? 8 : 10, 7 + oy, c.skinHi)
  cell.hLine(wide ? 7 : 9, wide ? 11 : 11, 9 + oy, c.skinDark)
  cell.hLine(wide ? 16 : 16, wide ? 21 : 19, 9 + oy, c.skinDark)

  // 眼睛（黄底黑瞳）
  const eyeL = wide ? 8 : 9
  const eyeR = wide ? 17 : 16
  cell.fillRect(eyeL, 10 + oy, 3, 2, c.eye)
  cell.fillRect(eyeR, 10 + oy, 3, 2, c.eye)
  cell.set(eyeL + 1, 11 + oy, c.eyeDark)
  cell.set(eyeR + 1, 11 + oy, c.eyeDark)
  cell.set(eyeL, 10 + oy, c.tooth)
  cell.set(eyeR, 10 + oy, c.tooth)

  // 鼻子
  cell.fillRect(13, 12 + oy, 3, 2, c.skin)
  cell.set(13, 14 + oy, c.skinDark)
  cell.set(15, 14 + oy, c.skinDark)

  // 咧嘴（深色口腔 + 几颗牙 + 两颗下獠牙）
  const m0 = wide ? 9 : 10
  const m1 = wide ? 18 : 17
  cell.hLine(m0, m1, 15 + oy, c.eyeDark)
  cell.hLine(m0, m1, 16 + oy, c.eyeDark)
  cell.set(m0 + 3, 15 + oy, c.tooth)
  cell.set(m0 + 4, 15 + oy, c.tooth)
  cell.set(m0, 16 + oy, c.tooth)
  cell.set(m1, 16 + oy, c.tooth)
  // 下巴阴影
  cell.hLine(m0, m1, 17 + oy, c.skinDark)
}

function drawGoblinHeadUp(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const oy = p.bob
  if (wide) {
    cell.triangle(8, 8 + oy, 1, 10 + oy, 8, 14 + oy, c.skin)
    cell.triangle(19, 8 + oy, 26, 10 + oy, 19, 14 + oy, c.skin)
    cell.triangle(8, 9 + oy, 3, 10 + oy, 8, 13 + oy, c.skinDark)
    cell.triangle(19, 9 + oy, 24, 10 + oy, 19, 13 + oy, c.skinDark)
  } else {
    cell.triangle(9, 8 + oy, 1, 10 + oy, 9, 14 + oy, c.skin)
    cell.triangle(18, 8 + oy, 27, 10 + oy, 18, 14 + oy, c.skin)
    cell.triangle(9, 9 + oy, 3, 10 + oy, 9, 13 + oy, c.skinDark)
    cell.triangle(18, 9 + oy, 25, 10 + oy, 18, 13 + oy, c.skinDark)
  }
  const rows: [number, number, number][] = wide
    ? [
        [5, 10, 6], [6, 8, 12], [7, 7, 14], [8, 6, 16], [9, 5, 18],
        [10, 5, 18], [11, 5, 18], [12, 5, 18], [13, 5, 18], [14, 6, 16],
        [15, 7, 14], [16, 8, 12], [17, 9, 10], [18, 10, 8], [19, 11, 6],
      ]
    : [
        [5, 12, 4], [6, 10, 8], [7, 9, 10], [8, 8, 12], [9, 7, 14],
        [10, 7, 14], [11, 7, 14], [12, 7, 14], [13, 7, 14], [14, 8, 12],
        [15, 9, 10], [16, 10, 8], [17, 11, 6], [18, 12, 4],
      ]
  for (const [y, x, w] of rows) cell.fillRect(x, y + oy, w, 1, c.skin)
  // 后脑高光与头皮的横向褶皱
  cell.hLine(wide ? 11 : 12, wide ? 14 : 15, 6 + oy, c.skinHi)
  cell.hLine(wide ? 10 : 12, wide ? 18 : 16, 9 + oy, c.skinDark)
  cell.hLine(wide ? 12 : 13, wide ? 16 : 15, 13 + oy, c.skinDark)
  cell.hLine(wide ? 12 : 13, wide ? 16 : 15, 17 + oy, c.skinDark)
}

function drawGoblinDown(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  drawGoblinLegs(cell, kind, p)
  drawGoblinTorso(cell, kind, false, p.bob)
  drawGoblinCloth(cell, kind, p.bob)
  drawGoblinArms(cell, kind, p, true)
  drawGoblinHeadDown(cell, kind, p)
  drawPauldrons(cell, kind)
}

function drawGoblinUp(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  drawGoblinLegs(cell, kind, p)
  drawGoblinTorso(cell, kind, true, p.bob)
  drawGoblinCloth(cell, kind, p.bob)
  drawGoblinArms(cell, kind, p, true)
  drawGoblinHeadUp(cell, kind, p)
  drawPauldrons(cell, kind)
}

/* ---------- 哥布林：侧面（朝右） ---------- */
function drawGoblinSide(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  const c = GOBLIN
  const wide = kind !== 'small'
  const oy = p.bob

  // 后耳
  cell.triangle(12, 8 + oy, 3, 10 + oy, 12, 14 + oy, c.skin)
  cell.triangle(12, 9 + oy, 6, 10 + oy, 12, 13 + oy, c.skinDark)

  // 后腿
  if (p.legPhase === 1) {
    cell.fillRect(10, 25 + oy, 4, 3, c.skin)
    cell.fillRect(9, 26 + oy, 6, 2, c.skinDark)
  } else {
    cell.fillRect(10, 25 + oy, 4, 4, c.skin)
    cell.fillRect(9, 29 + oy, 6, 2, c.skinDark)
  }
  // 躯干（弓背）
  const body: [number, number, number][] = wide
    ? [[17, 12, 8], [18, 10, 11], [19, 9, 13], [20, 9, 14], [21, 10, 13], [22, 11, 12], [23, 12, 10]]
    : [[17, 13, 7], [18, 11, 9], [19, 10, 11], [20, 10, 12], [21, 11, 11], [22, 12, 10], [23, 13, 8]]
  for (const [y, x, w] of body) cell.fillRect(x, y + oy, w, 1, c.skin)
  // 弓起的背
  cell.vLine(wide ? 10 : 11, 18 + oy, 22 + oy, c.skinDark)
  cell.hLine(wide ? 13 : 14, wide ? 21 : 20, 20 + oy, c.skinHi)
  // 布裙
  const cloth: [number, number, number][] = wide
    ? [[22, 11, 12], [23, 11, 12], [24, 12, 10]]
    : [[22, 12, 10], [23, 12, 10], [24, 13, 8]]
  for (const [y, x, w] of cloth) cell.fillRect(x, y + oy, w, 1, c.cloth)
  cell.hLine(cloth[0][1], cloth[0][1] + cloth[0][2] - 1, cloth[0][0] + oy, c.clothDark)
  for (const x of wide ? [12, 15, 18, 21] : [13, 16, 19]) cell.set(x, 25 + oy, c.cloth)

  // 前腿
  if (p.legPhase === 2) {
    cell.fillRect(16, 25 + oy, 4, 3, c.skin)
    cell.fillRect(15, 26 + oy, 6, 2, c.skinDark)
  } else {
    cell.fillRect(18, 25 + oy, 4, 4, c.skin)
    cell.fillRect(17, 29 + oy, 6, 2, c.skinDark)
  }

  // 前臂 + 木棒
  const swing = p.armSwing
  cell.fillRect(21, 20 + oy, 2, 4, c.skin)
  cell.fillRect(22, 23 + oy + swing, 3, 2, c.skin)
  drawGoblinClub(cell, 23, 24 + oy + swing, wide, 'down')
  // 后臂
  cell.fillRect(12, 20 + oy, 2, 4, c.skin)
  cell.fillRect(11, 24 + oy, 3, 2, c.skin)

  // 头部（侧脸）
  const skull: [number, number, number][] = wide
    ? [[5, 12, 7], [6, 10, 11], [7, 9, 13], [8, 8, 15], [9, 8, 15], [10, 8, 15], [11, 8, 15], [12, 8, 15], [13, 8, 15], [14, 9, 14], [15, 10, 12], [16, 11, 10], [17, 12, 8]]
    : [[5, 13, 5], [6, 11, 9], [7, 10, 11], [8, 9, 13], [9, 9, 13], [10, 9, 13], [11, 9, 13], [12, 9, 13], [13, 9, 13], [14, 10, 12], [15, 11, 10], [16, 12, 8], [17, 13, 6]]
  for (const [y, x, w] of skull) cell.fillRect(x, y + oy, w, 1, c.skin)
  // 突出的口鼻
  cell.fillRect(wide ? 20 : 19, 10 + oy, 4, 5, c.skin)
  cell.triangle(wide ? 24 : 23, 10 + oy, 26, 12 + oy, wide ? 24 : 23, 14 + oy, c.skin)
  // 鼻尖 / 下颚
  cell.set(wide ? 25 : 25, 12 + oy, c.skinDark)
  cell.fillRect(wide ? 20 : 19, 15 + oy, 5, 1, c.skin)
  cell.set(wide ? 20 : 19, 16 + oy, c.skinDark)
  // 眼睛
  cell.fillRect(20, 10 + oy, 2, 2, c.eye)
  cell.set(21, 11 + oy, c.eyeDark)
  cell.set(20, 10 + oy, c.tooth)
  cell.hLine(19, 21, 9 + oy, c.skinDark)
  // 咧嘴 + 牙
  const my = 15 + oy
  cell.hLine(20, 24, my, c.eyeDark)
  cell.set(21, my, c.tooth)
  cell.set(22, my, c.tooth)
  cell.set(20, my + 1, c.tooth)
  cell.set(24, my + 1, c.tooth)
  // 头顶高光
  cell.hLine(wide ? 12 : 13, wide ? 15 : 15, 6 + oy, c.skinHi)
  cell.set(wide ? 9 : 10, 8 + oy, c.skinHi)

  drawPauldrons(cell, kind, 'near')
}

export function buildGoblinAtlas(kind: GoblinKind): AtlasData {
  const cellW = 28
  const cellH = 32
  const canvas = new PixelCanvas(cellW * FRAME_COLS, cellH * FRAME_ROWS)
  const dirs: FacingRow[] = ['down', 'up', 'left', 'right']
  for (let row = 0; row < FRAME_ROWS; row++) {
    const dir = dirs[row]
    for (let frame = 0; frame < FRAME_COLS; frame++) {
      const pose = goblinPose(frame)
      let cell: PixelCanvas
      if (dir === 'up') {
        cell = new PixelCanvas(cellW, cellH)
        drawGoblinUp(cell, kind, pose)
      } else if (dir === 'down') {
        cell = new PixelCanvas(cellW, cellH)
        drawGoblinDown(cell, kind, pose)
      } else {
        cell = new PixelCanvas(cellW, cellH)
        drawGoblinSide(cell, kind, pose)
        if (dir === 'left') cell = cell.mirrored()
      }
      cell.outline(GOBLIN.outline)
      canvas.blit(cell, frame * cellW, row * cellH)
    }
  }
  return { canvas, cols: FRAME_COLS, rows: FRAME_ROWS, cellW, cellH, worldW: 0.9, worldH: 1.0 }
}

/* ============================================================
 * 哥布林之王：52×60 逻辑像素 / 世界高度 2.2m
 * 金冠、烂披风、巨斧、驼背巨躯，站立时有呼吸起伏
 * ============================================================ */
const KING = {
  outline: 0x0d120c,
  skin: 0x6c9640,
  skinDark: 0x47652a,
  skinHi: 0x93bb58,
  cloth: 0x5b3f28,
  wood: 0x7a4b26,
  woodDark: 0x4a2d15,
  cape: 0x6e2430,
  capeDark: 0x451520,
  gold: 0xf2c14e,
  goldHi: 0xffe6a0,
  goldDark: 0xa8781f,
  metal: 0x9aa2b0,
  metalDark: 0x565c66,
  tooth: 0xece4c8,
  eye: 0xffcf3d,
}

interface KingPose {
  bob: number
  /** 0 双脚着地；1 左腿抬起；2 右腿抬起 */
  legPhase: number
  /** -1/0/1 手臂与巨斧摆动 */
  axeSwing: number
}

function kingPose(frame: number): KingPose {
  switch (frame) {
    case 0:
      return { bob: 0, legPhase: 0, axeSwing: 0 }
    case 1:
      return { bob: 1, legPhase: 0, axeSwing: 0 }
    case 2:
      return { bob: 0, legPhase: 1, axeSwing: 1 }
    default:
      return { bob: 1, legPhase: 2, axeSwing: -1 }
  }
}

/** 按 [起始行, x, 宽] 的阶梯表铺满到下一行（像素风的块状轮廓） */
function fillSpans(cell: PixelCanvas, spans: [number, number, number][], color: number, oy = 0): void {
  for (let i = 0; i < spans.length; i++) {
    const [y, x, w] = spans[i]
    const next = i + 1 < spans.length ? spans[i + 1][0] : y + 1
    for (let yy = y; yy < next; yy++) cell.fillRect(x, yy + oy, w, 1, color)
  }
}

/* ---------- 王的烂披风 ---------- */
function drawKingCapeDown(cell: PixelCanvas, bob: number): void {
  const c = KING
  const spans: [number, number, number][] = [
    [16, 18, 16], [18, 12, 28], [20, 8, 36], [22, 7, 38],
    [32, 7, 38], [34, 8, 36], [36, 9, 34], [38, 10, 32],
    [40, 11, 30], [42, 12, 28], [44, 13, 26], [46, 14, 24],
    [48, 16, 20], [50, 18, 16], [52, 20, 12],
  ]
  fillSpans(cell, spans, c.cape, bob)
  // 外缘与纵向褶皱压暗
  for (const [y, x, w] of spans) {
    cell.set(x, y + bob, c.capeDark)
    cell.set(x + w - 1, y + bob, c.capeDark)
  }
  cell.vLine(10, 22 + bob, 40 + bob, c.capeDark)
  cell.vLine(41, 22 + bob, 40 + bob, c.capeDark)
  cell.vLine(13, 24 + bob, 38 + bob, c.capeDark)
  cell.vLine(38, 24 + bob, 38 + bob, c.capeDark)
  // 下摆的破口
  for (const x of [20, 23, 26, 29, 32]) cell.set(x, 52 + bob, c.capeDark)
  cell.set(8, 23 + bob, c.goldDark)
  cell.set(42, 23 + bob, c.goldDark)
}

/* ---------- 王的身体 ---------- */
function drawKingBody(cell: PixelCanvas, back: boolean, bob: number): void {
  const c = KING
  const oy = bob
  const spans: [number, number, number][] = [
    [24, 17, 18], [25, 15, 22], [26, 14, 24], [28, 14, 24],
    [29, 13, 26], [30, 12, 28], [31, 12, 28], [33, 12, 28],
    [35, 12, 28], [36, 13, 26], [37, 13, 26], [38, 14, 24],
    [39, 15, 22], [40, 16, 20], [41, 17, 18], [42, 18, 16],
  ]
  fillSpans(cell, spans, c.skin, oy)
  if (back) {
    // 背部：脊柱沟 + 肩胛
    cell.vLine(26, 25 + oy, 42 + oy, c.skinDark)
    cell.hLine(18, 34, 30 + oy, c.skinDark)
    cell.hLine(19, 33, 38 + oy, c.skinDark)
    cell.set(16, 26 + oy, c.skinHi)
    cell.set(35, 26 + oy, c.skinHi)
  } else {
    // 胸肌 + 大肚子
    cell.hLine(18, 34, 28 + oy, c.skinDark)
    cell.vLine(26, 28 + oy, 32 + oy, c.skinDark)
    cell.ellipse(26, 35 + oy, 8, 5, c.skinHi)
    cell.hLine(20, 32, 36 + oy, c.skinDark)
    cell.hLine(21, 31, 38 + oy, c.skinDark)
    cell.set(26, 34 + oy, c.skinDark)
    // 旧伤疤
    cell.line(17, 30 + oy, 21, 34 + oy, c.skinDark)
    cell.line(35, 31 + oy, 38, 34 + oy, c.skinDark)
  }
  // 腰布
  const cloth: [number, number, number][] = [
    [43, 17, 18], [44, 16, 20], [45, 16, 20], [46, 17, 18], [47, 18, 16],
  ]
  for (const [y, x, w] of cloth) cell.fillRect(x, y + oy, w, 1, c.cloth)
  cell.hLine(17, 34, 43 + oy, c.woodDark)
  cell.fillRect(24, 43 + oy, 4, 1, c.gold)
  cell.set(24, 43 + oy, c.goldHi)
  cell.set(27, 43 + oy, c.goldDark)
  // 破布尖角
  for (const x of [18, 22, 26, 30, 34]) cell.set(x, 48 + oy, c.cloth)
  cell.set(24, 49 + oy, c.cloth)
  cell.set(29, 49 + oy, c.cloth)
}

function drawKingLegs(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  const liftL = p.legPhase === 1
  const liftR = p.legPhase === 2
  // 左腿
  cell.fillRect(17, 46 + oy, 8, liftL ? 5 : 8, c.skin)
  cell.set(17, 47 + oy, c.skinDark)
  cell.set(24, 48 + oy, c.skinDark)
  if (liftL) {
    cell.fillRect(15, 51 + oy, 12, 3, c.skin)
    cell.hLine(15, 26, 53 + oy, c.skinDark)
  } else {
    cell.fillRect(14, 53 + oy, 12, 3, c.skin)
    cell.hLine(14, 25, 53 + oy, c.skinDark)
    cell.set(17, 55 + oy, c.skinDark)
    cell.set(21, 55 + oy, c.skinDark)
  }
  // 右腿
  cell.fillRect(29, 46 + oy, 8, liftR ? 5 : 8, c.skin)
  cell.set(36, 47 + oy, c.skinDark)
  cell.set(29, 48 + oy, c.skinDark)
  if (liftR) {
    cell.fillRect(27, 51 + oy, 12, 3, c.skin)
    cell.hLine(27, 38, 53 + oy, c.skinDark)
  } else {
    cell.fillRect(28, 53 + oy, 12, 3, c.skin)
    cell.hLine(28, 39, 53 + oy, c.skinDark)
    cell.set(31, 55 + oy, c.skinDark)
    cell.set(35, 55 + oy, c.skinDark)
  }
}

function drawKingArms(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  const s = p.axeSwing
  // 左臂（垂在身侧）
  cell.fillRect(6, 29 + oy, 9, 8, c.skin)
  cell.fillRect(4, 36 + oy, 9, 8, c.skin)
  cell.set(4, 37 + oy, c.skinDark)
  cell.hLine(6, 12, 33 + oy, c.skinHi)
  cell.fillRect(3, 43 + oy, 9, 3, c.skin)
  for (const x of [3, 6, 9]) cell.set(x, 46 + oy, c.skinDark)
  // 右臂（握斧）
  cell.fillRect(37, 29 + oy, 9, 7, c.skin)
  cell.fillRect(39, 35 + oy - s, 8, 9, c.skin)
  cell.set(46, 36 + oy - s, c.skinDark)
  cell.fillRect(40, 43 + oy - s, 8, 3, c.skin)
}

/* ---------- 王的巨斧（正面/背面：竖握在右侧，刃朝外） ---------- */
function drawKingAxe(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  const s = p.axeSwing
  const hx = 43
  const hy = 44 + oy - s
  const ty = 14 + oy - s
  // 斧柄
  cell.vLine(hx, ty, hy, c.woodDark)
  cell.vLine(hx + 1, ty, hy, c.wood)
  // 缠柄皮条
  for (let y = hy; y > ty + 8; y -= 4) {
    cell.set(hx, y, c.cloth)
    cell.set(hx + 1, y - 2, c.cloth)
  }
  // 斧刃：厚背薄刃，刃口朝外（右）
  cell.triangle(hx + 1, ty + 1, 49, ty - 2, 50, ty + 6, c.metalDark)
  cell.triangle(hx + 1, ty + 1, 50, ty + 6, hx + 1, ty + 12, c.metalDark)
  cell.triangle(hx + 1, ty + 12, 50, ty + 6, 47, ty + 14, c.metalDark)
  // 刃面受光
  cell.line(49, ty - 2, 50, ty + 6, c.metal)
  cell.line(50, ty + 6, 47, ty + 14, c.metal)
  cell.set(48, ty, c.metal)
  cell.set(48, ty + 4, c.metal)
  // 雪亮的刃口
  cell.line(50, ty + 1, 50, ty + 6, c.tooth)
  cell.line(50, ty + 6, 47, ty + 13, c.tooth)
  // 斧背尖刺（上、下）
  cell.triangle(hx + 1, ty + 1, hx + 5, ty - 5, hx + 4, ty + 3, c.metal)
  cell.triangle(hx + 1, ty + 12, 47, ty + 14, hx + 2, ty + 17, c.metalDark)
  // 金色加固环
  cell.fillRect(hx - 2, ty, 5, 4, c.gold)
  cell.hLine(hx - 2, hx + 2, ty + 3, c.goldDark)
  cell.set(hx - 1, ty, c.goldHi)
}

/* ---------- 王的头部（正面） ---------- */
function drawKingHeadDown(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  // 大耳朵
  cell.triangle(15, 14 + oy, 2, 18 + oy, 15, 25 + oy, c.skin)
  cell.triangle(37, 14 + oy, 50, 18 + oy, 37, 25 + oy, c.skin)
  cell.triangle(15, 16 + oy, 7, 18 + oy, 15, 23 + oy, c.skinDark)
  cell.triangle(37, 16 + oy, 45, 18 + oy, 37, 23 + oy, c.skinDark)
  // 头骨
  const spans: [number, number, number][] = [
    [9, 22, 8], [10, 19, 14], [11, 17, 18], [12, 16, 20],
    [14, 14, 24], [16, 13, 26], [18, 13, 26], [20, 13, 26],
    [22, 13, 26], [24, 15, 22], [25, 16, 20], [26, 17, 18], [28, 20, 12],
  ]
  fillSpans(cell, spans, c.skin, oy)
  // 眉骨 / 头骨高光
  cell.hLine(19, 33, 10 + oy, c.skinHi)
  cell.hLine(14, 22, 17 + oy, c.skinDark)
  cell.hLine(30, 38, 17 + oy, c.skinDark)
  // 发光的黄眼
  cell.fillRect(16, 18 + oy, 4, 3, c.eye)
  cell.fillRect(32, 18 + oy, 4, 3, c.eye)
  cell.set(18, 19 + oy, c.outline)
  cell.set(18, 20 + oy, c.outline)
  cell.set(34, 19 + oy, c.outline)
  cell.set(34, 20 + oy, c.outline)
  cell.set(16, 18 + oy, c.tooth)
  cell.set(32, 18 + oy, c.tooth)
  // 鼻子
  cell.fillRect(23, 21 + oy, 6, 2, c.skin)
  cell.fillRect(22, 23 + oy, 8, 2, c.skin)
  cell.hLine(23, 28, 22 + oy, c.skinHi)
  cell.set(23, 25 + oy, c.skinDark)
  cell.set(28, 25 + oy, c.skinDark)
  // 大嘴 + 牙
  cell.hLine(17, 35, 27 + oy, c.outline)
  cell.hLine(17, 35, 28 + oy, c.outline)
  for (const x of [19, 23, 27, 31]) cell.set(x, 27 + oy, c.tooth)
  cell.set(19, 28 + oy, c.tooth)
  cell.set(33, 27 + oy, c.tooth)
  cell.set(33, 28 + oy, c.tooth)
  // 獠牙
  cell.set(17, 26 + oy, c.tooth)
  cell.set(35, 26 + oy, c.tooth)
  cell.hLine(20, 32, 29 + oy, c.skinDark)
  // 王冠
  drawKingCrown(cell, oy)
}

function drawKingCrown(cell: PixelCanvas, oy: number): void {
  const c = KING
  cell.fillRect(18, 6 + oy, 16, 4, c.gold)
  cell.hLine(18, 33, 9 + oy, c.goldDark)
  cell.hLine(18, 33, 6 + oy, c.goldHi)
  // 三根尖
  cell.triangle(18, 7 + oy, 20, 1 + oy, 22, 7 + oy, c.gold)
  cell.triangle(24, 7 + oy, 26, 0 + oy, 28, 7 + oy, c.gold)
  cell.triangle(30, 7 + oy, 32, 2 + oy, 34, 7 + oy, c.gold)
  cell.set(20, 3 + oy, c.goldHi)
  cell.set(26, 2 + oy, c.goldHi)
  cell.set(32, 4 + oy, c.goldHi)
  // 宝石与铆钉
  cell.set(26, 7 + oy, c.cape)
  cell.set(26, 8 + oy, c.goldDark)
  for (const x of [20, 23, 29, 32]) cell.set(x, 8 + oy, c.goldDark)
}

/* ---------- 王的头部（背面） ---------- */
function drawKingHeadUp(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  cell.triangle(15, 14 + oy, 2, 18 + oy, 15, 25 + oy, c.skin)
  cell.triangle(37, 14 + oy, 50, 18 + oy, 37, 25 + oy, c.skin)
  cell.triangle(15, 16 + oy, 7, 18 + oy, 15, 23 + oy, c.skinDark)
  cell.triangle(37, 16 + oy, 45, 18 + oy, 37, 23 + oy, c.skinDark)
  const spans: [number, number, number][] = [
    [9, 22, 8], [10, 19, 14], [11, 17, 18], [12, 16, 20],
    [14, 14, 24], [16, 13, 26], [18, 13, 26], [20, 13, 26],
    [22, 13, 26], [24, 15, 22], [25, 16, 20], [26, 17, 18], [28, 20, 12],
  ]
  fillSpans(cell, spans, c.skin, oy)
  // 后脑褶皱与高光
  cell.hLine(19, 33, 10 + oy, c.skinHi)
  cell.hLine(17, 35, 16 + oy, c.skinDark)
  cell.hLine(18, 34, 21 + oy, c.skinDark)
  cell.hLine(19, 33, 25 + oy, c.skinDark)
  cell.set(26, 12 + oy, c.skinHi)
  // 王冠从背后可见的部分
  cell.fillRect(18, 6 + oy, 16, 4, c.gold)
  cell.hLine(18, 33, 9 + oy, c.goldDark)
  cell.hLine(18, 33, 6 + oy, c.goldHi)
  cell.triangle(18, 7 + oy, 20, 1 + oy, 22, 7 + oy, c.gold)
  cell.triangle(24, 7 + oy, 26, 0 + oy, 28, 7 + oy, c.gold)
  cell.triangle(30, 7 + oy, 32, 2 + oy, 34, 7 + oy, c.gold)
}

function drawKingDown(cell: PixelCanvas, p: KingPose): void {
  drawKingCapeDown(cell, p.bob)
  drawKingLegs(cell, p)
  drawKingBody(cell, false, p.bob)
  drawKingArms(cell, p)
  drawKingAxe(cell, p)
  drawKingHeadDown(cell, p)
}

function drawKingUp(cell: PixelCanvas, p: KingPose): void {
  drawKingLegs(cell, p)
  drawKingBody(cell, true, p.bob)
  // 背面：披风整个盖在背上
  drawKingCapeDown(cell, p.bob)
  drawKingArms(cell, p)
  drawKingAxe(cell, p)
  drawKingHeadUp(cell, p)
}

/* ---------- 王：侧面（朝右） ---------- */
function drawKingSide(cell: PixelCanvas, p: KingPose): void {
  const c = KING
  const oy = p.bob
  const s = p.axeSwing
  // 披风（拖在身后）
  const capeSpans: [number, number, number][] = [
    [16, 18, 10], [18, 14, 16], [20, 10, 20], [24, 8, 22],
    [30, 7, 22], [36, 8, 20], [42, 9, 18], [46, 11, 14], [50, 13, 10],
  ]
  fillSpans(cell, capeSpans, c.cape, oy)
  cell.hLine(13, 22, 50 + oy, c.capeDark)
  cell.set(7, 31 + oy, c.capeDark)
  // 后腿
  if (p.legPhase === 1) {
    cell.fillRect(17, 46 + oy, 9, 5, c.skin)
    cell.fillRect(14, 51 + oy, 13, 3, c.skin)
  } else {
    cell.fillRect(17, 46 + oy, 9, 8, c.skin)
    cell.fillRect(14, 53 + oy, 13, 3, c.skin)
  }
  // 身体（驼背 + 大肚子）
  const body: [number, number, number][] = [
    [24, 17, 14], [25, 15, 18], [26, 14, 20], [28, 14, 21],
    [30, 13, 23], [32, 13, 24], [34, 13, 24], [36, 14, 23],
    [38, 15, 22], [40, 16, 20], [42, 18, 17],
  ]
  fillSpans(cell, body, c.skin, oy)
  // 背部弓起 / 肚皮
  cell.hLine(14, 20, 26 + oy, c.skinDark)
  cell.hLine(28, 40, 33 + oy, c.skinHi)
  cell.ellipse(31, 37 + oy, 8, 4, c.skinHi)
  cell.hLine(20, 38, 40 + oy, c.skinDark)
  // 腰布
  const cloth: [number, number, number][] = [[42, 18, 17], [43, 17, 19], [44, 17, 19], [45, 18, 17], [46, 19, 15]]
  for (const [y, x, w] of cloth) cell.fillRect(x, y + oy, w, 1, c.cloth)
  cell.hLine(17, 35, 42 + oy, c.woodDark)
  for (const x of [19, 23, 27, 31]) cell.set(x, 47 + oy, c.cloth)
  // 前腿
  if (p.legPhase === 2) {
    cell.fillRect(30, 46 + oy, 9, 5, c.skin)
    cell.fillRect(28, 51 + oy, 13, 3, c.skin)
  } else {
    cell.fillRect(30, 46 + oy, 9, 8, c.skin)
    cell.fillRect(28, 53 + oy, 13, 3, c.skin)
  }
  // 左臂（垂在体侧）
  cell.fillRect(19, 28 + oy, 8, 9, c.skin)
  cell.fillRect(17, 36 + oy, 8, 7, c.skin)
  cell.fillRect(16, 42 + oy, 8, 3, c.skin)
  // 右臂（前伸握斧）
  cell.fillRect(33, 28 + oy, 8, 7, c.skin)
  cell.fillRect(35, 34 + oy - s, 8, 9, c.skin)
  cell.fillRect(36, 42 + oy - s, 8, 3, c.skin)
  // 巨斧（前伸，刃朝前）
  const hx = 41
  const hy = 42 + oy - s
  const tx = 45
  const ty = 16 + oy - s
  cell.line(hx, hy, tx, ty, c.woodDark)
  cell.line(hx + 1, hy, tx + 1, ty, c.wood)
  for (let i = 3; i < 26; i += 5) {
    const t = i / 28
    cell.set(Math.round(hx + (tx - hx) * t), Math.round(hy + (ty - hy) * t), c.cloth)
  }
  // 厚背薄刃的斧头（刃口朝前/右）
  cell.triangle(tx + 1, ty, 51, ty + 2, 50, ty + 10, c.metalDark)
  cell.triangle(tx + 1, ty, 50, ty + 10, tx + 1, ty + 13, c.metalDark)
  cell.triangle(tx + 1, ty + 13, 50, ty + 10, 47, ty + 16, c.metalDark)
  cell.line(51, ty + 2, 50, ty + 10, c.tooth)
  cell.line(50, ty + 10, 47, ty + 15, c.tooth)
  cell.set(49, ty + 4, c.metal)
  cell.set(48, ty + 8, c.metal)
  cell.triangle(tx + 1, ty, tx + 3, ty - 6, tx + 4, ty + 2, c.metal)
  cell.fillRect(tx - 1, ty + 1, 4, 4, c.gold)
  cell.hLine(tx - 1, tx + 2, ty + 4, c.goldDark)
  cell.set(tx, ty + 1, c.goldHi)
  // 耳朵（后脑）
  cell.triangle(16, 14 + oy, 4, 18 + oy, 16, 25 + oy, c.skin)
  cell.triangle(16, 16 + oy, 9, 18 + oy, 16, 23 + oy, c.skinDark)
  // 头（侧脸）
  const head: [number, number, number][] = [
    [9, 24, 8], [10, 21, 14], [11, 19, 18], [12, 18, 20],
    [14, 17, 22], [16, 16, 23], [18, 16, 23], [20, 16, 23],
    [22, 17, 22], [24, 18, 20], [25, 19, 18], [26, 20, 16], [28, 23, 10],
  ]
  fillSpans(cell, head, c.skin, oy)
  // 突出的口鼻 / 下颚
  cell.fillRect(34, 18 + oy, 7, 7, c.skin)
  cell.fillRect(33, 25 + oy, 9, 2, c.skin)
  cell.set(41, 22 + oy, c.skinDark)
  cell.hLine(34, 41, 24 + oy, c.skinHi)
  // 眉骨 + 眼睛
  cell.hLine(28, 36, 17 + oy, c.skinDark)
  cell.fillRect(30, 18 + oy, 4, 3, c.eye)
  cell.set(32, 19 + oy, c.outline)
  cell.set(32, 20 + oy, c.outline)
  cell.set(30, 18 + oy, c.tooth)
  // 嘴 + 獠牙
  cell.hLine(34, 41, 26 + oy, c.outline)
  cell.hLine(34, 41, 27 + oy, c.outline)
  for (const x of [35, 38]) cell.set(x, 26 + oy, c.tooth)
  cell.set(41, 25 + oy, c.tooth)
  cell.set(41, 26 + oy, c.tooth)
  // 王冠
  cell.fillRect(20, 6 + oy, 15, 4, c.gold)
  cell.hLine(20, 34, 9 + oy, c.goldDark)
  cell.hLine(20, 34, 6 + oy, c.goldHi)
  cell.triangle(20, 7 + oy, 22, 1 + oy, 24, 7 + oy, c.gold)
  cell.triangle(26, 7 + oy, 28, 0 + oy, 30, 7 + oy, c.gold)
  cell.triangle(32, 7 + oy, 34, 2 + oy, 36, 7 + oy, c.gold)
  cell.set(28, 2 + oy, c.goldHi)
}

export function buildKingAtlas(): AtlasData {
  const cellW = 52
  const cellH = 60
  const canvas = new PixelCanvas(cellW * FRAME_COLS, cellH * FRAME_ROWS)
  const dirs: FacingRow[] = ['down', 'up', 'left', 'right']
  for (let row = 0; row < FRAME_ROWS; row++) {
    const dir = dirs[row]
    for (let frame = 0; frame < FRAME_COLS; frame++) {
      const pose = kingPose(frame)
      let cell: PixelCanvas
      if (dir === 'up') {
        cell = new PixelCanvas(cellW, cellH)
        drawKingUp(cell, pose)
      } else if (dir === 'down') {
        cell = new PixelCanvas(cellW, cellH)
        drawKingDown(cell, pose)
      } else {
        cell = new PixelCanvas(cellW, cellH)
        drawKingSide(cell, pose)
        if (dir === 'left') cell = cell.mirrored()
      }
      cell.outline(KING.outline)
      canvas.blit(cell, frame * cellW, row * cellH)
    }
  }
  return { canvas, cols: FRAME_COLS, rows: FRAME_ROWS, cellW, cellH, worldW: 1.9, worldH: 2.2 }
}
