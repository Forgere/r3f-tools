import * as THREE from 'three'
import { useRef } from 'react'
import { ThreeEvent, useFrame } from '@react-three/fiber'

export type InstancedMeshPoolProps = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  batchSize?: number
  matrixs: THREE.Matrix4[]
  colors?: THREE.Color[]
  onClick?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOver?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOut?: (e: ThreeEvent<THREE.Event>, index: number) => void
}

export function InstancedMeshPool({
  geometry,
  material,
  batchSize = 1000,
  matrixs,
  colors,
  onClick,
  onPointerOver,
  onPointerOut,
}: InstancedMeshPoolProps) {
  const meshGroups = useRef<THREE.InstancedMesh[]>([])

  const neededGroups = Math.ceil(matrixs.length / batchSize)

  // 确保 meshGroups 数组有足够的 InstancedMesh 实例
  while (meshGroups.current.length < neededGroups) {
    const mesh = new THREE.InstancedMesh(geometry, material, batchSize)

    if (colors) {
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

  useFrame(() => {
    let offset = 0
    for (let g = 0; g < meshGroups.current.length; g++) {
      const group = meshGroups.current[g] as THREE.InstancedMesh
      const count = Math.min(matrixs.length - offset, batchSize)

      for (let i = 0; i < count; i++) {
        const matrix = matrixs[offset + i] as THREE.Matrix4
        group.setMatrixAt(i, matrix)

        if (colors) {
          const color = colors[offset + i]
          group.setColorAt(i, color as THREE.Color)
        }
      }

      group.count = count
      group.instanceMatrix.needsUpdate = true
      if (colors) group.instanceColor!.needsUpdate = true

      offset += count
    }
  })

  return (
    <>
      {meshGroups.current.map((mesh, groupIndex) => {
        const offset = groupIndex * batchSize
        return (
          <primitive 
            key={groupIndex}
            /* eslint-disable react/no-unknown-property */
            object={mesh}
            onClick={(e: ThreeEvent<THREE.Event>) => {
              const index = offset + e.instanceId!
              if (onClick) onClick(e, index)
            }}
            onPointerOver={(e: ThreeEvent<THREE.Event>) => {
              const index = offset + e.instanceId!
              if (onPointerOver) onPointerOver(e, index)
            }}
            onPointerOut={(e: ThreeEvent<THREE.Event>) => {
              const index = offset + e.instanceId!
              if (onPointerOut) onPointerOut(e, index)
            }}
          />
        )
      })}
    </>
  )
}
