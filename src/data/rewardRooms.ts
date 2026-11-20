/**
 * 奖励关（宝箱密室 / 技能圣所）NPC 对话与三选一多样奖励数据与结算逻辑。
 *
 * 数值口径严格对齐 src/data/balance.ts（clearGoldFor）与 economy-smoke.mjs：
 * - 稳妥换金：本层通关金的 90%（不超出单层常规收益）；
 * - 赌一把·高结果：道具卡升一档（蓝→紫、紫→金；若已为金卡则保留金卡并附赠 50% 通关金）；
 * - 赌一把·低结果：本层通关金的 45%（少于稳妥换金，但不会空手而归）。
 */
import type { DifficultyId, InventoryItem } from '../types'
import { clearGoldFor } from './balance'
import { makeCardItem } from '../systems/economy'
import type { EventDef } from './events'
import { roomNpcDialogue, roomNpcInfo } from '../entities/roomNpc'

export type RewardRoomKind = 'chest' | 'skill-card'
export type RewardOptionId = 'take-card' | 'take-gold' | 'gamble'

export interface RewardGoldTable {
  safeGold: number
  consolationGold: number
  maxTierBonusGold: number
}

/** 按当前难度与层数计算奖励关金币口径（不凭空放大，锚定 clearGoldFor） */
export function rewardGoldFor(difficulty: DifficultyId, layer: number): RewardGoldTable {
  const base = Math.max(20, clearGoldFor(difficulty, layer))
  return {
    safeGold: Math.max(15, Math.round(base * 0.9)),
    consolationGold: Math.max(10, Math.round(base * 0.45)),
    maxTierBonusGold: Math.max(10, Math.round(base * 0.5)),
  }
}

export interface RewardResolution {
  outcomeId: string
  card?: InventoryItem
  gold?: number
  upgraded?: boolean
  text: string
}

/** 构造复用于 EventPanel 的奖励关事件定义（含 2~3 句 NPC 对话 + 3 个清晰选项） */
export function buildRewardRoomEvent(
  kind: RewardRoomKind,
  card: InventoryItem,
  difficulty: DifficultyId,
  layer: number,
): EventDef {
  const npcInfo = roomNpcInfo(kind)
  const lines = roomNpcDialogue(kind)
  const { safeGold, consolationGold, maxTierBonusGold } = rewardGoldFor(difficulty, layer)
  const tier = card.tier ?? 1
  const canUpgrade = tier < 3
  const nextTierLabel = tier === 1 ? '紫卡' : '金卡'

  return {
    id: `reward-room-${kind}`,
    title: kind === 'chest' ? '宝藏密室 · 守卫的交易' : '技能圣所 · 石灵的试问',
    kind: 'choice',
    scene:
      kind === 'chest'
        ? '密室中央的铜箱微微敞开，守卫按着箱盖，等待你决定如何带走这份遗物。'
        : '刻满符文的石碑发出低鸣，石灵浮现在石座前，向你摊开三道刻印。',
    npc: {
      name: npcInfo.title,
      identity: kind === 'chest' ? '密室看守者' : '圣所刻文石灵',
      voice: kind === 'chest' ? '沉稳、克制，只认等价交换' : '古老、回响，偏爱果断的选择',
    },
    intro: lines.join('\n'),
    clues: [],
    options: [
      {
        id: 'take-card',
        label: `直接领取：${card.icon} ${card.name}`,
        hint: '无代价 · 稳妥带走本层密室准备好的道具卡',
        outcomes: [
          {
            id: 'take-card-ok',
            text: `你收下了「${card.name}」。${npcInfo.title}轻轻点头，密室深处的裂隙随之亮起。`,
            effects: [],
          },
        ],
      },
      {
        id: 'take-gold',
        label: `换成金币：+${safeGold} 金币`,
        hint: '代价：放弃道具卡 · 稳妥换取按本层口径折算的一笔金币',
        outcomes: [
          {
            id: 'take-gold-ok',
            text: `${npcInfo.title}将卡片收回匣中，清点出 ${safeGold} 枚金币推到你手边。`,
            effects: [],
          },
        ],
      },
      {
        id: 'gamble',
        label: canUpgrade
          ? `赌一把：重铸升档（成功得${nextTierLabel} / 失手仅得 ${consolationGold} 金币）`
          : `赌一把：金印加码（成功金卡+${maxTierBonusGold} 金币 / 失手仅得 ${consolationGold} 金币）`,
        hint: '代价：放弃保底卡片 · 胜负各半，可能更好也可能更少',
        outcomes: [
          {
            id: 'gamble-high',
            text: canUpgrade
              ? `符光暴涨！${npcInfo.title}的封印竟为你淬炼出更高一档的${nextTierLabel}。`
              : `金印共鸣！你不仅保住了「${card.name}」，还额外震落了 ${maxTierBonusGold} 枚金币。`,
            effects: [],
          },
          {
            id: 'gamble-low',
            text: `重铸在最后关头散了形，只余下 ${consolationGold} 枚碎金。${npcInfo.title}叹了口气，替你打开了去路。`,
            effects: [],
          },
        ],
      },
    ],
  }
}

/** 根据玩家选择的奖励分支结算真实奖励（供 game.ts 与单测共用） */
export function resolveRewardChoice(
  optionId: RewardOptionId,
  card: InventoryItem,
  difficulty: DifficultyId,
  layer: number,
  rng: { chance(p: number): boolean },
): RewardResolution {
  const { safeGold, consolationGold, maxTierBonusGold } = rewardGoldFor(difficulty, layer)

  if (optionId === 'take-card') {
    return {
      outcomeId: 'take-card-ok',
      card,
      text: `${card.icon} ${card.name} 已放入背包`,
    }
  }

  if (optionId === 'take-gold') {
    return {
      outcomeId: 'take-gold-ok',
      gold: safeGold,
      text: `换成 +${safeGold} 金币`,
    }
  }

  // gamble：50% 升档/加码，50% 少额补偿
  if (rng.chance(0.5)) {
    const curTier = card.tier ?? 1
    if (curTier < 3 && card.stat) {
      const nextTier = (curTier + 1) as 2 | 3
      const upgraded = makeCardItem(card.stat, nextTier)
      return {
        outcomeId: 'gamble-high',
        card: upgraded,
        upgraded: true,
        text: `重铸成功！获得 ${upgraded.icon} ${upgraded.name}`,
      }
    }
    return {
      outcomeId: 'gamble-high',
      card,
      gold: maxTierBonusGold,
      upgraded: true,
      text: `金印加码！获得 ${card.icon} ${card.name} 与 +${maxTierBonusGold} 金币`,
    }
  }

  return {
    outcomeId: 'gamble-low',
    gold: consolationGold,
    upgraded: false,
    text: `重铸失手，仅获得 +${consolationGold} 金币补偿`,
  }
}
