# R3F Tools

[English](./README.md) | 简体中文

面向 React Three Fiber 应用的组件与工具集，用于提升渲染性能并简化常见模式。

## 目录

- [项目目标](#项目目标)
- [下一步方向](#下一步方向)
- [特性](#特性)
- [安装](#安装)
- [用法](#用法)
  - [整厂即 JSON（FactoryLayout）](#整厂即-jsonfactorylayout)
  - [设计时图 → 运行时布局（compileTrackGraph）](#设计时图--运行时布局compiletrackgraph)
  - [TrackGraph 与设备插件](#trackgraph-与设备插件)
  - [InstancedMeshPool](#instancedmeshpool)
  - [GSAPAnimator](#gsapanimator)
  - [命令式 API（ref）](#命令式-apiref)
  - [最佳实践](#最佳实践)
  - [性能建议](#性能建议)
- [示例](#示例)
- [开发](#开发)
- [许可证](#许可证)

## 项目目标

`r3f-tools` 的北极星是从「R3F 性能组件集」长成一套**工厂世界模型工具箱**——能在浏览器里立起一座复杂的物流工厂，并让这个世界的价值不止于可视化：

- **有效的仿真** — 物料流、排队、背压、产能、质检与路由全部由与渲染器无关的内核（`src/sim/`）建模，而不是散落在各组件里的临时动画。
- **AI 训练数据** — 每一次生成、转移、检验、堵塞都是不可变日志上的结构化事件；帧差量（`FrameDelta`）是纯可序列化数据，因此 episode 可以录制、重放并导出为训练 / 评测数据。
- **AI 可复现、可改写的产线** — 整厂是声明式数据（设备定义 + 参数），Agent 能读出一份布局、提出修改、按约束校验、再塞回正在运行的世界。
- **适应多变且受限的现场条件** — 三种数据模式（`sim` / `external` / `hybrid`）与四种外部信号契约（`pose` / `progress` / `entry` / `span`），在只有部分设备有数据、或各路数据保真度不一致时，世界依然自洽。
- **边界清晰** — 渲染、仿真、设备行为、段几何是彼此独立的层，契约显式（`FrameDelta`、插件注册表）；一个插件出错只降级一台设备，不会连坐整个场景。
- **插件化** — 设备渲染器、段几何生成器、设备控制行为都是可热替换的插件，厂商机型或自定义 PLC 规则可以在运行时接入，无需改动内核。

朝该目标已交付：

- **整厂即数据** — `FactoryLayout` + `validateFactoryLayout` + `createSimFromLayout`（`src/sim/layout.ts`）：整厂就是一段 JSON，带结构化问题的校验器，一次调用即可建出可运行的 sim。VividFactory 示例本身就走这条路径启动。
- **确定性、可录制的 episode** — 带种子的 RNG + `reset(seed?)` + `exportEpisode()`：同样的 defs + 同样的 seed 逐位重放同一段 episode，导出的事件日志是可查询的纯 JSON。
- **分层决策与桥** — `src/sim/` 是唯一的运行时内核；`src/core/`（TrackGraph 等）是服务于 TrackRenderer 的设计时 / 几何层；`compileTrackGraph`（`src/core/compileTrackGraph.ts`）把设计时图编译成可运行的 `FactoryLayout`。

当前重心：规模化（Worker 仿真、渲染 LOD）与更丰富的设备模型（故障率、节拍抖动、AGV / 资源约束）——详见下一节。

## 下一步方向

方向已在 `factory-conveyor-plan.md` §16（含 §9.5 规模化路径）与英文 README 的 “Current focus” 记录，这里展开为可执行清单。

### 1. Worker 化与渲染 LOD 的规模验证

- **仿真进 Worker**：`src/sim/` 零 DOM、零 three 依赖，`FrameDelta` 全是纯数组与数字（结构化克隆友好），可在 Worker 内 tick，主线程只消费 delta。必要时再评估 SharedArrayBuffer / 双缓冲。
- **规模基准，而不是"应该更快"**：阶梯实测（物料 1k / 5k / 10k，设备 100 / 500 / 1k），记录 sim tick 耗时、delta 体积、postMessage 往返开销、渲染端帧时间，标出拐点。
- **渲染 LOD**：按相机距离对 `delta.moved` 降频（远区隔帧更新），远处物料退化为精灵 / 点，`InstancedMeshPool` 的 `batchSize` 与 `frustumCulled` 按距离档位切换。
- **验收门槛**：主线程每帧与 sim 相关的开销进入 60fps 预算（目标 < 2ms）；10k 物料下渲染端仍稳定；"delta 为空则零 GPU 写入"（停机时不碰 buffer）这条性质不得回退。

### 2. 更丰富的设备模型

- **故障率**：设备级 MTBF / MTTR（或 per-tick 故障概率 + 维修时长）。故障期设备停摆，在其上下游产生真实的堵塞与缓冲积压，而不是简单地把速度置零。配套新增故障 / 修复类事件与结构化 payload（原因码、停机时长）。
- **节拍抖动（takt jitter）**：`SourceDef.interval`、设备处理时长由定值改为分布（均匀 / 正态 / 对数正态，钳制非负），用抖动暴露定值节拍掩盖掉的排队与瓶颈行为。
- **AGV / 资源约束**：有限资源池（AGV、叉车、人工工位、共享夹具），任务申请 / 占用 / 释放语义，路径占用与死锁避免，充电或换班造成的资源不可用窗口。
- **与确定性内核对齐（硬性约束）**：所有随机性必须走已注入的 mulberry32 PRNG，不得引入 `Math.random()`，保证 `reset(seed)` 仍能逐位重放；新参数一律进 `FactoryLayout` schema 并由 `validateFactoryLayout` 校验（区间 / 非负 / 枚举），维持「整厂即 JSON + 可复现 episode」这条主线。
- **可观测性同步跟上**：新行为要进 `SimEpisode` / `SimStats`（停机时长、资源利用率等），让训练数据可以直接查询，而不必从 `detail` 文本里反解。

### 3. 保持的边界

新设备行为进 sim 内核 + layout schema；`src/core/` 维持设计时 / 几何层定位，不再往 `DeviceRuntime` 上加运行时控制逻辑（见 plan §16.3）。

## 特性

- **FactorySim**：数据驱动的工厂仿真内核 — 纯 TypeScript、零 three.js 依赖、结构化事件日志、帧差量渲染契约，支持 sim / external / hybrid 三种数据模式
- **设备与段插件**：可热替换的设备渲染器、段几何生成器、设备行为插件，且插件故障按设备隔离
- **ConveyorBelt 与轨道系统**：可编辑输送线、轨道图路由、顶升移栽设备
- **InstancedMeshPool**：高性能实例化网格渲染，带动态批处理
- **GSAPAnimator**：基于 GSAP 的 Three.js Object3D 动画工具
- TypeScript 支持
- 可 tree-shaking 的导出
- 面向大规模 3D 场景优化

## 安装

```bash
npm install r3f-tools
# 或
yarn add r3f-tools
# 或
pnpm add r3f-tools
```

## 用法

### 整厂即 JSON（FactoryLayout）

整厂就是一段 JSON：校验它，从它建出可运行的 sim，录制可逐位重放的 episode。

```ts
import {
  createSimFromLayout,
  validateFactoryLayout,
} from 'r3f-tools'

const layout = JSON.parse(layoutJson)

// 供工具 / AI 自愈用的结构化问题列表 —— 永不抛异常。
const issues = validateFactoryLayout(layout)
// 引用一个不在 layout 里的设备是 *warning* 而非 error：
// 那正是 external-only 设备（由 ingestExternalFrame 喂数）的声明方式。

const sim = createSimFromLayout(layout, { seed: 42 })
// …每帧推进：const delta = sim.tick(dt)

// 录制 + 重放：同样的 layout + 同样的 seed 复现每一个事件。
const episode = sim.exportEpisode() // { seed, duration, events, stats }
sim.reset(42) // 回到 t=0，保留控制设置，精确重放
```

### 设计时图 → 运行时布局（compileTrackGraph）

把工厂画 / 编辑成 `TrackGraph`（位姿、段类型、设备间显式交接），再编译成 sim 直接跑的 `FactoryLayout`：

```ts
import { compileTrackGraph, createSimFromLayout, TrackGraph } from 'r3f-tools'

const graph = new TrackGraph()
graph.addDevice({ id: 'infeed', kind: 'roller-conveyor', config: { speed: 2 } })
// …节点用 makePose()，边指定段类型，handoff 节点连接设备…

const { layout, issues, layoutIssues } = compileTrackGraph(graph)
// issues：结构化的编译决策（分支设备被拒、死端合成 sink、中段交接告警）
const sim = createSimFromLayout(layout, { seed: 42 })
```

无边的设备（source、sink、junction、inspector、buffer）通过 `config.simKind` 声明自身，其余字段从设备 `config` 袋里读取 —— 详见 `compileTrackGraph` 的模块文档。

### TrackGraph 与设备插件

`TrackGraph` 把物理归属与几何分开：视觉上的交叉不代表两台设备连通。只有在允许物料通过的交接点才定义显式 `handoff` 节点。`DeviceRuntime.transfer()` 会询问接收方设备插件能否接收该物料。

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

用 `DevicePluginRegistry` 管每台设备的运行行为，用 `SegmentPluginRegistry` 管自定义段几何。两个注册表都会把插件错误隔离到对应的 `deviceId`：前者回退到内置的停止 / 故障行为，后者回退为直线段。订阅 `onPluginDegraded` 即可在 UI 上暴露故障。

对于否则会留下裸露交叉缺口的转运点，使用内置的 `VerticalLift`。它内部那条封闭图边应设为 `visible: false`：该边保留在物料路径上，而机械交接由顶升移栽机渲染，而不是一段裸露的辊床。

`TrackRenderer` 默认使用可编辑输送线的视觉模型。用 `showRollers={false}` 只查看框架，用 `showPath` 显示路线；`showPaths` 作为废弃别名仍然可用。

```ts
const segmentPlugins = new SegmentPluginRegistry({
  onPluginDegraded: ({ deviceId, error }) => reportDeviceFault(deviceId, error),
})
segmentPlugins.register({
  kind: "vendor-roller-bed",
  generateGeometry: createVendorRollerBed,
})

// 把 segmentPlugins 传给 <TrackRenderer graph={graph} ... />。
```

### InstancedMeshPool

面向性能的组件，用 Three.js InstancedMesh 渲染大量相似物体，并自动批处理。

```tsx
import { InstancedMeshPool } from 'r3f-tools'
import * as THREE from 'three'

function Scene() {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: 'orange' })
  
  // 为实例创建变换矩阵
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

- `geometry: THREE.BufferGeometry` - 所有实例共用的几何体
- `material: THREE.Material` - 所有实例共用的材质
- `maxInstances?: number` - 最大实例数（默认：1000）
- `batchSize?: number` - 每批最大实例数（默认：1000）
- `enableColors?: boolean` - 启用逐实例颜色（默认：false）
- `frustumCulled?: boolean` - 启用视锥剔除（默认：false）
- `onClick?: (event, index) => void` - 点击回调
- `onPointerOver?: (event, index) => void` - 悬停进入回调
- `onPointerOut?: (event, index) => void` - 悬停离开回调

### GSAPAnimator

强力的动画工具，为 Three.js Object3D 提供 GSAP 驱动的动画，带队列管理与连续动画支持。

```tsx
import { createAnimator } from 'r3f-tools'
import { useRef, useEffect } from 'react'
import * as THREE from 'three'

function AnimatedCube() {
  const meshRef = useRef<THREE.Mesh>(null)
  
  useEffect(() => {
    if (!meshRef.current) return
    
    const animator = createAnimator(meshRef.current)
    
    // 基础动画
    animator.animate({
      position: { x: 5, y: 2, z: 0 },
      rotation: { y: Math.PI },
      duration: 2,
      ease: 'power2.inOut',
      onComplete: () => console.log('Animation completed!')
    })
    
    // 卸载时清理
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

#### 动画方法

**基础动画**
```tsx
// 单个动画
await animator.animate({
  position: { x: 10, y: 5, z: 0 },
  rotation: { x: Math.PI / 2 },
  duration: 1.5,
  ease: 'bounce.out',
  delay: 0.5
})
```

**序列动画**
```tsx
// 串联多个动画
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

**连续动画（数据驱动）**
```tsx
// 用外部数据源建立连续动画
animator.startContinuousAnimation(async () => {
  // 从 API 拉取动画点，或程序化生成
  const response = await fetch('/api/animation-points')
  const data = await response.json()
  
  return data.map(point => ({
    x: point.x,
    y: point.y, 
    z: point.z,
    rotationY: point.angle,
    duration: point.speed || 1
  }))
}, 2000) // 每 2 秒取一批新点

// 停止连续动画
animator.stopContinuousAnimation()
```

#### 动画控制

```tsx
// 暂停 / 恢复动画
animator.pause()
animator.resume()

// 是否正在播放
const isPlaying = animator.isPlaying()

// 杀掉全部动画
animator.kill()

// 彻底清理
animator.destroy()

// 观察动画队列
const queueSize = animator.getQueueSize()
const activeTweens = animator.getActiveTweensCount()
```

#### 命令式 API（ref）

```tsx
const meshPoolRef = useRef<InstancedMeshPoolRef>(null)

// 更新单个实例
meshPoolRef.current?.setMatrixAt(index, matrix)
meshPoolRef.current?.setColorAt(index, color)

// 批量更新
meshPoolRef.current?.setMatrices(matrices, startIndex)
meshPoolRef.current?.setColors(colors, startIndex)

// 更新实例数量
meshPoolRef.current?.setInstanceCount(count)

// 强制刷新
meshPoolRef.current?.updateMatrices()
meshPoolRef.current?.updateColors()
```

### 最佳实践

#### 静态实例（不动）

初始化后就不再移动的场景：

```tsx
function StaticScene() {
  const meshPoolRef = useRef<InstancedMeshPoolRef>(null)
  
  useEffect(() => {
    // 一次性设置矩阵
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
      frustumCulled={true}  // 开启以获得更好性能
    />
  )
}
```

#### 动态实例（有动画）

频繁更新的动画场景：

```tsx
function DynamicScene() {
  const meshPoolRef = useRef<InstancedMeshPoolRef>(null)
  
  useFrame(() => {
    // 每帧更新矩阵
    instances.forEach((instance, index) => {
      const matrix = calculateInstanceMatrix(instance)
      meshPoolRef.current?.setMatrixAt(index, matrix)
    })
    // 组件内部通过 useFrame 自动提交更新
  })

  return (
    <InstancedMeshPool
      ref={meshPoolRef}
      geometry={geometry}
      material={material}
      maxInstances={10000}
      batchSize={1000}
      enableColors={true}  // 需要逐实例颜色时开启
      frustumCulled={false}  // 频繁运动的物体关闭剔除
    />
  )
}
```

#### 非交互（无点击事件）

不需要点击、追求极致性能时：

```tsx
<InstancedMeshPool
  geometry={geometry}
  material={material}
  maxInstances={100000}
  batchSize={10000}
  frustumCulled={true}
  // 不传事件处理器 = 不做包围盒计算
/>
```

#### 交互（带点击事件）

需要点击时会自动计算包围盒：

```tsx
<InstancedMeshPool
  geometry={geometry}
  material={material}
  maxInstances={10000}
  batchSize={1000}
  onClick={(event, index) => {
    // 处理点击 —— 即使动画暂停也能命中
    console.log('Clicked instance:', index)
  }}
  onPointerOver={(event, index) => {
    // 处理悬停
  }}
/>
```

### 性能建议

1. **批大小**：实例很多时用更大的 batch size（5000-10000）
2. **视锥剔除**：静态内容开启，频繁运动的动画内容关闭
3. **颜色**：只在确实需要逐实例颜色时才开 `enableColors`
4. **事件处理器**：只在需要交互时才加
5. **矩阵更新**：动画内容优先用 `setMatrixAt`，不要整体重建矩阵数组

## 示例

完整示例见 `examples/` 目录。

- `examples/VividFactoryConveyorExample.tsx`：整厂示例（走 `buildFactoryLayout` → `validateFactoryLayout` → `createSimFromLayout` 这条数据路径启动）
- `examples/FactoryLayoutExample.tsx`：TrackRenderer / MaterialFlow 的设计时链路
- 本地跑起来：`npm run example`

## 开发

```bash
# 安装依赖
npm install

# 构建库
npm run build

# Lint
npm run lint

# 类型检查
npm run typecheck

# headless 校验脚本（sim 行为回归）
# scripts/*.harness.ts：layoutFromJson / determinism / episodeRecording /
# externalSignals / compileTrackGraph
```

## 许可证

MIT © Forgere
