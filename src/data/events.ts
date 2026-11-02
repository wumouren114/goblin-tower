/**
 * 探索事件数据表（v1，只有数据 + 状态层，UI 与战斗掉落下一轮接）。
 *
 * 设计口径见 docs/11-事件设计.md：
 * - 不写死身份：同一事件在不同局里可能是不同的人（role 由运行时抽）；
 * - 不写概率数字：结果池只给候选，权重留在运行时；
 * - 惩罚轻：单次金币得失 ≤ 一层收益，减益 ≤ 3 层且自动消失；
 * - 允许"不了了之"：伏笔（arc）只在后续事件真的出现时才可能兑现。
 */

export type EventKind = 'choice' | 'info' | 'gift'

/**
 * 隐藏真身：运行时抽一个，玩家看不到。
 * - 货郎：genuine 真商人 / swindler 奸商 / fallen 落魄勇者
 * - 酒馆：honest 老实老板 / snitch 告密者
 * - 教堂：priest 真牧师 / avatar 塔的化身
 * - 被困的勇者：honest 真被困 / bait 诱饵
 * - 孩子：real 真孩子 / illusion 幻象
 * - 勇者：real 真勇者 / fraud 假冒
 */
export type EventRole =
  | 'genuine'
  | 'swindler'
  | 'fallen'
  | 'honest'
  | 'snitch'
  | 'priest'
  | 'avatar'
  | 'bait'
  | 'real'
  | 'illusion'
  | 'fraud'

export type EventEffect =
  | { kind: 'gold'; value: number }
  | { kind: 'heal'; ratio: number }
  | { kind: 'buff'; stat: string; value: number; layers: number }
  | { kind: 'debuff'; stat: string; value: number; layers: number }
  | { kind: 'card'; tier: 'blue' | 'purple' | 'gold' }
  | { kind: 'clue'; id: string }
  | { kind: 'arc'; id: string }
  | { kind: 'battle'; count: number }
  | { kind: 'memory'; id: string }

export interface EventOutcome {
  id: string
  /** 只在该真身下出现；不填 = 任意真身通用 */
  role?: EventRole
  text: string
  effects: EventEffect[]
}

export interface EventOption {
  id: string
  label: string
  /** 需要已持有这些标记/线索，选项才可见 */
  requires?: string[]
  costGold?: number
  costCard?: boolean
  outcomes: EventOutcome[]
}

export interface EventDef {
  id: string
  title: string
  kind: EventKind
  /** 进场就看到的免费线索（玩家不需要操作） */
  clues: string[]
  intro: string
  /** 该事件是否抽隐藏真身 */
  roles?: EventRole[]
  options: EventOption[]
  /** 显示权重（越大越常见）；不写 = 1 */
  weight?: number
}

/** 伏笔 id：需要有人兑现，才允许被 arc 效果引用 */
export const ARC_IDS = [
  'saved-knight',
  'tavern-rumor',
  'wall-script',
  'fallen-hero-token',
  'child-follows',
  'duelist-remembers',
  'fake-peddler-marked',
] as const

export const EVENTS: readonly EventDef[] = [
  {
    id: 'peddler',
    title: '路边的货郎',
    kind: 'choice',
    roles: ['genuine', 'swindler', 'fallen'],
    clues: ['货上有塔内才有的符文', '影子比人慢半拍', '包袱里露出一角勇者徽记'],
    intro: '走廊拐角，一个背着鼓包的人朝你招手。摊布上摆着三件东西，报价只有市价一半。',
    options: [
      {
        id: 'buy',
        label: '买一件（50 金）',
        costGold: 50,
        outcomes: [
          { id: 'buy-real', role: 'genuine', text: '护符是真的，暖意顺着手腕往上爬。', effects: [{ kind: 'buff', stat: 'all', value: 0.06, layers: 99 }] },
          { id: 'buy-fake', role: 'swindler', text: '戴上才发现符文是反的——你被标记了。', effects: [{ kind: 'arc', id: 'fake-peddler-marked' }, { kind: 'debuff', stat: 'enemySpeed', value: 0.15, layers: 2 }] },
          { id: 'buy-relic', role: 'fallen', text: '是某个人的遗物。他别过头去。', effects: [{ kind: 'arc', id: 'fallen-hero-token' }, { kind: 'memory', id: 'fallen-token' }] },
        ],
      },
      {
        id: 'inspect',
        label: '要求验货（20 金）',
        costGold: 20,
        outcomes: [
          { id: 'inspect-real', role: 'genuine', text: '他大方地摊开包袱，还塞给你一瓶药。', effects: [{ kind: 'heal', ratio: 0.3 }] },
          { id: 'inspect-fake', role: 'swindler', text: '他转身就跑，钱白花了。', effects: [{ kind: 'clue', id: 'fake-peddler' }] },
          { id: 'inspect-fallen', role: 'fallen', text: '他沉默很久，把徽记塞进你手里，没收钱。', effects: [{ kind: 'arc', id: 'fallen-hero-token' }] },
        ],
      },
      {
        id: 'trade-card',
        label: '用一张卡换',
        costCard: true,
        outcomes: [
          { id: 'trade-real', role: 'genuine', text: '他挑了半天，塞回一张更好的。', effects: [{ kind: 'card', tier: 'purple' }] },
          { id: 'trade-fake', role: 'swindler', text: '卡没了，人也没了。', effects: [{ kind: 'clue', id: 'fake-peddler' }] },
          { id: 'trade-fallen', role: 'fallen', text: '他讲了一个名字，你记不住，但身体记住了。', effects: [{ kind: 'memory', id: 'fallen-name' }] },
        ],
      },
      {
        id: 'leave',
        label: '走开',
        outcomes: [{ id: 'leave-none', text: '他没追上来。', effects: [] }],
      },
    ],
  },

  {
    id: 'tavern',
    title: '酒馆的一杯',
    kind: 'gift',
    roles: ['honest', 'snitch'],
    clues: ['屋里有人在唱走调的歌', '老板一直在擦同一个杯子'],
    intro: '木屋的门半开着，暖光溢到走廊上。',
    options: [
      {
        id: 'drink',
        label: '喝一杯（10 金）',
        costGold: 10,
        outcomes: [
          { id: 'drink-common', text: '普通的酒，喉咙热了一下。', effects: [{ kind: 'buff', stat: 'magic', value: 0.08, layers: 2 }] },
          { id: 'drink-hero', text: '是勇者之酒。手很稳，眼睛有点花。', effects: [{ kind: 'buff', stat: 'magic', value: 0.18, layers: 2 }, { kind: 'debuff', stat: 'vision', value: 0.2, layers: 1 }] },
          { id: 'drink-bad', text: '酒是酸的。', effects: [{ kind: 'debuff', stat: 'crit', value: 0.1, layers: 2 }] },
          { id: 'drink-robbed', role: 'snitch', text: '你醒来时，钱袋轻了。', effects: [{ kind: 'gold', value: -30 }] },
        ],
      },
      {
        id: 'listen',
        label: '坐下听他们说话',
        outcomes: [{ id: 'listen-rumor', text: '有人在讲塔顶的事，你记住了半句。', effects: [{ kind: 'arc', id: 'tavern-rumor' }] }],
      },
      {
        id: 'treat',
        label: '请全场喝一杯（60 金）',
        costGold: 60,
        outcomes: [
          { id: 'treat-cheer', text: '满屋子的欢呼。这一层走起来轻快些。', effects: [{ kind: 'buff', stat: 'moveSpeed', value: 0.1, layers: 1 }] },
          { id: 'treat-nothing', text: '他们喝完就散了，没人记得你。', effects: [] },
        ],
      },
    ],
  },

  {
    id: 'chapel',
    title: '教堂的牧师',
    kind: 'choice',
    roles: ['priest', 'avatar'],
    clues: ['她的祷词里有一个词是反着念的', '祭坛上没有血'],
    intro: '彩窗透进来的光是灰的。她说治疗免费，但要你留下一样东西。',
    options: [
      {
        id: 'leave-memory',
        label: '留下记忆碎片',
        requires: ['memory:any'],
        outcomes: [{ id: 'chapel-memory', text: '她把手按在你额头上，你想起了一个不属于你的下午。', effects: [{ kind: 'heal', ratio: 1 }, { kind: 'memory', id: 'chapel-vision' }] }],
      },
      {
        id: 'leave-gold',
        label: '留下金币（40 金）',
        costGold: 40,
        outcomes: [{ id: 'chapel-gold', text: '她收下了，什么也没说。', effects: [{ kind: 'heal', ratio: 0.8 }] }],
      },
      {
        id: 'ask-why',
        label: '问她为什么',
        outcomes: [
          { id: 'chapel-truth', text: '她说：这座塔在收集想往上爬的人。', effects: [{ kind: 'clue', id: 'tower-collects' }] },
          { id: 'chapel-refuse', text: '她笑着请你出去。', effects: [] },
          { id: 'chapel-avatar', role: 'avatar', text: '她的脸裂开了，里面是塔的砖。', effects: [{ kind: 'battle', count: 1 }, { kind: 'clue', id: 'tower-collects' }] },
        ],
      },
      { id: 'refuse', label: '拒绝', outcomes: [{ id: 'chapel-small', text: '只回了一点血。', effects: [{ kind: 'heal', ratio: 0.25 }] }] },
    ],
  },

  {
    id: 'wall-script',
    title: '塔壁上的刻字',
    kind: 'info',
    clues: ['字是新的，刃口还没锈', '刻得很深，像是在赶时间'],
    intro: '墙上有前人用刀刻的字：「不要相信第三声钟」。',
    options: [
      {
        id: 'read',
        label: '读下去',
        outcomes: [
          { id: 'read-clue', text: '后面还有一行，被划掉了。', effects: [{ kind: 'arc', id: 'wall-script' }] },
          { id: 'read-ambush', text: '你看得太久，暗处有东西动了。', effects: [{ kind: 'battle', count: 3 }] },
        ],
      },
      { id: 'ignore', label: '不看', outcomes: [{ id: 'ignore-none', text: '你继续往上走。', effects: [] }] },
    ],
  },

  {
    id: 'duelist',
    title: '知名的勇者',
    kind: 'choice',
    roles: ['real', 'fraud'],
    clues: ['他说爬过三次塔，剑却一次没入鞘', '他的靴子是新的'],
    intro: '他拦在路中间，说要和你比一场，点到为止。',
    options: [
      {
        id: 'accept',
        label: '接受比试',
        outcomes: [
          { id: 'duel-win', text: '他退了三步，笑着认输。', effects: [{ kind: 'card', tier: 'purple' }, { kind: 'buff', stat: 'goldGain', value: 0.2, layers: 99 }] },
          { id: 'duel-lose', text: '你被他一剑挑飞，但没下死手。', effects: [{ kind: 'debuff', stat: 'stamina', value: 0.1, layers: 2 }, { kind: 'arc', id: 'duelist-remembers' }] },
          { id: 'duel-fraud', role: 'fraud', text: '他袖子里掉出一把短刃——这不是比试。', effects: [{ kind: 'battle', count: 1 }, { kind: 'card', tier: 'purple' }] },
        ],
      },
      {
        id: 'decline',
        label: '拒绝',
        outcomes: [{ id: 'duel-decline', text: '他记住了你的脸。', effects: [{ kind: 'arc', id: 'duelist-remembers' }] }],
      },
      { id: 'watch', label: '站着看他', outcomes: [{ id: 'duel-watch', text: '他等了很久，最后自己走了。', effects: [] }] },
    ],
  },

  {
    id: 'trapped-knight',
    title: '被困的勇者',
    kind: 'choice',
    roles: ['honest', 'bait'],
    clues: ['石梁下有人在敲', '他的手甲上刻着别的家族的纹章'],
    intro: '一根塌下来的石梁压住了他，他还在喘气。',
    options: [
      {
        id: 'rescue',
        label: '把他挖出来（会掉血）',
        outcomes: [
          { id: 'rescue-thanks', text: '他记下了你的样子，说会还。', effects: [{ kind: 'arc', id: 'saved-knight' }, { kind: 'heal', ratio: -0.15 }] },
          { id: 'rescue-silent', text: '他点点头就走了，没留名字。', effects: [{ kind: 'heal', ratio: -0.15 }] },
          { id: 'rescue-bait', role: 'bait', text: '石梁下面没有伤者，只有一双眼睛。', effects: [{ kind: 'battle', count: 3 }, { kind: 'heal', ratio: -0.15 }] },
        ],
      },
      {
        id: 'potion',
        label: '给他一瓶药',
        outcomes: [{ id: 'potion-kind', text: '他喝了，看着你走远。', effects: [{ kind: 'arc', id: 'saved-knight' }] }],
      },
      { id: 'ignore', label: '走开', outcomes: [{ id: 'ignore-die', text: '敲击声在你身后停住了。', effects: [] }] },
    ],
  },

  {
    id: 'lost-child',
    title: '哭泣的孩子',
    kind: 'choice',
    roles: ['real', 'illusion'],
    clues: ['她没有影子', '她一直看着你身后的方向'],
    intro: '她蹲在墙边哭，说妈妈在塔里。',
    options: [
      {
        id: 'take',
        label: '带她走',
        outcomes: [
          { id: 'child-stays', text: '她拉住你的衣角，不哭了。', effects: [{ kind: 'arc', id: 'child-follows' }, { kind: 'buff', stat: 'hp', value: 0.05, layers: 99 }] },
          { id: 'child-vanish', text: '走到下一层，她不见了，地上留下一朵干花。', effects: [{ kind: 'memory', id: 'child-flower' }] },
          { id: 'child-real', role: 'real', text: '她真的跟上来了，脚步很轻。', effects: [{ kind: 'buff', stat: 'moveSpeed', value: 0.05, layers: 99 }] },
        ],
      },
      {
        id: 'give-gold',
        label: '给她钱（30 金）',
        costGold: 30,
        outcomes: [{ id: 'child-runs', text: '她跑进暗处。你听见她在笑。', effects: [{ kind: 'arc', id: 'child-follows' }] }],
      },
      { id: 'ignore', label: '不管', outcomes: [{ id: 'child-gone', text: '她消失了，地上有一枚旧铜币。', effects: [{ kind: 'gold', value: 5 }] }] },
    ],
  },

  {
    id: 'nameless-grave',
    title: '无名的墓碑',
    kind: 'choice',
    clues: ['碑上没有日期', '碑前的花是新的'],
    intro: '碑上刻着你的名字。',
    options: [
      {
        id: 'touch',
        label: '触碰碑文',
        outcomes: [
          { id: 'grave-memory', text: '你想起了自己倒下那天的雨。', effects: [{ kind: 'memory', id: 'own-death' }] },
          { id: 'grave-fight', text: '碑后站起一个和你一模一样的人。', effects: [{ kind: 'battle', count: 1 }] },
        ],
      },
      { id: 'pray', label: '低头祭拜', outcomes: [{ id: 'grave-pray', text: '心里安静了一些。', effects: [{ kind: 'buff', stat: 'hp', value: 0.08, layers: 99 }] }] },
      { id: 'leave', label: '离开', outcomes: [{ id: 'grave-leave', text: '你没回头。', effects: [] }] },
    ],
  },
]

export function eventOf(id: string): EventDef | undefined {
  return EVENTS.find((e) => e.id === id)
}

/** 事件池：按 weight 展开成可抽取列表（权重缺失按 1） */
export function eventPoolWeighted(): { id: string; weight: number }[] {
  return EVENTS.map((e) => ({ id: e.id, weight: Math.max(0, e.weight ?? 1) }))
}
