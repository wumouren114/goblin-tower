#!/usr/bin/env node
/**
 * 《哥布林之塔》音频产物校验：`node scripts/check-audio.mjs`
 *
 * 校验对象（全部离线、零依赖，只看仓库内的东西）：
 *   1. 清单   assets/audio/audio-manifest.json 与实际文件一一对应，总量 < 8MB；
 *   2. 格式   RIFF/WAVE、PCM 16bit、单声道、22050/24000Hz、无裁剪、无 DC；
 *   3. 时长   SFX 与 docs/08-音效BGM提示词.md 的时长区间一致；BGM 与 bpm×小节自洽；
 *   4. 电平   peak ≤ -0.5dBFS（不爆音）、RMS 在合理区间（不是太轻 / 太响）；
 *   5. 循环   BGM 首尾无静音、首尾拼接处无跳变（不会听到"咔哒"）；
 *   6. 哈希   sha256 与清单一致（防止手改产物）；
 *   7. 接线   src/core/audio.ts 仍提供 game.ts 用到的全部方法与字段。
 *
 * 用法：node scripts/check-audio.mjs [--dir assets/audio] [--verbose] [--json]
 * 退出码：0 = 全部通过；1 = 有 FAIL。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const TOTAL_LIMIT = 8 * 1024 * 1024

/** docs/08-音效BGM提示词.md 第 2 节的 SFX 时长区间（秒）。 */
const DOC_SFX_RANGES = {
  hit: [0.06, 0.09],
  crit: [0.09, 0.14],
  enemy_die: [0.15, 0.22],
  coin: [0.1, 0.16],
  pickup: [0.08, 0.12],
  heal: [0.2, 0.3],
  levelup: [0.7, 1.0],
  dash: [0.18, 0.26],
  hurt: [0.15, 0.22],
  boss_roar: [1.0, 1.4],
  boss_slam: [0.5, 0.8],
  stairs: [0.4, 0.6],
  win: [2.0, 3.0],
  lose: [1.5, 2.0],
  click: [0.03, 0.05],
  buy: [0.08, 0.12],
  tunnel: [0.4, 0.7],
  caster_shot: [0.1, 0.15],
}

const REQUIRED_SFX = Object.keys(DOC_SFX_RANGES)
const REQUIRED_BGM = ['title', 'battle', 'boss', 'shop', 'victory']
const REQUIRED_FILES = [...REQUIRED_BGM.map((t) => `bgm_${t}.wav`), ...REQUIRED_SFX.map((s) => `sfx_${s}.wav`)]

/** game.ts 目前在用 / 音频总线必须提供的接口。 */
const REQUIRED_API = [
  'resume',
  'init',
  'load',
  'bgmStart',
  'bgmStop',
  'startBgm',
  'stopBgm',
  'duck',
  'setBgmIntensity',
  'getVolume',
  'setVolume',
  'playSfx',
  'play',
  'toggleMute',
  'hit',
  'crit',
  'pickup',
  'coin',
  'heal',
  'levelUp',
  'dash',
  'hurt',
  'enemyDie',
  'bossRoar',
  'bossSlam',
  'stairs',
  'win',
  'lose',
  'click',
  'buy',
  'tunnel',
  'casterShot',
]

// ---------------------------------------------------------------- 参数

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const AUDIO_DIR = resolve(ROOT, opt('--dir', 'assets/audio'))
const VERBOSE = flag('--verbose')
const JSON_OUT = flag('--json')

// ---------------------------------------------------------------- 断言收集

const results = []
const failures = []
let group = ''

function startGroup(name) {
  group = name
}

function check(name, fn) {
  try {
    const detail = fn()
    results.push({ group, name, ok: true, detail: detail ?? '' })
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    failures.push({ group, name, message })
    results.push({ group, name, ok: false, detail: message })
    return false
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

const fmtDb = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}dB`
const dbOf = (amp) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity)

// ---------------------------------------------------------------- WAV 解析

function parseWav(buf) {
  assert(buf.length > 44, '文件过小，不是合法 WAV')
  assert(buf.toString('ascii', 0, 4) === 'RIFF', '缺少 RIFF 头')
  assert(buf.toString('ascii', 8, 12) === 'WAVE', '缺少 WAVE 头')
  const riffSize = buf.readUInt32LE(4)
  assert(riffSize + 8 <= buf.length, `RIFF 长度声明 ${riffSize + 8} 超过实际 ${buf.length}`)

  let fmt = null
  let data = null
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    assert(body + size <= buf.length, `chunk ${id} 越界`)
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        blockAlign: buf.readUInt16LE(body + 12),
        bitsPerSample: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      data = { offset: body, size }
    }
    off = body + size + (size % 2) // chunk 按偶数字节对齐
  }
  assert(fmt, '缺少 fmt chunk')
  assert(data, '缺少 data chunk')
  assert(fmt.format === 1, `不是 PCM（format=${fmt.format}），浏览器兼容性差`)
  assert(fmt.bitsPerSample === 16, `位深 ${fmt.bitsPerSample}，期望 16`)
  assert(fmt.channels === 1, `声道数 ${fmt.channels}，期望单声道`)
  assert(fmt.sampleRate === 22050 || fmt.sampleRate === 24000, `采样率 ${fmt.sampleRate}，期望 22050/24000`)
  assert(fmt.blockAlign === fmt.channels * (fmt.bitsPerSample / 8), 'blockAlign 与声道/位深不符')
  assert(fmt.byteRate === fmt.sampleRate * fmt.blockAlign, 'byteRate 与采样率不符')
  assert(data.size > 0 && data.size % 2 === 0, `data 长度 ${data.size} 非法`)
  const samples = data.size / 2
  return { ...fmt, samples, bytes: buf.length, dataOffset: data.offset }
}

function toFloat(buf, wav) {
  const out = new Float32Array(wav.samples)
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(wav.dataOffset + i * 2) / 32768
  return out
}

function metrics(x) {
  let peak = 0
  let sum = 0
  let clipped = 0
  let dc = 0
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    const a = Math.abs(v)
    if (a > peak) peak = a
    if (a > 0.999) clipped++
    sum += v * v
    dc += v
  }
  const rms = Math.sqrt(sum / x.length)
  return { peak, peakDb: dbOf(peak), rms, rmsDb: dbOf(rms), clipped, dc: dc / x.length }
}

const rmsOf = (x, from, to) => {
  let sum = 0
  const n = Math.max(1, to - from)
  for (let i = from; i < to; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / n)
}

/** 首/尾静音时长（ms）：连续低于 -60dBFS 的样本数。 */
function edgeSilenceMs(x, sr, fromStart) {
  const th = 0.001
  let count = 0
  const n = x.length
  for (let i = 0; i < n; i++) {
    const v = Math.abs(x[fromStart ? i : n - 1 - i])
    if (v > th) break
    count++
  }
  return (count / sr) * 1000
}

/** 相邻样本差分的高分位（只用每 7 个点做近似，够用且快）。 */
function diffPercentile(x, p) {
  const diffs = []
  for (let i = 7; i < x.length; i += 7) diffs.push(Math.abs(x[i] - x[i - 7]))
  diffs.sort((a, b) => a - b)
  return diffs[Math.min(diffs.length - 1, Math.floor(diffs.length * p))] ?? 0
}

/** [from,to) 区间内连续低于阈值的最长静音时长（ms）。 */
function silenceRunMs(x, sr, from, to, th) {
  let run = 0
  let best = 0
  for (let i = Math.floor(from); i < Math.floor(to); i++) {
    if (Math.abs(x[i]) < th) {
      run++
      if (run > best) best = run
    } else {
      run = 0
    }
  }
  return (best / sr) * 1000
}

// ---------------------------------------------------------------- 主流程

const manifestPath = join(AUDIO_DIR, 'audio-manifest.json')
const manifest = { files: [] }
const parsed = new Map()

startGroup('目录与清单')

if (!check('音频目录存在', () => assert(existsSync(AUDIO_DIR), `找不到 ${AUDIO_DIR}`))) {
  finish()
}

if (!check('manifest 可解析', () => {
  assert(existsSync(manifestPath), `缺少 ${manifestPath}`)
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'))
  assert(Array.isArray(m.files) && m.files.length > 0, 'manifest.files 为空')
  assert(m.sampleRate === 22050 || m.sampleRate === 24000, `manifest.sampleRate=${m.sampleRate}`)
  assert(m.channels === 1, `manifest.channels=${m.channels}`)
  Object.assign(manifest, m)
  return `${m.files.length} 个条目`
})) {
  finish()
}

const onDisk = readdirSync(AUDIO_DIR).filter((f) => f.endsWith('.wav')).sort()
check('磁盘文件与清单一致', () => {
  const listed = manifest.files.map((f) => f.file).sort()
  const missing = REQUIRED_FILES.filter((f) => !onDisk.includes(f))
  assert(missing.length === 0, `缺少必需文件: ${missing.join(', ')}`)
  const extraDisk = onDisk.filter((f) => !listed.includes(f))
  assert(extraDisk.length === 0, `磁盘上有多余 wav: ${extraDisk.join(', ')}`)
  const extraManifest = listed.filter((f) => !onDisk.includes(f))
  assert(extraManifest.length === 0, `清单里有不存在的文件: ${extraManifest.join(', ')}`)
  return `${onDisk.length} 个 wav`
})

check('总大小 < 8MB', () => {
  const total = onDisk.reduce((s, f) => s + statSync(join(AUDIO_DIR, f)).size, 0)
  assert(total === manifest.totalBytes, `实际 ${total} 与清单 totalBytes=${manifest.totalBytes} 不一致`)
  assert(total < TOTAL_LIMIT, `总大小 ${(total / 1024 / 1024).toFixed(2)}MB 超过 8MB`)
  return `${(total / 1024 / 1024).toFixed(2)}MB（预算 8MB）`
})

startGroup('格式与哈希')

for (const entry of manifest.files) {
  const file = entry.file
  check(`${file} 格式/哈希`, () => {
    const buf = readFileSync(join(AUDIO_DIR, file))
    const wav = parseWav(buf)
    assert(wav.sampleRate === manifest.sampleRate, `采样率 ${wav.sampleRate} ≠ 全局 ${manifest.sampleRate}`)
    assert(wav.bytes === entry.bytes, `字节数 ${wav.bytes} ≠ 清单 ${entry.bytes}`)
    assert(wav.samples === entry.samples, `样本数 ${wav.samples} ≠ 清单 ${entry.samples}`)
    const sha = createHash('sha256').update(buf).digest('hex')
    assert(sha === entry.sha256, 'sha256 与清单不一致（产物被手改过？重新跑 make-audio）')
    parsed.set(file, { wav, x: toFloat(buf, wav) })
    return `sr=${wav.sampleRate} ch=${wav.channels} ${wav.samples} samples`
  })
}

startGroup('时长')

for (const entry of manifest.files) {
  check(`${entry.file} 时长`, () => {
    const { wav } = parsed.get(entry.file)
    const duration = wav.samples / wav.sampleRate
    assert(Math.abs(duration - entry.durationS) < 0.001, `实际 ${duration.toFixed(4)}s ≠ 清单 ${entry.durationS}s`)

    if (entry.kind === 'bgm') {
      assert(duration >= 12, `BGM 只有 ${duration.toFixed(2)}s，太短，循环会很明显`)
      const spb = Math.round((wav.sampleRate * 60 * 4) / entry.bpm)
      assert(Number.isFinite(entry.bpm) && entry.bpm > 0, '缺少 bpm')
      assert(Number.isFinite(entry.bars) && entry.bars > 0, '缺少 bars')
      assert(Math.abs(wav.samples - spb * entry.bars) <= 2, `样本数 ${wav.samples} ≠ ${spb}×${entry.bars}（bpm 与小节不自洽）`)
      assert(spb === entry.samplesPerBar, `samplesPerBar ${entry.samplesPerBar} ≠ 计算值 ${spb}`)
      return `${duration.toFixed(2)}s · ${entry.bpm}bpm × ${entry.bars} 小节`
    }

    const name = entry.file.replace(/^sfx_/, '').replace(/\.wav$/, '')
    const range = DOC_SFX_RANGES[name]
    assert(range, `docs 里没有 ${entry.file} 的时长规定`)
    assert(
      Math.abs(entry.durationRangeS[0] - range[0]) < 1e-6 && Math.abs(entry.durationRangeS[1] - range[1]) < 1e-6,
      `清单 durationRangeS=[${entry.durationRangeS}] 与 docs [${range}] 不一致`,
    )
    const [lo, hi] = range
    assert(duration >= lo - 0.002 && duration <= hi + 0.002, `${(duration * 1000).toFixed(0)}ms 超出 docs 区间 ${lo * 1000}~${hi * 1000}ms`)
    return `${(duration * 1000).toFixed(0)}ms ∈ [${lo * 1000},${hi * 1000}]ms`
  })
}

startGroup('电平')

for (const entry of manifest.files) {
  check(`${entry.file} 电平`, () => {
    const { x } = parsed.get(entry.file)
    const m = metrics(x)
    assert(m.clipped === 0, `${m.clipped} 个样本触顶（会削波失真）`)
    assert(m.peakDb <= -0.5, `峰值 ${fmtDb(m.peakDb)} 高于 -0.5dBFS`)
    assert(m.peakDb >= -22, `峰值 ${fmtDb(m.peakDb)} 太轻（-22dBFS 以下）`)
    assert(Math.abs(m.dc) < 0.01, `DC 偏置 ${m.dc.toFixed(4)} 过大`)
    assert(Math.abs(m.rmsDb - entry.rmsDb) < 0.5, `RMS ${fmtDb(m.rmsDb)} ≠ 清单 ${fmtDb(entry.rmsDb)}`)
    assert(Math.abs(m.peakDb - entry.peakDb) < 0.5, `峰值 ${fmtDb(m.peakDb)} ≠ 清单 ${fmtDb(entry.peakDb)}`)
    if (entry.kind === 'bgm') {
      assert(m.rmsDb >= -24 && m.rmsDb <= -14, `BGM RMS ${fmtDb(m.rmsDb)} 不在 -24~-14dBFS`)
    } else {
      assert(m.rmsDb >= -32 && m.rmsDb <= -12, `SFX RMS ${fmtDb(m.rmsDb)} 不在 -32~-12dBFS`)
    }
    return `peak ${fmtDb(m.peakDb)} · rms ${fmtDb(m.rmsDb)}`
  })
}

startGroup('循环与静音')

for (const entry of manifest.files) {
  const { wav, x } = parsed.get(entry.file)
  const isBgm = entry.kind === 'bgm'
  check(`${entry.file} ${isBgm ? '循环' : '静音'}`, () => {
    const sr = wav.sampleRate
    const headMs = edgeSilenceMs(x, sr, true)
    const tailMs = edgeSilenceMs(x, sr, false)
    const fiveMs = Math.floor(sr * 0.005)
    const headRms = dbOf(rmsOf(x, 0, fiveMs))
    const tailRms = dbOf(rmsOf(x, x.length - fiveMs, x.length))
    if (isBgm) {
      assert(headMs < 2, `开头有 ${headMs.toFixed(1)}ms 静音（循环会断）`)
      assert(tailMs < 2, `结尾有 ${tailMs.toFixed(1)}ms 静音（循环会断）`)
      assert(headRms > -45, `开头 5ms 能量只有 ${fmtDb(headRms)}`)
      assert(tailRms > -45, `结尾 5ms 能量只有 ${fmtDb(tailRms)}`)
      // 首尾拼接：x[n-1] → x[0] 的跳变要和普通相邻样本差同一量级，否则会"咔"。
      const seam = Math.abs(x[0] - x[x.length - 1])
      const reference = Math.max(0.004, diffPercentile(x, 0.999))
      assert(seam <= reference, `首尾跳变 ${seam.toFixed(4)} > 参考差分 ${reference.toFixed(4)}（循环处会"咔"）`)
      // 循环点两侧都必须"正在响"：结尾淡出到静音、再从头淡入，是最典型的循环断点。
      // 允许小节线上有强弱对比，但不能整体掉到比整曲 RMS 低 22dB 以下。
      const edge = Math.floor(sr * 0.03)
      const headEdge = dbOf(rmsOf(x, 0, edge))
      const tailEdge = dbOf(rmsOf(x, x.length - edge, x.length))
      assert(tailEdge > entry.rmsDb - 22, `结尾 30ms 只有 ${fmtDb(tailEdge)}（整曲 ${fmtDb(entry.rmsDb)}），听感像淡出`)
      assert(headEdge > entry.rmsDb - 22, `开头 30ms 只有 ${fmtDb(headEdge)}（整曲 ${fmtDb(entry.rmsDb)}），听感像淡入`)
      assert(Math.abs(headEdge - tailEdge) <= 16, `切点两侧 30ms 响度差 ${(headEdge - tailEdge).toFixed(1)}dB 过大`)
      // 切点前后各 150ms 内不能有 ≥2.5ms 的静音坑（小节线上最容易漏）。
      const pitHead = silenceRunMs(x, sr, 0, Math.min(x.length, sr * 0.15), 0.0015)
      const pitTail = silenceRunMs(x, sr, Math.max(0, x.length - sr * 0.15), x.length, 0.0015)
      assert(pitHead < 2.5, `开头 150ms 内有 ${pitHead.toFixed(1)}ms 静音坑`)
      assert(pitTail < 2.5, `结尾 150ms 内有 ${pitTail.toFixed(1)}ms 静音坑`)
      return `seam ${fmtDb(dbOf(Math.max(seam, 1e-6)))} · 首 ${fmtDb(headEdge)} / 尾 ${fmtDb(tailEdge)}（整曲 ${fmtDb(entry.rmsDb)}）`
    }
    assert(headMs <= 15, `开头静音 ${headMs.toFixed(1)}ms 过长`)
    assert(dbOf(rmsOf(x, 0, x.length)) > -40, '整段几乎没有声音')
    return `headSilence ${headMs.toFixed(1)}ms`
  })
}

startGroup('源码接线')

check('audio.ts 提供 game.ts 所需 API', () => {
  const audioPath = join(ROOT, 'src/core/audio.ts')
  assert(existsSync(audioPath), '缺少 src/core/audio.ts')
  const src = readFileSync(audioPath, 'utf8')
  assert(/export\s+class\s+AudioBus/.test(src), '没有导出 class AudioBus')
  assert(/export\s+const\s+audio\s*=\s*new\s+AudioBus/.test(src), '没有导出单例 audio')
  const classStart = src.indexOf('class AudioBus')
  const classEnd = src.indexOf('export const audio')
  const body = classStart >= 0 && classEnd > classStart ? src.slice(classStart, classEnd) : src
  const methods = new Set([...body.matchAll(/^ {2}(?:private\s+|public\s+|readonly\s+|async\s+)*(\w+)\s*\(/gm)].map((m) => m[1]))
  const missing = REQUIRED_API.filter((m) => !methods.has(m))
  assert(missing.length === 0, `缺少方法: ${missing.join(', ')}`)
  assert(/^\s*muted\s*[:=]/m.test(body), '缺少 muted 字段')
  return `${methods.size} 个成员，覆盖 ${REQUIRED_API.length} 个必需 API`
})

check('game.ts 所有 audio.* 调用都有实现', () => {
  const gamePath = join(ROOT, 'src/game.ts')
  assert(existsSync(gamePath), '缺少 src/game.ts')
  const src = readFileSync(gamePath, 'utf8')
  assert(/from\s+['"]\.\/core\/audio['"]/.test(src), 'game.ts 没有从 ./core/audio 引入音频')
  const audioSrc = readFileSync(join(ROOT, 'src/core/audio.ts'), 'utf8')
  const used = new Set([...src.matchAll(/audio\.(\w+)/g)].map((m) => m[1]))
  const missing = [...used].filter((name) => {
    if (name === 'muted') return !/^\s*muted\s*[:=]/m.test(audioSrc)
    return !new RegExp(`^ {2}(?:private\\s+|public\\s+|readonly\\s+|async\\s+)*${name}\\s*\\(`, 'm').test(audioSrc)
  })
  assert(missing.length === 0, `game.ts 调用了不存在的方法: ${missing.join(', ')}`)
  return `${used.size} 个调用点: ${[...used].sort().join(', ')}`
})

// ---------------------------------------------------------------- 输出

function finish(code) {
  const failed = failures.length > 0
  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: !failed, failures, results }, null, 2))
  } else {
    const byGroup = new Map()
    for (const r of results) {
      const g = byGroup.get(r.group) ?? { total: 0, bad: 0 }
      g.total++
      if (!r.ok) g.bad++
      byGroup.set(r.group, g)
    }
    for (const [name, g] of byGroup) {
      console.log(`${g.bad === 0 ? '  ✓' : '  ✗'} ${name.padEnd(10, ' ')} ${g.total - g.bad}/${g.total}`)
    }
    if (VERBOSE) {
      console.log('\n明细：')
      for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name} — ${r.detail}`)
    }
    if (failed) {
      console.log('\n失败：')
      for (const f of failures) console.log(`  ✗ [${f.group}] ${f.name}: ${f.message}`)
    } else {
      const total = manifest.totalBytes ?? 0
      const bgm = manifest.files.filter((f) => f.kind === 'bgm').length
      const sfx = manifest.files.filter((f) => f.kind === 'sfx').length
      console.log(
        `\n音频产物 OK：${bgm} 首 BGM + ${sfx} 个 SFX，共 ${(total / 1024 / 1024).toFixed(2)}MB，` +
          `全部 22050Hz 单声道 16bit，BGM 首尾可无缝循环，SFX 时长符合 docs 规定。`,
      )
    }
  }
  process.exit(failed ? 1 : 0)
}

finish()
