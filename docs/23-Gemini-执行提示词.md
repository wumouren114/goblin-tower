# 给 Gemini 的执行提示词（可直接整段粘贴）

> 用途：替换掉上一轮的分工问答，明确"什么已做完、什么不要碰、你现在做什么、怎么验收"。
> 生成时间：2026-11-21 · 基线 `34923b0` + 工作区未提交的 G1 修复

---

```
你在 goblin-tower 仓库（Vite + TypeScript + three.js，像素爬塔 Roguelike）里做修复。
先读三份文件，再动手：
1. docs/21-试玩评估报告.md   —— 真引擎 18 局试玩结论（§3 缺陷、§10 修复记录）
2. docs/22-Gemini任务分工书.md —— 任务卡与验收标准
3. HANDOFF.md §2              —— 已锁定决策（不许推翻）

【当前状态：有三件事已经做完了，不要重做】
A. G1 进层流程已修：src/game.ts 的 advanceToNextLayer() 已恢复 this.enterLayer(next)。
   方向已拍板 = 回滚 0211f23，即「每层先清配额怪（简单 8 / 普通 14 / 困难 15 场）→ 再选门 → 房间战」。
   改动在工作区（未提交），用 git diff src/game.ts 就能看到。
B. G1b 软锁已修：updatePlaying() 每帧 statusField.update(dt*1000)；updateEnemies() 把尸体剔除提到 stun 分支之前。
C. G1c 软锁已修：checkLayerClear() 增加「本层怪已刷完且场上无怪」也算清完
   （因为 Mortis 变身爆发/处决等伤害不走 hooks.onHit，击杀会少计）。
   → 这三段代码不要改、不要回滚。你要在它们之上继续工作。
   如果你在自己的 clone/分支上：先把这份 diff 拿过去，否则你跑 18 局会在第 4–5 层卡死。

【已拍板的两个决定，不要再问】
- G1：按上面 A 的方向执行，不需要"保留选门即进层 + 补跨层重建"那条路线。
- G4：标准商店不做。交易只在「流浪商人房 + 祭坛」，不要加"每层固定进一次商店"。
  金币溢出改在商人房内部治（货架格数 / 训练价格曲线 / 祭坛代价），不动流程。

【硬约束】
- 禁止直接 push master；分支命名 fix/*。
- 一次只做一张卡；game.ts 相关卡串行，做完一张跑一次门槛再下一张。
- 每张卡必须：npx tsc --noEmit && npm run smoke && npm run build 全绿。
- src/game.ts 与 src/main.ts 是 CRLF，改完别整文件重排。
- 不许恢复：专武系统（balance.json 无 weapons）、多分支/跨枝反应（maxBranches=1、resonancesEnabled=false）、
  背包格数上限与合成、Shift 冲刺、暴击倍率（固定 ×2.0）。
- 并发：另一个 agent（lead）也在同一工作区。它用端口 127.0.0.2:5188 / CDP 9333；
  你的脚本请用 5198 / 9444。不要覆盖 sim/playtest-matrix.json、sim/playtest-g1.json、
  sim/baseline-*.json、sim/probe-game.json、docs/21、docs/22；你的产物一律加自己的后缀。
  不要切换 git 分支（会让对方的工作区状态错乱）。
- 构建产物：改完源码必须 npm run build，否则试玩脚本跑的是旧 dist。

================ 你的任务（按顺序） ================

H. mute-test 返工（低优先，但请一起清掉）
   你上一版 sim/mute-test.mjs 有两处硬伤：
   1) 用 gains[0] 当 master gain，而每步 gains 数量在 6/7 之间漂移 → 结论自相矛盾
      （"静音后 0.55" 与 "恢复后仍为 0" 不可能同时成立）。
   2) ok: true 但 findings 有 7 条 —— 把"脚本跑完"当"行为通过"。
   返工要求：
   - 记录每步全量 gains 值（不要用下标选 master）+ hudMuted + 暂停按钮文案 + audio.status().muted；
   - ok = findings.length === 0；
   - M 热键那条先做最小复现再下结论：标题页按 M / 局内按 M / 焦点在按钮时按 M，
     分别记录 keydown 是否到达 window、audio.status().muted。
     参考：M 键走 src/game.ts 的 handleHotkeys()，src/ui/hud.ts 的 onKeyDown 没有拦截 KeyM，
     所以先排除"派发/焦点"再判是不是真 bug。
   - 产物写 sim/mute-test-v3.json。

G2. 三处数值接线（旧 bug，改动小，先做）
   2a 充能上限双重取反：
      src/game.ts:3607-3612 里 `branch === 'shunshan'` 永远不命中（真实 id 是 murasame-shunshan），
      而 mutsumi-duet 被 ×0.8；src/systems/combat.ts:315-317 又对 duet ×1.2 → 净 ×0.96。
      改法：只在一处生效（建议 game 层不乘，统一由 combat.effectiveChargeMax 表达）。
      验收数字：丛雨·瞬闪 技能充能 80 → 68（potential 数据 root 文案写的就是 −15%）；
                若叶睦·双重人格 100 → 120（不是 96）。
      顺带修卡片文案：双重人格卡片写的「80→96」是错的基础值（睦的基础充能是 100）。
   2b 闪避上限冲突：src/game.ts:3616 Math.min(0.24, dodge) 与 src/data/cards.ts:71 的 cap 40% 冲突。
      验收：装备金·疾影护符（+22%）后闪避可超过 24%，封顶 40%。
   2c 爆破手不刷：src/game.ts:1477 把 bomberChance 并进了 kind='blocker' 分支。
      验收：layer>=3 常规层抽样 500 只，bomber 占比 5–16%，blocker 回到 4–14%。

G3. Boss 战可读性
   src/game.ts:3254 startRoomBossBattle() 把 Boss 生成在 (0, -halfSize*0.42)，
   玩家在房间南侧入口、镜头跟玩家 → Boss 常被顶到屏幕外（证据截图 shots/playtest/murasame-hard-1-11-playing_boss_fight_boss.png）。
   只改生成坐标 + src/systems/cameraRig.ts（或进场镜头），不要动 entities/boss.ts 的招式数值。
   验收：首领房第一帧 Boss 本体完整可见；截图附上；npm run build 通过。

G7. 流程回归测试收尾
   把 sim/playtest-matrix.mjs 的 --assert-flow 抽成独立脚本 sim/flow-smoke.mjs，
   加 package.json 脚本 "smoke:flow"。
   断言保持：每层配额战斗层数 = 非 Boss 层数；Boss 层 quota×0.6；sceneName 随阶段切换。
   再加一条：retryLayer() 后 run.layer / 血量 / 金币回到本层开局快照。
   验收：当前应为 PASS（G1 已修）；把红→绿两次输出贴进 PR。

G8. 难度调参（必须在 G2/G3 之后，且只改 src/data/balance.json）
   对照：sim/baseline-head.json（修复前）与 sim/baseline-after-g1.json（修复后）。
   修复后实测：简单 6/6（约 10 分钟）、普通 2/6、困难 0/6；单局击杀 277–2800；终局金币最高 3 万+。
   目标（自动机口径）：简单 90–100% / 普通 45–65% / 困难 15–30%。
   允许动：balance.json 的 layerCurve / warmup / difficulties.*Mul / portals / shop.training 价格曲线。
   不允许动：src/data/characters.ts 的角色基础值（会同时改三个难度）、任何流程代码。
   跑 3 轮矩阵（每轮 18 局），命令：
     node sim/playtest-matrix.mjs --assert-flow --out sim/g8-run1.json
     node sim/playtest-matrix.mjs --assert-flow --out sim/g8-run2.json
     node sim/playtest-matrix.mjs --assert-flow --out sim/g8-run3.json
   注意：自动机有 assists（被柱子/召唤物卡住时的脱困补位），是乐观上界；报告里要写明。

G9. 终验
   npx tsc --noEmit && npm run smoke && npm run build
   node sim/flow-smoke.mjs
   node sim/playtest-matrix.mjs --assert-flow --out sim/g9-final.json
   node sim/probe-game.mjs --doors 120
   node scripts/check-audio.mjs
   输出「修复前后对照表」：三难度通关率 / 平均到达层 / 时长 / 承伤 / 每局配额战斗层数，
   以及剩余问题清单。

================ 每张卡的交货格式 ================
## Gx 交付
- 分支：fix/gx-xxx
- 改动文件 + 关键行号
- 行为变化（前 → 后，一句话）
- 验收证据：tsc / smoke / build 结果 + 对应命令输出片段 + 截图路径
- 未做/风险/回滚方式

如果某张卡做不下去（比如需要产品决策或发现与 HANDOFF 冲突），停下来先说明，不要自己折中。
```
