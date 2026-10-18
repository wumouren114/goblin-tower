# 哥布林之塔 · Tower of the Goblin King（v3）

像素二次元 × 3D 俯视角 × 割草 Roguelike 爬塔。三角色任选，每层限时清空固定数量的哥布林，穿过「时空隧道」三选一，用金币升级专武与增益卡，最终登上塔顶击杀**哥布林之王**。

> 技术栈：Vite + TypeScript(strict) + three.js。所有像素图、场景贴图、粒子、音效均由代码程序化生成，无外部素材、无 CDN、无新增依赖。

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # tsc --noEmit + vite build
```

首次进入是标题页：左侧选角色（若叶睦 / 丛雨 / 蓝色大肥鱼），右侧选难度（简单 7 层 / 普通 5+7 层 / 困难 5+5+5 层），点「开始爬塔」。有存档时标题页会出现「继续游戏」。

## 玩法循环

1. **每层限时 70 秒**（Boss 层 100 秒），在倒计时内击杀本层固定数量的哥布林（HUD 左上角 `击杀 x / 总数`）。
2. 清空后先**三选一拿一张增益卡**，再开启**时空隧道三选一**：奖励房（宝箱金币 / 随机增益卡）、交易房（流浪商人 / 祭坛献金）、对战房（怪潮 / 精英战）。类型可重复，权重 40 / 35 / 25。
- 第 2 层起会出现**哥布林咒术师**：保持距离并发射紫色弹幕，优先点掉或绕开。
3. 之后进入**商店**：4 格货架 + 25 金重掷，卖专武券、增益卡、消耗品；价格随层数上涨（每层 +14%），第 4 层起出现「精制」、第 9 层起「臻品」。
4. 阶段末层固定 **Boss 层**，击杀哥布林之王即过关；最后一层 Boss 倒下 = 通关。
5. 每层开始、离开商店自动存档（1 号槽），暂停菜单里可手动存/读 3 个槽位；血量归零或倒计时归零 = 本局失败。

> 战斗手感：**左键按住普攻会自动索敌、朝最近敌人开火**，移动方向不受影响；技能同样自动朝向目标。

## 三角色

| 角色 | 定位 | 左键普攻 | 右键技能（消耗充能） |
| --- | --- | --- | --- |
| **若叶睦** | 中距投掷 | 扔小黄瓜，单体（专武多弹幕） | 变身 **Mortis** 8 秒：耐力/魔力↑、智力↓、减伤 15%，周围音波脉冲 + 变身瞬间爆发 |
| **丛雨** | 近战突进 | 拔刀扇形 110°，攻速高、范围低 | 远距突进，路径伤害、把怪聚到落点、回血 |
| **蓝色大肥鱼** | 远程召唤 | 水枪泡泡，攻速高、伤害低 | 召唤小肥鱼协同攻击 10 秒（专武 5 级最多 5 只） |

五维面板：生命值 / 技能所需充能 / 耐力（攻速）/ 魔力（伤害）/ 智力（范围）。伤害 = `武器基础伤害 × 魔力/100`，暴击 8% ×1.8；充能靠击杀获得，每层开局 50%。专武 5 级，各级效果见 `src/data/balance.json` 的 `weapons`。

## 操作

| 输入 | 行为 |
| --- | --- |
| WASD / 方向键 | 移动（屏幕系，自动按镜头朝向转世界） |
| 鼠标左键（按住连发） | 普攻，朝鼠标指向 |
| 鼠标右键 / `Q` | 技能（充能满可用；Edge 里右键可能误触后退，推荐用 Q） |
| Shift / 空格 | 冲刺（短无敌） |
| 中键拖拽 / 滚轮 | 转视角 / 缩放 |
| V / P / M / I | 切视角 / 暂停 / 静音 / 背包（商店中） |
| E / 空格 | UI 弹窗确认 |
| R | 失败/通关界面立即重开 |

## 数值与平衡

- 唯一数值源：`src/data/balance.json`（v3），代码通过 `src/data/balance.ts` 访问器读取。
- 整局蒙特卡洛模拟：`node sim/simulate.mjs --runs 500 --difficulty hard --verbose`。
  v3.1 手感调整（按试玩反馈）：整体下调约 30% 难度、攻速与充能加快、道具数量 -45%、单体角色弹速提高。
- 前期发育保护：简单/普通前 3 层小怪更脆更少、倒计时 +12/8/4s；困难只保第 1 层。详见 `docs/06-v3规则与实现.md` §8。
- 关卡/经济设计：`docs/04-关卡与经济系统设计.md`（v2 存档）+ `docs/06-v3规则与实现.md`（v3 权威规则）。

## 工程结构

```
src/
  game.ts            总控：相位机、层流程、刷怪、Boss、隧道/商店/背包接线、存档
  main.ts            入口 + URL 调试参数 + 全局报错兜底
  types.ts           全局契约（HudV3 / WorldV3 / RunState / HUD 快照…）
  core/              input / audio / rng / math / events
  data/              balance.json(+ts) / characters.ts / characterRuntime.ts / stages.ts / gameConfig.ts
  art/               pixels.ts（像素画布）/ characters.ts（4 套角色图集）/ sprites.ts / projectiles.ts / minions.ts
  entities/          player / goblin / boss / pickups
  systems/           combat / attack / projectiles / minions / charge / economy / inventory / shop / tunnels / saveLoad / cameraRig / vfx / screenFx
  world/             floor.ts（WorldV3 实现）/ themes.ts（9 主题）/ props.ts / textures.ts / util.ts
  ui/                hud.ts（标题/选角/隧道/商店/背包/存档/结算 + HUD）/ dom.ts / styles.css
sim/                 simulate.mjs（整局平衡）/ world-smoke / combat-smoke / economy-smoke / art-smoke
docs/                01 框架 / 02 角色数值 / 03 角色美术规格 / 04 关卡经济 / 05 实现契约 / 06 v3 规则
```

## 自检

```bash
npx tsc --noEmit
node sim/world-smoke.mjs      # 488 断言：9 场景构建/碰撞/撒点/drawcall/dispose
node sim/combat-smoke.mjs     # 50 断言：普攻/暴击/技能/变身/召唤物/专武
node sim/economy-smoke.mjs    # 37 断言：金币曲线/商店/隧道权重/背包合成/三槽存档
node sim/art-smoke.mjs        # 16 断言：4 套图集 50 格/描边/色相区分/缓存
node sim/simulate.mjs --runs 500 --difficulty hard
```

无头截图验证：先 `npm run dev`，再
`node scripts/shot.mjs "http://127.0.0.1:5173/?autostart=easy&char=mutsumi&warmup=8&autoattack=1" shots/a.png 7000 1600 900`。

## 调试参数

- `?autostart=easy|normal|hard` 直接开局；`&char=mutsumi|murasame|fish`；`&floor=N` 跳层。
- `&warmup=秒` 以固定步长快进（不依赖真实时间）；`&autoattack=1` 自动驾驶（自动瞄准普攻、满充能放技能）。
- `&screen=tunnel|shop|inventory|pause|victory|defeat|save|skill` 直接打开对应界面。
- `&debug=1` 左下角打印运行期状态叠层（相位/Boss/怪物/血条 DOM 等）。

## 已知限制

- 音效为 WebAudio 程序合成，没有 BGM；画面为低多边形 + 像素 billboard，非全 3D 模型。
- 难度平衡来自模拟模型（非真人操作数据），超时失败在模拟中几乎不触发。
- 本机沙箱内 `vite dev` 可能因 `spawn EPERM` 失败，这是沙箱限制，真实环境正常。
- `scripts/recover-game.mjs`、`scripts/recover-hud.mjs` 是 PowerShell 以 GBK 覆写 UTF-8 源码后，从 DSH 会话日志回放恢复文件的急救脚本，保留作工具。
