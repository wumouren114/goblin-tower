/**
 * 《哥布林之塔》离线音频生成器 —— 零依赖（只用 node:fs / node:path / node:crypto）。
 *
 * 用法：
 *   node scripts/make-audio.mjs                         # 生成全部 WAV + audio-manifest.json
 *   node scripts/make-audio.mjs --only=bgm_battle,sfx_hit   # 只重渲指定条目（不写 manifest）
 *   node scripts/make-audio.mjs --out=assets/audio       # 自定义输出目录
 *
 * 规格：22050Hz / 单声道 / 16bit PCM WAV（体积优先）。
 *  - BGM：整数小节渲染，采样数 = 小节数 × 每小节采样数；所有音符/延迟尾音按循环长度
 *    “环绕折叠”，因此首尾天然连续、可无缝循环。
 *  - SFX：峰值按设计表归一化（−16 ~ −2.5 dBFS）。
 *  - 随机数使用固定种子 mulberry32，重复运行逐字节一致（manifest 里有 sha256 可校验）。
 *
 * 声音设计：方波/三角波/锯齿（polyBLEP 抗混叠）/正弦 + 噪声，ADSR 包络，一阶滤波、
 * 循环延迟、软限幅、RMS 归一化。BGM 有明确和声进行、鼓组、A/B 段落与过门。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 22050
const TAU = Math.PI * 2
const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TARGET_PEAK_DB = -1.0 // BGM 峰值上限
const MAX_TOTAL_BYTES = 8 * 1024 * 1024

// ---------------------------------------------------------------- 随机数（确定性）

let rngState = 0x9e3779b9
function seed(n) {
  rngState = n >>> 0
}
function rand() {
  rngState = (rngState + 0x6d2b79f5) >>> 0
  let t = rngState
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
function noise() {
  return rand() * 2 - 1
}

// ---------------------------------------------------------------- 基础工具

function hz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function dbToGain(db) {
  return Math.pow(10, db / 20)
}

function gainToDb(g) {
  return 20 * Math.log10(Math.max(1e-9, g))
}

function mixAdd(buf, loop, idx, v) {
  const n = buf.length
  if (loop) {
    let i = idx % n
    if (i < 0) i += n
    buf[i] += v
  } else if (idx >= 0 && idx < n) {
    buf[idx] += v
  }
}

function polyBlep(t, dt) {
  if (dt <= 0) return 0
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

function oscSample(type, phase, dt, duty) {
  switch (type) {
    case 'sine':
      return Math.sin(TAU * phase)
    case 'tri':
      // 0 → -1, 0.25 → 0, 0.5 → +1, 0.75 → 0, 1 → -1
      return 1 - 4 * Math.abs(phase - 0.5)
    case 'saw':
      return 2 * phase - 1 - polyBlep(phase, dt)
    case 'square': {
      const d = duty === undefined ? 0.5 : duty
      return (phase < d ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase - d + 1) % 1, dt)
    }
    default:
      return Math.sin(TAU * phase)
  }
}

function adsr(t, dur, a, d, s, r) {
  const atk = Math.max(0.0005, a)
  const rel = Math.min(Math.max(0.001, r), dur * 0.85)
  const susEnd = Math.max(atk + Math.max(0.0005, d), dur - rel)
  if (t < atk) return t / atk
  if (t < atk + d) return 1 - (1 - s) * ((t - atk) / Math.max(0.0005, d))
  if (t < susEnd) return s
  const k = Math.min(1, (t - susEnd) / rel)
  return s * (1 - k)
}

/**
 * 单音合成。loop=true 时尾音环绕折叠，保证循环无缝。
 * opts: type sine/tri/saw/square, vol, a/d/s/r, pdecay（打击式指数衰减）, duty, slideTo,
 *       vibrato, vibratoRate, detune（音分）, gate, phase0
 */
function tone(buf, loop, start, dur, freq, opts = {}) {
  const {
    type = 'square',
    vol = 0.2,
    a = 0.004,
    d = 0.05,
    s = 0.6,
    r = 0.06,
    pdecay = 0,
    duty = 0.5,
    slideTo = 0,
    vibrato = 0,
    vibratoRate = 5.5,
    detune = 0,
    gate = 1,
    phase0 = 0,
  } = opts
  const n = Math.max(1, Math.round(dur * SR))
  const len = Math.max(1, Math.round(n * gate))
  const s0 = Math.round(start * SR) // 起始时间一律用秒
  const det = Math.pow(2, detune / 1200)
  const f0 = freq * det
  const f1 = (slideTo > 0 ? slideTo : freq) * det
  let phase = phase0
  for (let i = 0; i < len; i += 1) {
    const t = i / SR
    let f = f1 === f0 ? f0 : f0 * Math.pow(f1 / f0, i / len)
    if (vibrato > 0) f *= 1 + vibrato * Math.sin(TAU * vibratoRate * t)
    phase += f / SR
    if (phase >= 1) phase -= Math.floor(phase)
    let env
    if (pdecay > 0) {
      env = Math.min(1, t / Math.max(0.0005, a)) * Math.exp(-t / pdecay)
    } else {
      env = adsr(t, len / SR, a, d, s, r)
    }
    const v = oscSample(type, phase, f / SR, duty)
    mixAdd(buf, loop, s0 + i, v * env * vol)
  }
}

/**
 * 噪声声部。lp/hp 为一阶滤波截止，sweepLp/sweepHp 为扫频目标。
 */
function noiseVoice(buf, loop, start, dur, opts = {}) {
  const {
    vol = 0.3,
    a = 0.001,
    decay = 0.1,
    lp = 12000,
    hp = 0,
    sweepLp = 0,
    sweepHp = 0,
  } = opts
  const n = Math.max(1, Math.round(dur * SR))
  const s0 = Math.round(start * SR) // 起始时间一律用秒
  let lpState = 0
  let hpPrevIn = 0
  let hpPrevOut = 0
  for (let i = 0; i < n; i += 1) {
    const t = i / SR
    const k = n > 1 ? i / (n - 1) : 0
    const cutLp = Math.max(40, lp + (sweepLp - lp) * k)
    const cutHp = Math.max(0, hp + (sweepHp - hp) * k)
    const white = noise()
    lpState += (1 - Math.exp(-TAU * Math.min(cutLp, SR * 0.45) / SR)) * (white - lpState)
    let x = lpState
    if (cutHp > 0) {
      const aHp = Math.exp(-TAU * Math.min(cutHp, SR * 0.45) / SR)
      const y = aHp * (hpPrevOut + x - hpPrevIn)
      hpPrevIn = x
      hpPrevOut = y
      x = y
    }
    const env = Math.min(1, t / Math.max(0.0002, a)) * Math.exp(-t / Math.max(0.001, decay))
    mixAdd(buf, loop, s0 + i, x * env * vol)
  }
}

// ---------------------------------------------------------------- 鼓组

function kick(buf, loop, start, opts = {}) {
  const vol = opts.vol ?? 0.8
  const len = opts.len ?? 0.14
  tone(buf, loop, start, len, opts.f0 ?? 155, {
    type: 'sine',
    vol,
    a: 0.002,
    pdecay: len * 0.5,
    slideTo: opts.f1 ?? 46,
  })
  noiseVoice(buf, loop, start, Math.min(len, 0.045), { vol: vol * 0.22, lp: 3500, decay: 0.012 })
}

function snare(buf, loop, start, opts = {}) {
  const vol = opts.vol ?? 0.4
  noiseVoice(buf, loop, start, 0.16, { vol, lp: 9500, hp: 700, decay: 0.052 })
  tone(buf, loop, start, 0.085, 190, { type: 'tri', vol: vol * 0.4, pdecay: 0.032, slideTo: 120 })
}

function hat(buf, loop, start, opts = {}) {
  const open = opts.open === true
  noiseVoice(buf, loop, start, open ? 0.13 : opts.len ?? 0.032, {
    vol: opts.vol ?? 0.13,
    hp: 7200,
    lp: 16000,
    decay: open ? 0.06 : 0.013,
  })
}

function crash(buf, loop, start, opts = {}) {
  noiseVoice(buf, loop, start, 0.85, {
    vol: opts.vol ?? 0.2,
    hp: 4200,
    lp: 17000,
    decay: 0.42,
    a: 0.002,
  })
}

function tom(buf, loop, start, opts = {}) {
  const f = opts.freq ?? 165
  tone(buf, loop, start, 0.2, f, { type: 'sine', vol: opts.vol ?? 0.3, pdecay: 0.075, slideTo: f * 0.62 })
  noiseVoice(buf, loop, start, 0.03, { vol: (opts.vol ?? 0.3) * 0.2, lp: 3000, decay: 0.01 })
}

function woodblock(buf, loop, start, opts = {}) {
  const vol = opts.vol ?? 0.1
  tone(buf, loop, start, 0.055, opts.freq ?? 950, { type: 'tri', vol, pdecay: 0.016 })
  tone(buf, loop, start, 0.03, (opts.freq ?? 950) * 1.5, { type: 'square', duty: 0.25, vol: vol * 0.3, pdecay: 0.008 })
}

// ---------------------------------------------------------------- 效果

function onePoleLP(buf, fc, loop) {
  const coef = 1 - Math.exp(-TAU * Math.min(fc, SR * 0.45) / SR)
  const passes = loop ? 2 : 1
  for (let pass = 0; pass < passes; pass += 1) {
    let y = 0
    for (let i = 0; i < buf.length; i += 1) {
      y += coef * (buf[i] - y)
      if (pass === passes - 1) buf[i] = y
    }
  }
}

function onePoleHP(buf, fc, loop) {
  const a = Math.exp(-TAU * Math.min(fc, SR * 0.45) / SR)
  const passes = loop ? 2 : 1
  for (let pass = 0; pass < passes; pass += 1) {
    let prevIn = 0
    let prevOut = 0
    for (let i = 0; i < buf.length; i += 1) {
      const x = buf[i]
      const y = a * (prevOut + x - prevIn)
      prevIn = x
      prevOut = y
      if (pass === passes - 1) buf[i] = y
    }
  }
}

/**
 * 反馈延迟（乒乓感来自单声道简易反馈环）。
 * loop=true 时跑两遍：第二遍的环形缓冲已包含第一遍的尾音，得到周期稳态，
 * 再把湿声并入原缓冲 —— 循环点处延迟尾巴也是连续的。
 */
function delay(buf, timeSec, feedback, mix, loop) {
  const n = buf.length
  const d = Math.max(1, Math.round(timeSec * SR))
  const ring = new Float32Array(d)
  const wet = new Float32Array(n)
  let p = 0
  const passes = loop ? 2 : 1
  for (let pass = 0; pass < passes; pass += 1) {
    for (let i = 0; i < n; i += 1) {
      const read = ring[p]
      ring[p] = buf[i] + read * feedback
      p = (p + 1) % d
      if (pass === passes - 1) wet[i] = read
    }
  }
  for (let i = 0; i < n; i += 1) buf[i] += mix * wet[i]
}

function softClip(buf, drive) {
  const norm = Math.tanh(drive)
  for (let i = 0; i < buf.length; i += 1) buf[i] = Math.tanh(buf[i] * drive) / norm
}

function measure(buf) {
  let peak = 0
  let sum = 0
  let dc = 0
  let clipped = 0
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i]
    const av = Math.abs(v)
    if (av > peak) peak = av
    if (av >= 0.999) clipped += 1
    sum += v * v
    dc += v
  }
  return {
    peak,
    peakDb: gainToDb(peak),
    rms: Math.sqrt(sum / buf.length),
    rmsDb: gainToDb(Math.sqrt(sum / buf.length)),
    dc: dc / buf.length,
    clipped,
  }
}

function scale(buf, g) {
  for (let i = 0; i < buf.length; i += 1) buf[i] *= g
}

function normalizePeak(buf, db) {
  const m = measure(buf)
  if (m.peak > 1e-6) scale(buf, dbToGain(db) / m.peak)
}

function normalizeRms(buf, db, ceilingDb) {
  const m = measure(buf)
  if (m.rms > 1e-9) {
    let g = dbToGain(db) / m.rms
    const ceil = dbToGain(ceilingDb)
    if (m.peak * g > ceil) g = ceil / m.peak
    scale(buf, g)
  }
}

function fadeEdges(buf, fadeInSec, fadeOutSec) {
  const inN = Math.min(buf.length, Math.max(1, Math.round(fadeInSec * SR)))
  const outN = Math.min(buf.length, Math.max(1, Math.round(fadeOutSec * SR)))
  for (let i = 0; i < inN; i += 1) buf[i] *= i / inN
  for (let i = 0; i < outN; i += 1) buf[buf.length - 1 - i] *= i / outN
}

// ---------------------------------------------------------------- WAV 输出

function encodeWav(samples) {
  const n = samples.length
  const data = Buffer.alloc(44 + n * 2)
  data.write('RIFF', 0, 'ascii')
  data.writeUInt32LE(36 + n * 2, 4)
  data.write('WAVE', 8, 'ascii')
  data.write('fmt ', 12, 'ascii')
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20) // PCM
  data.writeUInt16LE(1, 22) // mono
  data.writeUInt32LE(SR, 24)
  data.writeUInt32LE(SR * 1 * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36, 'ascii')
  data.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i += 1) {
    let v = Math.round(samples[i] * 32767)
    if (v > 32767) v = 32767
    if (v < -32768) v = -32768
    data.writeInt16LE(v, 44 + i * 2)
  }
  return data
}

function writeWav(dir, file, samples) {
  const data = encodeWav(samples)
  writeFileSync(join(dir, file), data)
  return {
    file,
    bytes: data.length,
    samples: samples.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}

// ---------------------------------------------------------------- 编曲工具

function createTrack(name, bpm, bars, seedVal, opts = {}) {
  const spb = Math.round((SR * 240) / bpm) // 每小节采样数（4/4）
  const n = spb * bars
  seed(seedVal)
  return {
    name,
    bpm,
    bars,
    spb,
    buf: new Float32Array(n),
    lp: opts.lp ?? 15000,
    rmsDb: opts.rmsDb ?? -18,
    // 16 分音符网格定位；返回秒（tone/noiseVoice 的起始时间单位）
    at: (bar, step = 0) => Math.round(bar * spb + step * (spb / 16)) / SR,
    sec: (steps) => (steps * (spb / 16)) / SR,
  }
}

const CHORDS = {
  F: { bass: 41, tones: [57, 60, 65] },
  Dm: { bass: 38, tones: [57, 62, 65] },
  Bb: { bass: 46, tones: [58, 62, 65] },
  C: { bass: 48, tones: [55, 60, 64] },
  Em: { bass: 40, tones: [55, 59, 64] },
  G: { bass: 43, tones: [55, 59, 62] },
  D: { bass: 50, tones: [57, 62, 66] },
  B7: { bass: 47, tones: [59, 63, 66] },
  Am: { bass: 45, tones: [57, 60, 64] },
  Gm: { bass: 43, tones: [55, 58, 62] },
  A: { bass: 45, tones: [57, 61, 64] },
  A7: { bass: 45, tones: [55, 61, 64] },
}

/** 8 分音符网格旋律：0=休止，-1=延长前一个音，其余为 MIDI 音高。 */
function melody(t, notes, opts = {}) {
  const bars = Math.floor(notes.length / 8)
  for (let b = 0; b < bars; b += 1) {
    for (let s = 0; s < 8; s += 1) {
      const v = notes[b * 8 + s]
      if (!(v > 0)) continue
      let len = 1
      while (s + len < 8 && notes[b * 8 + s + len] === -1) len += 1
      const start = t.at(b, s * 2)
      const dur = t.sec(len * 2)
      const base = { type: 'square', duty: 0.25, vol: 0.16, a: 0.006, pdecay: 0.26 }
      const long = { type: 'square', duty: 0.25, vol: 0.15, a: 0.02, pdecay: 0, d: 0.18, s: 0.55, r: 0.2 }
      tone(t.buf, true, start, dur, hz(v), { ...(len > 1 ? long : base), ...opts })
      if (opts.double) {
        tone(t.buf, true, start, dur, hz(v - 12), {
          type: 'square',
          duty: 0.125,
          vol: 0.05,
          a: 0.01,
          pdecay: len > 1 ? 0 : 0.3,
          d: 0.2,
          s: 0.5,
          r: 0.2,
        })
      }
    }
  }
}

function bassLine(t, bar, root, pattern, opts = {}) {
  for (let s = 0; s < 16; s += 1) {
    const off = pattern[s]
    if (off === null || off === undefined) continue
    tone(t.buf, true, t.at(bar, s), t.sec(opts.lenSteps ?? 1.7), hz(root + off), {
      type: opts.type ?? 'saw',
      vol: opts.vol ?? 0.3,
      a: 0.004,
      pdecay: opts.pdecay ?? 0.12,
      duty: 0.5,
    })
  }
}

function padChord(t, bar, tones, opts = {}) {
  for (const m of tones) {
    // 长度比一小节多 0.5 步：release 从"小节线"正上方开始，再靠 loop 折叠把
    // 尾巴绕回曲首 —— 这样循环点两侧都有 pad 在响，首尾响度接近、听不到断口。
    tone(t.buf, true, t.at(bar), t.sec(16.5), hz(m), {
      type: 'tri',
      vol: opts.vol ?? 0.08,
      a: 0.2,
      d: 0.15,
      s: 0.85,
      r: 0.5,
    })
  }
}

function arpLine(t, bar, tones, opts = {}) {
  const rate = opts.rate ?? 2
  const seq = [...tones, ...tones.map((m) => m + 12)]
  const order = opts.down ? seq.slice().reverse() : seq
  for (let s = 0, k = 0; s < 16; s += rate, k += 1) {
    const m = order[k % order.length]
    tone(t.buf, true, t.at(bar, s), t.sec(rate * 0.85), hz(m), {
      type: 'square',
      duty: 0.125,
      vol: opts.vol ?? 0.055,
      a: 0.004,
      pdecay: opts.pdecay ?? 0.09,
    })
  }
}

function drumBar(t, bar, pat, v = 1) {
  for (const s of pat.kick ?? []) kick(t.buf, true, t.at(bar, s), { vol: 0.78 * v })
  for (const s of pat.snare ?? []) snare(t.buf, true, t.at(bar, s), { vol: 0.36 * v })
  for (const s of pat.ghost ?? []) snare(t.buf, true, t.at(bar, s), { vol: 0.1 * v })
  for (const s of pat.hat ?? []) hat(t.buf, true, t.at(bar, s), { vol: 0.12 * v })
  for (const s of pat.hat16 ?? []) hat(t.buf, true, t.at(bar, s), { vol: 0.065 * v, len: 0.016 })
  for (const s of pat.open ?? []) hat(t.buf, true, t.at(bar, s), { vol: 0.09 * v, open: true })
  for (const s of pat.crash ?? []) crash(t.buf, true, t.at(bar, s), { vol: 0.16 * v })
  for (const s of pat.tomHi ?? []) tom(t.buf, true, t.at(bar, s), { vol: 0.26 * v, freq: 210 })
  for (const s of pat.tomLo ?? []) tom(t.buf, true, t.at(bar, s), { vol: 0.28 * v, freq: 135 })
}

// ---------------------------------------------------------------- BGM 编曲

/** 标题：F – Dm – Bb – C，84 BPM，12 小节，柔和芯片轻音乐 */
function renderTitle() {
  const t = createTrack('bgm_title', 84, 12, 0x7150, { lp: 11000, rmsDb: -21 })
  const prog = ['F', 'Dm', 'Bb', 'C']
  for (let b = 0; b < 12; b += 1) {
    const c = CHORDS[prog[b % 4]]
    // 低音：每小节一个长音（三角波）+ 高八度正弦垫底
    tone(t.buf, true, t.at(b), t.sec(15.6), hz(c.bass), {
      type: 'tri', vol: 0.34, a: 0.05, d: 0.2, s: 0.8, r: 0.55,
    })
    tone(t.buf, true, t.at(b), t.sec(15.6), hz(c.bass + 12), {
      type: 'sine', vol: 0.09, a: 0.25, d: 0.1, s: 0.9, r: 0.6,
    })
    // 和声垫：三和弦（三角）+ 高八度泛音
    padChord(t, b, c.tones, { vol: 0.085 })
    for (const m of c.tones) {
      tone(t.buf, true, t.at(b), t.sec(15.6), hz(m + 12), { type: 'sine', vol: 0.025, a: 0.35, d: 0.1, s: 0.9, r: 0.7 })
    }
    // 琶音：8 分音符方波（12.5% 占空比），后半段高八度
    const tones = [c.tones[0], c.tones[1], c.tones[2], c.tones[0] + 12, c.tones[1] + 12, c.tones[2] + 12]
    for (let s = 0, k = 0; s < 16; s += 2, k += 1) {
      const m = tones[k % tones.length] + (b >= 8 ? 12 : 0)
      tone(t.buf, true, t.at(b, s), t.sec(1.7), hz(m), {
        type: 'square', duty: 0.125, vol: 0.05, a: 0.004, pdecay: 0.2,
      })
    }
    // 极轻的鼓：反拍踩镲，第 5 小节起加木鱼
    for (const s of [2, 6, 10, 14]) hat(t.buf, true, t.at(b, s), { vol: 0.045, len: 0.02 })
    if (b >= 4) for (const s of [4, 12]) woodblock(t.buf, true, t.at(b, s), { vol: 0.045 })
  }
  // 主旋律（A 段 1–8 小节，B 段留白呼吸）
  const lead = [
    69, 72, 74, -1, 77, 74, 72, 69,
    72, -1, 69, 67, 69, -1, 0, 0,
    74, 77, 79, -1, 77, 74, 72, -1,
    69, -1, -1, 0, 72, 74, 72, 0,
    69, 72, 74, 77, 79, -1, 77, 74,
    72, 74, 72, 69, -1, 0, 0, 0,
    70, 72, 74, -1, 77, 74, 72, 70,
    72, -1, 69, 67, 69, -1, 0, 0,
    72, -1, -1, -1, 0, 0, 0, 0,
    74, -1, -1, 0, 72, -1, 0, 0,
    70, -1, -1, -1, 0, 0, 0, 0,
    69, -1, 67, 69, 0, 0, 0, 0,
  ]
  melody(t, lead, { duty: 0.25, vol: 0.13, vibrato: 0.0035, vibratoRate: 5 })
  delay(t.buf, 0.36, 0.26, 0.24, true)
  return t
}

/** 战斗：Em–C–G–D / C–D–Em–B7，134 BPM，24 小节（A8 + B8 + A8） */
function renderBattle() {
  const t = createTrack('bgm_battle', 134, 24, 0x8bad, { lp: 16000, rmsDb: -17.5 })
  const A = ['Em', 'Em', 'C', 'C', 'G', 'D', 'Em', 'B7']
  const B = ['C', 'C', 'D', 'D', 'Em', 'Em', 'B7', 'B7']
  const prog = [...A, ...B, ...A]
  const bassPat = [0, null, 0, null, 0, null, 0, 7, 0, null, 0, null, 0, null, 12, null]
  const bassPatB = [0, 0, null, 0, 0, null, 0, 0, 12, 0, null, 0, 0, null, 7, 0]
  const lead = [
    // A
    76, 79, 83, -1, 81, 79, 76, 74,
    76, -1, 74, 76, 79, -1, 0, 0,
    72, 76, 79, -1, 81, 79, 76, 72,
    74, -1, 76, 79, 81, -1, 0, 0,
    74, 79, 83, -1, 86, 83, 79, 74,
    78, 81, 86, -1, 84, 81, 78, 74,
    76, 79, 83, 86, 88, -1, 86, 83,
    83, 81, 78, 76, 74, -1, 0, 0,
    // B
    72, 76, 79, 84, 83, 79, 76, 72,
    74, 78, 81, 86, 84, 81, 78, 74,
    76, 79, 83, 88, 86, 83, 79, 76,
    76, -1, 74, 76, 79, 83, 79, 76,
    84, 83, 79, 76, 79, 83, 84, -1,
    86, 84, 81, 78, 81, 84, 86, -1,
    83, 81, 78, 76, 74, 78, 81, 83,
    83, -1, 81, 78, 76, -1, 0, 0,
    // A'
    76, 79, 83, -1, 81, 79, 76, 74,
    76, -1, 74, 76, 79, -1, 0, 0,
    72, 76, 79, -1, 81, 79, 76, 72,
    74, -1, 76, 79, 81, -1, 0, 0,
    74, 79, 83, -1, 86, 83, 79, 74,
    78, 81, 86, -1, 84, 81, 78, 74,
    76, 79, 83, 86, 88, -1, 86, 83,
    83, 81, 78, 76, 74, -1, 0, 0,
  ]
  for (let b = 0; b < 24; b += 1) {
    const c = CHORDS[prog[b]]
    const inB = b >= 8 && b < 16
    bassLine(t, b, c.bass, inB ? bassPatB : bassPat, { vol: 0.26, pdecay: 0.11 })
    if (b % 4 === 0) arpLine(t, b, c.tones, { vol: 0.04, rate: 2 })
    else arpLine(t, b, c.tones, { vol: 0.032, rate: 2 })
    padChord(t, b, c.tones, { vol: 0.04 })
    const pat = {
      kick: b % 4 === 3 ? [0, 6, 8, 11, 14, 15] : inB ? [0, 3, 6, 8, 11, 14] : [0, 6, 8, 14],
      snare: [4, 12],
      ghost: b % 2 === 1 ? [7, 15] : [],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      open: [14],
      crash: b === 0 || b === 8 || b === 16 ? [0] : [],
    }
    if (b % 4 === 3) {
      pat.tomHi = [13, 15]
      pat.tomLo = [12, 14]
    }
    drumBar(t, b, pat, inB ? 1.05 : 0.95)
  }
  melody(t, lead, { type: 'square', duty: 0.5, vol: 0.155, double: true })
  // 主音第二层：锯齿轻微加厚
  melody(t, lead.map((v) => (v > 0 ? v : 0)), { type: 'saw', vol: 0.045, detune: 6 })
  delay(t.buf, 0.196, 0.18, 0.16, true)
  return t
}

/** Boss：Dm–Bb–Gm–A，148 BPM，20 小节，紧张野性 */
function renderBoss() {
  const t = createTrack('bgm_boss', 148, 20, 0x60b0, { lp: 15000, rmsDb: -17 })
  const prog = [
    'Dm', 'Dm', 'Bb', 'Bb',
    'Dm', 'Bb', 'Gm', 'A',
    'Dm', 'Bb', 'Gm', 'A',
    'Dm', 'Bb', 'C', 'A7',
    'Dm', 'Bb', 'Gm', 'A',
  ]
  const bassPat = [0, 0, null, 0, 0, null, 0, 0, 0, 0, null, 0, 0, null, 7, 10]
  const bassPatB = [0, null, 0, 0, 12, null, 0, 0, 0, null, 0, 0, 7, null, 10, 0]
  const lead = [
    // 前奏（1–4）
    74, -1, -1, -1, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    77, -1, -1, -1, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    // A（5–12）
    74, 77, 81, -1, 80, 81, 84, 81,
    82, -1, 81, 80, 77, -1, 0, 0,
    74, 77, 81, 84, 86, -1, 84, 81,
    80, 81, 85, 88, 86, -1, 85, 81,
    74, 77, 81, -1, 80, 81, 84, 81,
    82, -1, 81, 80, 77, -1, 0, 0,
    74, 79, 82, -1, 81, 79, 77, 74,
    76, 80, 85, 88, 85, -1, 0, 0,
    // B（13–16）
    86, 84, 81, 77, 80, 81, 84, 86,
    82, 84, 86, 89, 88, 86, 84, 82,
    84, 83, 81, 79, 76, 79, 81, 84,
    85, 84, 81, 80, 81, 85, 88, 85,
    // 再现（17–20）
    74, 77, 81, -1, 80, 81, 84, 81,
    82, -1, 81, 80, 77, -1, 0, 0,
    74, 77, 81, 84, 86, -1, 84, 81,
    80, 81, 85, 88, 86, -1, 85, 81,
  ]
  for (let b = 0; b < 20; b += 1) {
    const c = CHORDS[prog[b]]
    const inB = b >= 12 && b < 16
    bassLine(t, b, c.bass, inB ? bassPatB : bassPat, { vol: 0.3, pdecay: 0.1 })
    tone(t.buf, true, t.at(b, 0), t.sec(15.5), hz(c.bass + 12), { type: 'saw', vol: 0.07, a: 0.02, d: 0.2, s: 0.6, r: 0.3 })
    arpLine(t, b, c.tones, { vol: b >= 4 ? 0.055 : 0.035, rate: 1 })
    padChord(t, b, c.tones, { vol: 0.055 })
    const pat = {
      kick: b % 2 === 1 ? [0, 3, 6, 8, 11, 14] : [0, 3, 6, 8, 10, 14],
      snare: [4, 12],
      ghost: [7, 15, 9],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      hat16: b % 4 === 3 ? [1, 3, 5, 7, 9, 11, 13, 15] : [],
      open: [14],
      crash: b === 0 || b === 4 || b === 8 || b === 12 || b === 16 ? [0] : [],
    }
    if (b === 3 || b === 11 || b === 19) {
      pat.tomHi = [12, 13, 14, 15]
      pat.snare = [4]
    }
    drumBar(t, b, pat, 1.0)
  }
  melody(t, lead, { type: 'square', duty: 0.5, vol: 0.15, vibrato: 0.006, vibratoRate: 6.2 })
  melody(t, lead.map((v) => (v > 0 ? v - 12 : 0)), { type: 'saw', vol: 0.05, detune: 8 })
  delay(t.buf, 0.162, 0.16, 0.14, true)
  return t
}

/** 商店：C–Am–F–G，100 BPM，8 小节，轻快木质 */
function renderShop() {
  const t = createTrack('bgm_shop', 100, 8, 0x5a09, { lp: 14000, rmsDb: -21 })
  const prog = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G']
  const bassPat = [0, null, 0, null, 7, null, 0, null, 0, null, 0, null, 7, null, 12, null]
  const lead = [
    72, 76, 79, 76, 72, 76, 79, 84,
    69, 72, 76, 72, 69, 67, 0, 0,
    70, 74, 77, 74, 70, 74, 77, 82,
    67, 71, 74, 79, 77, 74, 71, 67,
    72, 76, 79, 84, 83, 79, 76, 72,
    69, 72, 76, 81, 79, 76, 72, 69,
    70, 74, 77, 82, 81, 77, 74, 70,
    71, 74, 79, 83, 82, 79, 74, 71,
  ]
  for (let b = 0; b < 8; b += 1) {
    const c = CHORDS[prog[b]]
    bassLine(t, b, c.bass, bassPat, { type: 'tri', vol: 0.32, pdecay: 0, lenSteps: 1.9 })
    padChord(t, b, c.tones, { vol: 0.06 })
    for (let s = 0; s < 16; s += 2) {
      hat(t.buf, true, t.at(b, s), { vol: 0.06, len: 0.02 })
      if (s === 4 || s === 12) woodblock(t.buf, true, t.at(b, s), { vol: 0.07 })
    }
    if (b % 2 === 0) kick(t.buf, true, t.at(b, 0), { vol: 0.4 })
    snare(t.buf, true, t.at(b, 8), { vol: 0.12, })
    arpLine(t, b, c.tones, { vol: 0.035, rate: 4 })
  }
  melody(t, lead, { type: 'square', duty: 0.125, vol: 0.15, vibrato: 0.003 })
  melody(t, lead.map((v) => (v > 0 ? v - 12 : 0)), { type: 'tri', vol: 0.08 })
  delay(t.buf, 0.24, 0.2, 0.18, true)
  return t
}

/** 胜利：C–G–Am–F–C–F–G–C，120 BPM，8 小节号角 */
function renderVictory() {
  const t = createTrack('bgm_victory', 120, 8, 0x71c7, { lp: 15000, rmsDb: -18.5 })
  const prog = ['C', 'G', 'Am', 'F', 'C', 'F', 'G', 'C']
  const bassPat = [0, null, 0, null, 0, null, 0, null, 0, null, 0, null, 7, null, 0, null]
  const lead = [
    72, -1, 76, 79, 84, -1, 83, 79,
    74, -1, 79, 83, 86, -1, 84, 79,
    76, -1, 81, 84, 88, -1, 86, 84,
    77, 81, 84, 89, 88, -1, 84, 77,
    84, -1, 83, 79, 76, 79, 83, 84,
    81, 84, 89, -1, 88, 84, 81, 77,
    79, 83, 86, 89, 88, 86, 83, 79,
    84, -1, 83, 81, 79, -1, 0, 0,
  ]
  for (let b = 0; b < 8; b += 1) {
    const c = CHORDS[prog[b]]
    bassLine(t, b, c.bass, bassPat, { type: 'saw', vol: 0.24, pdecay: 0.14 })
    padChord(t, b, c.tones, { vol: 0.075 })
    arpLine(t, b, c.tones, { vol: 0.05, rate: 2 })
    const pat = {
      kick: b % 4 === 3 ? [0, 6, 8, 12, 14, 15] : [0, 8],
      snare: [4, 12],
      hat: [0, 2, 4, 6, 8, 10, 12, 14],
      open: [14],
    }
    if (b === 0 || b === 4) crash(t.buf, true, t.at(b, 0), { vol: 0.1 })
    if (b === 3 || b === 7) {
      pat.tomHi = [13, 15]
      pat.tomLo = [12, 14]
    }
    drumBar(t, b, pat, 0.85)
  }
  melody(t, lead, { type: 'saw', vol: 0.15, vibrato: 0.004, a: 0.01 })
  melody(t, lead.map((v) => (v > 0 ? v - 12 : 0)), { type: 'square', duty: 0.5, vol: 0.07 })
  // 铜管感和声
  for (let b = 0; b < 8; b += 1) {
    const c = CHORDS[prog[b]]
    for (const m of c.tones) {
      tone(t.buf, true, t.at(b), t.sec(15), hz(m), {
        type: 'saw', vol: 0.035, a: 0.03, d: 0.15, s: 0.7, r: 0.3,
      })
    }
  }
  delay(t.buf, 0.25, 0.2, 0.16, true)
  return t
}

// ---------------------------------------------------------------- BGM 收尾

function finalizeBgm(t) {
  onePoleHP(t.buf, 28, true)
  onePoleLP(t.buf, t.lp, true)
  normalizeRms(t.buf, t.rmsDb, TARGET_PEAK_DB)
  const m = measure(t.buf)
  return {
    kind: 'bgm',
    file: `${t.name}.wav`,
    bpm: t.bpm,
    bars: t.bars,
    samplesPerBar: t.spb,
    samples: t.buf.length,
    durationS: t.buf.length / SR,
    peakDb: m.peakDb,
    rmsDb: m.rmsDb,
    buf: t.buf,
  }
}

// ---------------------------------------------------------------- SFX

const SFX_SPECS = {
  sfx_hit: {
    peakDb: -6,
    render: (b) => {
      noiseVoice(b, false, 0, 0.072, { vol: 0.5, lp: 7000, hp: 1100, decay: 0.017 })
      tone(b, false, 0, 0.06, 190, { type: 'square', duty: 0.5, vol: 0.3, a: 0.001, pdecay: 0.024, slideTo: 88 })
    },
  },
  sfx_crit: {
    peakDb: -4,
    render: (b) => {
      noiseVoice(b, false, 0, 0.055, { vol: 0.38, lp: 12000, hp: 2400, decay: 0.014 })
      tone(b, false, 0, 0.12, 2093, { type: 'square', duty: 0.25, vol: 0.26, a: 0.001, pdecay: 0.045, slideTo: 3136 })
      tone(b, false, 0.014, 0.1, 2637, { type: 'tri', vol: 0.16, a: 0.001, pdecay: 0.04 })
      tone(b, false, 0, 0.07, 1760, { type: 'sine', vol: 0.18, a: 0.001, pdecay: 0.03, slideTo: 2093 })
    },
  },
  sfx_enemy_die: {
    peakDb: -7,
    render: (b) => {
      tone(b, false, 0, 0.18, 340, { type: 'square', duty: 0.5, vol: 0.22, a: 0.002, pdecay: 0.065, slideTo: 70 })
      noiseVoice(b, false, 0, 0.16, { vol: 0.18, lp: 1800, hp: 200, decay: 0.05 })
      tone(b, false, 0.05, 0.1, 720, { type: 'tri', vol: 0.1, a: 0.001, pdecay: 0.035, slideTo: 300 })
    },
  },
  sfx_coin: {
    peakDb: -6,
    render: (b) => {
      tone(b, false, 0, 0.075, 1046.5, { type: 'sine', vol: 0.3, a: 0.001, pdecay: 0.045 })
      tone(b, false, 0, 0.05, 1046.5, { type: 'square', duty: 0.25, vol: 0.06, a: 0.001, pdecay: 0.02 })
      tone(b, false, 0.062, 0.09, 1318.5, { type: 'sine', vol: 0.28, a: 0.001, pdecay: 0.05 })
      tone(b, false, 0.062, 0.05, 1318.5, { type: 'triangle', vol: 0.1, a: 0.001, pdecay: 0.025 })
    },
  },
  sfx_pickup: {
    peakDb: -9,
    render: (b) => {
      tone(b, false, 0, 0.09, 880, { type: 'sine', vol: 0.3, a: 0.003, pdecay: 0.05, slideTo: 1320 })
      tone(b, false, 0.005, 0.07, 1320, { type: 'tri', vol: 0.1, a: 0.002, pdecay: 0.03 })
    },
  },
  sfx_heal: {
    peakDb: -7,
    durationS: 0.29,
    render: (b) => {
      const notes = [523.25, 659.25, 783.99, 1046.5]
      notes.forEach((f, i) => {
        tone(b, false, i * 0.062, 0.24, f, { type: 'sine', vol: 0.22, a: 0.004, pdecay: 0.1 })
        tone(b, false, i * 0.062, 0.12, f, { type: 'tri', vol: 0.07, a: 0.003, pdecay: 0.05 })
      })
      delay(b, 0.11, 0.3, 0.25, false)
    },
  },
  sfx_levelup: {
    peakDb: -4,
    durationS: 0.92,
    render: (b) => {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568]
      notes.forEach((f, i) => {
        const t0 = i * 0.085
        tone(b, false, t0, 0.2, f, { type: 'square', duty: 0.25, vol: 0.18, a: 0.003, pdecay: 0.09 })
        tone(b, false, t0, 0.2, f, { type: 'tri', vol: 0.1, a: 0.003, pdecay: 0.1 })
      })
      noiseVoice(b, false, 0.02, 0.5, { vol: 0.08, hp: 4000, lp: 16000, decay: 0.15 })
      tone(b, false, 0.52, 0.35, 2093, { type: 'sine', vol: 0.2, a: 0.002, pdecay: 0.12 })
      delay(b, 0.12, 0.28, 0.22, false)
    },
  },
  sfx_dash: {
    peakDb: -7,
    render: (b) => {
      noiseVoice(b, false, 0, 0.21, { vol: 0.32, hp: 900, lp: 7000, sweepLp: 1200, sweepHp: 300, decay: 0.085 })
      tone(b, false, 0, 0.13, 180, { type: 'saw', vol: 0.08, a: 0.002, pdecay: 0.06, slideTo: 760 })
    },
  },
  sfx_hurt: {
    peakDb: -5,
    render: (b) => {
      tone(b, false, 0, 0.18, 150, { type: 'sine', vol: 0.45, a: 0.001, pdecay: 0.075, slideTo: 55 })
      noiseVoice(b, false, 0, 0.16, { vol: 0.26, hp: 120, lp: 1200, decay: 0.055 })
      tone(b, false, 0, 0.1, 90, { type: 'square', duty: 0.5, vol: 0.12, a: 0.001, pdecay: 0.045 })
    },
  },
  sfx_boss_roar: {
    peakDb: -3,
    durationS: 1.28,
    render: (b) => {
      tone(b, false, 0, 1.2, 82, { type: 'saw', vol: 0.36, a: 0.05, d: 0.2, s: 0.7, r: 0.3, slideTo: 44, vibrato: 0.03, vibratoRate: 6.5 })
      tone(b, false, 0.02, 1.15, 123, { type: 'square', duty: 0.5, vol: 0.1, a: 0.06, d: 0.2, s: 0.6, r: 0.3, slideTo: 66, vibrato: 0.04, vibratoRate: 7 })
      noiseVoice(b, false, 0, 1.15, { vol: 0.24, hp: 60, lp: 900, sweepLp: 500, decay: 0.4 })
      tone(b, false, 0.95, 0.3, 660, { type: 'square', duty: 0.125, vol: 0.06, a: 0.001, pdecay: 0.1 })
      tone(b, false, 1.0, 0.28, 990, { type: 'tri', vol: 0.05, a: 0.001, pdecay: 0.09 })
      delay(b, 0.17, 0.3, 0.18, false)
    },
  },
  sfx_boss_slam: {
    peakDb: -3,
    durationS: 0.68,
    render: (b) => {
      tone(b, false, 0, 0.65, 92, { type: 'sine', vol: 0.55, a: 0.002, pdecay: 0.3, slideTo: 32 })
      noiseVoice(b, false, 0, 0.6, { vol: 0.34, hp: 100, lp: 2600, sweepLp: 200, decay: 0.16 })
      noiseVoice(b, false, 0.1, 0.24, { vol: 0.15, hp: 500, lp: 4000, decay: 0.05 })
      noiseVoice(b, false, 0.26, 0.24, { vol: 0.12, hp: 700, lp: 5000, decay: 0.045 })
      delay(b, 0.13, 0.25, 0.18, false)
    },
  },
  sfx_stairs: {
    peakDb: -6,
    durationS: 0.58,
    render: (b) => {
      const notes = [440, 523.25, 659.25, 880]
      notes.forEach((f, i) => {
        tone(b, false, i * 0.08, 0.35, f, { type: 'sine', vol: 0.22, a: 0.004, pdecay: 0.16 })
        tone(b, false, i * 0.08, 0.22, f * 2, { type: 'tri', vol: 0.05, a: 0.002, pdecay: 0.08 })
      })
      delay(b, 0.17, 0.32, 0.28, false)
    },
  },
  sfx_win: {
    peakDb: -5,
    durationS: 2.6,
    render: (b) => {
      // 像素风胜利小号角：上行旋律 + 稳定收束和弦（持续包络，不做打击式衰减）
      const fan = (t0, f, dur, vol) => {
        tone(b, false, t0, dur, f, { type: 'saw', vol: vol, a: 0.008, d: 0.07, s: 0.72, r: 0.1 })
        tone(b, false, t0, dur, f, { type: 'square', duty: 0.5, vol: vol * 0.45, a: 0.006, d: 0.08, s: 0.6, r: 0.1 })
        tone(b, false, t0, dur, f / 2, { type: 'tri', vol: vol * 0.5, a: 0.008, d: 0.1, s: 0.6, r: 0.12 })
      }
      const seq = [
        [0.0, 659.25, 0.13],
        [0.12, 783.99, 0.13],
        [0.24, 1046.5, 0.13],
        [0.36, 783.99, 0.12],
        [0.48, 1046.5, 0.12],
        [0.6, 1318.5, 0.5],
        [1.12, 1174.66, 0.13],
        [1.24, 1318.5, 0.13],
        [1.36, 1568, 0.6],
      ]
      for (const [t0, f, dur] of seq) fan(t0, f, dur, 0.15)
      // 收束：C 大三和弦，长音
      for (const f of [523.25, 659.25, 783.99, 1046.5]) {
        tone(b, false, 1.95, 0.62, f, { type: 'saw', vol: 0.1, a: 0.012, d: 0.12, s: 0.65, r: 0.18 })
        tone(b, false, 1.95, 0.62, f, { type: 'square', duty: 0.5, vol: 0.045, a: 0.012, d: 0.12, s: 0.55, r: 0.18 })
        tone(b, false, 1.95, 0.62, f / 2, { type: 'tri', vol: 0.1, a: 0.015, d: 0.15, s: 0.6, r: 0.2 })
      }
      // 节奏点缀：开场的镲与军鼓滚奏
      crash(b, false, 0, { vol: 0.14 })
      kick(b, false, 0, { vol: 0.45 })
      for (let i = 0; i < 8; i += 1) snare(b, false, 0.72 + i * 0.037, { vol: 0.07 + i * 0.012 })
      snare(b, false, 1.9, { vol: 0.16 })
      kick(b, false, 1.95, { vol: 0.5 })
      crash(b, false, 1.95, { vol: 0.13 })
      delay(b, 0.15, 0.25, 0.14, false)
    },
  },
  sfx_lose: {
    peakDb: -4,
    durationS: 1.9,
    render: (b) => {
      const notes = [440, 349.23, 293.66, 146.83]
      notes.forEach((f, i) => {
        const t0 = i * 0.38
        tone(b, false, t0, 0.75, f, { type: 'saw', vol: 0.15, a: 0.02, d: 0.2, s: 0.55, r: 0.3, vibrato: 0.006 })
        tone(b, false, t0, 0.7, f / 2, { type: 'tri', vol: 0.12, a: 0.03, d: 0.2, s: 0.6, r: 0.3 })
      })
      noiseVoice(b, false, 0, 1.6, { vol: 0.05, hp: 100, lp: 800, decay: 0.7 })
      delay(b, 0.22, 0.25, 0.2, false)
    },
  },
  sfx_click: {
    peakDb: -16,
    render: (b) => {
      tone(b, false, 0, 0.03, 1200, { type: 'square', duty: 0.25, vol: 0.14, a: 0.0005, pdecay: 0.007 })
      noiseVoice(b, false, 0, 0.025, { vol: 0.09, hp: 3000, lp: 12000, decay: 0.005 })
    },
  },
  sfx_buy: {
    peakDb: -6,
    render: (b) => {
      tone(b, false, 0, 0.06, 1568, { type: 'sine', vol: 0.24, a: 0.001, pdecay: 0.035 })
      tone(b, false, 0.045, 0.08, 2093, { type: 'sine', vol: 0.2, a: 0.001, pdecay: 0.04 })
      noiseVoice(b, false, 0, 0.03, { vol: 0.12, hp: 2500, lp: 12000, decay: 0.008 })
      tone(b, false, 0, 0.05, 784, { type: 'tri', vol: 0.1, a: 0.001, pdecay: 0.022 })
    },
  },
  sfx_tunnel: {
    peakDb: -5,
    durationS: 0.65,
    render: (b) => {
      noiseVoice(b, false, 0, 0.55, { vol: 0.2, hp: 300, lp: 900, sweepHp: 2600, sweepLp: 9000, decay: 0.36, a: 0.1 })
      const notes = [392, 523.25, 659.25]
      notes.forEach((f, i) => {
        tone(b, false, 0.06 + i * 0.1, 0.32, f, { type: 'sine', vol: 0.16, a: 0.04, pdecay: 0.18 })
        tone(b, false, 0.06 + i * 0.1, 0.26, f * 2, { type: 'tri', vol: 0.045, a: 0.03, pdecay: 0.13 })
      })
      delay(b, 0.19, 0.35, 0.3, false)
    },
  },
  sfx_caster_shot: {
    peakDb: -7,
    render: (b) => {
      tone(b, false, 0, 0.13, 700, { type: 'square', duty: 0.25, vol: 0.24, a: 0.001, pdecay: 0.05, slideTo: 170 })
      noiseVoice(b, false, 0, 0.07, { vol: 0.2, hp: 1600, lp: 9000, decay: 0.02 })
      tone(b, false, 0, 0.1, 350, { type: 'tri', vol: 0.1, a: 0.001, pdecay: 0.04, slideTo: 120 })
    },
  },
}

/** 文档 08 里的时长要求（秒），make 时自检、check 时也会再验一遍 */
const SFX_DURATION_RANGE = {
  sfx_hit: [0.06, 0.09],
  sfx_crit: [0.09, 0.14],
  sfx_enemy_die: [0.15, 0.22],
  sfx_coin: [0.1, 0.16],
  sfx_pickup: [0.08, 0.12],
  sfx_heal: [0.2, 0.3],
  sfx_levelup: [0.7, 1.0],
  sfx_dash: [0.18, 0.26],
  sfx_hurt: [0.15, 0.22],
  sfx_boss_roar: [1.0, 1.4],
  sfx_boss_slam: [0.5, 0.8],
  sfx_stairs: [0.4, 0.6],
  sfx_win: [2.0, 3.0],
  sfx_lose: [1.5, 2.0],
  sfx_click: [0.03, 0.05],
  sfx_buy: [0.08, 0.12],
  sfx_tunnel: [0.4, 0.7],
  sfx_caster_shot: [0.1, 0.15],
}

function renderSfx(name, spec) {
  const [minS, maxS] = SFX_DURATION_RANGE[name]
  const dur = spec.durationS ?? (minS + maxS) / 2
  if (dur < minS || dur > maxS) throw new Error(`${name} 时长 ${dur}s 超出文档要求 ${minS}~${maxS}s`)
  const n = Math.round(dur * SR)
  seed(0x5f0000 + name.length * 7919 + name.charCodeAt(3) * 31)
  const b = new Float32Array(n)
  spec.render(b)
  onePoleHP(b, 24, false)
  fadeEdges(b, 0.001, 0.004)
  normalizePeak(b, spec.peakDb)
  const m = measure(b)
  return {
    kind: 'sfx',
    file: `${name}.wav`,
    samples: n,
    durationS: n / SR,
    peakDb: m.peakDb,
    rmsDb: m.rmsDb,
    buf: b,
  }
}

// ---------------------------------------------------------------- 主流程

function parseArgs(argv) {
  const out = { only: null, outDir: join(ROOT, 'assets', 'audio') }
  for (const arg of argv) {
    if (arg.startsWith('--only=')) {
      out.only = new Set(arg.slice(7).split(',').map((s) => s.trim()).filter(Boolean))
    } else if (arg.startsWith('--out=')) {
      out.outDir = resolve(ROOT, arg.slice(6))
    }
  }
  return out
}

function fmtDb(v) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(args.outDir, { recursive: true })
  const entries = []

  const bgms = [
    ['bgm_title', renderTitle],
    ['bgm_battle', renderBattle],
    ['bgm_boss', renderBoss],
    ['bgm_shop', renderShop],
    ['bgm_victory', renderVictory],
  ]
  const want = (file) => !args.only || args.only.has(file.replace(/\.wav$/, ''))
  const t0 = Date.now()

  for (const [, render] of bgms) {
    const track = render()
    const entry = finalizeBgm(track)
    if (!want(entry.file)) continue
    const m = measure(entry.buf)
    if (m.peakDb > TARGET_PEAK_DB + 0.01) throw new Error(`${entry.file} 峰值超过 -1dBFS: ${m.peakDb}`)
    const info = writeWav(args.outDir, entry.file, entry.buf)
    entry.bytes = info.bytes
    entry.sha256 = info.sha256
    entries.push(entry)
    console.log(
      `${entry.file.padEnd(16)} ${(entry.durationS.toFixed(2) + 's').padStart(7)}  ${entry.bpm}BPM x${String(entry.bars).padStart(2)}  ` +
        `peak ${fmtDb(entry.peakDb).padStart(7)}  rms ${fmtDb(entry.rmsDb).padStart(7)}  ${(entry.bytes / 1024).toFixed(0)}KB`,
    )
  }

  for (const [name, spec] of Object.entries(SFX_SPECS)) {
    const entry = renderSfx(name, spec)
    if (!want(entry.file)) continue
    const info = writeWav(args.outDir, entry.file, entry.buf)
    entry.bytes = info.bytes
    entry.sha256 = info.sha256
    entries.push(entry)
    console.log(
      `${entry.file.padEnd(20)} ${(entry.durationS * 1000).toFixed(0).padStart(4)}ms  peak ${fmtDb(entry.peakDb).padStart(7)}  ` +
        `rms ${fmtDb(entry.rmsDb).padStart(7)}  ${(entry.bytes / 1024).toFixed(1)}KB`,
    )
  }

  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0)
  if (args.only && args.only.size > 0) {
    console.log(`\n只生成了 ${entries.length} 个文件（--only 模式不写 manifest），目录: ${args.outDir}`)
  } else {
    const manifest = {
      generator: 'scripts/make-audio.mjs',
      version: 1,
      sampleRate: SR,
      channels: 1,
      bitsPerSample: 16,
      targetPeakDb: TARGET_PEAK_DB,
      totalBytes,
      files: entries.map((e) => ({
        file: e.file,
        kind: e.kind,
        bytes: e.bytes,
        sha256: e.sha256,
        samples: e.samples,
        sampleRate: SR,
        channels: 1,
        bitsPerSample: 16,
        durationS: Number(e.durationS.toFixed(4)),
        peakDb: Number(e.peakDb.toFixed(2)),
        rmsDb: Number(e.rmsDb.toFixed(2)),
        ...(e.kind === 'bgm'
          ? { bpm: e.bpm, bars: e.bars, samplesPerBar: e.samplesPerBar }
          : { durationRangeS: SFX_DURATION_RANGE[e.file.replace(/\.wav$/, '')] }),
      })),
    }
    writeFileSync(join(args.outDir, 'audio-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`\n共 ${entries.length} 个文件，总计 ${(totalBytes / 1024 / 1024).toFixed(2)} MB（上限 8MB）`)
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`音频总量 ${totalBytes} 超过 8MB`)
    console.log(`manifest: ${join(args.outDir, 'audio-manifest.json')}`)
  }
  console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(2)}s`)
}

main()
