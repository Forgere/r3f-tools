# 生动复杂输送线场景实现计划

> 目标：在 `r3f-tools` 示例中实现一个 ** toy-factory / 可爱工厂 ** 风格的复杂输送线场景。参考图 @image#1 决定视觉风格（圆润、 pastel、柔和光照），参考图 @image#2 决定布局（多段彩色输送线、货架区、交汇点）。

---

## 1. 视觉风格定位（参考 MICRODUCK）

| 维度 | 参考图 #1 特征 | 本场景落地 |
|------|----------------|------------|
| **造型** | 圆角、饱满、模块化、像玩具零件 | 输送线框架用圆角倒角、滚筒偏短粗、货箱用圆角立方体 |
| **配色** | 柔和 pastel：薄荷绿、奶油黄、淡紫、珊瑚橙、雾蓝 | 每条输送线 belt 使用不同 pastel 色；机架用奶油白 / 浅灰；地面用深灰绿 |
| **材质** | 哑光塑料、轻微蜡感、无高光金属 | `MeshStandardMaterial.roughness ≈ 0.7`，`metalness ≈ 0.05` |
| **光照** | 暖白柔光、阴影柔和、无明显硬边 | 暖色环境光 + 主方向光 + 补光；开启柔和阴影 |
| **UI** | 圆角卡片、手写感字体、暖色按钮 | 示例面板用圆角、半透明、emoji 图标 |

### 调色板

```ts
const PALETTE = {
  mint:       '#8BD3C7', // 薄荷绿
  lavender:   '#C4B5E0', // 淡紫
  peach:      '#F4A261', // 珊瑚桃
  sky:        '#9FD8F0', // 雾蓝
  butter:     '#F7E3A4', // 奶油黄
  creamFrame: '#F5F2EB', // 机架奶白
  darkFloor:  '#3A4A4F', // 深灰绿地面
  warmLight:  '#FFF4E6', // 暖光色
};
```

---

## 2. 布局设计（参考真实输送线）

整个场景呈俯视 `L` 形 / 树枝形工厂布局，包含 5 条独立输送线，彼此在转运点交汇。

```text
[入库区货架]                [分拣口 A]
     │                          ▲
     │ green-line               │
     ▼                          │ peach-line
[汇合点 H] ─── purple-line ──▶ [分拨中心 S]
     │                          │
     │ blue-line                │ yellow-line
     ▼                          ▼
[包装区 P]                [出库缓存区 O]
```

### 输送线路径

| 线路 | 颜色 | 路径特征 | 功能 |
|------|------|----------|------|
| `green-line`  | `#8BD3C7` | 从货架区出来，短直 + 90° 弯 | 入库 |
| `purple-line` | `#C4B5E0` | 水平长直 + 小 S 弯 | 主线转运 |
| `blue-line`   | `#9FD8F0` | 从 H 到 P，带上升斜坡 | 包装线 |
| `peach-line`  | `#F4A261` | 从 S 向上折返 | 分拣线 |
| `yellow-line` | `#F7E3A4` | 从 S 向下到底 | 出库线 |

---

## 3. 组件与实现策略

### 3.1 复用现有能力

- `ConveyorBelt`：渲染单条输送线（滚筒 InstancedMesh、两侧机架、带动画的 belt shader）。
- `InstancedMeshPool`：批量渲染货箱、滚筒，保持性能。
- `moveAlongPath` / `PathAnimator`：让可爱的货箱沿着曲线移动（不依赖 graph routing，更直观）。
- `TrackGraph` + `MaterialFlow`（可选进阶）：如果需要设备级启停/故障模拟，可接入 graph。

### 3.2 新增/扩展

- `VividFactoryConveyorExample.tsx`：主示例，负责场景组合、UI、状态。
- `CuteRack.tsx`：圆角货架组件（用 rounded box 多层板 + 彩色货盒）。
- `CuteBox.tsx`：圆角货箱，带 pastel 色。
- 自定义 belt 材质：基于 `ConveyorBelt` 的 shader，但提供箭头颜色参数，让每条 belt 箭头颜色与 belt 一致。

### 3.3 动画清单

| 动画 | 实现方式 | 说明 |
|------|----------|------|
| Belt 流动箭头 | `ConveyorBelt` 内置 shader | `arrowSpeed` 与 global speed 同步 |
| 滚筒转动 | 可选：用 `useFrame` 让 InstancedMeshPool 矩阵绕自身轴微旋转 | 用 `InstancedMeshPool.setMatrixAt` 每帧更新 |
| 货箱移动 | `PathAnimator` 沿 `CatmullRomCurve3` | 多货箱 stagger 启动，循环运行 |
| 货箱颠簸 | 在 `onUpdate` 里叠加轻微正弦抖动 | 增加生动感 |
| 货架指示灯 | 小圆点灯呼吸动画 | 用 `useFrame` 调整 emissiveIntensity |
| 悬浮尘埃 | 少量 `points` 粒子缓慢飘动 | 增强氛围 |

---

## 4. 交互设计

在 Leva 面板 / 原生 HTML 面板提供：

- **Global Speed**：全局速度倍率（0 ~ 2）。
- **Play / Pause**：暂停/恢复所有动画。
- **Show Paths**：显示路径辅助线。
- **Camera Preset**：`Overview` / `Infeed` / `Sorter` / `Outfeed` 四个视角。
- **Cargo Count**：0 ~ 60。
- **Line Visibility**：5 条线的开关。

---

## 5. 性能目标

- 输送线数量：5 条，滚筒总数 < 1500。
- 货箱数量：默认 30，最大 60。
- 帧率：桌面端稳定 60 FPS（`AdaptiveDpr`）。
- 阴影：PCFSoftShadowMap，方向光阴影贴图 2048。

---

## 6. 文件结构

```text
r3f-tools/
├── factory-conveyor-plan.md          <- 本文件
├── examples/
│   ├── VividFactoryConveyorExample.tsx <- 新示例
│   └── main.tsx                         <- 新增路由 /vivid-factory
└── src/
    └── ...（复用现有组件，不做侵入式修改）
```

---

## 7. 验收标准

- [x] `factory-conveyor-plan.md` 已存在并包含风格、布局、实现策略。
- [x] `examples/VividFactoryConveyorExample.tsx` 实现多 pastel 色输送线 + 货箱动画。
- [x] 路由 `/vivid-factory` 已接入 `examples/main.tsx`。
- [x] 扩展 `tsconfig.examples-check.json` 验证：src + examples 联合 typecheck 中本文件无错误。
- [ ] `npm run example` 启动后能在浏览器看到场景（环境因 WSL/Windows 原生模块差异无法在本机直接跑 Vite build）。

---

## 8. 迭代 v2（交汇设备 + 输送线模型优化）

### 8.1 交汇设备（两个交汇点全部设备化）

| 交汇点 | 坐标 | 设备 | 说明 |
| --- | --- | --- | --- |
| H 合流点 | `(-1.2, 0.7, -0.2)` | `CuteMergeJunction` | 圆盘底盘 + 顶盖 + 导流帽 + 三向护栏 + 控制盒 |
| S 分流点 | `(8, 0.7, 0)` | `CuteSorterJunction` | 转盘 + **摆动分流拨臂**（随速度 sin 摆动，覆盖两个出料口）+ 扫码拱门（闪烁指示灯）+ 护栏 + 控制盒 |

- `JUNCTIONS` 常量统一管理两个交汇点；`clipPathForJunction` 对每条路径的所有交汇点做缩进（gap 0.85），输送带不再互相穿插。
- 两台设备均有落地支撑柱 + 底座圆盘（带面抬高后设备离地 0.7）。

### 8.2 输送线模型优化

- **带面抬升**：`BELT_HEIGHT = 0.7`（原 0，几乎贴地），蓝线包装床 `1.3`，更接近真实输送线。
- **支撑腿**：`computeLegs` 沿每条曲线每 1.35 单位采样（自动避开交汇设备 footprint），爬坡段腿自动变高；`SupportLegs` 用两个 `InstancedMeshPool`（立柱 + 底脚）渲染，静态矩阵只写一次。
- **驱动电机**：`CuteMotor` 置于每条线起始端侧面（沿切线左侧偏移 0.55），机身 + 色带 + 传动轴 + 4 叶散热风扇（随 globalSpeed 旋转）。
- **相机预设**：全部 target 抬到带面高度。

### 8.3 修复

- **InstancedMeshPool 不渲染 bug**：pool 的 `mesh.count` 初始为 0 且无自动同步，`CuteCargoFlow`/`SupportLegs` 必须显式调 `setInstanceCount(n)`，否则实例（货箱/腿）完全不显示。


---

## 9. 迭代 v3：数据驱动仿真架构（2026-09-04）

> 目标：**哪里产生物料、设备提供什么运动路径、改变什么状态，后台记录；前台只渲染变化的数据**——为更大范围的工厂渲染做准备。

### 9.1 分层

```
┌─────────────────────────────────────────────────────────┐
│  src/sim/  仿真内核（纯 TS，零 three 依赖，可进 Worker）      │
│  types.ts     域模型：Source / Transport / Junction / Sink  │
│               + SimEvent（事件日志）+ FrameDelta（帧差量协议） │
│  pathMath.ts  折线圆角 + 弧长表采样（O(log n)）               │
│  FactorySim   设备图世界：tick() → 事件记录 + FrameDelta      │
├─────────────────────────────────────────────────────────┤
│  前台（R3F）  SimCargoLayer：只消费 FrameDelta               │
│               spawned→分配槽位写色 / moved→只写变化矩阵        │
│               removed→槽位置零回收 / 停机时零矩阵写入           │
└─────────────────────────────────────────────────────────┘
```

### 9.2 设备即数据（示例拓扑）

```
rack-a(source) → green-line ─→ junction-H ─┬→ purple-line → junction-S ─┬→ peach-line  → sink-north
                                             └→ blue-line → sink-packaging└→ yellow-line → sink-south
```

- **Source**：`interval` 产生物料（`itemTypes` 加权随机，typeId + colorIndex）。
- **Transport**：提供运动路径（与渲染带几何一致的 clipped 折线）+ 速度 + `minGap` 防追尾（阻塞自然排队）。
- **Junction**：改状态的设备——`routes`（按物料类型静态路由：parcel→主干，crate→包装线）或 `alternate`（分拣机状态机，每 interval 切换 routeIndex，发 `device:state` 事件）。
- **Sink**：消耗物料并记录吞吐。

### 9.3 事件记录（后台）

`item:spawned / item:transferred / item:consumed / item:blocked / device:state` 全部落入环形日志（默认 250 条），HUD 实时显示最近 8 条；统计数据（active/spawned/consumed/blocked/每 sink 吞吐）随 delta 返回。

### 9.4 前台只渲染变化

- `SimCargoLayer` 每帧 `sim.tick(delta)` → 应用 FrameDelta；渲染槽位（上限 300）通过 free-list 复用，spawned 写一次颜色、moved 只写该槽位矩阵、removed 零缩停放。
- 皮带停机 / 队列阻塞时 `moved` 为空 → **零矩阵写入**（这就是大规模渲染的省法）。
- 分拣机拨臂角度由 sim 的 `routeIndex` 驱动（最短弧插值），不再是装饰性 sin 摆动。
- Leva 控件直接映射控制 API：`setGlobalSpeed / setSourceRate / setRunning`。

### 9.5 规模化路径

1. 仿真进 Web Worker：`FactorySim` 无 DOM/three 依赖，postMessage 传 FrameDelta（结构化克隆友好，纯数组/数字）。
2. 多区域工厂：设备图按区域分片，各 sim 实例独立 tick，跨区域 handoff 走 junction 协议。
3. 渲染端 LOD：moved 可按相机距离降频（远区物料隔帧更新）。
4. 事件日志可持久化（SQLite/时序库）→ 回放与数字孪生对账。

### 9.6 验收

- [x] `src/sim/` 三模块 + `src/index.ts` 导出，项目 tsconfig typecheck 通过。
- [x] 示例改为 sim 驱动：货箱从货架源头产生，按类型路由，分拣机状态机分流，终点消耗。
- [x] HUD 显示实时统计 + 事件流。
- [x] 停机时前台零矩阵写入（delta 为空即不碰 GPU buffer）。
