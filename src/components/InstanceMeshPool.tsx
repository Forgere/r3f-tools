import * as THREE from 'three'
import { useMemo } from 'react'
import { ThreeEvent } from '@react-three/fiber'
import { Instances, Instance } from '@react-three/drei'

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
  const instances = useMemo(() => {
    return matrixs.map((matrix, index) => ({
      matrix,
      color: colors?.[index],
      index,
    }))
  }, [matrixs, colors])

  const batches = useMemo(() => {
    const result = []
    for (let i = 0; i < instances.length; i += batchSize) {
      result.push(instances.slice(i, i + batchSize))
    }
    return result
  }, [instances, batchSize])

  return (
    <>
      {batches.map((batch, batchIndex) => (
        <Instances
          key={batchIndex}
          geometry={geometry}
          material={material}
          limit={batchSize}
        >
          {batch.map(({ matrix, color, index }) => (
            <Instance
              key={index}
              matrix={matrix}
              color={color}
              onClick={onClick ? (e: ThreeEvent<THREE.Event>) => {
                onClick(e, index)
              } : undefined}
              onPointerOver={onPointerOver ? (e: ThreeEvent<THREE.Event>) => {
                onPointerOver(e, index)
              } : undefined}
              onPointerOut={onPointerOut ? (e: ThreeEvent<THREE.Event>) => {
                onPointerOut(e, index)
              } : undefined}
            />
          ))}
        </Instances>
      ))}
    </>
  )
}
