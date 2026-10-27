import * as THREE from 'three'

/**
 * 单 drawcall 的 billboard 批：所有实例共用一张贴图，
 * 每个实例独立位置/尺寸/颜色/透明度/UV 区域/旋转。
 *
 * 用途：VFX 粒子、火把火焰、场景光晕、掉落物图标。
 * 相比「每个 Sprite 一个材质」可以把几十个 drawcall 压成 1 个。
 */
export interface BillboardBatchOptions {
  renderOrder?: number
  depthTest?: boolean
  blending?: THREE.Blending
}

const BASE_PLANE = new THREE.PlaneGeometry(1, 1)

export class BillboardBatch {
  readonly mesh: THREE.Mesh

  private readonly parent: THREE.Object3D
  private readonly geometry: THREE.InstancedBufferGeometry
  private readonly material: THREE.ShaderMaterial
  private readonly offsets: Float32Array
  private readonly scales: Float32Array
  private readonly colors: Float32Array
  private readonly alphas: Float32Array
  private readonly uvs: Float32Array
  private readonly rotations: Float32Array
  private readonly offsetAttr: THREE.InstancedBufferAttribute
  private readonly scaleAttr: THREE.InstancedBufferAttribute
  private readonly colorAttr: THREE.InstancedBufferAttribute
  private readonly alphaAttr: THREE.InstancedBufferAttribute
  private readonly uvAttr: THREE.InstancedBufferAttribute
  private readonly rotationAttr: THREE.InstancedBufferAttribute
  private readonly free: number[] = []
  private readonly tmpColor = new THREE.Color()
  private dirty = false

  constructor(parent: THREE.Object3D, texture: THREE.Texture, capacity: number, opts: BillboardBatchOptions = {}) {
    this.parent = parent
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
    this.uvs = new Float32Array(max * 4)
    this.rotations = new Float32Array(max)
    for (let i = 0; i < max; i += 1) {
      this.uvs[i * 4 + 2] = 1
      this.uvs[i * 4 + 3] = 1
      this.free.push(max - 1 - i)
    }

    this.offsetAttr = this.makeAttr(this.offsets, 3)
    this.scaleAttr = this.makeAttr(this.scales, 2)
    this.colorAttr = this.makeAttr(this.colors, 3)
    this.alphaAttr = this.makeAttr(this.alphas, 1)
    this.uvAttr = this.makeAttr(this.uvs, 4)
    this.rotationAttr = this.makeAttr(this.rotations, 1)
    this.geometry.setAttribute('aOffset', this.offsetAttr)
    this.geometry.setAttribute('aScale', this.scaleAttr)
    this.geometry.setAttribute('aColor', this.colorAttr)
    this.geometry.setAttribute('aAlpha', this.alphaAttr)
    this.geometry.setAttribute('aUv', this.uvAttr)
    this.geometry.setAttribute('aRot', this.rotationAttr)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute vec2 aScale;
        attribute vec3 aColor;
        attribute float aAlpha;
        attribute vec4 aUv;
        attribute float aRot;
        varying vec2 vUv;
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec2 p = position.xy;
          float c = cos(aRot);
          float s = sin(aRot);
          p = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
          vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
          mv.xy += p * aScale;
          gl_Position = projectionMatrix * mv;
          vUv = aUv.xy + uv * aUv.zw;
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
          if (a < 0.01) discard;
          gl_FragColor = vec4(vColor * tex.rgb, a);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: opts.depthTest ?? true,
      blending: opts.blending ?? THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = opts.renderOrder ?? 4
    parent.add(this.mesh)
  }

  get capacity(): number {
    return this.alphas.length
  }

  /** 取一个空闲实例位；满员返回 -1 */
  acquire(): number {
    return this.free.pop() ?? -1
  }

  /** 归还实例位（透明度归零） */
  release(index: number): void {
    this.setAlpha(index, 0)
    if (index >= 0 && index < this.capacity && !this.free.includes(index)) this.free.push(index)
  }

  setTexture(texture: THREE.Texture): void {
    this.material.uniforms.uMap.value = texture
  }

  set(
    index: number,
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    color: number,
    alpha: number,
    u0 = 0,
    v0 = 0,
    uScale = 1,
    vScale = 1,
    rotation = 0,
  ): void {
    if (index < 0 || index >= this.capacity) return
    this.tmpColor.setHex(color)
    const o = index * 3
    this.offsets[o] = x
    this.offsets[o + 1] = y
    this.offsets[o + 2] = z
    this.scales[index * 2] = scaleX
    this.scales[index * 2 + 1] = scaleY
    this.colors[o] = this.tmpColor.r
    this.colors[o + 1] = this.tmpColor.g
    this.colors[o + 2] = this.tmpColor.b
    this.alphas[index] = alpha
    const u = index * 4
    this.uvs[u] = u0
    this.uvs[u + 1] = v0
    this.uvs[u + 2] = uScale
    this.uvs[u + 3] = vScale
    this.rotations[index] = rotation
    this.dirty = true
  }

  setAlpha(index: number, alpha: number): void {
    if (index < 0 || index >= this.capacity) return
    this.alphas[index] = alpha
    this.dirty = true
  }

  /** 每帧末统一上传；没有变化时不产生 GPU 上传 */
  flush(): void {
    if (!this.dirty) return
    this.offsetAttr.needsUpdate = true
    this.scaleAttr.needsUpdate = true
    this.colorAttr.needsUpdate = true
    this.alphaAttr.needsUpdate = true
    this.uvAttr.needsUpdate = true
    this.rotationAttr.needsUpdate = true
    this.dirty = false
  }

  dispose(): void {
    this.parent.remove(this.mesh)
    this.geometry.dispose()
    this.material.dispose()
  }

  private makeAttr(array: Float32Array, itemSize: number): THREE.InstancedBufferAttribute {
    const attr = new THREE.InstancedBufferAttribute(array, itemSize)
    attr.setUsage(THREE.DynamicDrawUsage)
    return attr
  }
}
