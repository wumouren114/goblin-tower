import * as THREE from 'three'

/**
 * 贴地特效合批：水平铺在 XZ 平面的 InstancedMesh，单 drawcall。
 *
 * 每个实例带位置、X/Z 尺寸、Y 轴旋转、颜色与透明度；
 * 用于角色刀光/法阵/落点圈等地面贴片（普通 alpha 混合）。
 */
const BASE_PLANE = new THREE.PlaneGeometry(1, 1)

export class GroundBatch {
  readonly mesh: THREE.Mesh

  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly offsets: Float32Array
  private readonly scales: Float32Array
  private readonly colors: Float32Array
  private readonly alphas: Float32Array
  private readonly rotations: Float32Array
  private readonly offsetAttr: THREE.InstancedBufferAttribute
  private readonly scaleAttr: THREE.InstancedBufferAttribute
  private readonly colorAttr: THREE.InstancedBufferAttribute
  private readonly alphaAttr: THREE.InstancedBufferAttribute
  private readonly rotationAttr: THREE.InstancedBufferAttribute
  private readonly free: number[] = []
  private readonly tmpColor = new THREE.Color()
  private dirty = false

  constructor(parent: THREE.Object3D, texture: THREE.Texture, capacity: number, renderOrder = 5) {
    const max = Math.max(1, Math.floor(capacity))
    this.geometry = new THREE.InstancedBufferGeometry()
    this.geometry.index = BASE_PLANE.index
    this.geometry.setAttribute('position', BASE_PLANE.getAttribute('position'))
    this.geometry.setAttribute('uv', BASE_PLANE.getAttribute('uv'))
    this.geometry.instanceCount = max

    this.offsets = new Float32Array(max * 3)
    this.scales = new Float32Array(max * 2)
    this.colors = new Float32Array(max * 3)
    this.alphas = new Float32Array(max)
    this.rotations = new Float32Array(max)
    for (let i = 0; i < max; i += 1) this.free.push(max - 1 - i)

    this.offsetAttr = this.makeAttr(this.offsets, 3)
    this.scaleAttr = this.makeAttr(this.scales, 2)
    this.colorAttr = this.makeAttr(this.colors, 3)
    this.alphaAttr = this.makeAttr(this.alphas, 1)
    this.rotationAttr = this.makeAttr(this.rotations, 1)
    this.geometry.setAttribute('aOffset', this.offsetAttr)
    this.geometry.setAttribute('aScale', this.scaleAttr)
    this.geometry.setAttribute('aColor', this.colorAttr)
    this.geometry.setAttribute('aAlpha', this.alphaAttr)
    this.geometry.setAttribute('aRot', this.rotationAttr)

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute float aRot;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 p = vec3(position.x * aScale.x, 0.0, position.y * aScale.y);
          float c = cos(aRot);
          float s = sin(aRot);
          vec3 r = vec3(p.x * c + p.z * s, 0.0, -p.x * s + p.z * c);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(r + aOffset, 1.0);
          vUv = uv;
          vColor = aColor;
          vAlpha = aAlpha;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec4 tex = texture2D(uMap, vUv);
          float a = tex.a * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(tex.rgb * vColor, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = renderOrder
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

  set(
    index: number,
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleZ: number,
    rotationY: number,
    color: number,
    alpha: number,
  ): void {
    if (index < 0 || index >= this.capacity) return
    this.tmpColor.setHex(color)
    const o = index * 3
    this.offsets[o] = x
    this.offsets[o + 1] = y
    this.offsets[o + 2] = z
    this.scales[index * 2] = scaleX
    this.scales[index * 2 + 1] = scaleZ
    this.colors[o] = this.tmpColor.r
    this.colors[o + 1] = this.tmpColor.g
    this.colors[o + 2] = this.tmpColor.b
    this.alphas[index] = alpha
    this.rotations[index] = rotationY
    this.dirty = true
  }

  flush(): void {
    if (!this.dirty) return
    this.offsetAttr.needsUpdate = true
    this.scaleAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.rotationAttr.needsUpdate = true
    this.dirty = false
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }

  private makeAttr(array: Float32Array, size: number): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(array, size)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }
}
