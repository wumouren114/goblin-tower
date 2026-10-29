import type { ThemeDef, ThemeId } from '../types'

/**
 * ============================================================
 *  v3 场景主题（9 套 = 3 阶段 × 3 场景）
 *
 *  - 字段沿用旧 ThemeDef 结构，id 与 SceneDef.themeId 一一对应
 *  - family 复用旧的 5 种视觉家族（moss/candle/forge/frost/throne），
 *    供 textures.ts / props.ts 选取地面细节与道具原型，
 *    这样 9 套主题只换配色与氛围，程序化细节代码不用复制 9 份
 *  - 阶段 1 暖绿苔石 / 阶段 2 熔火橙红 / 阶段 3 霜蓝·紫金
 *    （阶段 3 的 Boss 场景「王座之巅」紫金压暗：雾更浓、整体更暗）
 * ============================================================
 */
export type ThemeV3 = Omit<ThemeDef, 'id'> & {
  /** 与 SceneDef.themeId 对应 */
  id: string
  /** 视觉家族：决定地面/墙面细节与道具原型 */
  family: ThemeId
  /** 所属阶段 1..3 */
  stage: number
}

/**
 * textures/props 接受的主题形状。
 * 旧 ThemeDef（如遗留的 stairs.ts 仍会传）也能用，familyOf 会退回旧 id。
 */
export type ThemeLike = ThemeV3 | ThemeDef

/** 取得视觉家族：v3 主题用 family，旧 ThemeDef 用 id（旧 id 恰好就是家族名） */
export function familyOf(theme: ThemeLike): ThemeId {
  const t = theme as Partial<ThemeV3>
  return t.family ?? (theme.id as ThemeId)
}

/** 9 套主题（key = themeId） */
export const THEMES_V3: Record<string, ThemeV3> = {
  /* ---------------- 阶段 1：苔石遗迹（暖绿） ---------------- */
  'stage1-hall': {
    id: 'stage1-hall',
    name: '苔石前厅',
    family: 'moss',
    stage: 1,
    floorColor: 0x5d6b57,
    floorAltColor: 0x4a5746,
    wallColor: 0x3b4438,
    wallTopColor: 0x66705f,
    accentColor: 0x9fe3b0,
    fogColor: 0x0d1512,
    fogDensity: 0.026,
    ambientColor: 0x5f7f8a,
    ambientIntensity: 0.75,
    keyColor: 0xffe3b0,
    keyIntensity: 2.2,
    propColors: [0x51604c, 0x6f7a63, 0x3f4b3c],
    torchColor: 0xffb35c,
  },
  'stage1-candle': {
    id: 'stage1-candle',
    name: '烛影回廊',
    family: 'candle',
    stage: 1,
    floorColor: 0x6b5a4c,
    floorAltColor: 0x594a3f,
    wallColor: 0x463730,
    wallTopColor: 0x7a6555,
    accentColor: 0xffc46b,
    fogColor: 0x140d09,
    fogDensity: 0.03,
    ambientColor: 0x7a5a4a,
    ambientIntensity: 0.7,
    keyColor: 0xffb066,
    keyIntensity: 2.5,
    propColors: [0x5c4a3d, 0x7d6450, 0x453832],
    torchColor: 0xffa53c,
  },
  'stage1-courtyard': {
    id: 'stage1-courtyard',
    name: '荒弃庭院',
    family: 'moss',
    stage: 1,
    // 比前厅更冷、更荒：苔色偏灰绿，雾里带一点月色
    floorColor: 0x566450,
    floorAltColor: 0x424f3f,
    wallColor: 0x333c31,
    wallTopColor: 0x5c6656,
    accentColor: 0xa8e0c0,
    fogColor: 0x0b1410,
    fogDensity: 0.03,
    ambientColor: 0x54707c,
    ambientIntensity: 0.68,
    keyColor: 0xd8e6b8,
    keyIntensity: 2.15,
    propColors: [0x4a5846, 0x66735c, 0x384434],
    torchColor: 0xc8e88a,
  },

  /* ---------------- 阶段 2：熔火工坊（橙红） ---------------- */
  'stage2-forge': {
    id: 'stage2-forge',
    name: '熔火铁砧',
    family: 'forge',
    stage: 2,
    // 第二幕整体提亮半档：石面偏暖灰，暗色铁器才不会被地板吞掉
    floorColor: 0x53463f,
    floorAltColor: 0x423733,
    wallColor: 0x332a27,
    wallTopColor: 0x74533f,
    accentColor: 0xff7a3c,
    fogColor: 0x180a06,
    fogDensity: 0.032,
    ambientColor: 0x9a5a44,
    ambientIntensity: 0.72,
    keyColor: 0xff9a5a,
    keyIntensity: 2.85,
    propColors: [0x6a5348, 0x836250, 0x453a35],
    torchColor: 0xff6a1f,
  },
  'stage2-slag': {
    id: 'stage2-slag',
    name: '熔渣坑道',
    family: 'forge',
    stage: 2,
    // 更深更红的坑道：雾更浓，但地砖/道具保留一圈可读的暖灰边
    floorColor: 0x4a3c37,
    floorAltColor: 0x3c3131,
    wallColor: 0x2c221f,
    wallTopColor: 0x67412f,
    accentColor: 0xff5a2a,
    fogColor: 0x140603,
    fogDensity: 0.036,
    ambientColor: 0x9a4e3c,
    ambientIntensity: 0.68,
    keyColor: 0xff7a40,
    keyIntensity: 2.75,
    propColors: [0x5c443b, 0x75564a, 0x3b2e2b],
    torchColor: 0xff4d12,
  },
  'stage2-ember': {
    id: 'stage2-ember',
    name: '焦土祭坛',
    family: 'forge',
    stage: 2,
    // 焦土：更灰的褐，余烬色偏金橙
    floorColor: 0x5a4a40,
    floorAltColor: 0x483b34,
    wallColor: 0x382c27,
    wallTopColor: 0x7e5a3f,
    accentColor: 0xffb054,
    fogColor: 0x1a0d08,
    fogDensity: 0.028,
    ambientColor: 0xaa7454,
    ambientIntensity: 0.76,
    keyColor: 0xffc080,
    keyIntensity: 2.9,
    propColors: [0x6b5144, 0x886456, 0x4a3932],
    torchColor: 0xffa040,
  },

  /* ---------------- 阶段 3：霜蚀圣所（霜蓝 / 紫金） ---------------- */
  'stage3-frost': {
    id: 'stage3-frost',
    name: '霜蚀圣所',
    family: 'frost',
    stage: 3,
    floorColor: 0x5a6b78,
    floorAltColor: 0x4a5a66,
    wallColor: 0x38454f,
    wallTopColor: 0x8ea6b5,
    accentColor: 0x8fe3ff,
    fogColor: 0x08121a,
    fogDensity: 0.03,
    ambientColor: 0x6a93b0,
    ambientIntensity: 0.85,
    keyColor: 0xcfe8ff,
    keyIntensity: 2.3,
    propColors: [0x4e5f6c, 0x6d8494, 0x33414c],
    torchColor: 0x7fdcff,
  },
  'stage3-iron': {
    id: 'stage3-iron',
    name: '寒铁回廊',
    family: 'frost',
    stage: 3,
    // 寒铁：去掉肤色的蓝灰，金属感更重
    floorColor: 0x54636e,
    floorAltColor: 0x44525c,
    wallColor: 0x323d47,
    wallTopColor: 0x7f96a5,
    accentColor: 0x9fd8ff,
    fogColor: 0x060f17,
    fogDensity: 0.032,
    ambientColor: 0x5d7f9c,
    ambientIntensity: 0.8,
    keyColor: 0xbfd8e8,
    keyIntensity: 2.1,
    propColors: [0x465762, 0x637a8a, 0x2c3941],
    torchColor: 0x8ad4ff,
  },
  'stage3-throne': {
    id: 'stage3-throne',
    name: '王座之巅',
    family: 'throne',
    stage: 3,
    // Boss 场景：紫金压暗 —— 比常驻王座更暗的雾，金色强调色收着用
    floorColor: 0x4a3850,
    floorAltColor: 0x3a2b42,
    wallColor: 0x281c2c,
    wallTopColor: 0x6a4460,
    accentColor: 0xffc84d,
    fogColor: 0x0e0610,
    fogDensity: 0.042,
    ambientColor: 0x6a4276,
    ambientIntensity: 0.62,
    keyColor: 0xffc85a,
    keyIntensity: 2.4,
    propColors: [0x453050, 0x5f3f5e, 0x241a2a],
    torchColor: 0xffb347,
  },
}

/** 所有主题（稳定顺序：阶段 1 → 3，场景 1 → 3） */
export const THEME_V3_LIST: ThemeV3[] = Object.values(THEMES_V3)

/** 契约里写的单数名（SceneDef.themeId → 主题表） */
export const THEME_V3 = THEMES_V3

/** 缺省主题：阶段 1 场景 1（仅在 SceneDef.themeId 写错时兜底） */
export const DEFAULT_THEME_ID = 'stage1-hall'

/** 按 themeId 取主题；未知 id 兜底到 DEFAULT_THEME_ID，保证 build 不炸 */
export function themeFor(themeId: string): ThemeV3 {
  return THEMES_V3[themeId] ?? THEMES_V3[DEFAULT_THEME_ID]
}

/** 每个阶段的主题 id 列表（HUD / 调试用） */
export const STAGE_THEME_IDS: string[][] = [1, 2, 3].map((stage) =>
  THEME_V3_LIST.filter((t) => t.stage === stage).map((t) => t.id),
)
