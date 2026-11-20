# P0-a 交付包（离线用）

> 含改造 P0-a 所需的全部源码与规则文档。按顺序读，改完只回传被修改的文件。
> **沙盒没有 node_modules、Node 18 跑不了 tsc/smoke —— 不要尝试运行。**

## 0. 目录结构

```
HANDOFF.md
src/types.ts（只需 CardStat 与 InventoryItem，见 §3）
src/data/cards.ts
src/data/balance.json（只改 buffCards 段）
src/systems/inventory.ts
src/systems/shop.ts
src/systems/economy.ts
```

## 1. HANDOFF.md（先读 §2 / §6 / §8）

路径：`HANDOFF.md`

````md
# HANDOFF · 残响高塔（交接给下一个执行者）

> 最后更新：2026-11（v5 重构进行中）
> 读完这份就能接手。**先看 §2 的"已锁定决策"，不要推翻它们**——那些是产品侧拍过板的。

---

## 1. 项目与运行

Vite + TypeScript(strict) + three.js，3D 低多边形场景 + 程序化像素 billboard 角色。

```bash
cd <repo>
npm install
npx tsc --noEmit          # 类型门槛
npm run smoke             # 冒烟门槛：542 + 77 + 46 + 16 + 16 + 12 项全绿
npm run build             # 产物 dist/

# 沙箱里 vite dev 会 spawn EPERM，用静态服务 + 无头浏览器看效果：
npm run build
node scripts/serve-dist.mjs 5199     # 提示 serving ... 后
# 无头截图（Windows Edge + SwiftShader）：
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --disable-gpu --enable-unsafe-swiftshader --use-angle=swiftshader \
  --window-size=1280,720 --virtual-time-budget=8000 \
  --screenshot="$PWD/shots/check.png" \
  "http://127.0.0.1:5199/?autostart=hard&char=murasame&floor=8&warmup=2&autoattack=1"
```

调试 URL 参数：`autostart=easy|normal|hard`、`char=mutsumi|murasame|fish`、`floor=N`、`warmup=秒`、`autoattack=1`、`seed=N`、`event=1`（随机事件面板）、`eventpick=1`（自动选第一项）。

**Git**：远端 `origin/master`（GitHub）。用户要求**改动验收通过后自行 commit + push**，不必每次询问。仓库已设本地身份 `wumouren114 <3887597480@qq.com>`。push 前有 pre-push 钩子（跑美术检查），约 3 分钟，output 会被 libpng warning 刷屏，属正常。

---

## 2. 已锁定决策（不要推翻）

### 2.1 系统分工
- **道具卡 = 纯数值层**，机制一律不进卡。
- **潜能（原"专武分支"）= 机制层**，承担"新增招式 / 触发 / 联动"。

### 2.2 道具卡
- 一张卡 = 一个名字 + **3 档（蓝/紫/金）**，**同名唯一**，再拿到同名 = 原地升一档。
- 池子只出"比当前持有高一档"的那一档；**满金后退池**。
- 允许跳级（一次 +2 档），但**跳级概率要压低**（用户明确：池子不够靠降跳级，不靠扩名字）。
- 10 张卡 10 个属性键，**1:1**，不扩同键第二张（"带代价的卡"由祭坛承担）。
- 背包**不限格数**；**取消二合一合成**。

### 2.3 潜能
- 每角色 **3 条分支**，选定即锁定，别的分支节点领不到。
- 每条分支 = **根被动 + 1 条代价 + 3 个可点节点**；节点**只有一级**，固定数值，不升级。
- 代价必须"咬自己"（流殇砍普攻、瞬闪砍普攻、剑意砍技能），**标记结算/流血是独立伤害源，不吃这些衰减**。
- 跨大层才拿第二/第三条潜能（简单 2 / 普通 2 / 困难 3）。
- 分支之间靠 `resonances` 产生反应。

### 2.4 关卡结构
- 简单 **5+5**，普通 **6+6**，困难 **5+5+5**（每大层 5–6 小层）。
- **每大层最后一关 = Boss**；通关且存在下一大层 → **直接获得一个新潜能**（不走隧道）。
- 其余小层结束 → **3 条时空隧道三选一**。
- 第一关固定为潜能关（选第一条分支）。
- 专武/潜能关**保持稀缺**（约 4–5 次/局）。

### 2.5 交互
- **所有场景交互统一 `Enter`**（商人 / 祭坛 / 可交互物 / 事件 NPC）。
- `E` 留给战斗键（丛雨=处决、睦=推开、大肥鱼=回收召唤物）；`F` 是每角色专属的第二键。

### 2.6 节奏（**设计定稿，但尚未写入 balance.json**）
- 方向：**怪多、单只脆、密度高、无喘息**（简单难度可保留分波）。
- 目标参数（草案，见 §5 P0-b）：quota 70+10×层、刷新 0.5s 递减到 0.22、批次 3（6 层后 4）、同屏 30+5×层（上限 90）、小怪 HP ×0.55、伤害 ×0.6、移速 ×1.05→1.6。
- 金币控制：击杀 0.4/只、清层 90+15×层、困难 goldMul 0.85、商店涨价 ×1.10/层。
- 已落地：受击无敌 0.65→0.3、删除 Shift 冲刺、暴击倍率固定 ×2.0。

### 2.7 事件
- 不写死身份：同一事件在不同局里是不同的人（隐藏 `role`，运行时抽）。
- **不写概率数字**，文档只写"常见/少见"。
- 惩罚轻：金币得失 ≤ 一层收益、减益 ≤ 3 层、不扣生命上限、不删卡。
- **允许"不了了之"**：伏笔（arc）只在后续事件真的出现时才可能兑现。
- 三种骨架：抉择型 / 信息型（无惩罚）/ 馈赠型（无惩罚）。

### 2.8 世界观
失忆勇者带二次元少女攀塔，终点击败"恶龙"（最终 Boss 的比喻），夺回记忆。每一大层 = **被塔吞下的一个世界回声**（云上花庭 / 星砂观星台 / 黄铜钟塔）。

---

## 3. 代码地图

| 文件 | 职责 | 状态 |
| --- | --- | --- |
| `src/data/potentials.ts` | 潜能数据：3 角色 × 3 分支 × 3 节点 + 9 组反应 + 通用项 | ✅ 数据完成，**未接入战斗** |
| `src/data/cards.ts` | 道具卡：10 张 × 3 档，同名唯一/满档退池的取值函数 | ✅ 数据完成，**未接入商店/背包** |
| `src/data/events.ts` | 8 个探索事件（6 个带随机真身）+ 伏笔 id 登记 | ✅ 数据完成 |
| `src/systems/eventState.ts` | 线索/标记/伏笔/记忆碎片；快照可存档 | ✅ 完成 |
| `src/ui/eventPanel.ts` | 事件面板（自包含 DOM + 内联样式） | ✅ 可玩 |
| `src/core/beatClock.ts` | 节奏普攻时钟（134BPM，±35/±60ms） | ✅ 单测完成，**未接入普攻** |
| `src/world/themes.ts` | 9 套主题（3 场景区 × 3 变体），明亮二次元色板 | ✅ 完成并可调 |
| `src/world/floor.ts` | 场景构建；`buildLandmark()` 三种地标；墙体材质已跟主题 | ✅ 样板完成 |
| `src/data/stages.ts` | 阶段/场景/地标/副标题 | ✅ |
| `src/systems/tunnels.ts` | 隧道生成；`reward` 池 = 宝箱 / 技能卡 / 事件(5%) | ✅ |
| `src/game.ts` | 主循环（2800+ 行上帝对象） | 见 §5 |
| `src/data/gameConfig.ts` | 玩家/敌人数值常量 | 已改 iFrames |

冒烟：`sim/*-smoke.mjs`（world / combat / economy / art / beat / potential / event）。

---

## 4. 已完成（可直接复用）

1. 明亮化配色 + 三种中央地标（风车/黄道仪/齿轮），**每层中央不再是无意义的塔心祭坛**。
2. 交互统一 Enter（代码 + 9 处 NPC 文案 + HUD + 注释）。
3. 删除未被引用的旧 `THEMES` 表（89 行死代码）。
4. 事件数据 + 状态层 + 面板 + 事件房接入隧道（5% 概率刷出）。
5. 战斗基线：删冲刺、iFrames 0.3、暴击 ×2.0。
6. 潜能与卡表数据 + 两套冒烟断言。

---

## 5. 下一步（按优先级）

### P0-a 道具三档接进商店 / 背包 / 商人 ⭐ 建议先做
- 用 `src/data/cards.ts` 替换 `balance.json` 的 `buffCards`（保留旧表直到切换完成）。
- 背包：同名唯一、原地升档、**删除 `canMergeItems/autoMerge/merge`**、取消 18 格上限。
- 商店：只出货"比持有高一档"的卡；出档概率按层升高、跳级概率低。
- 商人「交换」：同档不同名三选一；价格 0 / 15 / 25 / 40 / 65（×1.6），**同一房间内累计，离开房间重置**；池内无合法目标时置灰不扣钱。
- 验收：一局能拿 1–2 张金卡 + 数张散卡；`npm run smoke` 全绿；旧合成入口完全不可达。

### P0-b 把节奏参数写进 balance.json
按 §2.6 的数值改 `layerCurve` / `difficulties` / `shop`，跑 `node sim/simulate.mjs` 看通关率。目标：普通 35–55%，困难 25–40%。**这只是调参，不改结构。**

### P1 敌人机制（威胁分工）
现状：4 种哥布林共用"追击 + 一招"。需要 5 类原型：远程压制 / 封路 / 冲锋线 / 召唤 / 自爆，每类 1–2 实例，**且必须在无冲刺的前提下可用走位化解**。

### P2 潜能接进战斗
替换 `getWeaponTier` 的 7 级线性与 `awakenings.ts` 的 18 觉醒读取点。接完后才能删除 `weapons` / `awakenings`。

### P3 事件效果补齐
`src/game.ts` 的 `applyEventEffects()` 里标「待接线」的分支：给卡 / buff / debuff / 遭遇战 / 负向治疗。

### P4 招式特效
按 `docs/10-招式特效提示词.md` 做，先丛雨 3 个主招式验证风格。

### P5 场景细节层与功能道具
6 层细节（地砖拼法 / 墙裙 / 边缘堆积 / 地面光斑 / 空气粒子 / 地标逆光）；道具改成"可破坏 / 限制移动"两类，**删除塔藏箱**，其金币产出并回击杀。

### P6 节奏普攻接入
`docs/` 里的节奏分支（睦·节奏）需要 `beatClock` 接进 `tryAttack`：拍点门控 + 伤害倍率 + 节拍环 HUD + 耐力转连击伤害。

---

## 6. 陷阱（踩过的坑）

1. **旧系统还在跑，不能直接删**：`awakenings.ts`（combat 在读）、`balance.json.weapons`（`getWeaponTier`）、`buffCards + maxStacks`、塔藏箱、HUD「专武 7」。**顺序必须是"先接新系统，再拔旧代码"**。
2. **`floor.ts` 里的段落注释 `/* ---- 火把 ---- */` 在 `build()` 内部也有一份**。用文本替换插入方法时极易插进函数体，导致语法错误。改这个文件请用带上下文的精确锚点。
3. **改 `TunnelRoom` 会连带 4 处 `Record<TunnelRoom, …>`**：`roomIcons.ts` 的 `DRAWERS`、`floor.ts` 的 `ROOM_ACCENT`、`roomNpc.ts` 的 `NPC_INFO`、`hud.ts` 的 `ROOM_LABEL`。TS 会逐个报错，按提示补即可。
4. **场景墙体材质曾写死纯白**（`floor.ts:507`），不跟主题色，已修。若再改光照，先确认 wall/floor 都取 `theme.*`。
5. **经济冒烟有分布断言**（奖励类房间子概率 ±6%）。改隧道池权重后要复跑，否则会红。
6. **删冲刺会让难度明显上升**（少了 0.21s 无敌 + 3m 位移）。若玩家反馈太难，优先调 `iFrames` / 敌人单伤 / 同屏上限，不要急着加回冲刺。
7. **无头截图必须先 build**，且服务器进程要在同一条命令里拉起，否则会被回收。

---

## 7. 待用户拍板/未解决

- 风车塔身与地面**对比度偏低**（观感问题）。
- 三场景的"6 层细节"未做，目前只有"亮"，还没有"花庭感"。
- 事件房目前挂在 `reward` 池 5%，用户口径：探索类只是种类名（奖励/事件/游戏三种），**不拆 TunnelType**；「游戏」房间尚未有骨架。
- 记忆碎片**暂时只记录，无作用**（用户：先打通流程，后面补）。
- 流浪商人：固定商店房间，对话分「交易 / 交换」两路；实现在 P0-a 里一起做。

---

## 8. 并行协作：文件所有权（必读）

同一时间可能有两条线在改：云端 agent 做 P0-a（道具），本机做 P0-b（节奏调参）。
**按文件切分，不要越界**；同文件冲突时以本文件 §2 的已锁定决策为准，由 `master` 一侧裁决。

### A 线（云端 · 分支 `feat/cards-v5`）—— 只碰这些
```
src/data/cards.ts          ✅ 完全拥有
src/systems/inventory.ts    ✅ 完全拥有（删合成逻辑）
src/systems/shop.ts         ✅ 完全拥有
src/systems/economy.ts      ✅ 完全拥有（makeCardItem / emptyCards）
src/data/balance.json       ⚠️ 只允许改 "buffCards" 这一段
src/ui/hud.ts               ⚠️ 只允许改背包/商店相关区块（见下）
```
**不要碰**：`src/game.ts`、`src/world/*`、`src/data/stages.ts`、`src/data/potentials.ts`、`src/data/events.ts`、`src/systems/tunnels.ts` 的权重逻辑。
**不要 push master**，只提交到 `feat/cards-v5`，交付 patch 或 PR。

### B 线（本机 · `master`）—— 只碰这些
```
src/data/balance.json       ⚠️ 只改 layerCurve / difficulties / warmup / shop（价格与品质曲线）
src/data/gameConfig.ts      ✅ 完全拥有
src/game.ts                 ✅ 完全拥有（战斗 / 房间 / 事件接线）
src/world/*                 ✅ 完全拥有
src/systems/tunnels.ts      ✅ 完全拥有（房间池与权重）
src/data/stages.ts          ✅ 完全拥有
```

### 共享文件的拆分规则
| 文件 | 规则 |
| --- | --- |
| `src/data/balance.json` | JSON 按 key 切：A 线只改 `buffCards`；B 线只改 `layerCurve / difficulties / warmup / shop`。**两边都在同一个 commit 里改就会冲突，改前先 `git pull --rebase`** |
| `src/ui/hud.ts` | 按区块切：A 线只改背包面板 + 商店面板；B 线只改 HUD 主条 / 隧道面板 / 事件相关 |
| `src/game.ts` | **A 线不动**。如果需要新增接线点，A 线在 PR 描述里写清"需要 B 线在 X 处调用 Y" |
| `sim/*-smoke.mjs` | 各自新增自己的（A：`card-smoke.mjs`；B：已有 beat/potential/event） |

### 合并顺序
1. 先合 **B 线**（纯 JSON 调参，冲突面最小）
2. 再合 **A 线**（分支 rebase 到 master 后解决 `balance.json` 单点冲突）
3. 合并后**必须**跑一次全量：`npx tsc --noEmit && npm run smoke && npm run build`

### 判定冲突对错的依据
按 §2 的执行顺序判断：**道具 = 纯数值、不承载机制**。任何把"触发/条件/联动"塞进卡里的实现，一律按错处理。
````

## 2. src/data/cards.ts（新卡表）

路径：`src/data/cards.ts`

````ts
/**
 * 数值道具卡（原「增益卡」）数据表 —— 落地版 v0（只有数据，未接入商店/背包）。
 *
 * 口径（与现版本最大的差别）：
 * - **一张卡 = 一个名字 + 3 个档位（蓝 / 紫 / 金）**，不再是"同名可叠 N 张 + 二合一"。
 * - 背包内同名卡**只有一张实例**；再拿到同名卡 = 原地升一档。
 * - 池子里永远只出"比当前持有高一档"的那一档；满金后该名字**退出池子**。
 * - 因此卡池会随局内进度自我收窄，天然堵死"堆同一张"。
 * - 出档概率按层数升高，允许跳级（+2 档），但跳级概率要压低。
 *
 * 分工：**道具 = 纯数值，机制全在潜能**。所以这里只有 `stat + tiers`，没有 trigger/condition。
 * 旧 `balance.json` 的 `buffCards`（含 maxStacks）在新系统接入后整体作废。
 */
import type { CardStat } from '../types'

/**
 * 卡的属性键。`hpRegen` 是本次新增的键，尚未并入 `CardStat`——
 * 并入需要同时改 6 处 `Record<CardStat, …>` 字面量和存档校验，
 * 等潜能/道具真正接入战斗时一起做，避免这一版把老存档打挂。
 */
export type ItemCardStat = CardStat | 'hpRegen'

export type CardTier = 'blue' | 'purple' | 'gold'

export const CARD_TIERS: readonly CardTier[] = ['blue', 'purple', 'gold']

export const CARD_TIER_LABEL: Record<CardTier, string> = {
  blue: '蓝',
  purple: '紫',
  gold: '金',
}

export interface ItemCardDef {
  id: string
  name: string
  stat: ItemCardStat
  /** 蓝 / 紫 / 金 三档数值。percent 用百分点存（18 = 18%），flat 存原值 */
  tiers: readonly [number, number, number]
  format: 'percent' | 'flat'
  /** 数值上限（percent 类），超出部分不生效 */
  cap?: number
  /** 词条模板，`{v}` 替换为当前档位数值 */
  text: string
  /** 补充说明（界面小字） */
  note?: string
}

export const ITEM_CARDS: readonly ItemCardDef[] = [
  { id: 'magic', name: '魔力药剂', stat: 'magic', tiers: [18, 36, 66], format: 'percent', text: '伤害 +{v}%' },
  { id: 'stamina', name: '耐力药剂', stat: 'stamina', tiers: [16, 32, 58], format: 'flat', text: '攻速 +{v}' },
  { id: 'intelligence', name: '智力药剂', stat: 'intelligence', tiers: [12, 24, 44], format: 'percent', text: '范围 +{v}%' },
  { id: 'hp', name: '生命结晶', stat: 'hp', tiers: [25, 50, 90], format: 'flat', text: '生命上限 +{v}' },
  { id: 'moveSpeed', name: '疾风之靴', stat: 'moveSpeed', tiers: [0.25, 0.5, 0.9], format: 'flat', text: '移速 +{v}' },
  {
    id: 'armor',
    name: '铁鳞甲片',
    stat: 'armor',
    tiers: [5, 10, 18],
    format: 'percent',
    cap: 35,
    text: '受到伤害 −{v}%',
    note: '上限 35%',
  },
  {
    id: 'dodge',
    name: '疾影护符',
    stat: 'dodge',
    tiers: [6, 12, 22],
    format: 'percent',
    cap: 40,
    text: '闪避率 +{v}%',
    note: '上限 40%',
  },
  { id: 'chargeGain', name: '猎手徽记', stat: 'chargeGain', tiers: [8, 16, 30], format: 'percent', text: '击杀获得充能 +{v}%' },
  {
    id: 'crit',
    name: '锐利符石',
    stat: 'crit',
    tiers: [4, 8, 15],
    format: 'percent',
    cap: 60,
    text: '暴击率 +{v}%',
    note: '基础 8%，暴击伤害固定 ×2.0',
  },
  {
    id: 'hpRegen',
    name: '生命之源',
    stat: 'hpRegen',
    tiers: [2.5, 5, 9],
    format: 'percent',
    text: '每 5 秒回复 {v}% 最大生命',
  },
]

/** 每张卡的可获取档位数量（= 该名字最多被拿到几次） */
export const CARD_MAX_TIER = CARD_TIERS.length

export function cardOf(id: string): ItemCardDef | undefined {
  return ITEM_CARDS.find((c) => c.id === id)
}

/** 取某档数值；tier 越界时收敛到合法范围 */
export function cardValueAt(card: ItemCardDef, tier: CardTier): number {
  const index = Math.max(0, CARD_TIERS.indexOf(tier))
  const value = card.tiers[Math.min(CARD_TIERS.length - 1, index)]
  return typeof card.cap === 'number' ? Math.min(card.cap, value) : value
}

/** 生成带数值的词条文案 */
export function cardTextAt(card: ItemCardDef, tier: CardTier): string {
  return card.text.replace('{v}', String(cardValueAt(card, tier)))
}

/** 下一档；已是金卡返回 null（该名字应退出池子） */
export function nextTier(tier: CardTier): CardTier | null {
  const index = CARD_TIERS.indexOf(tier)
  return index >= 0 && index < CARD_TIERS.length - 1 ? CARD_TIERS[index + 1] : null
}
````

## 3. src/types.ts 摘录

路径：`src/types.ts`

````ts
export type CardStat =
  | 'magic'
  | 'stamina'
  | 'intelligence'
  | 'hp'
  | 'moveSpeed'
  | 'chargeMax'
  | 'chargeGain'
  | 'dodge'
  | 'armor'
  | 'crit'

export interface InventoryItem {
  uid: string
  kind: 'buff-card' | 'consumable'
  name: string
  desc: string
  icon: string
  tier: 1 | 2 | 3
  stat?: CardStat
  /** 该物品提供的数值（进入背包即计入面板，按 tier 已放大） */
  value?: number
}
````

## 4. balance.json 的 buffCards 段（旧表，仅对照）

路径：`src/data/balance.json`

````json
{
  "buffCards": [
    {
      "id": "magic",
      "name": "魔力药剂",
      "stat": "magic",
      "value": 18,
      "basePrice": 55,
      "maxStacks": 17,
      "desc": "魔力 +18（伤害 +18% 基准）"
    },
    {
      "id": "stamina",
      "name": "耐力药剂",
      "stat": "stamina",
      "value": 16,
      "basePrice": 50,
      "maxStacks": 17,
      "desc": "耐力 +16（攻速 +16%）"
    },
    {
      "id": "intelligence",
      "name": "智力药剂",
      "stat": "intelligence",
      "value": 12,
      "basePrice": 40,
      "maxStacks": 14,
      "desc": "智力 +12（范围 +12%）"
    },
    {
      "id": "hp",
      "name": "生命结晶",
      "stat": "hp",
      "value": 25,
      "basePrice": 45,
      "maxStacks": 17,
      "desc": "生命上限 +25 并立即回复"
    },
    {
      "id": "moveSpeed",
      "name": "疾风之靴",
      "stat": "moveSpeed",
      "value": 0.25,
      "basePrice": 40,
      "maxStacks": 14,
      "desc": "移速 +0.25"
    },
    {
      "id": "chargeMax",
      "name": "充能核心",
      "stat": "chargeMax",
      "value": -8,
      "basePrice": 50,
      "maxStacks": 11,
      "desc": "技能所需充能 -8"
    },
    {
      "id": "armor",
      "name": "铁鳞甲片",
      "stat": "armor",
      "value": 0.05,
      "basePrice": 55,
      "maxStacks": 7,
      "desc": "受到的伤害 -5%（上限 35%）"
    },
    {
      "id": "dodge",
      "name": "疾影护符",
      "stat": "dodge",
      "value": 0.06,
      "basePrice": 60,
      "maxStacks": 4,
      "desc": "闪避率 +6%（上限 24%）"
    },
    {
      "id": "chargeGain",
      "name": "猎手徽记",
      "stat": "chargeGain",
      "value": 0.08,
      "basePrice": 45,
      "maxStacks": 8,
      "desc": "击杀获得充能 +8%"
    },
    {
      "id": "critRate",
      "name": "锐利符石",
      "stat": "crit",
      "value": 0.04,
      "basePrice": 60,
      "maxStacks": 6,
      "desc": "暴击率 +4%（上限 60%）"
    }
  ],
  "buffCards_extra_note": "暴击率卡"
}
````

## 5. src/systems/inventory.ts（删合成）

路径：`src/systems/inventory.ts`

````ts
/**
 * 基础 18 格背包：添加 / 丢弃 / 使用 / 合成（同名同级增益卡 → 下一级，数值 ×2）。
 * 容量与合成上限来自数据层：backpack.slots / backpack.maxMergeTier。
 * 纯数据层：不 import three.js、不碰 DOM。卡片面板统一由 `cards` 汇总。
 */
import type { CardStat, InventoryItem } from '../types'
import { BALANCE } from '../data/balance'
import { makeCardItem } from './economy'

interface BackpackCfg {
  slots: number
  maxMergeTier: 1 | 2 | 3
}

const BACKPACK = (BALANCE as unknown as { backpack: BackpackCfg }).backpack
/** 基础背包格数（balance.backpack.slots），HUD 与默认构造函数共用 */
export const DEFAULT_BAG_SLOTS = BACKPACK.slots
const DEFAULT_SLOTS = DEFAULT_BAG_SLOTS
const MAX_MERGE_TIER = BACKPACK.maxMergeTier

function tidy(v: number): number {
  return Number(v.toFixed(3))
}

/**
 * 两张物品能否合成（纯函数，HUD 与数据层共用同一份判定，避免两处规则漂移）。
 * - 增益卡：同 stat、同 tier，且 tier < backpack.maxMergeTier
 * - 消耗品：不合成
 */
export function canMergeItems(a: InventoryItem, b: InventoryItem): boolean {
  if (a.uid === b.uid) return false
  if (a.kind !== b.kind) return false
  if (a.kind !== 'buff-card') return false
  if (!a.stat || a.stat !== b.stat) return false
  if (a.tier !== b.tier) return false
  return a.tier < MAX_MERGE_TIER
}

export class Inventory {
  readonly items: InventoryItem[] = []
  private readonly capacity: number

  constructor(max: number = DEFAULT_SLOTS) {
    this.capacity = Math.max(1, Math.round(max))
  }

  get count(): number {
    return this.items.length
  }

  get isFull(): boolean {
    return this.items.length >= this.capacity
  }

  /** 格子上限（HUD 显示 x/18 用） */
  get maxSlots(): number {
    return this.capacity
  }

  /** 五维汇总：只累计「已进背包」的增益卡（消耗品不进面板） */
  get cards(): Record<CardStat, number> {
    const acc: Record<CardStat, number> = {
      magic: 0,
      stamina: 0,
      intelligence: 0,
      hp: 0,
      moveSpeed: 0,
      chargeMax: 0,
      chargeGain: 0,
      dodge: 0,
      armor: 0,
      crit: 0,
    }
    for (const item of this.items) {
      if (item.kind !== 'buff-card' || !item.stat) continue
      if (typeof item.value !== 'number') continue
      acc[item.stat] = tidy(acc[item.stat] + item.value)
    }
    return acc
  }

  get(uid: string): InventoryItem | undefined {
    return this.items.find((it) => it.uid === uid)
  }

  add(item: InventoryItem): boolean {
    if (this.isFull) return false
    this.items.push(item)
    return true
  }

  /**
   * 购买/拾取入口：满包时先把可合成的两张自动合掉腾格子，再尝试放入。
   * @returns 是否成功进包；false 表示满包且没有可合成对（调用方应提示玩家丢弃/合成）
   */
  addOrMerge(item: InventoryItem): boolean {
    if (this.isFull) this.autoMerge()
    return this.add(item)
  }

  /** 丢弃：语义化 remove（丢弃不退金币，金币结算由调用方负责） */
  discard(uid: string): InventoryItem | null {
    return this.remove(uid)
  }

  remove(uid: string): InventoryItem | null {
    const index = this.items.findIndex((it) => it.uid === uid)
    if (index < 0) return null
    const [removed] = this.items.splice(index, 1)
    return removed
  }

  /** 两张同级同种可合成：判定见模块级 canMergeItems（HUD 复用同一份规则） */
  canMerge(uidA: string, uidB: string): boolean {
    const a = this.get(uidA)
    const b = this.get(uidB)
    if (!a || !b) return false
    return canMergeItems(a, b)
  }

  /**
   * 自动合成：反复找出当前可合成的两张（靠前格子优先）并合成，直到没有可合成对。
   * 每次合成净减少 1 格，所以循环上限取当前格数即可保证不死循环。
   * @returns 本次合成出的物品（按合成顺序，供上层提示/同步面板）
   */
  autoMerge(): InventoryItem[] {
    const merged: InventoryItem[] = []
    const guardLimit = this.items.length
    for (let guard = 0; guard < guardLimit; guard += 1) {
      const pair = this.findMergePair()
      if (!pair) break
      const item = this.merge(pair[0], pair[1])
      if (!item) break
      merged.push(item)
    }
    return merged
  }

  /** 找出第一对可合成的 uid（i<j，靠前格子优先）；没有则返回 null */
  private findMergePair(): [string, string] | null {
    for (let i = 0; i < this.items.length; i += 1) {
      for (let j = i + 1; j < this.items.length; j += 1) {
        if (canMergeItems(this.items[i], this.items[j])) {
          return [this.items[i].uid, this.items[j].uid]
        }
      }
    }
    return null
  }

  /** 合成：消耗两张增益卡，在靠前格子生成下一级；数值按「同名同级两份 → ×2」结算 */
  merge(uidA: string, uidB: string): InventoryItem | null {
    if (!this.canMerge(uidA, uidB)) return null
    const a = this.get(uidA)
    if (!a) return null
    const index = Math.min(
      this.items.findIndex((it) => it.uid === uidA),
      this.items.findIndex((it) => it.uid === uidB),
    )

    let merged: InventoryItem | null = null
    if (a.kind === 'buff-card') {
      const nextTier = Math.min(MAX_MERGE_TIER, a.tier + 1) as 1 | 2 | 3
      merged = makeCardItem(a.stat ?? '', nextTier)
      merged.value = tidy((a.value ?? 0) * 2)
    }
    if (!merged) return null

    this.remove(uidA)
    this.remove(uidB)
    this.items.splice(index, 0, merged)
    return merged
  }

  /** 使用消耗品：从背包移除并返回该物品，具体生效（回血/回充能）由 game.ts 结算 */
  use(uid: string): InventoryItem | null {
    const item = this.get(uid)
    if (!item || item.kind !== 'consumable') return null
    this.remove(uid)
    return item
  }
}
````

## 6. src/systems/shop.ts

路径：`src/systems/shop.ts`

````ts
/**
 * 商店（4 格）：1 格角色专武升级（当前等级 +1）+ 1 格金币训练
 * + 2~3 张增益卡/消耗品。金币训练直接写入 RunState.training，不占背包，
 * 每次购买后按 priceGrowth 涨价，给后期金币提供持续提升渠道。
 * 品质与增价随层数上涨（rollQuality / shopPriceFor），重掷 25 金。
 * 纯数据层：不 import three.js、不碰 DOM；随机走传入的 Rng。
 */
import type { CardStat, CharacterId, ShopOffer } from '../types'
import type { Rng } from '../core/rng'
import { BALANCE } from '../data/balance'
import { MAX_WEAPON_LV } from '../data/characterRuntime'
import { makeCardItem, priceOf, qualityFor } from './economy'

interface BuffCardLite {
  id: string
  name: string
  stat: CardStat
  basePrice: number
}

interface ConsumableCfg {
  name: string
  price: number
  healRatio?: number
  desc: string
}

interface TrainingStatCfg {
  stat: CardStat
  name: string
  value: number
}

interface TrainingCfg {
  basePrice: number
  priceGrowth: number
  layerGrowth: number
  valueGrowth: number
  stats: TrainingStatCfg[]
}

interface ShopCfg {
  slots: number
  priceGrowthPerLayer: number
  rerollCost: number
  training: TrainingCfg
  consumables: { heal: ConsumableCfg; charge: ConsumableCfg }
}

interface WeaponLite {
  name: string
  tiers: { lv: number; desc: string; price?: number }[]
}

const SHOP = (BALANCE as unknown as { shop: ShopCfg }).shop
const BUFF_CARDS = (BALANCE as unknown as { buffCards: BuffCardLite[] }).buffCards
const WEAPONS = (BALANCE as unknown as { weapons: Record<CharacterId, WeaponLite> }).weapons

/** 商店重掷费用（balance.shop.rerollCost） */
export const REFRESH_COST: number = SHOP.rerollCost

/** 2 张增益卡保底后，后续格子按此概率出消耗品 */
const CONSUMABLE_CHANCE = 0.35
const CONSUMABLE_SLOTS = 2

function clampLayer(layer: number): number {
  return Math.max(1, Math.round(layer))
}

function rollPrice(base: number, layer: number, qualityMul = 1): number {
  return priceOf(base, clampLayer(layer), qualityMul)
}

const TRAINING = SHOP.training

function tidy(value: number): number {
  return Number(value.toFixed(3))
}

function formatTrainingValue(stat: CardStat, value: number): string {
  if (stat === 'armor' || stat === 'dodge' || stat === 'chargeGain' || stat === 'crit') {
    return `${(value * 100).toFixed(1)}%`
  }
  if (stat === 'moveSpeed') return value.toFixed(2)
  return String(Math.round(value))
}

/** 金币训练价格：层数越深基础价越高，购买次数越多越贵。 */
export function trainingPriceFor(layer: number, buys: number): number {
  const n = Math.max(0, Math.round(buys))
  const base = TRAINING.basePrice * (1 + TRAINING.layerGrowth * (clampLayer(layer) - 1))
  return Math.max(1, Math.round(base * Math.pow(TRAINING.priceGrowth, n)))
}

/** 金币训练的永久属性成长；同一次商店内重复购买价格会涨，但单次收益固定。 */
function makeTrainingOffer(layer: number, rng: Rng, seq: number, buys: number): ShopOffer | null {
  if (!TRAINING.stats || TRAINING.stats.length === 0) return null
  const def = rng.pick(TRAINING.stats)
  const value = tidy(def.value * (1 + TRAINING.valueGrowth * (clampLayer(layer) - 1)))
  const label = def.name.replace('特训', '')
  return {
    id: `training-${seq}-${def.stat}`,
    kind: 'training',
    name: `${def.name} +${formatTrainingValue(def.stat, value)}`,
    desc: `永久 ${label} +${formatTrainingValue(def.stat, value)}，不占背包；可重复购买（已训练 ${buys} 次）`,
    icon: '📈',
    price: trainingPriceFor(layer, buys),
    tier: 1,
    stat: def.stat,
    value,
    repeatable: true,
    trainingLabel: label,
  }
}

function makeWeaponUpgradeOffer(charId: CharacterId, weaponLv: number): ShopOffer | null {
  const current = Math.round(weaponLv)
  const next = current + 1
  if (next > MAX_WEAPON_LV || next < 2) return null
  const weapon = WEAPONS[charId]
  const def = weapon.tiers[next - 1]
  if (!def) return null
  return {
    id: `weapon-${charId}-${next}`,
    kind: 'weapon',
    name: `${weapon.name}·Lv${next}`,
    desc: def.desc,
    icon: '⚔️',
    // 专武价格 = balance.weapons.<char>.tiers[level].price，不随层数涨价
    price: Math.max(1, Math.round(def.price ?? 0)),
    tier: next <= 2 ? 1 : next === 3 ? 2 : 3,
    weaponLevel: next,
  }
}

function makeBuffOffer(layer: number, rng: Rng, seq: number, usedStats: CardStat[]): ShopOffer {
  const fresh = BUFF_CARDS.filter((card) => !usedStats.includes(card.stat))
  const def = rng.pick(fresh.length > 0 ? fresh : BUFF_CARDS)
  const quality = qualityFor(layer, rng)
  const item = makeCardItem(def.id, quality.tier)
  usedStats.push(def.stat)
  return {
    id: `card-${seq}-${def.id}-t${quality.tier}`,
    kind: 'buff-card',
    name: item.name,
    desc: item.desc,
    icon: item.icon,
    price: rollPrice(def.basePrice, layer, quality.priceMul),
    tier: quality.tier,
    stat: item.stat,
    value: item.value,
  }
}

function makeConsumableOffer(layer: number, rng: Rng, seq: number): ShopOffer {
  const kind: 'heal' | 'charge' = rng.chance(0.5) ? 'heal' : 'charge'
  const def = SHOP.consumables[kind]
  const price = rollPrice(def.price, layer)
  if (kind === 'heal') {
    return {
      id: `consumable-${seq}-heal`,
      kind: 'consumable',
      name: def.name,
      desc: def.desc,
      icon: '🧪',
      price,
      tier: 1,
      value: def.healRatio ?? 0.35,
    }
  }
  return {
    id: `consumable-${seq}-charge`,
    kind: 'consumable',
    name: def.name,
    desc: def.desc,
    icon: '🔋',
    price,
    tier: 1,
    value: 1,
  }
}

/**
 * 生成货架。gold 不筛货（只用于 HUD 是否买得起）；weaponLv 为角色当前专武等级，
 * 传入后专武升级 = 当前等级 +1（不传按 1 级算）。
 * trainingBuys 为已购买训练次数，用于金币训练的累计涨价。
 */
export function generateOffers(
  layer: number,
  charId: CharacterId,
  gold: number,
  rng: Rng,
  count: number = SHOP.slots,
  weaponLv = 1,
  trainingBuys = 0,
): ShopOffer[] {
  void gold
  const total = Math.max(0, Math.round(count))
  const offers: ShopOffer[] = []
  if (total === 0) return offers

  const weaponOffer = makeWeaponUpgradeOffer(charId, weaponLv)
  if (weaponOffer) offers.push(weaponOffer)

  // 固定塞一格金币训练：不占背包，是后期金币的主要去向。
  const trainingOffer = makeTrainingOffer(clampLayer(layer), rng, offers.length, trainingBuys)
  if (trainingOffer && offers.length < total) offers.push(trainingOffer)

  const usedStats: CardStat[] = []
  while (offers.length < total) {
    const cardCount = offers.filter((offer) => offer.kind === 'buff-card').length
    const useConsumable = cardCount >= CONSUMABLE_SLOTS && rng.chance(CONSUMABLE_CHANCE)
    offers.push(
      useConsumable
        ? makeConsumableOffer(clampLayer(layer), rng, offers.length)
        : makeBuffOffer(clampLayer(layer), rng, offers.length, usedStats),
    )
  }
  return offers
}

/** 花 25 金重掷整架（调用方负责扣钱） */
export function refreshOffers(
  layer: number,
  charId: CharacterId,
  rng: Rng,
  weaponLv = 1,
  trainingBuys = 0,
): ShopOffer[] {
  return generateOffers(layer, charId, 0, rng, SHOP.slots, weaponLv, trainingBuys)
}
````

## 7. src/systems/economy.ts

路径：`src/systems/economy.ts`

````ts
/**
 * 经济纯数据层（v3）：击杀/通关金币、品质与定价、背包物品生成、五维汇总。
 * 不 import three.js、不碰 DOM；所有随机数走传入的 Rng（可复现）。
 * 数值只从 balance.json（经 balance.ts 访问器）与 characters.ts 读。
 */
import type { CardStat, CharacterId, DifficultyId, InventoryItem } from '../types'
import type { Rng } from '../core/rng'
import type { QualityRoll } from '../data/balance'
import { BALANCE, clearGoldFor, goldPerKillFor, rollQuality, shopPriceFor } from '../data/balance'
import { CHARACTERS, GOLD_PER_KILL } from '../data/characters'

// ── balance.json 里 balance.ts 尚未声明类型的段落（本模块只读，不改数据）──
interface BuffCardDef {
  id: string
  name: string
  stat: CardStat
  value: number
  basePrice: number
  maxStacks: number
  desc: string
}

interface QualityCfg {
  tier2: { valueMul: number; priceMul: number; name: string }
  tier3: { valueMul: number; priceMul: number; name: string }
}

interface EconomyData {
  buffCards: BuffCardDef[]
  shop: { quality: QualityCfg; slots: number; priceGrowthPerLayer: number }
}

const DATA = BALANCE as unknown as EconomyData
const BUFF_CARDS = DATA.buffCards
const QUALITY = DATA.shop.quality

const CARD_ICONS: Record<CardStat, string> = {
  magic: '✨',
  stamina: '⚡',
  intelligence: '🧠',
  hp: '❤️',
  moveSpeed: '👟',
  chargeMax: '🔋',
  chargeGain: '🎯',
  dodge: '💨',
  armor: '🛡️',
  crit: '💥',
}

let uidSeq = 0
/** uid 只用于背包寻址，不参与数值；时间戳前缀防读档后与旧 uid 撞车 */
function nextUid(): string {
  uidSeq += 1
  return `it-${Date.now().toString(36)}-${uidSeq}`
}

/** 保留 3 位小数，避免 0.25*1.9=0.47500000000000003 这类浮点噪声进存档 */
function tidy(v: number): number {
  return Number(v.toFixed(3))
}

function tierValueMul(tier: 1 | 2 | 3): number {
  if (tier === 2) return QUALITY.tier2.valueMul
  if (tier === 3) return QUALITY.tier3.valueMul
  return 1
}

function tierLabel(tier: 1 | 2 | 3): string {
  if (tier === 2) return QUALITY.tier2.name
  if (tier === 3) return QUALITY.tier3.name
  return ''
}

function cardDefOf(cardId: string): BuffCardDef {
  return (
    BUFF_CARDS.find((c) => c.id === cardId) ??
    BUFF_CARDS.find((c) => c.stat === cardId) ??
    BUFF_CARDS[0]
  )
}

/** 单只敌人的击杀金币：本层基准 × GOLD_PER_KILL 比例（small=1 为基准） */
export function killGold(layer: number, kind: 'small' | 'brute' | 'elite' | 'boss'): number {
  const base = goldPerKillFor(Math.max(1, Math.round(layer)))
  const ratio = GOLD_PER_KILL[kind] / GOLD_PER_KILL.small
  return Math.max(1, Math.round(base * ratio))
}

/** 本层通关奖励金币（含难度 goldMul，由 balance.clearGoldFor 提供） */
export function clearGold(id: DifficultyId, layer: number): number {
  return clearGoldFor(id, Math.max(1, Math.round(layer)))
}

/** 商店/掉落品质：层数越深越容易出精制(tier2)/臻品(tier3) */
export function qualityFor(layer: number, rng: Rng): QualityRoll {
  return rollQuality(Math.max(1, Math.round(layer)), () => rng.next())
}

/** 实际价格 = 基准价 × (1 + 每层涨幅 × (层 - 1)) × 品质倍率（保底 1 金） */
export function priceOf(base: number, layer: number, qualityMul = 1): number {
  return Math.max(1, shopPriceFor(base, Math.max(1, Math.round(layer)), qualityMul))
}

/** 背包满时奖励卡的折价：当前层商店价的一半，至少 1 金 */
export function salvageGold(item: InventoryItem, layer: number): number {
  if (item.kind !== 'buff-card') return 1
  const def = cardDefOf(item.stat ?? '')
  const qualityMul =
    item.tier === 2 ? QUALITY.tier2.priceMul : item.tier === 3 ? QUALITY.tier3.priceMul : 1
  return Math.max(1, Math.round(priceOf(def.basePrice, layer, qualityMul) * 0.5))
}

/** 增益卡物品：value 已按品质档放大（tier 倍率见 balance.shop.quality.*.valueMul） */
export function makeCardItem(cardId: string, tier: 1 | 2 | 3): InventoryItem {
  const def = cardDefOf(cardId)
  const label = tierLabel(tier)
  return {
    uid: nextUid(),
    kind: 'buff-card',
    name: label ? `${label}${def.name}` : def.name,
    desc: def.desc,
    icon: CARD_ICONS[def.stat] ?? '🎴',
    tier,
    stat: def.stat,
    value: tidy(def.value * tierValueMul(tier)),
  }
}

/** 卡片进/出背包时增减五维（dir=-1 为取出/合成消耗） */
export function applyItemToCards(
  cards: Record<CardStat, number>,
  item: InventoryItem,
  dir: 1 | -1,
): void {
  if (item.kind !== 'buff-card' || !item.stat || typeof item.value !== 'number') return
  cards[item.stat] = tidy((cards[item.stat] ?? 0) + item.value * dir)
}

export function emptyCards(): Record<CardStat, number> {
  return {
    magic: 0,
    stamina: 0,
    intelligence: 0,
    hp: 0,
    moveSpeed: 0,
    chargeMax: 0,
    chargeGain: 0,
    dodge: 0,
    armor: 0,
    crit: 0,
  }
}

/** 生命上限 = 角色基础生命 + 所有生命结晶累计 */
export function recomputeMaxHp(charId: CharacterId, cards: Record<CardStat, number>): number {
  return Math.max(1, Math.round(CHARACTERS[charId].base.hp + (cards.hp ?? 0)))
}
````

## 8. 调用点清单（全仓 grep）

| 符号 | 位置 | 处理 |
| --- | --- | --- |
| `canMergeItems` | `inventory.ts`、`ui/hud.ts` | 删除导出 + HUD 调用 |
| `autoMerge` / `merge` | `inventory.ts` | 删除 |
| `maxMergeTier` / `DEFAULT_BAG_SLOTS` | `inventory.ts`、`ui/hud.ts` | 删除（不限格） |
| `isFull` / `maxSlots` | `ui/hud.ts` 背包面板 | 改为「已持有 N 张」 |
| `makeCardItem` | `economy.ts`（被 game/tunnels 调用） | 保留同名函数，内部改从 `cards.ts` 取三档值 |
| `tierValueMul` | `economy.ts` | 删除；`qualityFor` 保留给出档概率用 |
| `buffCards` | `shop.ts` / `tunnels.ts` / `game.ts` | 本任务只改 `shop.ts`；**tunnels/game 属 B 线，不要动** |

> `ui/hud.ts` 只允许改背包 / 商店两个区块；`src/game.ts`、`src/systems/tunnels.ts` 一律不动。
