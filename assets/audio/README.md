# assets/audio —— 离线合成的游戏音频

本目录的 23 个 `.wav` 全部由 `scripts/make-audio.mjs` 用**纯 Node（零依赖）**离线渲染，
不包含任何外部素材、不需要联网、不需要音频 API。`audio-manifest.json` 记录每个文件的
尺寸 / sha256 / 采样数 / 峰值 / RMS / 时长（BGM 还有 bpm、小节数），用来给
`scripts/check-audio.mjs` 做一致性校验。

- 规格：22050Hz、单声道、16bit PCM，峰值 ≤ -1dBFS，无削波
- 总量：6.52MB（预算 8MB）
- BGM：整数小节，首尾交叉淡化 + 循环点两侧保持发声，可无缝 `loop = true` 循环
- 命名：与 `docs/08-音效BGM提示词.md` 一致，只是扩展名统一为 `.wav`

## 重新生成

```bash
node scripts/make-audio.mjs                # 全部重渲染 + 重写 manifest（确定性，逐字节可复现）
node scripts/make-audio.mjs --only=bgm_battle,sfx_hit   # 只渲染指定条目，不写 manifest
node scripts/make-audio.mjs --out=tmp/audio            # 输出到别的目录试听
```

## 校验

```bash
node scripts/check-audio.mjs            # 分组通过/失败统计，失败时逐条打印原因
node scripts/check-audio.mjs --verbose  # 追加每个文件的明细
node scripts/check-audio.mjs --json     # 机器可读结果
```

校验内容：清单/文件一一对应、WAV 头与 PCM16/单声道/采样率、SFX 时长是否落在 docs
规定区间、峰值与 RMS、是否削波或带 DC 偏置、BGM 首尾静音与循环切点连续性、
sha256 是否与清单一致、`src/core/audio.ts` 是否仍提供 `src/game.ts` 用到的全部接口。

**不要手改 wav 文件**：sha256 与 manifest 绑定，改了之后再跑 check 会报错；要调音色请改
`scripts/make-audio.mjs` 后重新生成。

## 产物清单

### BGM（5 首）

| 文件 | 用途 | 时长 | BPM × 小节 | 和声进行 | 峰值 | RMS |
| --- | --- | --- | --- | --- | --- | --- |
| `bgm_title.wav` | 标题/准备 | 34.29s | 84 × 12 | F–Dm–Bb–C 循环 | -9.7 | -21.0 |
| `bgm_battle.wav` | 普通层战斗（A/B 段） | 42.99s | 134 × 24 | Em–Em–C–C–G–D–Em–B7 / C–C–D–D–Em–Em–B7–B7 | -2.0 | -17.5 |
| `bgm_boss.wav` | Boss 战 | 32.43s | 148 × 20 | Dm–Bb–Gm–A 为主，末段 C–A7 紧张化 | -2.4 | -17.0 |
| `bgm_shop.wav` | 商店 | 19.20s | 100 × 8 | C–Am–F–G 循环 | -5.6 | -21.0 |
| `bgm_victory.wav` | 通关 | 16.00s | 120 × 8 | C–G–Am–F–C–F–G–C | -1.0 | -19.2 |

配器：三角波/锯齿波贝斯 + 三和弦 pad + 方波琶音 + 方波主旋律（battle/boss 叠低八度与
detune 加厚），鼓组为合成 kick/snare/hat/open/tom，battle 有 4 小节一次的 tom 过门，
boss 有 16 分 hat 与半音紧张音。全部无采样、无外部素材。

### SFX（18 个）

| 文件 | 场景 | 时长 | 峰值 | RMS |
| --- | --- | --- | --- | --- |
| `sfx_hit.wav` | 普攻命中 | 75ms | -6 | -19.3 |
| `sfx_crit.wav` | 暴击 | 115ms | -4 | -18.4 |
| `sfx_enemy_die.wav` | 小怪死亡 | 185ms | -7 | -17.6 |
| `sfx_coin.wav` | 拾取金币 | 130ms | -6 | -15.7 |
| `sfx_pickup.wav` | 拾取经验/米饭/卡 | 100ms | -9 | -19.2 |
| `sfx_heal.wav` | 回血 | 290ms | -7 | -15.8 |
| `sfx_levelup.wav` | 升级/拿卡 | 920ms | -4 | -15.8 |
| `sfx_dash.wav` | 冲刺 | 220ms | -7 | -22.4 |
| `sfx_hurt.wav` | 玩家受击 | 185ms | -5 | -16.8 |
| `sfx_boss_roar.wav` | Boss 出场/狂暴 | 1280ms | -3 | -15.1 |
| `sfx_boss_slam.wav` | Boss 砸地 | 680ms | -3 | -15.1 |
| `sfx_stairs.wav` | 下一层 | 580ms | -6 | -18.6 |
| `sfx_win.wav` | 通关 | 2600ms | -5 | -24.0 |
| `sfx_lose.wav` | 失败 | 1900ms | -4 | -17.7 |
| `sfx_click.wav` | UI 点击 | 40ms | -16 | -28.5 |
| `sfx_buy.wav` | 商店购买 | 100ms | -6 | -16.0 |
| `sfx_tunnel.wav` | 隧道门开启 | 650ms | -5 | -17.5 |
| `sfx_caster_shot.wav` | 咒术师弹幕 | 125ms | -7 | -20.2 |

## 运行时加载

`src/core/audio.ts` 用 `new URL('../../assets/audio/xxx.wav', import.meta.url)` 让 Vite 在
dev/build 阶段解析真实资源地址；首次用户手势后并行 `fetch + decodeAudioData` 预加载。
任何一步失败都会被吞掉并回退到程序化合成（`status().missing` 里能看到缺了哪些），
不会产生未捕获的 Promise，也不会阻塞游戏启动。
