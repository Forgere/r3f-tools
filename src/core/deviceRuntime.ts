import type { DevicePluginRegistry } from "./devicePluginRegistry";
import type { TrackGraph } from "./trackGraph";
import type {
	DeviceState,
	DeviceTransferDecision,
	MaterialReference,
} from "./types";

/**
 * Owns mutable device state and executes device-plugin behaviour.
 *
 * Callers only need to advance time with `tick()` and request an explicit
 * transfer through a graph hand-off. Device-specific sensor, capacity, PLC,
 * or sorting logic remains behind the DevicePlugin seam.
 */
export class DeviceRuntime {
	private readonly states = new Map<string, DeviceState>();

	constructor(
		private readonly graph: TrackGraph,
		private readonly plugins: DevicePluginRegistry,
	) {
		for (const device of graph.deviceList) {
			this.states.set(device.id, plugins.createInitialState(device));
		}
	}

	getState(deviceId: string): DeviceState | undefined {
		return this.states.get(deviceId);
	}

	setRunning(deviceId: string, running: boolean): void {
		const state = this.requireState(deviceId);
		state.running = running;
	}

	setSpeed(deviceId: string, speed: number): void {
		if (!Number.isFinite(speed) || speed < 0) {
			throw new Error(
				"DeviceRuntime: speed must be a finite non-negative number",
			);
		}
		this.requireState(deviceId).speed = speed;
	}

	fault(deviceId: string, reason: string): void {
		const state = this.requireState(deviceId);
		state.faulted = true;
		state.faultReason = reason;
	}

	resetFault(deviceId: string): void {
		const state = this.requireState(deviceId);
		state.faulted = false;
		state.faultReason = undefined;
		this.plugins.resetDevice(deviceId);
	}

	tick(delta: number): void {
		if (!Number.isFinite(delta) || delta < 0) {
			throw new Error(
				"DeviceRuntime: delta must be a finite non-negative number",
			);
		}
		for (const device of this.graph.deviceList) {
			const state = this.requireState(device.id);
			this.plugins.tick({ device, state, delta });
		}
	}

	/**
	 * Attempts a material transfer at a declared hand-off node. The receiving
	 * device has final acceptance authority; sender and receiver remain
	 * independently faulted/stopped even where their geometry meets.
	 */
	transfer(
		handoffNodeId: string,
		material: MaterialReference,
	): DeviceTransferDecision {
		const node = this.graph.getNode(handoffNodeId);
		if (!node?.handoff) {
			throw new Error(
				`DeviceRuntime: node "${handoffNodeId}" is not a device hand-off`,
			);
		}

		const { handoff } = node;
		const fromDevice = this.graph.getDevice(handoff.fromDeviceId);
		const toDevice = this.graph.getDevice(handoff.toDeviceId);
		if (!fromDevice || !toDevice) {
			throw new Error(
				`DeviceRuntime: hand-off "${handoffNodeId}" references an unknown device`,
			);
		}

		const fromState = this.requireState(fromDevice.id);
		const toState = this.requireState(toDevice.id);
		if (fromState.faulted || !fromState.running) {
			return {
				accepted: false,
				reason: fromState.faultReason ?? "Sending device is stopped",
			};
		}
		if (handoff.readyToReceive === false) {
			return { accepted: false, reason: "Receiving device is not ready" };
		}

		const decision = this.plugins.canReceive({
			device: toDevice,
			state: toState,
			fromDeviceId: fromDevice.id,
			material,
			handoff,
		});
		if (!decision.accepted) return decision;

		this.plugins.notifyMaterialTransferred({
			device: toDevice,
			state: toState,
			fromDeviceId: fromDevice.id,
			toDeviceId: toDevice.id,
			material,
			handoff,
		});
		return decision;
	}

	private requireState(deviceId: string): DeviceState {
		const state = this.states.get(deviceId);
		if (!state) {
			throw new Error(`DeviceRuntime: unknown device "${deviceId}"`);
		}
		return state;
	}
}
