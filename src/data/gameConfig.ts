import type { DifficultyId, EnemyDef, PlayerStats, ThemeDef } from '../types'

/**
 * ============================================================
 *  全局数值：改这里就能调整手感，不用翻代码
 *  NOTE: 战斗/经济为第一版占位数值，等战斗系统与经济系统
 *        需求确认后在这里统一调参。
 * ============================================================
 */
export const CONFIG = {
  player: {
    maxHp: 120,
    moveSpeed: 6.4,
    damage: 14,
    attackSpeed: 1,
    attackRadius: 2.7,
    critChance: 0.08,
    critMultiplier: 1.8,
    pickupRadius: 2.0,
    xpGain: 1,
    goldGain: 1,
    armor: 0,
    dashCooldown: 1.4,
    blades: 2,
    /** 冲刺速度与持续时间 */
    dashSpeed: 19,
    dashDuration: 0.16,
    /** 受击后无敌时间 */
    iFrames: 0.65,
    radius: 0.42,
  } as PlayerStats & { dashSpeed: number; dashDuration: number; iFrames: number; radius: number },

  blade: {
    /** 回旋刃基础角速度（弧度/秒） */
    spin: 1.55,
    /** 同一敌人被同一把刃命中的冷却 */
    hitCooldown: 0.42,
    /** 击退强度 */
    knockback: 2.2,
  },

  camera: {
    fov: 52,
    near: 0.1,
    far: 160,
    modes: {
      /** 割草视角：高机位，看得清全场 */
      combat: { distance: 13.5, height: 11.5, pitch: 40, lookAhead: 2.6 },
      /** 探索视角：低机位，沉浸感更强 */
      explore: { distance: 9.2, height: 4.6, pitch: 17, lookAhead: 3.2 },
    },
    follow: 7.5,
    minDistance: 7,
    maxDistance: 20,
  },

  economy: {
    /** 升级所需经验：level 从 1 开始 */
    xpBase: 9,
    xpGrowth: 1.27,
    xpLinear: 2,
    /** 一颗经验豆的基础经验 */
    xpPerBean: 2,
    coinValue: 1,
    goldPerBeanMin: 1,
    goldPerBeanMax: 3,
    /** 掉落概率 */
    coinDropChance: 0.38,
    xpDropChance: 1,
    /** 拾取吸附速度（米/秒^2 加速度） */
    magnetAccel: 26,
    magnetMaxSpeed: 24,
    /** 自动拾取的半径系数（pickupRadius * 该值内开始飞向玩家） */
    magnetFactor: 2.4,
    /** 升级后短暂清场用的经验豆全吸 */
    levelUpVacuum: true,
  },

  spawn: {
    /** 刷新点距离玩家最少距离，避免脸上刷怪 */
    minDistanceFromPlayer: 9,
    /** 每波间隔随时间缩短的系数 */
    intervalDecay: 0.985,
    minInterval: 0.42,
    /** 精英怪：每多少秒刷一只 */
    eliteEvery: 22,
    eliteHpMul: 4.2,
    eliteScale: 1.45,
    eliteXpMul: 5,
    /** 波次上限 */
    maxAliveHardCap: 140,
  },

  combat: {
    /** 敌人接触伤害的判定间隔 */
    contactCooldown: 0.72,
    /** 玩家受击击退 */
    playerKnockback: 3.5,
    /** 敌人互相推挤强度 */
    separation: 3.2,
  },

  boss: {
    hp: 2600,
    damage: 18,
    speed: 2.5,
    radius: 1.5,
    slamRadius: 4.6,
    slamWindup: 0.85,
    summonCount: 5,
    summonEvery: 9,
    chargeSpeed: 11,
    phase2At: 0.55,
  },
}

export function xpToNext(level: number): number {
  return Math.round(CONFIG.economy.xpBase * Math.pow(CONFIG.economy.xpGrowth, level - 1) + CONFIG.economy.xpLinear * (level - 1))
}

export const DIFFICULTY: Record<
  DifficultyId,
  { name: string; desc: string; hp: number; damage: number; speed: number; spawn: number; xp: number; gold: number }
> = {
  casual: {
    name: '休闲',
    desc: '怪物更脆，经验更足。适合先体验割草爽感。',
    hp: 0.78,
    damage: 0.7,
    speed: 0.94,
    spawn: 0.85,
    xp: 1.2,
    gold: 1.15,
  },
  normal: {
    name: '标准',
    desc: '推荐难度。张弛有度，需要一点走位。',
    hp: 1,
    damage: 1,
    speed: 1,
    spawn: 1,
    xp: 1,
    gold: 1,
  },
  nightmare: {
    name: '噩梦',
    desc: '怪物更硬更痛、刷新更凶。适合追求挑战的玩家。',
    hp: 1.5,
    damage: 1.4,
    speed: 1.08,
    spawn: 1.3,
    xp: 0.92,
    gold: 1.25,
  },
}

export const BASE_STATS: PlayerStats = {
  maxHp: CONFIG.player.maxHp,
  moveSpeed: CONFIG.player.moveSpeed,
  damage: CONFIG.player.damage,
  attackSpeed: CONFIG.player.attackSpeed,
  attackRadius: CONFIG.player.attackRadius,
  critChance: CONFIG.player.critChance,
  critMultiplier: CONFIG.player.critMultiplier,
  pickupRadius: CONFIG.player.pickupRadius,
  xpGain: CONFIG.player.xpGain,
  goldGain: CONFIG.player.goldGain,
  armor: CONFIG.player.armor,
  dashCooldown: CONFIG.player.dashCooldown,
  blades: CONFIG.player.blades,
}

/** 五层塔的视觉主题 */
export const THEMES: Record<string, ThemeDef> = {
  moss: {
    id: 'moss',
    name: '苔石前厅',
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
  candle: {
    id: 'candle',
    name: '烛影回廊',
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
  forge: {
    id: 'forge',
    name: '熔火铁砧',
    floorColor: 0x4a3f3c,
    floorAltColor: 0x3b312f,
    wallColor: 0x2e2624,
    wallTopColor: 0x6a4c3a,
    accentColor: 0xff7a3c,
    fogColor: 0x180a06,
    fogDensity: 0.034,
    ambientColor: 0x8a4a3a,
    ambientIntensity: 0.65,
    keyColor: 0xff8a4a,
    keyIntensity: 2.7,
    propColors: [0x54413a, 0x6d5044, 0x332a27],
    torchColor: 0xff6a1f,
  },
  frost: {
    id: 'frost',
    name: '霜蚀圣所',
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
  throne: {
    id: 'throne',
    name: '王座之巅',
    floorColor: 0x554052,
    floorAltColor: 0x453343,
    wallColor: 0x2f2130,
    wallTopColor: 0x7a4a6a,
    accentColor: 0xffcc55,
    fogColor: 0x140814,
    fogDensity: 0.032,
    ambientColor: 0x7a4a80,
    ambientIntensity: 0.8,
    keyColor: 0xffd27a,
    keyIntensity: 2.6,
    propColors: [0x4c3550, 0x6a4a66, 0x2a1e2b],
    torchColor: 0xff5c8a,
  },
}

export const GOBLIN_SMALL: EnemyDef = {
  id: 'goblin',
  name: '哥布林',
  hp: 30,
  speed: 2.65,
  damage: 6,
  radius: 0.42,
  xp: 1,
  goldChance: CONFIG.economy.coinDropChance,
  scale: 1,
  model: 'goblin',
}

export const GOBLIN_BRUTE: EnemyDef = {
  id: 'goblin-brute',
  name: '哥布林蛮兵',
  hp: 85,
  speed: 2.1,
  damage: 12,
  radius: 0.62,
  xp: 4,
  goldChance: 0.75,
  scale: 1.5,
  model: 'goblin-big',
}

export const GOBLIN_ELITE: EnemyDef = {
  id: 'goblin-elite',
  name: '哥布林勇士',
  hp: 30 * CONFIG.spawn.eliteHpMul,
  speed: 2.9,
  damage: 10,
  radius: 0.55,
  xp: 1 * CONFIG.spawn.eliteXpMul,
  goldChance: 1,
  scale: CONFIG.spawn.eliteScale,
  model: 'goblin',
}
