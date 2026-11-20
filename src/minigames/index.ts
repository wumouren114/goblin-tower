/**
 * 探索类 · 游戏门小游戏注册表。
 *
 * 按大层（世界回声）分派：
 * - 阶段 1（云上花庭，1~5 层）  → 风车校准（windmill）
 * - 阶段 2（星砂观星台，6~10 层）→ 星轨连线（starlines）
 * - 阶段 3（黄铜钟塔，11+ 层）  → 齿轮啮合（gears）
 */
import { echoMemoryMiniGame } from './echoMemory'
import { gearsMiniGame } from './gears'
import type { MiniGame, MiniGameContext, MiniGameResult } from './shared'
import { starlinesMiniGame } from './starlines'
import { moleTapMiniGame } from './moleTap'
import { towerDropMiniGame } from './towerDrop'
import { windmillMiniGame } from './windmill'

export type { MiniGame, MiniGameContext, MiniGameResult }

export const MINIGAMES: Record<
  'windmill' | 'starlines' | 'gears' | 'tower-drop' | 'mole-tap' | 'echo-memory',
  MiniGame
> = {
  windmill: windmillMiniGame,
  starlines: starlinesMiniGame,
  gears: gearsMiniGame,
  'tower-drop': towerDropMiniGame,
  'mole-tap': moleTapMiniGame,
  'echo-memory': echoMemoryMiniGame,
}

/** 按所在层数返回对应世界回声阶段的小游戏 */
export function minigameForLayer(layer: number): MiniGame {
  // 全地图通用位：偶数层「落点校准」，6n+1 层「哥布林打点」，其余按阶段分派
  if (layer % 2 === 0) return MINIGAMES['tower-drop']
  if (layer % 6 === 1) return MINIGAMES['mole-tap']
  if (layer % 6 === 3) return MINIGAMES['echo-memory']
  if (layer <= 5) return MINIGAMES.windmill
  if (layer <= 10) return MINIGAMES.starlines
  return MINIGAMES.gears
}
