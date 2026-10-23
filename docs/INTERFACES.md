# 模块契约（Lead ↔ 各模块）

> 本文件是并行开发的唯一接口约定。**实现方严格按签名实现，调用方严格按签名调用。**
> 数据结构定义见 `src/types.ts`；数值见 `src/data/*.ts`。不要修改本文件之外别人拥有的文件。

技术栈：Vite + TypeScript(strict) + three.js。所有代码 `import * as THREE from 'three'`。
视觉基调：**3D 低多边形塔内场景 + 像素二次元 billboard 角色**，暖色火把主光 + 冷色环境光，雾效纵深，重"爽感"的表现（飘字、粒子、屏震、吸附）。

---

## 1. Lead 拥有

`package.json / tsconfig.json / vite.config.ts / src/main.ts / src/core/* / src/data/* / src/systems/* / src/types.ts / docs/*`

- 启动、主循环、相机、输入、波次、经济、升级、楼层流转、Boss 层流程、胜负结算。
- 集成三方模块，负责最终 `npm run build` 通过。

## 2. A：美术与实体（`src/art/*`、`src/entities/*`）

### 2.1 `src/art/sprites.ts`
用 Canvas2D **程序化绘制**像素图（禁止外部素材、禁止新增依赖），导出：

```ts
export interface SpriteAnim {
  /** 共享 CanvasTexture 图集 */
  texture: THREE.CanvasTexture
  /** 每个方向、每帧的 UV 偏移/尺寸 */
  frames: Record<Facing, { offsetX: number; offsetY: number }[]>
  cols: number
  rows: number
  /** 逻辑像素尺寸（世界单位） */
  worldW: number
  worldH: number
}
export function playerSprite(id?: CharacterId | 'mortis'): SpriteAnim
export function goblinSprite(kind: 'small' | 'brute' | 'elite' | 'caster' | 'spear' | 'bomber'): SpriteAnim
export function kingSprite(kind?: 'king' | 'warlord' | 'witch'): SpriteAnim
export function bombTexture(): THREE.CanvasTexture
export function particleTexture(kind: 'spark' | 'ring' | 'glow' | 'shard'): THREE.CanvasTexture
```

要求：
- 逻辑分辨率 32×40（主角）/ 28×32（哥布林）/ 52×60（王），最近邻放大到图集，`NearestFilter`，透明背景。
- 4 方向（down/up/left/right）× 4 帧（idle×2 + run×2），左右可镜像复用但需在图集中给出。
- 主角：像素二次元 chibi（大头、长发/双马尾、短裙、过膝袜、发光眼睛、1px 深色描边），暂定"红黑长发的冒险者少女"，后续可按用户设定换配色/发型。
- 哥布林：绿皮、大耳、獠牙、破布腰裙、木棒；brute 更壮；king 戴金冠、披风、持大斧。
- 图集布局自定义，但 `frames[dir][i]` 必须能定位到该帧 UV。
- 另提供 `disposeSprite(anim)` 释放纹理。

### 2.2 `src/entities/player.ts`

```ts
export type PlayerAnim = 'idle' | 'run' | 'dash' | 'hurt'

export class Player {
  readonly group: THREE.Group      // 含 sprite + 脚下阴影，交给 Lead add 到场景
  x: number
  z: number
  radius: number                   // 0.42
  stats: PlayerStats
  hp: number
  alive: boolean
  invuln: number                   // 秒
  facing: Facing
  dashCooldownLeft: number
  dashTimeLeft: number
  constructor(scene: THREE.Scene)
  /** 每帧调用：内部处理移动、朝向、动画、影子、无敌闪烁 */
  update(dt: number, moveX: number, moveZ: number, cameraYaw: number, colliders: Circle[], bounds: number): void
  setStats(stats: PlayerStats): void      // 升级后同步；maxHp 变化不自动回血
  takeDamage(amount: number): number      // 返回实际扣血；触发受伤闪白、击退微小、invuln
  heal(amount: number): void
  /** 尝试冲刺，返回是否成功；Lead 负责冲刺的位移逻辑？—— 不，位移由本类在 update 内完成 */
  tryDash(dirX: number, dirZ: number): boolean
  dispose(): void
}
```
- 移动输入是**屏幕系**，内部按 `cameraYaw` 旋转到世界系；`colliders` 为柱子/箱子圆形碰撞体，需推挤解算；`bounds` 为方形半边长，超出即 clamp。
- 冲刺：速度 19、时长 0.16s、CD 1.4s，冲刺全程无敌，带残影（额外 sprite 或拖尾均可）。
- 动画：idle 2 帧慢速交替；run 2 帧按速度加快；hurt 闪白；被击退/受击方向不改。
- 魔法阵/光环：脚下加一圈 `particleTexture('ring')` 的淡色光圈（半径 = pickupRadius，升级后更新），强化"拾取范围"可读性。

### 2.3 `src/entities/goblin.ts`

```ts
export class Goblin {
  readonly group: THREE.Group
  x: number
  z: number
  hp: number
  maxHp: number
  radius: number
  damage: number
  speed: number
  xpValue: number
  goldChance: number
  alive: boolean
  elite: boolean
  readonly canRemove: boolean      // 死亡动画播完后为 true
  constructor(scene: THREE.Scene, def: EnemyDef, x: number, z: number,
              mul: { hp: number; damage: number; speed: number; scale: number }, elite?: boolean)
  update(dt: number, targetX: number, targetZ: number, colliders: Circle[], bounds: number): void
  hit(amount: number, kx: number, kz: number): boolean   // true=本次击杀
  kill(): void
  dispose(): void
}
```
- 追踪玩家 + 与 `colliders` 推挤 + 场地边界；与其它哥布林的分离由 Lead 统一做（实体只暴露 x/z/radius，Lead 会改 x/z 并同步 `group.position`，请用 setter 或在 update 读取 x/z 时以字段为准）。
- 受击：闪白 0.08s、击退；死亡：缩小 + 旋转 + 淡出 0.3s，`canRemove` 变 true。
- 精英怪：脚下金色光圈、体型放大、描边偏亮。

### 2.4 `src/entities/boss.ts`

```ts
export class GoblinKing {
  readonly group: THREE.Group
  x: number
  z: number
  hp: number
  maxHp: number
  radius: number
  alive: boolean
  phase2: boolean
  constructor(scene: THREE.Scene, x: number, z: number, callbacks: {
    onSlam(x: number, z: number, radius: number, damage: number): void
    onSummon(count: number): void
    onRoar(): void
  })
  update(dt: number, targetX: number, targetZ: number): void
  hit(amount: number, kx: number, kz: number): boolean
  dispose(): void
}
```
- 行为状态机：追击 → 蓄力砸地（地面红圈预警 0.85s → onSlam）→ 短暂硬直；血量低于 55% 进二阶段，追加冲锋（直线高速撞击，路径伤害通过回调 `onSlam` 亦可）与召唤哥布林 `onSummon(5)`。
- 血量数值由 Lead 传入/设置：构造后 Lead 会写 `boss.hp = boss.maxHp = value`，请保证 `maxHp` 可写。
- 受击闪白、屏幕可读的巨大体型、头顶显示血条由 UI 负责（这里不用画）。

### 2.5 `src/entities/pickups.ts`

```ts
export class PickupManager {
  constructor(scene: THREE.Scene)
  spawn(kind: PickupKind, x: number, z: number, value?: number): void
  /** 吸附：进入 magnetRadius 后先微微向外弹一下，再加速飞向玩家 */
  update(dt: number, px: number, pz: number, magnetRadius: number,
         onCollect: (kind: PickupKind, value: number) => void): void
  vacuumAll(): void
  clear(): void
  get count(): number
  dispose(): void
}
```
- xp：青色发光菱形（带呼吸光晕）；gold：旋转的金币；scroll：金色卷轴（更亮、更大、持续旋转上升粒子）；heart：红心。
- 地面拾取物要有轻微浮动。性能上限 ~260 个，超出复用最早的对象。

## 3. B：场景与世界（`src/world/*`）

```ts
// src/world/floor.ts
export class TowerFloor implements WorldApi { constructor(scene: THREE.Scene) ... }
```
按 `src/types.ts` 的 `WorldApi` 实现，另需：
- `build(def: FloorDef, theme: ThemeDef, difficulty: DifficultyId)`：清空并生成当层。
- 场地：方形石地（`halfSize`），四周 3D 墙体（高 `wallHeight`，顶部压边），四角塔柱。
- 地面用程序化 Canvas 像素地砖纹理（重复贴图，`NearestFilter`，颜色取自 theme，带裂纹/苔藓/熔岩/冰霜细节），法线可简单用 flat。
- 中央祭坛（低矮石台+发光符文圈），随机布置石柱/木箱/断垣等障碍（写入 `propColliders`，圆形半径近似），数量 `def.props`。
- 火把：沿墙布置 6~10 个，含 flicker 点光源（`update` 内闪烁），控制光源数量（≤6 个实时点光）。
- 楼梯门：位于北侧边缘中央，未解锁时暗色石门 + 红色警戒符文；`setUnlocked(true)` 后亮起 + 光柱 + 上升粒子；`stairs.x/z` 是玩家可交互的世界坐标。
- 光照：在 `build` 里创建/替换平行光（含阴影，shadow map 2048）+ 半球光 + 火把点光 + 雾（`scene.fog`）；`dispose` 时全部移除并释放。
- `scatterPoints(count, minFromCenter)`：给金币/经验豆撒点用，避开障碍与楼梯。
- `spawnPoints`：至少 16 个贴边刷新锚点（四面平均分布），`Vec2[]`。
- `isInside` / `clampToArena` 精确按方形场地。
- 性能：障碍物用合并几何或复用材质；整层 drawcall 尽量 < 60。
- 允许新增 `src/world/textures.ts`、`src/world/props.ts` 等辅助文件，均归 B。

## 4. C：UI（`src/ui/*`、`index.html`、`src/styles.css`、`src/ui/ui.css` 可选）

### 4.1 `index.html` 必须包含
```html
<div id="app">
  <canvas id="game"></canvas>
  <div id="ui-root"></div>
</div>
<script type="module" src="/src/main.ts"></script>
```
并 `<link rel="stylesheet" href="/src/styles.css">`。`#game` 全屏、`#ui-root` 绝对定位覆盖层且 `pointer-events:none`（按钮/卡片单独开 `pointer-events:auto`）。

### 4.2 `src/ui/hud.ts`

```ts
export function createHud(handlers: HudHandlers): Hud
export interface Hud {
  setCamera(camera: THREE.PerspectiveCamera): void
  update(s: HudSnapshot): void
  showTitle(): void
  hideTitle(): void
  showLevelUp(level: number, choices: UpgradeDef[]): void
  hideLevelUp(): void
  showBoss(name: string, hp: number, maxHp: number): void
  updateBoss(hp: number): void
  hideBoss(): void
  damageNumber(worldPos: THREE.Vector3, amount: number, kind: 'normal' | 'crit' | 'heal' | 'gold'): void
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void
  showPrompt(text: string | null): void
  showFloorBanner(floor: number, name: string, subtitle: string): void
  showGameOver(stats: RunStats): void
  showVictory(stats: RunStats): void
  hideEnd(): void
  setPaused(paused: boolean): void
  setMuted(muted: boolean): void
  destroy(): void
}
```
要求：
- **标题页**：游戏名「残响高塔 / ECHO SPIRE」，像素风标题、难度三选（休闲/标准/噩梦，调用 `handlers.onStart(difficulty)`）、操作说明、开始按钮；首次点击触发 `Audio` 解锁由 Lead 处理。
- **HUD**：左上楼层与目标进度（击杀 quota / 计时）。`HudSnapshot.room === true` 时，左上角改为「时空房间 · 探索」并显示 `roomName` / `roomObjective`，不显示本层击杀配额；Boss 血条仍由 `snapshot.boss` 驱动。
- 右上金币/等级/击杀；底部左侧 HP 条（数字）+ 经验条（等级）、底部右侧回旋刃/属性小提示；中央下方 `showPrompt`（"走到阶梯旁按 E"）。
- **升级三选一**：卡片展示图标、名称、描述、稀有度配色（common/rare/epic），点击或按 1/2/3 选择，回调 `handlers.onUpgradePick(id)`；面板出现时暂停感（模糊背景）。
- **Boss 血条**：屏幕上方横向血条 + 名字 + 阶段标记。
- **飘字**：世界坐标 → 屏幕坐标投影，普通白、暴击黄大红字、金币金、回血绿；向上飘 + 淡出，DOM 实现，同屏上限 40。
- **结束页**：死亡/通关两种文案 + 统计（层数/等级/击杀/金币/用时）+ 重新开始按钮（`handlers.onRestart`）。
- **楼层横幅**：进入新层时「第 N 层 · 名称」大字，2 秒后淡出。
- 响应式：适配 1280×720 以上；移动端/触屏不保证可玩，HUD 不遮挡中心战斗区；中文字体栈 `"Microsoft YaHei", "PingFang SC", sans-serif`。
- 风格：深色玻璃拟态 + 琥珀/青色霓虹描边 + 像素字体感（`font-weight:700; letter-spacing`），不要用外部字体/CDN。
- `update` 每帧调用（60fps），避免频繁 DOM 重建：数值用 textContent 缓存，条用 transform/width。

## 5. 联调约定
- 所有实体 `group` 由 Lead `scene.add`。
- 所有模块 `dispose()` 必须真正释放 geometry/material/texture 并从场景移除。
- Lead 会在最后统一 `tsc --noEmit`，请保证类型正确（strict）。
- 不要改 `src/types.ts`、`src/data/*`、`src/core/*`、`src/main.ts`、`package.json`。需要新字段先告诉 Lead。

---

## 6. v4.8 增量契约（房间 / 新敌人 / Boss 变体）

### 6.1 类型

```ts
export type EnemyKind = 'small' | 'brute' | 'elite' | 'caster' | 'spear' | 'bomber'
export type BossKind = 'king' | 'warlord' | 'witch'
export type RoomNpcKind = 'merchant' | 'oracle' | 'warden' | 'guide'

export interface HudSnapshot {
  // ...既有字段
  /** 玩家当前处于时空房间；为 true 时 HUD 隐藏本层击杀配额 */
  room?: boolean
  /** 例：「荒弃庭院 · 宝藏密室」 */
  roomName?: string
  /** 例：「宝藏守卫 · 按 E 打开房间宝箱」/「从出口裂隙离开房间」 */
  roomObjective?: string
}
```

- `TunnelOffer` / `TunnelPayload` 结构不变；`TunnelRoom` 仍为
  `chest | skill-card | merchant | altar | mob-wave | elite-fight | rest | boss`。
- `TunnelType` 的权重来自 `balance.portals.weights`：
  `reward 0.32 / trade 0.28 / battle 0.20 / rest 0.20`，合计 1。
  `rest` 是独立兜底类别，不是“空门”。

### 6.2 房间流程（`src/game.ts`）

1. 清层 → 弹层末奖励/觉醒 → 时空隧道三选一（`pickTunnel(id)`）。
2. `pickTunnel` 选中后调用内部 `enterRoomMap(offer)`：
   - 清空场上残留敌人、弹幕、炸弹、待刷列表；
   - 玩家落在房间入口侧，生成 `RoomNpc`，`layerTotal=0`，HUD 进入 `room` 模式；
   - **不**直接结算奖励，必须走到 NPC 前按 E。
3. `interactRoomNpc()` 按 `offer.room` 分派：
   - `chest` / `skill-card`：立即结算，`completeRoomMap()`；
   - `rest`：回血 + 充能，`completeRoomMap()`；
   - `merchant`：进入房间商店 `shopMode='room'`，离开商店后回到房间并生成裂隙；
   - `altar`：扣金换祝福，随后生成裂隙；
   - `mob-wave` / `elite-fight`：`startRoomBattle(count, elite)`，分批刷怪；
   - `boss`：`startRoomBossBattle()`，生成当前阶段 Boss。
4. `completeRoomMap(message)`：
   - 标记 `room.resolved = true`，清空房间战斗配额；
   - 在入口侧生成 `RoomPortal`（`时空裂隙`），提示「按 E 离开房间」。
5. 玩家靠近裂隙按 E → `leaveRoomMap()`：
   - dispose NPC / 裂隙 → `proceedToShop()` → 标准商店 → 下一层/阶段循环。
6. 房间怪潮使用 `roomSpawnRemaining/roomSpawnIndex/roomSpawnTimer` 分批进场：
   场上约 12 只上限，约每 0.42s 补一批，避免 30+ 只同帧生成。

### 6.3 `src/entities/roomNpc.ts`

```ts
export class RoomNpc {
  readonly group: THREE.Group   // 精灵 + 影子 + 地环，共 3 个对象
  readonly kind: RoomNpcKind
  readonly title: string
  readonly hint: string
  x: number
  z: number
  constructor(scene: THREE.Scene, room: TunnelRoom, x: number, z: number)
  update(dt: number): void
  dispose(): void
}

export class RoomPortal {
  readonly group: THREE.Group   // 传送门精灵 + 地面符文，共 2 个对象
  readonly title: string        // 时空裂隙
  readonly hint: string         // 按 E 离开房间
  x: number
  z: number
  constructor(scene: THREE.Scene, x: number, z: number)
  update(dt: number): void
  dispose(): void
}

export function roomNpcInfo(room: TunnelRoom): { kind: RoomNpcKind; title: string; hint: string }
```

- 全部程序化 `CanvasTexture` / `Sprite` / `MeshBasicMaterial`，**不新增光源**。
- `RoomPortal` 固定 2 个 drawcall；`RoomNpc` 固定 3 个。
- `dispose()` 必须把 group 从场景移除并释放 geometry/material/texture。

### 6.4 敌人 & Boss

- `spear`：长矛手，蓄力突刺；预警 `spear-windup` 约 0.55s，冷却约 4.2s。
- `bomber`：爆破手，抛物线炸弹 + 落点预警圈；炸弹纹理 `bombTexture()` 为 24×24 像素图，
  世界尺寸 0.98，最多 10 枚同屏。
- `createBoss(kind, x, z, elite, stage)` / 内部 `startRoomBossBattle()`：
  - 阶段 1：`king` 哥布林之王；
  - 阶段 2：`warlord` 哥布林督军（赤褐/暗红，血量更高，召唤更凶）；
  - 阶段 3：`witch` 巫王（紫皮/青金，弹幕更密，预警偏紫）。
- Boss 复用 `assets/art_raw/boss_king.png` 图集做调色变体；缺图时自动回退
  `buildKingAtlas(kind)` 程序化图集。`kingSprite(kind)` 按 `king|warlord|witch` 缓存。
- Boss HUD 名字来自 `boss.title`（`HudSnapshot.boss.name`），房间 Boss 目标写在
  `roomObjective`（例：「房间首领 · 哥布林之王」）。

### 6.5 HUD / 调试

- 房间 HUD 的 `is-boss-layer` 类只在**非房间** Boss 层出现；
  房间 Boss 用血条 + `roomObjective` 表达，避免与「时空房间 · 探索」冲突。
- 测试/调试入口保持：
  - `window.__goblinTower`：`roomMap`、`tunnelOffers`、`shopMode`、`goblins`、
    `goblinKinds`、`bombShots`、`mobMoves`、`layerTotal`、`layerKilled`；
  - `debugJump(layer, difficulty, character, style)`、`debugScreen('tunnel'|'shop'|...)`、
    `debugAdvance(seconds)`、`debugAutoAttack(on)`、`pickTunnel(id)`。
- 世界契约不变：静态场景 drawcall < 80、实时点光 ≤ 6；新特效/敌人在高负载下
  允许短时超过静态预算，但不得新增光源或未池化对象。
