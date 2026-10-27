import * as THREE from 'three'
import { shadowTexture } from './sprites'

/**
 * 小怪脚下阴影合批：水平铺在 XZ 平面的 InstancedMesh，单 drawcall。
 *
 * 阴影是普通 alpha 混合（不是 additive），所以单独一套 shader；
 * 实例只带位置/尺寸/透明度，纹理共用 shadowTexture。
 */
const BASE_PLANE = new THREE.PlaneGeometry(1, 1)

export class ShadowBatch {
  readonly mesh: THREE.Mesh

  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly offsets: Float32Array
  private readonly scales: Float32Array
  private readonly alphas: Float32Array
  private readonly offsetAttr: THREE.InstancedBufferAttribute
  private readonly scaleAttr: THREE.InstancedBufferAttribute
  private readonly alphaAttr: THREE.InstancedBufferAttribute
  private readonly free: number[] = []
  private dirty = false

  constructor(parent: THREE.Object3D, capacity = 32) {
    const max = Math.max(1, Math.floor(capacity))
    this.geometry = new THREE.InstancedBufferGeometry()
    this.geometry.index = BASE_PLANE.index
    this.geometry.setAttribute('position', BASE_PLANE.getAttribute('position'))
    this.geometry.setAttribute('uv', BASE_PLANE.getAttribute('uv'))
    this.geometry.instanceCount = max

    this.offsets = new Float32Array(max * 3)
    this.scales = new Float32Array(max * 2)
    this.alphas = new Float32Array(max)
    for (let i = 0; i < max; i += 1) this.free.push(max - 1 - i)

    this.offsetAttr = this.makeAttr(this.offsets, 3)
    this.scaleAttr = this.makeAttr(this.scales, 2)
    this.alphaAttr = this.makeAttr(this.alphas, 1)
    this.geometry.setAttribute('aOffset', this.offsetAttr)
    this.geometry.setAttribute('aScale', this.scaleAttr)
    this.geometry.setAttribute('aAlpha', this.alphaAttr)

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: shadowTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          vUv = uv;
          vAlpha = aAlpha;
          vec3 p = vec3(position.x * aScale.x, 0.0, position.y * aScale.y) + aOffset;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vAlpha;

        void main() {
          float a = texture2D(uMap, vUv).a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
    parent.add(this.mesh)
  }

  get capacity(): number {
    return this.alphas.length
  }

  acquire(): number {
    return this.free.pop() ?? -1
  }

  release(index: number): void {
    if (index < 0 || index >= this.capacity) return
    this.alphas[index] = 0
    this.dirty = true
    if (!this.free.includes(index)) this.free.push(index)
  }

  set(index: number, x: number, z: number, scaleX: number, scaleZ: number, alpha: number): void {
    if (index < 0 || index >= this.capacity) return
    const o = index * 3
    this.offsets[o] = x
    this.offsets[o + 1] = 0.015
    this.offsets[o + 2] = z
    this.scales[index * 2] = scaleX
    this.scales[index * 2 + 1] = scaleZ
    this.alphas[index] = alpha
    this.dirty = true
  }

  flush(): void {
    if (!this.dirty) return
    this.offsetAttr.needsUpdate = true
    this.scaleAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.dirty = false
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }

  private makeAttr(array: Float32Array, itemSize: number): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(array, itemSize)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }
}
