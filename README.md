# R3F Tools

A collection of useful components and utilities for React Three Fiber applications, designed to improve performance and simplify common patterns.

## Features

- **InstancedMeshPool**: High-performance instanced mesh rendering with dynamic batching
- **GSAPAnimator**: GSAP-powered animation utility for Three.js Object3D instances
- TypeScript support
- Tree-shakeable exports
- Optimized for large-scale 3D scenes

## Installation

```bash
npm install r3f-tools
# or
yarn add r3f-tools
# or
pnpm add r3f-tools
```

## Usage

### InstancedMeshPool

A performance-oriented component for rendering large numbers of similar objects using Three.js InstancedMesh with automatic batching.

```tsx
import { InstancedMeshPool } from 'r3f-tools'
import * as THREE from 'three'

function Scene() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: 'orange' })
  
  // Create transformation matrices for your instances
  const matrices = useMemo(() => {
    const dummy = new THREE.Object3D()
    return Array.from({ length: 1000 }, (_, i) => {
      dummy.position.set(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100
      )
      dummy.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      )
      dummy.updateMatrix()
      return dummy.matrix.clone()
    })
  }, [])

  return (
    <InstancedMeshPool
      geometry={geometry}
      material={material}
      matrixs={matrices}
      batchSize={1000}
      onClick={(event, index) => console.log('Clicked instance:', index)}
    />
  )
}
```

#### Props

- `geometry: THREE.BufferGeometry` - The geometry to use for all instances
- `material: THREE.Material` - The material to use for all instances  
- `maxInstances?: number` - Maximum number of instances (default: 1000)
- `batchSize?: number` - Maximum instances per batch (default: 1000)
- `enableColors?: boolean` - Enable per-instance colors (default: false)
- `frustumCulled?: boolean` - Enable frustum culling (default: false)
- `onClick?: (event, index) => void` - Click handler
- `onPointerOver?: (event, index) => void` - Pointer over handler
- `onPointerOut?: (event, index) => void` - Pointer out handler

### GSAPAnimator

A powerful animation utility that provides GSAP-powered animations for Three.js Object3D instances with queue management and continuous animation support.

```tsx
import { createAnimator } from 'r3f-tools'
import { useRef, useEffect } from 'react'
import * as THREE from 'three'

function AnimatedCube() {
  const meshRef = useRef<THREE.Mesh>(null)
  
  useEffect(() => {
    if (!meshRef.current) return
    
    const animator = createAnimator(meshRef.current)
    
    // Basic animation
    animator.animate({
      position: { x: 5, y: 2, z: 0 },
      rotation: { y: Math.PI },
      duration: 2,
      ease: 'power2.inOut',
      onComplete: () => console.log('Animation completed!')
    })
    
    // Cleanup on unmount
    return () => animator.destroy()
  }, [])

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="orange" />
    </mesh>
  )
}
```

#### Animation Methods

**Basic Animation**
```tsx
// Single animation
await animator.animate({
  position: { x: 10, y: 5, z: 0 },
  rotation: { x: Math.PI / 2 },
  duration: 1.5,
  ease: 'bounce.out',
  delay: 0.5
})
```

**Sequence Animation**
```tsx
// Chain multiple animations
await animator.animateSequence([
  {
    position: { x: 5, y: 0, z: 0 },
    duration: 1,
    ease: 'power2.out'
  },
  {
    rotation: { y: Math.PI },
    duration: 0.5,
    ease: 'back.inOut'
  },
  {
    position: { x: 0, y: 5, z: 0 },
    rotation: { x: Math.PI / 4 },
    duration: 1.2,
    ease: 'elastic.out'
  }
])
```

**Continuous Animation (Data-Driven)**
```tsx
// Set up continuous animation with external data source
animator.startContinuousAnimation(async () => {
  // Fetch animation points from API or generate procedurally
  const response = await fetch('/api/animation-points')
  const data = await response.json()
  
  return data.map(point => ({
    x: point.x,
    y: point.y, 
    z: point.z,
    rotationY: point.angle,
    duration: point.speed || 1
  }))
}, 2000) // Fetch new points every 2 seconds

// Stop continuous animation
animator.stopContinuousAnimation()
```

#### Animation Control

```tsx
// Pause/resume animations
animator.pause()
animator.resume()

// Check if currently animating
const isPlaying = animator.isPlaying()

// Kill all animations
animator.kill()

// Complete cleanup
animator.destroy()

// Monitor animation queue
const queueSize = animator.getQueueSize()
const activeTweens = animator.getActiveTweensCount()
```

#### Imperative API (via ref)

```tsx
const meshPoolRef = useRef<InstancedMeshPoolRef>(null)

// Update single instance
meshPoolRef.current?.setMatrixAt(index, matrix)
meshPoolRef.current?.setColorAt(index, color)

// Batch updates
meshPoolRef.current?.setMatrices(matrices, startIndex)
meshPoolRef.current?.setColors(colors, startIndex)

// Update instance count
meshPoolRef.current?.setInstanceCount(count)

// Force updates
meshPoolRef.current?.updateMatrices()
meshPoolRef.current?.updateColors()
```

### Best Practices

#### Static Instances (Non-animated)

For static scenes where instances don't move after initial setup:

```tsx
function StaticScene() {
  const meshPoolRef = useRef<InstancedMeshPoolRef>(null)
  
  useEffect(() => {
    // Set up matrices once
    const matrices = generateStaticMatrices(1000)
    meshPoolRef.current?.setMatrices(matrices)
    meshPoolRef.current?.setInstanceCount(1000)
  }, [])

  return (
    <InstancedMeshPool
      ref={meshPoolRef}
      geometry={geometry}
      material={material}
      maxInstances={1000}
      batchSize={1000}
      frustumCulled={true}  // Enable for better performance
    />
  )
}
```

#### Dynamic Instances (Animated)

For animated scenes with frequent updates:

```tsx
function DynamicScene() {
  const meshPoolRef = useRef<InstancedMeshPoolRef>(null)
  
  useFrame(() => {
    // Update matrices every frame
    instances.forEach((instance, index) => {
      const matrix = calculateInstanceMatrix(instance)
      meshPoolRef.current?.setMatrixAt(index, matrix)
    })
    // Updates are automatically processed via useFrame in the component
  })

  return (
    <InstancedMeshPool
      ref={meshPoolRef}
      geometry={geometry}
      material={material}
      maxInstances={10000}
      batchSize={1000}
      enableColors={true}  // If you need per-instance colors
      frustumCulled={false}  // Disable for animated content
    />
  )
}
```

#### Non-Interactive (No Click Events)

For maximum performance when click events are not needed:

```tsx
<InstancedMeshPool
  geometry={geometry}
  material={material}
  maxInstances={100000}
  batchSize={10000}
  frustumCulled={true}
  // No event handlers = no bounding box calculations
/>
```

#### Interactive (With Click Events)

When click events are required, bounding boxes are automatically calculated:

```tsx
<InstancedMeshPool
  geometry={geometry}
  material={material}
  maxInstances={10000}
  batchSize={1000}
  onClick={(event, index) => {
    // Handle click - works even when animation is paused
    console.log('Clicked instance:', index)
  }}
  onPointerOver={(event, index) => {
    // Handle hover
  }}
/>
```

#### Performance Tips

1. **Batch Size**: Use larger batch sizes (5000-10000) for better performance with many instances
2. **Frustum Culling**: Enable for static content, disable for animated content that moves frequently
3. **Colors**: Only enable `enableColors` if you need per-instance colors
4. **Event Handlers**: Only add event handlers if interactivity is needed
5. **Matrix Updates**: For animated content, prefer `setMatrixAt` over recreating the entire matrix array

## Examples

See the `examples/` directory for complete usage examples.

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run linting
npm run lint

# Run type checking
npm run typecheck
```

## License

MIT © Forgere