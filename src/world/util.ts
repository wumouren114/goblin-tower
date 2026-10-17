import * as THREE from 'three'

/**
 * 递归释放 Object3D 树：几何体 / 材质（含 InstancedMesh 实例缓冲）。
 * 共享的 Sprite 内部几何体不释放（由 three 全局持有）。
 */
export function disposeTree(root: THREE.Object3D): void {
  const seenGeo = new Set<THREE.BufferGeometry>()
  const seenMat = new Set<THREE.Material>()

  root.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) {
      const geo = (o as THREE.Mesh).geometry
      if (geo && !seenGeo.has(geo)) {
        seenGeo.add(geo)
        geo.dispose()
      }
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[]
      const list = Array.isArray(mat) ? mat : [mat]
      for (const mm of list) {
        if (mm && !seenMat.has(mm)) {
          seenMat.add(mm)
          mm.dispose()
        }
      }
      // InstancedMesh 额外的实例属性缓冲
      if (o instanceof THREE.InstancedMesh) {
        o.dispose()
      }
    } else if (o instanceof THREE.Sprite) {
      const mat = o.material
      if (mat && !seenMat.has(mat)) {
        seenMat.add(mat)
        mat.dispose()
      }
    } else if (o instanceof THREE.Light) {
      o.dispose()
    }
  })

  // 清空子节点（保留 root 本身，方便复用）
  for (let i = root.children.length - 1; i >= 0; i--) {
    root.remove(root.children[i])
  }
}
