# 给 Gemini 的提示词（第二轮 · 解除阻塞后）

> 复制下面代码块整段发给 Gemini。

```
你在 goblin-tower 仓库做修复。上一轮的阻塞已解除：G1/G1b/G1c 与全部验证脚本已推送。

【第一步：同步代码，不要 base master】
  git fetch origin fix/g1-layer-flow
  git checkout -b fix/<你的任务>-batch origin/fix/g1-layer-flow
基线 sha = 3f044c8（branch: origin/fix/g1-layer-flow）。
如果不在这个基线上开工，你跑任何脚本都会遇到第 4–5 层清层软锁。

【绝对不要动这三段（已在基线里，属我方改动）】
1. src/game.ts advanceToNextLayer() 里的 this.enterLayer(next)
2. src/game.ts updatePlaying() 里的 this.statusField.update(dt * 1000)
3. src/game.ts updateEnemies() 里提到 stun 分支之前的「!g.alive → canDrop」尸体剔除块
   以及 checkLayerClear() 里的 allSpawned 兜底判定
自检：git diff origin/fix/g1-layer-flow -- src/game.ts 里不应出现以上四处的删除行。

【环境事实，别浪费时间】
- 你的沙箱跑不了无头 Chromium → 不要尝试跑 sim/playtest-matrix.mjs、sim/flow-smoke.mjs、sim/mute-test.mjs 的实机部分。
- 但 tsc / vite build / npm run smoke **全是 Node 级**，你的沙箱可以跑：npx tsc --noEmit、npm run smoke、npm run build。
- 浏览器相关验收由 lead 在本机执行（Edge + SwiftShader 已验证可跑）。你交代码，他出实机数据。

【任务（按此顺序，每个任务一个 commit）】

G2 三处数值接线（改 src/game.ts、src/systems/combat.ts，可能加 src/data/potentials.ts 文案）
 2a 充能上限双重取反：
    game.ts 里 `branch === 'shunshan'` 永远不命中（真实 id 是 murasame-shunshan），
    同时 mutsumi-duet 被 game 层 ×0.8、combat.ts 又 ×1.2 → 净 ×0.96。
    要求：只在一处生效（建议 game 层不乘，统一由 combat.effectiveChargeMax 表达）。
    验收数值（必须给出手算/实测依据）：
      丛雨·瞬闪：技能需求 80 → 68（potentials.ts root 文案写的就是 −15%）
      若叶睦·双重人格：100 → 120（不是 96）
    顺带修文案：双重人格卡片若写「80→96」，其基础值用错（睦的基础充能是 100）。
 2b 闪避上限：game.ts 的 Math.min(0.24, dodge) 与 data/cards.ts 的 cap 40 冲突 → 统一按数据源封顶 40%。
 2c 爆破手：game.ts spawnOne() 里 bomberChance 被并进 kind='blocker' 分支 → 拆开独立区间。
 验收：给出「改造后抽样 500 只 layer>=3 常规怪」的分布表（可以写一个纯 Node 脚本 sim/probe-spawn.mjs
       直接 import 那段概率逻辑复算，不需要浏览器）。

G3 Boss 战可读性（改 src/game.ts startRoomBossBattle + 可选 src/systems/cameraRig.ts）
 问题：Boss 生成在 (0, -halfSize*0.42)，玩家在房间南侧入口、镜头跟玩家 → Boss 常被顶出屏幕。
 要求：只改生成坐标/镜头，不动 entities/boss.ts 的招式与数值；battle 门槛不变。
 验收：你无法截图，所以只给：改后坐标、镜头参数、以及「为什么第一帧一定可见」的几何推理
       （玩家位置 → 镜头朝向 → Boss 在视锥内的角度/距离估算）。截图由 lead 出。

G7 流程回归测试抽离（新增 sim/flow-smoke.mjs + package.json 的 "smoke:flow"）
 把 sim/playtest-matrix.mjs 里的 `--assert-flow` 逻辑原样抽成独立脚本，断言保持：
 1) 每局配额战斗层数 = 到达层数中的非 Boss 层数；
 2) Boss 层 layerTotal === round(quota(diff, layer) * 0.6)；
 3) sceneName 随阶段切换（云上花庭/星砂观星台/黄铜钟塔）；
 4) 新增：retryLayer() 后 run.layer / 血量 / 金币 回到本层开局快照。
 约束：复用 playtest-matrix.mjs 的启动方式（静态服务 + Edge + CDP），端口用 5198/9444（lead 用 5188/9333）。
 你只要保证 node --check sim/flow-smoke.mjs 通过 + 逻辑与原断言一致；实跑由 lead 做。
 package.json 里加 "smoke:flow": "node sim/flow-smoke.mjs"（不要塞进 "smoke"）。

H mute-test 返工（改 sim/mute-test.mjs）
 你上一版两处硬伤：
 1) 用 gains[0] 当 master gain，而每步 gains 数量在 6/7 漂移 → 结论自相矛盾；
 2) ok:true 但 findings 有 7 条（把「跑完」当「通过」）。
 返工要求：
 - 每步记录**全量** gains 数组（值 + 序号）、hudMuted、暂停按钮文案、audio.status().muted，不做下标假设；
 - ok = findings.length === 0；
 - M 热键结论前先做最小复现三连：标题页按 M / 局内按 M / 焦点在按钮时按 M，
   分别记录 keydown 是否到达 window、audio.status().muted、master 相关 gain 是否变化；
 - 参考：M 走 game.ts handleHotkeys()，hud.ts 的 onKeyDown 没有拦截 KeyM，
   先排除「派发/焦点」再判是不是真 bug；
 - 产物写 sim/mute-test-v3.json。

【禁止事项】
- 禁止 push master；禁止改 dist/；禁止新增 npm 依赖。
- 禁止动 src/data/characters.ts 的角色基础值；禁止动 src/data/balance.json 的数值（G8 调参是 lead 的活）。
- 禁止恢复：专武系统、多分支/跨枝反应、背包上限与合成、Shift 冲刺、暴击 ×2.0 之外的倍率。
- 禁止覆盖 sim/playtest-matrix.json、sim/playtest-g1.json、sim/baseline-*.json、sim/probe-game.json、docs/21-23。
- src/game.ts、src/main.ts 是 CRLF，别整文件重排。
- 一张卡一个 commit；每张卡提交前跑 npx tsc --noEmit && npm run smoke && npm run build。

【交付格式（每个任务）】
## Gx 交付
- 基于 sha：3f044c8
- 分支 / commit：fix/... @ xxxx
- 改动文件 + 行号
- 行为变化（前 → 后，一句话）
- 自检证据：tsc / smoke / build 输出尾部 + （G2c）抽样分布表
- 你**无法**验证的部分（例如截图、实机矩阵）：明确列出，不要声称已验证
- 风险 / 回滚方式

做完 H+G7+G2+G3 后停下等 lead 实机复验，不要自己去做 G8/G9。
```
