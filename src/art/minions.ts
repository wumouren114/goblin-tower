import * as THREE from 'three'
import { PixelCanvas } from './pixels'
import { createSpriteMesh, textureFromPixels, type SpriteAnim } from './sprites'

/**
 * 小肥鱼（召唤物）程序化像素贴图：14×10 蓝色小鱼，最近邻采样。
 */
function minionPixels(): PixelCanvas {
  const pc = new PixelCanvas(14, 10)
  // 身体
  pc.ellipse(6.4, 5, 4.6, 3.1, 0x2f7fd0)
  pc.ellipse(6.4, 4.4, 4.2, 2.4, 0x58b6ff)
  // 肚皮
  pc.ellipse(6.6, 6.2, 3.2, 1.6, 0xd8f2ff)
  // 尾巴
  pc.triangle(1.2, 2.6, 3.4, 5, 1.2, 7.4, 0x2f7fd0)
  pc.triangle(1.6, 3.2, 3.2, 5, 1.6, 6.8, 0x58b6ff)
  // 背鳍
  pc.triangle(5.2, 2.2, 7.2, 0.8, 8.6, 2.4, 0x1f5fa8)
  // 眼睛
  pc.set(9, 3, 0x0b2540)
  pc.set(9, 4, 0x0b2540)
  pc.set(10, 3, 0xffffff)
  // 高光/鳃
  pc.set(5, 3, 0x9fdcff)
  pc.set(4, 4, 0x9fdcff)
  pc.set(8, 5, 0x1f5fa8)
  return pc
}

let cached: SpriteAnim | null = null

function minionAnim(): SpriteAnim {
  if (cached) return cached
  const pc = minionPixels()
  const texture = textureFromPixels(pc)
  const frame = { offsetX: 0, offsetY: 0 }
  const frames = {
    down: [frame],
    up: [frame],
    left: [frame],
    right: [frame],
  } as SpriteAnim['frames']
  cached = { texture, frames, cols: 1, rows: 1, worldW: 0.78, worldH: 0.56 }
  return cached
}

/** 创建小肥鱼 billboard（原点在脚底，和角色精灵一致） */
export function createMinionMesh(scale = 1): THREE.Mesh {
  const mesh = createSpriteMesh(minionAnim())
  mesh.scale.setScalar(scale)
  mesh.renderOrder = 3
  return mesh
}

export function disposeMinionArt(): void {
  if (cached) cached.texture.dispose()
  cached = null
}
