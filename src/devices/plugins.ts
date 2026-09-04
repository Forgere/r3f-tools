import { BallTransferTable } from "./BallTransferTable";
import { LiftTransferUnit } from "./LiftTransferUnit";
import type { DeviceRendererPlugin, DeviceTheme } from "./types";

/**
 * Device kind for the divert/merge decks that sit at a conveyor
 * intersection. All plugins below render the same kind — that is the
 * replacement test.
 */
export const TRANSFER_KIND = "lift-transfer";

/** Pastel / toy-factory look: rounded edges, soft plastics. */
export const CUTE_THEME: DeviceTheme = {
	frame: "#E8E4DC",
	accent: "#C4B5E0",
	roller: "#D8D8D8",
	metal: "#B9BEC4",
	deck: "#F5F2EB",
	lightIdle: "#8BD3C7",
	lightActive: "#F4A261",
	cornerRadius: 0.035,
	roughness: 0.55,
	metalness: 0.12,
	detail: true,
};

/** Real-machine look: sharp edges, painted steel, orange safety accents. */
export const INDUSTRIAL_THEME: DeviceTheme = {
	frame: "#4A5259",
	accent: "#F0801E",
	roller: "#9AA3AA",
	metal: "#8D949B",
	deck: "#3B4248",
	lightIdle: "#5FD35F",
	lightActive: "#FFC53D",
	cornerRadius: 0.006,
	roughness: 0.42,
	metalness: 0.62,
	detail: false,
};

export interface LiftTransferPluginOptions {
	/** Device kind to bind to; defaults to `"lift-transfer"`. */
	kind?: string;
	label?: string;
	description?: string;
	theme?: DeviceTheme;
}

/**
 * Builds a renderer plugin for the lift-and-transfer deck, so the same
 * component can be published under different looks without duplicating it.
 */
export function createLiftTransferPlugin({
	kind = TRANSFER_KIND,
	label = "顶升移栽 Lift & Transfer",
	description = "与输送线同宽的滚筒台，滚筒间的小传动轴顶升后横向移栽",
	theme = CUTE_THEME,
}: LiftTransferPluginOptions = {}): DeviceRendererPlugin {
	return {
		kind,
		label,
		description,
		defaultTheme: theme,
		Component: LiftTransferUnit,
	};
}

/** Default pastel lift-and-transfer deck. */
export const cuteLiftTransferPlugin = createLiftTransferPlugin({});

/** Same machine in an industrial finish. */
export const industrialLiftTransferPlugin = createLiftTransferPlugin({
	label: "顶升移栽 · 工业版",
	description: "同型号设备的工业涂装版本（锐边/金属漆）",
	theme: INDUSTRIAL_THEME,
});

/**
 * A completely different machine registered under the same kind: pushing the
 * load over a ball table instead of lifting it. Swapping to this plugin
 * changes the mechanism, the animation and the geometry while the layout,
 * routing table and simulation stay exactly the same.
 */
export const ballTransferTablePlugin: DeviceRendererPlugin = {
	kind: TRANSFER_KIND,
	label: "万向球台 Ball Table",
	description: "对比插件：无顶升机构，靠推杆在万向球台上换向",
	defaultTheme: CUTE_THEME,
	Component: BallTransferTable,
};

/** All bundled presets, in the order a UI picker should show them. */
export const BUILTIN_DEVICE_PLUGINS: DeviceRendererPlugin[] = [
	cuteLiftTransferPlugin,
	industrialLiftTransferPlugin,
	ballTransferTablePlugin,
];
