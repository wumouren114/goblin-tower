/**
 * 探索事件数据表（v2 叙事版：完整小故事 + 世界观回声 + 关卡流向，数值与效果口径保持不变）。
 *
 * 设计口径见 docs/11-事件设计.md 与 docs/14-事件关卡逻辑.md：
 * - 不写死身份：同一事件在不同局里可能是不同的人（role 由运行时抽）；
 * - 不写概率数字：结果池只给候选，权重留在运行时；
 * - 惩罚轻：单次金币得失 ≤ 一层收益，减益 ≤ 3 层且自动消失；
 * - 允许"不了了之"：伏笔（arc）只在后续事件真的出现时才可能兑现；
 * - 危与机并存：吃亏的文案留后路，不写成惩罚通知。
 */

export type EventKind = 'choice' | 'info' | 'gift'

/**
 * 事件房的交互流向（供 UI 接线层渲染步骤，不改变核心选项结构）：
 * - single：一步抉择
 * - two-step：先看场景与线索，再做抉择
 * - chain：结算后可衔接二次追问或收束动作
 * - narrative：以阅读氛围与拾取线索/记忆为主
 */
export type EventFlow = 'single' | 'two-step' | 'chain' | 'narrative'

/** 事件中的登场人物描述（纯氛围与对白口吻，不暴露隐藏真身） */
export interface EventNpc {
  name: string
  identity: string
  voice: string
}

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
  /** 延后结算或留白余韵（可能不了了之，也可能在后续事件里呼应） */
  epilogue?: string
  /** 该结果补上的世界观/记忆碎片内容（克制、留白） */
  worldview?: string
}

export interface EventOption {
  id: string
  label: string
  /** 选项旁的观察提示：提示玩家靠什么推断，而非直接给答案 */
  hint?: string
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
  /** 事件房的关卡节奏类型 */
  flow?: EventFlow
  /** 具体的场景描写（光线、气味、声音、地上的物件），2~3 句 */
  scene?: string
  /** 登场人物（无活人登场的信息型/碑廊事件可省略） */
  npc?: EventNpc
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
    flow: 'two-step',
    scene:
      '回廊转角漏下一束斜光，空气里有潮湿亚麻和铁锈的气味。一张褪色油布铺在裂砖上，几枚铜铃随气流轻响，油布边压着半截磨秃的旧剑穗。',
    npc: {
      name: '背囊客',
      identity: '自称专做塔内急货的游商',
      voice: '市侩，语速偏快，报完价总爱低头捻指节',
    },
    roles: ['genuine', 'swindler', 'fallen'],
    clues: [
      '货上有塔内才有的符文',
      '影子比人慢半拍',
      '包袱里露出一角勇者徽记',
    ],
    intro:
      '背着鼓囊行囊的男人朝你和身旁的少女招手。油布上排着三件蒙尘旧物，他压低声音报出一个只有市价一半的数目，说自己不打算再往上爬了。',
    options: [
      {
        id: 'buy',
        label: '买一件（50 金）',
        hint: '留意油布上刻痕的走向，再看他递货时影子是否跟得上手腕。',
        costGold: 50,
        outcomes: [
          {
            id: 'buy-real',
            role: 'genuine',
            text: '护符入手微温，像刚从晴日里收进袖口。他仔细核过金币，临走前提醒你别在钟声落定前停步。',
            effects: [{ kind: 'buff', stat: 'all', value: 0.06, layers: 99 }],
            epilogue: '他收起油布往低层退去，身影很快融进风声里。',
            worldview: '塔吞下旧世界时，并非所有器物都会腐坏；偶有完好之物，会认得仍在攀登的人。',
          },
          {
            id: 'buy-fake',
            role: 'swindler',
            text: '铜符贴上掌心才发觉符文是反刻的，一股冷意顺着虎口散开，远处的巡逻脚步立刻急了起来。当时以为白白吃了暗亏，那枚反符却在暗处微微发烫，让你对塔里的伪装多了一分警觉。',
            effects: [
              { kind: 'arc', id: 'fake-peddler-marked' },
              { kind: 'debuff', stat: 'enemySpeed', value: 0.15, layers: 2 },
            ],
            epilogue: '他早已拐出视线。这枚发烫的反符或许会在后面替你认出同类气息，也可能就此冷透，再无下文。',
            worldview: '世界回声拼接不严的地方，影子会慢半拍；塔用这种缝隙豢养替它引路的人。',
          },
          {
            id: 'buy-relic',
            role: 'fallen',
            text: '接过手才看清那不是货，而是半枚崩口的勇者徽记。他没有数钱，只是别过头，望了望你身后的少女，像认出了某种旧日的同行。',
            effects: [
              { kind: 'arc', id: 'fallen-hero-token' },
              { kind: 'memory', id: 'fallen-token' },
            ],
            epilogue: '徽记背面的家纹与塔中某副手甲隐约同源；也许有人会因此停剑，也许它只是一块不再有人认得的冷铁。',
            worldview: '徽记上残存着星砂的微光——在被塔吞下之前，曾有整支队伍发誓去斩塔顶的恶龙。',
          },
        ],
      },
      {
        id: 'inspect',
        label: '要求验货（20 金）',
        hint: '真正走塔的人不怕亮底，怕的是有人盯着包袱夹层看。',
        costGold: 20,
        outcomes: [
          {
            id: 'inspect-real',
            role: 'genuine',
            text: '他爽快地解开麻绳任你翻看，确认你懂行后，又从里袋摸出半瓶温热的草药塞进你手里。',
            effects: [{ kind: 'heal', ratio: 0.3 }],
            epilogue: '他笑称这一趟没白等，说完背起行囊朝下层去了。',
            worldview: '即便在被塔切碎的回廊里，仍有人靠着老规矩活着，不问塔顶，也不问来处。',
          },
          {
            id: 'inspect-fake',
            role: 'swindler',
            text: '你的手指刚碰到油布边角，他便一把卷起包袱转身窜进岔道，二十枚金币就这么打了水漂。当时只觉得白白受骗，低头却看见砖缝里落着半张反写的塔纹拓片。',
            effects: [{ kind: 'clue', id: 'fake-peddler' }],
            epilogue: '你记住了他影子滞后的样子；往后再见相似的摊布，未必还会上当。',
            worldview: '塔里最廉价的东西往往标着最体面的价码，因为它真正要买的是你的迟疑。',
          },
          {
            id: 'inspect-fallen',
            role: 'fallen',
            text: '你在包袱深处摸到一块冰凉的金属。他沉默了很久，把那半枚勇者徽记按进你掌心，原样推回了你的金币。',
            effects: [{ kind: 'arc', id: 'fallen-hero-token' }],
            epilogue: '他说自己已经走不到塔顶了；这枚徽记或许会在某处帮上忙，也可能陪你走到终点仍无人问津。',
            worldview: '每个停在半途的爬塔者，都曾在某一层忘了自己最初想取回什么。',
          },
        ],
      },
      {
        id: 'trade-card',
        label: '用一张卡换',
        hint: '以物易物最能试出对方要的是行囊里的筹码，还是你的执念。',
        costCard: true,
        outcomes: [
          {
            id: 'trade-real',
            role: 'genuine',
            text: '他借着廊灯细看你递出的卡片，挑拣了半天，从贴身皮匣里抽出更沉手的一张回递给你。',
            effects: [{ kind: 'card', tier: 'purple' }],
            epilogue: '交易干脆利落，他冲你点点头便收摊离去。',
            worldview: '卡片里封存着旧世界的余温，懂得成色的人，一眼就能辨出它来自哪一层回声。',
          },
          {
            id: 'trade-fake',
            role: 'swindler',
            text: '卡片刚离手，油布下的烟尘猛地扬起，等视线清朗时，人连同摊子都没了踪影。当时以为平白折了一张好牌，却在空地边摸到他仓促留下的假印记。',
            effects: [{ kind: 'clue', id: 'fake-peddler' }],
            epilogue: '少了一张牌，却多记住了塔内骗徒的手法；那笔账未必找得回来，但这份警醒留在了身上。',
            worldview: '塔从不禁止掠夺，它只关心谁在失手之后还肯继续往上走。',
          },
          {
            id: 'trade-fallen',
            role: 'fallen',
            text: '他接过卡片没有收起，反而压低声音念出一个陌生的名字。你脑海里一片空白，握剑的手却先一步收紧了。',
            effects: [{ kind: 'memory', id: 'fallen-name' }],
            epilogue: '等你再抬头，他已靠着石柱闭上了眼，仿佛把最后一句话交给了你。',
            worldview: '记忆被塔剥离时，姓名最先散落，唯有肌肉里留下的剑势还记得那个曾与你并肩的人。',
          },
        ],
      },
      {
        id: 'leave',
        label: '走开',
        hint: '不碰来路不明的便宜，也就不会沾上它背后的因果。',
        outcomes: [
          {
            id: 'leave-none',
            text: '你拉住少女的袖口绕开油布。他没有出声挽留，只听见身后铜铃轻轻晃了一声，很快归于安静。',
            effects: [],
            epilogue: '也许他会继续等下一个路人，也许再高几层你只会遇见一卷无主的油布。',
            worldview: '在塔里，错过本身也是一种选择，只是没人知道自己躲开的是祸还是机缘。',
          },
        ],
      },
    ],
  },

  {
    id: 'tavern',
    title: '酒馆的一杯',
    kind: 'gift',
    flow: 'single',
    scene:
      '一间木门半掩的矮屋嵌在石壁间，暖黄灯火混着麦芽与松脂香溢到走廊上。木桌边几个影子晃着锡杯，跑调的歌谣隔着门缝断断续续地飘出来。',
    npc: {
      name: '柜台后的老板',
      identity: '只在低层回廊开张的酒馆掌柜',
      voice: '话痨里带着懒散，嘴上热络，眼神却总往门外瞟',
    },
    roles: ['honest', 'snitch'],
    clues: [
      '屋里有人在唱走调的歌',
      '老板一直在擦同一个杯子',
    ],
    intro:
      '这里还像个有人气的地方。老板把擦得发亮的锡杯推到柜台边，笑问你和同行的小姑娘要不要歇一脚，说再往上可就再也见不着活人开的酒馆了。',
    options: [
      {
        id: 'drink',
        label: '喝一杯（10 金）',
        hint: '酒色和柜台后的眼神一样难测，但低层的麦酒多半还不至于要命。',
        costGold: 10,
        outcomes: [
          {
            id: 'drink-common',
            text: '温热的麦酒滑过喉咙，四肢的僵意散了不少，连指尖流转的魔力都顺畅起来。',
            effects: [{ kind: 'buff', stat: 'magic', value: 0.08, layers: 2 }],
            epilogue: '酒意大概能撑过接下来两层，之后便只剩塔里的风。',
            worldview: '云上花庭的旧酿还留在低层，越往高处，属于人间的味道越稀薄。',
          },
          {
            id: 'drink-hero',
            text: '杯底沉着一层星砂般的微光——是旧时的勇者之酒。握剑的手稳得惊人，只是眼角泛起一层微醺的薄雾。',
            effects: [
              { kind: 'buff', stat: 'magic', value: 0.18, layers: 2 },
              { kind: 'debuff', stat: 'vision', value: 0.2, layers: 1 },
            ],
            epilogue: '老板看着你一饮而尽，罕见地闭了嘴，只把空杯倒扣在木台上。',
            worldview: '据说过去只有准备直面塔顶恶龙的人，才敢在出发前讨这一杯烈酒。',
          },
          {
            id: 'drink-bad',
            text: '酒液发酸，咽下去后眉心一阵发紧，出手的准头也跟着沉了半分。当时以为白花了这十枚金币，反胃逼出的冷汗却让你彻底清醒过来。',
            effects: [{ kind: 'debuff', stat: 'crit', value: 0.1, layers: 2 }],
            epilogue: '酸味散得慢，过两层自然会退干净；以后至少知道别在赶路时贪杯。',
            worldview: '连酒也会在世界回声里慢慢变质，塔留住的从来只是表象。',
          },
          {
            id: 'drink-robbed',
            role: 'snitch',
            text: '杯底的甜味太重，你在木桌边晃神了一瞬，再站起身时钱袋轻了一截，老板已换上一副从未见过你的神情。当时只当自己栽了跟头，推门时却听见墙角醉客漏出半句关于上层的口风。',
            effects: [{ kind: 'gold', value: -30 }],
            epilogue: '三十枚金币买了个教训：低层的暖光里，也藏着替塔清点行李的人。',
            worldview: '不是所有停在塔里的人都想出去；有些人靠着后来者的行囊，把这里过成了家。',
          },
        ],
      },
      {
        id: 'listen',
        label: '坐下听他们说话',
        hint: '不花钱也不碰杯，只听醉客在歌声间隙漏出来的零碎词句。',
        outcomes: [
          {
            id: 'listen-rumor',
            text: '邻桌两个满身灰尘的爬塔者压着嗓子提到塔顶的恶龙，又说起高处黄铜钟塔敲到第三声时，连名字都会被收走。你没插话，只把这半句记在了心里。',
            effects: [{ kind: 'arc', id: 'tavern-rumor' }],
            epilogue: '这些传闻未必真能派上用场，也许直到登顶也没人再提，也许在某间安静的屋子里会突然对上号。',
            worldview: '酒馆里的传闻真假参半，但每个版本都指向同一件事：塔顶盘踞着夺走记忆的恶龙。',
          },
        ],
      },
      {
        id: 'treat',
        label: '请全场喝一杯（60 金）',
        hint: '阔绰能换来片刻热络，至于有没有人肯记你的情，得看屋里坐的是谁。',
        costGold: 60,
        outcomes: [
          {
            id: 'treat-cheer',
            text: '木杯碰响了一片，几个老手顺手在桌上画了半张避开暗哨的简图。走出木屋时，连脚下的步子都轻快了几分。',
            effects: [{ kind: 'buff', stat: 'moveSpeed', value: 0.1, layers: 1 }],
            epilogue: '热闹只够照亮这一层；等你踏上楼梯，歌声就已经听不见了。',
            worldview: '在被塔隔绝的孤岛上，一杯酒换来的善意虽然短暂，却是少数还像人间的事情。',
          },
          {
            id: 'treat-nothing',
            text: '锡杯很快见了底，众人各自散回阴影里，连回头致意的人都没有。当时觉得这六十枚金币打了水漂，身旁的少女却轻轻笑了笑，说难得见你这么大方。',
            effects: [],
            epilogue: '无人领情，也无人为难；在塔里，花钱买个清静有时并不算坏事。',
            worldview: '许多人早就习惯了独来独往，因为明天谁会变成回廊里的新回声，谁也说不准。',
          },
        ],
      },
    ],
  },

  {
    id: 'chapel',
    title: '教堂的牧师',
    kind: 'choice',
    flow: 'chain',
    scene:
      '高窗的彩玻璃积满灰尘，漏下的光像褪了色的水。长椅空着，祭坛上干干净净，没有血迹，只有一缕冷香在柱影间盘旋，远处隐约传来黄铜钟的余震。',
    npc: {
      name: '灰袍牧师',
      identity: '守在空教堂祭坛前的女性',
      voice: '温柔而平稳，每句尾音都停得极轻，像在背诵早已听熟的祷词',
    },
    roles: ['priest', 'avatar'],
    clues: [
      '她的祷词里有一个词是反着念的',
      '祭坛上没有血',
    ],
    intro:
      '她站在微凉的光柱里向你颔首，说伤势可以免费替你抚平，只要你在离开前，亲手留一样东西在祭坛上。',
    options: [
      {
        id: 'leave-memory',
        label: '留下记忆碎片',
        hint: '若你身上带着拾来的残忆，她看你的眼神会比看金币更专注。',
        requires: ['memory:any'],
        outcomes: [
          {
            id: 'chapel-memory',
            text: '她将微凉的掌心贴在你额前，身上的伤口迅速合拢。一阵眩晕掠过，你想起了一个并不属于自己的午后——有人站在开满白花的露台上，抬头望向裂开的天空。',
            effects: [
              { kind: 'heal', ratio: 1 },
              { kind: 'memory', id: 'chapel-vision' },
            ],
            epilogue: '你交出了一点残忆，却换回一段更深的回声；她没有留你，只提醒你别忘了自己为何而来。',
            worldview: '云上花庭曾是一座真实存在的天空之城，在坠入高塔的那个下午，风车停在了半圈。',
          },
        ],
      },
      {
        id: 'leave-gold',
        label: '留下金币（40 金）',
        hint: '用身外之物换一场安静的治疗，不问缘由，也不留把柄。',
        costGold: 40,
        outcomes: [
          {
            id: 'chapel-gold',
            text: '金币落在石台上发出一声轻响。她垂目念完半段祷词，暖意顺着肩背漫开，旧伤愈合了大半。',
            effects: [{ kind: 'heal', ratio: 0.8 }],
            epilogue: '她没有多说一个字，只目送你们走出彩窗投下的灰光。',
            worldview: '只要还有人肯为活下去付账，塔里的仪式便能照常运转。',
          },
        ],
      },
      {
        id: 'ask-why',
        label: '问她为什么',
        hint: '若你留意过她反念的那个词，或是读过墙上的刻字，这一问会逼出她的底细。',
        outcomes: [
          {
            id: 'chapel-truth',
            text: '她停下祷词，抬头看向彩窗外看不见的塔顶，轻声道：这座塔吞下旧世界，从来不是为了毁掉它们，而是为了收集所有还想往上爬的人。',
            effects: [{ kind: 'clue', id: 'tower-collects' }],
            epilogue: '说完这句话，她便退回祭坛阴影里，不再回应你的任何追问。',
            worldview: '高塔是一座巨大的标本匣：渴望越烈的人，越容易被它留到最后。',
          },
          {
            id: 'chapel-refuse',
            text: '她微微一笑，说有些答案问得太早，脚步就会变沉，随后礼貌地替你们推开了离开的木门。',
            effects: [],
            epilogue: '什么都没拿到，也没有吃亏；只是回头时，祷词声已经停了。',
            worldview: '在塔里，沉默往往比谎言更接近真相。',
          },
          {
            id: 'chapel-avatar',
            role: 'avatar',
            text: '你话音未落，她眼角的灰白皮肤寸寸裂开，缝隙里露出的不是血肉，而是冰冷的塔砖与反刻的钟纹。当时以为多嘴惹来了麻烦，交手之间却让你彻底看清了塔的伪装。',
            effects: [
              { kind: 'battle', count: 1 },
              { kind: 'clue', id: 'tower-collects' },
            ],
            epilogue: '碎砖落地后，教堂迅速恢复空寂，仿佛刚才那声反念的祷词只是风穿过门缝。',
            worldview: '塔不仅吞噬世界，还会借用过客的皮囊开口说话，只为试探谁还记得反抗。',
          },
        ],
      },
      {
        id: 'refuse',
        label: '拒绝',
        hint: '不留下任何东西，只取走她顺手施舍的那一点微光。',
        outcomes: [
          {
            id: 'chapel-small',
            text: '她没有拦你，只轻挥衣袖，微弱的暖流掠过你的肩头，勉强止住了外伤。',
            effects: [{ kind: 'heal', ratio: 0.25 }],
            epilogue: '推门出去时，你听见身后又响起低低的祷词，那个反念的词依旧藏在句子中间。',
            worldview: '拒绝交易的人，往往走得更慢，却也更不容易把什么落在这座塔里。',
          },
        ],
      },
    ],
  },

  {
    id: 'wall-script',
    title: '塔壁上的刻字',
    kind: 'info',
    flow: 'narrative',
    scene:
      '转角石壁被斜光切出明暗两半，砖缝里落着新鲜石粉，空气里有铁刃刮过冷石的涩味。壁面齐肩高处，几道急促的刻痕还泛着浅白。',
    clues: [
      '字是新的，刃口还没锈',
      '刻得很深，像是在赶时间',
    ],
    intro:
      '有人用短刃在石壁上仓促刻下一行字：「不要相信第三声钟」。字迹末端拖出一道长划，像是刻到一半突然听见了什么。',
    options: [
      {
        id: 'read',
        label: '读下去',
        hint: '石粉还未散尽，辨认被划掉的后半行或许能看懂高处的忌讳，但久留容易惊动暗处。',
        outcomes: [
          {
            id: 'read-clue',
            text: '你借着光影摩挲被利刃划烂的下半行，勉强拼出几个残字——「祷词反念时，钟已响过两声」。少女轻轻念了一遍，把这句话记在了心底。',
            effects: [{ kind: 'arc', id: 'wall-script' }],
            epilogue: '这行警告或许会在教堂或高层的回声里派上用场，也可能直到见着恶龙都无人再敲响那口钟。',
            worldview: '在你之前已有无数攀塔者路过这里；他们留下的不是地图，而是临走前最后一点清醒。',
          },
          {
            id: 'read-ambush',
            text: '你低头辨认残字太久，石粉簌簌落进衣领，暗处的阴影猛地扑了出来。当时只觉多看一眼惹来围攻，乱战中却也趁机摸清了这层怪物的巡逻空隙。',
            effects: [{ kind: 'battle', count: 3 }],
            epilogue: '等尘埃落定再回头，石壁上的字迹仿佛比刚才浅了一分。',
            worldview: '塔并不喜欢后来者读懂前人的笔记，每多驻足一息，回廊便会收紧一分。',
          },
        ],
      },
      {
        id: 'ignore',
        label: '不看',
        hint: '前人的恐慌未必属于你，趁脚步未停直接上行。',
        outcomes: [
          {
            id: 'ignore-none',
            text: '你收回目光，带着少女快步穿过石廊。那行浅白的刻字很快被甩在身后的阴影里。',
            effects: [],
            epilogue: '没读完的句子留在了墙上，也许下一批攀塔者会比你更需要它。',
            worldview: '少知道一件事，路会走得更直，只是遇上回声变调时，只能靠自己的剑去试。',
          },
        ],
      },
    ],
  },

  {
    id: 'duelist',
    title: '知名的勇者',
    kind: 'choice',
    flow: 'chain',
    scene:
      '宽敞的石阶平台被风吹得一尘不染，空气里有擦剑油的微辛气息。一名披着旧斗篷的剑客横剑而立，剑鞘却干干净净，靴底几乎没沾多少塔灰。',
    npc: {
      name: '自称三度登塔的剑客',
      identity: '拦在阶前的知名勇者',
      voice: '昂扬而自负，说话总爱按着剑柄，尾音带着不容拒绝的试探',
    },
    roles: ['real', 'fraud'],
    clues: [
      '他说爬过三次塔，剑却一次没入鞘',
      '他的靴子是新的',
    ],
    intro:
      '他打量着你手里的武器与身后的少女，朗声说自己曾三次走到恶龙门前，今日兴起，想与你比试三合，点到为止。',
    options: [
      {
        id: 'accept',
        label: '接受比试',
        hint: '看清他握剑的虎口与靴底的尘土——真剑客求的是对手，假冒者求的是破绽。',
        outcomes: [
          {
            id: 'duel-win',
            text: '三合未满，你格开他的直刺，剑锋停在他肩前半寸。他退了三步，爽朗一笑收剑入鞘，将一枚压箱底的卡片抛给你，又替你在塔内商路留了口信。',
            effects: [
              { kind: 'card', tier: 'purple' },
              { kind: 'buff', stat: 'goldGain', value: 0.2, layers: 99 },
            ],
            epilogue: '他拍拍斗篷继续向上走去，说若你真能走到塔顶，别替那头恶龙留情。',
            worldview: '真正登过塔的人从不炫耀归途，因为每次回来，身上都会少掉一块记不起名字的东西。',
          },
          {
            id: 'duel-lose',
            text: '他的变招比想象中更沉，你被一剑挑开架势，虎口震得发麻，但他收住了杀招。当时以为白白落了下风、耗了体力，他却在转身前记住你的步法，随口指点了一句换气节奏。',
            effects: [
              { kind: 'debuff', stat: 'stamina', value: 0.1, layers: 2 },
              { kind: 'arc', id: 'duelist-remembers' },
            ],
            epilogue: '他记住了你的脸；后面若再相逢，或许会请你喝一杯或替你解围，也可能他早已先一步折在更高层。',
            worldview: '失忆之后，你的剑招里仍藏着连自己都说不清的旧日章法。',
          },
          {
            id: 'duel-fraud',
            role: 'fraud',
            text: '刚一交锋，他袖口滑出一柄涂暗的短刃直取肋下——这根本不是比试。当时以为中了圈套，反手制住他后，倒从他腰囊里搜出一张成色极好的紫卡。',
            effects: [
              { kind: 'battle', count: 1 },
              { kind: 'card', tier: 'purple' },
            ],
            epilogue: '新靴子踩脏了，假名声也碎在石阶上；你收起战利品，不再多看他一眼。',
            worldview: '塔里从不缺借着英雄之名行窃的人，因为真正的勇者大多已经留在了高处。',
          },
        ],
      },
      {
        id: 'decline',
        label: '拒绝',
        hint: '不接招可以省下体力，但他未必会轻易忘掉一个当面回绝他的人。',
        outcomes: [
          {
            id: 'duel-decline',
            text: '你按住剑柄没有上前。他眯起眼把你从头看到脚，冷哼一声侧身让开了石阶。',
            effects: [{ kind: 'arc', id: 'duelist-remembers' }],
            epilogue: '他记住了你的样子；往后也许会在别处替你说话，也许会在高处拔剑相向，也可能从此再无交集。',
            worldview: '在攀塔的路上，不肯亮剑的人往往最让人捉摸不透。',
          },
        ],
      },
      {
        id: 'watch',
        label: '站着看他',
        hint: '既不接战也不退让，看谁先耐不住石阶上的冷风。',
        outcomes: [
          {
            id: 'duel-watch',
            text: '你们隔着几步静静对视，风把斗篷吹得猎猎作响。他等了很久，最终自嘲地摇了摇头，收剑独自离去。',
            effects: [],
            epilogue: '石阶重归空旷，连一点尘土也没惊起。',
            worldview: '有时不挥剑，反而能把一场无谓的因果留在原地。',
          },
        ],
      },
    ],
  },

  {
    id: 'trapped-knight',
    title: '被困的勇者',
    kind: 'choice',
    flow: 'two-step',
    scene:
      '半截崩落的石梁斜压在碎砖堆上，空气里浮着呛人的灰尘和淡淡血腥。石梁缝隙里伸出一只戴着旧手甲的手，指节正一下一下叩着地面。',
    npc: {
      name: '石梁下的骑士',
      identity: '被塌方压住的攀塔者',
      voice: '迟疑而沙哑，每说两个字都要喘一口气，像是怕惊动什么',
    },
    roles: ['honest', 'bait'],
    clues: [
      '石梁下有人在敲',
      '他的手甲上刻着别的家族的纹章',
    ],
    intro:
      '碎石仍在簌簌滑落，石梁下的人气若游丝地向你求助。你盯着他手甲上那枚陌生的家族纹章，一时分辨不出下面压着的是同行，还是别的什么。',
    options: [
      {
        id: 'rescue',
        label: '把他挖出来（会掉血）',
        hint: '搬开石梁必然震裂虎口、耗损气血；留意敲击的节奏是否像活人的呼吸。',
        outcomes: [
          {
            id: 'rescue-thanks',
            text: '你和少女合力顶开石梁，碎石划破了你的手臂。他扶着墙站稳，郑重记下你的模样，说若还能活着走到高处，这笔命账一定还你。',
            effects: [
              { kind: 'arc', id: 'saved-knight' },
              { kind: 'heal', ratio: -0.15 },
            ],
            epilogue: '他拖着伤腿消失在岔路尽头。也许某次险境里他会现身替你挡刀，也许他早已独自奔向塔顶，从此与你再无瓜葛。',
            worldview: '手甲上的家纹来自星砂观星台尚未坠落时的旧国，如今只剩零星幸存者还戴着它。',
          },
          {
            id: 'rescue-silent',
            text: '石梁挪开时你被反震伤了肩臂。他从灰尘里爬起，只朝你点了点头，连名字都没留下便独自往更深处走去。当时以为白白流了血，包扎伤口时却发觉自己出力的架势更稳了。',
            effects: [{ kind: 'heal', ratio: -0.15 }],
            epilogue: '他没有回头，也没有许诺；有些善意在塔里就是这样，做完便留在身后，不再回响。',
            worldview: '不是每个被救起的人都记得感恩，毕竟连他们自己，也在一层层忘掉来时的名字。',
          },
          {
            id: 'rescue-bait',
            role: 'bait',
            text: '石梁刚抬起半尺，下面根本没有伤者，只有几双贴地亮起的眼睛扑面而来，乱石顺势擦伤了你的手臂。当时以为善心换来埋伏，清完伏兵后却替后来的路扫清了这处暗桩。',
            effects: [
              { kind: 'battle', count: 3 },
              { kind: 'heal', ratio: -0.15 },
            ],
            epilogue: '那只空手甲孤零零地留在石缝里，不知真正的主人早在多少层前就已离场。',
            worldview: '塔学会了模仿求救的敲击声，因为最想往上爬的人，往往最难对同类见死不救。',
          },
        ],
      },
      {
        id: 'potion',
        label: '给他一瓶药',
        hint: '不近身搬石，隔着缝隙递药，既留一份善意，也替自己留出退步。',
        outcomes: [
          {
            id: 'potion-kind',
            text: '你将药瓶滚进石缝。下面传来吞咽声，他隔着灰尘低声道谢，目送你和少女离开。',
            effects: [{ kind: 'arc', id: 'saved-knight' }],
            epilogue: '这点善意比拼命挖人更轻，或许日后他会在远处还你一份情，也可能就此散在风里。',
            worldview: '在随时会失去一切的高塔里，分出一口活命的水，已是极罕见的克制。',
          },
        ],
      },
      {
        id: 'ignore',
        label: '走开',
        hint: '不冒多余的险，把气力留给前面的硬仗。',
        outcomes: [
          {
            id: 'ignore-die',
            text: '你没有停步。走出十几步后，身后石梁下那阵断断续续的敲击声彻底停住了。',
            effects: [],
            epilogue: '回廊重新安静下来，你无从知道停下的是活人的呼吸，还是失效的诱饵。',
            worldview: '活到塔顶的人，往往都学会了不去回头确认身后的声音。',
          },
        ],
      },
    ],
  },

  {
    id: 'lost-child',
    title: '哭泣的孩子',
    kind: 'choice',
    flow: 'two-step',
    scene:
      '回廊背阴处浮着一层微凉薄雾，墙根落满枯瓣。一个小女孩抱膝缩在石柱旁低声抽泣，地上斜照着你和少女的影子，唯独她脚边空空荡荡。',
    npc: {
      name: '墙角的女孩',
      identity: '自称在塔里走散的孩子',
      voice: '细弱而迟疑，说话时总越过你的肩膀，望向你身后的方向',
    },
    roles: ['real', 'illusion'],
    clues: [
      '她没有影子',
      '她一直看着你身后的方向',
    ],
    intro:
      '她抬头揉着发红的眼角，小声说妈妈进塔以后就没再回来，问你能不能带她一起往前走一段路。',
    options: [
      {
        id: 'take',
        label: '带她走',
        hint: '脚下有没有影子固然古怪，但塔里的回声未必全是恶意。',
        outcomes: [
          {
            id: 'child-stays',
            text: '她轻轻牵住你的衣角，立刻止住了哭声。一路上她不怎么说话，只是有她在身侧，紧绷的心神反而安稳了些。',
            effects: [
              { kind: 'arc', id: 'child-follows' },
              { kind: 'buff', stat: 'hp', value: 0.05, layers: 99 },
            ],
            epilogue: '她会陪你走上几层，也许直到某处碑前才会松手，也许某次回头时便已不在。',
            worldview: '塔吞下整座城市时，连尚未长大的执念也一并留在了回廊里。',
          },
          {
            id: 'child-vanish',
            text: '踏入下一层光影的瞬间，衣角一轻。你回过头，身后空无一人，只在青石板上留下一朵压得极平的干花。',
            effects: [{ kind: 'memory', id: 'child-flower' }],
            epilogue: '干花带着云上花庭的淡香；后来若在无名墓碑前再见同种花瓣，你会忽然想起她的目光。',
            worldview: '有些回声无法跨过层界，它们能做的，只是把最后一点想念托付给路过的人。',
          },
          {
            id: 'child-real',
            role: 'real',
            text: '她小跑着跟上你们的步伐，脚步轻得几乎没有声音，还会提前扯扯你的袖口，指明避开碎石的窄道。',
            effects: [{ kind: 'buff', stat: 'moveSpeed', value: 0.05, layers: 99 }],
            epilogue: '她真的不是幻影；至于她最终能不能找到母亲，塔里没人能替她担保。',
            worldview: '并不是所有留在塔里的孩子都是回声，偶有真实走散的人，只能借着勇者的影子赶路。',
          },
        ],
      },
      {
        id: 'give-gold',
        label: '给她钱（30 金）',
        hint: '给路费可以撇清同行之累，但钱进了她手里，人便不会再听你差遣。',
        costGold: 30,
        outcomes: [
          {
            id: 'child-runs',
            text: '她一把攥紧金币，转身钻进暗廊深处，远远传来一阵清脆的轻笑。当时以为自己被个小骗子糊弄了，转身却发觉前方的巡逻阴影竟被那阵笑声引偏了方向。',
            effects: [{ kind: 'arc', id: 'child-follows' }],
            epilogue: '或许后面某层她还会从墙角探出头来，也可能这三十枚金币就此成了她的路费，再无音讯。',
            worldview: '在塔里，分不清是善意还是算计的时候，结果往往要隔几层才看得出模样。',
          },
        ],
      },
      {
        id: 'ignore',
        label: '不管',
        hint: '没有影子的哭声最容易拖慢脚步，径直离开最稳妥。',
        outcomes: [
          {
            id: 'child-gone',
            text: '你没有应声，带着少女径直往前。再回头看时，柱影下已经空了，只剩一枚磨平花纹的旧铜币躺在枯瓣里。',
            effects: [{ kind: 'gold', value: 5 }],
            epilogue: '哭声没有再追上来，仿佛刚才那一幕从未发生。',
            worldview: '塔里的回声若无人回应，便会自动折回墙缝，等待下一双停下的脚步。',
          },
        ],
      },
    ],
  },

  {
    id: 'nameless-grave',
    title: '无名的墓碑',
    kind: 'choice',
    flow: 'narrative',
    scene:
      '石室中央静得只听见风掠过穹顶的低鸣，灰蓝微光从高处垂落。一块半人高的素石碑立在碎砖间，碑前放着一束露水未干的新花，花瓣与云上花庭如出一辙。',
    clues: [
      '碑上没有日期',
      '碑前的花是新的',
    ],
    intro:
      '你走近半步，看清碑面上深浅不一的刻痕——上面清清楚楚刻着你自己的名字，却空着生卒年月，像是在等你补上最后一行。',
    options: [
      {
        id: 'touch',
        label: '触碰碑文',
        hint: '伸手去摸刻着自己名字的石面，可能唤回失去的记忆，也可能惊醒留在碑后的残影。',
        outcomes: [
          {
            id: 'grave-memory',
            text: '指尖贴上冷石的刹那，雨声灌满了耳廓。你想起了自己倒下那天的阴雨、折断的剑，以及抬头望向塔顶时，那道盘踞在云层之上的龙影。',
            effects: [{ kind: 'memory', id: 'own-death' }],
            epilogue: '记忆只回来了一瞬便又沉下去，但你终于确信，这并非你第一次走向塔顶。',
            worldview: '被塔吞下的勇者不会真正死去；失忆之后，他会被送回塔底，再一次踏上讨伐恶龙的路。',
          },
          {
            id: 'grave-fight',
            text: '碑面骤然发冷，一道与你身形、步态一模一样的影子从碑后缓缓站起，提剑指向你的眉心。当时以为触碰禁忌招来死斗，剑锋相撞的瞬间，却让你找回了一分久违的凛然。',
            effects: [{ kind: 'battle', count: 1 }],
            epilogue: '残影散去后，碑上的名字变得模糊不清，仿佛那段旧债已被你亲手斩断。',
            worldview: '塔把你过去每一次倒下的模样都留作了回声；唯有击败从前的自己，才配去见塔顶的恶龙。',
          },
        ],
      },
      {
        id: 'pray',
        label: '低头祭拜',
        hint: '不强求追问过往，只向曾经走到这里的自己致意。',
        outcomes: [
          {
            id: 'grave-pray',
            text: '你俯身扶正碑前那束新花，闭目静立片刻。胸口那股说不清的焦躁慢慢平复下来，气息比先前沉稳了许多。',
            effects: [{ kind: 'buff', stat: 'hp', value: 0.08, layers: 99 }],
            epilogue: '起身时，少女安静地站在你身侧，没有问你碑上写的是谁。',
            worldview: '即便忘了所有来路，只要肯承认曾经倒下过，人就能站得更稳。',
          },
        ],
      },
      {
        id: 'leave',
        label: '离开',
        hint: '不碰也不拜，把这块写着你名字的石头留在身后。',
        outcomes: [
          {
            id: 'grave-leave',
            text: '你没有伸手，也没有回头，带着少女推开了通往下一层的石门。',
            effects: [],
            epilogue: '石门合拢的瞬间，碑前的新花轻轻颤了一下；若往后再见相似的墓碑，上面的刻痕或许会比今日更深。',
            worldview: '你可以选择不看过去，但塔始终记得你走过的每一层台阶。',
          },
        ],
      },
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
