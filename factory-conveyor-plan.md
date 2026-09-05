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

---

## 10. 迭代 v4：设备渲染插件化 + 顶升移栽（2026-09-04，已实现）

> 目标：**设备模型可热替换**。同一份布局与仿真数据，换一个插件就换一台机器。

### 10.1 三层插件缝

```
src/devices/
├── registry.ts             DeviceRendererRegistry：kind → Component，可覆盖注册
├── DeviceRendererHost.tsx  解析插件 + 提供 readState()；useSyncExternalStore 订阅替换
├── geometry.ts             带缓存的 RoundedBox / Cylinder / Sphere（three-stdlib）
├── LiftTransferUnit.tsx    顶升移栽机渲染器
├── BallTransferTable.tsx   万向球台（对比插件，证明整台机器可换）
└── plugins.ts              cute / industrial / ball-table 三个预设
```

- `register({kind, ...})` 用同 kind 覆盖即热替换，宿主通过 `useSyncExternalStore` 重解析，**仿真不中断**。
- 插件通过 `readState()` 在自己的 `useFrame` 里读 `sim.getDeviceState(id)`，**不订阅、不触发 React 渲染**，与帧序无关。
- `DeviceLayout` 全部由皮带几何反推（`getJunctionPorts`）：路径终点=入料口，起点=出料口，`routeSigns[i]` 记录每个出口在台面局部坐标的 Z 分量符号（`0` 直行 / `±1` 顶升横移）。

### 10.2 顶升移栽机（真实机构还原）

| 部件 | 局部坐标 | 说明 |
| --- | --- | --- |
| 台面尺寸 | `length × width = 皮带宽度 1.1` | **与输送线同宽**，皮带裁到台面边缘对接 |
| 主滚筒组 | 8 根，轴沿 Z，间距 0.149 | 提供沿 X（主流向）的输送能力，顶面 `y = 0.14` 与皮带机架顶齐平 |
| 顶升 cassette | 7 根小传动轴，轴沿 **X** | 藏在滚筒缝隙里，缩回时轮顶低于滚筒线 0.021 |
| 传动轮 | 每轴 3 只，`r = 0.042` | 轴沿 X ⇒ 驱动方向为 ±Z；`lift = 1` 时轮顶高出滚筒线 0.109 |
| 顶升气缸 | 4 组 | 缸体固定，活塞杆 `scale.y = rest + lift·H` 随动伸缩 |
| 纵梁 | `z = ±0.455` | **在滚筒包络之外**，所以 cassette 升起时不会撞滚筒 |

局部原点 = 皮带路径中心线（`BELT_HEIGHT`），`DECK_TOP = 0.14` 对齐皮带机架顶面。

### 10.3 仿真侧：顶升循环状态机

`JunctionDef.lift` 新增配置，`JunctionRT` 增加 `phase / phaseT / lift / entry / exit`：

```
dwell（滚上台面，entry→中心） → lifting（cassette 0→1） → transfer（中心→exit 横移） → lowering（1→0） → 交接到下游
```

- 只有命中 `divertRoutes` 的出口才走顶升；直行货物纯靠滚筒滚过去。
- 循环期间设备占用不放开 ⇒ **上游自然排队阻塞**（真实节拍）。
- `DeviceStateDelta` 增加 `lift / phase / occupied`，插件直接读。
- 新增 `FactorySim.getDeviceState(id)` 实时快照（渲染器轮询，不走 delta 订阅）。

**旋转方向约定**（易踩坑）：Euler `'XYZ'` 等价于 `Rx·Ry·Rz`，作用在向量上是 **先 Rz 后 Ry 再 Rx**。
- 滚筒（轴→Z）：`rotation.set(π/2, spin, 0)` —— 先绕自身 Y 自转，再由 Rx 摆正到 Z。
- 传动轮（轴→X）：`rotation.set(spin, 0, π/2)` —— 先由 Rz 摆正到 X，再绕 X 自转。

### 10.4 验收

- [x] `src/devices/` 六模块，src + example 双 typecheck 通过。
- [x] 两台交汇设备改为插件宿主，`MERGE_GAP/SORTER_GAP` 收敛为 `BELT_WIDTH / 2 = 0.55`（与输送线同宽）。
- [x] Leva 面板「分流转接台插件」三选一下拉，运行时热替换。
- [x] 示例移除 `CuteMergeJunction` / `CuteSorterJunction`，旧交汇设备代码清零。

---

## 11. 迭代 v5：质检站台 + 不合格货架（**已实现**）

> 场景：**加一个检查站台，检验货物是否合格，不合格的运到不合格货架堆放。**

### 11.1 能力审计结论：**当前架构不满足**（4 个硬缺口）

| # | 场景需要 | 现状 | 判定 |
| --- | --- | --- | --- |
| G1 | 检查站台这种设备 | `SimDeviceDef` 只有 `source / transport / junction / sink` 四种，无 inspector | ❌ |
| G2 | 把「合格 / 不合格」结论挂在货物上 | `InternalItem` 只有 `id/typeId/colorIndex/deviceId/distance`，**无属性袋** | ❌ |
| G3 | 按结论（而非类型）路由 | `FactorySim.ts:591` 只有 `routes?.[item.typeId]`，键死为 typeId | ❌ |
| G4 | 不合格货架**堆放** | `Sink` 命中即 `items.delete()` + `consumed++`（540/712 行），**瞬时销毁、不留存、无容量、不会满** | ❌ |
| G5 | 记录检验结果 | `SimEventType` 无 `item:inspected`；`SimEvent` 只有 `detail?: string`，无结构化载荷 | ⚠️ |
| G6 | 判不合格后货箱变色 | `ItemSpawnDelta` 只在 spawn 写一次颜色，无 restyle delta | ⚠️ |
| ✅ | 堆放物的渲染 | `SimCargoLayer` 只吃 `moved{x,y,z}`，**仿真给出坐标就能堆** | ✔ 不用改 |
| ✅ | 大规模扩展 | 设备图 + 事件日志 + FrameDelta + 插件注册表 | ✔ 不用改 |

> 简言之：**渲染与扩展机制已经够了，缺的是仿真域模型里「货物属性」和「缓存设备」这两个概念。**

### 11.2 扩展设计

**E1 · 货物属性袋**

```ts
interface InternalItem {
  // … 现有字段
  /** 设备可读写的过程属性：quality / batch / weight … */
  attrs: Record<string, string | number | boolean>;
}
```
`SourceDef.itemTypes[]` 增加可选 `attrs?`，源头即可带批次/供应商等初始属性。

**E2 · 新设备 `inspector`（检查站台）**

```ts
interface InspectorDef {
  id: string; kind: "inspector";
  position: SimPoint;
  /** 检验耗时（扫码 / 称重 / 视觉） */
  dwell: number;
  /** 判定规则，按顺序首条命中即停 */
  rules?: { attr: string; equals: AttrValue; verdict: string }[];
  /** 随机不良率，用于演示 */
  random?: { verdict: string; rate: number };
  defaultVerdict: string;
  /** 结论写入哪个属性 */
  writesAttr: string;         // e.g. "quality"
  /** 按结论路由 */
  routes: Record<string, string>;
}
```
tick：物品进入 → 停留 `dwell`（扫描）→ 判定 → 写 `attrs[writesAttr]` → 发 `item:inspected` → 按 `routes[verdict]` 交接。
复用 junction 的 phase 机制即可拥有同样的阻塞语义。

**E3 · 路由键可配置（向后兼容）**

```ts
interface JunctionDef {
  // … 现有字段
  /** 路由依据的属性名，默认 "typeId" */
  routeBy?: string;
}
```
`const key = routeBy === "typeId" ? item.typeId : String(item.attrs[routeBy] ?? item.typeId);`

**E4 · 新设备 `buffer`（不合格货架 / 缓存位）**

```ts
interface BufferDef {
  id: string; kind: "buffer";
  position: SimPoint;
  /** 货位排布 */
  columns: number; rows?: number; layers?: number;
  spacing: [number, number, number];
  /** 满了怎么办：block = 顶住上游（真实节拍）；consume = 静默清走 */
  onFull: "block" | "consume";
  /** 可选：N 秒后被 AGV / 叉车取走，自动清空 */
  drainAfter?: number;
}
```
- 入 buffer 的物品**不删除**，分配 `slotIndex` ⇒ 位置 `= position + 栅格偏移`，直接进 `moved` 发给前台。
- `onFull: "block"` 时拒收 ⇒ 上游 junction 卡住 occupant ⇒ **整条线真实倒灌**。
- `drainAfter` 模拟定期清运，清空时补一条 `buffer:drained` 事件。

**E5 · 事件与 delta 补强**

- `SimEventType` += `item:inspected` / `buffer:stored` / `buffer:full` / `buffer:drained`
- `SimEvent` 增加 `payload?: Record<string, string | number | boolean>`（结构化，便于落库 / 回放对账）
- `FrameDelta` 增加 `restyled: ItemRestyleDelta[]`（`{ itemId, colorIndex }`）—— 判废瞬间货箱变红

**E6 · 两个新渲染插件（复用 v4 插件机制）**

| kind | 插件 | 视觉 |
| --- | --- | --- |
| `inspection` | `CuteInspectionStation` | 门架 + 扫描光幕（`phase === "scan"` 时扫动）+ 判定灯（绿/红）+ 小显示屏 |
| `buffer` | `CuteRejectRack` | 多层货架，货位随 `count` 逐个填满；满位转琥珀色告警灯 |

两者都通过 `DeviceRendererRegistry` 注册，**与顶升移栽共用同一套热替换机制**。

### 11.3 扩展后拓扑

```
rack-a(source)
   → green-line
   → junction-H ─┬─ crate  → blue-line   → sink-packaging
                 └─ parcel → purple-line → inspect-QC ─┬─ ok → junction-S ─┬→ peach-line  → sink-north
                                                        │                   └→ yellow-line → sink-south
                                                        └─ ng → reject-line → buffer-reject（堆放，满则倒灌）
```

### 11.4 验收清单（实现时逐条勾）

- [ ] `SimItem` 携带 `attrs`，检验结论可随货物流动
- [ ] `inspector` 设备：停留 → 判定 → 写属性 → 发事件 → 按结论路由
- [ ] `junction.routeBy` 支持按任意属性路由（默认 `typeId`，不破坏现有拓扑）
- [ ] `buffer` 设备：栅格堆放、`onFull: "block"` 造成上游倒灌、`drainAfter` 定期清运
- [ ] `item:inspected` / `buffer:*` 事件 + 结构化 `payload` 进入 HUD 事件流
- [ ] `FrameDelta.restyle` 让判废货箱即时变色
- [ ] `CuteInspectionStation` / `CuteRejectRack` 两个插件注册并可热替换
- [ ] Leva 增加「不良率」滑杆，实时观察倒灌与堆放

### 11.5 待决策（实现前需要拍板）

1. **`src/core/` 里那套 `TrackGraph` + `DeviceRuntime` + `DevicePluginRegistry` 与 `src/sim/FactorySim` 是两套并行的设备世界**，前者（`canReceive`/`onTick` 插件缝）目前完全没被 FactorySim 使用。建议：要么把 inspector 的判定逻辑挂在 core 的 `DevicePlugin` 上并让 FactorySim 复用，要么明确 core 只服务 `TrackRenderer` 老链路、新场景一律走 `src/sim` + `src/devices`——**二选一，别继续双轨**。
2. buffer 满位是否需要「人工清空」交互（点击货架触发 `drain`），还是只用 `drainAfter` 定时器。

> **状态更新（2026-09-05）**：§11 的 E1–E5 已全部落地到 `src/sim/FactorySim.ts` 与 `src/sim/types.ts`，并通过无头测试（质检产生 ok/ng 判定、NG 进 reject 货架、OK 流到 sink）。同时新增 §12 的三种数据模式。

## 12. 迭代 v6：数据驱动的三种模式（sim / external / hybrid，2026-09-05）

真实数字孪生里**不可能每个设备都有数据**。所以数据驱动层必须支持三种运转模式，前台渲染契约（FrameDelta）保持不变。

### 12.1 三种模式

| 模式 | 含义 | 引擎行为 | 前台 |
|------|------|----------|------|
| `"sim"` | 全仿真 | 所有设备跑内部运动学 | 消费 FrameDelta |
| `"external"` | 接受数据 | 引擎**不生成、不推算**，只把外部帧 diff 成 spawned/moved/removed | 消费 FrameDelta（"接受数据"） |
| `"hybrid"` | 混合 | 按设备 `dataSource` 逐个决定：有数据的设备吃外部 Feed，没数据的设备跑仿真 | 消费 FrameDelta |

### 12.2 类型与 API（`src/sim/types.ts` + `FactorySim`）

```ts
export type DataMode = "sim" | "external" | "hybrid";

export interface ExternalItemState {
  itemId: number; typeId: string; colorIndex: number;
  x: number; y: number; z: number; heading: number;
  attrs?: Record<string, SimAttrValue>;   // 质量/批次等随件属性
}
export interface ExternalDeviceFrame { deviceId: string; items: ExternalItemState[]; }
```

```ts
const sim = new FactorySim(defs, { worldMode: "hybrid", deviceSources: { "real-line-3": "external" } });
sim.setWorldMode("external");                       // 全局切换
sim.setDeviceDataSource("real-line-3", "external"); // 单设备切换（hybrid 下生效）
sim.ingestExternalFrame([{ deviceId: "real-line-3", items: [/* 来自 MES/SCADA/PLC 的实时位姿 */] }]);
const delta = sim.tick(dt);                         // 渲染契约不变
```

### 12.3 引擎内部（tick 分支）

```
tick(dt):
  worldMode == "external"  -> runExternal()            // 纯 diff 外部 Feed
  worldMode == "sim"      -> runSim()                  // 全内部运动学
  worldMode == "hybrid"   -> runSim() + runExternal()  // 各设备按 effMode 选路
```

- `effMode(id)`：`sim`→sim；`external`→external；`hybrid`→`deviceSources.get(id) ?? "sim"`。
- `runExternal()`：把 Feed 里每个 item 镜像成 `InternalItem{ held:true }`，`needsWrite` 时 `collectMoved` 直接从 Feed 读位姿；Feed 中消失的 item → `removed`。
- `runSim()` 的每个 tick 方法（transports/junctions/inspectors/buffers）开头 `if (effMode(id) !== "sim") continue;`，**外部设备不被仿真**。

### 12.4 边界交接（hybrid 关键）

sim 设备把物料交给 external 设备时，物料**保持同一 itemId**，只把权威从仿真切到 Feed，前台无感知：

- 目标设备存在但标 `external`（拓扑里有定义）：`acceptItem` 顶部走 `externalAdopt` —— 标 `held=true`、把当前位姿注入 `this.external`，后续由真实 Feed 接管。
- 目标设备是「纯外部」（`this.devices` 里压根没建模）：`handOffFromTransport` / `releaseTransferLike` 走 `externalHandoff` —— 同样标 `held` 并注入 Feed，事件记 `item:transferred … (external)`。

> 已知简化：v6 只实现 **sim→external** 单向交接（最常见：仿真线汇入真实数据线）。**external→sim** 自动收养（真实设备把物料推回仿真段）留待下一轮，需 Feed 显式给出「交接意图」字段。

### 12.5 为什么这能撑住大工厂

- 没有数据的设备段由仿真补位，整厂永远「连得上、看得动」；
- 有数据的设备段零推算、零误差，直接吃实时位姿（数字孪生保真）；
- 前台只认 FrameDelta，三种模式切换无需改任何渲染代码；
- 切换 `worldMode` 是运行时热操作，可做成 leva 滑杆 / 调试面板，现场逐段验证「这段到底有没有数据」。

### 12.6 验收

- [x] `DataMode` + `ExternalItemState` + `ExternalDeviceFrame` 类型就位，`index.ts` 导出。
- [x] `setWorldMode` / `setDeviceDataSource` / `ingestExternalFrame` 实现。
- [x] 三种模式无头测试全绿：sim 搬运 / external 纯回放（spawn→move→remove）/ hybrid sim→external 交接保持 id。
- [x] `src` 与示例 `tsc --noEmit` 通过。
- [x] 示例里加一个 `worldMode` 滑杆 + 一个 external-only 设备段，肉眼验证三模式切换。

## 13. 示例收尾：质检/货架可视化 + 三模式滑杆（2026-09-05，已实现）

把 §11（质检 + 不合格货架）与 §12（三种数据模式）的**前台可视化**落到
`examples/VividFactoryConveyorExample.tsx`，并完成类型校验。

### 13.1 拓扑（已写入 `buildFactorySim`）

```
rack-a → green-line → junction-H ─┬─(crate)→ blue-line → sink-packaging
                                  └─(parcel)→ purple-line → inspector-1 ─┬─(ok)→ trunk-A → junction-S ─┬─(alt)→ peach-line → sink-north
                                                                         │                          └─(alt)→ yellow-line → sink-south
                                                                         └─(ng)→ reject-line → reject-rack（buffer, onFull:"block", drainAfter:12）
ext-src → ext-line → ext-sink            // external-only 数字孪生车道
```

- `inspector-1`：`kind:"inspector"`，`routes:{ok:"trunk-A", ng:"reject-line"}`，
  `random:{verdict:"ng", rate:0.35}`，NG 走顶升移栽侧移（同 transfer deck 机构）。
- `reject-rack`：`kind:"buffer"`，网格堆叠；满位 `onFull:"block"` 反压上游，
  `drainAfter:12` 秒后自动清空，演示可循环。

### 13.2 可视化组件

- `CuteInspectionStation`（`kind:INSPECTOR_KIND`）：扫描光束 + Pass/Fail 指示灯，
  取自 `DeviceVisualState.routeIndex` / `lastVerdict`。
- `CuteRejectRack`（`kind:BUFFER_KIND`）：货架框 + 接近满位的指示灯，取自 `fill`。
- 二者通过 `DeviceRendererHost` + `INSPECTION_PLUGINS` 注册进 `DeviceRendererRegistry`，
  渲染契约与拓扑数据解耦（插件的真实还原见 §10）。

### 13.3 三模式滑杆（leva）

- `worldMode` 下拉：`模拟 sim` / `混合 hybrid` / `仅外部数据 external`。
- 切换即调 `sim.setWorldMode(m)` + `sim.setDeviceDataSource("ext-line"|"ext-src", …)`；
  同时把最新模式写进 `worldModeRef`，供 `SimCargoLayer` 每帧的 `externalFeeder` 读取。
- `externalFeeder`：在 hybrid/external 下把合成外部帧（`ext-line` 上 3 个循环物料）喂给
  `sim.ingestExternalFrame`；纯 sim 模式跳喂，避免双源。

### 13.4 修复记录（收尾时清掉的两个阻断编译错误）

1. `src/devices/index.ts` 漏导出 `CuteInspectionStation` / `CuteRejectRack` →
   `src/index.ts` 引用失败；已在 devices barrel 补上两个组件导出。
2. `SimCargoLayer` 的 `useFrame((_, delta) => …)` 未捕获 `state`，但内部
   `externalFeeder?.(state.clock.elapsedTime, delta)` 用到 `state`（`undefined`）；
   改为 `useFrame((state, delta) => …)`。同时把 `worldModeRef` 改为字面量默认值
   `useRef<…>("sim")`（原 `useRef(worldMode)` 在 `useControls` 声明前引用 `worldMode`，
   TS 报「used before declaration」），并把 `phase[i]` 兜底为 `phase[i] ?? 0`
   （`noUncheckedIndexedAccess` 下 `number | undefined`）。

### 13.5 验收

- [x] `src` `tsc --noEmit` 通过（exit 0）。
- [x] `src` + `examples/VividFactoryConveyorExample.tsx` 联合 `tsc --noEmit` 通过（exit 0）。
- [x] 质检 → OK/NG 分流、NG 进 reject 货架、OK 流到 junction-S 的全链路在示例拓扑中就位。
- [x] `worldMode` 滑杆 + external-only `ext-line` 车道就位，`externalFeeder` 按模式喂帧。
- [x] 生产构建 import 图自检：示例 alias `r3f-tools` → `../src/index.ts` 已在 `examples/vite.config.mjs` 配置；
      完整打包需在 WSL（Ubuntu）环境跑 `npm run example:build` 验证（本沙箱 Windows 运行时缺
      `@rollup/rollup-win32-x64-msvc` 原生二进制，环境限制，非代码问题）。

> 注：其余示例文件（`AnimatedInstancesExample` / `ConveyorBeltExample` /
> `EditableConveyorBeltExample` / `GSAPAnimationExample` / `PathAnimationExample`）
> 存在与本次任务无关的既有类型错误（项目自带 `npm run typecheck` 仅覆盖 `src`，
> 不校验 `examples/`），不在本次「继续完善示例」范围内。

## 14. 外部数据驱动的 4 种情况契约（**设计完成，未实现**）

### 14.1 现状缺口

当前 `FactorySim.collectMoved` 的 `held` 分支（FactorySim.ts:1276）是：外部给绝对世界位姿
→ 直接 push 进 `FrameDelta.moved`。这只覆盖**情况 3（且是世界坐标）**。
情况 1 / 2 / 4 一律不支持，根因是它们缺 `path`，而仿真没有补上。

### 14.2 统一模型（核心）

每个 transport 设备都有一条 `SimPath`（`buildSimPath(def.points, cornerRadius)`，含弧长
`path.length`），`item.distance` 是沿路径的弧长进度，`sampleSimPath(path, distance)` 是唯一的
世界位姿解算器（`collectMoved:1294` 非 held 分支在用）。四种情况的区别**只在于谁推进
`item.distance`**，最终都汇入同一个 `sampleSimPath → FrameDelta`：

```
外部信号 ──┬─ 情况1 entry    ─┐
           ├─ 情况2 span     ─┤→ item.distance(弧长) → sampleSimPath → FrameDelta.moved → 前台无感知
           ├─ 情况3 pose     ─┤   （情况3 外部位姿直接绕过 distance）
           └─ 情况4 progress ─┘
```

### 14.3 四情况映射

| 情况 | 外部给什么 | 仿真补什么 | 谁推进 distance | 须声明 path |
|---|---|---|---|---|
| 1 入口 | `tEnter`+`itemId` | 整段运动学（`speed×dt`） | **仿真** | ✅ |
| 2 入口+出口 | `tEnter`,`tExit` | 沿 path 在 `[tEnter,tExit]` 线性插值 | **仿真** | ✅ |
| 3 自有坐标 | 每帧 world/**local** 位姿 | 仅 local→world 变换 | **外部位姿直接绕过** distance | 否（或仅变换） |
| 4 百分比 | `progress` 0..1 | `distance = progress × L` | **仿真**映射 | ✅ |

> 「有些情况需要模拟段给出路径信息」→ 即情况 1/2/4 的设备**必须仍声明 belt `path`**
> （即便 externally triggered），仿真用 path 做运动学 / 插值 / 百分比映射。当前 `ext-line`
> 是纯 feed-only 无 path，所以只能当情况 3 用。

### 14.4 情况3 = 设备局部坐标（决策）

情况 3「自有坐标系信号」**默认按设备局部坐标（device-local）解读**：外部给的是该设备自身
坐标系下的位姿，仿真需用该设备的 `position` / `rotation` 做 local→world 变换后再透传。
约定：`ExternalSignal.pose.frame` 默认 `"local"`；`"world"` 为特例（即现有 `ExternalItemState`
的扁平 `x/y/z/heading` 字段，保留给简单数字孪生设备）。

### 14.5 交接（handoff）语义差异

- **情况1**：出口由仿真按 `speed` 预测 → 可能漂移，无外部校正（最弱）。
- **情况2**：出口由 `tExit` 锚定 → 到点 snap 到 exit 再 handoff（最稳）。
- **情况4**：`progress=1` 即出口事件。
- **情况3**：外部 feed 丢 item → `removed` → 触发 `externalHandoff` 给下一段。

### 14.6 类型 + 运行时（**已实现**，headless 校验 10/10 通过）

- `ExternalSignal` 判别联合：`pose{frame,x,y,z,heading}` / `progress{progress}` /
  `entry{tEnter}` / `span{tEnter,tExit}`。
- `ExternalContract`：`{ signal, frame? }` 设备级契约。
- `ExternalItemState.signal?: ExternalSignal`：存在时**优先**取其中的坐标；
  `x/y/z/heading` 改为可选，作为 `pose{frame:"world"}` 扁平特例的回退（详见 §14.6 末）。
  `collectMoved` 的 pose 分支现已改为「signal 优先、扁平回退」，故示例可直接只喂 `signal`。
- `setDeviceDataSource(id, src, contract?)` 已落，`contract` 存入 `contracts` Map。
- `runExternal` 按 `signal.kind` 分支推进 `item.distance`（pose 不推进，collectMoved 解算）；
  到达 path 末端调用 `handOffHeld` 交接给下游设备。
- `collectMoved` held 分支：pose 直读（local→world 变换）；其余走 `sampleSimPath(rt.path, distance)`。
- `handOffHeld` 顺带实现 **external→sim 反向收养**：下游为 sim 设备时 `item.held=false` 并
  `tryEnterTransport` 接入仿真（情况3→sim 段的真实物料回流已可用，无需额外"交接意图字段"）。
- 校验脚本：`scripts/externalSignals.harness.ts` + `tsconfig.harness.json`（CJS 编译后 node 运行）。

### 14.7 收尾清单

- [x] `setDeviceDataSource(id, src, contract?)` 增加可选 `contract: ExternalContract`。
- [x] `runExternal` 按 `signal.kind` 分支（pose / progress / entry / span）。
- [x] `collectMoved` 的 held 分支：非 pose 走 `sampleSimPath(rt.path, item.distance)`，仅 pose 直读。
- [x] 情况 1/2/4 的外部设备必须声明 `path`（验证：harness 用带 path 的 transport 设备驱动）。
- [x] headless 校验 entry/span/progress 三种 distance 推进 + pose local 变换 + external→sim 收养，10/10 通过。
- [ ] 示例加 4 段可切换外部车道（sim/hybrid 下拉切到对应 `signal`）肉眼验证 —— **下轮**，
      内核已实现，接线为纯示例层工作；当前 `ext-line` 仍是 pose-world 单车道演示。
- [x] `external→sim` 反向收养（见 §14.6，已随 `handOffHeld` 一并实现）。
- [x] 示例加 4 段可切换外部车道（`ext-pose`/`ext-progress`/`ext-entry`/`ext-span`），
      每条绑定一种 `signal` 契约 + leva 下拉热切换；`worldMode` 下拉统一切 sim/hybrid/external
      （**已实现**，见 §15）。headless 校验同步补到 12/12（含 signal-only pose 路径）。

## 15. 示例场景扩展 + UI 增强（**已实现**）

用户反馈「输送线太简单、不好展示功能」。本轮在 `VividFactoryConveyorExample.tsx` 大幅扩
充拓扑并强化交互面板，使四类外部数据契约与质检/分拣/不合格货架能力一眼可见。

### 15.1 扩展后的工厂拓扑（数据驱动，全由 defs 声明）
- **2 入料** `rack-a`(→teal-line) / `rack-b`(→green-line)。
- **合流分拣台 `junction-H`**：按 item type 路由 `parcel→purple-line` / `crate→blue-line`
  （蓝线直奔包装 sink）。
- **质检-1 `inspector-1`**：合格 `ok→trunk-A`，不合格 `ng→reject-line-1→reject-rack-1`
  （buffer，`onFull:"block"` + `drainAfter:12`）。
- **交替分拣台 `junction-S`**：`alternate{devices:[peach-line,yellow-line], interval:3}`。
- **质检-2 `inspector-2`**：合格 `ok→yellow-line-2`(sink-south) / 不合格 `ng→reject-line-2→reject-rack-2`。
- **4 条外部数字孪生车道**（见 §14）：`ext-pose`(默认 local) / `ext-progress` /
  `ext-entry` / `ext-span`，各自一段直带 + 专属 sink，默认全部 `dataSource:"external"`。

### 15.2 四信号车道接线（核心交付）
- `EXT_LANES` 配置表（id/sinkId/z/color/label/defaultKind/defaultFrame/cargoColorIndex/speed）。
- `EXT_LANE_GEOM`：每条车道预构建 `CatmullRomCurve3` + 弧长 `length` + item id 块
  （9001+ 区间），供合成 feed 复用，避免重复算路径。
- `feedLane(laneGeom, kind, frame, t)`：按 `kind` 合成 `ExternalItemState[]`：
  - `pose`：world 直接 `curve.getPointAt(u)`；local 喂 `(0,0,u*L,0)` 由仿真做 local→world；
  - `progress`：`signal:{progress:u}`；`entry`：`{tEnter:E}`；`span`：`{tEnter:E,tExit:E+travel}`。
- `externalFeeder`（`SimCargoLayer` 的 `useFrame` 钩子）：非 sim 模式时按 `sim.getElapsed()`
  喂 4 条车道；`worldMode==="sim"` 时空喂（展示「无数据」空线）。
- leva「数据模式」下拉 → `sim.setWorldMode` + 逐车道 `setDeviceDataSource(id, src, contract)`；
  每条车道独立 `signal` 下拉热切换契约（运行时 `effContract` 生效，前台零改动）。

### 15.3 UI 增强（展示能力，而非仅跑起来）
- **相机预设**：总览/入料/质检/分拣/包装/外部车道/出料 7 个一键视角（emoji 按钮）。
- **运行面板**：分流转接台插件热替换（`BUILTIN_DEVICE_PLUGINS` 切换，验证插件能力）、
  Speed、Spawn rate、Debug paths、暂停/继续。
- **外部车道面板**：4 条车道各一个 `signal` 下拉（pose/progress/entry/span）。
- **Telemetry HUD**（右上）：active/spawned/consumed/blocked、各 sink 吞吐、各质检台
  合格✓/不合格✗ 计数、各不合格货架 `stored/capacity` 填充、每条外部车道实时 item 数 + 当前
  `signal` 类型、当前 `worldMode` 说明。
- 标题卡说明「2 入料·2 分拣·2 质检+不合格货架·4 外部车道」与四信号含义。

### 15.4 验证
- `src` `tsc --noEmit` → exit 0；`src` + `examples/VividFactoryConveyorExample.tsx` 联合
  `tsc --noEmit` → exit 0。
- `scripts/externalSignals.harness.ts` 12/12（含 signal-only pose world/local 两条新用例）。
- 生产 `vite build examples` 仍受 Windows 侧缺 `@rollup/rollup-win32-x64-msvc` 限制，须在 WSL
  内 `npm run example:build` 做肉眼三模式 + 四车道切换确认（代码已具备能力，仅环境限制）。

> 注：其余示例文件（`AnimatedInstancesExample` 等）存在与本次无关的既有类型错误，
> 项目自带 `npm run typecheck` 仅覆盖 `src`，不在本次范围。
