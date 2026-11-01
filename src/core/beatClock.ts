/**
 * 节奏普攻的节拍时钟（纯计算：不碰 DOM、three.js、音频）。
 *
 * 设计口径：
 * - 判定只认这个时钟，**不读 audio.currentTime**。切歌、掉帧、蓝牙耳机都会让播放位置
 *   漂移，而玩家真正跟随的是"稳定网格 + 输出延迟补偿"。延迟补偿见 `offsetMs`。
 * - 时间戳由调用方传入（通常是 performance.now()），便于在 sim/ 里用假时间跑断言。
 * - 默认网格取八分音符：战斗曲 134 BPM → 每拍 447.8ms、网格 223.9ms，
 *   与现有普攻间隔（睦 240ms / 丛雨 220ms）基本重合，所以节奏化不会改变 DPS 量级。
 *
 * 约束：`goodMs` 必须小于 `gridMs / 2`。否则"最近拍点"永远落在 good 窗口内，
 * miss 永远判不出来（等于怎么按都行）。用 `missBandMs` 自查。
 */

export type Judgement = 'perfect' | 'good' | 'miss'

export interface BeatClockConfig {
  /** 曲速 */
  bpm: number
  /** 网格细分：1 = 四分音符，2 = 八分音符 */
  subdivision: number
  /** perfect 窗口（±ms） */
  perfectMs: number
  /** good 窗口（±ms），必须 < 网格的一半 */
  goodMs: number
  /** 输出延迟补偿（ms）：正值表示"听到的拍点比时钟晚" */
  offsetMs: number
}

export const DEFAULT_BEAT_CLOCK: BeatClockConfig = {
  bpm: 134,
  subdivision: 2,
  perfectMs: 35,
  goodMs: 60,
  offsetMs: 0,
}

export interface BeatPosition {
  /** 当前所在网格下标（向下取整，可为负） */
  index: number
  /** 距最近网格点的有符号偏差（ms）：负 = 提前，正 = 滞后 */
  deviationMs: number
  /** 网格格内进度 0..1 */
  phase: number
}

export class BeatClock {
  private bpm: number
  private subdivision: number
  private perfectMs: number
  private goodMs: number
  private offsetMs: number
  private originMs = 0

  constructor(config: Partial<BeatClockConfig> = {}) {
    const merged = { ...DEFAULT_BEAT_CLOCK, ...config }
    this.bpm = Math.max(1, merged.bpm)
    this.subdivision = Math.max(1, Math.round(merged.subdivision))
    this.perfectMs = Math.max(0, merged.perfectMs)
    this.goodMs = Math.max(this.perfectMs, merged.goodMs)
    this.offsetMs = merged.offsetMs
  }

  get config(): Readonly<BeatClockConfig> {
    return {
      bpm: this.bpm,
      subdivision: this.subdivision,
      perfectMs: this.perfectMs,
      goodMs: this.goodMs,
      offsetMs: this.offsetMs,
    }
  }

  /** 一个网格的时长（ms） */
  get gridMs(): number {
    return 60000 / this.bpm / this.subdivision
  }

  /** miss 带宽度（ms）：≤0 说明配置退化，miss 永远判不出来 */
  get missBandMs(): number {
    return this.gridMs / 2 - this.goodMs
  }

  /** 起点时间（ms）：进层时用 reset() 对齐 */
  get origin(): number {
    return this.originMs
  }

  setBpm(bpm: number): void {
    this.bpm = Math.max(1, bpm)
  }

  setOffsetMs(offsetMs: number): void {
    this.offsetMs = offsetMs
  }

  /** 重新对齐网格起点（进层 / 换曲时调用） */
  reset(originMs = 0): void {
    this.originMs = originMs
  }

  /** 网格下标（向下取整）。用于去重：同一格只计一次判定 */
  gridIndex(nowMs: number): number {
    return Math.floor(this.adjusted(nowMs) / this.gridMs)
  }

  position(nowMs: number): BeatPosition {
    const x = this.adjusted(nowMs) / this.gridMs
    const index = Math.floor(x)
    const nearest = Math.round(x)
    return {
      index,
      deviationMs: (x - nearest) * this.gridMs,
      phase: x - index,
    }
  }

  judge(nowMs: number): Judgement {
    const dev = Math.abs(this.position(nowMs).deviationMs)
    if (dev <= this.perfectMs) return 'perfect'
    if (dev <= this.goodMs) return 'good'
    return 'miss'
  }

  /** 距下一个网格点还有多少 ms；正好踩点时返回 0（用于攻击门控） */
  nextGridIn(nowMs: number): number {
    const x = this.adjusted(nowMs) / this.gridMs
    return (Math.ceil(x) - x) * this.gridMs
  }

  /** 调试用一行摘要：`beat#12 dev +34.2ms → good` */
  describe(nowMs: number): string {
    const p = this.position(nowMs)
    const sign = p.deviationMs >= 0 ? '+' : ''
    return `beat#${p.index} dev ${sign}${p.deviationMs.toFixed(1)}ms → ${this.judge(nowMs)}`
  }

  /** 应用延迟补偿后的时间轴 */
  private adjusted(nowMs: number): number {
    return nowMs - this.offsetMs - this.originMs
  }
}
