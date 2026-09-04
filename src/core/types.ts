import type * as THREE from "three";

/**
 * A position + orientation in 3D space, used to describe where a track
 * segment starts/ends so segments can be chained together.
 */
export interface Pose {
	position: THREE.Vector3;
	/** Forward tangent direction (normalized). */
	tangent: THREE.Vector3;
	/** Up vector, used to resolve roll for helix/incline segments. */
	up: THREE.Vector3;
}

/** The kind of geometry generator a track edge should use. */
export type SegmentKind =
	| "straight"
	| "curve"
	| "helix"
	| "incline"
	| "merge"
	| "diverge"
	| (string & {});

/**
 * Parameters specific to each SegmentKind. Only the fields relevant to the
 * chosen `kind` need to be supplied; generators apply sane defaults.
 */
export interface SegmentParams {
	/** Number of points/segments used to sample the resulting curve. */
	resolution?: number;
	/** Radius of curvature, used by "curve" and "helix". */
	radius?: number;
	/** Number of full turns, used by "helix". */
	turns?: number;
	/** Total height gained across the segment, used by "helix" and "incline". */
	height?: number;
	/** Winding direction for "helix": 1 = counter-clockwise, -1 = clockwise. */
	direction?: 1 | -1;
	/** Arbitrary extra data plugins may read. */
	[key: string]: unknown;
}

/** Context passed to a segment geometry generator. */
export interface SegmentContext {
	kind: SegmentKind;
	start: Pose;
	end: Pose;
	params: SegmentParams;
}

/** Output of a segment geometry generator: a sampleable curve plus metadata. */
export interface SegmentGeometryResult {
	curve: THREE.Curve<THREE.Vector3>;
	length: number;
}

export type SegmentGeometryGenerator = (
	ctx: SegmentContext,
) => SegmentGeometryResult;

/**
 * A physical/logical device that owns one or more track segments.
 *
 * Two conveyor lines that cross in space are not necessarily the same
 * machine — they may belong to different PLCs, vendors, or maintenance
 * owners, and must be able to start/stop, change speed, or fault
 * independently even while sharing a geometric intersection or a hand-off
 * node. `deviceId` on a `TrackEdge` records that ownership so rendering
 * batches, plugin fault isolation, and editor grouping can all respect
 * device boundaries instead of assuming "crossing == same line".
 */
export interface DeviceState {
	id: string;
	running: boolean;
	/** Belt/roller speed multiplier, independent from other devices. */
	speed: number;
	/** Set when the device's plugin/control logic has faulted. */
	faulted: boolean;
	faultReason?: string;
}

/**
 * Immutable identity and configuration for a physical/logical factory
 * device. `kind` selects a DevicePlugin; `state` is deliberately kept
 * separate because it changes continuously at runtime.
 */
export interface DeviceDefinition {
	id: string;
	kind: DeviceKind;
	name?: string;
	/** Plugin-specific configuration, persisted with the factory layout. */
	config?: Readonly<Record<string, unknown>>;
	/** Initial runtime values; the plugin supplies defaults for omissions. */
	initialState?: Partial<Omit<DeviceState, "id">>;
}

/**
 * Plugin key for a device class such as "roller-conveyor", "sorter",
 * "lift", or a customer-specific PLC-backed machine.
 */
export type DeviceKind = string & {};

/** A serializable reference to material being offered across a hand-off. */
export interface MaterialReference {
	id: string;
	type?: string;
	metadata?: Readonly<Record<string, unknown>>;
}

export interface DeviceTransferDecision {
	accepted: boolean;
	/** Required when a transfer is rejected so operators can explain it. */
	reason?: string;
}

export interface DeviceReceiveContext {
	device: DeviceDefinition;
	state: DeviceState;
	fromDeviceId: string;
	material: MaterialReference;
	handoff: DeviceHandoff;
}

export interface DeviceTransferContext extends DeviceReceiveContext {
	toDeviceId: string;
}

export interface DeviceTickContext {
	device: DeviceDefinition;
	state: DeviceState;
	delta: number;
}

/**
 * The device-plugin seam. A plugin defines equipment-specific control
 * behaviour without giving rendering, routing, or callers knowledge of its
 * internal PLC/sensor rules.
 */
export interface DevicePlugin {
	kind: DeviceKind;
	createInitialState?: (
		device: DeviceDefinition,
	) => Partial<Omit<DeviceState, "id">>;
	canReceive?: (context: DeviceReceiveContext) => DeviceTransferDecision;
	onMaterialTransferred?: (context: DeviceTransferContext) => void;
	onTick?: (context: DeviceTickContext) => void;
}

/**
 * Marks a graph node as a hand-off point between two devices: material
 * crosses from one device's track onto another's, so the node can carry
 * simple handshake state (e.g. "ready to receive") instead of assuming
 * the two sides are one continuous, uniformly controlled line.
 */
export interface DeviceHandoff {
	fromDeviceId: string;
	toDeviceId: string;
	/** True when the receiving device signals it can accept material. */
	readyToReceive?: boolean;
}
