import * as THREE from 'three'
import { useRef, useMemo } from 'react'
import { ThreeEvent, useFrame } from '@react-three/fiber'
import { Bvh, meshBounds } from '@react-three/drei'

export type MeshPoolProps = {
  geometry: THREE.BufferGeometry
  material: THREE.Material
  matrixs: THREE.Matrix4[]
  colors?: THREE.Color[]
  onClick?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOver?: (e: ThreeEvent<THREE.Event>, index: number) => void
  onPointerOut?: (e: ThreeEvent<THREE.Event>, index: number) => void
}

export function MeshPool({
  geometry,
  material,
  matrixs,
  colors,
  onClick,
  onPointerOver,
  onPointerOut,
}: MeshPoolProps) {
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])

  const meshes = useMemo(() => {
    return matrixs.map((matrix, index) => ({
      matrix,
      color: colors?.[index],
      index,
    }))
  }, [matrixs, colors])

  useFrame(() => {
    meshRefs.current.forEach((mesh, index) => {
      if (mesh && index < matrixs.length) {
        const matrix = matrixs[index]
        if (matrix) {
          mesh.matrix.copy(matrix)
          mesh.matrixAutoUpdate = false
          mesh.matrixWorldNeedsUpdate = true
        }
        
        if (colors && colors[index] && mesh.material) {
          const mat = mesh.material as THREE.MeshStandardMaterial
          if (mat.color) {
            mat.color.copy(colors[index] as THREE.Color)
          }
        }
      }
    })
  })

  return (
    <Bvh>
      {meshes.map(({ matrix, index }) => (
        <mesh
          key={index}
          ref={(ref) => {
            meshRefs.current[index] = ref
          }}
          geometry={geometry}
          material={material.clone()}
          matrix={matrix}
          matrixAutoUpdate={false}
          raycast={meshBounds}
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
    </Bvh>
  )
}