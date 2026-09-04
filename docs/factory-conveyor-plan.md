# 工厂输送线组件库 —— 可执行计划

> 目标：把 `r3f-tools` 从"通用 R3F 性能工具集"扩展为一套面向**数字工厂/物流仿真**的搭建套件。
> 核心比喻：输送线之于工厂场景，等价于 `<Button/>` 之于前端 UI —— 是最小可组合、可复用、可插拔的"零件"。

---

## 0. 现状盘点（已具备的地基）

| 已有能力 | 文件 | 可复用点 |
|---|---|---|
| 大规模实例化渲染 | [InstanceMeshPool.tsx](/home/zhangwei/r3f-tools/src/components/InstanceMeshPool.tsx) | 滚筒、支架、护栏等重复几何体的高性能渲染 |
| 单曲线输送线 | [ConveyorBelt.tsx](/home/zhangwei/r3f-tools/src/components/ConveyorBelt.tsx) | 已实现"沿 CatmullRom 曲线摆放滚筒+方向箭头"，是"直线段/弯道段"的雏形 |
| 路径动画 | [moveAlongPath.ts](/home/zhangwei/r3f-tools/src/utils/moveAlongPath.ts) | 物料沿输送线运动的动画引擎（GSAP + MotionPathPlugin） |
| GSAP 动画封装 | [gsapAnimator.ts](/home/zhangwei/r3f-tools/src/utils/gsapAnimator.ts) | 队列式/连续式动画，可用于物料生命周期动画 |

**结论**：现有代码只覆盖"单段、单曲线"输送线。要支持"多层、交叉、螺旋"，必须先引入**图结构（Track Graph）**把"一段段输送线"组织成"网络"，而不是各画各的。这是本次计划的核心架构变更。

---

## 1. 调研结论（方案选型）

### 1.1 参考同类产品做法
- **FlexSim / Plant Simulation / AnyLogic**：输送线建模都采用「Segment（分段）+ Port（端口）+ Graph（拓扑）」三层模型，每个 Segment 只关心自己的局部几何（长度、曲率、坡度），拼接靠 Port 对齐。
- **游戏行业（Factorio/Satisfactory）**：传送带是"网格自动吸附 + 只有几种标准转角/坡道/分流件"，靠**有限种类的预制段 + 自动拼接算法**做到"看似自由，实则规则可控"，这是保证 3D 场景不穿模、可编辑器化的关键经验，值得借鉴。
- **参考图（MICRODUCK 网站）风格**：卡片式面板、圆角、低饱和莫兰迪色、手绘箭头/图标点缀、右侧堆叠功能卡片（Moves·Poses / Paint Lab / Routine Builder）。这套视觉语言可以直接映射成我们"输送线编辑器"的 UI：左侧场景 Canvas + 右侧浮动卡片式控制面板（分段库、外观库、线路编排器）。

### 1.2 关键技术方案
1. **拓扑层**：`TrackGraph`（节点 = 关键点/交汇点，边 = TrackSegment），与几何渲染解耦，方便做多层、交叉、合流/分流的路径规划与碰撞检测。
   - **设备归属与行为（重要）**：两条在空间上交叉的输送线，很可能属于**不同设备**（不同 PLC/厂商/维护责任方），不能仅靠几何 `layer` 区分。每条 `TrackEdge` 携带 `deviceId`；设备定义 `DeviceDefinition`（`id`、`kind`、持久化配置）与运行态 `DeviceState`（运行/速度/故障）分离，确保相互独立。`kind` 通过 `DevicePluginRegistry` 选择设备插件：例如滚筒线只检查启停状态，分拣机还要检查目标格口，升降机要检查轿厢高度与互锁。
   - **交叉点必须区分两类**：无连接的几何交叉只是不同 `layer` 的视觉关系，绝不创建图节点；真正的设备间交接点才创建 `handoff: { fromDeviceId, toDeviceId }`。物料跨越 handoff 前由接收设备插件的 `canReceive()` 决策（可基于满载、传感器、PLC 互锁等规则）；未声明 handoff 的跨设备连接由 `validate()` 报错。
2. **几何层**：`SegmentKind` 插件化 —— `straight | curve | spiral(helix) | incline | merge | diverge | turnLift`，每种是一个"几何生成器 + 实例化摆放策略"，都基于统一的 `SegmentContext`（起止 Pose、长度、曲率参数）产出 `{ curve: THREE.Curve, transforms: Matrix4[] }`。
3. **交叉/多层**：本质是拓扑层的 3D 坐标问题——允许两条 Track 在 XZ 投影相交但 Y 不同（立体交叉），编辑器里用"层级 Layer + 高亮层过滤"辅助可视化，避免误连接。
4. **螺旋输送线**：新增 `HelixCurve` 生成器（复用 three.js 无内置 HelixCurve，需要基于参数方程手写 `getPoint`，遵循 `THREE.Curve` 接口，这样可以直接喂给现有 `ConveyorBelt` 的 `curvePath`/曲线管线，最大化复用）。
5. **插件系统（借鉴"dsh"式降级思路）**：
   - 每个可插拔单元（自定义 Segment 渲染器、自定义物料 Prefab、自定义交互行为）注册时包一层 **PluginBoundary**（类似 React ErrorBoundary + 熔断器）。
   - 插件执行 `render()/onTick()` 抛错或超时 → 捕获异常、记录一次失败计数 → 自动**降级（fallback）为内置基础组件**（例如自定义花纹滚筒渲染失败 → 回退成默认灰色滚筒几何），并给出可订阅的 `onPluginDegraded` 事件，供上层 UI 提示"该插件已降级"。
   - 连续失败 N 次自动拉黑该插件本次会话内不再重试，避免每帧重复报错拖垃圾性能（工厂场景通常几千个实例，单插件异常不能拖死整个场景）。
   - **熔断粒度按 `deviceId` 隔离**：某设备插件异常时，只降级该设备到内置 `basic-device` 行为，不能因为几何上交叉/共享 handoff 节点而"拖累"归属不同设备的另一条线。`DevicePluginRegistry` 已实现同步行为异常的设备级降级与 `onPluginDegraded` 通知；逐帧行为与渲染插件会在 Phase 3 统一接入同一策略。
6. **交互优化**：编辑态支持
   - 拖拽关键点、吸附（snap to grid / snap to port）
   - 分段类型热切换（弯道半径、螺旋圈数等参数面板，实时预览）
   - 多选、复制、镜像
   - "路径合法性"实时校验（曲率是否超过物料最大转弯半径、坡度是否超限）

---

## 2. 目标架构总览

```
src/
  core/                         # 新增：与渲染无关的拓扑与几何算法
    trackGraph.ts               # TrackGraph 数据结构 + 图算法（最短路、环检测、层级）
    segmentGeometry/
      straight.ts
      curve.ts
      helix.ts                  # 螺旋
      incline.ts                # 坡道
      merge.ts / diverge.ts     # 合流/分流
      types.ts                  # SegmentKind、SegmentContext、Pose 等公共类型
    devicePluginRegistry.ts     # 设备行为插件 + 每设备熔断/基础行为回退
    pluginSystem/
      PluginBoundary.ts         # 渲染/逐帧插件的熔断 + 降级核心逻辑
      pluginRegistry.ts         # 分段/物料插件注册表
  components/
    InstanceMeshPool.tsx        # 已有，保留
    ConveyorBelt.tsx            # 已有，重构为"单段渲染器"，被 TrackRenderer 复用
    TrackRenderer.tsx           # 新增：读 TrackGraph -> 渲染所有 segment（多层/交叉/螺旋统一入口）
    TrackEditor/                # 新增：可视化编辑器（拖拽关键点、面板）
      TrackEditorCanvas.tsx
      TrackEditorPanel.tsx      # 参考图风格的卡片式 UI
      hooks/useTrackEditor.ts
    MaterialFlow.tsx            # 新增：物料沿 TrackGraph 批量运动（复用 moveAlongPath + InstancedMeshPool）
  utils/
    gsapAnimator.ts             # 已有
    moveAlongPath.ts            # 已有，扩展支持"沿 Graph 路径"而不只是"点数组"
  index.ts                      # 补充新导出
```

---

## 3. 分阶段执行计划（每阶段可独立验收）

### 当前完成度与下一轮优先级（2026-09-04）

当前库已经具备“可表达、可渲染、可移动”的最小工厂骨架，而非完整的生产级工厂搭建器：

| 能力 | 状态 | 已有成果 | 距离生动复杂工厂的缺口 |
|---|---|---|---|
| 拓扑与设备归属 | 已完成 | `TrackGraph`、设备独立状态、显式 handoff | 缺少布局持久化格式、版本迁移和撤销/重做 |
| 基础输送线 | 已完成 | 直线、曲线、坡道、螺旋；编辑器同款滚筒/双侧框架；`showPath`/`showRollers` | 缺少护栏、支腿、驱动端、端盖、物料感应器等细节模型 |
| 同平面十字转运 | 已完成 | `CrossTransferTable`；货物可直通东侧或换路北侧 | 转运台尚未有真实的“动作状态”（旋转/推送/锁定）和队列容量 |
| 立体转运 | 已完成（基础模型） | `VerticalLift`，内部路径隐藏但参与路由 | 缺少升降动画、到位互锁、上下游队列和安全门 |
| 设备插件与回退 | 已完成（同步异常） | 设备/几何插件、按 `deviceId` 隔离、基础模型回退 | 缺少失败窗口阈值、异步错误处理、插件版本/能力声明与可视化诊断 |
| 物料流 | 已完成（基础） | `MaterialFlow`、多段路由、handoff 接收判定、实例化货箱 | 缺少货物间距/碰撞、堆积队列、WIP 统计、分拣规则和循环路径支持 |
| 编辑器 | 未开始 | 仅有示例面板和既有单线编辑示例 | 缺少图形化建模、吸附、选择、参数编辑、撤销、保存和导入导出 |
| 可视化与可观测性 | 起步 | 路径/滚筒开关、设备筛选、插件降级提示 | 缺少设备状态颜色、传感器、故障告警、吞吐量/FPS/WIP 面板与时间轴 |
| 性能与质量 | 起步 | 共享滚筒实例池、TypeScript/构建/浏览器走查 | 缺少 2,000+ 滚筒基准、TS 单测运行器、内存/资源释放检查 |

#### 要构建“生动复杂的输送线工厂”，下一步应按此顺序实施

1. **转运设备行为深化（最高优先级）**  
   实现 `CrossTransferTable` 的状态机：`idle → receiving → routing-through/routing-divert → releasing → faulted`，包含容量 1、入口/出口占用、等待队列和可动画的推送/旋转部件。让“直通/换路”不仅由终点拓扑决定，也能在视觉和运行状态上被观察与控制。
2. **物料调度与现场真实性**  
   在 `MaterialFlow` 加入最小安全间距、分段占用、排队、WIP（在制品）计数与完成事件；支持 `DevicePlugin` 依据货物 metadata（订单、目的地、优先级）动态决定分流。没有这一层，多货物场景会视觉穿透，无法表达真实产线节拍。
3. **设备库扩展**  
   把默认模型发展为可组合设备：分流器、合流器、90 度转弯台、缓存线、扫码器、挡停器、顶升移载机、螺旋提升机。每个设备须同时提供：端口定义、内部路由、默认视觉模型、运行状态和基础插件。
4. **图形化工厂编辑器**  
   建立 `TrackEditor`：网格/端口吸附、设备放置、连线、节点选择、属性面板、按层/设备筛选、撤销重做、JSON 保存与加载。交互外壳沿用参考图的卡片式风格，但核心编辑模型必须直接操作 `TrackGraph`，避免出现第二套数据源。
5. **生动的视觉与交互反馈**  
   增加滚筒/皮带运动、顶升/分拣动画、货物类型外观、流向粒子、占用/阻塞/故障颜色、传感器指示灯，以及设备悬停卡片。让使用者能一眼看出物料“在哪里、为什么等待、将去哪里”。
6. **复杂拓扑与可靠性**  
   支持多入口合流的仲裁策略、循环线和死锁检测、路径重规划、跨设备协议超时、插件熔断滑动窗口及恢复操作。此阶段也应明确插件异步执行与 Worker 隔离策略。
7. **性能与测试门槛**  
   配置 TypeScript 测试运行器；为拓扑、路由、handoff、设备状态机、插件降级写自动化测试。建立 2,000/10,000 滚筒和数百货物的 FPS、draw call、内存基准；对可见/隐藏设备切换进行资源释放验证。

### Phase 1 — 拓扑与几何地基（不改变现有对外 API）
- [x] 设计并实现 `TrackGraph`：`addNode/addEdge/getPath/validate`，支持给边打 `layer`（层号，用于多层場景 Y 分层）与 `kind`；**边同时携带 `deviceId`**，`TrackGraph` 维护 `DeviceState`（独立运行/速度/故障态），`validate()` 检测未声明 `handoff` 的跨设备连接。已在 [trackGraph.ts](/home/zhangwei/r3f-tools/src/core/trackGraph.ts) 落地，`getPath`/`pathCrossesDevices` 已通过手动验证（BFS 路径 + 跨设备判定 + 环检测）。
- [ ] 抽出 `SegmentContext`/`Pose` 类型（已完成，见 [types.ts](/home/zhangwei/r3f-tools/src/core/types.ts)），把 `ConveyorBelt` 内部曲线生成逻辑拆成 `segmentGeometry/curve.ts` 里的纯函数，`ConveyorBelt` 改为调用它（保证现有 examples 不回归）——**尚未接入 `ConveyorBelt`，仍是待办**。
- [x] 新增 `segmentGeometry/helix.ts`：实现 `HelixCurve extends THREE.Curve`，参数：半径、螺距（每圈上升高度）、圈数、方向（左旋/右旋）。节点 `Pose` 是几何的硬约束：生成器保持起始水平方向，并把理论末端到 `end.position` 的差值沿曲线均匀分配，避免图拓扑与实际几何脱节。构建产物数值验证：起点误差 `0`，终点误差约 `1e-15`。
- [x] 新增 `segmentGeometry/incline.ts`（直线坡道，起止高度差 + 长度）。
- [ ] 单元测试（Jest）：仓库当前**未配置 ts-jest/babel**，`npm run test` 对 TS 文件会直接失败（与本次改动无关的既有缺口）。已用一次性 Node 脚本对 `TrackGraph`/`generateSegmentGeometry`/`HelixCurve` 做了手动验证（构建后 import dist 产物运行），结果符合预期，但**尚未固化为可重复运行的自动化测试**——需要先补 Jest 的 TS 支持才能落地这一条。

**验收现状**：`npm run typecheck && npm run lint && npm run build` 全部通过；新增的 `core/` 模块已通过 `index.ts` 导出。`examples/HelixConveyorExample.tsx` 尚未创建。

### Phase 2 — 多段拼接渲染（TrackRenderer）
- [x] `TrackRenderer`：输入 `TrackGraph`，遍历所有 edge，按 `kind` 分发到对应几何生成器，产出统一的滚筒实例数据，一次性喂给共享的 `InstancedMeshPool`（跨 segment 合批，避免 drawcall 爆炸）。**默认模型采用 `EditableConveyorBeltExample` 的画法**：滚筒床配合沿每段左右偏移路径挤出的深色金属框架；`showFrames` 默认为 `true`。已支持按 `visibleDeviceIds`、`visibleLayers` 独立筛选；路径线可作为编辑/调试辅助显示。框架当前按分段生成，护栏/框架跨段合批与设备外观插件将在渲染插件阶段完成。
- [x] 设备运行时：`DeviceRuntime` 维护每台设备独立的运行/速度/故障态，执行 `DevicePlugin.onTick()`，并只在声明的 handoff 节点执行转交。接收设备用 `canReceive()` 表达容量、互锁、传感器、分拣目标等差异化行为；异常设备插件按设备 ID 回退，互不影响。
- [ ] 交叉场景处理：不同 `layer` 的 edge 用 Y 偏移隔离；渲染层加"层级高亮/半透明"辅助排查穿插。
- [ ] 合流/分流节点几何（三通滚筒床 / Y 形分支）。
- [ ] 性能基准：2000+ 滚筒场景下保持 60fps（在 examples 里加一个压力测试场景）。

**验收现状**：[FactoryLayoutExample.tsx](/home/zhangwei/r3f-tools/examples/FactoryLayoutExample.tsx) 展示同一水平面的十字转运：裸露 `infeed`、`outfeed` 与 `sorter` 都在中央 `cross-transfer` 的端口终止；`CrossTransferTable` 填补交叉区域。设备内部两条 `visible: false` 路线分别实现向东直通和转向北侧，货物根据终点选择路线，并在每次 handoff 时由设备状态控制。示例中蓝色货箱直通东侧、橙色货箱换路北侧。`VerticalLift` 仍作为独立的可复用默认设备模型。场景也包含螺旋，并可按设备独立隐藏。

### Phase 3 — 插件系统（含降级机制）
- [x] 定义两类插件 seam：`DevicePlugin` 用于设备运行行为（接收、交接、tick），`SegmentPlugin` 用于自定义分段几何；二者都保持小接口，把复杂 PLC/传感器/模型规则放入实现内部。
- [x] 实现设备级熔断：`DevicePluginRegistry` 与 `SegmentPluginRegistry` 用 `try/catch` 包裹插件调用；触发异常后仅将该 `deviceId` 回退（设备行为回退到 `basic-device`，分段几何回退为内置直线段），并通过 `onPluginDegraded` 报告。
- [x] `TrackRenderer` 接受 `segmentPlugins`，优先用已注册的 `SegmentPlugin`；没有插件则使用内置 `SegmentKind` 生成器。
- [x] [FactoryLayoutExample.tsx](/home/zhangwei/r3f-tools/examples/FactoryLayoutExample.tsx) 注册了一个故意抛错的 `faulty-roller-extension` 插件。它仅使 `infeed` 设备回退为基础直线段，控制台输出降级事件，页面卡片在提交后显示降级状态；分拣与螺旋设备不受影响。

**验收现状**：插件抛错时场景不崩溃、自动换回默认基础段，控制台/回调能明确报告受影响设备；示例中可验证其他设备继续渲染。失败计数滑动窗口尚未实现，当前是首次同步异常即在本会话内熔断该设备。

### Phase 4 — 编辑器交互（视觉对齐参考图）
- [ ] `TrackEditorCanvas`：Canvas 内支持
  - 点击空白新增关键点、拖拽移动关键点（吸附网格/吸附已有端口）
  - 选中 edge 后可切换 `kind`（直线/弯道/螺旋/坡道）并在侧边面板实时改参数
  - 框选、复制、镜像、删除
- [ ] `TrackEditorPanel`（视觉参考 MICRODUCK 截图）：
  - 卡片式圆角面板、莫兰迪配色，右侧堆叠三张卡片：
    1. **Segment Library**（对应 "Moves·Poses"）：预制分段图标网格，点击即"手持"待放置分段
    2. **Style Lab**（对应 "Paint Lab"）：外观/材质配色选择（滚筒颜色、护栏材质、箭头速度）
    3. **Route Builder**（对应 "Routine Builder"）：当前线路的分段列表，可拖拽排序、显示每段长度/预计通过时间
  - 顶部信息条：实例数、帧率、当前层级切换器
- [ ] 手绘风格小图标/箭头素材（SVG，轻量，无需 3D 建模）。

**验收**：可视化走查 + 一份简短交互演示 GIF/说明。

### Phase 5 — 物料流与联调
- [x] 新增 `resolveTrackRoute(graph, startNodeId, endNodeId)`：自动拼接多段曲线，并在不同 `deviceId` 之间强制检查匹配的 `handoff`；原有 `moveAlongPath` API 保持不变，避免破坏现有调用方。
- [x] 新增 `MaterialFlow`：批量箱子/托盘沿解析路线运动，基于 `InstancedMeshPool` 批量更新位置/朝向。每段按所属 `DeviceRuntime` 的运行、故障和速度状态驱动；到达 handoff 时调用 `DeviceRuntime.transfer()`，接收拒绝则只暂停对应物料。
- [ ] 端到端示例：一个"多层螺旋+交叉分流"的迷你工厂，物料从入口跑到出口，插件降级 Demo 一并展示。

**验收**：`examples/` 下有完整可运行 Demo，README 补充章节说明新架构与使用方式。

### Phase 6 — 收尾
- [ ] `README.md` 增补：架构图（文字版即可）、API 参考、插件开发指南、降级机制说明。
- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` 全绿。
- [ ] 语义化版本：作为 Breaking/Minor 视对外 API 变化程度打 tag（`ConveyorBelt` 保持向后兼容则可 Minor）。

---

## 4. 风险与取舍
- **拓扑重构范围较大**：Phase 1 刻意要求"不改变现有对外 API"，`ConveyorBelt` 只做内部实现抽取，先跑通再迁移，降低回归风险。
- **性能**：多段合批渲染是重点，如果按段各自建 `InstancedMesh` 会导致 drawcall 线性增长，必须在 Phase 2 就做"跨段共享实例池"。
- **插件安全边界**：插件运行在同一 JS 线程，`PluginBoundary` 只能做"同步异常捕获 + 熔断"，无法阻止死循环卡死主线程；如未来需要更强隔离，可考虑 Worker 化，本计划先不做（超出当前范围，按需求再评估）。
- **视觉资源**：参考图是手绘风格，如果没有对应的图标资源，Phase 4 先用几何图形/emoji 占位，后续再让设计补齐真实素材。

---

## 5. 下一步
请确认：
1. 是否按此 6 阶段顺序推进，还是希望先做 Phase 1+2（地基+多层交叉）验证效果，再决定要不要做插件系统和编辑器 UI？
2. 编辑器 UI（Phase 4）是否要用 HTML/CSS（drei `Html`浮层）实现，还是希望做成独立的 React 应用外壳？

确认后我会从 Phase 1 开始落地代码。
