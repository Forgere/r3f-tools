# R3F Tools - Project Context for AI

This document provides contextual information about the `r3f-tools` project for AI assistants like Qwen Code. It outlines the project's purpose, structure, and development conventions.

## Project Overview

`r3f-tools` is a TypeScript library designed to enhance performance and simplify common tasks in React Three Fiber (R3F) applications. Its main features include:

1.  **InstancedMeshPool**: A high-performance component for rendering large numbers of similar 3D objects using Three.js instancing with dynamic batching. It provides an imperative API for efficient updates and supports interactivity (click, hover events).
2.  **GSAPAnimator**: A utility for creating GSAP-powered animations for Three.js `Object3D` instances. It offers a queue system for sequential animations, a continuous animation mode for data-driven scenarios, and methods for precise control (pause, resume, kill).

The library is built with performance in mind, targeting large-scale 3D scenes, and supports tree-shaking for optimized bundle sizes.

## Building and Running

This is a library project managed with `npm` or `bun` scripts, primarily using `vite` for building and `TypeScript` for type checking. You can use either `npm` or `bun` to run these commands.

*   **Install Dependencies**: `npm install` or `bun install`
*   **Build Library**: `npm run build` or `bun run build` (Outputs to `dist/`)
*   **Development Build (Watch)**: `npm run dev` or `bun run dev`
*   **Lint Code**: `npm run lint` or `bun run lint`
*   **Format Code**: `npm run format` or `bun run format`
*   **Type Check**: `npm run typecheck` or `bun run typecheck`
*   **Run Tests**: `npm run test` or `bun run test` (Uses Jest)
*   **Run Examples**: `npm run example` or `bun run example` (Uses Vite dev server for the `examples/` directory)

## Development Conventions

*   **Language & Framework**: TypeScript, React, React Three Fiber, Three.js, GSAP.
*   **Build Tool**: Vite with `vite-plugin-dts` for type declaration generation.
*   **Module Format**: ES Modules and CommonJS outputs.
*   **Linter/Formatter**: Biome.
*   **Testing**: Jest.
*   **Entry Point**: `src/index.ts` exports all public APIs.
*   **Component Structure**: React components are located in `src/components/`.
*   **Utility Functions**: Helper functions, like the GSAP animator, are in `src/utils/`.
*   **Typing**: Strong typing is used throughout. Component props and utility function interfaces are exported.
*   **Performance**: The `InstancedMeshPool` uses batching and manual update control (`useFrame`) to optimize rendering of large instanced meshes. Animations are managed via GSAP timelines and tweens with proper cleanup.
*   **Imperative API**: Components like `InstancedMeshPool` expose `forwardRef` APIs for direct manipulation of underlying Three.js objects.

## Key Files and Directories

*   `README.md`: Main documentation for the library, including usage examples.
*   `package.json`: Defines dependencies, scripts, and library metadata.
*   `tsconfig.json`: Main TypeScript configuration.
*   `tsconfig.build.json`: TypeScript configuration specifically for the build process (declaration files).
*   `vite.config.mjs`: Vite build configuration for the library.
*   `src/index.ts`: Main entry point, exports public APIs.
*   `src/components/InstanceMeshPool.tsx`: Implementation of the `InstancedMeshPool` component.
*   `src/components/ConveyorBelt.tsx`: Implementation of the `ConveyorBelt` component (not detailed in this context but present).
*   `src/utils/gsapAnimator.ts`: Implementation of the `GSAPAnimator` utility class and `createAnimator` factory function.
*   `src/utils/moveAlongPath.ts`: Implementation of path animation utilities (not detailed in this context but present).
*   `examples/`: Directory containing example applications demonstrating library usage.