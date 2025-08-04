import { useRef, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { createAnimator, type AnimationPoint } from '../src/utils/gsapAnimator'
import type { Mesh } from 'three'

// Mock API to fetch new animation points
const mockFetchAnimationPoints = async (): Promise<AnimationPoint[]> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 100))
  
  // Generate random points in a reasonable range
  const points: AnimationPoint[] = []
  const numPoints = Math.floor(Math.random() * 3) + 1 // 1-3 points each time
  
  for (let i = 0; i < numPoints; i++) {
    points.push({
      x: (Math.random() - 0.5) * 10, // -5 to 5
      y: (Math.random() - 0.5) * 6,  // -3 to 3
      z: (Math.random() - 0.5) * 10, // -5 to 5
      rotationX: Math.random() * Math.PI * 2,
      rotationY: Math.random() * Math.PI * 2,
      rotationZ: Math.random() * Math.PI * 2,
      duration: Math.random() * 2 + 0.5 // 0.5 to 2.5 seconds
    })
  }
  
  return points
}

function ContinuousAnimatedCube() {
  const meshRef = useRef<Mesh>(null!)
  const animatorRef = useRef<ReturnType<typeof createAnimator> | null>(null)

  useEffect(() => {
    if (meshRef.current) {
      animatorRef.current = createAnimator(meshRef.current)
      
      // Start continuous animation with mock API
      animatorRef.current.startContinuousAnimation(
        mockFetchAnimationPoints,
        1500 // Fetch new points every 1.5 seconds
      )
    }

    return () => {
      if (animatorRef.current) {
        // Proper cleanup to prevent memory leaks
        animatorRef.current.destroy()
      }
    }
  }, [])

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  )
}

function PreDefinedSequenceSphere() {
  const meshRef = useRef<Mesh>(null)

  useEffect(() => {
    if (meshRef.current) {
      const animator = createAnimator(meshRef.current)
      
      const runSequenceAnimation = async () => {
        // Predefined sequence with continuous motion
        await animator.animateSequence([
          {
            position: { x: 5, y: 2, z: 0 },
            rotation: { y: Math.PI / 4 },
            duration: 1.5,
            ease: 'power2.inOut'
          },
          {
            position: { x: 3, y: -1, z: 4 },
            rotation: { x: Math.PI / 2, y: Math.PI / 2 },
            duration: 2,
            ease: 'power2.inOut'
          },
          {
            position: { x: -2, y: 1, z: 2 },
            rotation: { x: Math.PI, y: Math.PI },
            duration: 1.8,
            ease: 'power2.inOut'
          },
          {
            position: { x: -4, y: -2, z: -3 },
            rotation: { x: Math.PI * 1.5, y: Math.PI * 1.5 },
            duration: 2.2,
            ease: 'power2.inOut'
          },
          {
            position: { x: 0, y: 0, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            duration: 2,
            ease: 'power2.inOut'
          }
        ])
        
        // Check if still valid before restarting
        animator.destroy()
      }
      
      runSequenceAnimation()
      
      return () => {
        // Proper cleanup
        animator.destroy()
      }
    }
  }, [])

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <sphereGeometry args={[0.5, 32, 32]} />
      <meshStandardMaterial color="cyan" />
    </mesh>
  )
}

function ManualControlTorus() {
  const meshRef = useRef<Mesh>(null!)
  const animatorRef = useRef<ReturnType<typeof createAnimator> | null>(null)

  useEffect(() => {
    if (meshRef.current) {
      animatorRef.current = createAnimator(meshRef.current)
      
      // Add some initial points manually
      const initialPoints: AnimationPoint[] = [
        { x: -6, y: 0, z: 0, duration: 2 },
        { x: -6, y: 3, z: 3, rotationY: Math.PI, duration: 1.5 },
        { x: 6, y: 3, z: 3, rotationX: Math.PI, duration: 2.5 },
        { x: 6, y: -3, z: -3, rotationZ: Math.PI, duration: 1.8 },
        { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0, duration: 2 }
      ]
      
      animatorRef.current.addAnimationPoints(initialPoints)
      
      // Add more points periodically
      const interval = setInterval(() => {
        if (animatorRef.current) {
          const newPoint: AnimationPoint = {
            x: (Math.random() - 0.5) * 8,
            y: (Math.random() - 0.5) * 6,
            z: (Math.random() - 0.5) * 8,
            rotationY: Math.random() * Math.PI * 2,
            duration: Math.random() * 2 + 1
          }
          animatorRef.current.addAnimationPoint(newPoint)
        }
      }, 3000)
      
      return () => {
        clearInterval(interval)
        if (animatorRef.current) {
          // Proper cleanup
          animatorRef.current.destroy()
        }
      }
    }
  }, [])

  return (
    <mesh ref={meshRef} position={[0, 0, 0]}>
      <torusGeometry args={[0.6, 0.2, 16, 100]} />
      <meshStandardMaterial color="magenta" />
    </mesh>
  )
}

export default function GSAPAnimationExample() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Canvas camera={{ position: [12, 8, 12] }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        
        <ContinuousAnimatedCube />
        <PreDefinedSequenceSphere />
        <ManualControlTorus />
        
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
      </Canvas>
      
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        color: 'white',
        background: 'rgba(0,0,0,0.7)',
        padding: '15px',
        borderRadius: '8px',
        maxWidth: '350px'
      }}>
        <h3>GSAP Continuous Animation Example</h3>
        <div style={{ fontSize: '14px', lineHeight: '1.4' }}>
          <p><strong style={{ color: 'orange' }}>Orange Cube:</strong> Continuous animation with mock API (fetches new points every 1.5s)</p>
          <p><strong style={{ color: 'cyan' }}>Cyan Sphere:</strong> Predefined sequence with seamless looping</p>
          <p><strong style={{ color: 'magenta' }}>Magenta Torus:</strong> Manual point addition (new point every 3s)</p>
          <p style={{ marginTop: '10px', fontSize: '12px', opacity: 0.8 }}>
            All animations are continuous without stuttering between sequences
          </p>
          <div style={{ marginTop: '10px', fontSize: '11px', opacity: 0.7, borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '8px' }}>
            <p><strong>Memory Safety Features:</strong></p>
            <ul style={{ margin: '5px 0', paddingLeft: '15px' }}>
              <li>Proper GSAP tween and timeline cleanup with destroy()</li>
              <li>Destroyed animators reject new operations</li>
              <li>Timeline and interval cleanup on unmount</li>
              <li>Separate tracking for tweens and timelines</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}