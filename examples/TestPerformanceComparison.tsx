import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr, AdaptiveEvents, OrbitControls, Stats } from '@react-three/drei'
import { InstancedMeshPool } from '../src/components/InstanceMeshPool'
import { useMemo, useState, useEffect } from 'react'
import { MeshPool } from '../src/components/MeshPool'

type TestInstance = {
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
  color: THREE.Color
}

function TestScene({ onInstanceCountChange, isInstance = true }: { onInstanceCountChange: (count: number) => void }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial(), [])
  
  const [instances, setInstances] = useState<TestInstance[]>(() => {
    const initial: TestInstance[] = []
    for (let i = 0; i < 100; i++) {
      initial.push({
        position: [
          (Math.random() - 0.5) * 50,
          (Math.random() - 0.5) * 50,
          (Math.random() - 0.5) * 50
        ],
        rotation: [
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2
        ],
        scale: [
          0.2 + Math.random() * 0.8,
          0.2 + Math.random() * 0.8,
          0.2 + Math.random() * 0.8
        ],
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
      })
    }
    return initial
  })

  const [isIncreasing, setIsIncreasing] = useState(true)

  useEffect(() => {
    onInstanceCountChange(instances.length)
  }, [instances.length, onInstanceCountChange])

  useEffect(() => {
    const interval = setInterval(() => {
      setInstances(prev => {
        if (isIncreasing) {
          if (prev.length >= 100000) {
            setIsIncreasing(false)
            return prev.slice(0, -100) // Remove 100 instances
          } else {
            // Add 100 new instances
            const newInstances = []
            for (let i = 0; i < 10000; i++) {
              newInstances.push({
                position: [
                  (Math.random() - 0.5) * 50,
                  (Math.random() - 0.5) * 50,
                  (Math.random() - 0.5) * 50
                ],
                rotation: [
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2
                ],
                scale: [
                  0.2 + Math.random() * 0.8,
                  0.2 + Math.random() * 0.8,
                  0.2 + Math.random() * 0.8
                ],
                color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
              })
            }
            return [...prev, ...newInstances]
          }
        } else {
          if (prev.length <= 100) {
            setIsIncreasing(true)
            // Add 100 new instances
            const newInstances = []
            for (let i = 0; i < 10000; i++) {
              newInstances.push({
                position: [
                  (Math.random() - 0.5) * 50,
                  (Math.random() - 0.5) * 50,
                  (Math.random() - 0.5) * 50
                ],
                rotation: [
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2,
                  Math.random() * Math.PI * 2
                ],
                scale: [
                  0.2 + Math.random() * 0.8,
                  0.2 + Math.random() * 0.8,
                  0.2 + Math.random() * 0.8
                ],
                color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5)
              })
            }
            return [...prev, ...newInstances]
          } else {
            return prev.slice(0, -100) // Remove 100 instances from the end
          }
        }
      })
    }, 1000)
    
    return () => clearInterval(interval)
  }, [isIncreasing])

  const matrixs = useMemo(() => {
    const dummy = new THREE.Object3D()
    return instances.map(instance => {
      dummy.position.set(...instance.position)
      dummy.rotation.set(...instance.rotation)
      dummy.scale.set(...instance.scale)
      dummy.updateMatrix()
      return dummy.matrix.clone()
    })
  }, [instances])

  const colors = useMemo(() => {
    return instances.map(instance => instance.color)
  }, [instances])

  const handleClick = (_: any, index: number) => {
    console.log('Clicked instance:', index)
  }

  const handlePointerOver = (_: any, index: number) => {
    console.log('Hover over instance:', index)
  }

  const handlePointerOut = (_: any, index: number) => {
    console.log('Hover out instance:', index)
  }

  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} />

      {
        isInstance ? (
          <InstancedMeshPool
            geometry={geometry}
            material={material}
            matrixs={matrixs}
            colors={colors}
            onClick={handleClick}
            // onPointerOver={handlePointerOver}
            // onPointerOut={handlePointerOut}
            batchSize={10000}
          />
        ) : (
          <MeshPool
            geometry={geometry}
            material={material}
            matrixs={matrixs}
            colors={colors}
            onClick={handleClick}
            // onPointerOver={handlePointerOver}
            // onPointerOut={handlePointerOut}
          />
        )
      }

      <OrbitControls />
    </>
  )
}

export function TestInstancedMeshPool() {
  const [instanceCount, setInstanceCount] = useState(100)

  return (
    <>
      <div style={{ width: '100vw', height: '50vh', position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: 10, 
          left: 10, 
          color: 'white', 
          zIndex: 1000,
          fontSize: '18px',
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.7)',
          padding: '10px',
          borderRadius: '5px'
        }}>
          Instances: {instanceCount}
        </div>
        <Canvas camera={{ position: [0, 0, 60] } }>
          <AdaptiveDpr />
          <AdaptiveEvents />
          <Stats />
          <TestScene onInstanceCountChange={setInstanceCount} />
        </Canvas>
      </div>

      <div style={{ width: '100vw', height: '50vh', position: 'relative' }}>
        <div style={{ 
          position: 'absolute', 
          top: 10, 
          left: 10, 
          color: 'white', 
          zIndex: 1000,
          fontSize: '18px',
          fontFamily: 'monospace',
          background: 'rgba(0,0,0,0.7)',
          padding: '10px',
          borderRadius: '5px'
        }}>
          Instances: {instanceCount}
        </div>
        <Canvas camera={{ position: [0, 0, 60] } }>
          <AdaptiveDpr />
          <AdaptiveEvents />
          <Stats className='bottom' />
          <TestScene isInstance={false} onInstanceCountChange={setInstanceCount} />
        </Canvas>
      </div>
    </>

  )
}