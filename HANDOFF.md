# HANDOFF · 残响高塔（交接给下一个执行者）

> 最后更新：2026-11（v5 合并后实况 · 基于 `master`）
> 读完这份就能接手。**先看 §2 的「已锁定决策」，不要推翻它们**——那些是产品侧拍过板的。

---

## 1. 项目与运行

Vite + TypeScript(strict) + three.js，3D 低多边形场景 + 程序化像素 billboard 角色。**要求 Node >= 22.18**（冒烟脚本依赖 Node 原生 TS type-stripping）。

```bash
cd <repo>
npm install
npx tsc --noEmit          # 类型门槛
npm run smoke             # 冒烟门槛：10 套全绿（542+77+46+26+16+16+12+9+8+8）
npm run build             # 产物 dist/
node scripts/check-audio.mjs   # 音频清单与电平/循环校验（29/29）

# 静态服务 + 无头浏览器截图验收：
npm run build
node scripts/serve-dist.mjs 5199
# 离线像素资产自检（无需开游戏）：
node scripts/preview-archetypes.mjs   # → shots/archetypes.png
node scripts/preview-minions.mjs      # → shots/minions.png
node scripts/preview-npc.mjs          # → shots/npc.png
```

**Git**：远端 `origin/master`（GitHub）。本地身份 `wumouren114 <3887597480@qq.com>`。开发一律拉 `feat/*` 或 `audit/*` 分支并 push，不直接推 `master`。

---

## 2. 已锁定决策（不要推翻）

### 2.1 系统分工
- **道具卡 = 纯数值层**，机制一律不进卡。
- **潜能（原「专武分支」）= 机制层**，承担「新增招式 / 触发 / 联动」。

### 2.2 道具卡、背包与商人
- 一张卡 = 一个名字 + **3 档（蓝/紫/金）**，**同名唯一**，再拿到同名 = 原地升一档；满金退池。
- 池子只出「比当前持有高一档」的那一档；允许跳级但概率压低（<= 12%）。
- 10 张卡 10 个属性键，1:1；背包**不限格数**；**已删除二合一合成**。
- 商人「交换」：同档不同名三选一，价格 `0 / 15 / 25 / 40 / 65`（同房递增，离房重置），无合法目标置灰不扣钱。

### 2.3 潜能
- 3 角色 × 3 分支 × 3 节点 = **27 个节点**（全部已接入战斗），选定分支即锁定；节点固定一级，不升级。
- 分支代价必须「咬自己」（流殇/瞬闪砍普攻、剑意砍技能等），独立伤害源（流血/标记结算）不吃衰减。
- 跨大层获得新潜能，分支间通过 `resonances` 产生反应。

### 2.4 关卡与九门结构
- 难度层数：简单 `7`（或 `5+5` 调整中）、普通 `5+7`（12 层）、困难 `5+5+5`（15 层）。
- 每大层最后一关 = Boss；其余小层清完进 **3 条时空隧道三选一**（已取消清层三选一增益卡）。
- 九门全通：战斗类（怪潮 / 精英 / Boss）、奖励探索类（宝箱 / 技能卡 / 探索事件 / 小游戏）、交易类（商人 / 四档祭坛 / 考验）、休憩类（营地）。

### 2.5 交互与操作
- **所有场景交互统一 `Enter`**（商人 / 祭坛 / 考验 / 事件 / 小游戏 / 传送门）。
- `E` / `F` 留给角色专属战斗键；**已删除 Shift 冲刺**，暴击倍率固定 `×2.0`，受击无敌 `0.3s`。

### 2.6 事件、考验与世界观
- 世界观：失忆勇者带少女同伴攀塔；三大层是塔吞下的「世界回声」（云上花庭 / 星砂观星台 / 黄铜钟塔）；塔在称量并收集「想往上爬的人」；塔顶「恶龙」是最终 Boss 的比喻，打倒它取回记忆。
- 事件不写死隐藏真身（运行时随机抽）、不写概率数字、轻惩罚、允许「不了了之」。
- 小游戏与考验拒绝均**无惩罚**；祭坛四档献祭代价不可逆。

### 2.7 敌人原型
- 五类威胁原型：远程压制 / 封路（魔法怪铺持续伤害区域，场地保持平坦）/ 冲锋线（前摇 >= 800ms，无冲刺可走位躲）/ 召唤 / 自爆。不加治疗型与护盾型。

---

## 3. 模块状态表（当前 `master` 实况）

| 模块 | 关键文件 | 当前状态 | 冒烟 / 校验 |
| --- | --- | --- | --- |
| 潜能系统（27/27） | `src/data/potentials.ts`、`src/systems/combat.ts`、`src/core/beatClock.ts` | ✅ 9 分支 27 节点全接入（含节奏 A 方案、60 连击爆裂、剑意标记结算、眩晕） | `potential-smoke` (16) + `beat-smoke` (16) |
| 状态效果系统 | `src/systems/statusEffects.ts` | ✅ 纯逻辑 `StatusField`（`stun` / `mark` 抗性与叠层结算）已接入 | `status-smoke` (8) |
| 道具卡 / 背包 / 商店 | `src/data/cards.ts`、`src/systems/{inventory,shop,economy}.ts` | ✅ 三档卡、无限背包、同名升档、商人交换全通 | `card-smoke` (9) + `economy-smoke` (46) |
| 九门与隧道 | `src/systems/tunnels.ts`、`src/game.ts` | ✅ 宝箱 / 技能卡 / 商人 / 祭坛 / 考验 / 小游戏 / 事件 / 战斗 / 休憩全通 | `economy-smoke` (46) |
| 探索事件（8 篇） | `src/data/events.ts`、`src/systems/eventState.ts`、`src/ui/eventPanel.ts` | ✅ 完整小故事（场景/NPC/hint/余韵/世界观）已接面板；关卡文档见 `docs/14` | `event-smoke` (12) |
| 小游戏（3 阶段） | `src/minigames/{index,shared,windmill,starlines,gears}.ts` | ✅ 风车校准 / 星轨连线 / 齿轮啮合已接入游戏门，支持 `?minigame=` 直进 | `tsc` + `vite build` |
| 考验门（6 条） | `src/data/trials.ts`、`src/game.ts` | ✅ 立约/拒绝、期间负面与层推进已接入；文档见 `docs/15` | `tsc` + `vite build` |
| 祭坛（四档） | `src/data/altar.ts`、`src/game.ts` | ✅ 献卡 / 献血 / 双重 / 神秘祭坛文案与交互已接入 | `tsc` + `vite build` |
| 场景细节与地标 | `src/world/{themes,textures,floor}.ts`、`src/data/stages.ts` | ✅ 9 套二次元亮色主题、6 层细节、柔化光斑、风车/黄道仪/齿轮地标 | `world-smoke` (542) |
| 敌人原型与封路区 | `src/data/enemyArchetypes.ts`、`src/systems/{enemyBehavior,hazardZone}.ts`、`src/art/characters.ts` | ✅ 骨架 + 精修 5 类像素外观 + 封路持续伤害区已接线 | `enemy-smoke` (8) + `art-smoke` (26) |
| 召唤物与房间 NPC 外观 | `src/art/minions.ts`、`src/entities/roomNpc.ts` | ✅ 3 种召唤物放大/剪影/贴地光环 + 3 种新房间 NPC（trial/altar/minigame）独立立绘 | `preview-minions` / `preview-npc` |
| 音频产物 | `scripts/make-audio.mjs`、`assets/audio/*` | ✅ 5 BGM（战斗曲含 134BPM 节拍层）+ 24 SFX（含拍点音/新怪/潜能/剑意结算） | `check-audio.mjs` (29/29) |

---

## 4. 并行协作：文件所有权

多人 / 多分支并行开发时按目录切分，避免同文件冲突：

| 归属线 | 负责目录 / 文件 | 禁止触碰 |
| --- | --- | --- |
| **主线 / 接线侧（本机 `master`）** | `src/game.ts`、`src/systems/*`、`src/ui/*`、`src/types.ts`、`src/data/balance.json`（节奏/经济参数） | — |
| **内容 / 美术 / 纯数据侧（云端 `feat/*`）** | `src/art/*`、`src/entities/roomNpc.ts`、`src/minigames/*`、`src/data/{events,trials,altar,enemyArchetypes}.ts`、`scripts/{make-audio,check-audio,preview-*}.mjs`、`assets/audio/*`、`docs/*` | `src/game.ts`、`src/systems/*`、`src/ui/*`、`src/types.ts`（除非任务单明确授权） |

> 冲突裁决原则：一切以 §2「已锁定决策」为准，且每次合并前必须全绿通过 `npx tsc --noEmit && npm run smoke && npm run build`。

---

## 5. 已知问题与待办

1. **誓约（Trial）转正 `boon` 未全部落地**：目前 `src/game.ts` 已接通考验立约、期间负面与层推进倒计时，但部分 `boon`（如到期返还当前金币 40%、单挑切磋专武 +1 / 落败扣血上限、每秒回血 0.5% 等）需逐项补完实际生效逻辑。
2. **召唤物新外观与交互未实机压测**：`createMinionMeshVariant` 的尺寸、金色呼吸环与大肥鱼 10 只群聚时的画面表现、以及 `E 回收 / F 水枪` 在高密度怪潮下的手感仍需实机验证。
3. **旧系统残留待清理**：`src/data/awakenings.ts`、`balance.json.weapons`、塔藏箱、HUD「专武 Lv」等旧路径仍与新系统并存，清理前置条件与安全删除顺序见 `docs/13-旧系统残留审计.md`。
4. **经济与数值平衡待调优**：金币关与后期金币偏高、重掷偏便宜、部分潜能分支强弱分化较大、第 9 层后封路区叠加伤害无上限，具体建议见 `docs/16-数值评估.md`。
5. **打包体积提示**：`vite build` 主包略超 1200KB（受内联音频与像素资源引用影响），后续可按需做 `manualChunks` 拆分。

---

## 6. 调试参数全表（`src/main.ts`）

所有参数通过 URL Query 传入（例如 `http://127.0.0.1:5199/?autostart=normal&char=mutsumi&floor=6&potential=mutsumi-rhythm`）：

| 参数 | 取值示例 | 作用 |
| --- | --- | --- |
| `autostart` | `easy` / `normal` / `hard` | 跳过标题页直接以指定难度开局 |
| `char` | `mutsumi` / `murasame` / `fish` | 指定开局角色（默认 `mutsumi`） |
| `style` | 旧 `StyleId`（如 `murasame-iai`） | 指定旧战斗风格（兼容调试） |
| `floor` | 正整数（如 `6`） | 直接跳到指定层数 |
| `warmup` | 秒数（如 `2`） | 自动预热推进指定秒数（配合无头截图） |
| `seed` | 整数（如 `42`） | 固定本局随机种子，复现房间/掉落 |
| `px` / `pz` | 浮点数 | 指定玩家出生世界坐标 |
| `autoattack` | `1` | 开启自动普攻 |
| `pickbonus` | `1` | 自动选择第一个奖励项 |
| `potential` | 分支 id（如 `mutsumi-rhythm`） | 开局直接装配指定潜能分支 |
| `pnodes` | 逗号分隔节点 id | 配合 `potential` 装配指定潜能节点 |
| `blocker` | `1` | 在玩家前方刷出一只封路者 |
| `hazard` | `1` | 在玩家脚下直接生成一块封路持续伤害区 |
| `fishskill` | `1` | 立即触发大肥鱼召唤技能 |
| `minigame` | `windmill` / `starlines` / `gears` | 直接弹出对应像素小游戏面板 |
| `shop` | `1` | 直接打开商店面板 |
| `exchange` | `1` | 直接打开商人「交换」面板 |
| `event` | `1` | 立即弹出随机探索事件面板 |
| `eventpick` | `1` | 自动选中事件第一个选项 |
| `saveloop` | `1` | 触发存档往返自检 |
| `debug` | `1` | 显示调试信息覆盖层 |
| `screen` | `title` / `select` / `gameover` 等 | 直接切换到指定 UI 界面 |

---

## 7. 踩坑备忘

1. **旧系统不可硬删**：`combat.ts` 与 `economy-smoke.mjs` 仍引用旧 `awakenings` / `weapons` 字段，必须严格按 `docs/13-旧系统残留审计.md` 先切引用再删代码。
2. **`RoomNpcKind` 与 `TunnelRoom` 联动**：改 `TunnelRoom` 会影响 `roomIcons.ts` / `floor.ts` / `roomNpc.ts` / `hud.ts` 四处映射；新增房间 NPC 视觉时保持 `RoomNpcKind` 枚举不变，在 `roomNpc.ts` 内按 `room` 扩展视觉分支即可。
3. **新增音效必须同步 `check-audio.mjs`**：在 `scripts/make-audio.mjs` 新增 `sfx_*.wav` 后，必须在 `scripts/check-audio.mjs` 的 `DOC_SFX_RANGES` 补充对应时长区间，否则音频校验会红。
4. **经济冒烟分布断言**：`sim/economy-smoke.mjs` 校验隧道大类与子房概率（±5% / ±6%），改 `balance.json.portals` 后必须复跑。
