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
import type { BossKind, CharacterId } from '../types.ts'

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
/** v2 遗留入口：保留给旧调用方，等价于若叶睦（mutsumi）的新图集。 */
export function buildPlayerAtlas(): AtlasData {
  return buildCharacterAtlas('mutsumi')
}

type FacingRow = 'down' | 'up' | 'left' | 'right'

/* ============================================================
 * v3 角色图集：若叶睦 / Mortis / 丛雨 / 肥鱼
 * 5 行 × 10 列 · 48×56 单元格 · 脚底 y=53（描边到 54，55 行留空）
 *   行 = down / up / left（镜像 right）/ right / 技能态
 *   列 = idleA / idleB / run1-4 / attack1-3 / hurt
 * 左向帧由右向帧水平镜像得到；描边统一不透明 #1a1420。
 * ============================================================ */
export type ArtCharacterId = CharacterId | 'mortis'

const V3_OUTLINE = 0x1a1420
const V3_COLS = 10
const V3_ROWS = 5

type V3View = 'down' | 'up' | 'side'

interface V3Palette {
  hair: number
  hairHi: number
  hairLo: number
  skin: number
  skinShade: number
  eye: number
  eyeHi: number
  pupil: number
  cloth: number
  clothHi: number
  clothLo: number
  white: number
  accent: number
  accentHi: number
  sash: number
  sashHi: number
  stocking: number
  stockingHi: number
  shoe: number
  shoeHi: number
  hat: number
  hatDark: number
  metal: number
  fin: number
}

interface V3Pose {
  bob: number
  lean: number
  /** 0 双脚着地；1 左腿抬起；2 右腿抬起 */
  leg: number
  arm: number
  /** -1 无攻击；0 蓄力；1 命中；2 收势 */
  atk: number
  hurt: boolean
}

const V3_POSES: V3Pose[] = [
  { bob: 0, lean: 0, leg: 0, arm: 0, atk: -1, hurt: false },
  { bob: 1, lean: 0, leg: 0, arm: 0, atk: -1, hurt: false },
  { bob: 0, lean: 1, leg: 1, arm: 1, atk: -1, hurt: false },
  { bob: 1, lean: 0, leg: 0, arm: 0, atk: -1, hurt: false },
  { bob: 0, lean: -1, leg: 2, arm: -1, atk: -1, hurt: false },
  { bob: 1, lean: 0, leg: 0, arm: 0, atk: -1, hurt: false },
  { bob: 0, lean: 0, leg: 0, arm: 2, atk: 0, hurt: false },
  { bob: 1, lean: 1, leg: 0, arm: 2, atk: 1, hurt: false },
  { bob: 0, lean: 0, leg: 0, arm: 1, atk: 2, hurt: false },
  { bob: 2, lean: 0, leg: 0, arm: -2, atk: -1, hurt: true },
]

function v3Pose(frame: number): V3Pose {
  return V3_POSES[((frame % V3_POSES.length) + V3_POSES.length) % V3_POSES.length]
}

/** 技能行的 10 帧复用常规帧的骨架，靠特效区分。 */
const SKILL_BASE_FRAME = [1, 0, 0, 2, 4, 1, 6, 7, 8, 9]

const MUTSUMI: V3Palette = {
  hair: 0x9ed7a4,
  hairHi: 0xcdeecb,
  hairLo: 0x5f9c6e,
  skin: 0xfbe3cf,
  skinShade: 0xe8bda6,
  eye: 0xe8b53c,
  eyeHi: 0xfff2c0,
  pupil: 0x5c3f12,
  cloth: 0x252a4e,
  clothHi: 0x39416f,
  clothLo: 0x181b36,
  white: 0xf2f2f7,
  accent: 0x57d6c6,
  accentHi: 0x9df0e4,
  sash: 0x5f9e3d,
  sashHi: 0x9ed36a,
  stocking: 0xf7f5fb,
  stockingHi: 0xd6d2e2,
  shoe: 0x6b4a33,
  shoeHi: 0x8f6748,
  hat: 0x57d6c6,
  hatDark: 0x3aa99c,
  metal: 0xe8b53c,
  fin: 0x9ed7a4,
}

const MORTIS: V3Palette = {
  hair: 0xb6e6b8,
  hairHi: 0xe4f7d9,
  hairLo: 0x7fb98a,
  skin: 0xf6e3e0,
  skinShade: 0xd9b6b4,
  eye: 0xe0343f,
  eyeHi: 0xffb0b6,
  pupil: 0x3a0a10,
  cloth: 0x1b1620,
  clothHi: 0x33283c,
  clothLo: 0x0e0b12,
  white: 0xf2eef2,
  accent: 0xb46bff,
  accentHi: 0xd9b0ff,
  sash: 0xb3202f,
  sashHi: 0xe8323f,
  stocking: 0x16121a,
  stockingHi: 0x2a2330,
  shoe: 0x100d14,
  shoeHi: 0x8f95a8,
  hat: 0x9c1f33,
  hatDark: 0x6e1524,
  metal: 0xc9a06a,
  fin: 0xb6e6b8,
}

const MURASAME: V3Palette = {
  hair: 0xa8d9a3,
  hairHi: 0xd8f0d0,
  hairLo: 0x6f9c72,
  skin: 0xf9e6d4,
  skinShade: 0xe0bda8,
  eye: 0xc4395f,
  eyeHi: 0xffb0c6,
  pupil: 0x3c1220,
  cloth: 0x241a2e,
  clothHi: 0x3c2c4c,
  clothLo: 0x140e1c,
  white: 0xf0eef5,
  accent: 0x8fd8ff,
  accentHi: 0xdfe9f5,
  sash: 0xc22a3a,
  sashHi: 0xe5b45a,
  stocking: 0x2a2130,
  stockingHi: 0x413444,
  shoe: 0x171219,
  shoeHi: 0x5b4657,
  hat: 0x3a1f4d,
  hatDark: 0x241030,
  metal: 0xdfe9f5,
  fin: 0xa8d9a3,
}

const FISH: V3Palette = {
  hair: 0x2f4fb8,
  hairHi: 0x6f92ff,
  hairLo: 0x1e327f,
  skin: 0xffe6d6,
  skinShade: 0xf0c0ad,
  eye: 0x4fc3ff,
  eyeHi: 0xeafcff,
  pupil: 0x123a5e,
  cloth: 0x3a5bd0,
  clothHi: 0x5a7ae8,
  clothLo: 0x233a92,
  white: 0xf4f6ff,
  accent: 0xf2c14e,
  accentHi: 0xffe08a,
  sash: 0x57d6e8,
  sashHi: 0xbfefff,
  stocking: 0xf7f5fb,
  stockingHi: 0xd8d4e6,
  shoe: 0x2b2a44,
  shoeHi: 0x4c4a6e,
  hat: 0xeaf0ff,
  hatDark: 0xc9d4f2,
  metal: 0x57d6e8,
  fin: 0x8fd0ff,
}

/* ---------- 通用像素工具 ---------- */

/** 以 cx 为中心、半宽 half 画一行（含两端）。 */
function band(cell: PixelCanvas, cx: number, y: number, half: number, color: number): void {
  cell.fillRect(cx - half, y, half * 2 + 1, 1, color)
}

/** 两条腿 + 鞋；抬腿时整条腿（含鞋）上移 2px，另一条腿保持脚底贴地。 */
function drawLegs(
  cell: PixelCanvas,
  pal: V3Palette,
  pose: V3Pose,
  legXs: [number, number],
  legW: number,
  legTop: number,
  bootTop: number,
  footY: number,
): void {
  for (let i = 0; i < 2; i++) {
    const lift = pose.leg === i + 1 ? 2 : 0
    const x = legXs[i]
    const shoeTop = bootTop - lift
    const bottom = footY - lift
    const stockBottom = shoeTop - 1
    if (stockBottom >= legTop) {
      cell.fillRect(x, legTop, legW, stockBottom - legTop + 1, pal.stocking)
      cell.fillRect(x, legTop, 1, stockBottom - legTop + 1, pal.stockingHi)
    }
    cell.fillRect(x - 1, shoeTop, legW + 2, bottom - shoeTop + 1, pal.shoe)
    cell.fillRect(x - 1, shoeTop, legW + 2, 1, pal.shoeHi)
  }
}

function drawEyePair(
  cell: PixelCanvas,
  xL: number,
  xR: number,
  y: number,
  w: number,
  h: number,
  pal: V3Palette,
  closed: boolean,
): void {
  for (const x of [xL, xR]) {
    if (closed) {
      cell.fillRect(x, y + h - 1, w, 1, pal.pupil)
      continue
    }
    cell.fillRect(x, y, w, h, pal.eye)
    cell.fillRect(x, y, w, 1, pal.pupil)
    cell.set(x, y + 1, pal.eyeHi)
    cell.set(x + w - 1, y + h - 1, pal.pupil)
  }
}

/** 若叶睦的小黄瓜：横握 8×4 / 竖握 4×9。 */
function drawCucumber(cell: PixelCanvas, x: number, y: number, vertical: boolean): void {
  const c = MUTSUMI
  if (vertical) {
    cell.fillRect(x + 1, y, 2, 1, c.sashHi)
    cell.fillRect(x, y + 1, 4, 6, c.sash)
    cell.fillRect(x, y + 1, 1, 6, c.sashHi)
    cell.set(x + 3, y + 2, 0x3f6b28)
    cell.set(x + 1, y + 7, 0x3f6b28)
    cell.set(x + 2, y + 7, 0x3f6b28)
  } else {
    cell.fillRect(x, y + 1, 8, 2, c.sash)
    cell.fillRect(x + 1, y, 6, 1, c.sashHi)
    cell.fillRect(x + 1, y + 3, 6, 1, 0x3f6b28)
    cell.set(x, y, 0x3f6b28)
    cell.set(x + 1, y + 1, c.sashHi)
  }
}

/** Mortis 的吉他（背在身后，斜挎）。 */
function drawGuitarBack(cell: PixelCanvas, pal: V3Palette): void {
  for (let i = 0; i <= 12; i++) {
    const x = 13 + i
    const y = 16 + i
    cell.set(x, y, pal.metal)
    cell.set(x + 1, y, 0x8a6a44)
  }
  cell.fillRect(10, 12, 4, 5, pal.metal)
  cell.set(11, 11, pal.hat)
  cell.set(13, 13, pal.hat)
  cell.ellipse(33, 35, 5, 6, 0x342538)
  cell.ellipse(33, 35, 4, 5, 0x241a26)
  cell.ellipse(33, 35, 1, 2, pal.accent)
  cell.set(30, 32, pal.metal)
  cell.set(35, 38, pal.metal)
}

/** Mortis 的攻击帧：吉他挥到身前（琴颈指向右上）。 */
function drawGuitarFront(cell: PixelCanvas, pal: V3Palette, atk: number): void {
  const bx = atk === 1 ? 22 : 18
  const by = atk === 2 ? 32 : 28
  for (let i = 0; i <= 18; i++) {
    const x = bx + 3 + i
    const y = by - 3 - Math.round(i * 0.9)
    cell.set(x, y, pal.metal)
    cell.set(x, y + 1, 0x8a6a44)
  }
  cell.fillRect(bx + 20, by - 22, 4, 4, pal.metal)
  cell.set(bx + 21, by - 23, pal.hat)
  cell.ellipse(bx, by, 6, 7, 0x241a26)
  cell.ellipse(bx, by, 4, 5, 0x352838)
  cell.ellipse(bx, by, 1, 2, pal.accent)
  cell.fillRect(bx + 2, by - 6, 3, 3, pal.skin)
}

/* ============================================================
 * 若叶睦：浅绿长发 · 藏青水手裙 · 青色蝴蝶结 · 金瞳 · 小黄瓜
 * ============================================================ */
function mutsumiBackHair(cell: PixelCanvas, b: number): void {
  const c = MUTSUMI
  const rows: [number, number][] = [
    [8, 7], [9, 9], [10, 10], [11, 11], [12, 11], [13, 12], [14, 12], [15, 12],
    [16, 12], [17, 12], [18, 12], [19, 12], [20, 11], [21, 11], [22, 11], [23, 11],
    [24, 11], [25, 11], [26, 10], [27, 10], [28, 10], [29, 10], [30, 9], [31, 9],
    [32, 9], [33, 8], [34, 8], [35, 8], [36, 7], [37, 7], [38, 6], [39, 6],
  ]
  for (const [y, half] of rows) band(cell, 24, y + b, half, c.hairLo)
  cell.fillRect(14, 10 + b, 2, 20, c.hair)
  cell.fillRect(31, 11 + b, 2, 18, c.hair)
  cell.fillRect(17, 8 + b, 7, 2, c.hairHi)
  cell.set(13, 14 + b, c.hair)
  cell.set(34, 15 + b, c.hair)
}

function mutsumiDown(cell: PixelCanvas, frame: number): void {
  const c = MUTSUMI
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  mutsumiBackHair(cell, b)
  drawLegs(cell, c, p, [19, 26], 4, 44, 51, 53)

  // 藏青百褶裙
  const skirt: [number, number][] = [
    [33, 8], [34, 8], [35, 9], [36, 9], [37, 10], [38, 10], [39, 10],
    [40, 11], [41, 11], [42, 12], [43, 12],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 36 + b; y <= 43 + b; y++) {
    cell.set(cx - 8, y, c.clothLo)
    cell.set(cx - 3, y, c.clothLo)
    cell.set(cx + 2, y, c.clothLo)
    cell.set(cx + 7, y, c.clothLo)
  }
  band(cell, cx, 43 + b, 11, c.clothHi)

  // 上身 + 水手领
  for (let y = 24 + b; y <= 32 + b; y++) band(cell, cx, y, 6, c.cloth)
  cell.fillRect(cx - 6, 24 + b, 1, 9, c.clothHi)
  cell.fillRect(cx + 5, 24 + b, 1, 9, c.clothLo)
  band(cell, cx, 24 + b, 7, c.white)
  cell.fillRect(18, 25 + b, 2, 1, c.white)
  cell.fillRect(29, 25 + b, 2, 1, c.white)
  cell.set(18, 26 + b, c.white)
  cell.set(29, 26 + b, c.white)
  cell.fillRect(22, 24 + b, 4, 2, c.skin)
  // 青色蝴蝶结
  cell.fillRect(21, 26 + b, 2, 2, c.accent)
  cell.fillRect(25, 26 + b, 2, 2, c.accent)
  cell.fillRect(23, 26 + b, 2, 2, c.accentHi)
  cell.set(22, 28 + b, c.accent)
  cell.set(22, 29 + b, c.accentHi)
  cell.set(25, 28 + b, c.accent)
  cell.set(25, 29 + b, c.accentHi)

  // 泡泡袖
  const sleeves: [number, number, number][] = [
    [24, 14, 18], [25, 13, 18], [26, 13, 18], [27, 14, 17], [28, 14, 17],
  ]
  for (const [y, x0, x1] of sleeves) {
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, y === 24 ? c.clothHi : c.cloth)
    cell.fillRect(47 - x1, y + b, x1 - x0 + 1, 1, y === 24 ? c.clothHi : c.cloth)
  }

  // 头
  cell.fillRect(22, 22 + b, 4, 2, c.skin)
  cell.fillRect(20, 9 + b, 8, 1, c.skin)
  cell.fillRect(18, 10 + b, 12, 1, c.skin)
  cell.fillRect(17, 11 + b, 14, 9, c.skin)
  cell.fillRect(18, 20 + b, 12, 1, c.skin)
  cell.fillRect(20, 21 + b, 8, 1, c.skin)
  drawEyePair(cell, 19, 26, 14 + b, 2, 3, c, p.hurt)
  cell.set(18, 18 + b, c.skinShade)
  cell.set(29, 18 + b, c.skinShade)
  cell.set(23, 19 + b, c.skinShade)
  cell.set(24, 19 + b, c.skinShade)

  // 刘海
  const fringe: [number, number, number][] = [
    [15, 8, 14], [16, 8, 13], [17, 8, 12], [18, 8, 13], [19, 8, 13],
    [20, 8, 11], [21, 8, 12], [22, 8, 10], [23, 8, 10], [24, 8, 11],
    [25, 8, 11], [26, 8, 12], [27, 8, 13], [28, 8, 12], [29, 8, 13],
    [30, 8, 13], [31, 8, 12], [32, 8, 13], [33, 8, 14],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(20, 8 + b, 8, 1, c.hairHi)
  cell.fillRect(17, 9 + b, 3, 1, c.hairHi)
  cell.set(24, 8 + b, c.hairHi)

  // 肩前长发
  for (let y = 12 + b; y <= 33 + b; y++) {
    const w = y <= 28 ? 4 : 4 - Math.min(2, Math.floor((y - 28) / 2))
    cell.fillRect(12, y, w, 1, c.hair)
    cell.fillRect(35 - w + 1, y, w, 1, c.hair)
    cell.set(12 + w - 1, y, c.hairLo)
    cell.set(35 - w + 1, y, c.hairHi)
  }

  // 手臂 + 小黄瓜（攻击帧换姿势）
  if (p.atk === 0) {
    drawCucumber(cell, 33, 13 + b, true)
    cell.fillRect(31, 22 + b, 3, 3, c.skin)
    cell.fillRect(31, 22 + b, 3, 1, c.skinShade)
  } else if (p.atk === 1) {
    drawCucumber(cell, 34, 25 + b, false)
    cell.fillRect(31, 26 + b, 4, 3, c.skin)
    cell.fillRect(31, 26 + b, 4, 1, c.skinShade)
  } else if (p.atk === 2) {
    drawCucumber(cell, 31, 33 + b, false)
    cell.fillRect(30, 30 + b, 3, 4, c.skin)
    cell.fillRect(30, 30 + b, 3, 1, c.skinShade)
  } else {
    cell.fillRect(15, 29 + b, 3, 3, c.skin)
    cell.fillRect(16, 32 + b, 2, 1, c.skinShade)
    cell.fillRect(30, 29 + b, 3, 3, c.skin)
    cell.fillRect(30, 32 + b, 3, 1, c.skinShade)
    drawCucumber(cell, 32, 30 + b, false)
    cell.fillRect(31, 30 + b, 3, 3, c.skin)
  }
}

function mutsumiUp(cell: PixelCanvas, frame: number): void {
  const c = MUTSUMI
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  drawLegs(cell, c, p, [19, 26], 4, 44, 51, 53)
  const skirt: [number, number][] = [
    [33, 8], [34, 8], [35, 9], [36, 9], [37, 10], [38, 10], [39, 10],
    [40, 11], [41, 11], [42, 12], [43, 12],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 36 + b; y <= 43 + b; y++) {
    cell.set(cx - 7, y, c.clothLo)
    cell.set(cx - 2, y, c.clothLo)
    cell.set(cx + 3, y, c.clothLo)
    cell.set(cx + 8, y, c.clothLo)
  }
  band(cell, cx, 43 + b, 11, c.clothHi)
  for (let y = 24 + b; y <= 32 + b; y++) band(cell, cx, y, 6, c.cloth)

  // 后发：上宽下窄的长直发，腰部两侧露出裙摆
  const hair: [number, number][] = [
    [8, 7], [9, 9], [10, 10], [11, 11], [12, 11], [13, 11], [14, 11], [15, 11],
    [16, 11], [17, 11], [18, 11], [19, 10], [20, 10], [21, 10], [22, 10],
    [23, 9], [24, 9], [25, 9], [26, 9], [27, 8], [28, 8], [29, 8], [30, 8],
    [31, 7], [32, 7], [33, 7], [34, 7], [35, 6], [36, 6], [37, 6], [38, 6],
    [39, 5], [40, 5], [41, 4],
  ]
  for (const [y, half] of hair) band(cell, cx, y + b, half, c.hairLo)
  for (const [y, half] of hair) {
    if (y < 10) continue
    band(cell, cx, y + b, Math.max(3, half - 2), c.hair)
  }
  cell.fillRect(20, 11 + b, 1, 6, c.hairHi)
  cell.fillRect(25, 12 + b, 1, 9, c.hairHi)
  cell.fillRect(17, 15 + b, 1, 5, c.hairHi)
  cell.fillRect(22, 22 + b, 1, 7, c.hairHi)
  cell.fillRect(27, 20 + b, 1, 5, c.hairHi)
  for (let y = 14 + b; y <= 34 + b; y++) {
    cell.fillRect(12, y, 3, 1, c.hair)
    cell.fillRect(33, y, 3, 1, c.hair)
    cell.set(12, y, c.hairLo)
    cell.set(35, y, c.hairHi)
  }
  for (let y = 35 + b; y <= 38 + b; y++) {
    cell.fillRect(13, y, 2, 1, c.hair)
    cell.fillRect(33, y, 2, 1, c.hair)
  }
  for (const x of [18, 22, 26, 30]) cell.set(x, 42 + b, c.hairLo)

  // 水手领从发缝里露出
  cell.fillRect(15, 24 + b, 4, 2, c.white)
  cell.fillRect(29, 24 + b, 4, 2, c.white)
  cell.fillRect(16, 26 + b, 2, 1, c.accent)
  cell.fillRect(30, 26 + b, 2, 1, c.accent)
  cell.set(17, 23 + b, c.skin)
  cell.set(30, 23 + b, c.skin)

  // 露出的双手 + 小黄瓜
  cell.fillRect(13, 31 + b, 3, 3, c.skin)
  cell.fillRect(32, 31 + b, 3, 3, c.skin)
  cell.set(13, 31 + b, c.skinShade)
  cell.set(33, 31 + b, c.skinShade)
  drawCucumber(cell, 34, 30 + b, true)
}

function mutsumiSide(cell: PixelCanvas, frame: number): void {
  const c = MUTSUMI
  const p = v3Pose(frame)
  const b = p.bob

  // 后发（朝右站姿，发在左侧）
  const hair: [number, number, number][] = [
    [8, 13, 24], [9, 11, 25], [10, 10, 26], [11, 10, 27], [12, 9, 27],
    [13, 9, 27], [14, 8, 26], [15, 8, 26], [16, 8, 26], [17, 8, 25],
    [18, 8, 25], [19, 8, 25], [20, 8, 24], [21, 8, 24], [22, 8, 23],
    [23, 8, 23], [24, 8, 22], [25, 8, 22], [26, 9, 21], [27, 9, 21],
    [28, 9, 20], [29, 10, 19], [30, 10, 19], [31, 10, 18], [32, 11, 17],
    [33, 12, 16], [34, 12, 16], [35, 13, 15],
  ]
  for (const [y, x0, x1] of hair) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.hairLo)
  cell.fillRect(11, 11 + b, 2, 20, c.hair)
  cell.fillRect(9, 16 + b, 2, 16, c.hair)
  cell.fillRect(14, 8 + b, 8, 2, c.hairHi)

  drawLegs(cell, c, p, [19, 25], 4, 44, 51, 53)

  const skirt: [number, number, number][] = [
    [33, 19, 29], [34, 18, 30], [35, 18, 31], [36, 17, 31], [37, 17, 31],
    [38, 16, 32], [39, 16, 32], [40, 15, 33], [41, 15, 33], [42, 14, 34], [43, 14, 34],
  ]
  for (const [y, x0, x1] of skirt) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  for (let y = 36 + b; y <= 43 + b; y++) {
    cell.set(19, y, c.clothLo)
    cell.set(24, y, c.clothLo)
    cell.set(29, y, c.clothLo)
  }

  for (let y = 24 + b; y <= 32 + b; y++) cell.fillRect(19, y, 11, 1, c.cloth)
  cell.fillRect(19, 24 + b, 1, 9, c.clothHi)
  cell.fillRect(29, 24 + b, 1, 9, c.clothLo)
  cell.fillRect(20, 24 + b, 10, 1, c.white)
  cell.fillRect(21, 25 + b, 2, 1, c.white)
  cell.fillRect(27, 25 + b, 2, 1, c.white)
  cell.fillRect(24, 25 + b, 4, 2, c.accent)
  cell.set(26, 27 + b, c.accentHi)

  // 侧脸
  cell.fillRect(22, 22 + b, 5, 2, c.skin)
  cell.fillRect(22, 10 + b, 7, 1, c.skin)
  cell.fillRect(21, 11 + b, 9, 9, c.skin)
  cell.fillRect(22, 20 + b, 7, 1, c.skin)
  cell.set(30, 14 + b, c.skin)
  cell.set(30, 15 + b, c.skinShade)
  drawEyePair(cell, 26, 26, 14 + b, 2, 3, c, p.hurt)
  cell.set(28, 18 + b, c.skinShade)
  cell.set(25, 19 + b, c.skinShade)

  // 刘海 + 鬓发
  const fringe: [number, number, number][] = [
    [20, 8, 14], [21, 8, 13], [22, 8, 12], [23, 8, 13], [24, 8, 12],
    [25, 8, 11], [26, 8, 10], [27, 8, 12], [28, 8, 13], [29, 8, 14],
    [30, 8, 15],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(22, 8 + b, 6, 1, c.hairHi)
  cell.fillRect(20, 10 + b, 3, 16, c.hair)
  cell.fillRect(21, 10 + b, 1, 16, c.hairHi)

  // 手臂 + 黄瓜
  if (p.atk === 0) {
    drawCucumber(cell, 34, 13 + b, true)
    cell.fillRect(29, 22 + b, 3, 3, c.skin)
  } else if (p.atk === 1) {
    drawCucumber(cell, 32, 26 + b, false)
    cell.fillRect(27, 26 + b, 4, 3, c.skin)
  } else if (p.atk === 2) {
    drawCucumber(cell, 30, 33 + b, false)
    cell.fillRect(25, 30 + b, 3, 3, c.skin)
  } else {
    cell.fillRect(24, 28 + b, 3, 3, c.skin)
    cell.fillRect(24, 28 + b, 1, 1, c.skinShade)
    drawCucumber(cell, 28, 30 + b, false)
    cell.fillRect(26, 30 + b, 3, 3, c.skin)
  }
}

/* ============================================================
 * Mortis：酒红贝雷帽 · 黑红哥特裙 · 红色内衬披风 · 红瞳 · 吉他
 * ============================================================ */
function mortisHairBack(cell: PixelCanvas, b: number): number {
  const c = MORTIS
  const rows: [number, number][] = [
    [6, 6], [7, 8], [8, 9], [9, 10], [10, 11], [11, 11], [12, 12], [13, 12],
    [14, 12], [15, 12], [16, 12], [17, 12], [18, 12], [19, 12], [20, 11], [21, 11],
    [22, 10], [23, 10], [24, 8],
  ]
  for (const [y, half] of rows) band(cell, 24, y + b, half, c.hairLo)
  cell.fillRect(14, 9 + b, 2, 12, c.hair)
  cell.fillRect(32, 9 + b, 2, 12, c.hair)
  cell.fillRect(19, 6 + b, 10, 1, c.hairHi)
  return b
}

function mortisCurls(cell: PixelCanvas, b: number): void {
  const c = MORTIS
  const curls: [number, number, number][] = [
    [17, 12, 2], [15, 17, 2], [14, 21, 2],
    [31, 12, 2], [33, 17, 2], [34, 21, 2],
  ]
  for (const [x, y, r] of curls) {
    cell.circle(x, y + b, r, c.hair)
    cell.set(x - r, y + b - r, c.hairHi)
    cell.set(x + r, y + b + r, c.hairLo)
  }
  cell.circle(17, 8 + b, 3, c.hair)
  cell.circle(31, 8 + b, 3, c.hair)
  cell.set(16, 6 + b, c.hairHi)
  cell.set(32, 6 + b, c.hairHi)
}

function mortisBeret(cell: PixelCanvas, b: number): void {
  const c = MORTIS
  const rows: [number, number, number][] = [
    [2, 21, 30], [3, 19, 32], [4, 17, 33], [5, 16, 34],
  ]
  for (const [y, x0, x1] of rows) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.hat)
  cell.fillRect(19, 4 + b, 6, 1, c.white)
  cell.fillRect(16, 6 + b, 19, 1, c.hatDark)
  cell.fillRect(18, 7 + b, 15, 1, c.hatDark)
  cell.set(27, 2 + b, c.hatDark)
  cell.set(28, 2 + b, c.hatDark)
}

function mortisDown(cell: PixelCanvas, frame: number): void {
  const c = MORTIS
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24

  // 披风（红色内衬在外缘）
  const cloak: [number, number][] = [
    [21, 8], [22, 10], [23, 11], [24, 12], [25, 12], [26, 12], [27, 12], [28, 12],
    [29, 12], [30, 12], [31, 12], [32, 12], [33, 12], [34, 11], [35, 11], [36, 10],
    [37, 10], [38, 9],
  ]
  for (const [y, half] of cloak) band(cell, cx, y + b, half, c.cloth)
  cell.fillRect(14, 24 + b, 2, 11, c.sash)
  cell.fillRect(32, 24 + b, 2, 11, c.sash)
  cell.fillRect(15, 24 + b, 1, 11, c.sashHi)
  cell.fillRect(32, 24 + b, 1, 11, c.sashHi)
  cell.fillRect(11, 36 + b, 3, 1, c.sash)
  cell.fillRect(34, 36 + b, 3, 1, c.sash)

  if (p.atk < 0) drawGuitarBack(cell, c)

  // 黑丝 + 黑长靴（银扣）
  drawLegs(cell, c, p, [19, 26], 4, 41, 50, 53)
  cell.fillRect(18, 51 + b, 2, 1, c.shoeHi)
  cell.fillRect(27, 51 + b, 2, 1, c.shoeHi)

  // 哥特裙
  const skirt: [number, number][] = [
    [32, 6], [33, 7], [34, 8], [35, 9], [36, 10], [37, 11], [38, 12],
    [39, 12], [40, 12], [41, 12], [42, 11], [43, 10],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 34 + b; y <= 41 + b; y++) {
    cell.set(cx - 8, y, c.clothHi)
    cell.set(cx - 3, y, c.clothHi)
    cell.set(cx + 2, y, c.clothHi)
    cell.set(cx + 7, y, c.clothHi)
  }
  band(cell, cx, 42 + b, 10, c.sash)
  band(cell, cx, 43 + b, 9, c.sashHi)

  // 束腰上身 + 红系带
  for (let y = 21 + b; y <= 31 + b; y++) band(cell, cx, y, 6, c.cloth)
  cell.fillRect(cx - 6, 21 + b, 1, 11, c.clothHi)
  cell.fillRect(cx + 5, 21 + b, 1, 11, c.clothLo)
  for (let i = 0; i < 4; i++) {
    cell.set(23 + i, 23 + i * 2 + b, c.sash)
    cell.set(26 - i, 23 + i * 2 + b, c.sash)
  }
  cell.fillRect(22, 21 + b, 5, 1, c.white)
  cell.set(21, 22 + b, c.white)
  cell.set(27, 22 + b, c.white)

  // 泡泡袖
  const sleeves: [number, number, number][] = [
    [21, 15, 18], [22, 14, 19], [23, 14, 19], [24, 14, 19], [25, 15, 18], [26, 15, 18],
  ]
  for (const [y, x0, x1] of sleeves) {
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
    cell.fillRect(47 - x1, y + b, x1 - x0 + 1, 1, c.cloth)
  }

  // 头 + 卷发 + 贝雷帽
  mortisHairBack(cell, b)
  cell.fillRect(22, 20 + b, 4, 2, c.skin)
  cell.fillRect(20, 9 + b, 8, 1, c.skin)
  cell.fillRect(18, 10 + b, 12, 9, c.skin)
  cell.fillRect(19, 19 + b, 10, 1, c.skin)
  cell.fillRect(21, 20 + b, 6, 1, c.skin)
  drawEyePair(cell, 20, 27, 13 + b, 2, 3, c, p.hurt)
  cell.set(19, 17 + b, c.skinShade)
  cell.set(30, 17 + b, c.skinShade)
  cell.set(23, 18 + b, c.skinShade)
  cell.set(24, 18 + b, c.skinShade)
  mortisCurls(cell, b)
  mortisBeret(cell, b)

  // 手臂
  if (p.atk === 0) {
    cell.fillRect(30, 24 + b, 3, 4, c.skin)
    cell.fillRect(30, 24 + b, 3, 1, c.skinShade)
  } else if (p.atk === 1) {
    cell.fillRect(28, 27 + b, 4, 3, c.skin)
  } else if (p.atk === 2) {
    cell.fillRect(29, 29 + b, 3, 3, c.skin)
  } else {
    cell.fillRect(15, 26 + b, 3, 4, c.skin)
    cell.fillRect(15, 26 + b, 3, 1, c.skinShade)
    cell.fillRect(31, 26 + b, 3, 4, c.skin)
    cell.fillRect(31, 26 + b, 3, 1, c.skinShade)
  }

  if (p.atk >= 0) drawGuitarFront(cell, c, p.atk)
}

function mortisUp(cell: PixelCanvas, frame: number): void {
  const c = MORTIS
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  const cloak: [number, number][] = [
    [21, 8], [22, 10], [23, 11], [24, 11], [25, 11], [26, 11], [27, 11], [28, 11],
    [29, 11], [30, 11], [31, 10], [32, 10], [33, 10], [34, 10], [35, 9], [36, 9],
    [37, 9], [38, 9],
  ]
  for (const [y, half] of cloak) band(cell, cx, y + b, half, c.cloth)
  cell.fillRect(13, 24 + b, 2, 12, c.sash)
  cell.fillRect(33, 24 + b, 2, 12, c.sash)
  cell.fillRect(14, 24 + b, 1, 10, c.sashHi)
  cell.set(12, 36 + b, c.sash)
  cell.set(35, 36 + b, c.sash)
  drawLegs(cell, c, p, [19, 26], 4, 41, 50, 53)
  const skirt: [number, number][] = [
    [32, 6], [33, 7], [34, 8], [35, 9], [36, 10], [37, 11], [38, 12],
    [39, 12], [40, 12], [41, 12], [42, 11], [43, 10],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 34 + b; y <= 41 + b; y++) {
    cell.set(cx - 8, y, c.clothHi)
    cell.set(cx - 3, y, c.clothHi)
    cell.set(cx + 2, y, c.clothHi)
    cell.set(cx + 7, y, c.clothHi)
  }
  band(cell, cx, 42 + b, 10, c.sash)
  band(cell, cx, 43 + b, 9, c.sashHi)
  for (let y = 21 + b; y <= 31 + b; y++) band(cell, cx, y, 6, c.cloth)

  mortisHairBack(cell, b)
  cell.fillRect(19, 6 + b, 10, 1, c.accent)
  mortisCurls(cell, b)
  drawGuitarBack(cell, c)
  mortisBeret(cell, b)

  cell.fillRect(13, 26 + b, 3, 4, c.skin)
  cell.fillRect(32, 26 + b, 3, 4, c.skin)
  cell.set(13, 26 + b, c.skinShade)
  cell.set(33, 26 + b, c.skinShade)
}

function mortisSide(cell: PixelCanvas, frame: number): void {
  const c = MORTIS
  const p = v3Pose(frame)
  const b = p.bob

  // 披风在身后（左）
  const cloak: [number, number, number][] = [
    [21, 13, 22], [22, 12, 23], [23, 11, 24], [24, 10, 24], [25, 9, 24],
    [26, 9, 24], [27, 9, 24], [28, 9, 24], [29, 9, 24], [30, 9, 24],
    [31, 9, 24], [32, 9, 24], [33, 10, 24], [34, 10, 24], [35, 11, 24],
    [36, 11, 24], [37, 12, 23], [38, 13, 23],
  ]
  for (const [y, x0, x1] of cloak) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  cell.fillRect(9, 24 + b, 2, 10, c.sash)

  drawLegs(cell, c, p, [18, 24], 4, 41, 50, 53)
  const skirt: [number, number, number][] = [
    [32, 15, 29], [33, 14, 30], [34, 14, 31], [35, 13, 31], [36, 13, 31],
    [37, 12, 32], [38, 12, 32], [39, 11, 33], [40, 11, 33], [41, 10, 33], [42, 10, 32],
  ]
  for (const [y, x0, x1] of skirt) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  band(cell, 24, 42 + b, 8, c.sash)
  for (let y = 21 + b; y <= 31 + b; y++) cell.fillRect(17, y, 11, 1, c.cloth)
  cell.fillRect(17, 21 + b, 11, 1, c.white)
  cell.set(23, 24 + b, c.sash)
  cell.set(25, 26 + b, c.sash)
  cell.set(23, 28 + b, c.sash)

  // 侧脸 + 卷发 + 贝雷帽
  cell.fillRect(22, 20 + b, 4, 2, c.skin)
  cell.fillRect(20, 9 + b, 8, 1, c.skin)
  cell.fillRect(19, 10 + b, 10, 9, c.skin)
  cell.fillRect(20, 19 + b, 9, 1, c.skin)
  cell.set(29, 13 + b, c.skin)
  cell.set(29, 14 + b, c.skinShade)
  drawEyePair(cell, 25, 25, 13 + b, 2, 3, c, p.hurt)
  cell.set(24, 17 + b, c.skinShade)
  cell.set(22, 18 + b, c.skinShade)
  cell.circle(17, 12 + b, 3, c.hair)
  cell.circle(15, 17 + b, 2, c.hair)
  cell.circle(21, 8 + b, 2, c.hair)
  cell.fillRect(19, 6 + b, 8, 1, c.hairHi)
  cell.set(21, 11 + b, c.hairHi)
  mortisBeret(cell, b)

  if (p.atk < 0) drawGuitarBack(cell, c)
  if (p.atk === 0) {
    cell.fillRect(30, 23 + b, 3, 4, c.skin)
  } else if (p.atk === 1) {
    cell.fillRect(28, 26 + b, 4, 3, c.skin)
  } else if (p.atk === 2) {
    cell.fillRect(28, 29 + b, 3, 3, c.skin)
  } else {
    cell.fillRect(23, 26 + b, 3, 4, c.skin)
  }
  if (p.atk >= 0) drawGuitarFront(cell, c, p.atk)
}

/* ============================================================
 * 丛雨：绿长发 · 紫黑和服外套 · 红腰带金纹 · 太刀 · 蓝白刀光
 * ============================================================ */
function murasameBackHair(cell: PixelCanvas, b: number): void {
  const c = MURASAME
  const rows: [number, number][] = [
    [8, 7], [9, 9], [10, 10], [11, 11], [12, 11], [13, 12], [14, 12], [15, 12],
    [16, 12], [17, 12], [18, 12], [19, 12], [20, 12], [21, 12], [22, 12], [23, 12],
    [24, 12], [25, 12], [26, 11], [27, 11], [28, 11], [29, 11], [30, 11], [31, 10],
    [32, 10], [33, 10], [34, 10], [35, 9], [36, 9], [37, 9], [38, 8], [39, 8],
    [40, 8], [41, 7], [42, 7], [43, 6], [44, 6],
  ]
  for (const [y, half] of rows) band(cell, 24, y + b, half, c.hairLo)
  cell.fillRect(14, 10 + b, 2, 25, c.hair)
  cell.fillRect(31, 11 + b, 2, 22, c.hair)
  cell.fillRect(18, 8 + b, 7, 2, c.hairHi)
}

/** 太刀：以 2px 宽折线画刀身，刀锷 + 刀柄。 */
function drawKatana(
  cell: PixelCanvas,
  pal: V3Palette,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  hilt: boolean,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / Math.max(1, steps))
    const y = Math.round(y0 + (dy * i) / Math.max(1, steps))
    cell.set(x, y, pal.metal)
    cell.set(x + 1, y, pal.accentHi)
  }
  if (!hilt) return
  // 刀锷
  cell.fillRect(x0 - 1, y0 - 1, 3, 3, pal.sashHi)
  // 刀柄（红绳缠绕）
  cell.set(x0 - 2, y0 + 1, pal.sash)
  cell.set(x0 - 3, y0 + 2, pal.sashHi)
  cell.set(x0 - 4, y0 + 3, pal.sash)
  cell.set(x0 - 5, y0 + 4, pal.sashHi)
}

/** 腰间的太刀鞘：深色鞘身 + 金属鞘口，刀柄朝上后方。 */
function drawScabbard(
  cell: PixelCanvas,
  pal: V3Palette,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const dx = x1 - x0
  const dy = y1 - y0
  const steps = Math.max(Math.abs(dx), Math.abs(dy))
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / Math.max(1, steps))
    const y = Math.round(y0 + (dy * i) / Math.max(1, steps))
    cell.set(x, y, 0x16101e)
    cell.set(x + 1, y, pal.clothHi)
  }
  cell.fillRect(x0, y0 - 1, 2, 2, pal.sashHi)
  cell.fillRect(x1 - 1, y1 - 1, 2, 2, pal.metal)
  cell.fillRect(x1 + 1, y1 - 3, 2, 2, pal.sashHi)
  cell.fillRect(x1 + 2, y1 - 5, 2, 2, pal.sash)
  cell.set(x1 + 3, y1 - 6, pal.sashHi)
}

function murasameDown(cell: PixelCanvas, frame: number): void {
  const c = MURASAME
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  murasameBackHair(cell, b)
  drawLegs(cell, c, p, [19, 27], 4, 44, 49, 53)

  // 和服外套下摆
  const hem: [number, number][] = [
    [33, 8], [34, 9], [35, 9], [36, 10], [37, 10], [38, 11], [39, 11],
    [40, 12], [41, 12], [42, 12], [43, 11], [44, 11],
  ]
  for (const [y, half] of hem) band(cell, cx, y + b, half, c.cloth)
  for (let y = 38 + b; y <= 44 + b; y++) {
    cell.set(cx - 9, y, c.clothLo)
    cell.set(cx - 3, y, c.clothLo)
    cell.set(cx + 3, y, c.clothLo)
    cell.set(cx + 9, y, c.clothLo)
  }
  band(cell, cx, 44 + b, 11, c.clothHi)
  for (const x of [14, 18, 22, 26, 30, 34]) cell.set(x, 44 + b, c.sashHi)

  // 上身
  for (let y = 24 + b; y <= 32 + b; y++) band(cell, cx, y, 6, c.cloth)
  cell.fillRect(cx - 6, 24 + b, 1, 9, c.clothHi)
  cell.fillRect(cx + 5, 24 + b, 1, 9, c.clothLo)
  // 白色内衬交领
  cell.fillRect(21, 24 + b, 6, 1, c.white)
  for (let i = 0; i < 6; i++) {
    cell.set(20 + i, 25 + i + b, c.white)
    cell.set(28 - i, 25 + i + b, c.white)
  }
  // 红腰带 + 金纹
  cell.fillRect(17, 31 + b, 15, 4, c.sash)
  cell.fillRect(17, 31 + b, 15, 1, c.sashHi)
  for (const x of [19, 23, 27]) cell.set(x, 32 + b, c.sashHi)
  for (const x of [21, 25, 29]) cell.set(x, 33 + b, c.sashHi)
  cell.set(23, 34 + b, c.sashHi)

  // 宽袖（垂坠）
  const sleeveL: [number, number, number][] = [
    [24, 14, 18], [25, 13, 18], [26, 13, 18], [27, 13, 18], [28, 13, 18],
    [29, 13, 18], [30, 13, 18], [31, 13, 18], [32, 14, 18], [33, 14, 18],
  ]
  for (const [y, x0, x1] of sleeveL) {
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
    cell.fillRect(47 - x1, y + b, x1 - x0 + 1, 1, c.cloth)
  }
  band(cell, 16, 33 + b, 3, c.clothHi)
  band(cell, 31, 33 + b, 3, c.clothHi)
  for (const x of [13, 14, 15, 16, 17, 18, 29, 30, 31, 32, 33, 34]) {
    cell.set(x, 33 + b, c.sashHi)
  }

  // 头 + 脸
  cell.fillRect(22, 22 + b, 4, 2, c.skin)
  cell.fillRect(20, 10 + b, 8, 1, c.skin)
  cell.fillRect(18, 11 + b, 12, 1, c.skin)
  cell.fillRect(17, 12 + b, 14, 9, c.skin)
  cell.fillRect(18, 21 + b, 12, 1, c.skin)
  cell.fillRect(20, 22 + b, 8, 1, c.skin)
  drawEyePair(cell, 19, 26, 15 + b, 2, 3, c, p.hurt)
  cell.set(18, 19 + b, c.skinShade)
  cell.set(29, 19 + b, c.skinShade)
  cell.set(23, 20 + b, c.skinShade)
  cell.set(24, 20 + b, c.skinShade)

  // 中分刘海
  const fringe: [number, number, number][] = [
    [15, 8, 15], [16, 8, 14], [17, 8, 13], [18, 8, 14], [19, 8, 13],
    [20, 8, 12], [21, 8, 11], [22, 8, 12], [23, 8, 12], [24, 8, 12],
    [25, 8, 13], [26, 8, 13], [27, 8, 14], [28, 8, 13], [29, 8, 14],
    [30, 8, 15], [31, 8, 15], [32, 8, 15], [33, 8, 15],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(20, 8 + b, 8, 1, c.hairHi)
  cell.set(24, 8 + b, c.hairLo)

  // 两侧长发 + 紫黑蝴蝶结
  for (let y = 13 + b; y <= 40 + b; y++) {
    const w = y <= 34 ? 4 : 4 - Math.min(2, Math.floor((y - 34) / 3))
    cell.fillRect(12, y, w, 1, c.hair)
    cell.fillRect(35 - w + 1, y, w, 1, c.hair)
    cell.set(12, y, c.hairLo)
    cell.set(35 - w + 1, y, c.hairHi)
  }
  cell.fillRect(11, 14 + b, 4, 3, c.hat)
  cell.fillRect(11, 17 + b, 2, 4, c.hatDark)
  cell.fillRect(33, 14 + b, 4, 3, c.hat)
  cell.fillRect(35, 17 + b, 2, 4, c.hatDark)
  cell.set(13, 14 + b, c.hairHi)
  cell.set(34, 14 + b, 0x5d3a75)

  // 腰间太刀（左手扶鞘）
  drawScabbard(cell, c, 8, 42 + b, 16, 33 + b)
  cell.fillRect(17, 30 + b, 3, 3, c.skin)

  // 右手 / 攻击出刀
  if (p.atk === 0) {
    drawKatana(cell, c, 34, 22 + b, 42, 12 + b, true)
    cell.fillRect(31, 24 + b, 3, 3, c.skin)
  } else if (p.atk === 1) {
    drawKatana(cell, c, 30, 26 + b, 44, 26 + b, true)
    cell.fillRect(29, 25 + b, 3, 3, c.skin)
  } else if (p.atk === 2) {
    drawKatana(cell, c, 30, 31 + b, 41, 40 + b, true)
    cell.fillRect(29, 30 + b, 3, 3, c.skin)
  } else {
    cell.fillRect(30, 28 + b, 3, 3, c.skin)
    cell.fillRect(30, 28 + b, 3, 1, c.skinShade)
  }
}

function murasameUp(cell: PixelCanvas, frame: number): void {
  const c = MURASAME
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  drawLegs(cell, c, p, [19, 27], 4, 44, 49, 53)
  const hem: [number, number][] = [
    [33, 8], [34, 9], [35, 9], [36, 10], [37, 10], [38, 11], [39, 11],
    [40, 12], [41, 12], [42, 12], [43, 11], [44, 11],
  ]
  for (const [y, half] of hem) band(cell, cx, y + b, half, c.cloth)
  for (let y = 38 + b; y <= 44 + b; y++) {
    cell.set(cx - 9, y, c.clothLo)
    cell.set(cx - 3, y, c.clothLo)
    cell.set(cx + 3, y, c.clothLo)
    cell.set(cx + 9, y, c.clothLo)
  }
  band(cell, cx, 44 + b, 11, c.clothHi)
  for (let y = 24 + b; y <= 32 + b; y++) band(cell, cx, y, 6, c.cloth)
  cell.fillRect(20, 23 + b, 8, 1, c.white)

  // 背后的红腰带结 + 垂带
  cell.fillRect(20, 30 + b, 4, 3, c.sash)
  cell.fillRect(25, 30 + b, 4, 3, c.sash)
  cell.fillRect(24, 30 + b, 1, 3, c.sashHi)
  cell.set(21, 31 + b, c.sashHi)
  cell.set(27, 31 + b, c.sashHi)
  cell.fillRect(24, 33 + b, 2, 6, c.sash)
  cell.set(24, 33 + b, c.sashHi)

  // 宽袖 + 金色袖口
  const sleeveL: [number, number, number][] = [
    [24, 14, 18], [25, 13, 18], [26, 13, 18], [27, 13, 18], [28, 13, 18],
    [29, 13, 18], [30, 13, 18], [31, 13, 18], [32, 14, 18], [33, 14, 18],
  ]
  for (const [y, x0, x1] of sleeveL) {
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
    cell.fillRect(47 - x1, y + b, x1 - x0 + 1, 1, c.cloth)
  }
  band(cell, 16, 33 + b, 3, c.sashHi)
  band(cell, 31, 33 + b, 3, c.sashHi)

  // 后发收在腰部，两侧露出外套
  const rows: [number, number][] = [
    [8, 7], [9, 9], [10, 10], [11, 11], [12, 11], [13, 11], [14, 11], [15, 11],
    [16, 11], [17, 11], [18, 11], [19, 11], [20, 11], [21, 11], [22, 10],
    [23, 10], [24, 10], [25, 10], [26, 9], [27, 9], [28, 9], [29, 9], [30, 8],
    [31, 8], [32, 8], [33, 7], [34, 7], [35, 7], [36, 6], [37, 6], [38, 6],
    [39, 5], [40, 5],
  ]
  for (const [y, half] of rows) band(cell, cx, y + b, half, c.hairLo)
  for (const [y, half] of rows) {
    if (y < 10) continue
    band(cell, cx, y + b, Math.max(3, half - 2), c.hair)
  }
  cell.fillRect(21, 11 + b, 2, 22, c.hairHi)
  cell.fillRect(26, 13 + b, 1, 18, c.hairHi)
  cell.fillRect(18, 12 + b, 1, 16, c.hairHi)
  for (let y = 14 + b; y <= 36 + b; y++) {
    cell.fillRect(12, y, 3, 1, c.hair)
    cell.fillRect(33, y, 3, 1, c.hair)
    cell.set(12, y, c.hairLo)
    cell.set(35, y, c.hairHi)
  }
  for (let y = 37 + b; y <= 39 + b; y++) {
    cell.fillRect(13, y, 2, 1, c.hair)
    cell.fillRect(33, y, 2, 1, c.hair)
  }

  // 紫黑蝴蝶结压在后发上
  cell.fillRect(11, 14 + b, 4, 3, c.hat)
  cell.fillRect(11, 17 + b, 2, 4, c.hatDark)
  cell.fillRect(33, 14 + b, 4, 3, c.hat)
  cell.fillRect(35, 17 + b, 2, 4, c.hatDark)
  cell.set(13, 14 + b, c.hairHi)
  cell.set(34, 14 + b, 0x5d3a75)

  // 腰间太刀（背面只露鞘与柄）
  drawScabbard(cell, c, 9, 41 + b, 17, 34 + b)

  // 露出的双手
  cell.fillRect(13, 31 + b, 3, 3, c.skin)
  cell.fillRect(32, 31 + b, 3, 3, c.skin)
  cell.set(13, 31 + b, c.skinShade)
  cell.set(33, 31 + b, c.skinShade)
}

function murasameSide(cell: PixelCanvas, frame: number): void {
  const c = MURASAME
  const p = v3Pose(frame)
  const b = p.bob

  murasameBackHair(cell, b)
  cell.fillRect(10, 11 + b, 2, 26, c.hair)
  cell.fillRect(12, 9 + b, 7, 2, c.hairHi)
  cell.fillRect(9, 16 + b, 2, 20, c.hair)
  drawLegs(cell, c, p, [18, 24], 4, 44, 49, 53)

  const hem: [number, number, number][] = [
    [33, 18, 29], [34, 17, 30], [35, 17, 31], [36, 16, 31], [37, 16, 31],
    [38, 15, 32], [39, 15, 32], [40, 14, 33], [41, 14, 33], [42, 13, 33], [43, 13, 33],
  ]
  for (const [y, x0, x1] of hem) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  for (let y = 24 + b; y <= 32 + b; y++) cell.fillRect(18, y, 11, 1, c.cloth)
  cell.fillRect(18, 24 + b, 1, 9, c.clothHi)
  cell.fillRect(21, 24 + b, 6, 1, c.white)
  cell.set(20, 25 + b, c.white)
  cell.set(19, 26 + b, c.white)
  cell.fillRect(17, 31 + b, 15, 4, c.sash)
  cell.fillRect(17, 31 + b, 15, 1, c.sashHi)
  for (const x of [19, 23, 27]) cell.set(x, 32 + b, c.sashHi)
  for (const x of [21, 25, 29]) cell.set(x, 33 + b, c.sashHi)
  const sleeveL: [number, number, number][] = [
    [24, 13, 17], [25, 12, 17], [26, 12, 17], [27, 12, 17], [28, 12, 17],
    [29, 12, 17], [30, 12, 17], [31, 12, 17], [32, 13, 17], [33, 13, 17],
  ]
  for (const [y, x0, x1] of sleeveL) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  band(cell, 15, 33 + b, 3, c.clothHi)

  // 侧脸
  cell.fillRect(22, 22 + b, 5, 2, c.skin)
  cell.fillRect(22, 10 + b, 7, 1, c.skin)
  cell.fillRect(21, 11 + b, 9, 9, c.skin)
  cell.fillRect(22, 20 + b, 7, 1, c.skin)
  cell.set(30, 15 + b, c.skin)
  cell.set(30, 16 + b, c.skinShade)
  drawEyePair(cell, 26, 26, 15 + b, 2, 3, c, p.hurt)
  cell.set(28, 19 + b, c.skinShade)
  cell.set(25, 20 + b, c.skinShade)

  const fringe: [number, number, number][] = [
    [20, 8, 15], [21, 8, 14], [22, 8, 13], [23, 8, 14], [24, 8, 13],
    [25, 8, 12], [26, 8, 11], [27, 8, 13], [28, 8, 14], [29, 8, 15],
    [30, 8, 15], [31, 8, 15],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(23, 8 + b, 6, 1, c.hairHi)
  cell.fillRect(18, 12 + b, 3, 27, c.hair)
  cell.set(18, 13 + b, c.hairHi)
  cell.fillRect(30, 14 + b, 3, 3, c.hat)
  cell.fillRect(31, 17 + b, 2, 4, c.hatDark)

  drawScabbard(cell, c, 8, 42 + b, 14, 34 + b)
  if (p.atk === 0) {
    drawKatana(cell, c, 32, 22 + b, 40, 12 + b, true)
    cell.fillRect(29, 24 + b, 3, 3, c.skin)
  } else if (p.atk === 1) {
    drawKatana(cell, c, 28, 26 + b, 42, 26 + b, true)
    cell.fillRect(27, 25 + b, 3, 3, c.skin)
  } else if (p.atk === 2) {
    drawKatana(cell, c, 28, 31 + b, 39, 40 + b, true)
    cell.fillRect(27, 30 + b, 3, 3, c.skin)
  } else {
    cell.fillRect(24, 28 + b, 3, 3, c.skin)
  }
}

/* ============================================================
 * 肥鱼：蓝发女仆装 · 鳍耳 · 蓝眼 · 黄色水枪打泡泡
 * ============================================================ */
function drawWaterGun(cell: PixelCanvas, pal: V3Palette, x: number, y: number): void {
  cell.fillRect(x + 2, y, 4, 1, pal.sashHi)
  cell.fillRect(x, y + 1, 8, 3, pal.accent)
  cell.fillRect(x + 1, y + 1, 6, 1, pal.accentHi)
  cell.fillRect(x, y + 3, 8, 1, 0xd8a13c)
  cell.fillRect(x + 8, y + 2, 6, 1, pal.accent)
  cell.fillRect(x + 8, y + 3, 6, 1, 0xd8a13c)
  cell.fillRect(x + 14, y + 1, 2, 3, pal.sash)
  cell.set(x + 14, y + 1, 0xffffff)
  cell.fillRect(x + 1, y + 4, 2, 3, pal.accent)
  cell.set(x + 4, y + 4, 0xd8a13c)
}

function fishBackHair(cell: PixelCanvas, b: number): void {
  const c = FISH
  const rows: [number, number][] = [
    [10, 7], [11, 9], [12, 10], [13, 10], [14, 10], [15, 10], [16, 10], [17, 10],
    [18, 10], [19, 10], [20, 9], [21, 9], [22, 9], [23, 8], [24, 8], [25, 8],
    [26, 7], [27, 7], [28, 6],
  ]
  for (const [y, half] of rows) band(cell, 24, y + b, half, c.hairLo)
  // 双马尾：椭圆发束 + 下垂发尾，避免锯齿感
  for (const side of [-1, 1]) {
    const bx = side < 0 ? 14 : 34
    cell.ellipse(bx, 21 + b, 4, 9, c.hair)
    cell.ellipse(bx, 21 + b, 3, 8, c.hairLo)
    cell.fillRect(bx - 2, 28 + b, 4, 4, c.hair)
    cell.fillRect(bx - 1, 32 + b, 2, 3, c.hair)
    cell.fillRect(bx - 1, 14 + b, 2, 3, c.hairHi)
    cell.set(bx - 3, 18 + b, c.hairHi)
    cell.set(bx + 2, 24 + b, c.hairHi)
  }
  cell.fillRect(19, 10 + b, 10, 1, c.hairHi)
}

function fishDown(cell: PixelCanvas, frame: number): void {
  const c = FISH
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  fishBackHair(cell, b)

  // 鳍耳
  cell.triangle(15, 17 + b, 10, 20 + b, 15, 23 + b, c.fin)
  cell.triangle(33, 17 + b, 38, 20 + b, 33, 23 + b, c.fin)
  cell.set(12, 19 + b, c.hairHi)
  cell.set(36, 19 + b, c.hairHi)

  drawLegs(cell, c, p, [20, 27], 4, 44, 51, 53)

  // 女仆裙
  const skirt: [number, number][] = [
    [33, 8], [34, 8], [35, 9], [36, 9], [37, 10], [38, 10], [39, 11],
    [40, 11], [41, 11], [42, 12], [43, 12],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 36 + b; y <= 43 + b; y++) {
    cell.set(cx - 8, y, c.clothLo)
    cell.set(cx - 3, y, c.clothLo)
    cell.set(cx + 2, y, c.clothLo)
    cell.set(cx + 7, y, c.clothLo)
  }
  band(cell, cx, 43 + b, 11, c.clothHi)

  // 上身 + 白围裙
  for (let y = 27 + b; y <= 35 + b; y++) band(cell, cx, y, 6 + (y >= 32 ? 1 : 0), c.cloth)
  band(cell, cx, 27 + b, 7, c.clothHi)
  cell.fillRect(20, 29 + b, 9, 14, c.white)
  cell.fillRect(21, 28 + b, 7, 1, c.white)
  cell.fillRect(20, 30 + b, 1, 12, c.hat)
  cell.fillRect(28, 30 + b, 1, 12, c.hat)
  band(cell, cx, 29 + b, 4, c.hat)
  // 荷叶围裙边
  for (const x of [20, 23, 26, 29]) cell.set(x, 43 + b, c.hat)
  // 宝石胸针 / 领结
  cell.fillRect(22, 28 + b, 4, 2, c.sash)
  cell.set(23, 29 + b, c.sashHi)
  cell.set(25, 28 + b, c.sashHi)

  // 泡泡袖
  const sleeves: [number, number, number][] = [
    [27, 15, 18], [28, 14, 19], [29, 14, 19], [30, 14, 19], [31, 15, 18], [32, 15, 18],
  ]
  for (const [y, x0, x1] of sleeves) {
    cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
    cell.fillRect(47 - x1, y + b, x1 - x0 + 1, 1, c.cloth)
  }
  band(cell, 16, 27 + b, 2, c.white)
  band(cell, 31, 27 + b, 2, c.white)

  // 头 + 脸
  cell.fillRect(23, 26 + b, 2, 1, c.skin)
  cell.fillRect(20, 12 + b, 8, 1, c.skin)
  cell.fillRect(18, 13 + b, 12, 1, c.skin)
  cell.fillRect(17, 14 + b, 14, 11, c.skin)
  cell.fillRect(18, 25 + b, 12, 1, c.skin)
  cell.fillRect(20, 26 + b, 8, 1, c.skin)
  drawEyePair(cell, 19, 27, 18 + b, 3, 3, c, p.hurt)
  cell.set(18, 23 + b, c.skinShade)
  cell.set(29, 23 + b, c.skinShade)
  cell.set(23, 24 + b, c.skinShade)
  cell.set(24, 24 + b, c.skinShade)

  // 白色蕾丝头饰
  cell.fillRect(19, 8 + b, 10, 1, c.hat)
  cell.fillRect(17, 9 + b, 14, 1, c.hat)
  cell.fillRect(16, 10 + b, 16, 1, c.hat)
  for (const x of [17, 20, 23, 26, 29, 32]) cell.set(x, 11 + b, c.hat)
  cell.set(21, 9 + b, c.hatDark)
  cell.set(27, 10 + b, c.hatDark)

  // 刘海中分 + 呆毛
  const fringe: [number, number, number][] = [
    [17, 12, 17], [18, 12, 16], [19, 12, 16], [20, 12, 15], [21, 12, 15],
    [22, 12, 16], [23, 12, 17], [24, 12, 17], [25, 12, 16], [26, 12, 15],
    [27, 12, 15], [28, 12, 16], [29, 12, 16], [30, 12, 17], [31, 12, 17],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(19, 12 + b, 4, 1, c.hairHi)
  cell.fillRect(26, 12 + b, 3, 1, c.hairHi)
  cell.set(23, 8 + b, c.hairHi)
  cell.set(23, 9 + b, c.hair)

  // 黄色水枪（闲置时斜抱胸前，攻击帧举起）
  const gx = p.atk >= 0 ? 23 : 25
  const gy = p.atk === 1 ? 22 : p.atk === 0 ? 24 : p.atk === 2 ? 33 : 32
  drawWaterGun(cell, c, gx, gy + b)
  cell.fillRect(gx - 2, gy + 2 + b, 3, 3, c.skin)
  cell.fillRect(gx + 5, gy + 3 + b, 3, 3, c.skin)
  cell.set(gx - 1, gy + 2 + b, c.skinShade)
  cell.set(gx + 6, gy + 3 + b, c.skinShade)
}

function fishUp(cell: PixelCanvas, frame: number): void {
  const c = FISH
  const p = v3Pose(frame)
  const b = p.bob
  const cx = 24
  drawLegs(cell, c, p, [20, 26], 4, 44, 51, 53)
  const skirt: [number, number][] = [
    [33, 8], [34, 8], [35, 9], [36, 9], [37, 10], [38, 10], [39, 11],
    [40, 11], [41, 11], [42, 12], [43, 12],
  ]
  for (const [y, half] of skirt) band(cell, cx, y + b, half, c.cloth)
  for (let y = 36 + b; y <= 43 + b; y++) {
    cell.set(cx - 8, y, c.clothLo)
    cell.set(cx - 3, y, c.clothLo)
    cell.set(cx + 2, y, c.clothLo)
    cell.set(cx + 7, y, c.clothLo)
  }
  band(cell, cx, 43 + b, 11, c.clothHi)
  for (let y = 27 + b; y <= 35 + b; y++) band(cell, cx, y, 6 + (y >= 32 ? 1 : 0), c.cloth)

  fishBackHair(cell, b)

  // 围裙背带 + 腰后白蝴蝶结
  cell.fillRect(19, 29 + b, 2, 6, c.white)
  cell.fillRect(27, 29 + b, 2, 6, c.white)
  cell.fillRect(21, 32 + b, 3, 2, c.white)
  cell.fillRect(24, 32 + b, 3, 2, c.white)
  cell.fillRect(23, 32 + b, 2, 3, c.hat)

  // 头饰背面
  cell.fillRect(19, 8 + b, 10, 1, c.hat)
  cell.fillRect(17, 9 + b, 14, 1, c.hat)
  for (const x of [17, 20, 23, 26, 29, 32]) cell.set(x, 10 + b, c.hatDark)

  // 鳍耳
  cell.triangle(10, 18 + b, 14, 15 + b, 15, 20 + b, c.fin)
  cell.triangle(38, 18 + b, 34, 15 + b, 33, 20 + b, c.fin)

  // 露出的双手
  cell.fillRect(13, 31 + b, 3, 3, c.skin)
  cell.fillRect(32, 31 + b, 3, 3, c.skin)
  cell.set(13, 31 + b, c.skinShade)
  cell.set(33, 31 + b, c.skinShade)
}

function fishSide(cell: PixelCanvas, frame: number): void {
  const c = FISH
  const p = v3Pose(frame)
  const b = p.bob

  fishBackHair(cell, b)
  cell.fillRect(10, 13 + b, 2, 18, c.hair)
  cell.triangle(12, 17 + b, 9, 21 + b, 13, 24 + b, c.fin)
  drawLegs(cell, c, p, [19, 25], 4, 44, 51, 53)

  const skirt: [number, number, number][] = [
    [33, 18, 30], [34, 17, 31], [35, 17, 31], [36, 16, 32], [37, 16, 32],
    [38, 15, 33], [39, 15, 33], [40, 14, 33], [41, 14, 33], [42, 13, 34], [43, 13, 34],
  ]
  for (const [y, x0, x1] of skirt) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)
  for (let y = 27 + b; y <= 35 + b; y++) cell.fillRect(18, y, 12, 1, c.cloth)
  cell.fillRect(19, 27 + b, 2, 10, c.clothHi)
  cell.fillRect(21, 31 + b, 8, 12, c.white)
  cell.fillRect(22, 30 + b, 6, 1, c.white)
  cell.set(20, 30 + b, c.hat)
  // 围裙背带
  cell.fillRect(17, 29 + b, 2, 5, c.white)
  const sleeveL: [number, number, number][] = [
    [27, 15, 18], [28, 14, 19], [29, 14, 19], [30, 14, 19], [31, 15, 18], [32, 15, 18],
  ]
  for (const [y, x0, x1] of sleeveL) cell.fillRect(x0, y + b, x1 - x0 + 1, 1, c.cloth)

  // 侧脸
  cell.fillRect(22, 26 + b, 5, 1, c.skin)
  cell.fillRect(22, 12 + b, 7, 1, c.skin)
  cell.fillRect(21, 13 + b, 9, 11, c.skin)
  cell.fillRect(22, 24 + b, 7, 1, c.skin)
  cell.set(30, 18 + b, c.skin)
  cell.set(30, 19 + b, c.skinShade)
  drawEyePair(cell, 26, 26, 18 + b, 3, 3, c, p.hurt)
  cell.set(27, 23 + b, c.skinShade)
  cell.set(25, 24 + b, c.skinShade)

  const fringe: [number, number, number][] = [
    [20, 12, 17], [21, 12, 16], [22, 12, 16], [23, 12, 15], [24, 12, 15],
    [25, 12, 16], [26, 12, 17], [27, 12, 17], [28, 12, 16], [29, 12, 15],
    [30, 12, 15], [31, 12, 16],
  ]
  for (const [x, y0, y1] of fringe) cell.fillRect(x, y0 + b, 1, y1 - y0 + 1, c.hair)
  cell.fillRect(19, 12 + b, 5, 1, c.hairHi)
  cell.fillRect(18, 8 + b, 12, 1, c.hat)
  cell.fillRect(17, 9 + b, 14, 1, c.hat)
  cell.fillRect(16, 10 + b, 15, 1, c.hat)
  for (const x of [18, 21, 24, 27, 30]) cell.set(x, 11 + b, c.hat)

  const gy = p.atk === 1 ? 23 : p.atk === 0 ? 25 : p.atk === 2 ? 34 : 32
  const gx = p.atk >= 0 ? 24 : 25
  drawWaterGun(cell, c, gx, gy + b)
  cell.fillRect(gx - 3, gy + 2 + b, 3, 3, c.skin)
  cell.fillRect(gx + 4, gy + 3 + b, 3, 3, c.skin)
}

/* ============================================================
 * 特效层（在描边之后绘制，不参与描边）
 * ============================================================ */
function plot(cell: PixelCanvas, x: number, y: number, color: number): void {
  if (x < 2 || x > 45 || y < 2 || y > 54) return
  cell.set(x, y, color)
}

function arcPixels(
  cell: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  color: number,
): void {
  const steps = Math.max(10, Math.round(Math.abs(a1 - a0) * 16))
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps)
    plot(cell, Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), color)
  }
}

function ringPixels(
  cell: PixelCanvas,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: number,
): void {
  arcPixels(cell, cx, cy, rx, ry, 0, Math.PI * 2, color)
}

function sparkle(cell: PixelCanvas, x: number, y: number, color: number, hi: number): void {
  plot(cell, x, y, color)
  plot(cell, x - 1, y, hi)
  plot(cell, x + 1, y, hi)
  plot(cell, x, y - 1, hi)
  plot(cell, x, y + 1, hi)
}

function bubble(
  cell: PixelCanvas,
  x: number,
  y: number,
  r: number,
  rim: number,
  core: number,
  hi: number,
): void {
  ringPixels(cell, x, y, r, r, rim)
  plot(cell, x, y, core)
  plot(cell, x - Math.max(1, r - 1), y - Math.max(1, r - 1), hi)
}

function mutsumiFx(cell: PixelCanvas, frame: number): void {
  const c = MUTSUMI
  const p = v3Pose(frame)
  if (p.atk === 1) {
    for (const [x, y] of [[39, 23], [41, 22], [43, 21], [40, 29], [42, 28]]) {
      plot(cell, x, y, c.sashHi)
      plot(cell, x, y + 1, 0xffffff)
    }
  } else if (p.atk === 2) {
    plot(cell, 40, 35, c.sashHi)
    plot(cell, 42, 37, c.sash)
    plot(cell, 43, 33, 0xffffff)
  }
}

function mortisFx(cell: PixelCanvas, frame: number, skill: boolean, skillCol: number): void {
  const c = MORTIS
  const p = v3Pose(frame)
  if (p.atk === 0) {
    sparkle(cell, 38, 16, c.accent, c.accentHi)
    sparkle(cell, 41, 21, c.accent, c.accentHi)
    sparkle(cell, 35, 12, c.accentHi, 0xffffff)
  } else if (p.atk === 1) {
    arcPixels(cell, 31, 27, 10, 10, -1.1, 1.1, c.accentHi)
    arcPixels(cell, 31, 27, 13, 13, -1.0, 1.0, c.accent)
    arcPixels(cell, 31, 27, 16, 16, -0.9, 0.9, c.accent)
    plot(cell, 44, 20, c.accentHi)
    plot(cell, 43, 34, c.accentHi)
    sparkle(cell, 40, 14, c.accent, c.accentHi)
    sparkle(cell, 42, 40, c.accent, c.accentHi)
  } else if (p.atk === 2) {
    arcPixels(cell, 30, 27, 11, 11, -0.8, 0.9, c.accent)
    arcPixels(cell, 30, 27, 14, 14, -0.6, 0.8, c.accentHi)
    plot(cell, 40, 18, c.accent)
    plot(cell, 42, 30, c.accent)
  }
  if (!skill) return
  if (skillCol <= 1) {
    ringPixels(cell, 24, 50, 13, 2, c.accent)
    ringPixels(cell, 24, 50, 9, 1, c.accentHi)
    sparkle(cell, 12, 20, c.accent, c.accentHi)
    sparkle(cell, 37, 18, c.accent, c.accentHi)
  } else if (skillCol <= 5) {
    for (const [x, y] of [[11, 14], [36, 12], [9, 28], [39, 30], [15, 6], [34, 5]]) {
      sparkle(cell, x, y, c.accent, c.accentHi)
    }
    plot(cell, 12, 36, c.accent)
    plot(cell, 38, 38, c.accentHi)
  } else if (skillCol >= 6) {
    arcPixels(cell, 31, 26, 12, 12, -1.2, 1.2, c.accentHi)
    arcPixels(cell, 31, 26, 15, 15, -1.1, 1.1, c.accent)
    arcPixels(cell, 31, 26, 18, 18, -1.0, 1.0, c.accent)
    sparkle(cell, 42, 14, c.accent, c.accentHi)
    sparkle(cell, 43, 38, c.accent, c.accentHi)
  } else {
    ringPixels(cell, 24, 51, 12, 2, c.accent)
  }
}

function murasameFx(cell: PixelCanvas, frame: number, skill: boolean, skillCol: number): void {
  const c = MURASAME
  const p = v3Pose(frame)
  if (p.atk === 0) {
    arcPixels(cell, 30, 24, 13, 15, -1.45, -0.35, c.accent)
    arcPixels(cell, 30, 24, 10, 12, -1.3, -0.4, c.accentHi)
  } else if (p.atk === 1) {
    arcPixels(cell, 26, 27, 16, 17, -0.95, 0.95, c.accentHi)
    arcPixels(cell, 26, 27, 19, 20, -0.9, 0.9, c.accent)
    arcPixels(cell, 26, 27, 13, 14, -0.85, 0.85, 0xffffff)
    plot(cell, 43, 14, c.accent)
    plot(cell, 44, 42, c.accent)
  } else if (p.atk === 2) {
    arcPixels(cell, 28, 30, 13, 14, 0.35, 1.2, c.accent)
    arcPixels(cell, 28, 30, 10, 11, 0.4, 1.15, c.accentHi)
  }
  if (!skill) return
  const radii = [12, 15, 18]
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i]
    arcPixels(cell, 24, 27, r, r + 1, -1.2 + skillCol * 0.06, 1.2, i === 1 ? c.accentHi : c.accent)
  }
  if (skillCol <= 3) {
    for (let i = 0; i < 4; i++) {
      plot(cell, 8 + i * 2, 34 - i * 3, c.accentHi)
      plot(cell, 10 + i * 2, 35 - i * 3, c.accent)
    }
  } else {
    sparkle(cell, 41, 12, c.accent, c.accentHi)
    sparkle(cell, 43, 40, c.accent, c.accentHi)
  }
}

function fishFx(cell: PixelCanvas, frame: number, skill: boolean, skillCol: number): void {
  const c = FISH
  const p = v3Pose(frame)
  if (p.atk === 0) {
    bubble(cell, 38, 28, 2, c.sash, c.sashHi, 0xffffff)
    bubble(cell, 41, 24, 1, c.sash, c.sashHi, 0xffffff)
  } else if (p.atk === 1) {
    bubble(cell, 36, 24, 3, c.sash, c.sashHi, 0xffffff)
    bubble(cell, 41, 20, 2, c.sash, c.sashHi, 0xffffff)
    bubble(cell, 43, 30, 2, c.sash, c.sashHi, 0xffffff)
    bubble(cell, 38, 33, 2, c.sash, c.sashHi, 0xffffff)
    plot(cell, 42, 16, 0xffffff)
    plot(cell, 44, 26, 0xffffff)
  } else if (p.atk === 2) {
    bubble(cell, 38, 34, 2, c.sash, c.sashHi, 0xffffff)
    bubble(cell, 42, 37, 1, c.sash, c.sashHi, 0xffffff)
  }
  if (!skill) return
  const count = skillCol <= 3 ? 3 : skillCol <= 6 ? 6 : 10
  const spots: [number, number, number][] = [
    [38, 26, 3], [42, 20, 2], [34, 18, 2], [44, 32, 2], [39, 36, 2],
    [30, 14, 1], [43, 14, 2], [36, 40, 2], [28, 22, 1], [45, 24, 2],
  ]
  for (let i = 0; i < count; i++) {
    const [x, y, r] = spots[i % spots.length]
    bubble(cell, x - (skillCol % 3), y, r, c.sash, c.sashHi, 0xffffff)
  }
  if (skillCol >= 6) {
    ringPixels(cell, 24, 51, 13, 2, c.sash)
    ringPixels(cell, 24, 50, 8, 1, c.sashHi)
  }
  // 召唤的小鱼影
  if (skillCol >= 2 && skillCol <= 5) {
    const fx = 33 + (skillCol - 2) * 2
    const fy = 15 + (skillCol % 2) * 3
    cell.fillRect(fx, fy, 5, 2, c.sashHi)
    cell.set(fx + 5, fy, c.sash)
    cell.set(fx + 5, fy + 1, c.sash)
    cell.set(fx - 1, fy, c.sash)
    cell.set(fx + 2, fy - 1, c.sash)
  }
}

/* ---------- 组装 ---------- */
function drawV3Base(
  cell: PixelCanvas,
  id: ArtCharacterId,
  view: V3View,
  frame: number,
  skill: boolean,
): void {
  if (id === 'mutsumi') {
    if (skill) {
      mortisDown(cell, frame)
    } else if (view === 'down') {
      mutsumiDown(cell, frame)
    } else if (view === 'up') {
      mutsumiUp(cell, frame)
    } else {
      mutsumiSide(cell, frame)
    }
    return
  }
  if (id === 'mortis') {
    if (view === 'down') mortisDown(cell, frame)
    else if (view === 'up') mortisUp(cell, frame)
    else mortisSide(cell, frame)
    return
  }
  if (id === 'murasame') {
    if (view === 'down') murasameDown(cell, frame)
    else if (view === 'up') murasameUp(cell, frame)
    else murasameSide(cell, frame)
    return
  }
  if (view === 'down') fishDown(cell, frame)
  else if (view === 'up') fishUp(cell, frame)
  else fishSide(cell, frame)
}

function drawV3Effects(
  cell: PixelCanvas,
  id: ArtCharacterId,
  view: V3View,
  frame: number,
  skill: boolean,
  skillCol: number,
): void {
  if (id === 'mutsumi') {
    if (skill) mortisFx(cell, frame, true, skillCol)
    else if (view === 'down') mutsumiFx(cell, frame)
    return
  }
  if (id === 'mortis') {
    mortisFx(cell, frame, skill, skillCol)
    return
  }
  if (id === 'murasame') {
    murasameFx(cell, frame, skill, skillCol)
    return
  }
  fishFx(cell, frame, skill, skillCol)
}

/**
 * 生成任意角色的 5×10 图集。
 * 行 0..3 = down / up / left（镜像）/ right，行 4 = 技能态。
 */
export function buildCharacterAtlas(id: CharacterId | 'mortis'): AtlasData {
  const cellW = 48
  const cellH = 56
  const canvas = new PixelCanvas(cellW * V3_COLS, cellH * V3_ROWS)
  for (let row = 0; row < V3_ROWS; row++) {
    const skill = row === 4
    const view: V3View = row === 0 ? 'down' : row === 1 ? 'up' : row === 4 ? 'down' : 'side'
    for (let col = 0; col < V3_COLS; col++) {
      const frame = skill ? SKILL_BASE_FRAME[col] : col
      const cell = new PixelCanvas(cellW, cellH)
      drawV3Base(cell, id, view, frame, skill)
      cell.outline(V3_OUTLINE)
      drawV3Effects(cell, id, view, frame, skill, col)
      const out = row === 2 ? cell.mirrored() : cell
      canvas.blit(out, col * cellW, row * cellH)
    }
  }
  return { canvas, cols: V3_COLS, rows: V3_ROWS, cellW, cellH, worldW: 1.5, worldH: 1.75 }
}

/* ============================================================
 * 哥布林：small / brute / elite / caster
 * 28×32 逻辑像素 / 世界高度 1.0m（实体再乘 def.scale × mul.scale）
 * ============================================================ */
export type GoblinKind = 'small' | 'brute' | 'elite' | 'caster' | 'spear' | 'bomber'

/** 只有蛮兵与勇士使用宽体格；长矛手/爆破手沿用普通哥布林的瘦小骨架 */
function isWideGoblin(kind: GoblinKind): boolean {
  return kind === 'brute' || kind === 'elite'
}

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
  const wide = isWideGoblin(kind)
  const lx = wide ? 8 : 10
  const rx = 16
  const lw = wide ? 5 : 4
  drawGoblinLeg(cell, lx, lw, p.legPhase === 1, p.bob)
  drawGoblinLeg(cell, rx, lw, p.legPhase === 2, p.bob)
}

function drawGoblinTorso(cell: PixelCanvas, kind: GoblinKind, back: boolean, oy: number): void {
  const c = GOBLIN
  const wide = isWideGoblin(kind)
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
  const wide = isWideGoblin(kind)
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

  // v4.8：蛮兵/长矛手的骨珠项链，爆破手的备用炸弹袋
  if (kind === 'brute' || kind === 'spear') {
    for (const [x, y] of [[9, 17], [11, 18], [13, 18], [15, 18], [17, 17]] as const) {
      cell.set(x, y + oy, c.tooth)
      cell.set(x, y + 1 + oy, c.woodDark)
    }
  }
  if (kind === 'bomber') {
    cell.fillRect(18, 21 + oy, 4, 4, c.clothDark)
    cell.hLine(18, 21, 21 + oy, c.woodDark)
    cell.set(20, 23 + oy, c.metalDark)
    cell.set(19, 22 + oy, c.metal)
  }
  if (kind === 'elite') {
    // 勇士的金属腰扣
    cell.fillRect(13, 22 + oy, 3, 2, c.metal)
    cell.set(14, 22 + oy, c.tooth)
    cell.set(13, 23 + oy, c.metalDark)
  }
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

/** v4.8 长矛：斜持在身体右侧，矛尖用冷铁色，红布条增加辨识度 */
function drawGoblinSpear(cell: PixelCanvas, hx: number, hy: number, mode: 'down' | 'side'): void {
  const c = GOBLIN
  const tipX = mode === 'side' ? 25 : 24
  const tipY = 3
  // 木柄 + 高光
  cell.line(hx, hy, tipX, tipY + 2, c.woodDark)
  cell.line(hx + 1, hy, tipX, tipY + 3, c.wood)
  // 缠柄布
  cell.set(hx + 1, hy - 3, c.clothDark)
  cell.set(hx + 2, hy - 5, c.clothDark)
  // 枪头（右缘留 1px，避免贴边/镜像后被裁）
  cell.triangle(tipX - 2, tipY + 4, tipX, tipY - 1, tipX, tipY + 4, c.metal)
  cell.line(tipX, tipY - 1, tipX, tipY + 3, c.metalDark)
  cell.set(tipX - 1, tipY + 2, c.tooth)
  // 红布条 / 矛尾铁箍
  cell.set(tipX - 2, tipY + 5, c.accent)
  cell.set(tipX - 3, tipY + 6, c.accent)
  cell.set(tipX - 2, tipY + 7, c.accent)
  cell.set(hx, hy + 2, c.metalDark)
}

/** v4.8 爆破手：圆铁炸弹 + 燃烧引线，背带上挂备用弹 */
function drawGoblinBomb(cell: PixelCanvas, hx: number, hy: number): void {
  const c = GOBLIN
  const bx = hx + 1
  const by = hy - 1
  cell.ellipse(bx, by, 2, 2, 0x1a1714)
  cell.ellipse(bx, by - 1, 1, 1, c.metalDark)
  cell.set(bx - 1, by - 2, c.metal)
  cell.line(bx + 2, by - 2, bx + 3, by - 4, c.woodDark)
  cell.set(bx + 3, by - 5, c.accent)
  cell.set(bx + 4, by - 6, 0xffd166)
  cell.set(bx + 2, by + 2, c.clothDark)
}

function drawGoblinArms(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose, withClub: boolean): void {
  const c = GOBLIN
  const wide = isWideGoblin(kind)
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
    if (withClub) {
      if (kind === 'spear') drawGoblinSpear(cell, 21, 24 + oy + swing, 'down')
      else if (kind === 'bomber') drawGoblinBomb(cell, 21, 24 + oy + swing)
      else drawGoblinClub(cell, 21, 24 + oy + swing, false)
    }
  }
}

/** 勇士的头盔 / 长矛手的红头巾 / 爆破手的皮帽；small 只加战纹 */
function drawGoblinHeadgear(cell: PixelCanvas, kind: GoblinKind, view: 'down' | 'up' | 'side', oy: number): void {
  const c = GOBLIN
  if (kind === 'elite') {
    const x0 = view === 'side' ? 10 : 7
    const x1 = view === 'side' ? 21 : 20
    cell.fillRect(x0, 3 + oy, x1 - x0 + 1, 3, c.metal)
    cell.hLine(x0, x1, 5 + oy, c.metalDark)
    cell.hLine(x0 + 1, x1 - 1, 3 + oy, c.tooth)
    // 盔顶红缨
    cell.fillRect(view === 'side' ? 14 : 13, 0 + oy, 3, 4, c.accent)
    cell.set(view === 'side' ? 14 : 13, 0 + oy, 0xd85b4a)
    cell.set(view === 'side' ? 16 : 15, 1 + oy, c.clothDark)
    // 护耳
    cell.fillRect(view === 'side' ? 9 : 5, 6 + oy, 2, 3, c.metalDark)
    if (view !== 'side') cell.fillRect(21, 6 + oy, 2, 3, c.metalDark)
  } else if (kind === 'spear') {
    cell.hLine(7, 21, 8 + oy, c.accent)
    cell.set(22, 8 + oy, c.accent)
    cell.set(23, 9 + oy, c.accent)
    cell.set(23, 10 + oy, c.clothDark)
    cell.set(8, 8 + oy, 0xd85b4a)
  } else if (kind === 'bomber') {
    cell.fillRect(8, 3 + oy, 13, 2, c.clothDark)
    cell.hLine(7, 21, 5 + oy, c.woodDark)
    cell.hLine(8, 20, 8 + oy, c.accent)
    cell.set(22, 8 + oy, c.accent)
    cell.set(23, 9 + oy, 0xffd166)
  } else if (kind === 'brute') {
    // 蛮兵：右耳挂一枚骨环，肩部另有骨甲
    cell.set(24, 11 + oy, c.tooth)
    cell.set(25, 12 + oy, c.tooth)
    cell.set(24, 13 + oy, c.woodDark)
    cell.set(9, 8 + oy, c.accent)
  }
}

function drawGoblinWarPaint(cell: PixelCanvas, kind: GoblinKind, view: 'down' | 'side', oy: number): void {
  if (kind !== 'small' && kind !== 'spear' && kind !== 'bomber') return
  const c = GOBLIN
  if (view === 'down') {
    cell.set(7, 12 + oy, c.accent)
    cell.set(8, 13 + oy, c.accent)
    cell.set(9, 14 + oy, c.accent)
    cell.set(20, 12 + oy, c.accent)
    cell.set(19, 13 + oy, c.accent)
    cell.set(18, 14 + oy, c.accent)
  } else {
    cell.set(17, 12 + oy, c.accent)
    cell.set(18, 13 + oy, c.accent)
    cell.set(19, 14 + oy, c.accent)
  }
}

function drawPauldrons(cell: PixelCanvas, kind: GoblinKind, mode: 'full' | 'near' = 'full'): void {
  const c = GOBLIN
  if (kind === 'brute') {
    // 蛮兵：粗皮带 + 骨刺护肩，轮廓比普通哥布林更凶
    const nx = mode === 'full' ? 24 : 20
    cell.ellipse(nx, 20, 2, 2, c.clothDark)
    cell.set(nx - 1, 18, c.tooth)
    cell.set(nx, 18, c.tooth)
    cell.set(nx + 1, 19, c.woodDark)
    if (mode === 'full') {
      cell.ellipse(4, 20, 2, 2, c.clothDark)
      cell.set(3, 18, c.tooth)
      cell.set(4, 18, c.tooth)
    }
    return
  }
  if (kind !== 'elite') return
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
  const wide = isWideGoblin(kind)
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
  drawGoblinWarPaint(cell, kind, 'down', oy)
  drawGoblinHeadgear(cell, kind, 'down', oy)
}

function drawGoblinHeadUp(cell: PixelCanvas, kind: GoblinKind, p: GoblinPose): void {
  const c = GOBLIN
  const wide = isWideGoblin(kind)
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
  drawGoblinHeadgear(cell, kind, 'up', oy)
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
  const wide = isWideGoblin(kind)
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

  // 前臂 + 武器
  const swing = p.armSwing
  cell.fillRect(21, 20 + oy, 2, 4, c.skin)
  cell.fillRect(22, 23 + oy + swing, 3, 2, c.skin)
  if (kind === 'spear') drawGoblinSpear(cell, 24, 24 + oy + swing, 'side')
  else if (kind === 'bomber') drawGoblinBomb(cell, 23, 24 + oy + swing)
  else drawGoblinClub(cell, 23, 24 + oy + swing, wide, 'down')
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

  drawGoblinWarPaint(cell, kind, 'side', oy)
  drawGoblinHeadgear(cell, kind, 'side', oy)
  drawPauldrons(cell, kind, 'near')
}

/* ---------- 兜帽法袍哥布林（远程 caster） ---------- */

const CASTER = {
  outline: GOBLIN.outline,
  hood: 0x5a3a78,
  hoodDark: 0x3a2450,
  hoodHi: 0x7d559e,
  robe: 0x4a2c5e,
  robeDark: 0x332040,
  robeHi: 0x6b4788,
  rope: 0x8a5a2e,
  ropeDark: 0x5c3a1c,
  crystal: 0xb46bff,
  crystalHi: 0xd9b3ff,
  crystalDark: 0x7a3cff,
  wood: 0x6e4a2a,
  woodDark: 0x4a2f1a,
}

/** [起始行, x, 宽] 阶梯表，逐行铺到下一项之前（像素风块状轮廓） */
const CASTER_ROBE: [number, number, number][] = [
  [15, 8, 12],
  [16, 7, 14],
  [17, 7, 14],
  [18, 6, 16],
  [19, 6, 16],
  [20, 6, 16],
  [21, 5, 18],
  [22, 5, 18],
  [23, 5, 18],
  [24, 6, 16],
  [25, 7, 14],
  [26, 9, 10],
]

/** 2px 宽木杖 + 顶端紫水晶（x = 杖身最左列，固定在地上不随呼吸起伏） */
function casterStaff(cell: PixelCanvas, x: number): void {
  const k = CASTER
  const cx = x + 1
  cell.fillRect(x, 8, 2, 21, k.woodDark)
  cell.fillRect(x + 1, 8, 1, 21, k.wood)
  cell.set(x, 14, k.wood)
  cell.set(x + 1, 20, k.woodDark)
  // 托住晶体的枯枝
  cell.set(x - 1, 7, k.woodDark)
  cell.set(x + 2, 7, k.woodDark)
  // 紫水晶 + 光晕
  cell.ellipse(cx, 5, 3, 3, k.crystalDark)
  cell.ellipse(cx, 5, 2, 2, k.crystal)
  cell.ellipse(cx, 4, 1, 1, k.crystalHi)
  cell.set(cx, 2, 0xffffff)
  cell.set(cx - 3, 4, k.crystal)
  cell.set(cx + 3, 6, k.crystal)
  cell.set(cx - 2, 7, k.crystalHi)
}

function casterBody(cell: PixelCanvas, oy: number, raisedLeg: number): void {
  const c = GOBLIN
  const k = CASTER
  // 腿（绿皮细腿 + 大脚）
  drawGoblinLeg(cell, 10, 3, raisedLeg === 1, oy)
  drawGoblinLeg(cell, 15, 3, raisedLeg === 2, oy)
  // 破布长袍
  for (const [y, x, w] of CASTER_ROBE) cell.fillRect(x, y + oy, w, 1, k.robe)
  for (let y = 17 + oy; y <= 25 + oy; y++) {
    cell.set(9, y, k.robeDark)
    cell.set(13, y, k.robeDark)
    cell.set(17, y, k.robeDark)
  }
  cell.fillRect(8, 17 + oy, 1, 6, k.robeHi)
  cell.fillRect(18, 18 + oy, 1, 6, k.robeHi)
  // 破布下摆
  for (const x of [6, 9, 12, 15, 18, 21]) cell.set(x, 27 + oy, k.robeDark)
  cell.set(7, 26 + oy, k.robeDark)
  cell.set(20, 26 + oy, k.robeDark)
  // 麻绳腰带
  cell.hLine(6, 21, 20 + oy, k.rope)
  cell.set(9, 20 + oy, k.ropeDark)
  cell.set(13, 20 + oy, k.ropeDark)
  cell.set(17, 20 + oy, k.ropeDark)
  cell.set(21, 21 + oy, k.ropeDark)
  // 肩上的兜帽披布
  cell.fillRect(8, 14 + oy, 12, 3, k.hood)
  cell.fillRect(8, 16 + oy, 2, 2, k.hoodDark)
  cell.fillRect(18, 16 + oy, 2, 2, k.hoodDark)
  // 绿皮手
  cell.fillRect(5, 18 + oy, 3, 2, c.skin)
  cell.set(5, 19 + oy, c.skinDark)
  cell.fillRect(20, 18 + oy, 3, 2, c.skin)
  cell.set(22, 19 + oy, c.skinDark)
}

function casterHoodRows(): [number, number, number][] {
  return [
    [2, 12, 4],
    [3, 10, 8],
    [4, 9, 10],
    [5, 8, 12],
    [6, 7, 14],
    [7, 7, 14],
    [8, 7, 14],
    [9, 7, 14],
    [10, 7, 14],
    [11, 7, 14],
    [12, 7, 14],
    [13, 8, 12],
    [14, 9, 10],
    [15, 10, 8],
  ]
}

function casterHeadDown(cell: PixelCanvas, oy: number): void {
  const c = GOBLIN
  const k = CASTER
  // 尖耳从兜帽下探出
  cell.triangle(8, 11 + oy, 3, 12 + oy, 8, 15 + oy, c.skin)
  cell.triangle(19, 11 + oy, 24, 12 + oy, 19, 15 + oy, c.skin)
  cell.triangle(8, 12 + oy, 5, 13 + oy, 8, 14 + oy, c.skinDark)
  cell.triangle(19, 12 + oy, 22, 13 + oy, 19, 14 + oy, c.skinDark)
  // 尖顶兜帽
  for (const [y, x, w] of casterHoodRows()) cell.fillRect(x, y + oy, w, 1, k.hood)
  cell.set(14, 1 + oy, k.hood)
  cell.set(15, 1 + oy, k.hood)
  cell.set(14, 2 + oy, k.hoodHi)
  cell.hLine(9, 18, 5 + oy, k.hoodHi)
  cell.hLine(10, 17, 6 + oy, k.hoodDark)
  cell.vLine(13, 5 + oy, 12 + oy, k.hoodDark)
  cell.set(8, 9 + oy, k.hoodHi)
  cell.set(19, 10 + oy, k.hoodHi)
  // 帽檐投在脸上的阴影
  cell.fillRect(10, 9 + oy, 8, 1, k.hoodDark)
  // 脸
  cell.fillRect(10, 10 + oy, 8, 6, c.skin)
  cell.fillRect(9, 12 + oy, 1, 3, c.skinDark)
  cell.set(18, 12 + oy, c.skinDark)
  cell.hLine(10, 17, 10 + oy, c.skinDark)
  // 黄眼 + 黑瞳
  cell.fillRect(11, 11 + oy, 2, 2, c.eye)
  cell.fillRect(15, 11 + oy, 2, 2, c.eye)
  cell.set(12, 12 + oy, c.eyeDark)
  cell.set(16, 12 + oy, c.eyeDark)
  cell.set(11, 11 + oy, c.tooth)
  cell.set(15, 11 + oy, c.tooth)
  // 鼻子、咧嘴与獠牙
  cell.set(13, 13 + oy, c.skinDark)
  cell.hLine(12, 16, 15 + oy, c.eyeDark)
  cell.set(13, 15 + oy, c.tooth)
  cell.set(15, 15 + oy, c.tooth)
}

function casterHeadUp(cell: PixelCanvas, oy: number): void {
  const k = CASTER
  for (const [y, x, w] of casterHoodRows()) cell.fillRect(x, y + oy, w, 1, k.hood)
  cell.set(14, 1 + oy, k.hood)
  cell.set(15, 1 + oy, k.hood)
  cell.hLine(9, 18, 5 + oy, k.hoodHi)
  // 背面中缝与褶皱
  cell.vLine(14, 6 + oy, 14 + oy, k.hoodDark)
  cell.vLine(11, 8 + oy, 13 + oy, k.hoodDark)
  cell.vLine(17, 8 + oy, 13 + oy, k.hoodDark)
  cell.fillRect(9, 15 + oy, 10, 2, k.hoodDark)
  cell.set(12, 16 + oy, k.hood)
  cell.set(17, 16 + oy, k.hood)
}

function casterHeadSide(cell: PixelCanvas, oy: number): void {
  const c = GOBLIN
  const k = CASTER
  // 兜帽（帽尖朝后）
  const rows: [number, number, number][] = [
    [2, 12, 5],
    [3, 10, 8],
    [4, 9, 10],
    [5, 8, 11],
    [6, 7, 13],
    [7, 7, 13],
    [8, 7, 13],
    [9, 7, 13],
    [10, 7, 13],
    [11, 8, 12],
    [12, 9, 11],
    [13, 10, 9],
    [14, 11, 7],
  ]
  for (const [y, x, w] of rows) cell.fillRect(x, y + oy, w, 1, k.hood)
  cell.triangle(12, 3 + oy, 3, 6 + oy, 11, 9 + oy, k.hood)
  cell.triangle(10, 5 + oy, 5, 6 + oy, 9, 8 + oy, k.hoodDark)
  cell.hLine(9, 17, 5 + oy, k.hoodHi)
  cell.fillRect(8, 14 + oy, 8, 2, k.hoodDark)
  // 向后探出的绿耳
  cell.triangle(10, 10 + oy, 6, 11 + oy, 10, 13 + oy, c.skin)
  cell.triangle(10, 11 + oy, 8, 11 + oy, 10, 12 + oy, c.skinDark)
  // 口鼻与脸
  cell.fillRect(13, 10 + oy, 6, 5, c.skin)
  cell.fillRect(17, 10 + oy, 4, 5, c.skin)
  cell.triangle(20, 10 + oy, 22, 12 + oy, 20, 14 + oy, c.skin)
  cell.set(21, 12 + oy, c.skinDark)
  cell.fillRect(13, 15 + oy, 5, 1, c.skin)
  cell.set(13, 16 + oy, c.skinDark)
  // 脸侧阴影 / 眼 / 咧嘴
  cell.hLine(13, 19, 9 + oy, k.hoodDark)
  cell.fillRect(16, 11 + oy, 2, 2, c.eye)
  cell.set(17, 12 + oy, c.eyeDark)
  cell.set(16, 11 + oy, c.tooth)
  cell.hLine(18, 21, 14 + oy, c.eyeDark)
  cell.set(19, 14 + oy, c.tooth)
  cell.set(21, 15 + oy, c.tooth)
}

function drawCasterDown(cell: PixelCanvas, p: GoblinPose): void {
  const oy = p.bob
  casterBody(cell, oy, p.legPhase)
  casterHeadDown(cell, oy)
  casterStaff(cell, 4)
}

function drawCasterUp(cell: PixelCanvas, p: GoblinPose): void {
  const oy = p.bob
  casterBody(cell, oy, p.legPhase)
  casterHeadUp(cell, oy)
  casterStaff(cell, 21)
}

function drawCasterSide(cell: PixelCanvas, p: GoblinPose): void {
  const c = GOBLIN
  const k = CASTER
  const oy = p.bob
  // 腿
  drawGoblinLeg(cell, 9, 3, p.legPhase === 1, oy)
  drawGoblinLeg(cell, 13, 3, p.legPhase === 2, oy)
  // 侧身长袍
  const robe: [number, number, number][] = [
    [15, 11, 9],
    [16, 10, 11],
    [17, 9, 12],
    [18, 9, 12],
    [19, 9, 12],
    [20, 9, 12],
    [21, 9, 12],
    [22, 9, 12],
    [23, 10, 11],
    [24, 11, 10],
    [25, 12, 8],
    [26, 13, 7],
  ]
  for (const [y, x, w] of robe) cell.fillRect(x, y + oy, w, 1, k.robe)
  for (let y = 17 + oy; y <= 25 + oy; y++) {
    cell.set(11, y, k.robeDark)
    cell.set(15, y, k.robeDark)
  }
  cell.fillRect(10, 17 + oy, 1, 6, k.robeHi)
  for (const x of [13, 16, 19]) cell.set(x, 27 + oy, k.robeDark)
  cell.set(12, 26 + oy, k.robeDark)
  // 麻绳腰带
  cell.hLine(9, 20, 20 + oy, k.rope)
  cell.set(12, 20 + oy, k.ropeDark)
  cell.set(16, 20 + oy, k.ropeDark)
  // 兜帽披布
  cell.fillRect(9, 14 + oy, 11, 3, k.hood)
  cell.fillRect(10, 16 + oy, 2, 2, k.hoodDark)
  // 后手 / 前手
  cell.fillRect(10, 18 + oy, 3, 2, c.skin)
  cell.set(10, 19 + oy, c.skinDark)
  cell.fillRect(19, 18 + oy, 3, 2, c.skin)
  cell.set(21, 19 + oy, c.skinDark)
  casterHeadSide(cell, oy)
  casterStaff(cell, 20)
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
      if (kind === 'caster') {
        // 兜帽法袍哥布林：独立的绘制分支，不改动 small / brute / elite 的视觉
        cell = new PixelCanvas(cellW, cellH)
        if (dir === 'up') drawCasterUp(cell, pose)
        else if (dir === 'down') drawCasterDown(cell, pose)
        else {
          drawCasterSide(cell, pose)
          if (dir === 'left') cell = cell.mirrored()
        }
      } else if (dir === 'up') {
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
 * 敌方弹幕：紫色能量球 / 16×16 逻辑像素 / 4 帧脉冲
 * ============================================================ */
export function buildEnemyBulletAtlas(): AtlasData {
  const cellW = 16
  const cellH = 16
  const cols = 4
  const rows = 1
  const canvas = new PixelCanvas(cellW * cols, cellH * rows)
  const pulse = [4, 5, 6, 5]
  const center = 8
  for (let frame = 0; frame < cols; frame++) {
    const cell = new PixelCanvas(cellW, cellH)
    const r = pulse[frame]
    // 外圈光晕（四向 + 斜角），越亮的帧光晕越远
    cell.set(center, center - r - 1, 0x5a2a99)
    cell.set(center - r - 1, center, 0x5a2a99)
    cell.set(center, center + r + 1, 0x5a2a99)
    cell.set(center + r + 1, center, 0x5a2a99)
    if (r >= 6) {
      cell.set(center - r, center - r, 0xb46bff)
      cell.set(center + r, center - r, 0xb46bff)
      cell.set(center - r, center + r, 0xb46bff)
      cell.set(center + r, center + r, 0xb46bff)
    }
    // 球体：外紫 → 内亮紫 → 白热核心
    cell.ellipse(center, center, r, r, 0x7a3cff)
    cell.ellipse(center, center, r - 1, r - 1, 0x9d5cff)
    cell.ellipse(center, center, r - 2, r - 2, 0xd9b3ff)
    cell.ellipse(center, center, 1, 1, 0xfff4ff)
    // 左上高光
    cell.set(center - 2, center - 2, 0xffffff)
    cell.set(center - 3, center - 2, 0xffffff)
    cell.set(center - 2, center - 3, 0xffffff)
    // 能量火花
    cell.set(center + 3, center - 1, 0xb46bff)
    cell.set(center - 4, center + 2, 0xb46bff)
    cell.set(center + 1, center + 4, 0x7a3cff)
    canvas.blit(cell, frame * cellW, 0)
  }
  return { canvas, cols, rows, cellW, cellH, worldW: 0.55, worldH: 0.55 }
}

/* ============================================================
 * 哥布林之王：52×60 逻辑像素 / 世界高度 2.2m
 * 金冠、烂披风、巨斧、驼背巨躯，站立时有呼吸起伏
 * ============================================================ */
interface KingPalette {
  outline: number
  skin: number
  skinDark: number
  skinHi: number
  cloth: number
  wood: number
  woodDark: number
  cape: number
  capeDark: number
  gold: number
  goldHi: number
  goldDark: number
  metal: number
  metalDark: number
  tooth: number
  eye: number
}

/** 三套王族配色：原版绿皮金冠 / 赤褐督军 / 紫皮巫王 */
const KING_PALETTES: Record<BossKind, KingPalette> = {
  king: {
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
  },
  warlord: {
    outline: 0x150b09,
    skin: 0x8a7a3f,
    skinDark: 0x5a4e25,
    skinHi: 0xb6a15c,
    cloth: 0x4a241b,
    wood: 0x6d3b24,
    woodDark: 0x3b1e12,
    cape: 0x8f2024,
    capeDark: 0x4c0e11,
    gold: 0xc98f38,
    goldHi: 0xf4cf86,
    goldDark: 0x7e4d1b,
    metal: 0xb9b3a6,
    metalDark: 0x625d52,
    tooth: 0xf0e2c4,
    eye: 0xff8a3d,
  },
  witch: {
    outline: 0x0b0915,
    skin: 0x8d77b7,
    skinDark: 0x5b477f,
    skinHi: 0xc6b2ea,
    cloth: 0x302540,
    wood: 0x4b3563,
    woodDark: 0x291b39,
    cape: 0x4d2170,
    capeDark: 0x28113d,
    gold: 0x92ddc8,
    goldHi: 0xe1fff7,
    goldDark: 0x4f8b7e,
    metal: 0x9caebc,
    metalDark: 0x4b5a67,
    tooth: 0xd9f7ee,
    eye: 0x7ff4ff,
  },
}

let kingPalette = KING_PALETTES.king
let kingVariant: BossKind = 'king'

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
  const c = kingPalette
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
  const c = kingPalette
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
  const c = kingPalette
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
  const c = kingPalette
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
  const c = kingPalette
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
  const c = kingPalette
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
  const c = kingPalette
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
  drawKingVariantSignature(cell, oy)
}

/** 变体剪影：督军的铁角 / 巫王的额间第三眼 */
function drawKingVariantSignature(cell: PixelCanvas, oy: number, side = false): void {
  const c = kingPalette
  if (kingVariant === 'warlord') {
    if (side) {
      cell.line(20, 8 + oy, 14, 2 + oy, c.metalDark)
      cell.line(21, 8 + oy, 15, 2 + oy, c.metal)
      cell.line(35, 8 + oy, 41, 2 + oy, c.metalDark)
      cell.line(34, 8 + oy, 40, 2 + oy, c.metal)
      cell.set(14, 2 + oy, c.tooth)
      cell.set(41, 2 + oy, c.tooth)
    } else {
      cell.line(17, 8 + oy, 12, 3 + oy, c.metalDark)
      cell.line(18, 8 + oy, 13, 3 + oy, c.metal)
      cell.line(35, 8 + oy, 40, 3 + oy, c.metalDark)
      cell.line(34, 8 + oy, 39, 3 + oy, c.metal)
      cell.set(12, 2 + oy, c.tooth)
      cell.set(40, 2 + oy, c.tooth)
    }
  } else if (kingVariant === 'witch') {
    const cx = side ? 29 : 26
    cell.fillRect(cx - 1, 13 + oy, 3, 2, c.goldDark)
    cell.set(cx, 13 + oy, c.eye)
    cell.set(cx, 14 + oy, c.goldHi)
    if (side) {
      cell.hLine(18, 36, 10 + oy, c.goldDark)
      cell.hLine(19, 35, 9 + oy, c.gold)
    } else {
      cell.set(14, 14 + oy, c.goldDark)
      cell.set(38, 14 + oy, c.goldDark)
    }
  }
}

/* ---------- 王的头部（背面） ---------- */
function drawKingHeadUp(cell: PixelCanvas, p: KingPose): void {
  const c = kingPalette
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
  drawKingVariantSignature(cell, oy)
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
  const c = kingPalette
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
  drawKingVariantSignature(cell, oy, true)
}

export function buildKingAtlas(kind: BossKind = 'king'): AtlasData {
  kingPalette = KING_PALETTES[kind]
  kingVariant = kind
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
      cell.outline(kingPalette.outline)
      canvas.blit(cell, frame * cellW, row * cellH)
    }
  }
  const scale = kind === 'warlord' ? { worldW: 2.08, worldH: 2.38 } : kind === 'witch' ? { worldW: 1.86, worldH: 2.16 } : { worldW: 1.9, worldH: 2.2 }
  return { canvas, cols: FRAME_COLS, rows: FRAME_ROWS, cellW, cellH, ...scale }
}
