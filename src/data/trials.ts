/**
 * 「考验」门数据表（纯数据 + 类型，不依赖任何运行时模块）。
 *
 * 设计口径见 docs/15-考验设计.md：
 * - 塔在称量攀塔者：先立约承受数层约束或直面单挑，兑现后换取长线转正收益；
 * - 拒绝考验没有任何惩罚，NPC 留有分寸；
 * - 立约台词说清「拿什么换什么」，但不念数值；具体数值口径写在 burden / goal / boon 中。
 */

export interface TrialDef {
  id: string
  name: string
  npcName: string
  npcVoice: string
  offer: string
  accept: string
  refuse: string
  /** 期间负面 */
  burden: {
    stat: 'goldGain' | 'hurtTaken' | 'healGain' | 'skillCharge' | 'moveSpeed' | 'attack'
    value: number
    layers: number
    text: string
  }
  /** 兑现条件 */
  goal: {
    kind: 'layers' | 'kills' | 'eliteKills' | 'gold'
    value: number
    text: string
  }
  /** 转正收益 */
  boon: {
    stat: 'goldGain' | 'dodge' | 'hpMax' | 'healPerSec' | 'attack' | 'skillDamage' | 'attackSpeed'
    value: number
    text: string
  }
  icon: string
}

export const TRIALS: readonly TrialDef[] = [
  {
    id: 'tax-oath',
    name: '税吏之誓',
    npcName: '旧账税吏·维尔',
    npcVoice: '慢条斯理，拨着算珠，句尾总补一句“你考虑清楚”。',
    offer:
      '城邦坠入高塔前，我是替库房核账的人。接下来几层你把沿途的收成先分我一半，只要熬到账期满，我按你届时袋里的底子连本带利还你一笔，你考虑清楚。',
    accept:
      '好，名字我记在灰页上了。这几层手头会紧些，别急着挥霍，留得住本钱，到期我自然照账兑给你。',
    refuse:
      '不愿押这份旧账也无妨。塔里钱袋轻重全凭自己掂量，你且先走，账本我替你合着。',
    burden: {
      stat: 'goldGain',
      value: -0.5,
      layers: 3,
      text: '3 层内金币获取 -50%',
    },
    goal: {
      kind: 'layers',
      value: 3,
      text: '坚持通关 3 层',
    },
    boon: {
      stat: 'goldGain',
      value: 0.4,
      text: '到期获得当前持有金币的 40%',
    },
    icon: 'scale',
  },
  {
    id: 'burn-boats',
    name: '破釜之誓',
    npcName: '断甲斥候·加伦',
    npcVoice: '语速干脆，说话时习惯拿指节轻敲空了的盾扣。',
    offer:
      '我在星砂观星台折了盾，才明白这塔最先收走的是爱硬扛的人。敢不敢卸下护心，这几层挨打更疼些？只要全须全尾走过去，我把躲刀的步法交给你。',
    accept:
      '痛快。记住，接下来每一下擦伤都会比先前重，别想着靠血肉去换，把眼睛盯在对方的起手上。',
    refuse:
      '留着甲片保命不算丢人。往上爬的人先要活着，等你哪天觉得身子够轻了，再论这门步法。',
    burden: {
      stat: 'hurtTaken',
      value: 0.25,
      layers: 3,
      text: '3 层内受到伤害 +25%',
    },
    goal: {
      kind: 'layers',
      value: 3,
      text: '坚持通关 3 层',
    },
    boon: {
      stat: 'dodge',
      value: 0.12,
      text: '永久闪避 +12%',
    },
    icon: 'cloak',
  },
  {
    id: 'duel-pact',
    name: '切磋',
    npcName: '守阶剑师·洛安',
    npcVoice: '低沉克制，话很少，问完便垂剑等答复。',
    offer:
      '我走不到塔顶，却也不想变成无声的回声，只能守在阶前找过路的勇者试剑。胜过我，我替你把趁手的兵刃再淬一阶；若落败，我会留手，只是这一身元气免不了损上一截。',
    accept:
      '拔剑吧。点到为止，我会收住最后一分力，但也绝不会让着你。',
    refuse:
      '既然今日不宜动剑，那便各自收势。前面的台阶还长，我仍在这里候着。',
    burden: {
      stat: 'hurtTaken',
      value: 0.12,
      layers: 1,
      text: '单挑落败则生命上限 -12%（不会致死）',
    },
    goal: {
      kind: 'eliteKills',
      value: 1,
      text: '单挑击败守阶剑师',
    },
    boon: {
      stat: 'attack',
      value: 1,
      text: '取胜则专武 +1 级',
    },
    icon: 'blade',
  },
  {
    id: 'fasting-oath',
    name: '禁食之誓',
    npcName: '枯井修女·赛拉',
    npcVoice: '声音轻而稳，像隔着一层冷雾念旧时的戒律。',
    offer:
      '云上花庭的旧泉早就干了，塔里借来的药香大多只是回声。你若肯立誓节制，接下来几层少仰仗外药回气，待戒期一满，你自己的骨血便会生出绵长的生机。',
    accept:
      '戒印已落。这几层疗伤会格外吃力，少受无谓的伤，也别忘了你为何还站在这里。',
    refuse:
      '并非每段路都适合空腹前行。带好你手边的药瓶吧，愿你在高处还能记得来时的味道。',
    burden: {
      stat: 'healGain',
      value: -0.6,
      layers: 3,
      text: '3 层内治疗效果 -60%',
    },
    goal: {
      kind: 'layers',
      value: 3,
      text: '坚持通关 3 层',
    },
    boon: {
      stat: 'hpMax',
      value: 0.15,
      text: '生命上限 +15%，且每秒回复 0.5% 生命',
    },
    icon: 'chalice',
  },
  {
    id: 'forced-march',
    name: '负重行军',
    npcName: '逃兵军需官·马科',
    npcVoice: '粗声粗气，一边往肩上颠铁袋一边打量你的靴底。',
    offer:
      '我从旧防线逃进这塔时只扛出两袋冷铁，如今腿脚早跑不动了。替我背着它们闯过两层——步子会沉，铁锈味还会招来更多东西；等你卸下袋子，手脚反倒会比从前快出一截。',
    accept:
      '背稳了，扣带勒紧些。前头两层又沉又挤，别在拐角处被围死，扛过去就是你的本事。',
    refuse:
      '嫌沉就别硬揽。塔里本就步步催人，轻装赶路不丢脸，这两袋铁我自己慢慢挪。',
    burden: {
      stat: 'moveSpeed',
      value: -0.15,
      layers: 2,
      text: '2 层内移速 -15%，且每层敌人数量 +20%',
    },
    goal: {
      kind: 'layers',
      value: 2,
      text: '负重通过 2 层',
    },
    boon: {
      stat: 'attackSpeed',
      value: 0.1,
      text: '攻速 +10%、移速 +8%',
    },
    icon: 'pack',
  },
  {
    id: 'silence-oath',
    name: '沉默之誓',
    npcName: '封钟学徒·伊莎',
    npcVoice: '嗓音偏哑，停顿很长，仿佛每个词都要先在喉间压一压。',
    offer:
      '黄铜钟塔收走了我的钟舌，才让我听见钟声之外的回响。你若肯把蓄力之泉先封上几层，少倚仗绝技开路，等封印解开时，你蓄下的那口气会比从前更深、更烈。',
    accept:
      '封缄已成。这几层灵息聚得会很慢，多用平时的招式周旋，别急着挥空手里的底牌。',
    refuse:
      '不封也好。前路难测，留着顺手的绝技护身，总比勉强守缄更稳妥。',
    burden: {
      stat: 'skillCharge',
      value: -0.4,
      layers: 3,
      text: '3 层内充能获取 -40%',
    },
    goal: {
      kind: 'layers',
      value: 3,
      text: '封缄通过 3 层',
    },
    boon: {
      stat: 'skillDamage',
      value: 0.2,
      text: '技能伤害 +20%、充能上限 +12',
    },
    icon: 'bell',
  },
]
