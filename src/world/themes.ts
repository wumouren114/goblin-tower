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
 *  - 同一场景区的 3 个变体靠「天气 / 时段 / 光色 / 地砖拼法 / 空气粒子」区分，
 *    几何边界与碰撞完全一致。
 * ============================================================ */
export type FloorTilePattern = 'flagstone' | 'crazy' | 'inlay'
export type WallDebrisKind = 'moss' | 'stardust' | 'rubble'
export type LightPatchKind = 'window' | 'canopy' | 'crystal' | 'arch'
export type AirParticleKind = 'garden' | 'observatory' | 'clocktower'

export interface SceneDetailProfile {
  /** 地砖拼法：大方砖 / 碎拼 / 镶边 */
  tilePattern: FloorTilePattern
  /** 3D 镶边地砖色（与主地砖拉开层次） */
  inlayColor: number
  /** 墙裙颜色（墙脚 0.55~0.65m 独立材质） */
  dadoColor: number
  /** 墙裙顶压边颜色 */
  dadoTrimColor: number
  /** 沿墙边缘堆积类型（高度 0.1~0.2m） */
  debrisKind: WallDebrisKind
  /** 堆积多色变化 */
  debrisColors: readonly [number, number, number]
  /** 地面光斑类型（窗光 / 树影 / 晶光 / 拱窗） */
  lightPatchKind: LightPatchKind
  /** 地面光斑颜色与不透明度 */
  lightPatchColor: number
  lightPatchOpacity: number
  /** 光斑投射偏转角（弧度，体现不同时段太阳/星光角度） */
  lightPatchAngle: number
  /** 空气粒子场景类（花瓣+浮尘 / 星尘+流星屑 / 火星+铜屑） */
  airKind: AirParticleKind
  /** 粒子总数（硬预算 <= 60） */
  airCount: number
  /** 主/副两种空气粒子色 */
  airColors: readonly [number, number]
  /** 空气粒子速度矢量与摆动幅度（体现天气差异：微风/大风/落花/流星/热流） */
  airDrift: { vx: number; vy: number; vz: number; sway: number }
  /** 主光方位角偏置（弧度，体现时段差异） */
  keyAngleOffset: number
  /** 中央地标转速（rad/s） */
  landmarkSpinSpeed: number
  /** 地标背后逆光描边色 */
  backlightColor: number
}

export type ThemeV3 = Omit<ThemeDef, 'id'> & {
  /** 与 SceneDef.themeId 对应 */
  id: string
  /** 视觉家族：决定地面/墙面细节与道具原型 */
  family: ThemeId
  /** 所属阶段 1..3（= 第几个大层） */
  stage: number
  /** P5 六层场景细节与变体差异配置 */
  detail: SceneDetailProfile
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
    detail: {
      tilePattern: 'flagstone',
      inlayColor: 0xdfe8dc,
      dadoColor: 0x7b9888,
      dadoTrimColor: 0xe6f2e8,
      debrisKind: 'moss',
      debrisColors: [0x6f9e6b, 0x8cbc7e, 0xffb3c6],
      lightPatchKind: 'window',
      lightPatchColor: 0xfff6d8,
      lightPatchOpacity: 0.192,
      lightPatchAngle: 0.38,
      airKind: 'garden',
      airCount: 44,
      airColors: [0xffb4c8, 0xfff3c8],
      airDrift: { vx: 0.45, vy: -0.22, vz: 0.25, sway: 0.85 },
      keyAngleOffset: -0.35,
      landmarkSpinSpeed: 0.52,
      backlightColor: 0xfff2c6,
    },
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
    detail: {
      tilePattern: 'crazy',
      inlayColor: 0xede5ce,
      dadoColor: 0x92886f,
      dadoTrimColor: 0xf6ebd2,
      debrisKind: 'moss',
      debrisColors: [0x8fae6e, 0xc8c488, 0xffd278],
      lightPatchKind: 'canopy',
      lightPatchColor: 0xffe9a6,
      lightPatchOpacity: 0.208,
      lightPatchAngle: 0.05,
      airKind: 'garden',
      airCount: 54,
      airColors: [0xffe08a, 0xffffff],
      airDrift: { vx: 2.2, vy: -0.08, vz: 0.75, sway: 1.35 },
      keyAngleOffset: 0.15,
      landmarkSpinSpeed: 1.25,
      backlightColor: 0xffdf8c,
    },
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
    detail: {
      tilePattern: 'inlay',
      inlayColor: 0xf3dfe8,
      dadoColor: 0x997d8c,
      dadoTrimColor: 0xf7e4ee,
      debrisKind: 'moss',
      debrisColors: [0xf4a8c0, 0xffc4d6, 0x8aa884],
      lightPatchKind: 'arch',
      lightPatchColor: 0xffd9eb,
      lightPatchOpacity: 0.2,
      lightPatchAngle: -0.45,
      airKind: 'garden',
      airCount: 56,
      airColors: [0xff96b8, 0xffdbe8],
      airDrift: { vx: -0.65, vy: -0.78, vz: 0.35, sway: 1.1 },
      keyAngleOffset: 0.62,
      landmarkSpinSpeed: 0.36,
      backlightColor: 0xffb8d4,
    },
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
    detail: {
      tilePattern: 'flagstone',
      inlayColor: 0x7b86bc,
      dadoColor: 0x2b3256,
      dadoTrimColor: 0xd4b678,
      debrisKind: 'stardust',
      debrisColors: [0x6070aa, 0x8898d4, 0xffd888],
      lightPatchKind: 'crystal',
      lightPatchColor: 0xffe296,
      lightPatchOpacity: 0.208,
      lightPatchAngle: 0.25,
      airKind: 'observatory',
      airCount: 44,
      airColors: [0xffe08a, 0xb8d4ff],
      airDrift: { vx: 0.2, vy: 0.38, vz: -0.15, sway: 0.7 },
      keyAngleOffset: -0.5,
      landmarkSpinSpeed: 0.45,
      backlightColor: 0xffdc84,
    },
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
    detail: {
      tilePattern: 'crazy',
      inlayColor: 0x7d88ba,
      dadoColor: 0x2f3154,
      dadoTrimColor: 0x9ce8ff,
      debrisKind: 'stardust',
      debrisColors: [0x76b8d8, 0xa8f0ff, 0x626c9e],
      lightPatchKind: 'window',
      lightPatchColor: 0x9ff2ff,
      lightPatchOpacity: 0.224,
      lightPatchAngle: 0.72,
      airKind: 'observatory',
      airCount: 52,
      airColors: [0xa8f4ff, 0xe8ffff],
      airDrift: { vx: 1.6, vy: 0.12, vz: 1.1, sway: 0.6 },
      keyAngleOffset: 0.28,
      landmarkSpinSpeed: 0.68,
      backlightColor: 0x9ef2ff,
    },
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
    detail: {
      tilePattern: 'inlay',
      inlayColor: 0x8284bc,
      dadoColor: 0x2e2e56,
      dadoTrimColor: 0xffb8d8,
      debrisKind: 'stardust',
      debrisColors: [0x8874b8, 0xffb4d4, 0xd8c8ff],
      lightPatchKind: 'crystal',
      lightPatchColor: 0xffb8dc,
      lightPatchOpacity: 0.216,
      lightPatchAngle: -0.62,
      airKind: 'observatory',
      airCount: 56,
      airColors: [0xffb8dc, 0xffffff],
      airDrift: { vx: -2.4, vy: -1.65, vz: 0.9, sway: 0.25 },
      keyAngleOffset: 0.85,
      landmarkSpinSpeed: 0.92,
      backlightColor: 0xffb4dc,
    },
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
    detail: {
      tilePattern: 'flagstone',
      inlayColor: 0xdcc08c,
      dadoColor: 0x6e5434,
      dadoTrimColor: 0x64ccb0,
      debrisKind: 'rubble',
      debrisColors: [0x6e5436, 0x5aa692, 0x9c7c4e],
      lightPatchKind: 'arch',
      lightPatchColor: 0xfff2c6,
      lightPatchOpacity: 0.192,
      lightPatchAngle: 0.3,
      airKind: 'clocktower',
      airCount: 44,
      airColors: [0xffc864, 0x72e8c8],
      airDrift: { vx: 0.35, vy: 0.45, vz: 0.2, sway: 0.65 },
      keyAngleOffset: -0.25,
      landmarkSpinSpeed: 0.48,
      backlightColor: 0x8ef2d8,
    },
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
    detail: {
      tilePattern: 'crazy',
      inlayColor: 0xd4b68c,
      dadoColor: 0x634d34,
      dadoTrimColor: 0xffa64d,
      debrisKind: 'rubble',
      debrisColors: [0x624a32, 0x8c6844, 0xd87a34],
      lightPatchKind: 'window',
      lightPatchColor: 0xffb25c,
      lightPatchOpacity: 0.216,
      lightPatchAngle: -0.22,
      airKind: 'clocktower',
      airCount: 56,
      airColors: [0xff9638, 0xffe078],
      airDrift: { vx: 0.55, vy: 1.45, vz: -0.35, sway: 0.9 },
      keyAngleOffset: 0.42,
      landmarkSpinSpeed: 0.72,
      backlightColor: 0xffb85c,
    },
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
    detail: {
      tilePattern: 'inlay',
      inlayColor: 0xd6b87c,
      dadoColor: 0x4f3f38,
      dadoTrimColor: 0xffcf5c,
      debrisKind: 'rubble',
      debrisColors: [0x58463c, 0x7c6448, 0xd4a84c],
      lightPatchKind: 'crystal',
      lightPatchColor: 0xffd86e,
      lightPatchOpacity: 0.224,
      lightPatchAngle: 0.0,
      airKind: 'clocktower',
      airCount: 52,
      airColors: [0xffd464, 0xd4b8ff],
      airDrift: { vx: -0.3, vy: 0.72, vz: 0.3, sway: 1.0 },
      keyAngleOffset: 0.95,
      landmarkSpinSpeed: 0.38,
      backlightColor: 0xffd468,
    },
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
