/**
 * Pure-data simulation domain model for factory material flow.
 *
 * This module has ZERO rendering / three.js dependencies on purpose: the
 * simulation core is plain data + math so it can run on the main thread,
 * inside a Web Worker, or on a server, and stream frame deltas to any
 * renderer (r3f, canvas2d, headless metrics).
 *
 * Mental model:
 * - `SourceDef`  — where materials are produced (racks, injection lines…)
 * - `TransportDef` — a device that provides a MOTION PATH and moves items along it
 * - `JunctionDef` — a device that changes item ROUTING STATE (transfer table, sorter)
 * - `SinkDef`    — where materials leave the system (packing stations, trucks…)
 *
 * Everything that happens (spawn / transfer / consume / block / state change)
 * is appended to an immutable event log — the "后台记录".
 */

/** A plain 3D position. Deliberately not THREE.Vector3. */
export interface SimPoint {
	x: number;
	y: number;
	z: number;
}

/** An item type a source can produce, e.g. "parcel" or "crate". */
export interface SimItemType {
	typeId: string;
	/** Index into the renderer's cargo color palette. */
	colorIndex: number;
	/** Relative spawn probability (defaults to 1). */
	weight?: number;
}

/** Produces materials on a fixed interval and injects them downstream. */
export interface SourceDef {
	id: string;
	kind: "source";
	/** Transport device that receives spawned items. */
	output: string;
	/** Seconds between spawn attempts (before rate multiplier). */
	interval: number;
	itemTypes: SimItemType[];
}

/**
 * A device that owns a motion path: conveyor, roller bed, lift, chute…
 * Items advance along `points` at `speed` metres per second.
 */
export interface TransportDef {
	id: string;
	kind: "transport";
	/** Centreline of the motion path (world coordinates). */
	points: SimPoint[];
	/** Belt speed in metres/second. */
	speed: number;
	/** Minimum spacing between consecutive items; blocks queueing. */
	minGap?: number;
	/** Corner fillet radius applied when densifying the polyline. */
	cornerRadius?: number;
	/** Device receiving items that reach the path end (junction/sink/transport). */
	next: string;
}

/**
 * Lift-and-transfer (顶升移栽) configuration for a junction.
 *
 * Real divert tables are the same width as the line: a bed of rollers keeps
 * pushing material straight through, and a cassette of small transverse
 * drive shafts hidden in the roller gaps rises a few centimetres when the
 * item must leave sideways. The raised shafts lift the load clear of the
 * rollers and drive it out perpendicular, then retract.
 */
export interface JunctionLiftConfig {
	/** Metres the cassette rises above the roller surface. Default 0.13. */
	height?: number;
	/**
	 * Downstream device ids that need the lift cycle. Omit to divert every
	 * route; an empty list disables lifting (plain pass-through table).
	 */
	divertRoutes?: string[];
	/** Seconds to raise the cassette. Default 0.2. */
	upTime?: number;
	/** Seconds to drive the load out sideways. Default 0.35. */
	transferTime?: number;
	/** Seconds to retract the cassette. Default 0.2. */
	downTime?: number;
}

export type JunctionPhase =
	| "idle"
	| "dwell"
	| "lifting"
	| "transfer"
	| "lowering";

/**
 * A routing device between transports: transfer table, merge, sorter…
 * Items dwell on it briefly, then it decides the downstream device by
 * item type (static routing) and/or by its own alternating state.
 */
export interface JunctionDef {
	id: string;
	kind: "junction";
	/** Where items visually sit while crossing the device. */
	position: SimPoint;
	/** Seconds an item spends on the device before being routed. */
	dwell: number;
	/** Static routing table: item typeId -> downstream device id. */
	routes?: Record<string, string>;
	/** Alternating routing state: cycles through devices every interval. */
	alternate?: {
		devices: string[];
		interval: number;
	};
	/** Present on lift-and-transfer tables (顶升移栽). */
	lift?: JunctionLiftConfig;
}

/** Terminal device; consumes items and records throughput. */
export interface SinkDef {
	id: string;
	kind: "sink";
}

export type SimDeviceDef = SourceDef | TransportDef | JunctionDef | SinkDef;

/** Read-only view of a live item, for debugging / UI inspection. */
export interface SimItemSnapshot {
	id: number;
	typeId: string;
	colorIndex: number;
	deviceId: string;
	distance: number;
}

// -----------------------------------------------------------------------------
// Event log — the backend record of everything that happened.
// -----------------------------------------------------------------------------

export type SimEventType =
	| "item:spawned"
	| "item:transferred"
	| "item:consumed"
	| "item:blocked"
	| "device:state";

export interface SimEvent {
	seq: number;
	/** Simulation time in seconds. */
	time: number;
	type: SimEventType;
	deviceId?: string;
	itemId?: number;
	detail?: string;
}

// -----------------------------------------------------------------------------
// Frame delta — the ONLY thing a renderer needs per frame.
// A renderer applies spawned/moved/removed and never recomputes logic.
// -----------------------------------------------------------------------------

export interface ItemSpawnDelta {
	itemId: number;
	typeId: string;
	colorIndex: number;
}

export interface ItemMoveDelta {
	itemId: number;
	x: number;
	y: number;
	z: number;
	/** Yaw in radians, derived from the path tangent. */
	heading: number;
}

export interface DeviceStateDelta {
	deviceId: string;
	running: boolean;
	speed: number;
	/** Index of the currently selected outfeed, for any routing junction. */
	routeIndex?: number;
	/** Lift cassette extension, 0 (retracted) … 1 (fully raised). */
	lift?: number;
	/** Current lift-cycle phase; `idle`/`dwell` mean "rollers only". */
	phase?: JunctionPhase;
	/** True while an item is on the device. */
	occupied?: boolean;
}

export interface SimStats {
	activeItems: number;
	totalSpawned: number;
	totalConsumed: number;
	blocked: number;
	/** Consumed item count per sink device. */
	throughput: Record<string, number>;
}

export interface FrameDelta {
	time: number;
	spawned: ItemSpawnDelta[];
	moved: ItemMoveDelta[];
	removed: number[];
	deviceStates: DeviceStateDelta[];
	stats: SimStats;
}
