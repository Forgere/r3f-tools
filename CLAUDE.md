# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build the library (TypeScript compilation + Vite bundling)
npm run build

# Development mode with watch
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Testing
npm run test

# Run examples locally
npm run example

# Build examples
npm run example:build
```

## Project Architecture

This is a React Three Fiber (R3F) performance utilities library built in TypeScript. The project exports two main components for optimizing 3D mesh rendering:

### Core Components

**InstancedMeshPool** (`src/components/InstanceMeshPool.tsx`):
- High-performance instanced mesh rendering using THREE.InstancedMesh
- Supports batching with configurable batch sizes (default: 1000)
- Provides imperative API through ref for dynamic matrix/color updates
- Handles click events with instance-level granularity
- Uses far-distance positioning for unused instances to optimize culling

**MeshPool** (`src/components/MeshPool.tsx`):
- Alternative to InstancedMeshPool using individual meshes with BVH optimization
- Uses @react-three/drei's Bvh wrapper for efficient raycasting
- Matrix updates handled via useFrame hook
- Better for scenarios requiring per-instance materials

### Key Technical Details

- **Bundle Configuration**: Vite-based build with ESM/CJS dual output
- **External Dependencies**: React, React-DOM, Three.js, and R3F are peer dependencies
- **TypeScript**: Strict typing with separate build config (`tsconfig.build.json`)
- **Performance Focus**: Both components optimize for large-scale 3D scenes
- **Event Handling**: Custom event handling that preserves instance indices

### Development Notes

- The `hooks/` and `utils/` directories are currently empty
- Examples are located in `examples/` with separate Vite config
- Library uses forwardRef pattern for imperative APIs
- InstancedMeshPool uses manual bounding box management for accurate raycasting
- Material cloning in MeshPool ensures per-instance material independence

## Testing

Jest is configured for testing. Run tests with `npm run test`.

## Library Structure

- Main entry point: `src/index.ts` (exports both components and their types)
- Component exports follow named export pattern
- TypeScript types are co-located with implementations
- Vite handles bundling with external dependency exclusion