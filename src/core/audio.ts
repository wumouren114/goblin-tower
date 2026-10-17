/**
 * 极简程序化音效（WebAudio 合成，零素材依赖）。
 * 第一次用户交互后才会真正发声，符合浏览器自动播放策略。
 */
export class AudioBus {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private noise: AudioBuffer | null = null
  muted = false

  init(): void {
    if (this.ctx) return
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return
    this.ctx = new Ctor()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0.35
    this.master.connect(this.ctx.destination)
    const len = Math.floor(this.ctx.sampleRate * 0.5)
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noise = buf
  }

  resume(): void {
    this.init()
    if (this.ctx?.state === 'suspended') void this.ctx.resume()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.35, this.ctx.currentTime, 0.02)
    }
    return this.muted
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    vol = 0.3,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.ctx || !this.master || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const osc = this.ctx.createOscillator()
    const gain = this.ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private burst(dur = 0.12, vol = 0.25, hp = 800, lp = 5000, delay = 0): void {
    if (!this.ctx || !this.master || !this.noise || this.muted) return
    const t0 = this.ctx.currentTime + delay
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    const hpf = this.ctx.createBiquadFilter()
    hpf.type = 'highpass'
    hpf.frequency.value = hp
    const lpf = this.ctx.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = lp
    const gain = this.ctx.createGain()
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(hpf).connect(lpf).connect(gain).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  hit(): void {
    this.burst(0.07, 0.16, 1200, 6000)
    this.tone(160, 0.06, 'square', 0.08, 90)
  }

  crit(): void {
    this.burst(0.05, 0.2, 1800, 8000)
    this.tone(880, 0.08, 'square', 0.1, 440)
  }

  pickup(): void {
    this.tone(880, 0.06, 'triangle', 0.1, 1320)
  }

  coin(): void {
    this.tone(1046, 0.05, 'square', 0.09, 1568)
    this.tone(1568, 0.09, 'triangle', 0.08, 2093, 0.04)
  }

  heal(): void {
    this.tone(523, 0.12, 'sine', 0.16, 784)
    this.tone(784, 0.16, 'sine', 0.12, 1046, 0.08)
  }

  levelUp(): void {
    const notes = [523, 659, 784, 1046, 1318]
    notes.forEach((n, i) => this.tone(n, 0.16, 'triangle', 0.16, n * 1.01, i * 0.07))
  }

  dash(): void {
    this.burst(0.16, 0.12, 500, 2500)
    this.tone(220, 0.12, 'sawtooth', 0.05, 660)
  }

  hurt(): void {
    this.burst(0.2, 0.3, 200, 1200)
    this.tone(180, 0.22, 'sawtooth', 0.18, 60)
  }

  enemyDie(): void {
    this.burst(0.1, 0.1, 300, 1600)
    this.tone(240, 0.08, 'square', 0.05, 120)
  }

  bossRoar(): void {
    this.tone(70, 0.9, 'sawtooth', 0.22, 42)
    this.burst(0.8, 0.14, 80, 700)
  }

  stairs(): void {
    ;[392, 523, 659].forEach((n, i) => this.tone(n, 0.3, 'sine', 0.12, n, i * 0.12))
  }

  win(): void {
    const melody = [523, 659, 784, 1046, 784, 1046, 1318, 1568]
    melody.forEach((n, i) => {
      this.tone(n, 0.28, 'triangle', 0.16, n, i * 0.14)
      this.tone(n / 2, 0.28, 'sine', 0.1, n / 2, i * 0.14)
    })
  }

  lose(): void {
    ;[392, 330, 262, 196].forEach((n, i) => this.tone(n, 0.34, 'triangle', 0.18, n * 0.98, i * 0.18))
  }

  click(): void {
    this.tone(660, 0.04, 'square', 0.06)
  }
}

export const audio = new AudioBus()
