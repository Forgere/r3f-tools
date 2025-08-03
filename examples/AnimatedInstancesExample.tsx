import * as THREE from 'three'
import { Canvas, useFrame } from '@react-three/fiber'
import { AdaptiveDpr, AdaptiveEvents, OrbitControls, Stats } from '@react-three/drei'
import { InstancedMeshPool, InstancedMeshPoolRef } from '../src/components/InstanceMeshPool'
import { useMemo, useRef, useEffect, useCallback } from 'react'
import { useControls, button } from 'leva'

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
  const timeRef = useRef(0)
  const instancesRef = useRef<Instance[]>([])

  // Leva controls
  const { instanceCount, isPaused, enableClicking } = useControls({
    instanceCount: { value: 1000, min: 1, max: 100000, step: 1 },
    isPaused: { value: false },
    enableClicking: { value: true },
    reset: button(() => {
      timeRef.current = 0
      initializeInstances(instanceCount)
    })
  })

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
  const initializeInstances = useCallback((count: number) => {
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
  }, [])

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
  })

  // 处理实例数量变化
  useEffect(() => {
    const clampedCount = Math.max(1, Math.min(100000, instanceCount))
    
    if (clampedCount > instancesRef.current.length) {
      initializeInstances(clampedCount)
    } else {
      meshPoolRef.current?.setInstanceCount(clampedCount)
    }
  }, [instanceCount, initializeInstances])

  // 处理点击事件 - 改变轨迹类型
  const handleInstanceClick = (_: any, index: number) => {
    if (!enableClicking || index >= instancesRef.current.length) return
    
    const trajectories: TrajectoryType[] = ['circle', 'sine', 'spiral', 'figure8']
    const instance = instancesRef.current[index]
    const currentIndex = trajectories.indexOf(instance.trajectory)
    instance.trajectory = trajectories[(currentIndex + 1) % trajectories.length]
    
    // 重置相位避免突跳
    instance.phase = timeRef.current * instance.speed
    console.log(`Instance ${index} changed to ${instance.trajectory} trajectory`)
    
    // 如果暂停状态，立即更新位置和矩阵
    if (isPaused) {
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
        onClick={enableClicking ? handleInstanceClick : undefined}
        onPointerOver={enableClicking ? handleInstanceClick : undefined}
      />

      <OrbitControls />
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