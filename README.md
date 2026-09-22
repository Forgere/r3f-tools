# R3F Tools

English | [简体中文](./README_zh.md)

A collection of useful components and utilities for React Three Fiber applications, designed to improve performance and simplify common patterns.

## Project Goal

The north star of `r3f-tools` is to grow from R3F performance components into
a **factory world-model toolkit** — one that can stand up a complex logistics
factory in the browser and make that world useful beyond visualization:

- **Effective simulation** — material flow, queueing, backpressure, capacity,
  inspection and routing are modelled by a renderer-independent kernel
  (`src/sim/`), not by ad-hoc per-component animation.
- **AI training data** — every spawn, transfer, inspection and blockage is a
  structured event on an immutable log, and frame deltas are plain
  serializable data, so episodes can be recorded, replayed and exported as
  training / evaluation data.
- **AI-replicable, AI-modifiable production lines** — the whole factory is
  declarative data (device definitions + parameters), so an agent can read a
  layout, propose a modification, validate it against constraints, and drop
  it back into the running world.
- **Adaptation to varying, constrained conditions** — three data modes
  (`sim` / `external` / `hybrid`) and four external signal contracts
  (`pose` / `progress` / `entry` / `span`) keep the world coherent when only
  some devices have real data or when feeds differ in fidelity.
- **Clear boundaries** — rendering, simulation, device behaviour and segment
  geometry are separate layers with explicit contracts (`FrameDelta`, plugin
  registries); a faulting plugin degrades one device, never the scene.
- **Plugin-based** — device renderers, segment geometry and device control
  behaviour are swappable plugins, so a vendor machine model or a custom PLC
  rule drops in at runtime without touching the core.

Shipped toward this goal:

- **Factory as data** — `FactoryLayout` + `validateFactoryLayout` +
  `createSimFromLayout` (`src/sim/layout.ts`): a whole factory is JSON,
  validated with structured issues, and built into a running sim with one
  call. The VividFactory example itself boots through this path.
- **Deterministic, recordable episodes** — seeded RNG +
  `reset(seed?)` + `exportEpisode()`: same defs + same seed replays an
  episode bit-for-bit, and the exported event log is plain JSON with
  queryable structured payloads.
- **Layer decision, plus the bridge** — `src/sim/` is the single runtime
  kernel; `src/core/` (TrackGraph & friends) is the design-time/geometry
  layer serving TrackRenderer; and `compileTrackGraph` (`src/core/compileTrackGraph.ts`)
  compiles a design-time graph into a runnable `FactoryLayout`.

Current focus: scale-out (Worker-based sim, render LOD) and richer device
models (failure rates, takt jitter, AGV/resource constraints).

## Features

- **FactorySim**: data-driven factory simulation kernel — pure TypeScript with zero three.js dependencies, structured event log, frame-delta rendering contract, and sim / external / hybrid data modes
- **Device & segment plugins**: hot-swappable device renderers, segment geometry generators, and device behaviour plugins with per-device fault isolation
- **ConveyorBelt & track system**: editable conveyors, track-graph routing, lift-and-transfer devices
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

### Factory layout as data

A whole factory is JSON: validate it, build a running sim from it, record
episodes you can replay bit-for-bit.

```ts
import {
  createSimFromLayout,
  validateFactoryLayout,
} from 'r3f-tools'

const layout = JSON.parse(layoutJson)

// Structured issues for tooling/AI self-correction — never throws.
const issues = validateFactoryLayout(layout)
// A reference to a device absent from the layout is a *warning*, not an
// error: that is how external-only devices (fed via ingestExternalFrame)
// are declared.

const sim = createSimFromLayout(layout, { seed: 42 })
// … tick per frame: const delta = sim.tick(dt)

// Record + replay: same layout + same seed reproduces every event.
const episode = sim.exportEpisode() // { seed, duration, events, stats }
sim.reset(42) // rewind to t=0, keep control settings, replay exactly
```

### Design-time graph → runtime layout

Draw or edit the factory as a `TrackGraph` (poses, segment kinds, explicit
hand-offs between devices), then compile it into the same `FactoryLayout`
the sim runs:

```ts
import { compileTrackGraph, createSimFromLayout, TrackGraph } from 'r3f-tools'

const graph = new TrackGraph()
graph.addDevice({ id: 'infeed', kind: 'roller-conveyor', config: { speed: 2 } })
// …nodes with makePose(), edges with segment kinds, handoff nodes between devices…

const { layout, issues, layoutIssues } = compileTrackGraph(graph)
// issues: structured compile decisions (branching devices rejected,
// dead ends synthesize sinks, mid-path hand-offs warn)
const sim = createSimFromLayout(layout, { seed: 42 })
```

Edgeless devices (sources, sinks, junctions, inspectors, buffers) declare
themselves through `config.simKind` and read their remaining fields from
the device `config` bag — see `compileTrackGraph`'s module docs.

### Factory track graph and device plugins

`TrackGraph` separates physical ownership from geometry: a visual crossing
does not connect two devices. Define an explicit `handoff` node only where
material is permitted to move between them. `DeviceRuntime.transfer()` asks the
receiving device plugin whether it can accept that material.

```ts
const graph = new TrackGraph()
graph.addDevice({ id: "infeed", kind: "roller-conveyor" })
graph.addDevice({ id: "sorter", kind: "sorter" })

graph.addNode({
  id: "handoff",
  pose: makePose(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0)),
  handoff: { fromDeviceId: "infeed", toDeviceId: "sorter" },
})
```

Use `DevicePluginRegistry` for per-device operating behaviour and
`SegmentPluginRegistry` for custom segment geometry. Both registries isolate a
plugin error to the affected `deviceId`; the former falls back to built-in
stopped/faulted behaviour and the latter falls back to a straight segment.
Subscribe to `onPluginDegraded` to surface the fault in your UI.

For a transfer point that would otherwise leave an exposed crossing gap, use
the built-in `VerticalLift`. Its enclosed graph edge should use
`visible: false`: it remains in the material route while the lift, not an
exposed roller bed, renders the mechanical transfer.

`TrackRenderer` uses the editable conveyor visual model by default. Use
`showRollers={false}` to inspect only frames or `showPath` to reveal route
lines; `showPaths` remains supported as a deprecated alias.

```ts
const segmentPlugins = new SegmentPluginRegistry({
  onPluginDegraded: ({ deviceId, error }) => reportDeviceFault(deviceId, error),
})
segmentPlugins.register({
  kind: "vendor-roller-bed",
  generateGeometry: createVendorRollerBed,
})

// Pass segmentPlugins to <TrackRenderer graph={graph} ... />.
```

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