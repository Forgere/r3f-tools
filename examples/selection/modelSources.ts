/**
 * 设备 kind → 渲染组件定义/注册位置 登记表。
 *
 * Vite 插件 `scripts/modelSourcePlugin.mjs` 会自动给 <Selectable /> 与
 * <DeviceRendererHost /> 注入 mountedAt，本表只关心前两层：
 *   - file:line        组件定义处（设备 React 组件）
 *   - registeredAt    注册进 DeviceRendererRegistry 的位置
 *
 * 新增设备只需在这里加一行；行号以 `git grep -n "^export function" src/devices`
 * 与 plugins.ts 中 `export const ...Plugin` 的实际行为准。
 */
import {
	registerModelSources,
} from "./modelSource";

registerModelSources([
	{
		kind: "lift-transfer",
		component: "LiftTransferUnit",
		file: "src/devices/LiftTransferUnit.tsx",
		line: 72,
		registeredAt: "src/devices/plugins.ts:73",
		label: "升降移栽 Lift Transfer",
		notes:
			"默认插件 cuteLiftTransferPlugin —— 顶升式换向；BUILTIN_DEVICE_PLUGINS 中第 1 个。",
	},
	{
		kind: "lift-transfer-alt",
		component: "BallTransferTable",
		file: "src/devices/BallTransferTable.tsx",
		line: 29,
		registeredAt: "src/devices/plugins.ts:88",
		label: "万向球台对比插件 Ball Table",
		notes: "对比插件：推杆在万向球台上换向，无顶升；可作主题切换示例。",
	},
	{
		kind: "inspector",
		component: "CuteInspectionStation",
		file: "src/devices/CuteInspectionStation.tsx",
		line: 43,
		registeredAt: "src/devices/plugins.ts:113",
		label: "检查站台 Inspection",
		notes: "扫描判定合格/不合格并驱动分流灯。",
	},
	{
		kind: "buffer",
		component: "CuteRejectRack",
		file: "src/devices/CuteRejectRack.tsx",
		line: 29,
		registeredAt: "src/devices/plugins.ts:122",
		label: "不合格货架 Reject Rack",
		notes: "栅格堆放不合格货物；满载时告警灯闪烁。",
	},
	{
		kind: "over-under",
		component: "CuteOverUnderPass",
		file: "src/devices/CuteOverUnderPass.tsx",
		line: 16,
		registeredAt: "src/devices/plugins.ts:132",
		label: "跨线桥 Over-under",
		notes: "输送线交叉/重叠处的跨线桥，替代穿模部位。",
	},
]);