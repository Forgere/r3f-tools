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
- `matrixs: THREE.Matrix4[]` - Array of transformation matrices for each instance
- `colors?: THREE.Color[]` - Optional array of colors for each instance
- `batchSize?: number` - Maximum instances per batch (default: 1000)
- `onClick?: (event, index) => void` - Click handler
- `onPointerOver?: (event, index) => void` - Pointer over handler
- `onPointerOut?: (event, index) => void` - Pointer out handler

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