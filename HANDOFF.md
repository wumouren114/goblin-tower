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

### 2.2b 战斗关的产出（2026-11 拍板）

- **取消「清层三选一增益卡」**（`openBonusCards` 已删）。清完一层直接进隧道。
- 战斗关的产出全部走隧道类型：**道具关 / 潜能关 / 金币关**。旧的三选一界面不再出现。
- 旧觉醒（3/6/9 层的二选一）**暂时保留**，等潜能关接通后由潜能取代。

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

### 2.9 敌人（2026-11 拍板）

- **五类威胁原型**：远程压制 / 封路 / 冲锋线 / 召唤 / 自爆。**不加**治疗型、护盾型。
- **「封路」的实现**：由**魔法类小怪施放持续伤害区域**来封路，不做可破坏路障、不靠体型堵塞。场地保持平坦。
- **需要新外观**：五类怪各自要有独立造型，不能只靠哥布林换色。
- **精英 / Boss**：精英 = 原型强化版（同一套行为 + 额外词条）；Boss = **专属招式，不走原型框架**。

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
