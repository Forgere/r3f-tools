import * as THREE from 'three'
import { useRef, forwardRef, useImperativeHandle, useCallback } from 'react'
import { ThreeEvent } from '@react-three/fiber'

const FarDistance = 10000

export interface InstancedMeshPoolRef {
  setMatrixAt: (index: number, matrix: THREE.Matrix4) => void
  setColorAt: (index: number, color: THREE.Color) => void
  setMatrices: (matrices: THREE.Matrix4[], startIndex?: number) => void
  setColors: (colors: THREE.Color[], startIndex?: number) => void
  setInstanceCount: (count: number) => void
  updateMatrices: () => void
  updateColors: () => void
  computeBoundingBox: () => void
}

export type InstancedMeshPoolProps = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  batchSize?: number
  maxInstances?: number
  enableColors?: boolean
  onClick?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOver?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOut?: (e: ThreeEvent<THREE.Event>, index: number) => void
}

export const InstancedMeshPool = forwardRef<InstancedMeshPoolRef, InstancedMeshPoolProps>(function InstancedMeshPool({
  geometry,
  material,
  batchSize = 1000,
  maxInstances = 1000,
  enableColors = false,
  onClick,
  onPointerOver,
  onPointerOut,
}: InstancedMeshPoolProps, ref) {
  const meshGroups = useRef<THREE.InstancedMesh[]>([])
  const batchSizeRef = useRef(batchSize)
  const currentInstanceCount = useRef(0)
  
  // 内部缓存状态 - 跟踪需要更新的批次
  const dirtyMatrixBatches = useRef<Set<number>>(new Set())
  const dirtyColorBatches = useRef<Set<number>>(new Set())
  const needsBoundingBoxUpdate = useRef(false)

  useImperativeHandle(ref, () => ({
    setMatrixAt: (index: number, matrix: THREE.Matrix4) => {
      const groupIndex = Math.floor(index / batchSizeRef.current)
      const instanceIndex = index % batchSizeRef.current
      const mesh = meshGroups.current[groupIndex]
      if (mesh) {
        mesh.setMatrixAt(instanceIndex, matrix)
        dirtyMatrixBatches.current.add(groupIndex)
        needsBoundingBoxUpdate.current = true
      }
    },
    setColorAt: (index: number, color: THREE.Color) => {
      const groupIndex = Math.floor(index / batchSizeRef.current)
      const instanceIndex = index % batchSizeRef.current
      const mesh = meshGroups.current[groupIndex]
      if (mesh) {
        mesh.setColorAt(instanceIndex, color)
        dirtyColorBatches.current.add(groupIndex)
      }
    },
    setMatrices: (matrices: THREE.Matrix4[], startIndex = 0) => {
      const affectedBatches = new Set<number>()
      matrices.forEach((matrix, i) => {
        const index = startIndex + i
        const groupIndex = Math.floor(index / batchSizeRef.current)
        const instanceIndex = index % batchSizeRef.current
        const mesh = meshGroups.current[groupIndex]
        if (mesh) {
          mesh.setMatrixAt(instanceIndex, matrix)
          affectedBatches.add(groupIndex)
        }
      })
      // 批量添加受影响的批次
      affectedBatches.forEach(batchIndex => {
        dirtyMatrixBatches.current.add(batchIndex)
      })
      if (affectedBatches.size > 0) {
        needsBoundingBoxUpdate.current = true
      }
    },
    setColors: (colors: THREE.Color[], startIndex = 0) => {
      const affectedBatches = new Set<number>()
      colors.forEach((color, i) => {
        const index = startIndex + i
        const groupIndex = Math.floor(index / batchSizeRef.current)
        const instanceIndex = index % batchSizeRef.current
        const mesh = meshGroups.current[groupIndex]
        if (mesh) {
          mesh.setColorAt(instanceIndex, color)
          affectedBatches.add(groupIndex)
        }
      })
      // 批量添加受影响的批次
      affectedBatches.forEach(batchIndex => {
        dirtyColorBatches.current.add(batchIndex)
      })
    },
    setInstanceCount: (count: number) => {
      currentInstanceCount.current = count
      let offset = 0
      for (let g = 0; g < meshGroups.current.length; g++) {
        const group = meshGroups.current[g]
        if (group) {
          const groupCount = Math.min(count - offset, batchSizeRef.current)
          group.count = Math.max(0, groupCount)
          offset += batchSizeRef.current
        }
      }
    },
    updateMatrices: () => {
      // 只更新标记为dirty的批次
      dirtyMatrixBatches.current.forEach(batchIndex => {
        const mesh = meshGroups.current[batchIndex]
        if (mesh) {
          mesh.instanceMatrix.needsUpdate = true
        }
      })
      
      // 只在必要时更新边界框
      if (needsBoundingBoxUpdate.current) {
        dirtyMatrixBatches.current.forEach(batchIndex => {
          const mesh = meshGroups.current[batchIndex]
          if (mesh) {
            mesh.boundingBox = null
            mesh.boundingSphere = null
            mesh.computeBoundingBox()
            mesh.computeBoundingSphere()
          }
        })
        needsBoundingBoxUpdate.current = false
      }
      
      // 清空dirty标记
      dirtyMatrixBatches.current.clear()
    },
    updateColors: () => {
      // 只更新标记为dirty的批次
      dirtyColorBatches.current.forEach(batchIndex => {
        const mesh = meshGroups.current[batchIndex]
        if (mesh && mesh.instanceColor) {
          mesh.instanceColor.needsUpdate = true
        }
      })
      
      // 清空dirty标记
      dirtyColorBatches.current.clear()
    },
    computeBoundingBox: () => {
      meshGroups.current.forEach(mesh => {
        mesh.boundingBox = null
        mesh.boundingSphere = null
        mesh.computeBoundingBox()
        mesh.computeBoundingSphere()
      })
      needsBoundingBoxUpdate.current = false
    }
  }), [])

  // 更新 batchSizeRef
  batchSizeRef.current = batchSize

  const neededGroups = Math.ceil(maxInstances / batchSize)

  // 确保 meshGroups 数组有足够的 InstancedMesh 实例
  while (meshGroups.current.length < neededGroups) {
    const mesh = new THREE.InstancedMesh(geometry, material, batchSize)
    mesh.frustumCulled = false

    // 关键修复：禁用自动边界框计算，因为我们会手动更新
    mesh.boundingBox = null
    mesh.boundingSphere = null

    // 初始化所有实例的矩阵到远距离位置
    const tempMatrix = new THREE.Matrix4()
    for (let i = 0; i < batchSize; i++) {
      tempMatrix.makeTranslation(0, FarDistance + i, 0)
      mesh.setMatrixAt(i, tempMatrix)
    }
    mesh.instanceMatrix.needsUpdate = true

    if (enableColors) {
      const colorArray = new Float32Array(batchSize * 3)
      mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3)
    }

    mesh.count = 0
    meshGroups.current.push(mesh)
  }

  // 清理多余组
  while (meshGroups.current.length > neededGroups) {
    const toRemove = meshGroups.current.pop()
    toRemove?.parent?.remove(toRemove)
  }


  // 缓存事件处理函数避免重新创建
  const handleClick = useCallback((offset: number) => {
    return (e: ThreeEvent<THREE.Event>) => {
      if (e.instanceId !== undefined && onClick) {
        const index = offset + e.instanceId
        onClick(e, index)
      }
    }
  }, [onClick])

  const handlePointerOver = useCallback((offset: number) => {
    return (e: ThreeEvent<THREE.Event>) => {
      if (e.instanceId !== undefined && onPointerOver) {
        const index = offset + e.instanceId
        onPointerOver(e, index)
      }
    }
  }, [onPointerOver])

  const handlePointerOut = useCallback((offset: number) => {
    return (e: ThreeEvent<THREE.Event>) => {
      if (e.instanceId !== undefined && onPointerOut) {
        const index = offset + e.instanceId
        onPointerOut(e, index)
      }
    }
  }, [onPointerOut])

  return (
    <>
      {meshGroups.current.map((mesh, groupIndex) => {
        const offset = groupIndex * batchSize
        return (
          <primitive 
            key={groupIndex}
            /* eslint-disable react/no-unknown-property */
            object={mesh}
            onClick={handleClick(offset)}
            onPointerOver={handlePointerOver(offset)}
            onPointerOut={handlePointerOut(offset)}
          />
        )
      })}
    </>
  )
})
