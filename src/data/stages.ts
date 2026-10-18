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
export const STAGE_NAMES: string[] = ['苔石遗迹', '熔火工坊', '霜蚀圣所']

/** 3 阶段 × 3 场景（下标 = stage-1, 场景序号） */
export const STAGE_SCENES: SceneDef[][] = [
  [
    {
      id: 'stage1-hall',
      name: '苔石前厅',
      subtitle: '哥布林把守着塔的第一道门',
      themeId: 'stage1-hall',
      stage: 1,
      halfSize: 15,
      props: 5,
      accent: '#9fe3b0',
    },
    {
      id: 'stage1-candle',
      name: '烛影回廊',
      subtitle: '烛火照不亮所有角落',
      themeId: 'stage1-candle',
      stage: 1,
      halfSize: 16,
      props: 6,
      accent: '#ffc46b',
    },
    {
      id: 'stage1-courtyard',
      name: '荒弃庭院',
      subtitle: '苔痕爬满了被遗忘的石阶',
      themeId: 'stage1-courtyard',
      stage: 1,
      halfSize: 14,
      props: 4,
      accent: '#a8e0c0',
    },
  ],
  [
    {
      id: 'stage2-forge',
      name: '熔火铁砧',
      subtitle: '铁砧的节奏，就是哥布林的心跳',
      themeId: 'stage2-forge',
      stage: 2,
      halfSize: 18,
      props: 5,
      accent: '#ff7a3c',
    },
    {
      id: 'stage2-slag',
      name: '熔渣坑道',
      subtitle: '脚下每一步都在发烫',
      themeId: 'stage2-slag',
      stage: 2,
      halfSize: 19,
      props: 6,
      accent: '#ff5a2a',
    },
    {
      id: 'stage2-ember',
      name: '焦土祭坛',
      subtitle: '余烬里还埋着没烧完的骨头',
      themeId: 'stage2-ember',
      stage: 2,
      halfSize: 17,
      props: 5,
      accent: '#ffb054',
    },
  ],
  [
    {
      id: 'stage3-frost',
      name: '霜蚀圣所',
      subtitle: '这里冻住过无数的挑战者',
      themeId: 'stage3-frost',
      stage: 3,
      halfSize: 21,
      props: 5,
      accent: '#8fe3ff',
    },
    {
      id: 'stage3-iron',
      name: '寒铁回廊',
      subtitle: '铁与冰一起锈进了墙里',
      themeId: 'stage3-iron',
      stage: 3,
      halfSize: 22,
      props: 5,
      accent: '#9fd8ff',
    },
    {
      id: 'stage3-throne',
      name: '王座之巅',
      subtitle: '哥布林之王戴着偷来的王冠',
      themeId: 'stage3-throne',
      stage: 3,
      halfSize: 24,
      props: 4,
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
