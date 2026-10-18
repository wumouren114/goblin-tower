// 临时 UI 预览入口（仅供 scripts/ui-shot.mjs 无头截图自测，不参与游戏运行）
import * as THREE from 'three'
import { createHud } from '../src/ui/hud'
import type {
  HudSnapshot,
  HudV3Handlers,
  InventoryItem,
  RunStatsV3,
  SaveSlotMeta,
  ShopOffer,
  TunnelOffer,
} from '../src/types'

const log = (name: string) => (...args: unknown[]) => {
  console.log(`[ui] ${name}`, ...args)
  ;((window as unknown as { __uiLog: unknown[] }).__uiLog ??= []).push({ name, args })
}

const handlers: HudV3Handlers = {
  onStart: log('onStart') as HudV3Handlers['onStart'],
  onContinue: log('onContinue') as HudV3Handlers['onContinue'],
  onTunnelPick: log('onTunnelPick') as HudV3Handlers['onTunnelPick'],
  onShopBuy: log('onShopBuy') as HudV3Handlers['onShopBuy'],
  onShopRefresh: log('onShopRefresh') as HudV3Handlers['onShopRefresh'],
  onShopClose: log('onShopClose') as HudV3Handlers['onShopClose'],
  onOpenInventory: log('onOpenInventory') as HudV3Handlers['onOpenInventory'],
  onCloseInventory: log('onCloseInventory') as HudV3Handlers['onCloseInventory'],
  onMergeItem: log('onMergeItem') as HudV3Handlers['onMergeItem'],
  onUseItem: log('onUseItem') as HudV3Handlers['onUseItem'],
  onSave: log('onSave') as HudV3Handlers['onSave'],
  onLoad: log('onLoad') as HudV3Handlers['onLoad'],
  onPauseToggle: log('onPauseToggle') as HudV3Handlers['onPauseToggle'],
  onRestart: log('onRestart') as HudV3Handlers['onRestart'],
  onQuitToTitle: log('onQuitToTitle') as HudV3Handlers['onQuitToTitle'],
}

const hud = createHud(handlers)
;(window as unknown as { __hud: unknown }).__hud = hud

const slots: SaveSlotMeta[] = [
  {
    slot: 1,
    empty: false,
    character: 'mutsumi',
    difficulty: 'normal',
    layer: 4,
    stage: 2,
    weaponLv: 2,
    gold: 320,
    playTime: 1520,
    savedAt: '2026-10-17 22:41',
  },
  { slot: 2, empty: true },
  {
    slot: 3,
    empty: false,
    character: 'fish',
    difficulty: 'hard',
    layer: 9,
    stage: 3,
    weaponLv: 4,
    gold: 860,
    playTime: 3125,
    savedAt: '2026-10-18 01:02',
  },
]

const shopOffers: ShopOffer[] = [
  { id: 's1', kind: 'weapon', name: '小黄瓜·专武券', desc: '专武等级 +1（当前 Lv.2）', icon: '🥒', price: 120, tier: 2, weaponLevel: 3 },
  { id: 's2', kind: 'buff-card', name: '魔力药剂', desc: '魔力 +18', icon: '🔮', price: 45, tier: 3, stat: 'magic', value: 18 },
  { id: 's3', kind: 'buff-card', name: '疾风之靴', desc: '移动速度 +0.25', icon: '👢', price: 38, tier: 2, stat: 'moveSpeed', value: 0.25 },
  { id: 's4', kind: 'consumable', name: '治疗药水', desc: '立刻回复 30 点生命', icon: '🧪', price: 20, tier: 1 },
]

const items: InventoryItem[] = [
  { uid: 'i1', kind: 'weapon', name: '小黄瓜·专武券', desc: '专武等级 +1', icon: '🥒', tier: 2 },
  { uid: 'i2', kind: 'buff-card', name: '魔力药剂', desc: '魔力 +18', icon: '🔮', tier: 2, stat: 'magic', value: 18 },
  { uid: 'i3', kind: 'buff-card', name: '魔力药剂', desc: '魔力 +18', icon: '🔮', tier: 2, stat: 'magic', value: 18 },
  { uid: 'i4', kind: 'buff-card', name: '生命结晶', desc: '生命上限 +25', icon: '💎', tier: 3, stat: 'hp', value: 25 },
  { uid: 'i5', kind: 'buff-card', name: '铁鳞甲片', desc: '护甲 +3%', icon: '🛡️', tier: 1, stat: 'armor', value: 3 },
  { uid: 'i6', kind: 'buff-card', name: '疾影护符', desc: '闪避 +3%', icon: '🌀', tier: 2, stat: 'dodge', value: 3 },
  { uid: 'i7', kind: 'consumable', name: '充能电池', desc: '立刻充满技能', icon: '🔋', tier: 1 },
  { uid: 'i8', kind: 'buff-card', name: '猎手徽记', desc: '充能获取 +8%', icon: '🎖️', tier: 2, stat: 'chargeGain', value: 8 },
  { uid: 'i9', kind: 'buff-card', name: '疾风之靴', desc: '移动速度 +0.25', icon: '👢', tier: 2, stat: 'moveSpeed', value: 0.25 },
  { uid: 'i10', kind: 'buff-card', name: '耐力药剂', desc: '耐力 +16', icon: '🧪', tier: 1, stat: 'stamina', value: 16 },
  { uid: 'i11', kind: 'buff-card', name: '智力药剂', desc: '智力 +12', icon: '📘', tier: 3, stat: 'intelligence', value: 12 },
]

const tunnelOffers = (): TunnelOffer[] => [
  {
    id: 't1',
    kind: 'reward',
    room: 'chest',
    title: '宝箱密室',
    desc: '堆满金币的旧宝箱，也许还有遗落的卡片。',
    icon: '🧰',
    payload: { gold: 84 },
  },
  {
    id: 't2',
    kind: 'trade',
    room: 'merchant',
    title: '流浪商人',
    desc: '用金币换点实用的东西，童叟无欺（大概）。',
    icon: '🧙',
    payload: { shopOffers },
  },
  {
    id: 't3',
    kind: 'battle',
    room: 'mob-wave',
    title: '哥布林怪潮',
    desc: '一群哥布林正等着你，击败它们换取金币与充能。',
    icon: '👹',
    payload: { enemyCount: 9 },
  },
]

const stats = (reason?: 'hp' | 'timeout'): RunStatsV3 => ({
  character: 'murasame',
  difficulty: 'hard',
  layer: reason ? 6 : 10,
  totalLayers: 10,
  gold: 412,
  kills: 63,
  weaponLv: 3,
  cardCount: 7,
  time: 754,
  reason,
})

const snapshot = (): HudSnapshot => ({
  hp: 46,
  maxHp: 120,
  gold: 186,
  kills: 27,
  floor: 4,
  floorName: '锈蚀回廊',
  quota: 6,
  quotaMax: 9,
  stairsUnlocked: false,
  enemiesAlive: 3,
  time: 12,
  timeLeft: 12,
  charge: 68,
  chargeMax: 100,
  weaponLv: 2,
  skillName: '居合突进',
  skillReady: false,
  cardCount: 5,
  stage: 2,
  difficulty: 'normal',
  monsterKilled: 6,
  monsterTotal: 9,
  boss: null,
})

const bossSnapshot = (): HudSnapshot => ({
  ...snapshot(),
  hp: 30,
  maxHp: 120,
  floor: 4,
  quota: 0,
  quotaMax: 0,
  monsterKilled: 0,
  monsterTotal: 0,
  enemiesAlive: 1,
  boss: { name: '哥布林督军·格里克', hp: 640, maxHp: 1600 },
})

function demoFloaters(): void {
  const cam = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100)
  cam.position.set(0, 2, 10)
  cam.lookAt(0, 1, 0)
  cam.updateMatrixWorld()
  hud.setCamera(cam)
  hud.damageNumber(new THREE.Vector3(-1.2, 1.2, 0), 24, 'normal')
  hud.damageNumber(new THREE.Vector3(0.4, 1.5, 0), 86, 'crit')
  hud.damageNumber(new THREE.Vector3(1.6, 0.7, 0), 18, 'heal')
  hud.damageNumber(new THREE.Vector3(-2.4, 0.3, 0), 12, 'gold')
}

const screen =
  (window as unknown as { __SCREEN?: string }).__SCREEN ??
  new URLSearchParams(location.search).get('screen') ??
  'title'

switch (screen) {
  case 'title':
    hud.showTitle(slots)
    break
  case 'charselect':
    hud.showTitle(slots)
    hud.showCharacterSelect()
    break
  case 'tunnel':
    hud.update(snapshot())
    hud.showTunnelOffers(tunnelOffers(), 4)
    break
  case 'shop':
    hud.update(snapshot())
    hud.showShop(shopOffers, 186, 25)
    break
  case 'inventory':
    hud.update(snapshot())
    hud.showInventory(items, 186, 12)
    break
  case 'pause':
    hud.update(snapshot())
    hud.showPause(slots)
    break
  case 'savesave':
    hud.update(snapshot())
    hud.showPause(slots)
    hud.showSaveSlots('save', slots)
    break
  case 'saveload':
    hud.update(snapshot())
    hud.showSaveSlots('load', slots)
    break
  case 'defeat-hp':
    hud.showDefeat('hp', stats('hp'))
    break
  case 'defeat-timeout':
    hud.showDefeat('timeout', stats('timeout'))
    break
  case 'victory':
    hud.showVictory(stats())
    break
  case 'hud':
    hud.update(snapshot())
    hud.showLayerBanner(4, '锈蚀回廊', '清空场上的哥布林，打开时空隧道', 10)
    demoFloaters()
    break
  case 'boss':
    hud.update(bossSnapshot())
    hud.showBoss('哥布林督军·格里克', 640, 1600)
    demoFloaters()
    break
  case 'hud-danger':
    hud.update({ ...snapshot(), hp: 9, timeLeft: 6 })
    break
  default:
    hud.showTitle(slots)
}

document.documentElement.dataset.screen = screen
;(window as unknown as { __previewReady: boolean }).__previewReady = true
