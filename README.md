# R3F Tools

A collection of useful components and utilities for React Three Fiber applications, designed to improve performance and simplify common patterns.

## Features

- **InstancedMeshPool**: High-performance instanced mesh rendering with dynamic batching
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