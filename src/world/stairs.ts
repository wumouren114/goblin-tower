import * as THREE from 'three'
import type { ThemeDef } from '../types'
import type { TextureBook } from './textures'
import { disposeTree } from './util'

/**
 * ============================================================
 *  北侧楼梯门 / 传送门
 *  - 未解锁：暗色石门 + 红色警示符文 + 地面红色符文缓慢脉动
 *  - setUnlocked(true)：门扉亮起、向上抽离消散、光柱冲天、
 *    金色粒子上升、地面符文向外扩散
 *  - x / z 是玩家可交互的位置（门前踏台）
 * ============================================================
 */
export class StairGate {
  readonly group = new THREE.Group()
  x = 0
  z = 0
  unlocked = false

  private theme: ThemeDef | null = null
  private tex: TextureBook | null = null
  private half = 17
  private wallHeight = 2.4

  private door: THREE.Mesh | null = null
  private doorMat: THREE.MeshStandardMaterial | null = null
  private doorBaseY = 0
  private doorH = 2.4

  private portal: THREE.Mesh | null = null
  private portalMat: THREE.MeshBasicMaterial | null = null

  private beam: THREE.Mesh | null = null
  private beamMat: THREE.MeshBasicMaterial | null = null
  private beamH = 12

  private lockRing: THREE.Mesh | null = null
  private lockRingMat: THREE.MeshBasicMaterial | null = null
  private openRing: THREE.Mesh | null = null
  private openRingMat: THREE.MeshBasicMaterial | null = null

  private light: THREE.PointLight | null = null

  private particles: THREE.Points | null = null
  private pPos: Float32Array | null = null
  private pSize: number[] = []
  private pSpeed: number[] = []
  private pPhase: number[] = []
  private pBase: number[] = []
  private pTop = 6

  private openT = 0
  private time = 0
  private rand = 0x2545f491

  /** 门附近的功能性 y 高度（供火焰/粒子参考） */
  get doorTopY(): number {
    return this.doorH
  }

  /** 小范围可复现随机（仅用于粒子重置，不影响关卡布局） */
  private next(): number {
    this.rand ^= this.rand << 13
    this.rand ^= this.rand >>> 17
    this.rand ^= this.rand << 5
    return ((this.rand >>> 0) % 100000) / 100000
  }

  build(theme: ThemeDef, tex: TextureBook, halfSize: number, wallHeight: number): void {
    this.dispose()
    this.theme = theme
    this.tex = tex
    this.half = halfSize
    this.wallHeight = wallHeight
    this.unlocked = false
    this.openT = 0
    this.time = 0
    this.x = 0
    this.z = -(halfSize - 2.9)

    this.doorH = Math.max(1.9, wallHeight - 0.55)
    const dw = Math.min(3.4, this.doorH * 1.45)
    const zWall = -halfSize
    const zFace = zWall + 0.34

    /* ---------------- 门框（石制） ---------------- */
    const frameMat = new THREE.MeshStandardMaterial({
      color: mix(theme.wallColor, 0x000000, 0.18),
      roughness: 0.95,
      flatShading: true,
    })
    const frameTopMat = new THREE.MeshStandardMaterial({
      color: mix(theme.wallTopColor, theme.accentColor, 0.12),
      roughness: 0.85,
      flatShading: true,
    })

    const jambW = 0.85
    const jambD = 1.1
    const jambGeo = new THREE.BoxGeometry(jambW, wallHeight, jambD)
    for (const sx of [-1, 1]) {
      const jamb = new THREE.Mesh(jambGeo, frameMat)
      jamb.position.set(sx * (dw / 2 + jambW / 2), wallHeight / 2, zWall + jambD / 2)
      jamb.castShadow = true
      jamb.receiveShadow = true
      this.group.add(jamb)
      // 柱头
      const cap = new THREE.Mesh(new THREE.BoxGeometry(jambW + 0.3, 0.26, jambD + 0.3), frameTopMat)
      cap.position.set(sx * (dw / 2 + jambW / 2), wallHeight - 0.13, zWall + jambD / 2)
      cap.castShadow = true
      this.group.add(cap)
    }

    // 门楣
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(dw + jambW * 2 + 0.6, 0.55, jambD + 0.2), frameTopMat)
    lintel.position.set(0, wallHeight - 0.27, zWall + jambD / 2)
    lintel.castShadow = true
    lintel.receiveShadow = true
    this.group.add(lintel)

    // 拱腹（门洞顶部斜面装饰）
    const arch = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.5, 0.16, 0.28), frameMat)
    arch.position.set(0, wallHeight - 0.62, zFace + 0.02)
    this.group.add(arch)

    /* ---------------- 门扉 ---------------- */
    const doorGeo = new THREE.PlaneGeometry(dw, this.doorH)
    this.doorMat = new THREE.MeshStandardMaterial({
      map: tex.doorLocked,
      emissiveMap: tex.doorLocked,
      emissive: new THREE.Color(theme.accentColor),
      emissiveIntensity: 0.0,
      roughness: 0.82,
      metalness: 0.15,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
    this.door = new THREE.Mesh(doorGeo, this.doorMat)
    this.doorBaseY = this.doorH / 2 + 0.02
    this.door.position.set(0, this.doorBaseY, zFace)
    this.door.castShadow = true
    this.door.receiveShadow = true
    this.group.add(this.door)

    // 门后发光传送面（打开后可见）
    this.portalMat = new THREE.MeshBasicMaterial({
      map: tex.glow,
      color: theme.accentColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.portal = new THREE.Mesh(new THREE.PlaneGeometry(dw * 1.02, this.doorH * 1.02), this.portalMat)
    this.portal.position.set(0, this.doorH / 2 + 0.02, zFace - 0.06)
    this.group.add(this.portal)

    /* ---------------- 门槛台阶 ---------------- */
    const stepMat = new THREE.MeshStandardMaterial({
      color: mix(theme.wallTopColor, theme.wallColor, 0.5),
      roughness: 0.96,
      flatShading: true,
    })
    // 三级台阶自门前向厅内由高到低（位于门框前方，不穿模）
    for (let i = 0; i < 3; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.9 - i * 0.25, 0.1, 0.56), stepMat)
      step.position.set(0, 0.05 + i * 0.09, -halfSize + 1.45 + (2 - i) * 0.42)
      step.receiveShadow = true
      this.group.add(step)
    }

    /* ---------------- 光柱 ---------------- */
    this.beamH = Math.max(9, wallHeight * 4.2)
    this.beamMat = new THREE.MeshBasicMaterial({
      map: tex.beam,
      color: mix(theme.accentColor, 0xffffff, 0.25),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const beamGeo = new THREE.CylinderGeometry(dw * 0.34, dw * 0.5, 1, 14, 1, true)
    this.beam = new THREE.Mesh(beamGeo, this.beamMat)
    this.beam.scale.set(1, this.beamH, 1)
    this.beam.position.set(0, this.beamH / 2, zFace + 0.08)
    this.beam.visible = false
    this.beam.renderOrder = 6
    this.group.add(this.beam)

    /* ---------------- 地面符文：未解锁（红） / 已解锁（扩散） ---------------- */
    const ringGeo = new THREE.PlaneGeometry(1, 1)
    this.lockRingMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: 0xb02a1e,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.lockRing = new THREE.Mesh(ringGeo, this.lockRingMat)
    this.lockRing.rotation.x = -Math.PI / 2
    this.lockRing.scale.set(4.6, 4.6, 1)
    this.lockRing.position.set(0, 0.035, ourRingZ(halfSize))
    this.lockRing.renderOrder = 3
    this.group.add(this.lockRing)

    this.openRingMat = new THREE.MeshBasicMaterial({
      map: tex.rune,
      color: mix(theme.accentColor, 0xffffff, 0.15),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    this.openRing = new THREE.Mesh(ringGeo, this.openRingMat)
    this.openRing.rotation.x = -Math.PI / 2
    this.openRing.scale.set(4.6, 4.6, 1)
    this.openRing.position.copy(this.lockRing.position)
    this.openRing.renderOrder = 4
    this.group.add(this.openRing)

    /* ---------------- 上升粒子 ---------------- */
    const count = 44
    this.pPos = new Float32Array(count * 3)
    this.pSize.length = 0
    this.pSpeed.length = 0
    this.pPhase.length = 0
    this.pBase.length = 0
    for (let i = 0; i < count; i++) {
      this.pBase.push((this.next() - 0.5) * dw * 1.4)
      this.pBase.push((this.next() - 0.5) * 0.7)
      this.pBase.push(this.next() * this.doorH)
      this.pPhase.push(this.next() * Math.PI * 2)
      this.pSpeed.push(0.35 + this.next() * 0.85)
      this.pSize.push(0.1 + this.next() * 0.12)
    }
    this.pTop = Math.max(4.5, wallHeight * 2.2)
    const pGeo = new THREE.BufferGeometry()
    pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3))
    const pMat = new THREE.PointsMaterial({
      map: tex.mote,
      color: mix(theme.accentColor, 0xfff3c8, 0.5),
      size: 0.22,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    })
    this.particles = new THREE.Points(pGeo, pMat)
    this.particles.frustumCulled = false
    this.particles.renderOrder = 5
    this.group.add(this.particles)
    this.writeParticles(0)

    /* ---------------- 解锁后的点光 ---------------- */
    this.light = new THREE.PointLight(theme.accentColor, 0, 16, 2)
    this.light.position.set(0, Math.min(wallHeight * 0.75, this.doorH * 0.9), zFace + 1.4)
    this.light.visible = false
    this.group.add(this.light)

    // 初始锁定态
    this.applyLocked()
  }

  setUnlocked(v: boolean): void {
    if (this.unlocked === v) return
    this.unlocked = v
    if (!v) {
      this.openT = 0
      this.applyLocked()
      return
    }
    const theme = this.theme
    const tex = this.tex
    if (!this.doorMat || !theme || !tex) return
    // 换成"已点亮"门扉贴图，由 update 做亮度/位移渐变
    this.doorMat.map = tex.doorOpen
    this.doorMat.emissiveMap = tex.doorOpen
    this.doorMat.emissive.setHex(theme.accentColor)
    this.doorMat.color.setHex(0xffffff)
    this.doorMat.needsUpdate = true
    if (this.beam) this.beam.visible = true
    if (this.light) this.light.visible = true
    if (this.particles) (this.particles.material as THREE.PointsMaterial).opacity = 0.92
  }

  update(dt: number, _elapsed: number): void {
    this.time += dt
    const t = this.time
    const theme = this.theme
    if (!theme) return

    // ---- 未解锁：红色警示符文脉动 ----
    if (!this.unlocked) {
      if (this.lockRingMat) {
        this.lockRingMat.opacity = 0.32 + Math.sin(t * 2.6) * 0.14 + Math.sin(t * 7.3) * 0.05
      }
      if (this.lockRing) this.lockRing.rotation.z = t * 0.12
      if (this.doorMat) {
        this.doorMat.emissiveIntensity = 0.08 + Math.sin(t * 2.2) * 0.04
      }
      return
    }

    // ---- 解锁动画 ----
    this.openT = Math.min(1, this.openT + dt / 1.15)
    const k = 1 - Math.pow(1 - this.openT, 3)

    // 地面符文扩散
    if (this.lockRingMat) this.lockRingMat.opacity = 0.5 * (1 - k)
    if (this.lockRing) this.lockRing.scale.setScalar(4.6 + k * 3.2)
    if (this.openRingMat) {
      this.openRingMat.opacity = k * (0.42 + Math.sin(t * 2.4) * 0.08)
    }
    if (this.openRing) {
      this.openRing.scale.setScalar(4.6 + k * 7.5)
      this.openRing.rotation.z = -t * 0.35
    }

    // 门扉上抽 + 消散
    if (this.door) {
      this.door.position.y = this.doorBaseY + k * this.doorH * 0.92
      this.door.visible = k < 0.985
    }
    if (this.doorMat) {
      this.doorMat.opacity = 1 - k * 0.95
      this.doorMat.emissiveIntensity = 0.9 + k * 1.8 + Math.sin(t * 5.0) * 0.15
    }

    // 门后光面
    if (this.portalMat) this.portalMat.opacity = k * (0.5 + Math.sin(t * 1.7) * 0.08)
    if (this.portal) {
      const s = 0.72 + k * 0.3 + Math.sin(t * 2.2) * 0.02
      this.portal.scale.set(s, 1, 1)
    }

    // 光柱
    if (this.beamMat) {
      this.beamMat.opacity = Math.min(1, k * 1.05) * (0.36 + Math.sin(t * 1.9) * 0.05)
    }
    if (this.beam) {
      this.beam.scale.x = 1 + Math.sin(t * 1.4) * 0.05
      this.beam.rotation.y = t * 0.08
    }

    // 点光呼吸
    if (this.light) {
      this.light.intensity = k * (30 + Math.sin(t * 6.1) * 4 + Math.sin(t * 13.7) * 2)
    }

    // 粒子上升
    if (this.particles) {
      const mat = this.particles.material as THREE.PointsMaterial
      mat.opacity = 0.92 * Math.min(1, k * 1.2)
      this.writeParticles(dt, k)
    }
  }

  /** 更新上升粒子位置（解锁后持续循环） */
  private writeParticles(dt: number, k = 1): void {
    const pos = this.pPos
    if (!pos) return
    const count = pos.length / 3
    const swirlTop = this.doorH * 0.9
    for (let i = 0; i < count; i++) {
      const bx = this.pBase[i * 3]
      const bz = this.pBase[i * 3 + 1]
      let y = this.pBase[i * 3 + 2]
      if (dt > 0) {
        y += dt * this.pSpeed[i] * (0.4 + k * 0.9)
        if (y > this.pTop) {
          y = 0.04
          this.pBase[i * 3] = (this.next() - 0.5) * 3.2
          this.pBase[i * 3 + 1] = (this.next() - 0.5) * 0.6
        }
        this.pBase[i * 3 + 2] = y
      }
      const phase = this.pPhase[i]
      const t = this.time * 1.6 + phase
      const spread = 0.45 + (y / this.pTop) * 0.8
      pos[i * 3] = bx * spread + Math.sin(t) * 0.16
      pos[i * 3 + 1] = y
      pos[i * 3 + 2] = -this.half + 0.9 + bz + Math.cos(t * 0.8) * 0.14
      if (y > swirlTop) {
        pos[i * 3] *= 1 - (y - swirlTop) / (this.pTop - swirlTop + 0.001)
      }
    }
    const geo = this.particles?.geometry
    const attr = geo?.getAttribute('position') as THREE.BufferAttribute | undefined
    if (attr) attr.needsUpdate = true
  }

  private applyLocked(): void {
    if (this.doorMat && this.theme && this.tex) {
      this.doorMat.map = this.tex.doorLocked
      this.doorMat.emissiveMap = this.tex.doorLocked
      this.doorMat.emissive.setHex(0x8f1f14)
      this.doorMat.emissiveIntensity = 0.1
      this.doorMat.opacity = 1
      this.doorMat.needsUpdate = true
    }
    if (this.door) {
      this.door.position.y = this.doorBaseY
      this.door.visible = true
    }
    if (this.portalMat) this.portalMat.opacity = 0
    if (this.beam) this.beam.visible = false
    if (this.beamMat) this.beamMat.opacity = 0
    if (this.lockRingMat) this.lockRingMat.opacity = 0.45
    if (this.openRingMat) this.openRingMat.opacity = 0
    if (this.light) {
      this.light.intensity = 0
      this.light.visible = false
    }
    if (this.particles) (this.particles.material as THREE.PointsMaterial).opacity = 0
  }

  dispose(): void {
    disposeTree(this.group)
    this.door = null
    this.doorMat = null
    this.portal = null
    this.portalMat = null
    this.beam = null
    this.beamMat = null
    this.lockRing = null
    this.lockRingMat = null
    this.openRing = null
    this.openRingMat = null
    this.light = null
    this.particles = null
    this.pPos = null
    this.pBase.length = 0
    this.pSpeed.length = 0
    this.pPhase.length = 0
    this.pSize.length = 0
  }
}

/** 门前地面符文中心 z（与交互点 z 一致，位于门前踏台上方） */
function ourRingZ(halfSize: number): number {
  return -(halfSize - 2.9)
}

function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const ar = (a >> 16) & 0xff
  const ag = (a >> 8) & 0xff
  const ab = a & 0xff
  const br = (b >> 16) & 0xff
  const bg = (b >> 8) & 0xff
  const bb = b & 0xff
  return (((ar + (br - ar) * k) | 0) << 16) | (((ag + (bg - ag) * k) | 0) << 8) | ((ab + (bb - ab) * k) | 0)
}
