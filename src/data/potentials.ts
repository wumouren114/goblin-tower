/**
 * 潜能系统（原「专武分支」）数据表 —— 落地版 v0（只有数据，未接入战斗）。
 *
 * 口径：
 * - 每个角色 3 条分支，**选定即锁定**，别的分支的节点领不到；
 * - 每条分支 = 根被动（选中即得）+ 1 条代价（不可移除）+ 3 个可点节点；
 * - 节点**只有一级**，固定数值，不做升级（专武关出现频率低，升不动）；
 * - 分支之间用 `resonances` 建立反应：跨大层拿到第二条潜能后才可能触发。
 * - 通用项不绑分支，不限拿取数量。
 *
 * 术语：本文件里的「潜能」= 玩家可见的专武分支；代码内部 `weapons` 仍是旧的 7 级武器数据，
 * 等战斗接入时再一并替换。
 */
import type { CharacterId } from '../types'

/** 供跨枝反应 / 道具卡 / 后续技能联动使用的标签 */
export type PotentialTag =
  | 'bleed'
  | 'mark'
  | 'charge'
  | 'heavy'
  | 'lowHp'
  | 'lifesteal'
  | 'risk'
  | 'shield'
  | 'gather'
  | 'aoe'
  | 'combo'
  | 'crit'
  | 'summon'
  | 'rhythm'
  | 'gold'
  | 'burst'
  | 'execute'

export interface PotentialNode {
  id: string
  name: string
  /** 一级固定效果（描述级，数值即最终值） */
  effect: string
  tags: readonly PotentialTag[]
}

export interface PotentialBranch {
  id: string
  name: string
  /** 一句话玩法身份 */
  identity: string
  /** 根被动：选中该分支立刻获得 */
  root: string
  /** 分支代价：选中即生效，不可移除 */
  cost: string
  /** 3 个可点节点（一级，不升级） */
  nodes: readonly PotentialNode[]
}

export interface Resonance {
  id: string
  /** 需要同时拥有的两条分支 id */
  requires: readonly [string, string]
  name: string
  effect: string
}

export interface PotentialSet {
  character: CharacterId
  branches: readonly [PotentialBranch, PotentialBranch, PotentialBranch]
  /** 跨分支反应：只有第二大层起（拿到第二条潜能）才可能触发 */
  resonances: readonly Resonance[]
  /** 通用项：不绑分支，不限数量 */
  commons: readonly PotentialNode[]
}

/* ─────────────────────────── 丛雨 ─────────────────────────── */

const murasame: PotentialSet = {
  character: 'murasame',
  branches: [
    {
      id: 'murasame-liushang',
      name: '流殇',
      identity: '普攻流血 · 持续伤害',
      root: '普攻命中附加流血：每 0.5 秒 1 跳、持续 3 秒、每跳为本次普攻伤害的 8%',
      cost: '普攻伤害 −20%',
      nodes: [
        { id: 'murasame-liushang-rate', name: '血流', effect: '流血跳频 0.5s → 0.4s', tags: ['bleed'] },
        { id: 'murasame-liushang-power', name: '深创', effect: '每跳 8% → 10%', tags: ['bleed'] },
        { id: 'murasame-liushang-long', name: '不止', effect: '流血持续 3 秒 → 4 秒', tags: ['bleed'] },
      ],
    },
    {
      id: 'murasame-shunshan',
      name: '瞬闪',
      identity: '技能流 · 高频突进',
      root: '技能所需充能 −20%（80 → 64）',
      cost: '普攻伤害 −15%（击杀变慢 → 充能变慢）',
      nodes: [
        { id: 'murasame-shunshan-power', name: '一闪', effect: '技能伤害 +20%', tags: ['charge', 'burst'] },
        { id: 'murasame-shunshan-heal', name: '回气', effect: '突进回血 28 → 44', tags: ['charge', 'lifesteal'] },
        { id: 'murasame-shunshan-kill', name: '断流', effect: '技能击杀返还 20 充能', tags: ['charge'] },
      ],
    },
    {
      id: 'murasame-jianyi',
      name: '剑意',
      identity: '标记 + 居合结算 · 混合流',
      root: '普攻命中附加 1 层标记；技能命中时结算，额外造成每层 50% 技能伤害（独立伤害）',
      cost: '技能伤害 −20%（标记结算不吃这个衰减）',
      nodes: [
        { id: 'murasame-jianyi-amp', name: '含锋', effect: '带标记目标受到的伤害 +10%', tags: ['mark'] },
        { id: 'murasame-jianyi-boom', name: '裂帛', effect: '结算时对 3m 内造成 60% 结算伤害', tags: ['mark', 'aoe'] },
        { id: 'murasame-jianyi-regen', name: '蓄势', effect: '每秒自动回复 2 点充能', tags: ['charge'] },
      ],
    },
  ],
  resonances: [
    {
      id: 'murasame-res-bleed-mark',
      requires: ['murasame-liushang', 'murasame-jianyi'],
      name: '血偿刀痕',
      effect: '带标记目标受到的流血伤害 +40%',
    },
    {
      id: 'murasame-res-bleed-charge',
      requires: ['murasame-shunshan', 'murasame-liushang'],
      name: '踏血',
      effect: '技能命中带流血的目标时，返还 25% 充能',
    },
    {
      id: 'murasame-res-mark-charge',
      requires: ['murasame-jianyi', 'murasame-shunshan'],
      name: '刃响',
      effect: '结算爆炸伤害按当前充能比例提高，最多 +30%',
    },
  ],
  commons: [
    { id: 'murasame-common-leech', name: '普攻吸血', effect: '普攻伤害的 4% 转为生命', tags: ['lifesteal'] },
    { id: 'murasame-common-thorns', name: '近战反伤', effect: '受击时对 3m 内造成攻击力 80% 的伤害', tags: ['aoe'] },
    { id: 'murasame-common-guard', name: 'F 格挡', effect: '可格挡远程攻击；命中瞬间格挡 → 瞬移到攻击者身后', tags: ['shield'] },
    { id: 'murasame-common-execute', name: 'E 处决', effect: '可处决血量 <12% 的敌人（血条标注斩杀线）', tags: ['execute'] },
    { id: 'murasame-common-threshold', name: '斩杀线', effect: '对 <30% 血量的敌人伤害 +25%', tags: ['execute', 'burst'] },
    { id: 'murasame-common-chain', name: '连斩', effect: '3 秒内连续击杀，每次 +8% 攻速，最多 3 层', tags: ['combo'] },
  ],
}

/* ─────────────────────────── 大肥鱼 ─────────────────────────── */

const fish: PotentialSet = {
  character: 'fish',
  branches: [
    {
      id: 'fish-clone',
      name: '哦，鲸鲸？',
      identity: '召唤本体分身 · 站场 + 经济',
      root: '技能改为召唤 1 只小肥鱼（本体分身，1.0 倍面板）；小肥鱼释放技能时召唤 3 只小鲸子（0.4 倍伤害，攻速不变）',
      cost: '大肥鱼初始伤害降低',
      nodes: [
        { id: 'fish-clone-energy', name: '共鸣回路', effect: '小肥鱼击杀攒满 30 能量，可放一次无强化技能（只召小鲸子，不再套娃）', tags: ['summon', 'charge'] },
        { id: 'fish-clone-gold', name: '帮手', effect: '小肥鱼可协助拾取金币，金币获取 +15%', tags: ['gold', 'summon'] },
        { id: 'fish-clone-long', name: '同频', effect: '小肥鱼存在时间 +5 秒', tags: ['summon'] },
      ],
    },
    {
      id: 'fish-swarm',
      name: '更多子代理！',
      identity: '数量压制 · 群体',
      root: '小鲸子数量 3 → 5',
      cost: '技能所需充能 90 → 110',
      nodes: [
        { id: 'fish-swarm-tank', name: '前排', effect: '小鲸子可抵挡伤害，拥有本体 50% 生命', tags: ['summon', 'shield'] },
        { id: 'fish-swarm-long', name: '续航', effect: '召唤持续时间 +4 秒', tags: ['summon'] },
        { id: 'fish-swarm-orbit', name: '环绕', effect: '技能期间额外召 3 只环绕鲸子（仅碰撞伤害、无弹幕、特效弱）', tags: ['summon', 'aoe'] },
      ],
    },
    {
      id: 'fish-bubble',
      name: '超级泡泡',
      identity: '爆炸 + 收割',
      root: '泡泡更大，命中爆炸',
      cost: '攻速降低',
      nodes: [
        { id: 'fish-bubble-share', name: '同步', effect: '小鲸子也能释放超级泡泡', tags: ['summon', 'aoe'] },
        {
          id: 'fish-bubble-execute',
          name: '包裹',
          effect: '攻击有概率放出比怪物更大的泡泡，包裹抬起敌人 1.5 秒：血量 <25% 直接斩杀，否则只造成伤害（Boss/精英不斩杀）',
          tags: ['execute', 'aoe'],
        },
        { id: 'fish-bubble-giant', name: '巨化', effect: '体型变大，生命与伤害提升，移速降低', tags: ['summon'] },
      ],
    },
  ],
  resonances: [
    {
      id: 'fish-res-clone-swarm',
      requires: ['fish-clone', 'fish-swarm'],
      name: '编队',
      effect: '小肥鱼召唤的小鲸子数量 +2，且继承小肥鱼的 60% 面板',
    },
    {
      id: 'fish-res-clone-bubble',
      requires: ['fish-clone', 'fish-bubble'],
      name: '双生泡',
      effect: '小肥鱼普攻也附带爆炸，但范围减半',
    },
    {
      id: 'fish-res-swarm-bubble',
      requires: ['fish-swarm', 'fish-bubble'],
      name: '泡海',
      effect: '场上每有一只小鲸子，大泡泡出现概率 +4%（上限 +20%）',
    },
  ],
  commons: [
    { id: 'fish-common-rice', name: '白米饭', effect: '复用现有系统（8 层 / 每层 +7% 全属性）；拾取时附加短暂提速与回血', tags: ['gold'] },
    { id: 'fish-common-recall', name: 'E 回收', effect: '回收场上召唤物，获得 15 金，cd 20 秒（仅战斗关可用）', tags: ['gold', 'summon'] },
    { id: 'fish-common-hose', name: 'F 水枪', effect: '切换为持续水柱扫射 10 秒（不再是单发泡泡，DPS 提升），cd 30 秒', tags: ['burst'] },
  ],
}

/* ─────────────────────────── 若叶睦 ─────────────────────────── */

const mutsumi: PotentialSet = {
  character: 'mutsumi',
  branches: [
    {
      id: 'mutsumi-rhythm',
      name: '节奏',
      identity: '音游式普攻 · 踩拍强化',
      root: '普攻改为按音乐节拍判定：perfect ×1.25 / good ×1.10 / miss ×0.85；134 BPM 八分音符网格（223.9ms），窗口 ±35 / ±60ms',
      cost: '攻速被拍点锁定（无法超过网格速度）',
      nodes: [
        {
          id: 'mutsumi-rhythm-combo',
          name: '连击',
          effect: '20 连击伤害 +10%，40 连击 +20%，60 连击普攻附带 3m 爆炸（60% 伤害）',
          tags: ['combo', 'rhythm', 'aoe'],
        },
        { id: 'mutsumi-rhythm-mercy', name: '宽容', effect: '连击达到 20 后，第一次失误只掉到 20，不清零', tags: ['combo', 'rhythm'] },
        { id: 'mutsumi-rhythm-note', name: '音符追击', effect: '踩准的攻击附加一次音符追击（每秒最多 1 次，可叠加连击）', tags: ['combo', 'rhythm'] },
      ],
    },
    {
      id: 'mutsumi-symphony',
      name: '交响',
      identity: '双发弹幕 · 覆盖面',
      root: '普攻改为双发弹幕（第二发伤害为第一发的 60%）',
      cost: '技能音波场伤害降低',
      nodes: [
        { id: 'mutsumi-symphony-echo', name: '回声', effect: '第二发命中时追加第一发 20% 的伤害', tags: ['aoe'] },
        { id: 'mutsumi-symphony-bounce', name: '折射', effect: '弹幕碰到非敌人障碍可折返一次', tags: ['aoe'] },
        { id: 'mutsumi-symphony-pulse', name: '共振', effect: '技能音波频率提高 25%', tags: ['charge', 'aoe'] },
      ],
    },
    {
      id: 'mutsumi-duet',
      name: '双重人格',
      identity: '变身强化 · 爆发',
      root: '技能所需充能降低 20%，变身期间伤害提高 15%',
      cost: '变身期间普攻伤害降低',
      nodes: [
        { id: 'mutsumi-duet-stun', name: '压场', effect: '变身瞬间晕眩周围小怪 1 秒（Boss 除外）', tags: ['aoe', 'shield'] },
        { id: 'mutsumi-duet-range', name: '扩张', effect: '音波半径 +15%，变身期间普攻弹幕增大 30%', tags: ['aoe'] },
        { id: 'mutsumi-duet-core', name: '同化', effect: '变身期间每击杀 1 个敌人延长 0.2 秒（每次变身最多 +3 秒）', tags: ['charge', 'combo'] },
      ],
    },
  ],
  resonances: [
    {
      id: 'mutsumi-res-rhythm-symphony',
      requires: ['mutsumi-rhythm', 'mutsumi-symphony'],
      name: '二重奏',
      effect: '踩准的攻击，第二发弹幕必定命中同一目标并造成 100% 伤害',
    },
    {
      id: 'mutsumi-res-rhythm-duet',
      requires: ['mutsumi-rhythm', 'mutsumi-duet'],
      name: '节拍器',
      effect: '变身期间连击不掉落，且每 10 连击回复 5 点充能',
    },
    {
      id: 'mutsumi-res-symphony-duet',
      requires: ['mutsumi-symphony', 'mutsumi-duet'],
      name: '合奏',
      effect: '变身期间双发弹幕变为三发',
    },
  ],
  commons: [
    { id: 'mutsumi-common-leech', name: '攻击吸血', effect: '普攻伤害的 4% 转为生命', tags: ['lifesteal'] },
    { id: 'mutsumi-common-bounce', name: '攻击弹射', effect: '普攻弹射 1 次（60% 伤害）', tags: ['aoe'] },
    {
      id: 'mutsumi-common-step',
      name: 'F 踏拍',
      effect: '可闪避；0.5 秒内按节拍普攻可接上连击（cd 5 秒）',
      tags: ['rhythm', 'combo'],
    },
    { id: 'mutsumi-common-push', name: 'E 推开', effect: '推开周围一定范围内的敌人（cd 10 秒）', tags: ['aoe', 'shield'] },
  ],
}

export const POTENTIALS: Record<CharacterId, PotentialSet> = {
  murasame,
  fish,
  mutsumi,
}

/** 取某个角色的分支定义；找不到返回 undefined */
export function branchOf(character: CharacterId, branchId: string): PotentialBranch | undefined {
  return POTENTIALS[character].branches.find((b) => b.id === branchId)
}

/** 该角色所有可点的节点（分支节点 + 通用项），专武关三选一从这里取 */
export function nodePoolOf(character: CharacterId): PotentialNode[] {
  const set = POTENTIALS[character]
  return [...set.branches.flatMap((b) => b.nodes), ...set.commons]
}
