import type { ThemeDef, ThemeId } from '../types'

/**
 * ============================================================
 *  v5 场景主题（3 个场景区 × 3 个变体 = 9 套）
 *
 *  - 整体从「暗雾 + 低环境光」翻转为「明亮二次元奇幻」：
 *    提亮的是**颜色**而不是纯强度（floor.ts 里 hemi ×1.62、fog ×0.46 的系数保持不变，
 *    所以这里填的 fogDensity / ambientIntensity 会被再放大/衰减一次）。
 *  - 3 个场景区对应三大层，世界观设定为「被塔吞下的世界回声」：
 *      区 1 云上花庭（春日晴空）  → 阶段 1
 *      区 2 星砂观星台（永恒黄昏）→ 阶段 2
 *      区 3 黄铜钟塔（塔的心室）  → 阶段 3
 *  - 同一场景区的 3 个变体靠「天气 / 时段 / 布局」区分，几何与碰撞完全一致。
 *  - family 决定地面细节与道具原型（textures.ts / props.ts），暂沿用旧家族，
 *    等场景地标与功能道具落地后再换。
 * ============================================================ */
export type ThemeV3 = Omit<ThemeDef, 'id'> & {
  /** 与 SceneDef.themeId 对应 */
  id: string
  /** 视觉家族：决定地面/墙面细节与道具原型 */
  family: ThemeId
  /** 所属阶段 1..3（= 第几个大层） */
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
  /* ---------------- 区 1：云上花庭（春日晴空，最亮） ---------------- */
  'stage1-hall': {
    id: 'stage1-hall',
    name: '云上花庭 · 晨光',
    family: 'moss',
    stage: 1,
    floorColor: 0xbfd3c7,
    floorAltColor: 0xa9bfb2,
    wallColor: 0xaec7bf,
    wallTopColor: 0xdceee4,
    accentColor: 0xff8fae,
    fogColor: 0xd8eef6,
    fogDensity: 0.019,
    ambientColor: 0x9fcdf5,
    ambientIntensity: 0.84,
    keyColor: 0xfff3dc,
    keyIntensity: 2.0,
    propColors: [0xa8c6a0, 0xc6dcc0, 0x8fae8a],
    torchColor: 0xffd7a0,
  },
  'stage1-candle': {
    id: 'stage1-candle',
    name: '云上花庭 · 风起',
    family: 'moss',
    stage: 1,
    // 起风：整层偏暖白，蒲公英金做强调色
    floorColor: 0xd4ccb6,
    floorAltColor: 0xc1b8a2,
    wallColor: 0xc4bba4,
    wallTopColor: 0xeee6d2,
    accentColor: 0xffb84d,
    fogColor: 0xf0f4e8,
    fogDensity: 0.021,
    ambientColor: 0xaed6f5,
    ambientIntensity: 0.82,
    keyColor: 0xfff2d8,
    keyIntensity: 2.05,
    propColors: [0xbfc9a8, 0xd6dcc4, 0xa4ae90],
    torchColor: 0xffe0a8,
  },
  'stage1-courtyard': {
    id: 'stage1-courtyard',
    name: '云上花庭 · 花落',
    family: 'moss',
    stage: 1,
    // 花落：地板带一层淡粉，天光是淡紫（不是压暗，是换色温）
    floorColor: 0xd8c2cb,
    floorAltColor: 0xc4aeb8,
    wallColor: 0xcbb4be,
    wallTopColor: 0xf0e2e8,
    accentColor: 0xff7fa2,
    fogColor: 0xf4e6ec,
    fogDensity: 0.020,
    ambientColor: 0xc3b4f0,
    ambientIntensity: 0.84,
    keyColor: 0xffe8d0,
    keyIntensity: 1.95,
    propColors: [0xd8b8c8, 0xe6cdd8, 0xbfa0b0],
    torchColor: 0xffc8d8,
  },

  /* ---------------- 区 2：星砂观星台（永恒黄昏，暗底强自发光） ---------------- */
  'stage2-forge': {
    id: 'stage2-forge',
    name: '星砂观星台 · 暮色',
    family: 'forge',
    stage: 2,
    // 黄昏：靛蓝地砖，黄道仪投出的金光作为主要亮部
    floorColor: 0x556090,
    floorAltColor: 0x47527f,
    wallColor: 0x3f4772,
    wallTopColor: 0x8f9bd0,
    accentColor: 0xffd479,
    fogColor: 0x2b3a6b,
    fogDensity: 0.020,
    ambientColor: 0x8fa8ff,
    ambientIntensity: 1.0,
    keyColor: 0xffe0a8,
    keyIntensity: 1.85,
    propColors: [0x6a70a0, 0x8488b8, 0x545a86],
    torchColor: 0xffd479,
  },
  'stage2-slag': {
    id: 'stage2-slag',
    name: '星砂观星台 · 砂河',
    family: 'forge',
    stage: 2,
    // 星砂流：砂是青白色，地板稍暗以托住发光带
    floorColor: 0x5a5a86,
    floorAltColor: 0x4c4c76,
    wallColor: 0x43436a,
    wallTopColor: 0x9a9ad0,
    accentColor: 0xa8f0ff,
    fogColor: 0x33406e,
    fogDensity: 0.022,
    ambientColor: 0x9fc4ff,
    ambientIntensity: 0.98,
    keyColor: 0xfff0c8,
    keyIntensity: 1.8,
    propColors: [0x6e6e9c, 0x8a8ab8, 0x585882],
    torchColor: 0xa8f0ff,
  },
  'stage2-ember': {
    id: 'stage2-ember',
    name: '星砂观星台 · 流星',
    family: 'forge',
    stage: 2,
    // 流星雨：强调色换成粉紫，天光更亮一档
    floorColor: 0x565a88,
    floorAltColor: 0x484c78,
    wallColor: 0x40446c,
    wallTopColor: 0x9498cc,
    accentColor: 0xffb0d0,
    fogColor: 0x35406e,
    fogDensity: 0.020,
    ambientColor: 0xb0a8ff,
    ambientIntensity: 1.02,
    keyColor: 0xffd8c0,
    keyIntensity: 1.8,
    propColors: [0x6a6e9e, 0x868aba, 0x54587e],
    torchColor: 0xffb0d0,
  },

  /* ---------------- 区 3：黄铜钟塔（塔的心室，暖金 + 铜锈青绿） ---------------- */
  'stage3-frost': {
    id: 'stage3-frost',
    name: '黄铜钟塔 · 齿轮厅',
    family: 'frost',
    stage: 3,
    // 齿轮厅：黄铜地面 + 铜锈青绿作强调，最"工坊感"的一层
    floorColor: 0xc9a978,
    floorAltColor: 0xb8976a,
    wallColor: 0xa88554,
    wallTopColor: 0xe6c894,
    accentColor: 0x64e0c0,
    fogColor: 0xe0c9a8,
    fogDensity: 0.019,
    ambientColor: 0xffd9a8,
    ambientIntensity: 0.95,
    keyColor: 0xfff0d0,
    keyIntensity: 1.8,
    propColors: [0x8a6a3f, 0xa8845a, 0x6f5632],
    torchColor: 0xff9a3c,
  },
  'stage3-iron': {
    id: 'stage3-iron',
    name: '黄铜钟塔 · 熔金槽',
    family: 'forge',
    stage: 3,
    // 熔金：整体抬亮，让橙色熔金流成为唯一的高饱和危险信号
    floorColor: 0xbfa582,
    floorAltColor: 0xac9374,
    wallColor: 0x9c8462,
    wallTopColor: 0xdcc09a,
    accentColor: 0xff9a3c,
    fogColor: 0xf0d8b8,
    fogDensity: 0.020,
    ambientColor: 0xffc890,
    ambientIntensity: 0.98,
    keyColor: 0xffb070,
    keyIntensity: 1.9,
    propColors: [0x86683f, 0xa2825a, 0x6b5232],
    torchColor: 0xff7a20,
  },
  'stage3-throne': {
    id: 'stage3-throne',
    name: '黄铜钟塔 · 塔心',
    family: 'throne',
    stage: 3,
    // Boss 层：唯一允许压暗的地方（紫金），但地面仍保持明亮黄铜
    floorColor: 0xa88f6a,
    floorAltColor: 0x967e5c,
    wallColor: 0x8a7250,
    wallTopColor: 0xe0c084,
    accentColor: 0xffc84d,
    fogColor: 0x3a3050,
    fogDensity: 0.026,
    ambientColor: 0xc0a8ff,
    ambientIntensity: 0.92,
    keyColor: 0xffd070,
    keyIntensity: 1.95,
    propColors: [0x7c6440, 0x9a7f56, 0x5e4a30],
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
