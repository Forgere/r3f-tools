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
 * - `InspectorDef` — a device that JUDGES an item and writes the verdict onto it
 * - `BufferDef`  — a device that HOLDS items (reject rack, WIP stand, staging)
 * - `SinkDef`    — where materials leave the system (packing stations, trucks…)
 *
 * Items carry an `attrs` bag, so anything a device decides (quality verdict,
 * batch, weight class) travels with the item and can be used for routing
 * further downstream.
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

/**
 * Attribute values carried by an item. Restricted to primitives so the whole
 * simulation stays structured-clone friendly (Web Worker, postMessage,
 * persistence) and events can be queried later.
 */
export type SimAttrValue = string | number | boolean;

/** An item type a source can produce, e.g. "parcel" or "crate". */
export interface SimItemType {
	typeId: string;
	/** Index into the renderer's cargo color palette. */
	colorIndex: number;
	/** Relative spawn probability (defaults to 1). */
	weight?: number;
	/** Attributes stamped on every item of this type at spawn. */
	attrs?: Record<string, SimAttrValue>;
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

/** One deterministic inspection rule: "if attr == equals then verdict". */
export interface InspectorRule {
	attr: string;
	equals: SimAttrValue;
	verdict: string;
}

/**
 * A quality gate: check/weigh/scan station.
 *
 * An item dwells on it while the check runs, then it stamps a verdict onto
 * one of the item's attributes and routes by that verdict. The verdict is
 * also recorded as an `item:inspected` event with a structured payload, so
 * yield / reject-rate analytics come straight out of the event log.
 */
export interface InspectorDef {
	id: string;
	kind: "inspector";
	/** Where the item sits while being checked. */
	position: SimPoint;
	/** Seconds the check takes. */
	dwell: number;
	/** Evaluated in order; first match wins. */
	rules?: InspectorRule[];
	/** Random verdict, e.g. 18% rejects. Only used when no rule matches. */
	random?: { verdict: string; rate: number };
	/** Verdict used when no rule matches and the random roll misses. */
	defaultVerdict: string;
	/** Attribute the verdict is written to, e.g. "quality". */
	writesAttr: string;
	/** Downstream device per verdict. */
	routes: Record<string, string>;
	/** Recolour the item per verdict: verdict → palette index. */
	verdictColors?: Record<string, number>;
	/** Optional lift cycle, for inspection decks that also divert. */
	lift?: JunctionLiftConfig;
}

/**
 * A holding device: reject rack, WIP stand, staging lane.
 *
 * Unlike a sink it does NOT destroy items — it parks them in a grid and
 * hands the renderer a slot position, so material visibly piles up. When it
 * fills up it can either block (backpressure all the way upstream, which is
 * what a real full reject rack does) or silently consume.
 */
export interface BufferDef {
	id: string;
	kind: "buffer";
	/** World position of slot 0. */
	position: SimPoint;
	columns: number;
	rows?: number;
	layers?: number;
	/** Centre-to-centre spacing between slots. */
	spacing?: [number, number, number];
	/** Slot fill order across the (column, row) plane. */
	order?: "row-major" | "column-major";
	/** "block" = hold upstream; "consume" = drop the item. */
	onFull: "block" | "consume";
	/** Seconds a non-empty rack waits before being emptied. 0/undefined = never. */
	drainAfter?: number;
}

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
	/**
	 * Attribute the routing table is keyed by. Defaults to `"typeId"`.
	 * Set it to e.g. `"quality"` to branch on an inspection verdict instead.
	 */
	routeBy?: string;
	/** Present on lift-and-transfer tables (顶升移栽). */
	lift?: JunctionLiftConfig;
}

/** Terminal device; consumes items and records throughput. */
export interface SinkDef {
	id: string;
	kind: "sink";
}

export type SimDeviceDef =
	| SourceDef
	| TransportDef
	| JunctionDef
	| InspectorDef
	| BufferDef
	| SinkDef;

/** Read-only view of a live item, for debugging / UI inspection. */
export interface SimItemSnapshot {
	id: number;
	typeId: string;
	colorIndex: number;
	deviceId: string;
	distance: number;
	attrs: Record<string, SimAttrValue>;
}

// -----------------------------------------------------------------------------
// Event log — the backend record of everything that happened.
// -----------------------------------------------------------------------------

export type SimEventType =
	| "item:spawned"
	| "item:transferred"
	| "item:consumed"
	| "item:blocked"
	| "item:inspected"
	| "buffer:stored"
	| "buffer:full"
	| "buffer:drained"
	| "device:state";

export interface SimEvent {
	seq: number;
	/** Simulation time in seconds. */
	time: number;
	type: SimEventType;
	deviceId?: string;
	itemId?: number;
	detail?: string;
	/**
	 * Structured data: `{ verdict: "ng", attr: "quality" }` for an
	 * inspection, `{ count: 7 }` for a drain. Machine-readable so the log can
	 * be persisted and queried instead of parsed back out of `detail`.
	 */
	payload?: Record<string, SimAttrValue>;
}

/**
 * One recorded run of the world: the seed it was produced with, the events
 * that happened, and the closing stats. Pure JSON — persist it, ship it, or
 * re-run it: `new FactorySim(defs, { seed: episode.seed })` replays the
 * episode bit-for-bit (provided the defs and control settings match).
 *
 * The event slice is bounded by the sim's `eventLogSize`; recorders that
 * need complete long-running episodes should construct the sim with a large
 * log (or tap deltas per tick).
 */
export interface SimEpisode {
	seed: number;
	/** Sim-time duration of the episode in seconds. */
	duration: number;
	events: SimEvent[];
	stats: SimStats;
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

/** Rewrites an item's colour after spawn, e.g. red on a reject verdict. */
export interface ItemRestyleDelta {
	itemId: number;
	colorIndex: number;
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
	/** Items currently held, for buffer devices. */
	count?: number;
	/** Buffer capacity in slots. */
	capacity?: number;
	/** Buffer fill ratio 0…1, for a near-full warning light. */
	fill?: number;
	/** Verdict of the item that was checked last, for inspector devices. */
	lastVerdict?: string;
}

export interface SimStats {
	activeItems: number;
	totalSpawned: number;
	totalConsumed: number;
	blocked: number;
	/** Consumed item count per sink device. */
	throughput: Record<string, number>;
	/** Items currently held per buffer device. */
	stored: Record<string, number>;
	/** Verdict counts per inspector device, e.g. `{ ok: 41, ng: 9 }`. */
	verdicts: Record<string, Record<string, number>>;
}

export interface FrameDelta {
	time: number;
	spawned: ItemSpawnDelta[];
	moved: ItemMoveDelta[];
	removed: number[];
	/** Colour changes for items already on screen. */
	restyled: ItemRestyleDelta[];
	deviceStates: DeviceStateDelta[];
	stats: SimStats;
}

// -----------------------------------------------------------------------------
// Data source modes — how each device's item transforms are produced.
//
// A real digital twin almost never has instrumentation on every device. The
// data-driven layer therefore supports three operating modes:
//
// - "sim"      — every device is driven by the internal kinematics engine.
// - "external" — the whole world is fed from outside (MES / SCADA / PLC). The
//                sim does NOT generate or move anything; it only diffs the
//                incoming frames into spawned/moved/removed deltas ("接受数据").
// - "hybrid"   — per-device `dataSource`. Some devices run the sim, others are
//                fed externally. Items crossing a sim↔external boundary are
//                handed over so the renderer keeps showing them under the same
//                id ("应对工厂有些设备没有数据的情况").
// -----------------------------------------------------------------------------

export type DataMode = "sim" | "external" | "hybrid";

/** A single item's authoritative state arriving from an external feed. */
export interface ExternalItemState {
	itemId: number;
	typeId: string;
	colorIndex: number;
	/**
	 * World pose. Required for the `pose` + `frame:"world"` special case
	 * (simple digital-twin devices). Optional when an `ExternalSignal` is
	 * supplied — path-driven signals (`progress`/`entry`/`span`) and
	 * `pose` + `frame:"local"` carry no world coordinates (the kernel
	 * resolves them from the device path / device-local frame instead).
	 */
	x?: number;
	y?: number;
	z?: number;
	/** Yaw in radians. */
	heading?: number;
	/** Process attributes that travel with the item (quality, batch…). */
	attrs?: Record<string, SimAttrValue>;
	/**
	 * Richer external signal (see factory-conveyor-plan.md §14). When present
	 * it supersedes the flat `x/y/z/heading` fields. The four kinds differ
	 * only in *who advances `item.distance`* (or whether world pose bypasses
	 * it entirely), so a single `FrameDelta.moved` serves sim and all external
	 * modes uniformly. Runtime implemented in `runExternal` / `collectMoved`.
	 */
	signal?: ExternalSignal;
}

/** One device's worth of externally-supplied item states for a frame. */
export interface ExternalDeviceFrame {
	deviceId: string;
	items: ExternalItemState[];
}

// -----------------------------------------------------------------------------
// External-data driving contract — runtime implemented (see FactorySim.runExternal / collectMoved)
// -----------------------------------------------------------------------------
//
// Every transport device owns a `path` (SimPath with arc-length `length`) and
// the kernel resolves world pose via `sampleSimPath(path, item.distance)`.
// The four external-signal kinds below differ ONLY in *who advances
// `item.distance`* (or whether world pose bypasses it entirely). That is why a
// single `FrameDelta.moved` can serve sim and all external modes uniformly.
//
//   1. entry    — feed gives tEnter + itemId only. Sim drives `distance` with its
//                 own speed×dt kinematics until path end, then hands off.
//                 (weakest: exit time predicted by sim, no feed correction)
//   2. span     — feed gives tEnter + tExit. Sim linearly interpolates `distance`
//                 across [tEnter, tExit]; exit is anchored by the feed.
//   3. pose     — feed gives a per-frame pose. DEFAULT FRAME IS DEVICE-LOCAL:
//                 sim applies the device's position/rotation to map local→world.
//                 (the flat `x/y/z/heading` on ExternalItemState == `frame:"world"`)
//   4. progress — feed gives progress ∈ [0,1]; sim sets distance = progress × L.
//
// Cases 1/2/4 REQUIRE the external device to still declare its belt `path`
// (geometry the sim owns) even though it is externally triggered. Case 3 needs
// the device's transform only (path optional, used solely for local→world).

export type ExternalSignal =
	| { kind: "pose"; frame: "world" | "local"; x: number; y: number; z: number; heading: number }
	| { kind: "progress"; progress: number }
	| { kind: "entry"; tEnter: number }
	| { kind: "span"; tEnter: number; tExit: number };

/** Per-device contract: what the external source is capable of supplying. */
export interface ExternalContract {
	/** Which signal kind the feed provides for this device. */
	signal: "pose" | "progress" | "entry" | "span";
	/** Coordinate frame for `pose` signals. Design decision: default "local". */
	frame?: "world" | "local";
}
