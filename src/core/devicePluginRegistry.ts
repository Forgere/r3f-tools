import type {
	DeviceDefinition,
	DevicePlugin,
	DeviceReceiveContext,
	DeviceState,
	DeviceTickContext,
	DeviceTransferContext,
	DeviceTransferDecision,
} from "./types";

export interface DevicePluginDegradedEvent {
	device: DeviceDefinition;
	plugin: DevicePlugin;
	error: unknown;
}

export interface DevicePluginRegistryOptions {
	onPluginDegraded?: (event: DevicePluginDegradedEvent) => void;
}

function basicCanReceive({
	state,
}: DeviceReceiveContext): DeviceTransferDecision {
	if (state.faulted) {
		return { accepted: false, reason: state.faultReason ?? "Device faulted" };
	}
	if (!state.running) {
		return { accepted: false, reason: "Device is stopped" };
	}
	return { accepted: true };
}

const basicDevicePlugin: DevicePlugin = {
	kind: "basic-device",
	canReceive: basicCanReceive,
};

/**
 * Resolves device-specific behaviour from a compact plugin interface.
 *
 * A failed plugin is degraded per device id, not per plugin kind. Two
 * crossing conveyors can use the same plugin but still retain independent
 * failure domains. The affected device subsequently uses the built-in
 * stopped/faulted checks, while all other devices retain their plugin.
 */
export class DevicePluginRegistry {
	private readonly plugins = new Map<string, DevicePlugin>();
	private readonly degradedDeviceIds = new Set<string>();

	constructor(private readonly options: DevicePluginRegistryOptions = {}) {}

	register(plugin: DevicePlugin): void {
		if (plugin.kind === basicDevicePlugin.kind) {
			throw new Error(`"${basicDevicePlugin.kind}" is reserved`);
		}
		this.plugins.set(plugin.kind, plugin);
	}

	unregister(kind: string): void {
		this.plugins.delete(kind);
	}

	isDegraded(deviceId: string): boolean {
		return this.degradedDeviceIds.has(deviceId);
	}

	resetDevice(deviceId: string): void {
		this.degradedDeviceIds.delete(deviceId);
	}

	createInitialState(device: DeviceDefinition): DeviceState {
		const plugin = this.resolve(device);
		const defaults = this.invoke(
			device,
			plugin,
			() => plugin.createInitialState?.(device) ?? {},
			{},
		);

		return {
			id: device.id,
			running: true,
			speed: 1,
			faulted: false,
			...defaults,
			...device.initialState,
		};
	}

	canReceive(context: DeviceReceiveContext): DeviceTransferDecision {
		const plugin = this.resolve(context.device);
		return this.invoke(
			context.device,
			plugin,
			() => plugin.canReceive?.(context) ?? basicCanReceive(context),
			basicCanReceive(context),
		);
	}

	notifyMaterialTransferred(context: DeviceTransferContext): void {
		const plugin = this.resolve(context.device);
		this.invoke(
			context.device,
			plugin,
			() => plugin.onMaterialTransferred?.(context),
			undefined,
		);
	}

	tick(context: DeviceTickContext): void {
		const plugin = this.resolve(context.device);
		this.invoke(
			context.device,
			plugin,
			() => plugin.onTick?.(context),
			undefined,
		);
	}

	private resolve(device: DeviceDefinition): DevicePlugin {
		if (this.degradedDeviceIds.has(device.id)) return basicDevicePlugin;
		return this.plugins.get(device.kind) ?? basicDevicePlugin;
	}

	private invoke<T>(
		device: DeviceDefinition,
		plugin: DevicePlugin,
		operation: () => T,
		fallback: T,
	): T {
		try {
			return operation();
		} catch (error) {
			if (plugin !== basicDevicePlugin) {
				this.degradedDeviceIds.add(device.id);
				this.options.onPluginDegraded?.({ device, plugin, error });
			}
			return fallback;
		}
	}
}
