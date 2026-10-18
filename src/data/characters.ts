/**
 * 角色数值表（数值策划稿 · v0.1）
 *
 * 只放数据与换算公式，不含任何渲染/战斗代码，方便后续接入角色系统时直接引用。
 * 设计口径见 docs/02-角色数值设计.md
 *
 * 三条换算公式（全角色统一）：
 *   攻击间隔(秒) = 0.55 * 100 / 耐力      → 攻速(次/秒) = 耐力 / 55
 *   单次伤害     = 武器基础伤害 * 魔力 / 100
 *   范围/半径    = 武器基础范围 * 智力 / 100
 * 五维在 100 时即为「标准值」，面板数字本身就是百分比刻度，方便玩家理解。
 */

export type CharacterId = 'mutsumi' | 'murasame' | 'fish'

export interface CharacterDef {
  id: CharacterId
  name: string
  title: string
  /** 玩法定位，一句话 */
  role: string
  /** 击杀充能效率（大招越强，充能越慢） */
  chargeGainMul: number
  /** 五维基础值（Lv1） */
  base: {
    hp: number
    /** 技能所需充能值（满值才能放技能） */
    chargeMax: number
    /** 耐力 → 攻速 */
    stamina: number
    /** 魔力 → 伤害 */
    magic: number
    /** 智力 → 范围 */
    intelligence: number
    moveSpeed: number
  }
  /** 普通攻击（鼠标左键） */
  attack: {
    name: string
    /** 武器基础伤害（魔力 100 时的伤害） */
    baseDamage: number
    /** 武器基础范围（智力 100 时的射程/半径，单位米） */
    baseRange: number
    /** single: 单体弹道；cone: 扇形近战；aura: 环绕音波 */
    shape: 'single' | 'cone' | 'aura'
    /** 扇形角度（shape=cone 时生效） */
    angle?: number
    /** 弹道飞行速度 m/s（shape=single 时生效） */
    projectileSpeed?: number
    /** 命中间隔下限，防止后期攻速溢出 */
    minInterval: number
  }
  /** 技能（鼠标右键，需要充能） */
  skill: {
    name: string
    /** 释放所需充能（= base.chargeMax） */
    chargeCost: number
    kind: 'transform' | 'dash' | 'summon'
    /** 若为变身：持续时间；若为召唤：召唤物持续时间 */
    duration?: number
    /** 数值细项，字段随 kind 不同 */
    params: Record<string, number>
    desc: string
  }
}

/** 击杀充能表：充能只能靠击杀获得 */
export const CHARGE_PER_KILL = {
  small: 8,
  brute: 12,
  elite: 28,
  boss: 70,
} as const

/** 每层开局赠送当前角色充能上限的 50% */
export const CHARGE_FLOOR_START_RATIO = 0.6

/** 金币掉落表 */
export const GOLD_PER_KILL = {
  small: 1,
  brute: 3,
  elite: 12,
  boss: 60,
} as const

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  mutsumi: {
    id: 'mutsumi',
    name: '若叶睦',
    title: '双形态 · 远近切换',
    role: '远程单体起手，按右键变身 Mortis 打范围音波爆发',
    chargeGainMul: 0.55,
    base: { hp: 110, chargeMax: 100, stamina: 135, magic: 100, intelligence: 100, moveSpeed: 6.2 },
    attack: {
      name: '小黄瓜',
      baseDamage: 14,
      baseRange: 5.5,
      shape: 'single',
      projectileSpeed: 18,
      minInterval: 0.24,
    },
    skill: {
      name: 'Mortis',
      chargeCost: 100,
      kind: 'transform',
      duration: 8,
      params: {
        staminaMul: 1.6,
        magicMul: 1.7,
        intelligenceMul: 0.6,
        moveSpeedMul: 0.9,
        damageReduction: 0.15,
        burstDamage: 40,
        burstKnockback: 3,
        pulseInterval: 0.5,
        pulseBaseDamage: 11,
        pulseBaseRadius: 5.6,
        slow: 0.3,
        slowDuration: 0.15,
      },
      desc: '变身 Mortis：8 秒内以自身为中心弹奏音波，攻速与伤害大幅提升、范围收缩，变身瞬间对周围造成爆发伤害与击退。',
    },
  },

  murasame: {
    id: 'murasame',
    name: '丛雨',
    title: '近战 · 突进',
    role: '贴脸扇形拔刀清群，右键远距离突进聚怪并回血',
    chargeGainMul: 1,
    base: { hp: 205, chargeMax: 80, stamina: 145, magic: 95, intelligence: 70, moveSpeed: 7.5 },
    attack: {
      name: '拔刀斩',
      baseDamage: 19,
      baseRange: 3.4,
      shape: 'cone',
      angle: 130,
      minInterval: 0.22,
    },
    skill: {
      name: '居合突进',
      chargeCost: 80,
      kind: 'dash',
      params: {
        distance: 7.5,
        dashDuration: 0.24,
        pathWidth: 2.4,
        damage: 45,
        gatherRadius: 2.8,
        heal: 28,
        invulnerable: 0.4,
        recovery: 0.12,
      },
      desc: '向朝向方向突进，路径上的敌人受到伤害并被拉到突进终点聚集，同时恢复一定生命。突进期间无敌。',
    },
  },

  fish: {
    id: 'fish',
    name: '蓝色大肥鱼',
    title: '远程 · 召唤',
    role: '高频泡泡风筝，右键召唤 3 只小肥鱼一起打',
    chargeGainMul: 1.25,
    base: { hp: 110, chargeMax: 90, stamina: 180, magic: 80, intelligence: 110, moveSpeed: 6.6 },
    attack: {
      name: '泡泡水枪',
      baseDamage: 10,
      baseRange: 7.5,
      shape: 'single',
      projectileSpeed: 17,
      minInterval: 0.2,
    },
    skill: {
      name: '召唤小肥鱼',
      chargeCost: 90,
      kind: 'summon',
      duration: 10,
      params: {
        count: 3,
        minionHpRatio: 0.55,
        minionDamageRatio: 0.6,
        minionInterval: 0.45,
        burstDamage: 26,
        burstRadius: 4.2,
        minionRange: 7,
        minionSpeed: 5.2,
      },
      desc: '召唤 3 只小肥鱼跟随作战 12 秒：继承 35% 生命，自动索敌发射 40% 伤害的泡泡。重复释放刷新持续时间，最多 3 只。',
    },
  },
}

// ─────────────────────────── 换算公式（唯一实现口径）───────────────────────────

/** 攻速（次/秒） */
export function attacksPerSecond(stamina: number): number {
  return stamina / 55
}

/** 攻击间隔（秒），受角色下限钳制 */
export function attackInterval(stamina: number, minInterval = 0.18): number {
  return Math.max(minInterval, 0.55 * 100 / Math.max(1, stamina))
}

/** 单次伤害（未计暴击） */
export function hitDamage(baseDamage: number, magic: number): number {
  return baseDamage * Math.max(0.1, magic / 100)
}

/** 射程或半径（米） */
export function skillRange(baseRange: number, intelligence: number): number {
  return baseRange * Math.max(0.2, intelligence / 100)
}

/** 单目标每秒伤害（未计暴击、未计技能） */
export function singleTargetDps(baseDamage: number, magic: number, stamina: number): number {
  return hitDamage(baseDamage, magic) / attackInterval(stamina)
}

// ─────────────────────────── 升级卡池（每级三选一）───────────────────────────

export type StatCardId =
  | 'magic'
  | 'stamina'
  | 'intelligence'
  | 'hp'
  | 'armor'
  | 'charge'
  | 'speed'
  | 'dash'

export interface StatCard {
  id: StatCardId
  name: string
  desc: string
  /** 每级抽取权重（合计 100） */
  weight: number
  /** 可叠加上限 */
  maxStacks: number
  apply: (v: { magic: number; stamina: number; intelligence: number; hp: number; armor: number; chargeGain: number; moveSpeed: number; dashCooldown: number }) => void
}

export const STAT_CARDS: StatCard[] = [
  {
    id: 'magic',
    name: '魔力强化',
    desc: '魔力 +16（伤害 +16% 基准）',
    weight: 22,
    maxStacks: 12,
    apply: (v) => {
      v.magic += 16
    },
  },
  {
    id: 'stamina',
    name: '耐力强化',
    desc: '耐力 +14（攻速 +14%）',
    weight: 20,
    maxStacks: 12,
    apply: (v) => {
      v.stamina += 14
    },
  },
  {
    id: 'intelligence',
    name: '智力强化',
    desc: '智力 +10（范围 +10%）',
    weight: 14,
    maxStacks: 10,
    apply: (v) => {
      v.intelligence += 10
    },
  },
  {
    id: 'hp',
    name: '生命强化',
    desc: '生命上限 +22 并立即回复',
    weight: 16,
    maxStacks: 12,
    apply: (v) => {
      v.hp += 22
    },
  },
  {
    id: 'armor',
    name: '护甲强化',
    desc: '受到伤害 -3.5%（上限 60%）',
    weight: 10,
    maxStacks: 6,
    apply: (v) => {
      v.armor += 0.035
    },
  },
  {
    id: 'charge',
    name: '蓄能回路',
    desc: '充能获取 +8%',
    weight: 8,
    maxStacks: 6,
    apply: (v) => {
      v.chargeGain += 0.08
    },
  },
  {
    id: 'speed',
    name: '轻身',
    desc: '移动速度 +0.25',
    weight: 6,
    maxStacks: 6,
    apply: (v) => {
      v.moveSpeed += 0.25
    },
  },
  {
    id: 'dash',
    name: '疾闪',
    desc: '冲刺冷却 -0.12 秒',
    weight: 4,
    maxStacks: 4,
    apply: (v) => {
      v.dashCooldown -= 0.12
    },
  },
]

/** 按层数给出的推荐等级（用于平衡验算，不是硬性规则） */
export const LEVEL_BY_FLOOR = [4, 8, 12, 16, 20] as const
