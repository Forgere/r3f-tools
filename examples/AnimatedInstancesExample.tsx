import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, AdaptiveEvents, Html, OrbitControls, Stats } from '@react-three/drei'
import { InstancedMeshPool, InstancedMeshPoolRef } from '../src/components/InstanceMeshPool'
import { useMemo, useRef, useState } from 'react'

type TrajectoryType = 'circle' | 'sine' | 'spiral' | 'figure8'

interface Instance {
  id: number
  trajectory: TrajectoryType
  phase: number
  speed: number
  radius: number
  color: THREE.Color
}

function AnimatedScene() {
  const meshPoolRef = useRef<InstancedMeshPoolRef>(null)
  const [instanceCount, setInstanceCount] = useState(1)
  const [isPaused, setIsPaused] = useState(false)
  const timeRef = useRef(0)
  const instancesRef = useRef<Instance[]>([])

  const geometry = useMemo(() => new THREE.BoxGeometry(0.5, 0.5, 0.5), [])
  const material = useMemo(() => new THREE.MeshStandardMaterial(), [])

  // 轨迹函数
  const getTrajectoryPosition = (instance: Instance, time: number): THREE.Vector3 => {
    const t = time * instance.speed + instance.phase
    const { trajectory, radius } = instance

    switch (trajectory) {
      case 'circle':
        return new THREE.Vector3(
          Math.cos(t) * radius,
          Math.sin(t) * radius,
          0
        )
      
      case 'sine':
        return new THREE.Vector3(
          (t % (Math.PI * 4)) - Math.PI * 2,
          Math.sin(t) * radius,
          Math.cos(t * 0.5) * radius * 0.5
        )
      
      case 'spiral':
        const spiralRadius = radius * (1 + t * 0.1)
        return new THREE.Vector3(
          Math.cos(t) * spiralRadius,
          Math.sin(t) * spiralRadius,
          t * 0.5
        )
      
      case 'figure8':
        return new THREE.Vector3(
          Math.sin(t) * radius,
          Math.sin(t * 2) * radius * 0.5,
          Math.cos(t) * radius * 0.3
        )
      
      default:
        return new THREE.Vector3(0, 0, 0)
    }
  }

  // 初始化实例
  const initializeInstances = (count: number) => {
    const trajectories: TrajectoryType[] = ['circle', 'sine', 'spiral', 'figure8']
    const instances: Instance[] = []

    for (let i = 0; i < count; i++) {
      instances.push({
        id: i,
        trajectory: trajectories[i % trajectories.length],
        phase: (i / count) * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.5,
        radius: 2 + Math.random() * 3,
        color: new THREE.Color().setHSL((i / count) * 0.8, 0.7, 0.6)
      })
    }

    instancesRef.current = instances
    meshPoolRef.current?.setInstanceCount(count)

    // 设置初始颜色
    instances.forEach((instance, index) => {
      meshPoolRef.current?.setColorAt(index, instance.color)
    })
    meshPoolRef.current?.updateColors()
  }

  // 动画循环
  useFrame((_, delta) => {
    if (isPaused) return

    timeRef.current += delta / 5
    const instances = instancesRef.current

    instances.forEach((instance, index) => {
      if (index >= instanceCount) return

      const position = getTrajectoryPosition(instance, timeRef.current)
      const matrix = new THREE.Matrix4()
      
      // 添加旋转
      const rotation = timeRef.current * instance.speed
      matrix.makeRotationY(rotation)
      matrix.setPosition(position)

      meshPoolRef.current?.setMatrixAt(index, matrix)

      // 动态改变颜色基于位置
      const normalizedY = (position.y + 5) / 10
      const hue = (instance.id / instanceCount) * 0.8
      const saturation = 0.7
      const lightness = 0.4 + normalizedY * 0.4
      
      instance.color.setHSL(hue, saturation, lightness)
      meshPoolRef.current?.setColorAt(index, instance.color)
    })

    meshPoolRef.current?.updateMatrices()
    meshPoolRef.current?.updateColors()
  })

  // 处理实例数量变化
  const handleInstanceCountChange = (newCount: number) => {
    const clampedCount = Math.max(1, Math.min(100000, newCount))
    setInstanceCount(clampedCount)
    
    if (clampedCount > instancesRef.current.length) {
      initializeInstances(clampedCount)
    } else {
      meshPoolRef.current?.setInstanceCount(clampedCount)
    }
  }

  // 处理点击事件 - 改变轨迹类型
  const handleInstanceClick = (_: any, index: number) => {
    if (index < instancesRef.current.length) {
      const trajectories: TrajectoryType[] = ['circle', 'sine', 'spiral', 'figure8']
      const instance = instancesRef.current[index]
      const currentIndex = trajectories.indexOf(instance.trajectory)
      instance.trajectory = trajectories[(currentIndex + 1) % trajectories.length]
      
      // 重置相位避免突跳
      instance.phase = timeRef.current * instance.speed
      console.log(`Instance ${index} changed to ${instance.trajectory} trajectory`)
    }
  }

  // 初始化
  if (instancesRef.current.length === 0) {
    initializeInstances(instanceCount)
  }

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <directionalLight position={[-10, -10, -5]} intensity={0.5} />

      <InstancedMeshPool
        ref={meshPoolRef}
        geometry={geometry}
        material={material}
        maxInstances={instanceCount}
        batchSize={10000}
        enableColors={true}
        // onClick={handleInstanceClick}
        // onPointerOver={handleInstanceClick}
      />

      <OrbitControls />

      <Html>
      {/* 控制面板 */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        color: 'white',
        fontFamily: 'monospace',
        fontSize: '14px',
        background: 'rgba(0,0,0,0.8)',
        padding: '15px',
        borderRadius: '8px',
        zIndex: 1000
      }}>
        <div style={{ marginBottom: '10px' }}>
          <strong>Animated Instances: {instanceCount}/10000</strong>
        </div>
        
        <div style={{ marginBottom: '10px' }}>
          <label>Count: </label>
          <input 
            type="range" 
            min="1" 
            max="100000" 
            value={instanceCount}
            onChange={(e) => handleInstanceCountChange(parseInt(e.target.value))}
            style={{ width: '150px' }}
          />
          <span> {instanceCount}</span>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <button 
            onClick={() => setIsPaused(!isPaused)}
            style={{ 
              padding: '5px 10px', 
              marginRight: '10px',
              background: isPaused ? '#4CAF50' : '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            {isPaused ? 'Play' : 'Pause'}
          </button>

          <button 
            onClick={() => {
              timeRef.current = 0
              initializeInstances(instanceCount)
            }}
            style={{ 
              padding: '5px 10px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reset
          </button>
        </div>

        <div style={{ fontSize: '12px', opacity: 0.8 }}>
          <div>• Circle (blue-ish): Circular motion</div>
          <div>• Sine (green-ish): Wave motion</div>
          <div>• Spiral (yellow-ish): Expanding spiral</div>
          <div>• Figure8 (red-ish): Figure-8 pattern</div>
          <div style={{ marginTop: '5px' }}>Click instances to change trajectory!</div>
        </div>
      </div>
      </Html>

    </>
  )
}

export function AnimatedInstancesExample() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <style>{`
        .stats-fps { position: fixed !important; top: 10px !important; left: 10px !important; }
        .stats-ms { position: fixed !important; top: 10px !important; left: 100px !important; }
        .stats-memory { position: fixed !important; top: 10px !important; left: 190px !important; }
      `}</style>
      <Canvas camera={{ position: [15, 10, 15], fov: 60 }}>
        <AdaptiveDpr pixelated />
        <AdaptiveEvents />
        <Stats showPanel={0} className="stats-fps" />
        <Stats showPanel={1} className="stats-ms" />
        <Stats showPanel={2} className="stats-memory" />
        <AnimatedScene />
      </Canvas>
    </div>
  )
}