# Gemini 任务分工书 · 残响高塔（基于 `docs/21-试玩评估报告.md`）

> 结论来源：真引擎 18 局矩阵（4 轮复测共 72 局）+ 实机数值探针 + 源码审查。
> 本文件是**给 Gemini 执行用的任务书**：每张卡都写清了改哪里、验收标准、复现命令、禁区。
> 仓库：`goblin-tower`（master 基线 `34923b0`）。**禁止直接 push master**，一律 `fix/*` 分支 + PR。

---

## 0. 开工前必读

```bash
npm install
npx tsc --noEmit          # 类型门槛
npm run smoke             # 18 套冒烟（当前全绿）
npm run build             # 产物 dist/
node sim/playtest-matrix.mjs --shots   # 18 局真引擎试玩（约 6–10 分钟，写 sim/playtest-matrix.json）
node sim/playtest-analyze.mjs          # 结果聚合表
```

**环境坑（必看）**
| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `vite build` 报 `spawn EPERM` | 工作区路径含中文，Vite 在 Windows 上会 `exec` 探测真实路径 | 用 ASCII 目录做 junction（`New-Item -ItemType Junction`）后在里面跑；或直接在非中文路径 clone |
| 无头浏览器直接崩溃（`mojo platform_channel Check failed`） | 文件沙箱拦截 Edge 的 IPC | 试玩脚本需要**非受限沙箱**运行；本机验证通过 |
| `sim/simulate.mjs`、`sim/full-matrix-smoke.mjs` 崩溃 | `balance.weapons` 段已被删除（专武退役），脚本未同步 | **G6 修**；在修好之前不要拿它们当平衡基线 |
| `src/game.ts`、`src/main.ts` 是 CRLF | 历史原因 | 改动时保留原换行符，避免整文件 diff |

**文件归属（`HANDOFF.md` §4）**
- 主线（高冲突，串行改）：`src/game.ts`、`src/main.ts`、`src/systems/{combat,projectiles,tunnels,shop,inventory,saveLoad}.ts`、`src/ui/*`、`src/types.ts`、`src/data/balance.json`
- 外包线（低冲突，可并行）：`src/art/*`、`src/entities/{boss,roomNpc}.ts`、`src/minigames/*`、`src/data/{potentials,events,trials,altar,enemyArchetypes}.ts`、`src/systems/{bounce,characterFx}.ts`、`scripts/*`、`sim/*`、`docs/*`、`HANDOFF.md`

**禁区（已拍板的决策，不许"顺手优化"）**
1. 潜能系统：3 角色 × 3 分支 × 3 节点；`maxBranches = 1`、`resonancesEnabled = false` 是**故意的下线态**，不要恢复多分支。
2. 专武系统（`weapons`）已**彻底删除**，不要以任何形式加回来（商店、存档、UI 都不要）。
3. 背包**不限格**、**无合成**（同名唯一 → 升档 → 满金退池）；不要恢复 18 格/合成。
4. 已删除 Shift 冲刺；暴击倍率固定 ×2.0；受击无敌 0.3s。
5. 交互统一：场景用 `E`/`Enter`，`Q`/`F` 是角色通用动作，不要新增战斗按键。

---

## 1. 里程碑与并行波次

```
Wave 0（并行，均不碰 game.ts / hud.ts 热区）
  G6 工具链修复（sim/*）        G7 流程回归测试（sim/* 新增）
  G5 文档同步（docs + README）  G3 HUD 布局可并行（只动 ui/ + styles.css）
        │
        ▼
Wave 1（串行，主线 game.ts，一次只做一张卡；G1 已完成，从 G2 开始）
  G1 恢复每层流程  ✅ 已完成（主线）
   ↓
  G2 数值接线三处（充能/闪避/爆破手）
   ↓
  G3 Boss 战可读性（出生点 + 镜头）
   ↓
  G4 标准商店  ⛔ 已取消（交易只在流浪商人房/祭坛）
        │
        ▼
Wave 2（依赖 G1+G7）
  G8 难度复测与调参（简单/普通/困难）
  G9 终验：tsc + smoke + build + 18 局矩阵 + 报告
```

> 一句话给 Gemini：**先修 P0（G1），再动任何数值**。现在所有平衡数据都是在"缺 90% 战斗层"的前提下测出来的，先调参等于把尺子画在橡皮筋上。
>
> **进度更新（已由主线完成）**：`G1` ✅ 已修（`advanceToNextLayer` 恢复 `enterLayer(next)`）；
> 修复过程中还发现并修掉了它暴露的第二个软锁 `G1b`（眩晕永不过期 + 眩晕中的尸体不剔除 → 整层无法清空）。
> 两处改动都在 `src/game.ts`，详见 `docs/21-试玩评估报告.md` §10。
> **当前可直接开工：G2（数值接线）、G3（Boss 可见性）、G7 收尾、G8（已可用修复后基线调参）。G4 已按产品口径取消。**

---

## 2. 任务卡

### G1 ✅ 恢复每层流程（已完成，主线）

**问题**：`advanceToNextLayer()` 只做了「层数 +1 + 开三扇门」，不再重建楼层。结果：
- 18/18 局只有第 1 层有层内清怪；（简单 31 只 / 普通困难 45 只，40–54 秒）
- 9 套场景只用得到第 1 层那套；Boss 层不再先清 60% 小怪；单局 2–4 分钟。

**定位**：`src/game.ts:3440 advanceToNextLayer()`；回归提交 `0211f23`（把 `this.enterLayer(next)` 换成了 `run.layer = next; pushSnapshot(); openTunnels()`）。

**目标改法（参考旧实现，`git show 0211f23^:src/game.ts`）**：

```ts
// advanceToNextLayer() 末尾
const next = this.run.layer + 1
if (next > layerCount(this.run.difficulty)) { this.win(); return }
this.enterLayer(next)        // ← 恢复：重建 TowerFloor / 配额 / BGM / 场景
```

同时检查这三处联动，别静默回归：
1. `enterLayer()` 会 `cleanupFloor()` + 建新 `TowerFloor` + 设 `sceneName` + `layerTotal = quotaFor(...)` + Boss 层 ×0.6（`game.ts:512-594`）。
2. `openPostClearFlow()`（`game.ts:2353`）保持现状：清层后 第 1 层潜能 → 之后三扇门；**不要**在 enterLayer 里再开一次门。
3. `leaveRoomMap()`（`game.ts:3194`）→ `advanceToNextLayer()` 这条链恢复后等于「房间出口 → 下一层战斗」，符合 README 的循环。

**验收（必须逐条给出数据）**
| 项 | 标准 |
| --- | --- |
| 每局配额战斗层数 | = 总层数 − Boss 层数：简单 8、普通 14、困难 15 |
| Boss 层配额 | = `round(quotaFor(diff, layer) × 0.6)`（普通 L7 = 63、困难 L6 = 57） |
| 场景切换 | 普通 L1–L7 云上花庭 / L8–L16 星砂观星台；困难 L13+ 黄铜钟塔（`run.sceneName` 要跟着变） |
| 单局时长 | 回到 8–12 分钟量级（游戏内时间），不再出现 2 分钟通关 |
| 存档/重试 | `retryLayer()` 仍能回到本层开局（`layerSnapshot` 应在每层进层时刷新） |
| 无回归 | `npm run smoke`、`npx tsc --noEmit`、`npm run build` 全绿；`?autostart=` 调试入口仍可用 |

**复现/验证**：
```bash
node sim/playtest-matrix.mjs --assert-flow --maxsec 120   # 修复前：FAIL（3/3 红）→ 修复后：PASS
node sim/playtest-matrix.mjs                              # 全 18 局数据，看配额战斗层数
node sim/playtest-analyze.mjs                             # 聚合表
```
对照基线：`sim/baseline-head.json`（HEAD 的三难度通关率/到达层/时长/承伤/每局配额战斗层数）。

**风险**：这是全项目最大的一处流程改动。建议**先只提交 G1**，跑通 18 局再叠加其它改动。若发现"选门即进层"是产品侧有意为之（`0211f23` 的 commit message 这么写），**先停下来找产品确认**，不要自行折中。

---

### G1b ✅ 眩晕软锁（修复 G1 时新发现，已完成，主线）

**现象**：G1 修好后第 4~5 层必然卡死——游戏时间跑到 1700~31000 秒都不过层，`layerKilled` 已超配额、`goblins` 里只剩尸体、玩家满血站着。

**根因两处（缺一不可）**
1. `src/systems/statusEffects.ts:120` 有 `StatusField.update(dtMs)`，但 `game.ts` **从未调用** → `stun` 永不过期，敌人永久冻结；
2. `src/game.ts:1680` 的 `updateEnemies` 先判 `stun` 就 `continue`，而尸体剔除在 `1959` → **死在眩晕里的敌人永远剔除不了**，`goblins.length` 卡在非 0，`checkLayerClear()` 永远不成立。

**改动（已落地）**
- `updatePlaying()` 每帧 `this.statusField.update(dt * 1000)`；
- `updateEnemies()` 把「`!g.alive` → 推进死亡动画 → `canRemove` 剔除」提到 stun 分支之前。

**给 Gemini 的收尾任务**：给 `sim/status-smoke.mjs` 补断言——
`stun` 到期后 `has()` 必须为 `false`；`updateEnemies` 的剔除逻辑不受 `stun` 影响（可用纯函数级抽象或一行源码断言防止回归）。

---

### G2 🟠 数值接线三处（小改动，高确定性）

三个独立 bug，可以放在一个 PR，但**必须在 G1 合并后再 rebase**（同文件 `game.ts`）。

| # | 问题 | 位置 | 改法 | 验收 |
| --- | --- | --- | --- | --- |
| 2a | 充能上限双重取反：`branch === 'shunshan'` 永远不命中（真实 id 是 `murasame-shunshan`），而 `mutsumi-duet` 被 `×0.8`、`combat.ts` 又 `×1.2` | `game.ts:3607-3612`、`combat.ts:315-317` | 让"分支代价"只在**一处**生效：建议 game 层不再乘系数，统一由 `combat.effectiveChargeMax()` 表达（duet ×1.2、shunshan ×0.85）；或两处都改对但只保留一次乘算 | 睦·双重人格：技能需求 = 120（原 100 ×1.2）；丛雨·瞬闪：技能需求 = 68（80×0.85） |
| 2b | 闪避硬截断 24%，与卡面 40% 上限冲突 | `game.ts:3616` vs `cards.ts:71` | 上限统一为数据源（建议 `Math.min(capFromCards, ...)` 读 `cards.ts` 的 cap） | 装备金·疾影护符（+22%）+ 训练 0.008×N 后，面板闪避可超过 24%，封顶 40% |
| 2c | 爆破手永不进常规层（`bomberChance + blockerChance` 合并进 `kind='blocker'`） | `game.ts:1477` | 拆成两个独立分支：`bomber` 落在自己的区间 | 常规层（`layer>=3`）500 只抽样里 `bomber` 占比 ≈ 5–16%，`blocker` 回到 4–14% |

**验收**：`npm run smoke`（含 `enemy-smoke` / `balance-compensation-smoke`）+ 新增单测（见 G7）+ 18 局矩阵无 NaN/无异常。

---

### G3 🟠 Boss 战可读性（P1）

**问题**：首领房 Boss 生成在 `(0, -halfSize×0.42)`（`game.ts:3254`），玩家在房间南侧入口、镜头跟玩家 → **Boss 被顶到屏幕最上沿之外**，只看得见血条。证据截图：`shots/playtest/murasame-hard-1-11-playing_boss_fight_boss.png`。

**目标**：玩家进首领房的第一帧就能看见 Boss 本体。
- 方案 A（推荐，最小改动）：`startRoomBossBattle()` 把 Boss 放到 `(0, -halfSize*0.18)` 或房间中心偏北 3–4m，同时把玩家放到 `(0, halfSize*0.42)`；
- 方案 B：保留位置，进场时 `rig` 做一次 0.6s 的镜头推近/抬高（`systems/cameraRig.ts`），并把 Boss 血条移出层横幅区域。

**验收**：截图里 Boss 立绘完整可见、血条不与「第 N 层」横幅重叠；`npm run build` 通过；`preview-boss.mjs` 三态截图不退化。

**注意**：`entities/boss.ts` 属外包线，`game.ts` 属主线；**只改 `game.ts` 的生成坐标 + cameraRig**，不要动 Boss 招式数值。

---

### G4 ⛔ 已取消：交易只在流浪商人房/祭坛（产品已定）

**结论：不要加「每层固定标准商店」。** 现有设计就是「商店 = 一扇交易类门（流浪商人房）+ 祭坛」，房间货架收起后回房间、走出口裂隙进下一层（`leaveRoomMap` 的注释写得很明确：*"商店是一扇独立的门（交易类），房里不再强制接一段标准商店"*）。

**所以 G4 从任务单撤下**，`proceedToShop()` 保持现状（只剩调试入口/兜底）。

**那"金币溢出"怎么治？** 不是加商店，而是在既有交易口内部调：
1. 商人房货架从 4 格扩到 5–6 格、或提高「金币训练」在货架里的出现率（`shop.ts` 的出货权重）；
2. 训练价格曲线（`balance.json.shop.training.priceGrowth / layerGrowth`）——后期钱多就让它更贵；
3. 祭坛/考验的代价与收益（`altar.ts` / `trials.ts`）承接一部分金币；
4. 或者**接受溢出**：把金币当成分数/结算指标（当前失败/通关页已经显示金币）。

> 建议先做 1+2（改 `shop.ts` 权重与 `balance.json` 两三个数字即可），不要动流程。

---

### G5 🟡 文案与文档同步（可并行，不碰逻辑）

| 文件 | 改什么 |
| --- | --- |
| `src/data/balance.json` | 三个难度的 `note` 与其 `stages` 对齐（现在是「一层 7 层 / 两阶段 5+7 / 三阶段 5+5+5」，实际 `[9] / [7,9] / [6,6,6]`）。**只改 note，不改 stages**（stages 由 G8 统一调） |
| `src/ui/hud.ts:533` | 标题副标「一局约 8–12 分钟」改为按实测或去掉；难度卡描述建议由 `stages` 生成，别再手写 |
| `README.md` | 删/改：专武 7 级、18 格背包+合成、Shift 冲刺、每层清怪、8–12 分钟、暴击 ×1.8（代码是 ×2.0） |
| `HANDOFF.md` §2.4 / §2.5 | 层数改 9/16/18；补一句「层内清怪在 G1 合并后恢复」 |
| `src/game.ts:3490-3497` | 「背包已满，折算金币」→「该卡已满金，折算 X 金币」 |

**验收**：文案与实机一致（用 `?autostart=normal&debug=1` 看 HUD 层数/时长，与标题页对比）；`npx tsc --noEmit` 通过。

---

### G6 🟡 工具链修复（可并行，只动 `sim/*`）

现状：`balance.weapons` 删除后两个脚本直接崩：
- `sim/simulate.mjs:76` `WEAPONS[st.charId].tiers[...]` → TypeError
- `sim/full-matrix-smoke.mjs:74` 同因 → TypeError

**任务**
1. 二选一：**修**（把专武档位相关逻辑替换为 v5 的「无专武」口径，伤害/范围直接取 `characters.ts` 基础值）或**明确退役**（脚本开头打印 `DEPRECATED: 专武已删除，请用 sim/playtest-matrix.mjs`，并同步 README）。
2. 修好后跑一次，把结果与 `docs/21-试玩评估报告.md` 的实测数据对照——若两者差距 >20%，说明公式模型已经跟实机脱节，在脚本头注释里写明"仅供参考"。
3. `package.json` 的 `smoke` 若不包含这两个脚本，考虑加一条 `smoke:sim` 或删除 README 里的调用指引。

**验收**：`node sim/simulate.mjs --runs 50` 与 `node sim/full-matrix-smoke.mjs` 都能跑完（或明确 deprecated 且 README 不再让人跑）。

---

### G7 🟠 流程回归测试（**断言已内置，当前为红**）

**现状**：`node sim/playtest-matrix.mjs --assert-flow` 已实现流程断言，在 HEAD 上**红**（已存档 `sim/flow-baseline.json`）：

```
FAIL  mutsumi-normal-1  到达 L11  配额战斗层 1/10 [L1]  Boss层: L7 缺失/63  场景: L8~L11 仍是「云上花庭 · 风起」
FAIL  murasame-normal-1 到达 L 8  配额战斗层 1/7  [L1]  Boss层: L7 缺失/63  场景: L8 仍是「云上花庭 · 晨光」
FAIL  fish-normal-1     到达 L 9  配额战斗层 1/8  [L1]  Boss层: L7 缺失/63  场景: L8~L9 仍是「云上花庭 · 晨光」
流程断言：0/3 通过，3 失败 → exit 1
```

**G7 只剩收尾工作**：
1. 把 `--assert-flow` 抽成独立脚本 `sim/flow-smoke.mjs`（或直接在 CI 里调它），加进 `package.json` 的 `smoke:flow`；
2. 断言项已覆盖：每层配额战斗、Boss 层 `round(quota×0.6)`、`sceneName` 随阶段切换；
3. 建议再加一条：`retryLayer()` 后回到本层开局快照（可参考 `?saveloop=1` 的走法）。

**验收**：G1 修复后同命令 **PASS 且 exit 0**；把红→绿的两次输出都贴进 PR。

---

### G8 🟠 难度复测与调参（依赖 G1+G7，不建议先做）

G1 之后重新跑 18 局（建议 3 轮：`--out sim/run-a.json` 等，看方差），按以下**判定线**调 `balance.json`：

| 难度 | 目标通关率（自动机口径） | 当前（G1 之前） | 主要问题 |
| --- | --- | --- | --- |
| 简单 | 90–100%，单局 6–10 分钟 | 100%，2 分钟 | 太短、太软 |
| 普通 | 45–65% | 0–33% | 首个 Boss + 中后期怪潮房磨死 |
| 困难 | 15–30% | 0% | L4–L6 暴毙，成长（潜能节点）不够 |

**只允许动**：`balance.json`（`layerCurve` / `warmup` / `difficulties.*Mul` / `portals`）；**不要**动角色基础值（`characters.ts` 属数值基准，动它等于同时改三个难度）。

**调参建议顺序**：
1. 先给「普通/困难的成长兜底」：首个 Boss 前保底第 2 个潜能节点（战斗门潜能权重或商店节点价格），或进 Boss 前强制一次营地/药水；
2. 再动 `mobDamagePerLayer` / `bossHpPerLayer`：困难当前 L1 小兵伤害 5.0（简单 1.0），而若叶睦/大肥鱼只有 110 HP；
3. 最后才考虑削 Boss。

**验收**：3 轮 × 18 局矩阵数据 + 一张「难度 × 通关率 / 平均到达层 / 平均时长 / 平均承伤」表，写进 `docs/21-试玩评估报告.md` 的更新版或新文件。

---

### G9 🟡 终验（最后执行，独立 Agent 最好）

按顺序跑，任何一步红就退回对应任务卡：
```bash
npx tsc --noEmit
npm run smoke
npm run build
node sim/flow-smoke.mjs            # G7 新增
node sim/playtest-matrix.mjs --shots
node sim/playtest-analyze.mjs
node sim/probe-game.mjs --doors 120
node scripts/check-audio.mjs       # 36/36
```
然后人工看 6 张截图：标题页、潜能页、怪潮房、商人房/商店、Boss 战、结算页。
**输出**：一份「修复前后对照表」（通关率/平均到达层/时长/承伤/每局配额战层数）+ 剩余问题清单。

---

## 3. 交付格式（Gemini 每张卡都要给）

```md
## Gx 交付说明
- 分支：fix/gx-xxx（基于 master 34923b0）
- 改动文件：<列表，附关键行号>
- 行为变化：<前 → 后，一句话>
- 验收证据：
  - npm run smoke：x 通过 / 0 失败
  - tsc / build：通过
  - node sim/playtest-matrix.mjs：<贴 §D 配额战斗层数表>
  - 截图：<路径>
- 未做/风险：<显式说明>
- 回滚方式：git revert <sha>
```

---

## 4. 给 Gemini 的开场简报（可直接粘贴）

> 你在 `goblin-tower`（Vite + TS + three.js 像素爬塔 Roguelike）仓库里工作，基线 `34923b0`。
> 已完成一轮真引擎试玩评估，结论写在 `docs/21-试玩评估报告.md`，任务分工在 `docs/22-Gemini任务分工书.md`。
> 你的第一件事是读这两份文档 + `HANDOFF.md` §2（已锁定决策）。
> 当前最高优先级是 **G1：`src/game.ts` 的 `advanceToNextLayer()` 不再调用 `enterLayer(next)`，导致第 2 层起没有层内清怪、场景不切换**。这条先修，修完用 `node sim/playtest-matrix.mjs` 跑 18 局，确认每局配额战斗层数 = 总层数 − Boss 层数（简单 8 / 普通 14 / 困难 15）。
> 规则：不许直接 push master；一次只做一张卡；`game.ts` 相关的卡串行做，其它卡可并行；每张卡都要跑 `npx tsc --noEmit && npm run smoke && npm run build`；不许恢复专武系统/多分支/背包格数/冲刺；`src/game.ts` 与 `src/main.ts` 是 CRLF，别整文件重排。
> 遇到与 `HANDOFF.md` 已锁定决策冲突的需求，停下来问，不要自行折中。
