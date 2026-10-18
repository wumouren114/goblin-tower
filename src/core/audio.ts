/**
 * 《哥布林之塔》音频总线。
 *
 * 两级音源，互为主备：
 *
 * 1. 预渲染素材 —— `assets/audio/*.wav`，由 `scripts/make-audio.mjs` 用纯 Node
 *    离线合成（chiptune 质感、有和声进行与小节结构的 BGM 无缝循环 + 逐个设计的音效）。
 *    这是默认路径。
 * 2. 程序化 WebAudio 合成 —— 素材缺失 / 解码失败 / 浏览器不支持时的静默回退，
 *    保证游戏在任何情况下都不会因为音频而启动失败或静音到完全没有声音。
 *
 * 约束：
 * - 首个用户手势（resume）之后才创建 AudioContext，符合浏览器自动播放策略；
 * - 所有 fetch / decode 错误都被吞掉并记入 `status().missing`，绝不 reject、
 *   不产生 unhandledrejection（main.ts 有全局 fatal overlay）；
 * - 素材缺失时对应音效自动回退到合成版本，BGM 回退到合成 pad + 琶音。
 */

export type BgmTrack = 'title' | 'battle' | 'boss' | 'shop' | 'victory'

export type SfxName =
  | 'hit'
  | 'crit'
  | 'enemy_die'
  | 'coin'
  | 'pickup'
  | 'heal'
  | 'levelup'
  | 'dash'
  | 'hurt'
  | 'boss_roar'
  | 'boss_slam'
  | 'stairs'
  | 'win'
  | 'lose'
  | 'click'
  | 'buy'
  | 'tunnel'
  | 'caster_shot'

export type AudioState = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface AudioStatus {
  state: AudioState
  muted: boolean
  ducked: boolean
  track: BgmTrack | null
  /** true = 当前 BGM 来自 wav 文件，false = 程序化合成回退 */
  usingFile: boolean
  loaded: string[]
  missing: string[]
}

/** BGM 文件基名（不含扩展名）。 */
const BGM_FILES: Record<BgmTrack, string> = {
  title: 'bgm_title',
  battle: 'bgm_battle',
  boss: 'bgm_boss',
  shop: 'bgm_shop',
  victory: 'bgm_victory',
}

const sfxFile = (name: SfxName): string => `sfx_${name}`

/** 18 个音效，顺序与 docs/08-音效BGM提示词.md 第 2 节一致。 */
const SFX_NAMES: SfxName[] = [
  'hit',
  'crit',
  'enemy_die',
  'coin',
  'pickup',
  'heal',
  'levelup',
  'dash',
  'hurt',
  'boss_roar',
  'boss_slam',
  'stairs',
  'win',
  'lose',
  'click',
  'buy',
  'tunnel',
  'caster_shot',
]

/** 需要预加载的全部素材基名（不含扩展名）。 */
const ALL_FILES: string[] = [...Object.values(BGM_FILES), ...SFX_NAMES.map(sfxFile)]

/**
 * 素材 URL：`import.meta.glob(..., { query: '?url' })` 由 Vite 在 dev 直接返回仓库
 * 路径、在 build 时替换成带 hash 的产物地址，所以 wav 不必放进 public/ 也能正确打包。
 * 非 Vite 环境（glob 返回空表）时退化为站点根相对路径。
 */
const GLOB_URLS: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  try {
    const mods = import.meta.glob('../../assets/audio/*.wav', {
      eager: true,
      query: '?url',
      import: 'default',
    }) as Record<string, string>
    for (const [path, url] of Object.entries(mods)) {
      if (typeof url !== 'string') continue
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.wav$/, '')
      out[name] = url
    }
  } catch {
    // 极少数非 Vite 运行环境没有 import.meta.glob：留空表，走下面的相对路径兜底。
  }
  return out
})()

/**
 * 单个素材的候选地址：优先 glob 出来的真实 URL，其次站点根相对路径
 * （dev server 会直接服务仓库根目录下的 assets/）。都失败就回退程序化合成。
 */
function candidates(file: string): string[] {
  const urls: string[] = []
  const primary = GLOB_URLS[file]
  if (primary) urls.push(primary)
  const base = import.meta.env.BASE_URL || '/'
  const rel = `${base}assets/audio/${file}.wav`
  if (!urls.includes(rel)) urls.push(rel)
  return urls
}

/** 合成回退 BGM 的调式参数（不同场景给不同根音 / 速度，避免一成不变）。 */
const SYNTH_BGM: Record<BgmTrack, { root: number; scale: number[]; stepMs: number }> = {
  title: { root: 220, scale: [1, 1.2, 1.335, 1.5, 1.78], stepMs: 620 },
  battle: { root: 220, scale: [1, 1.2, 1.335, 1.5, 1.78], stepMs: 440 },
  boss: { root: 146.83, scale: [1, 1.0595, 1.3348, 1.4983, 1.7818], stepMs: 380 },
  shop: { root: 261.63, scale: [1, 1.2599, 1.4983, 1.7818], stepMs: 700 },
  victory: { root: 293.66, scale: [1, 1.2599, 1.4983, 2], stepMs: 320 },
}

const MASTER_LEVEL = 0.55
const BGM_LEVEL = 0.5
const SFX_LEVEL = 1
const DUCK_FACTOR = 0.28

/** BGM 强度档位（0 安静 / 1 标准 / 2 强调）对应的总线增益。 */
const BGM_INTENSITY_LEVELS = [0.34, 0.5, 0.62] as const

type AudioContextCtor = typeof AudioContext

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 单例音频总线。对外 API 分三组：
 * - 生命周期：init / resume / load / toggleMute / setMuted / status
 * - BGM：startBgm(track) / stopBgm(fadeMs) / duck(on)，另有旧接口 bgmStart / bgmStop
 * - SFX：hit / crit / ... 各一个无参方法，内部按素材表路由到 wav 或合成回退
 */
export class AudioBus {
  muted = false

  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bgmBus: GainNode | null = null
  private sfxBus: GainNode | null = null
  private noise: AudioBuffer | null = null

  private buffers = new Map<string, AudioBuffer>()
  private missing: string[] = []
  private state: AudioState = 'idle'
  private loadPromise: Promise<void> | null = null

  private desired: BgmTrack | null = null
  private currentTrack: BgmTrack | null = null
  private fileBgm = false
  private bgmSource: AudioBufferSourceNode | null = null
  private bgmFileGain: GainNode | null = null

  private synthTimer: number | null = null
  private synthNodes: OscillatorNode[] = []
  private synthPadGain: GainNode | null = null

  private ducked = false
  private duckDepth = DUCK_FACTOR
  private intensity: 0 | 1 | 2 = 1

  constructor() {
    if (typeof window === 'undefined') return
    // 兜底：任意一次点击 / 按键都尝试解锁音频（game.ts 自己也会调 resume）。
    const unlock = (): void => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      this.resume()
    }
    window.addEventListener('pointerdown', unlock, { passive: true })
    window.addEventListener('keydown', unlock)
  }

  // ---------------------------------------------------------------- 生命周期

  init(): void {
    if (this.ctx) return
    try {
      const ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
      if (!ctor) {
        this.state = 'unavailable'
        return
      }
      const ctx = new ctor()
      const master = ctx.createGain()
      master.gain.value = MASTER_LEVEL
      master.connect(ctx.destination)
      const bgm = ctx.createGain()
      bgm.gain.value = BGM_LEVEL
      bgm.connect(master)
      const sfx = ctx.createGain()
      sfx.gain.value = SFX_LEVEL
      sfx.connect(master)
      this.ctx = ctx
      this.master = master
      this.bgmBus = bgm
      this.sfxBus = sfx
      this.createNoise(ctx)
      if (this.muted) master.gain.value = 0
      void this.load()
    } catch {
      this.ctx = null
      this.state = 'unavailable'
    }
  }

  resume(): void {
    this.init()
    if (this.ctx && this.ctx.state === 'suspended') {
      // 自动播放策略下 resume() 可能被拒绝，必须吞掉，避免 unhandledrejection。
      this.ctx.resume().catch(() => {})
    }
  }

  /** 预加载全部 wav（幂等，永不 reject）。返回 Promise 便于需要时 await。 */
  load(): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    this.init()
    const ctx = this.ctx
    if (!ctx) {
      this.state = 'unavailable'
      return Promise.resolve()
    }
    this.state = 'loading'
    const jobs: Array<Promise<void>> = []
    for (const file of ALL_FILES) jobs.push(this.loadOne(ctx, file))
    this.loadPromise = Promise.all(jobs)
      .then(() => {
        this.state = 'ready'
        this.upgradeSynthBgm()
      })
      .catch(() => {
        this.state = 'ready'
      })
    return this.loadPromise
  }

  /** 预加载别名。 */
  preload(): Promise<void> {
    return this.load()
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted)
    return this.muted
  }

  setMuted(value: boolean): void {
    this.muted = value
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master) return
    master.gain.setTargetAtTime(value ? 0 : MASTER_LEVEL, ctx.currentTime, 0.02)
  }

  status(): AudioStatus {
    return {
      state: this.state,
      muted: this.muted,
      ducked: this.ducked,
      track: this.currentTrack,
      usingFile: this.fileBgm,
      loaded: [...this.buffers.keys()],
      missing: [...this.missing],
    }
  }

  /**
   * 暂停 / 恢复时压低 BGM：暂停菜单弹窗时调用 duck(true)，继续时 duck(false)。
   * depth 是保留比例（0.28 = 只剩 28%）。
   */
  duck(on: boolean, depth = DUCK_FACTOR): void {
    this.init()
    this.ducked = on
    this.duckDepth = clamp(depth, 0, 1)
    this.applyBgmLevel()
  }

  /** 按当前强度档位 + duck 状态算 BGM 总线目标增益。 */
  private applyBgmLevel(): void {
    const ctx = this.ctx
    const bus = this.bgmBus
    if (!ctx || !bus) return
    const base = BGM_INTENSITY_LEVELS[this.intensity]
    bus.gain.setTargetAtTime(this.ducked ? base * this.duckDepth : base, ctx.currentTime, 0.08)
  }

  setVolume(vol: { master?: number; bgm?: number; sfx?: number }): void {
    this.init()
    const ctx = this.ctx
    if (!ctx) return
    if (vol.master !== undefined && this.master) {
      this.master.gain.setTargetAtTime(clamp(vol.master, 0, 1), ctx.currentTime, 0.05)
    }
    if (vol.bgm !== undefined && this.bgmBus) {
      this.bgmBus.gain.setTargetAtTime(clamp(vol.bgm, 0, 1), ctx.currentTime, 0.05)
    }
    if (vol.sfx !== undefined && this.sfxBus) {
      this.sfxBus.gain.setTargetAtTime(clamp(vol.sfx, 0, 1), ctx.currentTime, 0.05)
    }
  }

  getVolume(): { master: number; bgm: number; sfx: number } {
    return {
      master: this.master?.gain.value ?? MASTER_LEVEL,
      bgm: this.bgmBus?.gain.value ?? BGM_LEVEL,
      sfx: this.sfxBus?.gain.value ?? SFX_LEVEL,
    }
  }

  /**
   * BGM 强度：0 安静（标题 / 商店）/ 1 标准（普通层）/ 2 强调（Boss 战、残血）。
   * 只调 BGM 总线增益，不改变正在播放的曲子。
   */
  setBgmIntensity(level: 0 | 1 | 2): void {
    this.intensity = level
    this.init()
    this.applyBgmLevel()
  }

  // ---------------------------------------------------------------- BGM

  /**
   * 切换 BGM 段落。素材未就绪时先起合成回退，加载完成后自动无缝换成 wav。
   * fadeMs 控制淡入 / 交叉淡出时长。
   */
  startBgm(track: BgmTrack | null = 'battle', opts: { fadeMs?: number } = {}): void {
    if (track === null) {
      this.stopBgm(opts.fadeMs ?? 700)
      return
    }
    this.desired = track
    this.init()
    if (!this.ctx) return
    if (this.fileBgm && this.currentTrack === track) return
    const buf = this.buffers.get(BGM_FILES[track])
    if (buf) {
      this.stopSynthBgm(260)
      this.playFileBgm(track, buf, opts.fadeMs ?? 450)
      return
    }
    // 素材还没加载好 / 缺失：合成回退（已有合成 BGM 就只换当前标记，不打断）
    if (this.synthTimer === null) this.startSynthBgm(track)
    else this.currentTrack = track
  }

  /** 停止 BGM（默认 500ms 淡出）。 */
  stopBgm(fadeMs = 500): void {
    this.desired = null
    this.currentTrack = null
    this.stopFileBgm(fadeMs)
    this.stopSynthBgm(fadeMs)
  }

  /** 旧接口兼容：game.ts 里原来的 audio.bgmStart() / audio.bgmStop()。 */
  bgmStart(track: BgmTrack = 'battle'): void {
    this.startBgm(track)
  }

  bgmStop(fadeMs = 500): void {
    this.stopBgm(fadeMs)
  }

  private playFileBgm(track: BgmTrack, buf: AudioBuffer, fadeMs: number): void {
    const ctx = this.ctx
    const bus = this.bgmBus
    if (!ctx || !bus) return
    this.stopFileBgm(fadeMs > 0 ? Math.min(fadeMs, 200) : 0)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const gain = ctx.createGain()
    const now = ctx.currentTime
    const fade = Math.max(0.05, fadeMs / 1000)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(1, now + fade)
    src.connect(gain).connect(bus)
    src.start(now)
    this.bgmSource = src
    this.bgmFileGain = gain
    this.fileBgm = true
    this.currentTrack = track
  }

  private stopFileBgm(fadeMs = 400): void {
    const src = this.bgmSource
    const gain = this.bgmFileGain
    const ctx = this.ctx
    this.bgmSource = null
    this.bgmFileGain = null
    this.fileBgm = false
    if (!src || !gain || !ctx) return
    const now = ctx.currentTime
    const fade = Math.max(0.02, fadeMs / 1000)
    try {
      const level = Math.max(0.0001, gain.gain.value)
      gain.gain.cancelScheduledValues(now)
      gain.gain.setValueAtTime(level, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + fade)
    } catch {
      /* ignore */
    }
    try {
      src.stop(now + fade + 0.05)
    } catch {
      /* already stopped */
    }
    src.onended = () => {
      try {
        gain.disconnect()
      } catch {
        /* ignore */
      }
    }
  }

  /** 素材加载完成后，如果还在用合成 BGM，切成 wav。 */
  private upgradeSynthBgm(): void {
    const track = this.desired
    if (!track || this.fileBgm) return
    const buf = this.buffers.get(BGM_FILES[track])
    if (!buf) return
    this.stopSynthBgm(300)
    this.playFileBgm(track, buf, 400)
  }

  private startSynthBgm(track: BgmTrack): void {
    this.init()
    const ctx = this.ctx
    const bus = this.bgmBus
    if (!ctx || !bus || this.synthTimer !== null) return
    this.stopFileBgm(200)
    const spec = SYNTH_BGM[track]
    const pad = ctx.createGain()
    pad.gain.value = 0.05
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 520
    pad.connect(filter).connect(bus)
    this.synthPadGain = pad
    for (const f of [spec.root, spec.root * 1.5]) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = f
      osc.connect(pad)
      osc.start()
      this.synthNodes.push(osc)
    }
    this.currentTrack = track
    this.fileBgm = false
    let step = 0
    this.synthTimer = window.setInterval(() => {
      if (!this.ctx || this.muted) return
      const note = spec.root * spec.scale[(step * 3 + (step >> 2)) % spec.scale.length]
      this.synthTone(bus, note, 0.32, 'sine', 0.055, undefined, 0)
      if (step % 4 === 0) this.synthTone(bus, note / 2, 0.5, 'triangle', 0.045)
      step += 1
    }, spec.stepMs)
  }

  private stopSynthBgm(fadeMs = 0): void {
    if (this.synthTimer !== null) {
      window.clearInterval(this.synthTimer)
      this.synthTimer = null
    }
    const pad = this.synthPadGain
    const nodes = this.synthNodes
    const ctx = this.ctx
    this.synthPadGain = null
    this.synthNodes = []
    if (!pad || !ctx) {
      for (const osc of nodes) {
        try {
          osc.stop()
        } catch {
          /* ignore */
        }
      }
      return
    }
    const now = ctx.currentTime
    const fade = Math.max(0.02, fadeMs / 1000)
    try {
      pad.gain.cancelScheduledValues(now)
      pad.gain.setValueAtTime(Math.max(0.0001, pad.gain.value), now)
      pad.gain.exponentialRampToValueAtTime(0.0001, now + fade)
    } catch {
      /* ignore */
    }
    window.setTimeout(() => {
      for (const osc of nodes) {
        try {
          osc.stop()
        } catch {
          /* ignore */
        }
      }
      try {
        pad.disconnect()
      } catch {
        /* ignore */
      }
    }, fade * 1000 + 80)
  }

  // ---------------------------------------------------------------- SFX

  /** 通用播放入口：有 wav 用 wav，没有就用合成回退。 */
  play(name: SfxName, opts: { volume?: number; rate?: number } = {}): void {
    if (this.muted) return
    this.init()
    const ctx = this.ctx
    const bus = this.sfxBus
    if (!ctx || !bus) return
    const buf = this.buffers.get(sfxFile(name))
    if (!buf) {
      this.synthSfx(name)
      return
    }
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = clamp(opts.rate ?? 1, 0.5, 2)
    const gain = ctx.createGain()
    gain.gain.value = clamp(opts.volume ?? 1, 0, 4)
    src.connect(gain).connect(bus)
    src.start()
    src.onended = () => {
      try {
        gain.disconnect()
      } catch {
        /* ignore */
      }
    }
  }

  /** 按名字播放（未知名字静默忽略，方便从事件 / 数据里透传）。 */
  playSfx(name: SfxName | string, opts: { volume?: number; rate?: number } = {}): void {
    if (!SFX_NAMES.includes(name as SfxName)) return
    this.play(name as SfxName, opts)
  }

  hit(): void {
    this.play('hit', { rate: 0.94 + Math.random() * 0.12 })
  }

  crit(): void {
    this.play('crit', { rate: 0.97 + Math.random() * 0.07 })
  }

  pickup(): void {
    this.play('pickup')
  }

  coin(): void {
    this.play('coin', { rate: 0.92 + Math.random() * 0.16 })
  }

  heal(): void {
    this.play('heal')
  }

  levelUp(): void {
    this.play('levelup')
  }

  dash(): void {
    this.play('dash')
  }

  hurt(): void {
    this.play('hurt', { rate: 0.92 + Math.random() * 0.16 })
  }

  enemyDie(): void {
    this.play('enemy_die', { rate: 0.9 + Math.random() * 0.25 })
  }

  bossRoar(): void {
    this.play('boss_roar')
  }

  bossSlam(): void {
    this.play('boss_slam')
  }

  stairs(): void {
    this.play('stairs')
  }

  win(): void {
    // win 是长音收束型号角，峰值 -5dBFS 但 RMS 只有 -24dBFS，直接播会被
    // bgm_victory（-19dBFS）盖住；这里补 ~2.6dB，峰值仍在 -1.5dBFS 以内。
    this.play('win', { volume: 1.35 })
  }

  lose(): void {
    this.play('lose')
  }

  click(): void {
    this.play('click')
  }

  buy(): void {
    this.play('buy')
  }

  tunnel(): void {
    this.play('tunnel')
  }

  casterShot(): void {
    this.play('caster_shot', { rate: 0.95 + Math.random() * 0.1 })
  }

  // ---------------------------------------------------------------- 加载

  private async loadOne(ctx: AudioContext, file: string): Promise<void> {
    for (const url of candidates(file)) {
      const bytes = await this.fetchBytes(url)
      if (!bytes) continue
      const buf = await this.decode(ctx, bytes)
      if (!buf) continue
      this.buffers.set(file, buf)
      return
    }
    this.missing.push(file)
  }

  private async fetchBytes(url: string): Promise<ArrayBuffer | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      return await res.arrayBuffer()
    } catch {
      return null
    }
  }

  private decode(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    return new Promise<AudioBuffer | null>((resolve) => {
      let settled = false
      const done = (buf: AudioBuffer | null): void => {
        if (settled) return
        settled = true
        resolve(buf)
      }
      try {
        const ret = ctx.decodeAudioData(
          bytes,
          (buf) => done(buf),
          () => done(null),
        )
        if (ret && typeof ret.then === 'function') ret.then((buf) => done(buf), () => done(null))
      } catch {
        done(null)
      }
    })
  }

  // ---------------------------------------------------------------- 合成回退

  private createNoise(ctx: AudioContext): void {
    const len = Math.floor(ctx.sampleRate * 0.5)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this.noise = buf
  }

  private synthTone(
    dest: AudioNode | null,
    freq: number,
    dur: number,
    type: OscillatorType = 'square',
    vol = 0.3,
    slideTo?: number,
    delay = 0,
  ): void {
    const ctx = this.ctx
    if (!ctx || !dest || this.muted) return
    const t0 = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, t0)
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur)
    }
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(gain).connect(dest)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  private synthBurst(
    dest: AudioNode | null,
    dur = 0.12,
    vol = 0.25,
    hp = 800,
    lp = 5000,
    delay = 0,
  ): void {
    const ctx = this.ctx
    if (!ctx || !dest || !this.noise || this.muted) return
    const t0 = ctx.currentTime + delay
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hpf = ctx.createBiquadFilter()
    hpf.type = 'highpass'
    hpf.frequency.value = hp
    const lpf = ctx.createBiquadFilter()
    lpf.type = 'lowpass'
    lpf.frequency.value = lp
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(vol, t0)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(hpf).connect(lpf).connect(gain).connect(dest)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  private synthSfx(name: SfxName): void {
    const bus = this.sfxBus
    if (!bus) return
    const tone = (f: number, d: number, t: OscillatorType = 'square', v = 0.3, s?: number, dl = 0): void =>
      this.synthTone(bus, f, d, t, v, s, dl)
    const burst = (d = 0.12, v = 0.25, hp = 800, lp = 5000, dl = 0): void =>
      this.synthBurst(bus, d, v, hp, lp, dl)
    switch (name) {
      case 'hit':
        burst(0.07, 0.16, 1200, 6000)
        tone(160, 0.06, 'square', 0.08, 90)
        break
      case 'crit':
        burst(0.05, 0.2, 1800, 8000)
        tone(880, 0.08, 'square', 0.1, 440)
        break
      case 'pickup':
        tone(880, 0.06, 'triangle', 0.1, 1320)
        break
      case 'coin':
        tone(1046, 0.05, 'square', 0.09, 1568)
        tone(1568, 0.09, 'triangle', 0.08, 2093, 0.04)
        break
      case 'heal':
        tone(523, 0.12, 'sine', 0.16, 784)
        tone(784, 0.16, 'sine', 0.12, 1046, 0.08)
        break
      case 'levelup':
        ;[523, 659, 784, 1046, 1318].forEach((n, i) => tone(n, 0.16, 'triangle', 0.16, n * 1.01, i * 0.07))
        break
      case 'dash':
        burst(0.16, 0.12, 500, 2500)
        tone(220, 0.12, 'sawtooth', 0.05, 660)
        break
      case 'hurt':
        burst(0.2, 0.3, 200, 1200)
        tone(180, 0.22, 'sawtooth', 0.18, 60)
        break
      case 'enemy_die':
        burst(0.1, 0.1, 300, 1600)
        tone(240, 0.08, 'square', 0.05, 120)
        break
      case 'boss_roar':
        tone(70, 0.9, 'sawtooth', 0.22, 42)
        burst(0.8, 0.14, 80, 700)
        break
      case 'boss_slam':
        tone(90, 0.35, 'sine', 0.3, 34)
        burst(0.3, 0.24, 120, 900)
        break
      case 'stairs':
        ;[392, 523, 659].forEach((n, i) => tone(n, 0.3, 'sine', 0.12, n, i * 0.12))
        break
      case 'win': {
        const melody = [523, 659, 784, 1046, 784, 1046, 1318, 1568]
        melody.forEach((n, i) => {
          tone(n, 0.28, 'triangle', 0.16, n, i * 0.14)
          tone(n / 2, 0.28, 'sine', 0.1, n / 2, i * 0.14)
        })
        break
      }
      case 'lose':
        ;[392, 330, 262, 196].forEach((n, i) => tone(n, 0.34, 'triangle', 0.18, n * 0.98, i * 0.18))
        break
      case 'click':
        tone(660, 0.04, 'square', 0.06)
        break
      case 'buy':
        tone(1174, 0.06, 'square', 0.08, 1568)
        tone(1568, 0.1, 'triangle', 0.07, 2093, 0.05)
        break
      case 'tunnel':
        burst(0.5, 0.1, 300, 2200)
        tone(220, 0.5, 'sine', 0.08, 110)
        break
      case 'caster_shot':
        tone(520, 0.12, 'sawtooth', 0.08, 1400)
        burst(0.06, 0.08, 2000, 7000)
        break
      default:
        break
    }
  }
}

export const audio = new AudioBus()
