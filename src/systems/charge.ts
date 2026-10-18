/**
 * 技能充能条：充能只能靠击杀 / 掉落 / 层间起手获得。
 * 层间 50% 起手由 game.ts 调 reset(max, CHARGE_FLOOR_START_RATIO) 完成。
 */
export class ChargeMeter {
  value = 0
  max = 100

  /** 重置上限并按比例填初值（startRatio 0..1） */
  reset(max: number, startRatio = 0): void {
    this.max = Math.max(1, max)
    const ratio = Math.max(0, Math.min(1, startRatio || 0))
    this.value = this.max * ratio
  }

  add(n: number): void {
    if (!Number.isFinite(n) || n <= 0) return
    this.value = Math.min(this.max, this.value + n)
  }

  /** 支付充能：不足返回 false（不扣） */
  spend(cost: number): boolean {
    if (cost <= 0) return true
    if (this.value < cost) return false
    this.value -= cost
    return true
  }

  get ratio(): number {
    return this.max > 0 ? Math.max(0, Math.min(1, this.value / this.max)) : 0
  }

  get ready(): boolean {
    return this.value >= this.max
  }
}
