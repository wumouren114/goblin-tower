import type { SceneDef } from '../types'
import type { Rng } from '../core/rng'

/**
 * ============================================================
 *  v3 关卡编排：3 阶段 × 3 场景
 *
 *  - 每阶段 3 个场景：前两个是普通对战房（随机抽取），
 *    第 3 个固定给 Boss 层使用（场景更大、更空旷、主题压暗）
 *  - 归属与数值口径见 docs/05-实现契约-v3.md §5：
 *    halfSize 必须与契约表一致，道具量只影响摆放密度，不影响数值
 *  - 场景本身不带任何战斗数值（quota/计时/难度全部由 balance.ts 决定）
 * ============================================================
 */

/** 阶段名（HUD 横幅 / 存档 / 结算展示） */
export const STAGE_NAMES: string[] = ['云上花庭', '星砂观星台', '黄铜钟塔']

/** 3 阶段 × 3 场景（下标 = stage-1, 场景序号） */
export const STAGE_SCENES: SceneDef[][] = [
  [
    {
      id: 'stage1-hall',
      name: '云上花庭 · 晨光',
      subtitle: '云海之上，被吞下的第一个世界',
      themeId: 'stage1-hall',
      landmark: 'windmill',
      stage: 1,
      halfSize: 15,
      props: 7,
      accent: '#a8d8ff',
    },
    {
      id: 'stage1-candle',
      name: '云上花庭 · 风起',
      subtitle: '风把花瓣吹进空无一人的长廊',
      themeId: 'stage1-candle',
      landmark: 'windmill',
      stage: 1,
      halfSize: 16,
      props: 8,
      accent: '#ffc46b',
    },
    {
      id: 'stage1-courtyard',
      name: '云上花庭 · 花落',
      subtitle: '石阶悬在云端，走一步落一步花',
      themeId: 'stage1-courtyard',
      landmark: 'windmill',
      stage: 1,
      halfSize: 14,
      props: 6,
      accent: '#a8e0c0',
    },
  ],
  [
    {
      id: 'stage2-forge',
      name: '星砂观星台 · 暮色',
      subtitle: '铁砧的节奏，就是哥布林的心跳',
      themeId: 'stage2-forge',
      landmark: 'orrery',
      stage: 2,
      halfSize: 18,
      props: 7,
      accent: '#ff7a3c',
    },
    {
      id: 'stage2-slag',
      name: '星砂观星台 · 砂河',
      subtitle: '脚下每一步都在发烫',
      themeId: 'stage2-slag',
      landmark: 'orrery',
      stage: 2,
      halfSize: 19,
      props: 8,
      accent: '#ff5a2a',
    },
    {
      id: 'stage2-ember',
      name: '星砂观星台 · 流星',
      subtitle: '余烬里还埋着没烧完的骨头',
      themeId: 'stage2-ember',
      landmark: 'orrery',
      stage: 2,
      halfSize: 17,
      props: 7,
      accent: '#ffb054',
    },
  ],
  [
    {
      id: 'stage3-frost',
      name: '黄铜钟塔 · 齿轮厅',
      subtitle: '巨大的齿轮在你头顶缓慢咬合',
      themeId: 'stage3-frost',
      landmark: 'gear',
      stage: 3,
      halfSize: 21,
      props: 7,
      accent: '#64e0c0',
    },
    {
      id: 'stage3-iron',
      name: '黄铜钟塔 · 熔金槽',
      subtitle: '熔金顺着铜槽流进塔的深处',
      themeId: 'stage3-iron',
      landmark: 'gear',
      stage: 3,
      halfSize: 22,
      props: 7,
      accent: '#ff9a3c',
    },
    {
      id: 'stage3-throne',
      name: '黄铜钟塔 · 塔心',
      subtitle: '钟摆之下，哥布林之王戴着偷来的王冠',
      themeId: 'stage3-throne',
      landmark: 'gear',
      stage: 3,
      halfSize: 24,
      props: 6,
      accent: '#ffc84d',
    },
  ],
]

/** 取某阶段的 3 个场景（stage 自动夹到 1..3） */
export function scenesOfStage(stage: number): SceneDef[] {
  const i = Math.min(STAGE_SCENES.length, Math.max(1, Math.round(stage))) - 1
  return STAGE_SCENES[i]
}

/**
 * 抽一个场景：
 *  - Boss 层：固定该阶段第 3 个场景（更空旷的 Boss 房）
 *  - 普通层：从第 1/2 个场景里随机
 */
export function pickScene(stage: number, isBoss: boolean, rng: Rng): SceneDef {
  const scenes = scenesOfStage(stage)
  if (isBoss) return scenes[2]
  return rng.pick([scenes[0], scenes[1]])
}

/** 按场景 id 反查（存档恢复 / 调试用） */
export function sceneById(id: string): SceneDef | undefined {
  for (const stage of STAGE_SCENES) {
    for (const scene of stage) {
      if (scene.id === id) return scene
    }
  }
  return undefined
}

/** 阶段名（越界时夹到 1..3） */
export function stageName(stage: number): string {
  const i = Math.min(STAGE_NAMES.length, Math.max(1, Math.round(stage))) - 1
  return STAGE_NAMES[i]
}
