# 哥布林之塔 · Tower of the Goblin King（v3）

> 在线试玩（手机/电脑浏览器直接打开）：https://wumouren114.github.io/goblin-tower/
> 仓库：https://github.com/wumouren114/goblin-tower

像素二次元 × 3D 俯视角 × 割草 Roguelike 爬塔。三角色任选，每层限时清空固定数量的哥布林，穿过「时空隧道」三选一，用金币升级专武与增益卡，最终登上塔顶击杀**哥布林之王**。

> 技术栈：Vite + TypeScript(strict) + three.js。**外置美术/音频已接入**（AI 原画 `assets/art_raw/` + 自产 WAV `assets/audio/`），运行时缺失会自动回退到程序化生成；无 CDN、无新增依赖。

## 运行

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # tsc --noEmit + vite build
npm run pack       # 额外产出 dist/哥布林之塔-单文件版.html（约 15MB，双击即玩）
```

**分享给别人玩**：`npm run pack` 生成的「哥布林之塔-单文件版.html」把 JS/CSS/PNG/WAV 全内联成 data URI，Windows 上双击用 Edge/Chrome 打开就能玩（微信/网盘直接传，不用装 Node、不用开服务器）。首次点击画面后音乐才会响（浏览器自动播放策略）。其他方式：`npm run build` 后把整个 `dist/` 交给对方用任意静态服务器跑，或 `npm run dev -- --host 0.0.0.0` 让同局域网的人访问 `http://你的IP:5173`。

首次进入是标题页：左侧选角色（若叶睦 / 丛雨 / 蓝色大肥鱼），右侧选难度（简单 7 层 / 普通 5+7 层 / 困难 5+5+5 层），点「开始爬塔」。有存档时标题页会出现「继续游戏」。

## 玩法循环

1. **每层限时 70 秒**（Boss 层 100 秒），在倒计时内击杀本层哥布林（HUD 左上角 `击杀 x / 总数`）。每层数量随层数增长（第 N 层 ≈ 34 + 7×(N-1)，困难再乘难度倍率）。
2. 清空后先**三选一拿一张增益卡**，再开启**时空隧道三选一**：奖励房（宝箱金币 / 随机增益卡）、交易房（流浪商人 / 祭坛献金）、对战房（怪潮 / 精英战）。类型可重复，权重 40 / 35 / 25。高层三选一会按品质掷出「精制 / 臻品」，数值更高。
- 第 2 层起会出现**哥布林咒术师**：保持距离并发射紫色弹幕，优先点掉或绕开。
- 哥布林移速随层数增长（第 15 层约 ×1.77），后期会明显追人。
3. 之后进入**商店**：4 格货架 + 25 金重掷，卖专武券、增益卡、消耗品；价格随层数上涨（每层 +14%），第 3 层起出现「精制」、第 8 层起「臻品」。
4. 每层开局会自动存「层快照」，失败结算页可直接**重试本层**（回滚血量/金币/背包）。
5. 阶段末层固定 **Boss 层**，击杀哥布林之王即过关；最后一层 Boss 倒下 = 通关。
6. 每层开始、离开商店自动存档（1 号槽），暂停菜单里可手动存/读 3 个槽位；血量归零或倒计时归零 = 本局失败。
7. **背包**：12 格，同类同级两张可合成（增益卡最高 3 级、专武券最高 7 级）；每格右上角 `×` 可丢弃；满包时买卡/拾取卡会先自动合成腾格，仍放不下才拒绝。

> 战斗手感：**左键按住普攻会自动索敌、朝最近敌人开火**，移动方向不受影响；技能同样自动朝向目标。

## 三角色

| 角色 | 定位 | 左键普攻 | 右键技能（消耗充能） |
| --- | --- | --- | --- |
| **若叶睦** | 中距投掷 | 扔小黄瓜，单体（专武多弹幕） | 变身 **Mortis** 8 秒：耐力/魔力↑、智力↓、减伤 15%，周围音波脉冲 + 变身瞬间爆发 |
| **丛雨** | 近战突进 | 拔刀扇形 110°，攻速高、范围低 | 远距突进，路径伤害、把怪聚到落点、回血 |
| **蓝色大肥鱼** | 远程召唤 | 水枪泡泡，攻速高、伤害低 | 召唤小肥鱼协同攻击 10 秒（专武 5 级 5 只、7 级 6 只） |

五维面板：生命值 / 技能所需充能 / 耐力（攻速）/ 魔力（伤害）/ 智力（范围）。伤害 = `武器基础伤害 × 魔力/100`，暴击 8% ×1.8；充能靠击杀获得，每层开局 50%。**专武 7 级**（1-5 级与旧版一致，6/7 级价格 900/1700），各级效果见 `src/data/balance.json` 的 `weapons`；上限由数据结构推导（`MAX_WEAPON_LV`），加档只改数据。

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
  v4.3 后期压力（本轮试玩反馈）：专武 5→7 级、每层怪 5→7 只/层、单只血量增长放缓、刷怪更快、小怪移速随层最高 ×1.9、睦音波半径 -23%、高层商店品质提前/更强、三选一与地面卡按品质出货。
- 平衡基线（`node sim/simulate.mjs --runs 300`）：简单 100%、普通 100%、困难最低 91%（睦）/丛雨 100%/肥鱼 100%，平均清层 24-28s；困难改前是 100%，现在 10-11 层开始会翻车。
- 前期发育保护：简单/普通前 3 层小怪更脆更少、倒计时 +12/8/4s；困难只保第 1 层。详见 `docs/06-v3规则与实现.md` §8。
- 关卡/经济设计：`docs/04-关卡与经济系统设计.md`（v2 存档）+ `docs/06-v3规则与实现.md`（v3 权威规则）。

## 工程结构

```
src/
  game.ts            总控：相位机、层流程、刷怪、Boss、隧道/商店/背包接线、存档、BGM 切曲
  main.ts            入口 + 原画预加载 + URL 调试参数 + 全局报错兜底
  types.ts           全局契约（HudV3 / WorldV3 / RunState / HUD 快照…）
  core/              input / audio（wav 优先 + 合成回退）/ rng / math / events
  data/              balance.json(+ts) / characters.ts / characterRuntime.ts / stages.ts / gameConfig.ts
  art/               pixels.ts（像素画布）/ characters.ts（程序化图集）/ atlasImport.ts（原画加载切图）/ sprites.ts / projectiles.ts / minions.ts
  entities/          player / goblin / boss / pickups
  systems/           combat / attack / projectiles / minions / charge / economy / inventory / shop / tunnels / saveLoad / cameraRig / vfx / screenFx
  world/             floor.ts（WorldV3 实现）/ themes.ts（9 主题）/ props.ts / textures.ts / util.ts
  ui/                hud.ts（标题/选角/隧道/商店/背包/存档/结算 + HUD）/ dom.ts / styles.css
assets/
  art_pack/          AI 原画原始交付（豆包出图，勿直接改）
  art_raw/           scripts/art-normalize.py 归一化后的图集/单图（游戏实际读这里）
  audio/             scripts/make-audio.mjs 生成的 5 BGM + 18 SFX（22050Hz 单声道 16bit）
sim/                 simulate.mjs（整局平衡）/ world-smoke / combat-smoke / economy-smoke / art-smoke
scripts/             art-normalize.py / make-audio.mjs / check-art.mjs / check-audio.mjs / shot.mjs / ui-audit.mjs
docs/                01 框架 / 02 角色数值 / 03 角色美术规格 / 04 关卡经济 / 05 实现契约 / 06 v3 规则 / 07 美术需求 / 08 音频提示词
```

## 外置资产（原画 / 音频）

**原画**：37 张 AI 原画在 `assets/art_pack/`，`python scripts/art-normalize.py`（或 `npm run art`）会把图集逐格抠残影、按脚底对齐、统一缩放后输出到 `assets/art_raw/`；游戏启动时 `src/art/atlasImport.ts` 预加载这些 PNG 并切图，**缺图/删目录都会自动回退到 `src/art/characters.ts` 的程序化像素图**，不影响启动。
```bash
npm run art          # 重新归一化（需要本机 Python + Pillow）
npm run art:check    # 校验 37 张图尺寸/图集等分（只读 PNG 头，CI 可用）
```
替换原画：把同名 PNG 覆盖进 `assets/art_pack/美术资源整合包/` 对应子目录 → 重新跑 `npm run art`。哥布林小怪没有原画，仍用程序化图集。

单行升级：新规格 v5 的角色样张按行交付——`09-角色正面行样张/`（`char_<角色>_row1_front.png`）与 `10-角色其余四行/`（`row2_back / row3_left / row4_right / row5_skill`），每张 640×80 = 10 格 × 64×80。`01-角色图集/char_<角色>.png` 已由这五行按 front/back/left/right/skill 顺序拼成 640×400，游戏读到的就是 v5 新图；重出某一行时替换对应 640×80 文件后重新拼图（脚本按文件名顺序可复现），再跑 `npm run art`。

> 已知小瑕疵：`char_fish.png` 有 3~4 帧边缘残留一小块水花/刀光残片（出图时特效越过格子），不影响操作；重出该行即可消失。

**音频**：`assets/audio/` 里的 5 首 BGM（title / battle / boss / shop / victory）和 18 个音效全部由 `scripts/make-audio.mjs` 离线合成（零依赖、固定种子、逐字节可复现），运行时按曲目切歌、暂停压音量，缺文件自动回退旧程序化音效。
```bash
npm run audio        # 重新渲染全部 WAV（约 1 秒，6.5MB）
npm run audio:check  # 格式/哈希/时长/电平/循环接缝/源码接线自检
```

## 自检

```bash
npx tsc --noEmit
npm run smoke                 # 依次跑下面四套
node sim/world-smoke.mjs      # 488 断言：9 场景构建/碰撞/撒点/drawcall/dispose
node sim/combat-smoke.mjs     # 50 断言：普攻/暴击/技能/变身/召唤物/专武
node sim/economy-smoke.mjs    # 37 断言：金币曲线/商店/隧道权重/背包合成/三槽存档
node sim/art-smoke.mjs        # 18 断言：程序化图集 50 格/描边/色相区分/缓存
npm run art:check             # 37 张原画尺寸/等分
npm run audio:check           # 23 个 WAV 格式/电平/循环接缝
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

- 小怪（哥布林 small/brute/elite/caster）没有原画，仍用程序化像素图集；角色/王/道具/拾取物/弹道/UI 已用 AI 原画。
- AI 原画切图已做逐格抠残影 + 脚底对齐，个别帧边缘仍有 ~10px 头发残片（原始出图每帧比格子宽），不影响操作。
- BGM/SFX 为脚本离线合成（chiptune 风格），不是人工作曲；删掉 `assets/audio/` 会静默回退到旧的 WebAudio 合成音。
- 难度平衡来自模拟模型（非真人操作数据），超时失败在模拟中几乎不触发。
- 本机沙箱内 `vite dev` 可能因 `spawn EPERM` 失败，这是沙箱限制，真实环境正常。
- `scripts/recover-game.mjs`、`scripts/recover-hud.mjs` 是 PowerShell 以 GBK 覆写 UTF-8 源码后，从 DSH 会话日志回放恢复文件的急救脚本，保留作工具。
