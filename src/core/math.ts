import * as THREE from 'three'
import { CONFIG } from '../data/gameConfig'

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.damp(current, target, lambda, dt)
}

/** 屏幕系输入 → 世界系方向（yaw=0 时 W 朝 -Z，远离相机） */
export function rotateInput(x: number, z: number, yaw: number): { x: number; z: number } {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return { x: x * c - z * s, z: -x * s - z * c }
}

export function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI
  if (diff < -Math.PI) diff += Math.PI * 2
  return a + diff * t
}
