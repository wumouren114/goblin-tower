import * as THREE from 'three'
import { CONFIG } from '../data/gameConfig'

export type CameraMode = 'combat' | 'explore'

/**
 * 第三人称跟随相机：
 * - 默认「割草视角」高机位俯视，看得清全场；
 * - V 键切换「探索视角」低机位，更沉浸；
 * - 鼠标拖拽环绕、滚轮缩放；镜头带阻尼与受击屏震。
 */
export class CameraRig {
  mode: CameraMode = 'combat'
  yaw = 0
  private camera: THREE.PerspectiveCamera
  private distanceMul = 1
  private follow = new THREE.Vector3(0, 12, 16)
  private look = new THREE.Vector3()
  private desired = new THREE.Vector3()
  private lookTarget = new THREE.Vector3()
  private shakeAmt = 0
  private titleAngle = 0
  private initialised = false
  /** 场地半边长：相机不许退到墙外 */
  private arenaHalf = 0

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.camera.fov = CONFIG.camera.fov
    this.camera.near = CONFIG.camera.near
    this.camera.far = CONFIG.camera.far
    this.camera.updateProjectionMatrix()
  }

  get modeName(): string {
    return this.mode === 'combat' ? '割草视角' : '探索视角'
  }

  toggleMode(): CameraMode {
    this.mode = this.mode === 'combat' ? 'explore' : 'combat'
    this.camera.fov = this.mode === 'combat' ? CONFIG.camera.fov : 62
    this.camera.updateProjectionMatrix()
    return this.mode
  }

  addYaw(delta: number): void {
    this.yaw += delta
  }

  zoom(wheel: number): void {
    if (!wheel) return
    this.distanceMul = THREE.MathUtils.clamp(this.distanceMul * (1 + wheel * 0.07), 0.72, 1.45)
  }

  setArenaHalf(halfSize: number): void {
    this.arenaHalf = halfSize
  }

  /** 按场地半边长收紧镜头距离，避免相机退到墙外被遮挡 */
  fitForArena(halfSize: number): void {
    const base = CONFIG.camera.modes[this.mode].distance
    const want = Math.min(base, halfSize * 0.62)
    this.distanceMul = THREE.MathUtils.clamp(want / base, 0.5, 1.45)
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.1, this.shakeAmt + amount)
  }

  reset(): void {
    this.yaw = 0
    this.distanceMul = 1
    this.shakeAmt = 0
    this.initialised = false
  }

  update(dt: number, x: number, z: number, moveX: number, moveZ: number, title = false): void {
    const m = CONFIG.camera.modes[this.mode]
    const dist = m.distance * this.distanceMul
    const height = m.height * (0.88 + 0.12 * this.distanceMul)
    if (title) this.titleAngle += dt * 0.045
    const yaw = this.yaw + (title ? this.titleAngle : 0)

    this.desired.set(x + Math.sin(yaw) * dist, height, z + Math.cos(yaw) * dist)

    const k = this.initialised ? 1 - Math.exp(-CONFIG.camera.follow * dt) : 1
    this.follow.lerp(this.desired, k)

    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    this.lookTarget.set(x + fx * m.lookAhead * 0.55 + moveX * m.lookAhead * 0.45, 0.9, z + fz * m.lookAhead * 0.55 + moveZ * m.lookAhead * 0.45)
    if (!this.initialised) this.look.copy(this.lookTarget)
    this.look.lerp(this.lookTarget, this.initialised ? 1 - Math.exp(-CONFIG.camera.follow * 1.3 * dt) : 1)

    this.camera.position.copy(this.follow)
    if (this.shakeAmt > 0.0005) {
      this.camera.position.x += (Math.random() * 2 - 1) * this.shakeAmt
      this.camera.position.y += (Math.random() * 2 - 1) * this.shakeAmt
      this.camera.position.z += (Math.random() * 2 - 1) * this.shakeAmt
      this.shakeAmt *= Math.exp(-7 * dt)
    }
    this.camera.lookAt(this.look)
    this.initialised = true
  }

  dispose(): void {
    /* 相机由渲染层管理，无需释放 */
  }
}
