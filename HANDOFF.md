# HANDOFF · 残响高塔（交接给下一个执行者）

> 最后更新：2026-11-20（基于 `origin/master` @ `8a42044` 实况同步）  
> 读完这份就能接手。**先看 §2 的「已锁定决策」，不要推翻它们**——那些是产品侧拍过板的。

---

## 1. 项目与运行

Vite + TypeScript(strict) + three.js，3D 低多边形场景 + 程序化像素 billboard 角色。**要求 Node >= 22.18**（冒烟脚本依赖 Node 原生 TS type-stripping）。

```bash
cd <repo>
npm install
npx tsc --noEmit               # 类型门槛
npm run smoke                  # 冒烟门槛：12 套全绿（含 bounce-smoke、hard-branch-smoke）
npm run build                  # 产物 dist/
node scripts/check-audio.mjs   # 音频清单与电平/循环校验（36/36：5 BGM + 31 SFX）

# 静态服务 + 无头浏览器截图验收：
npm run build
node scripts/serve-dist.mjs 5199

# 离线可视化自检（输出至 shots/，无需启动浏览器）：
node scripts/preview-archetypes.mjs   # → shots/archetypes.png（5 类敌人原型）
node scripts/preview-minions.mjs      # → shots/minions.png（3 种召唤物）
node scripts/preview-npc.mjs          # → shots/npc.png（trial/altar/minigame NPC）
node scripts/preview-fx.mjs           # → shots/potential-fx.png（6 个潜能独立特效）
node scripts/preview-bounce.mjs       # → shots/bounce-paths.png（弹道折射轨迹）
node scripts/preview-boss.mjs         # → shots/boss-phases.png（Boss 三态视觉）
```

**Git**：远端 `origin/master`（GitHub）。本地身份 `wumouren114 <3887597480@qq.com>`。开发一律拉 `feat/*`、`refactor/*`、`test/*` 或 `docs/*` 分支并 push，**禁止直接 push 到 `master`**。

---

## 2. 已锁定决策（不要推翻）

### 2.1 系统分工
- **道具卡 = 纯数值层**，机制一律不进卡。
- **潜能 = 机制层**，承担「新增招式 / 触发 / 联动」（原专武等级系统已彻底删除，仅保留潜能）。

### 2.2 道具卡、背包与商人
- 一张卡 = 一个名字 + **3 档（蓝/紫/金）**，**同名唯一**，再拿到同名 = 原地升一档；满金退池。
- 池子只出「比当前持有高一档」的那一档；允许跳级但概率压低（<= 12%）。
- 10 张卡 10 个属性键，1:1；背包**不限格数**；**已删除二合一合成**（`autoMerge`/`merge`/`mergeItems`/`onMergeItem` 已移除）。
- 商人「交换」：同档不同名三选一，价格 `0 / 15 / 25 / 40 / 65`（同房递增，离房重置），无合法目标置灰不扣钱。

### 2.3 潜能与 Q/F 通用动作
- 3 角色 × 3 分支 × 3 节点 = **27 个节点**（全部已接入战斗），节点固定一级，不升级；9 条分支拥有独立图标与主题色。
- ~~双分支构筑与 3 组跨分支反应~~ **已暂时下线**（`game.ts: resonancesEnabled=false`、`maxBranches=1`）：每角色仅 1 条分支，等新触发规则再恢复。分支代价必须「咬自己」，独立伤害源（流血/标记结算）不吃衰减。
- **Q / F 通用动作**：选中任一潜能分支解锁 Q，任一分支点满 2 个节点解锁 F（丛雨：处决 / 格挡；睦：推敌 / 强拍闪避；大肥鱼：回收 / 水枪）。

### 2.4 关卡与九门结构
- 难度层数：简单 `9`（怪伤 ×0.4、怪血 ×0.6、密度 ×0.8、每层进场回 15% HP）、普通 `16`（`7+9`）、困难 `18`（`6+6+6`）。
- 每大层最后一关 = Boss；其余小层清完进 **3 条时空隧道三选一**。
- 九门全通：战斗类（怪潮 / 精英 / Boss）、奖励探索类（宝箱 / 技能卡 / 探索事件 / 小游戏）、交易类（商人 / 四档祭坛 / 考验）、休憩类（营地）。

### 2.5 交互与操作
- **所有场景交互统一 `Enter`**（商人 / 祭坛 / 考验 / 事件 / 小游戏 / 传送门）。
- `Q` / `F` 承担角色通用动作，`E` 承担辅助/交互；**已删除 Shift 冲刺**，暴击倍率固定 `×2.0`，受击无敌 `0.3s`。
- 屏幕中下部新增像素风**键位引导条**（替代原底部静态提示栏），动态显示未解锁 / 已解锁 / 冷却进度。

### 2.6 事件、考验与世界观
- 世界观：失忆勇者带少女同伴攀塔；三大层是塔吞下的「世界回声」（云上花庭 / 星砂观星台 / 黄铜钟塔）；塔在称量并收集「想往上爬的人」；塔顶「恶龙」是最终 Boss 的比喻，打倒它取回记忆。
- 事件不写死隐藏真身（运行时随机抽）、不写概率数字、轻惩罚、允许「不了了之」。
- 小游戏与考验拒绝均**无惩罚**；祭坛四档献祭代价不可逆。

### 2.7 敌人原型
- 五类威胁原型：远程压制 / 封路（魔法怪铺持续伤害区域，场地保持平坦）/ 冲锋线（前摇 >= 800ms，无冲刺可走位躲）/ 召唤 / 自爆。不加治疗型与护盾型。

---

## 3. 模块状态表（当前 `master` @ `8a42044` 实况）

| 模块 | 关键文件 | 当前状态 | 冒烟 / 校验 |
| --- | --- | --- | --- |
| 潜能系统（9 分支 27 节点 100%） | `src/data/potentials.ts`、`src/systems/combat.ts`、`src/core/beatClock.ts` | ✅ 9 分支 27 节点 100% 接入战斗；九分支独立图标与主题色已上卡 | `potential-smoke` (16) + `beat-smoke` (16) |
| 多分支 + 跨枝反应（**已下线**） | `src/game.ts` | ⏸ 每角色 1 分支位，`resonancesEnabled=false`；combat 层多分支能力保留（`hard-branch-smoke` 已改为断言下线态，15 项全过） | `hard-branch-smoke` (15) |
| Q / F 通用动作 | `src/data/potentials.ts`、`src/systems/combat.ts`、`src/core/audio.ts` | ✅ 三角色 Q/F 技能文案、音效（`sfx_execute`/`sfx_block`/`sfx_push`/`sfx_recall`/`sfx_watergun`）与战斗逻辑已接通 | `combat-smoke` (77) + `check-audio` |
| 局内键位引导条 | `src/ui/hud.ts`、`src/styles.css`、`src/game.ts` | ✅ 中下部胶囊键位条上线（未解锁灰显/解锁脉冲/冷却填充），已删底部旧静态提示栏 | `tsc` + `vite build` |
| 九门与时空隧道 | `src/systems/tunnels.ts`、`src/game.ts`、`src/entities/roomNpc.ts` | ✅ 宝箱 / 技能卡 / 商人 / 祭坛 / 考验 / 小游戏 / 事件 / 战斗 / 休憩九门全通，含 3 种新 NPC 独立像素立绘 | `economy-smoke` (46) + `preview-npc` |
| 探索事件（12 篇） | `src/data/events.ts`、`src/systems/eventState.ts`、`src/ui/eventPanel.ts` | ✅ 扩写至 12 个事件（含跨事件呼应与隐藏真身）；奖惩统一视觉反馈（飘字+粒子+光环）与 `buff`/`debuff` 真实生效 | `event-smoke` (12) |
| 场景 9 套 + 弹道折射 | `src/world/{themes,textures,floor}.ts`、`src/data/stages.ts`、`src/systems/bounce.ts` | ✅ 3 阶段 × 3 场景共 9 套主题（6 层细节 + 地标）；弹道撞障碍反射已抽纯函数并补齐测试 | `world-smoke` (542) + `bounce-smoke` (9) |
| 音频产物（31 SFX + 5 BGM） | `scripts/make-audio.mjs`、`scripts/check-audio.mjs`、`assets/audio/*` | ✅ 5 首无缝循环 BGM + 31 个 SFX（含节拍、新怪、Q/F、Boss 转阶段 `sfx_boss_phase` 与狂暴 `sfx_boss_enrage`） | `check-audio.mjs` (36/36) |
| 状态效果系统 | `src/systems/statusEffects.ts` | ✅ 纯逻辑 `StatusField`（`stun` / `mark` 抗性窗口、叠层与消耗结算）已接入 | `status-smoke` (8) |
| Boss 三阶段视觉 | `src/entities/boss.ts`、`src/game.ts` | ✅ 一阶段常规 / 二阶段按 `kind` 分化色调（金/橙/紫）+ 脚下旋转暗色光环 / 狂暴 `<30%` 触发 `boss.setEnraged()` 红色脉冲 + 火星 + 抖动 | `preview-boss` + `vite build` |
| 道具卡 / 背包 / 商店 / 交换 | `src/data/cards.ts`、`src/systems/{inventory,shop,economy}.ts` | ✅ 三档卡、无限背包、同名升档、商人交换全通；已清理旧合成死代码（`120b1b2`）与旧文案（`da7760d`） | `card-smoke` (9) + `economy-smoke` (46) |
| 小游戏 / 考验门 / 四档祭坛 | `src/minigames/*`、`src/data/{trials,altar}.ts` | ✅ 风车/星轨/齿轮 3 款小游戏、6 条考验立约、4 档祭坛均已接入对应房间门 | `tsc` + `vite build` |
| 敌人原型与召唤物 | `src/data/enemyArchetypes.ts`、`src/systems/{enemyBehavior,hazardZone}.ts`、`src/art/minions.ts` | ⚠️ 5 类外观与封路区已接线；其余 4 类原型 AI 状态机待接 `GoblinSwarm` | `enemy-smoke` (8) + `art-smoke` (26) |

---

## 4. 并行协作：文件所有权

多人 / 多分支并行开发时按目录切分，避免同文件合并冲突：

| 归属线 | 负责目录 / 文件 | 禁止触碰 |
| --- | --- | --- |
| **主线（本机 `master` / 接线与核心逻辑）** | `src/game.ts`、`src/main.ts`、`src/systems/{combat,projectiles,tunnels,shop,inventory,saveLoad}.ts`、`src/ui/*`、`src/types.ts`、`src/data/balance.json`（经济/难度调参） | — |
| **外包 / 云端并行线（`feat/*` / `refactor/*` / `test/*` / `docs/*`）** | `src/art/*`、`src/entities/{boss,roomNpc}.ts`、`src/minigames/*`、`src/data/{potentials,events,trials,altar,enemyArchetypes}.ts`（纯数据/文案）、`src/systems/{bounce,characterFx}.ts`（独立纯函数/特效）、`scripts/{make-audio,check-audio,preview-*}.mjs`、`assets/audio/*`、`sim/*-smoke.mjs`、`docs/*`、`HANDOFF.md` | `src/game.ts`、`src/systems/combat.ts`、`src/ui/*`、`src/types.ts`（除非任务单明确授权），且**永不直接 push `master`** |

> 冲突裁决原则：一切以 §2「已锁定决策」为准，外包线交付分支 + 验收报告，由主线审阅后 cherry-pick 或 merge；每次合并前必须全绿通过 `npx tsc --noEmit && npm run smoke && npm run build`。

---

## 5. 已知问题与待办

1. **小游戏交互未实机验证**：风车校准 / 星轨连线 / 齿轮啮合已接入游戏门与 `?minigame=` 调试入口，但键盘/鼠标交互手感与边界通关判定尚未在真机浏览器完整走查。
2. **键位引导条冷却填充未实机验证**：中下部胶囊条已上线并接入每帧 `hud.setKeyGuide(items)`，但高频率战斗下 Q/F 冷却自下而上填充、就绪脉冲与解锁瞬间动画尚未在真机逐帧验证。

> 其余真实代码缺口（`enemyArchetypes`/`enemyBehavior` 4 类原型实机接线、事件 `battle` 刷怪、旧系统分步退役）统一记录于 `docs/19-残留待办.md` 与 `docs/13-旧系统残留审计.md`。

---

## 6. 调试参数全表（`src/main.ts`）

所有参数通过 URL Query 传入（例如 `http://127.0.0.1:5199/?autostart=normal&char=mutsumi&floor=6&potential=mutsumi-rhythm&pnodes=mutsumi-rhythm-1`）：

| 参数 | 取值示例 | 作用 |
| --- | --- | --- |
| `autostart` | `easy` / `normal` / `hard` | 跳过标题页直接以指定难度开局（以下多数局内调试参数需配合此项） |
| `char` | `mutsumi` / `murasame` / `fish` | 指定开局角色（默认 `mutsumi`） |
| `style` | 旧 `StyleId`（如 `murasame-iai`） | 指定旧战斗风格（兼容调试） |
| `floor` | 正整数（如 `6`） | 直接跳到指定层数（默认 `1`） |
| `warmup` | 秒数（如 `2`） | 开局后自动预热推进指定秒数（配合无头截图） |
| `seed` | 整数（如 `42`） | 固定本局随机种子，复现房间/掉落/商店 |
| `px` / `pz` | 浮点数 | 覆写玩家初始世界坐标 `(x, z)` |
| `autoattack` | `1` | 开启自动普攻 |
| `pickbonus` | `1` | 自动选择第一个潜能/奖励选项（`debugPickFirstBonus`） |
| `potential` | 分支 id（如 `mutsumi-rhythm`） | 开局直接装配指定潜能分支 |
| `pnodes` | 逗号分隔节点 id | 配合 `potential` 装配指定潜能节点列表 |
| `hazard` | `1` | 在玩家脚下直接生成一块封路持续伤害区 |
| `blocker` | `1` | 在玩家前方刷出一只封路者敌人 |
| `fishskill` | `1` | 立即触发大肥鱼召唤技能 |
| `minigame` | `windmill` / `starlines` / `gears` | 直接弹出对应像素小游戏面板 |
| `shop` | `1` | 直接打开商店面板 |
| `exchange` | `1` | 打开商店并直接切入商人「交换」面板 |
| `event` | `1` | 立即弹出探索事件面板 |
| `eventpick` | `1` | 自动选中当前事件第一个选项 |
| `saveloop` | `1` | 执行存档 → 回标题 → 读档往返自检 |
| `debug` | `1` | 启用调试覆盖层 / 调试句柄展示 |
| `screen` | `title` / `tunnel` / `shop` / `gameover` 等 | 直接切换到指定 UI 界面（独立于 `autostart`） |

---

## 7. 踩坑备忘

1. **旧系统分步清理**：`weapons`（专武系统）已彻底删除；`awakenings` 仍被部分旧风格逻辑引用，清理时按 `docs/13-旧系统残留审计.md` 先切引用再删代码。
2. **`RoomNpcKind` 与 `TunnelRoom` 联动**：改 `TunnelRoom` 会影响 `roomIcons.ts` / `floor.ts` / `roomNpc.ts` / `hud.ts` 四处映射；新增房间 NPC 视觉时保持 `RoomNpcKind` 枚举不变，在 `roomNpc.ts` 内扩展绘制分支即可。
3. **新增音效必须同步 `check-audio.mjs`**：在 `scripts/make-audio.mjs` 新增 `sfx_*.wav` 后，必须在 `scripts/check-audio.mjs` 的 `DOC_SFX_RANGES` 补充对应时长区间，否则音频校验会红。
4. **经济冒烟分布断言**：`sim/economy-smoke.mjs` 校验隧道大类与子房概率（±5% / ±6%），改 `balance.json.portals` 后必须复跑。
5. **保持原文件换行符**：`src/game.ts` 与 `src/main.ts` 为 CRLF，批量脚本编辑时务必保留原换行符，避免全文件 diff 污染合并。
