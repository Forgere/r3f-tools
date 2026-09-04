import { generateStraight } from "./segmentCurves";
import type {
	SegmentContext,
	SegmentGeometryResult,
	SegmentKind,
} from "./types";

export interface SegmentPlugin {
	kind: SegmentKind;
	generateGeometry: (context: SegmentContext) => SegmentGeometryResult;
}

export interface SegmentPluginDegradedEvent {
	deviceId: string;
	plugin: SegmentPlugin;
	error: unknown;
}

export interface SegmentPluginRegistryOptions {
	onPluginDegraded?: (event: SegmentPluginDegradedEvent) => void;
}

/**
 * Resolves custom segment geometry with device-scoped circuit breaking.
 *
 * A geometry plugin can serve several device kinds, but a failure is held
 * against only the physical/logical device that invoked it. This prevents a
 * failed sorter extension from degrading an unrelated crossing conveyor.
 */
export class SegmentPluginRegistry {
	private readonly plugins = new Map<string, SegmentPlugin>();
	private readonly degradedDeviceIds = new Set<string>();

	constructor(private readonly options: SegmentPluginRegistryOptions = {}) {}

	register(plugin: SegmentPlugin): void {
		this.plugins.set(plugin.kind, plugin);
	}

	unregister(kind: SegmentKind): void {
		this.plugins.delete(kind);
	}

	isDegraded(deviceId: string): boolean {
		return this.degradedDeviceIds.has(deviceId);
	}

	resetDevice(deviceId: string): void {
		this.degradedDeviceIds.delete(deviceId);
	}

	generate(
		deviceId: string,
		context: SegmentContext,
	): SegmentGeometryResult | undefined {
		if (this.degradedDeviceIds.has(deviceId)) return generateStraight(context);

		const plugin = this.plugins.get(context.kind);
		if (!plugin) return undefined;

		try {
			return plugin.generateGeometry(context);
		} catch (error) {
			this.degradedDeviceIds.add(deviceId);
			this.options.onPluginDegraded?.({ deviceId, plugin, error });
			return generateStraight(context);
		}
	}
}
