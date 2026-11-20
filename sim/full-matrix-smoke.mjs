/**
 * 肉鸽爬塔 · 全量矩阵仿真推演器（3 角色 × 3 难度 × 2 局 = 18 局）
 *
 * 直接复用项目真实数据与纯逻辑模块（禁止手编数值）：
 *   - src/data/balance.ts & balance.json（层数/敌人曲线/金币曲线/专武表）
 *   - src/data/characters.ts（基础五维/攻速伤害公式/技能参数）
 *   - src/data/potentials.ts（9 分支 27 节点 + Q/F 技能定义）
 *   - src/data/cards.ts & src/systems/inventory.ts（三档道具卡池/同名升档/满金退池）
 *   - src/systems/shop.ts & src/systems/economy.ts（货架生成/定价/特训）
 *   - src/systems/tunnels.ts（门权重/房间生成/房间结算）
 *   - src/data/rewardRooms.ts / trials.ts / altar.ts / events.ts（奖励关/考验/祭坛/事件结算）
 *
 * 运行：
 *   node sim/full-matrix-smoke.mjs            # 输出汇总表 + 断言
 *   node sim/full-matrix-smoke.mjs --json     # 额外输出完整 JSON 指标到 stdout
 */
import { createServer } from 'vite'

const SHOW_JSON = process.argv.includes('--json')

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'silent',
})

try {
  const { Rng } = await server.ssrLoadModule('/src/core/rng.ts')
  const {
    BALANCE,
    DIFFICULTIES,
    DIFFICULTY_IDS,
    layerCount,
    isBossLayer,
    stageOfLayer,
    mobHpFor,
    mobDamageFor,
    mobSpeedMulFor,
    quotaFor,
    spawnIntervalFor,
    bossHpFor,
  } = await server.ssrLoadModule('/src/data/balance.ts')
  const {
    CHARACTERS,
    CHARGE_PER_KILL,
    attackInterval,
    hitDamage,
  } = await server.ssrLoadModule('/src/data/characters.ts')
  const { POTENTIALS } = await server.ssrLoadModule('/src/data/potentials.ts')
  const { ITEM_CARDS } = await server.ssrLoadModule('/src/data/cards.ts')
  const { resolveRewardChoice } = await server.ssrLoadModule('/src/data/rewardRooms.ts')
  const { TRIALS } = await server.ssrLoadModule('/src/data/trials.ts')
  const { EVENTS } = await server.ssrLoadModule('/src/data/events.ts')
  const { rollTunnels, resolveRoom } = await server.ssrLoadModule('/src/systems/tunnels.ts')
  const { generateOffers } = await server.ssrLoadModule('/src/systems/shop.ts')
  const { killGold, clearGold, makeCardItem } = await server.ssrLoadModule('/src/systems/economy.ts')
  const { Inventory } = await server.ssrLoadModule('/src/systems/inventory.ts')

  const CHAR_IDS = ['murasame', 'mutsumi', 'fish']
  const CHAR_NAMES = { murasame: '丛雨', mutsumi: '若叶睦', fish: '大肥鱼' }
  const DIFF_NAMES = { easy: '简单', normal: '普通', hard: '困难' }
  const SEEDS = [101, 202]
  const WEAPONS = BALANCE.weapons
  const CONSUMABLES = BALANCE.shop.consumables

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  /**
   * 计算角色当前面板、普攻 DPS（单体/群体）、技能 DPS、有效生命 EHP 与持续回血。
   * 口径严格对齐 src/game.ts:recalcStats() 与 src/systems/combat.ts。
   */
  function evaluatePlayerPower(st, layer) {
    const def = CHARACTERS[st.charId]
    const w = WEAPONS[st.charId].tiers[st.weaponLv - 1]
    const cards = { ...st.inventory.cards }
    // 叠加金币特训属性（与 game.ts:recalcCards 同步）
    for (const [k, v] of Object.entries(st.training)) {
      if (k in cards) cards[k] = Number((cards[k] + v).toFixed(3))
    }

    const branch = st.potential.branch
    const nodes = new Set(st.potential.nodes)
    const hasBranch = (short) => branch === `${st.charId}-${short}` || branch === short
    const hasNode = (id) => nodes.has(id)
    const qUnlocked = Boolean(branch)
    const fUnlocked = nodes.size >= 2

    // 大肥鱼白米饭（lv3 起每 8s 掉 1 份，战斗中平均叠 3~6 层）
    const riceStacks = st.charId === 'fish' && st.weaponLv >= 3 ? Math.min(8, 2 + Math.floor(layer / 3)) : 0
    const riceMul = 1 + riceStacks * (w.riceBuff ?? 0.07)
    const allStat = (w.allStatMul ?? 1) * riceMul

    const giant = hasBranch('bubble') && hasNode('fish-bubble-giant')
    const boonAll = 1 + (st.boons.all ?? 0)
    const capMul = (1 - Math.min(0.7, st.hpCapPenalty)) * (1 + (st.trialBoons.hpMax ?? 0))
    const maxHp = Math.max(
      1,
      Math.round((def.base.hp + (cards.hp ?? 0)) * allStat * (giant ? 1.2 : 1) * capMul * boonAll),
    )

    // 注意：复现 game.ts:3699 实况——boons.magic 与 boonAll 未乘入 magic，仅 boons.attack 与 boonAll 乘入 damage
    const baseWeaponDmg =
      (w.damage ?? def.attack.baseDamage) *
      allStat *
      (giant ? 1.15 : 1) *
      (1 + (st.trialBoons.attack ?? 0)) *
      boonAll *
      (1 + (st.boons.attack ?? 0))
    const magic = (def.base.magic + (cards.magic ?? 0)) * allStat * (giant ? 1.15 : 1)
    const stamina = (def.base.stamina + (cards.stamina ?? 0)) * allStat
    const intelligence = (def.base.intelligence + (cards.intelligence ?? 0)) * allStat

    // 暴击期望（cards.ts:84 基础 8%，暴击固定 ×2.0，上限 60%）
    const critChance = Math.min(0.6, 0.08 + (cards.crit ?? 0))
    const critExpected = 1 + critChance * (2.0 - 1)

    // 减伤与闪避（复现 game.ts:3711-3712：armorRate 上限 0.6，dodge 硬截断 0.24；考验闪避在受击时额外叠到 0.30）
    const armorRate = Math.min(0.6, cards.armor ?? 0)
    const baseDodge = Math.min(0.24, (cards.dodge ?? 0) + (w.dodgeChance ?? 0))
    const effectiveDodge = Math.min(0.3, baseDodge + (st.trialBoons.dodge ?? 0))

    // F 技能减伤折算：丛雨 F 格挡 0.8s/8s cd（80% 减伤）≈ 8% 期望减伤；睦 Q 推敌/F 强拍微幅降低贴脸率
    const fMitigation = st.charId === 'murasame' && fUnlocked ? 0.08 : 0
    const effectiveDr = 1 - (1 - armorRate) * (1 - effectiveDodge) * (1 - fMitigation)
    const ehp = maxHp / Math.max(0.1, 1 - effectiveDr)

    // 攻击间隔（对齐 combat.ts:702-710）
    let interval
    if (st.charId === 'mutsumi' && hasBranch('rhythm')) {
      interval = 0.25 // 120 BPM 八分音符锁定 0.25s，攻速加成无效
    } else {
      interval = attackInterval(stamina, def.attack.minInterval)
      if (hasBranch('bubble')) interval *= 1.15
      if (giant) interval *= 1.1
      interval *= 1 - Math.min(0.3, st.trialBoons.attackSpeed ?? 0)
    }
    // 大肥鱼 F 水枪：10s 内间隔 ×0.55，CD 20s → 平均覆盖 50% 时间 → 等效间隔 ×0.775
    if (st.charId === 'fish' && fUnlocked) {
      interval *= 0.5 * 0.55 + 0.5 * 1.0
    }

    // 单次普攻基础伤害
    let atkMul = 1
    if (st.charId === 'murasame' && hasBranch('liushang')) atkMul *= 0.8 // 流殇代价 -20%
    if (st.charId === 'murasame' && hasBranch('jianyi') && hasNode('murasame-jianyi-amp')) atkMul *= 1.08 // 带标目标 +10%
    if (st.charId === 'mutsumi' && hasBranch('rhythm')) {
      // 节奏分支：默认 85% 踩准率，连击节点提供平均 +30% 伤害，F 强拍窗口提升稳定性
      const comboMul = hasNode('mutsumi-rhythm-combo') ? 1.3 : 1.0
      const mercyBonus = hasNode('mutsumi-rhythm-mercy') ? 1.05 : 1.0
      const fBonus = fUnlocked ? 1.04 : 1.0
      atkMul *= 0.88 * comboMul * mercyBonus * fBonus
    }
    if (st.charId === 'fish' && hasBranch('clone')) atkMul *= 0.85 // 分身代价：大肥鱼初始伤害降低

    const singleHit = hitDamage(baseWeaponDmg, magic) * atkMul * critExpected

    // 群体命中期望（普攻形态 + 专武 + 潜能分支）
    let singleFactor = 1
    let crowdHits = 1
    if (st.charId === 'murasame') {
      // 扇形拔刀：基础 2.4 目标，受智力与专武半径倍率影响
      crowdHits = 2.4 * (w.radiusMul ?? 1) * clamp(intelligence / 70, 0.85, 1.5)
    } else if (st.charId === 'mutsumi') {
      const proj = w.projectiles ?? 1
      singleFactor = hasBranch('symphony') ? 1 + (hasNode('mutsumi-symphony-echo') ? 0.85 : 0.7) : 1
      crowdHits = proj * singleFactor
      if (w.bounce) crowdHits += w.bounce * (w.bounceMul ?? 0.6) * proj
      if (hasBranch('rhythm')) crowdHits += hasNode('mutsumi-rhythm-note') ? 1.1 : 0.6 // 2m/50% 溅射
      if (hasBranch('symphony') && hasNode('mutsumi-symphony-bounce')) crowdHits *= 1.15
    } else if (st.charId === 'fish') {
      crowdHits = 1 + (w.pierce ?? 0) * 0.85
      if (hasBranch('bubble')) crowdHits += 1.2 // 超级泡泡爆炸 AOE
      if (hasBranch('bubble') && hasNode('fish-bubble-execute')) crowdHits *= 1.12 // 包裹斩杀 <25%
    }

    const normalSingleDps = (singleHit * singleFactor) / interval
    const normalCrowdDps = (singleHit * crowdHits) / interval

    // ── 技能 DPS 与回复估算 ────────────────────────────────────────────────
    // 复现 game.ts:3703-3708 实况 chargeMax 与 combat.ts:1058-1067 实际消耗
    const rawChargeMax = Math.max(
      30,
      (def.base.chargeMax + (cards.chargeMax ?? 0)) *
        allStat *
        (branch === 'mutsumi-duet' ? 0.8 : 1),
    )
    let skillCost = rawChargeMax
    if (st.charId === 'murasame') {
      skillCost = w.skillCharge ?? rawChargeMax
      if (hasBranch('shunshan')) skillCost = Math.max(20, Math.round(skillCost * 0.85))
      if (hasBranch('jianyi')) skillCost = Math.max(20, Math.round(skillCost * 0.75))
    } else if (st.charId === 'fish' && hasBranch('swarm')) {
      skillCost = Math.round(rawChargeMax * 1.2)
    } else if (st.charId === 'mutsumi' && hasBranch('duet')) {
      skillCost = Math.round(rawChargeMax * 1.2)
    }

    const trialChargeMul = st.trial?.def.burden.stat === 'skillCharge' ? 1 + st.trial.def.burden.value : 1
    const chargePerKill = CHARGE_PER_KILL.small * def.chargeGainMul * (1 + (cards.chargeGain ?? 0)) * trialChargeMul
    const trialSkillMul = 1 + (st.trialBoons.skillDamage ?? 0)

    let skillSingleDps = 0
    let skillCrowdDps = 0
    let sustainHpPerSec = 0

    // 生命之源（hpRegen）：每 5 秒回 2.5% / 5% / 9% 最大生命
    const regenCard = st.inventory.items.find((it) => it.name.includes('生命之源'))
    if (regenCard && typeof regenCard.value === 'number') {
      sustainHpPerSec += (maxHp * regenCard.value) / 5
    }
    if (st.trialBoons.healPerSec) {
      sustainHpPerSec += maxHp * st.trialBoons.healPerSec
    }

    if (st.charId === 'murasame') {
      const autoChargePerSec =
        (hasBranch('shunshan') ? rawChargeMax * 0.015 : 0) +
        (hasBranch('jianyi') && hasNode('murasame-jianyi-regen') ? 2 : 0)
      const effectiveCost =
        hasBranch('shunshan') && hasNode('murasame-shunshan-kill') ? skillCost * 0.9 : skillCost
      // 估算每 10 秒可释放次数（击杀回能 + 自动回能）
      const estKillsPerSec = clamp(normalCrowdDps / Math.max(20, mobHpFor(st.diffId, layer)), 0.3, 3.5)
      const castsPerSec = (estKillsPerSec * chargePerKill + autoChargePerSec) / Math.max(20, effectiveCost)

      const baseSkillHit =
        hitDamage(def.skill.params.damage, magic) *
        (w.skillDamageMul ?? 1) *
        (hasBranch('shunshan') && hasNode('murasame-shunshan-power') ? 1.2 : 1) *
        trialSkillMul

      if (hasBranch('jianyi')) {
        // 居合：本体无直接伤害，引爆 3 层标记 = 180% 技能基础伤害 + 9% maxHp 回血；裂帛 3m 60% 溅射
        const detonateDmg = baseSkillHit * 1.8
        const aoeMul = hasNode('murasame-jianyi-boom') ? 1 + 0.6 * 2.2 : 1.0
        skillSingleDps = detonateDmg * castsPerSec
        skillCrowdDps = detonateDmg * aoeMul * castsPerSec
        sustainHpPerSec += maxHp * 0.09 * castsPerSec
      } else {
        // 常规 / 瞬闪突进：路径命中 ~3.5 目标
        skillSingleDps = baseSkillHit * castsPerSec
        skillCrowdDps = baseSkillHit * 3.5 * castsPerSec
        const dashHeal = hasBranch('shunshan')
          ? hasNode('murasame-shunshan-heal')
            ? 44
            : 28
          : (w.skillHealPerHit ?? 5) * 3
        sustainHpPerSec += dashHeal * castsPerSec
      }

      // 流殇流血（独立百分比伤害，不吃普攻 -20% 代价！）
      if (hasBranch('liushang')) {
        const pctPerTick = hasNode('murasame-liushang-power') ? 0.015 : 0.012
        const tickInterval = hasNode('murasame-liushang-rate') ? 0.4 : 0.5
        const mobHp = mobHpFor(st.diffId, layer)
        const bossHp = bossHpFor(st.diffId, layer)
        // 对普通怪按 2.4 目标同时流血，对 Boss 按单体百分比流血（注意：Boss 吃 1.2%~1.5% maxHp/跳 是极强对单倍率！）
        skillCrowdDps += (mobHp * pctPerTick / tickInterval) * 2.4
        skillSingleDps += (bossHp * pctPerTick) / tickInterval
      }

      // 拔刀专武吸血 + Q 处决收割（小怪 <12% 直接斩杀，约等效 +8% 群体清怪）
      sustainHpPerSec += normalCrowdDps * (w.lifesteal ?? 0)
      if (qUnlocked) skillCrowdDps += normalCrowdDps * 0.08
    } else if (st.charId === 'mutsumi') {
      const estKillsPerSec = clamp(normalCrowdDps / Math.max(20, mobHpFor(st.diffId, layer)), 0.3, 3.0)
      const baseDur = def.skill.duration ?? 8
      const extraDur = hasBranch('duet') && hasNode('mutsumi-duet-core') ? 3.5 : 0
      const dur = baseDur + extraDur
      const cycleTime = dur + skillCost / Math.max(1, estKillsPerSec * chargePerKill)
      const uptime = clamp(dur / cycleTime, 0.15, 0.72)

      const mortisMagic = magic * (def.skill.params.magicMul ?? 1.7)
      const pulseInterval =
        (def.skill.params.pulseInterval ?? 0.5) *
        (w.mortisPulseMul ?? 1) *
        (hasBranch('symphony') && hasNode('mutsumi-symphony-pulse') ? 0.8 : 1)
      const pulseDmg =
        hitDamage(def.skill.params.pulseBaseDamage ?? 11, mortisMagic) *
        (hasBranch('symphony') ? 0.75 : 1) *
        (hasBranch('duet') ? 1.15 : 1) *
        trialSkillMul
      const radiusMul =
        (w.mortisRadiusMul ?? 1) *
        (hasBranch('duet') ? 1.25 : 1) *
        (hasBranch('duet') && hasNode('mutsumi-duet-range') ? 1.15 : 1)
      const pulseTargets = clamp(3.2 * radiusMul, 2.5, 7)
      const burstDmg = hitDamage(def.skill.params.burstDamage ?? 40, mortisMagic) * trialSkillMul

      const activeSingle = pulseDmg / pulseInterval + burstDmg / dur
      const activeCrowd = (pulseDmg * pulseTargets) / pulseInterval + (burstDmg * pulseTargets) / dur
      // 交响分支允许变身期同时普攻（伤害 ×0.7），其他分支变身期以音波/剑气为主
      const symBonus = hasBranch('symphony') ? normalCrowdDps * 0.7 : 0

      skillSingleDps = activeSingle * uptime
      skillCrowdDps = (activeCrowd + symBonus) * uptime
      if (w.mortisLifesteal) sustainHpPerSec += skillCrowdDps * w.mortisLifesteal
    } else if (st.charId === 'fish') {
      const estKillsPerSec = clamp(normalCrowdDps / Math.max(20, mobHpFor(st.diffId, layer)), 0.3, 3.0)
      const dur =
        (def.skill.duration ?? 10) +
        (hasBranch('clone') && hasNode('fish-clone-long') ? 5 : 0) +
        (hasBranch('swarm') && hasNode('fish-swarm-long') ? 4 : 0)
      const cycleTime = Math.max(dur, skillCost / Math.max(1, estKillsPerSec * chargePerKill))
      const uptime = clamp(dur / cycleTime, 0.45, 0.95)

      const minionInterval = def.skill.params.minionInterval ?? 0.45
      const minionBaseHit = hitDamage(w.damage ?? def.attack.baseDamage, magic) * trialSkillMul
      let minionCount = w.minionCount ?? 3
      let minionTotalDps = 0
      if (hasBranch('clone')) {
        // 1 只本体分身 (1.0x) + 3 只小鲸子 (0.4x)
        const cloneMul = hasNode('fish-clone-energy') ? 1.25 : 1.0
        minionTotalDps = ((1.0 * cloneMul + 3 * 0.4) * minionBaseHit) / minionInterval
        minionCount = 4
      } else {
        if (hasBranch('swarm')) minionCount = Math.max(minionCount, 5)
        const ratio = def.skill.params.minionDamageRatio ?? 0.6
        const shareMul = hasBranch('bubble') && hasNode('fish-bubble-share') ? 1.35 : 1.0
        minionTotalDps = (minionCount * ratio * shareMul * minionBaseHit) / minionInterval
        if (hasBranch('swarm') && hasNode('fish-swarm-orbit')) {
          minionTotalDps += (3 * minionBaseHit * 0.35) / 0.6 // 3 只环绕碰撞伤害
        }
      }

      skillSingleDps = minionTotalDps * uptime * 0.85
      skillCrowdDps = minionTotalDps * uptime * 1.15
      // 前排小鲸子承伤分摊（减少本体承伤）
      if (w.minionTaunt || (hasBranch('swarm') && hasNode('fish-swarm-tank'))) {
        // 反映在承伤阶段，这里记录 minionCount 供承伤模型使用
      }
      st._lastMinionCount = minionCount
    }

    // 治疗减益（考验：禁食之誓 -60%）
    if (st.trial?.def.burden.stat === 'healGain') {
      sustainHpPerSec *= Math.max(0.1, 1 + st.trial.def.burden.value)
    }

    return {
      maxHp,
      ehp,
      armorRate,
      dodge: effectiveDodge,
      critChance,
      magic,
      stamina,
      intelligence,
      interval,
      normalSingleDps,
      normalCrowdDps,
      skillSingleDps,
      skillCrowdDps,
      totalSingleDps: normalSingleDps + skillSingleDps,
      totalCrowdDps: normalCrowdDps + skillCrowdDps,
      sustainHpPerSec,
      qUnlocked,
      fUnlocked,
    }
  }

  /**
   * 模拟一次战斗（常规层 / 怪潮房 / 精英房 / Boss 层）。
   * 按 balance.json 的敌人血量、伤害、刷怪频率、移速倍率与玩家 DPS/EHP 计算耗时与承伤。
   */
  function simulateBattle(st, layer, opts = {}) {
    const { isBoss = false, enemyCount = null, eliteCount = 0, label = '常规层' } = opts
    const diff = DIFFICULTIES[st.diffId]
    const power = evaluatePlayerPower(st, layer)
    st.maxHp = power.maxHp
    st.hp = Math.min(st.hp, st.maxHp)

    const mobHp = mobHpFor(st.diffId, layer)
    const mobDmg = mobDamageFor(st.diffId, layer)
    const mobSpeed = mobSpeedMulFor(layer)
    const spawnInterval = spawnIntervalFor(st.diffId, layer)
    const spawnRate = BALANCE.layerCurve.spawnBatchBase / Math.max(0.1, spawnInterval)

    let clearTime = 0
    let totalKills = 0
    let expectedDmg = 0

    // 暴露系数：近战丛雨略高，远程睦居中，有召唤物前排的鱼较低
    let exposure = st.charId === 'murasame' ? 1.18 : st.charId === 'mutsumi' ? 0.98 : 0.85
    if (st.charId === 'fish' && (st.weaponLv >= 2 || st.potential.nodes.includes('fish-swarm-tank'))) {
      exposure *= 0.78 // 小鲸子抗伤吸引仇恨
    }
    if (st.charId === 'mutsumi' && power.qUnlocked) {
      exposure *= 0.92 // Q 推敌拉开安全距离
    }
    if (st.trial?.def.burden.stat === 'hurtTaken') {
      exposure *= 1 + st.trial.def.burden.value
    }
    if (st.trial?.def.burden.stat === 'moveSpeed') {
      exposure *= 1.15 // 负重行军移速 -15% 更易挨打
    }

    const mitigation = (1 - power.armorRate) * (1 - power.dodge) * (st.charId === 'murasame' && power.fUnlocked ? 0.92 : 1)

    if (isBoss) {
      const bossHp = bossHpFor(st.diffId, layer)
      // Boss 战同时伴随少量小怪（约 0.35 × quota）
      const adds = Math.round(quotaFor(st.diffId, layer) * 0.35)
      const bossKillTime = bossHp / Math.max(10, power.totalSingleDps)
      const addsTime = (adds * mobHp) / Math.max(15, power.totalCrowdDps)
      clearTime = bossKillTime + addsTime * 0.45
      totalKills = adds + 1

      // Boss 砸地/冲锋 + 小怪骚扰承伤
      const hitsPerSec = 0.14
      const burstSlams = Math.max(1, Math.floor(clearTime / 9)) * mobDmg * 1.9
      expectedDmg = (mobDmg * hitsPerSec * clearTime * 1.35 + burstSlams) * mitigation * exposure
    } else {
      const baseQuota = enemyCount ?? quotaFor(st.diffId, layer)
      const trialExtra = st.trial?.def.burden.stat === 'moveSpeed' ? 1.2 : 1.0 // 负重行军怪量 +20%
      const count = Math.round(baseQuota * trialExtra)
      totalKills = count
      // 精英怪血量倍率 4.2x（gameConfig.ts:88）
      const effectiveHpPool = (count - eliteCount) * mobHp + eliteCount * mobHp * 4.2
      const dpsKillRate = power.totalCrowdDps / Math.max(1, effectiveHpPool / Math.max(1, count))
      const effectiveRate = Math.min(dpsKillRate, spawnRate * 0.92)
      clearTime = count / Math.max(0.15, effectiveRate)

      const speedContact = Math.min(1.4, mobSpeed)
      const crowdFactor = (1 + Math.min(0.45, spawnRate / 7.5)) * speedContact * (eliteCount > 0 ? 1.25 : 1)
      const hitsPerSec = 0.08
      expectedDmg = mobDmg * hitsPerSec * clearTime * crowdFactor * mitigation * exposure
    }

    const healed = power.sustainHpPerSec * clearTime
    const netDmg = Math.max(0, expectedDmg - healed)
    st.hp -= netDmg

    // 大肥鱼 Q 回收：战斗关内 10s CD，按 game.ts:2675 实况 n * 15 金（模拟每 25s 回收一次，避免过度刷金失真）
    let qGold = 0
    if (st.charId === 'fish' && power.qUnlocked && clearTime >= 15) {
      const recalls = Math.floor(clearTime / 25)
      qGold = recalls * (st._lastMinionCount ?? 3) * 15
      addGold(st, qGold)
    }

    if (st.hp <= 0) {
      st.hp = 0
      return {
        survived: false,
        clearTime,
        totalKills,
        expectedDmg,
        healed,
        deathReason: `${label}承伤超限（净伤 ${Math.round(netDmg)} > 剩余HP，DPS=${Math.round(power.totalCrowdDps)}，EHP=${Math.round(power.ehp)}）`,
        power,
      }
    }

    return { survived: true, clearTime, totalKills, expectedDmg, healed, qGold, power }
  }

  function addGold(st, amount) {
    if (amount <= 0) return 0
    const fishGoldBoost =
      st.potential.branch === 'fish-clone' && st.potential.nodes.includes('fish-clone-gold') ? 1.15 : 1
    const trialPenalty = st.trial?.def.burden.stat === 'goldGain' ? Math.max(0.1, 1 + st.trial.def.burden.value) : 1
    const trialBoon = 1 + (st.trialBoons.goldGain ?? 0)
    const gained = Math.round(amount * fishGoldBoost * trialPenalty * trialBoon)
    st.gold += gained
    st.goldEarned += gained
    return gained
  }

  function spendGold(st, amount) {
    if (amount <= 0 || st.gold < amount) return false
    st.gold -= amount
    st.goldSpent += amount
    return true
  }

  /** 潜能选择（严格遵循 game.ts:2447 maxBranches = 1 实况） */
  function pickPotential(st, rng, layer, source) {
    const set = POTENTIALS[st.charId]
    if (!st.potential.branch) {
      // 按 seed 确定性选择一条分支，保证 2 局测试覆盖不同构筑路线
      const branch = set.branches[rng.int(0, set.branches.length - 1)]
      st.potential.branch = branch.id
      st.potentialLog.push(`L${layer}(${source}):分支[${branch.name}]`)
      return true
    }
    const branch = set.branches.find((b) => b.id === st.potential.branch)
    if (!branch) return false
    const remaining = branch.nodes.filter((n) => !st.potential.nodes.includes(n.id))
    if (remaining.length === 0) return false
    const picked = rng.pick(remaining)
    st.potential.nodes.push(picked.id)
    st.potentialLog.push(`L${layer}(${source}):节点[${picked.name}]`)
    return true
  }

  /** 商店消费逻辑（复用 shop.ts:generateOffers 真实货架与价格，不含作弊药水） */
  function visitShop(st, layer, rng) {
    const buyFromShelf = (offers) => {
      // 1. 货架上若真有消耗品且残血则购买（实况：4 格货架仅在全满金后才出消耗品）
      for (const co of offers.filter((o) => o.kind === "consumable")) {
        if (co.name.includes("治疗") && st.hp < st.maxHp * 0.65 && st.gold >= co.price) {
          if (spendGold(st, co.price)) {
            st.hp = Math.min(st.maxHp, st.hp + st.maxHp * (co.value ?? CONSUMABLES.heal.healRatio))
          }
        }
      }

      // 2. 优先买潜能节点（若已选分支且节点未满 3 个）
      const potOffer = offers.find((o) => o.kind === "potential")
      if (potOffer && st.potential.branch && st.potential.nodes.length < 3 && st.gold >= potOffer.price) {
        if (spendGold(st, potOffer.price)) {
          pickPotential(st, rng, layer, "商店")
        }
      }

      // 3. 买专武升级（若货架出现）
      const wepOffer = offers.find((o) => o.kind === "weapon")
      if (wepOffer && st.gold >= wepOffer.price) {
        if (spendGold(st, wepOffer.price)) {
          st.weaponLv = wepOffer.weaponLevel ?? st.weaponLv + 1
        }
      }

      // 4. 买三档道具卡（严格按 generateOffers 返回的 tier 与 price）
      for (const co of offers.filter((o) => o.kind === "buff-card")) {
        if (st.gold >= co.price) {
          const item = makeCardItem(co.stat ?? co.name, co.tier ?? 1)
          if (spendGold(st, co.price)) {
            const added = st.inventory.add(item)
            if (added) st.cardsAcquired += 1
          }
        }
      }

      // 5. 买金币特训（可重复购买，单次进店最多买 2 次）
      const trainOffer = offers.find((o) => o.kind === "training")
      if (trainOffer && trainOffer.stat) {
        for (let k = 0; k < 2; k += 1) {
          const p = k === 0 ? trainOffer.price : Math.round(trainOffer.price * 1.35)
          if (st.gold >= p + 50) {
            if (spendGold(st, p)) {
              st.training[trainOffer.stat] = Number(
                ((st.training[trainOffer.stat] ?? 0) + (trainOffer.value ?? 0)).toFixed(3),
              )
              st.trainingBuys += 1
            }
          }
        }
      }
    }

    const offers1 = generateOffers(
      layer,
      st.charId,
      st.gold,
      rng,
      undefined,
      st.weaponLv,
      st.trainingBuys,
      st.inventory,
    )
    buyFromShelf(offers1)

    // 余额充裕时花 25 金重掷一次货架
    if (st.gold >= 260 && spendGold(st, 25)) {
      const offers2 = generateOffers(
        layer,
        st.charId,
        st.gold,
        rng,
        undefined,
        st.weaponLv,
        st.trainingBuys,
        st.inventory,
      )
      buyFromShelf(offers2)
    }
  }

  /** 祭坛结算（严格对齐 altar.ts & game.ts:2753-2820） */
  function visitAltar(st, layer, rng) {
    // 优先策略：血量充裕且无扣血上限时选献血或献卡；否则玩盲筹
    const buffCards = st.inventory.items.filter((it) => it.kind === 'buff-card')
    if (st.hpCapPenalty < 0.2 && st.hp > st.maxHp * 0.7 && rng.chance(0.45)) {
      st.hpCapPenalty = Math.min(0.7, st.hpCapPenalty + 0.15)
      st.boons.attack = (st.boons.attack ?? 0) + 0.18
      st.boons.magic = (st.boons.magic ?? 0) + 0.18 // 注意：game.ts:3699 未生效，仅记录
    } else if (buffCards.length >= 2 && rng.chance(0.4)) {
      const lowest = [...buffCards].sort((a, b) => (a.tier ?? 1) - (b.tier ?? 1))[0]
      st.inventory.remove(lowest.uid)
      st.boons.all = (st.boons.all ?? 0) + 0.08
    } else {
      const cost = 20 + 6 * st.mysteryPulls
      if (spendGold(st, cost)) {
        const pulls = st.mysteryPulls
        st.mysteryPulls += 1
        const nothing = Math.min(0.92, 0.4 + 0.05 * pulls)
        const jackpot = 0.05
        const cardP = (1 - nothing - jackpot) * 0.55
        const r = rng.next()
        if (r < jackpot) {
          addGold(st, 999)
        } else if (r < jackpot + cardP) {
          const def = rng.pick([...ITEM_CARDS])
          st.inventory.add(makeCardItem(def.id, layer >= 9 ? 3 : 2))
          st.cardsAcquired += 1
        } else if (r < 1 - nothing) {
          addGold(st, 30 + 10 * pulls)
        }
      }
    }
  }

  /** 考验门结算（对齐 trials.ts & game.ts:2830-2905） */
  function visitTrial(st, rng) {
    if (st.trial) return // 已有活跃立约则婉拒
    const trial = rng.pick([...TRIALS])
    // 血量健康时接下非单挑类立约
    if (st.hp > st.maxHp * 0.6 && trial.goal.kind === 'layers') {
      st.trial = { def: trial, layersLeft: trial.burden.layers }
    }
  }

  function tickTrialAfterLayer(st) {
    if (!st.trial) return
    st.trial.layersLeft -= 1
    if (st.trial.layersLeft <= 0) {
      const b = st.trial.def.boon
      if (b.stat === 'goldGain') {
        addGold(st, Math.round(st.gold * b.value))
      } else if (b.stat === 'hpMax') {
        st.trialBoons.hpMax = (st.trialBoons.hpMax ?? 0) + b.value
        st.trialBoons.healPerSec = (st.trialBoons.healPerSec ?? 0) + 0.005
      } else {
        st.trialBoons[b.stat] = (st.trialBoons[b.stat] ?? 0) + b.value
      }
      st.trial = null
    }
  }

  /** 事件结算（抽取真实 EVENTS 定义并执行效果，严格按 EventEffect schema） */
  function visitEvent(st, eventId, layer, rng) {
    const ev = EVENTS.find((e) => e.id === eventId) ?? rng.pick([...EVENTS])
    const opt = rng.pick([...ev.options])
    const outcome = rng.pick([...opt.outcomes])
    for (const eff of outcome.effects ?? []) {
      if (eff.kind === "gold" && typeof eff.value === "number") {
        if (eff.value >= 0) addGold(st, eff.value)
        else spendGold(st, Math.min(st.gold, -eff.value))
      } else if (eff.kind === "heal" && typeof eff.ratio === "number") {
        if (eff.ratio >= 0) st.hp = Math.min(st.maxHp, st.hp + st.maxHp * eff.ratio)
        else st.hp = Math.max(1, st.hp + st.maxHp * eff.ratio)
      } else if (eff.kind === "card") {
        const def = rng.pick([...ITEM_CARDS])
        const tierNum = eff.tier === "gold" ? 3 : eff.tier === "purple" ? 2 : 1
        st.inventory.add(makeCardItem(def.id, tierNum))
        st.cardsAcquired += 1
      } else if (eff.kind === "battle" && eff.count > 0) {
        const res = simulateBattle(st, layer, {
          enemyCount: eff.count,
          eliteCount: eff.count === 1 ? 1 : 0,
          label: `事件遭遇战(${ev.title})`,
        })
        if (!res.survived) return res
      }
    }
    return { survived: true }
  }

  /** 单局完整推演 */
  function runSimulation(charId, diffId, seed) {
    const rng = new Rng(seed)
    const totalLayers = layerCount(diffId)
    const def = CHARACTERS[charId]
    const st = {
      charId,
      diffId,
      seed,
      hp: def.base.hp,
      maxHp: def.base.hp,
      gold: 0,
      goldEarned: 0,
      goldSpent: 0,
      weaponLv: 1,
      inventory: new Inventory(),
      training: {},
      trainingBuys: 0,
      potential: { branch: null, nodes: [] },
      potentialLog: [],
      boons: {},
      hpCapPenalty: 0,
      mysteryPulls: 0,
      trial: null,
      trialBoons: {},
      cardsAcquired: 0,
      roomCounts: {},
      _lastMinionCount: 3,
    }

    const stageTime = {}
    let clearedLayers = 0
    let diedAt = null
    let deathReason = '通关'
    let lastPower = evaluatePlayerPower(st, 1)

    for (let layer = 1; layer <= totalLayers; layer += 1) {
      const stage = stageOfLayer(diffId, layer)
      const boss = isBossLayer(diffId, layer)

      // 简单难度每层进场回 15% HP（game.ts:558）
      if (diffId === 'easy' && layer > 1) {
        st.hp = Math.min(st.maxHp, st.hp + st.maxHp * 0.15)
      }

      // 1. 本层主战斗
      const battleRes = simulateBattle(st, layer, {
        isBoss: boss,
        label: boss ? `第${layer}层Boss战` : `第${layer}层常规战`,
      })
      stageTime[stage] = (stageTime[stage] ?? 0) + battleRes.clearTime
      lastPower = battleRes.power

      if (!battleRes.survived) {
        diedAt = layer
        deathReason = battleRes.deathReason
        break
      }

      // 2. 清层金币结算
      const kGold = battleRes.totalKills * killGold(layer, 'small')
      const cGold = clearGold(diffId, layer)
      addGold(st, kGold + cGold)
      if (boss) {
        addGold(st, Math.round((130 + 22 * layer) * DIFFICULTIES[diffId].goldMul))
        st.hp = Math.min(st.maxHp, st.hp + st.maxHp * 0.25)
      }

      clearedLayers = layer
      tickTrialAfterLayer(st)

      // 最后一层通关直接结束
      if (layer === totalLayers) break

      // 3. 第 1 层清完必弹一次潜能选分支（game.ts:2368）
      if (layer === 1) {
        pickPotential(st, rng, layer, '1层保底')
      }

      // 4. 掷 3 扇时空隧道门并按门权重随机选 1 扇
      const nextIsBoss = isBossLayer(diffId, layer + 1)
      const offers = rollTunnels(
        layer,
        totalLayers,
        nextIsBoss,
        charId,
        rng,
        st.weaponLv,
        st.trainingBuys,
        diffId,
      )
      const chosen = rng.pick(offers)
      st.roomCounts[chosen.room] = (st.roomCounts[chosen.room] ?? 0) + 1

      if (chosen.room === 'boss') continue

      const res = resolveRoom(chosen, layer, charId, rng, st.trainingBuys, diffId)
      if (chosen.room === 'chest' || chosen.room === 'skill-card') {
        const card = res.card ?? makeCardItem(rng.pick([...ITEM_CARDS]).id, 1)
        // 策略：已有金卡则换金币，否则 75% 直接领卡 / 25% 赌一把升档
        const optId = card.tier >= 3 ? 'take-gold' : rng.chance(0.75) ? 'take-card' : 'gamble'
        const rr = resolveRewardChoice(optId, card, diffId, layer, rng)
        if (rr.card) {
          st.inventory.add(rr.card)
          st.cardsAcquired += 1
        }
        if (rr.gold) addGold(st, rr.gold)
      } else if (chosen.room === 'merchant') {
        visitShop(st, layer, rng)
      } else if (chosen.room === 'altar') {
        visitAltar(st, layer, rng)
      } else if (chosen.room === 'trial') {
        visitTrial(st, rng)
      } else if (chosen.room === 'event') {
        const evRes = visitEvent(st, res.event?.id, layer, rng)
        if (!evRes.survived) {
          diedAt = layer
          deathReason = evRes.deathReason
          break
        }
      } else if (chosen.room === 'minigame') {
        // 小游戏 70% 通关率（game.ts:2931）
        if (rng.chance(0.7)) addGold(st, 90 + 25 * layer)
      } else if (chosen.room === 'rest') {
        st.hp = Math.min(st.maxHp, st.hp + st.maxHp * (res.rest?.healRatio ?? 0.28))
      } else if (chosen.room === 'mob-wave' || chosen.room === 'elite-fight') {
        const roomBattle = simulateBattle(st, layer, {
          enemyCount: res.enemies?.count ?? 15,
          eliteCount: res.enemies?.elite ?? 0,
          label: chosen.room === 'elite-fight' ? `第${layer}层精英房` : `第${layer}层怪潮房`,
        })
        stageTime[stage] = (stageTime[stage] ?? 0) + roomBattle.clearTime
        lastPower = roomBattle.power
        if (!roomBattle.survived) {
          diedAt = layer
          deathReason = roomBattle.deathReason
          break
        }
        // 战斗门战后奖励（game.ts:2943）
        const reward = chosen.payload.reward ?? 'gold'
        if (reward === 'gold') {
          addGold(st, 140 + 45 * layer)
        } else if (reward === 'card') {
          const defCard = rng.pick([...ITEM_CARDS])
          st.inventory.add(makeCardItem(defCard.id, layer >= 9 ? 3 : layer >= 5 ? 2 : 1))
          st.cardsAcquired += 1
        } else if (reward === 'potential') {
          pickPotential(st, rng, layer, '战斗潜能门')
        }
      }
    }

    const finalPower = evaluatePlayerPower(st, Math.min(totalLayers, Math.max(1, clearedLayers)))
    const heldCards = st.inventory.items.filter((it) => it.kind === 'buff-card')
    const goldCardCount = heldCards.filter((it) => it.tier === 3).length

    return {
      charId,
      charName: CHAR_NAMES[charId],
      diffId,
      diffName: DIFF_NAMES[diffId],
      seed,
      totalLayers,
      clearedLayers,
      survived: diedAt === null,
      diedAt,
      deathReason,
      goldEarned: st.goldEarned,
      goldSpent: st.goldSpent,
      goldBalance: st.gold,
      weaponLv: st.weaponLv,
      cardCount: heldCards.length,
      goldCardCount,
      trainingBuys: st.trainingBuys,
      potentialBranch: st.potential.branch ?? '无',
      potentialNodeCount: st.potential.nodes.length,
      potentialRoute: st.potentialLog.join(' → ') || '无',
      qUnlocked: finalPower.qUnlocked,
      fUnlocked: finalPower.fUnlocked,
      finalNormalSingleDps: Number(finalPower.normalSingleDps.toFixed(1)),
      finalNormalCrowdDps: Number(finalPower.normalCrowdDps.toFixed(1)),
      finalSkillSingleDps: Number(finalPower.skillSingleDps.toFixed(1)),
      finalSkillCrowdDps: Number(finalPower.skillCrowdDps.toFixed(1)),
      finalTotalCrowdDps: Number(finalPower.totalCrowdDps.toFixed(1)),
      finalEhp: Math.round(finalPower.ehp),
      finalMaxHp: finalPower.maxHp,
      stageTimeSec: Object.fromEntries(
        Object.entries(stageTime).map(([k, v]) => [`stage${k}`, Math.round(v)]),
      ),
      roomCounts: st.roomCounts,
    }
  }

  // ── 执行 18 局矩阵推演 ────────────────────────────────────────────────────
  const results = []
  let seedOffset = 0
  for (const charId of CHAR_IDS) {
    for (const diffId of DIFFICULTY_IDS) {
      for (const baseSeed of SEEDS) {
        seedOffset += 1
        results.push(runSimulation(charId, diffId, baseSeed * 10 + seedOffset))
      }
    }
  }

  // ── 附加：3000 扇门抽样审计（检验门权重与房间断层）────────────────────────
  const doorRng = new Rng(9999)
  const doorCounts = {}
  const kindCounts = {}
  const sampleRounds = 1000
  for (let i = 0; i < sampleRounds; i += 1) {
    const layer = (i % 12) + 1
    const offers = rollTunnels(layer, 18, false, 'mutsumi', doorRng, 1, 0, 'normal')
    for (const o of offers) {
      doorCounts[o.room] = (doorCounts[o.room] ?? 0) + 1
      kindCounts[o.kind] = (kindCounts[o.kind] ?? 0) + 1
    }
  }

  // ── 输出汇总表 ────────────────────────────────────────────────────────────
  console.log('=== 肉鸽爬塔 · 18 局全量矩阵仿真汇总 ===')
  console.log(
    '角色   | 难度 | 种子 | 结局      | 收入/支出/结余    | 专武 | 卡(金) | 潜能节点 | 群DPS | EHP  | 各大层耗时(s) | 死亡/状态',
  )
  console.log('-'.repeat(122))
  for (const r of results) {
    const outcome = r.survived ? `通关 ${r.clearedLayers}/${r.totalLayers}` : `死于 L${r.diedAt}/${r.totalLayers}`
    const goldStr = `${r.goldEarned}/${r.goldSpent}/${r.goldBalance}`.padEnd(17)
    const timeStr = Object.entries(r.stageTimeSec)
      .map(([k, v]) => `${k.replace('stage', 'S')}:${v}`)
      .join(' ')
      .padEnd(13)
    console.log(
      `${r.charName.padEnd(4)} | ${r.diffName} | ${String(r.seed).padEnd(4)} | ${outcome.padEnd(9)} | ${goldStr} | Lv${r.weaponLv}  | ${String(r.cardCount).padStart(2)}(${r.goldCardCount})  | ${r.potentialNodeCount}/3 (${r.fUnlocked ? 'Q+F' : r.qUnlocked ? 'Q  ' : '无 '}) | ${String(r.finalTotalCrowdDps).padStart(5)} | ${String(r.finalEhp).padStart(4)} | ${timeStr} | ${r.survived ? '通关' : r.deathReason.slice(0, 42)}`,
    )
  }

  console.log('\n=== 门权重抽样（1000 轮 × 3 门 = 3000 扇） ===')
  for (const [room, cnt] of Object.entries(doorCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${room.padEnd(12)}: ${String(cnt).padStart(4)} (${((cnt / 3000) * 100).toFixed(2)}%)`)
  }

  // ── 冒烟健全性断言（确保仿真器无 NaN、覆盖全部 18 局）────────────────────
  let pass = 0
  let fail = 0
  const check = (name, cond, detail = '') => {
    if (cond) pass += 1
    else {
      fail += 1
      console.error(`FAIL  ${name}  → ${detail}`)
    }
  }

  check('覆盖全部 18 局（3 角色 × 3 难度 × 2 局）', results.length === 18, `len=${results.length}`)
  check(
    '所有局数值有效（无 NaN / 无负金币）',
    results.every(
      (r) =>
        Number.isFinite(r.finalTotalCrowdDps) &&
        Number.isFinite(r.finalEhp) &&
        r.goldBalance >= 0 &&
        r.goldEarned >= r.goldSpent,
    ),
  )
  check('所有局均在第 1 层清完后获得潜能分支（或死于 L1）', results.every((r) => r.diedAt === 1 || r.potentialBranch !== '无'))

  if (SHOW_JSON) {
    console.log('\n__JSON_START__')
    console.log(JSON.stringify({ results, doorCounts, kindCounts }, null, 2))
    console.log('__JSON_END__')
  }

  console.log(`\n全量矩阵仿真冒烟：${pass} 通过，${fail} 失败`)
  if (fail > 0) process.exitCode = 1
} finally {
  await server.close()
}
