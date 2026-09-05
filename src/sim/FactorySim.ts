import { buildSimPath, sampleSimPath, type SimPath } from "./pathMath";
import type {
	BufferDef,
	DataMode,
	DeviceStateDelta,
	ExternalContract,
	ExternalDeviceFrame,
	ExternalItemState,
	ExternalSignal,
	FrameDelta,
	InspectorDef,
	ItemMoveDelta,
	ItemRestyleDelta,
	ItemSpawnDelta,
	JunctionDef,
	JunctionLiftConfig,
	JunctionPhase,
	SimAttrValue,
	SimDeviceDef,
	SimEpisode,
	SimEvent,
	SimItemSnapshot,
	SimItemType,
	SimPoint,
	SimStats,
	SinkDef,
	SourceDef,
	TransportDef,
} from "./types";

/**
 * Data-driven factory simulation.
 *
 * The world is a device graph (sources → transports → junctions / inspectors
 * → buffers / sinks). Every frame `tick(delta)` advances the world and returns
 * a `FrameDelta` containing ONLY what changed: spawned items, moved items,
 * removed items, restyled items and device-state changes. Renderers apply the
 * delta and never run logic — this is what makes large-scale factory rendering
 * feasible (the sim itself can move to a Worker without touching any rendering
 * code).
 *
 * ## Data source modes (数据驱动三种模式)
 *
 * A real digital twin rarely has instrumentation on every device, so the
 * engine supports three modes — see `FactorySimOptions.worldMode` and
 * `setWorldMode` / `setDeviceDataSource`:
 *
 * - `"sim"`      — every device is driven by the internal kinematics engine.
 * - `"external"` — the whole world is fed from outside (MES / SCADA / PLC). The
 *                  sim generates nothing and only diffs the incoming frames
 *                  into `FrameDelta`s ("接受数据").
 * - `"hybrid"`   — per-device `dataSource`. Some devices run the sim, others are
 *                  fed externally. Items crossing a sim↔external boundary are
 *                  handed over so the renderer keeps showing them under the same
 *                  id ("应对工厂有些设备没有数据的情况").
 *
 * All transitions are appended to a bounded event log (后台记录), exposed via
 * `getRecentEvents()` for HUDs, analytics or persistence.
 */

interface InternalItem {
	id: number;
	typeId: string;
	colorIndex: number;
	deviceId: string;
	/** Arc-length distance along the current transport path. */
	distance: number;
	/**
	 * Process attributes that travel with the item. Devices read and write
	 * them freely (inspection verdicts, batch numbers, weight classes…), and
	 * routing can be keyed on any of them via `JunctionDef.routeBy`.
	 */
	attrs: Record<string, SimAttrValue>;
	/** Set when the renderer must (re)write this item's transform. */
	needsWrite: boolean;
	/** Anti-spam flag so a blocked item logs only once per blocking episode. */
	blockedNotified: boolean;
	/**
	 * Authority flag: when true the item's position comes from the external
	 * feed (`this.external`) rather than internal kinematics. Set on a
	 * sim→external hand-off so the renderer keeps showing the item seamlessly.
	 */
	held?: boolean;
}

interface TransportRT {
	kind: "transport";
	def: TransportDef;
	path: SimPath;
	/** Sorted ascending by distance; items[0] is closest to the path start. */
	items: InternalItem[];
	running: boolean;
	baseSpeed: number;
}

/** Where an item sits relative to the junction/inspector centre, per phase. */
interface JunctionOffset {
	x: number;
	y: number;
	z: number;
	heading: number;
}

interface CycleRT {
	phase: JunctionPhase;
	/** Elapsed time inside the current phase, seconds. */
	phaseT: number;
	/** Cassette extension 0…1, drives both item height and the renderer. */
	lift: number;
	/** Offset where the item entered the deck (edge → centre during dwell). */
	entry: JunctionOffset;
	/** Offset where the item leaves the deck (centre → edge during transfer). */
	exit: JunctionOffset;
	targetId: string | null;
}

interface JunctionRT extends CycleRT {
	kind: "junction";
	def: JunctionDef;
	occupant: InternalItem | null;
	remaining: number;
	routeIndex: number;
	running: boolean;
}

interface InspectorRT extends CycleRT {
	kind: "inspector";
	def: InspectorDef;
	occupant: InternalItem | null;
	/** Verdict for the current occupant; published as device state. */
	verdict: string | null;
	running: boolean;
	/** Verdict tally for the whole run, e.g. `{ ok: 41, ng: 9 }`. */
	tally: Record<string, number>;
}

interface BufferRT {
	kind: "buffer";
	def: BufferDef;
	/** Held items, in slot order. Slot index = position in this array. */
	stored: InternalItem[];
	/** Seconds the rack has been non-empty; drives `drainAfter`. */
	timer: number;
	/** Latches so `buffer:full` is logged once per fill, not every tick. */
	fullNotified: boolean;
	drainedCount: number;
}

interface SourceRT {
	kind: "source";
	def: SourceDef;
	timer: number;
	running: boolean;
}

interface SinkRT {
	kind: "sink";
	def: SinkDef;
	consumed: number;
}

type DeviceRT =
	| TransportRT
	| JunctionRT
	| InspectorRT
	| BufferRT
	| SourceRT
	| SinkRT;

/** Devices that run the shared dwell → lift → transfer → release cycle. */
type TransferLikeRT = JunctionRT | InspectorRT;

export interface FactorySimOptions {
	/** Ring-buffer size for the event log. Default 250. */
	eventLogSize?: number;
	/** Default min item spacing on transports. Default 0.45. */
	defaultMinGap?: number;
	/**
	 * Global data-source mode. Default `"sim"`.
	 * - `"sim"`      — internal kinematics drive every device.
	 * - `"external"` — the world is fed entirely from `ingestExternalFrame`.
	 * - `"hybrid"`   — each device's mode comes from `deviceSources` (or
	 *                 defaults to `"sim"`), so sim and external devices coexist.
	 */
	worldMode?: DataMode;
	/**
	 * Per-device override used in `"hybrid"` mode: device id →
	 * `"sim"` (run the engine) or `"external"` (fed from outside).
	 */
	deviceSources?: Record<string, "sim" | "external">;
	/**
	 * Seed for all in-kernel randomness (item-type rolls, inspection
	 * verdicts). Provide one to make every episode reproducible bit-for-bit;
	 * omit it for a nondeterministic run (a random seed is drawn).
	 */
	seed?: number;
}

const ZERO_OFFSET: JunctionOffset = { x: 0, y: 0, z: 0, heading: 0 };

interface SimPointLike {
	x: number;
	y: number;
	z: number;
}

function pathStart(path: SimPath): SimPointLike {
	const p = path.points[0];
	return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 };
}

function pathEnd(path: SimPath): SimPointLike {
	const p = path.points[path.points.length - 1];
	return p ? { x: p.x, y: p.y, z: p.z } : { x: 0, y: 0, z: 0 };
}

function offsetBetween(from: SimPointLike, to: SimPointLike): JunctionOffset {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const dz = to.z - from.z;
	return { x: dx, y: dy, z: dz, heading: Math.atan2(dx, dz) };
}

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v;
}

function liftTiming(lift: JunctionLiftConfig | undefined): {
	height: number;
	up: number;
	transfer: number;
	down: number;
} {
	return {
		height: lift?.height ?? 0.13,
		up: Math.max(lift?.upTime ?? 0.2, 0.02),
		transfer: Math.max(lift?.transferTime ?? 0.35, 0.02),
		down: Math.max(lift?.downTime ?? 0.2, 0.02),
	};
}

/** Ordered list of a junction's outfeeds (alternating routing). */
function junctionOutfeeds(def: JunctionDef): string[] {
	if (def.alternate) return def.alternate.devices;
	if (def.routes) return [...new Set(Object.values(def.routes))];
	return [];
}

/** Total slots a buffer can hold. */
export function bufferCapacity(def: BufferDef): number {
	const columns = Math.max(1, Math.floor(def.columns));
	const rows = Math.max(1, Math.floor(def.rows ?? 1));
	const layers = Math.max(1, Math.floor(def.layers ?? 1));
	return columns * rows * layers;
}

/**
 * World position of a buffer slot. Slots fill along columns, then rows, then
 * layers — the same way a real rack is loaded.
 */
export function bufferSlotPosition(def: BufferDef, index: number): SimPoint {
	const columns = Math.max(1, Math.floor(def.columns));
	const rows = Math.max(1, Math.floor(def.rows ?? 1));
	const plane = columns * rows;
	const [sx, sy, sz] = def.spacing ?? [0.32, 0.2, 0.32];

	const layer = Math.floor(index / plane) % Math.max(1, def.layers ?? 1);
	const within = ((index % plane) + plane) % plane;
	const column =
		def.order === "column-major"
			? Math.floor(within / rows) % columns
			: within % columns;
	const row =
		def.order === "column-major"
			? within % rows
			: Math.floor(within / columns) % rows;

	return {
		x: def.position.x + column * sx,
		y: def.position.y + layer * sy,
		z: def.position.z + row * sz,
	};
}

/**
 * mulberry32 — tiny deterministic PRNG. A simulation that cannot be re-run
 * bit-for-bit cannot produce training data, so all randomness in the kernel
 * flows through an injectable, seeded generator.
 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pickItemType(
	types: SimItemType[],
	rng: () => number,
): SimItemType | undefined {
	if (types.length === 0) return undefined;
	let total = 0;
	for (const t of types) total += t.weight ?? 1;
	let r = rng() * total;
	for (const t of types) {
		r -= t.weight ?? 1;
		if (r <= 0) return t;
	}
	return types[types.length - 1];
}

export class FactorySim {
	private readonly devices = new Map<string, DeviceRT>();
	private readonly items = new Map<number, InternalItem>();
	private nextItemId = 1;
	private eventSeq = 1;
	private readonly events: SimEvent[] = [];
	private readonly eventLogSize: number;
	private readonly defaultMinGap: number;
	private readonly dirtyDevices = new Set<string>();
	/** Latest published state per device, so renderers can poll at any time. */
	private readonly liveStates = new Map<string, DeviceStateDelta>();

	/** Global data-source mode (sim / external / hybrid). */
	private worldMode: DataMode;
	/** Per-device override, used in hybrid mode. */
	private readonly deviceSources = new Map<string, "sim" | "external">();
	/**
	 * Per-device external-signal contract (what the feed is capable of
	 * supplying). Drives how `runExternal` advances `item.distance` and how
	 * `collectMoved` resolves world pose. See §14 in factory-conveyor-plan.md.
	 */
	private readonly contracts = new Map<string, ExternalContract>();
	/**
	 * External feed: deviceId → (itemId → authoritative state). Populated by
	 * `ingestExternalFrame`. Items whose `held` flag is set read their position
	 * from here instead of from internal kinematics.
	 */
	private readonly external = new Map<string, Map<number, ExternalItemState>>();

	private globalSpeed = 1;
	private sourceRate = 1;

	/** Seed the sim was constructed (or last reset) with. */
	private currentSeed: number;
	private rng: () => number;

	totalSpawned = 0;
	totalConsumed = 0;
	blockedCount = 0;
	time = 0;

	constructor(defs: SimDeviceDef[], options: FactorySimOptions = {}) {
		this.eventLogSize = options.eventLogSize ?? 250;
		this.defaultMinGap = options.defaultMinGap ?? 0.45;
		this.worldMode = options.worldMode ?? "sim";
		this.currentSeed = options.seed ?? Math.floor(Math.random() * 2 ** 32);
		this.rng = mulberry32(this.currentSeed);
		for (const [id, src] of Object.entries(options.deviceSources ?? {})) {
			this.deviceSources.set(id, src);
		}

		for (const def of defs) {
			if (this.devices.has(def.id)) {
				throw new Error(`FactorySim: duplicate device id "${def.id}"`);
			}
			switch (def.kind) {
				case "source":
					this.devices.set(def.id, {
						kind: "source",
						def,
						timer: 0,
						running: true,
					});
					break;
				case "transport":
					this.devices.set(def.id, {
						kind: "transport",
						def,
						path: buildSimPath(def.points, def.cornerRadius ?? 0.45),
						items: [],
						running: true,
						baseSpeed: def.speed,
					});
					break;
				case "junction":
					this.devices.set(def.id, {
						kind: "junction",
						def,
						occupant: null,
						remaining: 0,
						routeIndex: 0,
						running: true,
						phase: "idle",
						phaseT: 0,
						lift: 0,
						entry: ZERO_OFFSET,
						exit: ZERO_OFFSET,
						targetId: null,
					});
					break;
				case "inspector":
					this.devices.set(def.id, {
						kind: "inspector",
						def,
						occupant: null,
						verdict: null,
						running: true,
						tally: {},
						phase: "idle",
						phaseT: 0,
						lift: 0,
						entry: ZERO_OFFSET,
						exit: ZERO_OFFSET,
						targetId: null,
					});
					break;
				case "buffer":
					this.devices.set(def.id, {
						kind: "buffer",
						def,
						stored: [],
						timer: 0,
						fullNotified: false,
						drainedCount: 0,
					});
					break;
				case "sink":
					this.devices.set(def.id, { kind: "sink", def, consumed: 0 });
					break;
			}
		}

		this.validateTopology();
	}

	// ---------------------------------------------------------------------------
	// Data-source mode control (三种数据模式).
	// ---------------------------------------------------------------------------

	getWorldMode(): DataMode {
		return this.worldMode;
	}

	/**
	 * Monotonic sim clock (seconds). External feeders read this so entry/span/
	 * progress signals share the sim's time base — `tick` clamps `dt` to 0.25 s,
	 * so wall-clock deltas would drift from the sim during frame hitches.
	 */
	getElapsed(): number {
		return this.time;
	}

	/** The seed the current episode runs on — record it alongside any exported event log so the episode can be reproduced. */
	getSeed(): number {
		return this.currentSeed;
	}

	/**
	 * Reset the world to t=0 and reseed the RNG: every item, event, counter
	 * and per-device runtime value returns to its initial state. Control
	 * settings (running, speed multipliers, world mode, data sources,
	 * contracts) are deliberately kept — an episode rerun should differ only
	 * if the seed differs. With no argument the sim replays the SAME episode
	 * (same seed); pass a seed to start a different reproducible episode.
	 */
	reset(seed?: number): void {
		this.currentSeed = seed ?? this.currentSeed;
		this.rng = mulberry32(this.currentSeed);

		this.items.clear();
		this.nextItemId = 1;
		this.eventSeq = 1;
		this.events.length = 0;
		this.dirtyDevices.clear();
		this.liveStates.clear();
		this.external.clear();
		this.totalSpawned = 0;
		this.totalConsumed = 0;
		this.blockedCount = 0;
		this.time = 0;

		for (const rt of this.devices.values()) {
			switch (rt.kind) {
				case "source":
					rt.timer = 0;
					break;
				case "transport":
					rt.items = [];
					break;
				case "junction":
					rt.occupant = null;
					rt.remaining = 0;
					rt.routeIndex = 0;
					this.resetCycle(rt);
					break;
				case "inspector":
					rt.occupant = null;
					rt.verdict = null;
					rt.tally = {};
					this.resetCycle(rt);
					break;
				case "buffer":
					rt.stored = [];
					rt.timer = 0;
					rt.fullNotified = false;
					rt.drainedCount = 0;
					break;
				case "sink":
					rt.consumed = 0;
					break;
			}
		}
	}

	private resetCycle(rt: CycleRT): void {
		rt.phase = "idle";
		rt.phaseT = 0;
		rt.lift = 0;
		rt.entry = ZERO_OFFSET;
		rt.exit = ZERO_OFFSET;
		rt.targetId = null;
	}

	/** Switch the global data-source mode. Marks every device dirty so renderers re-read state. */
	setWorldMode(mode: DataMode): void {
		this.worldMode = mode;
		for (const id of this.devices.keys()) this.dirtyDevices.add(id);
		this.pushEvent({ type: "device:state", detail: `world-mode → ${mode}` });
	}

	/** Set a single device's data source (used in hybrid mode). */
	setDeviceDataSource(
		deviceId: string,
		source: "sim" | "external",
		contract?: ExternalContract,
	): void {
		this.deviceSources.set(deviceId, source);
		if (contract) this.contracts.set(deviceId, contract);
		this.dirtyDevices.add(deviceId);
	}

	getDeviceDataSource(deviceId: string): "sim" | "external" {
		return this.effMode(deviceId);
	}

	/** Effective external contract for a device. Defaults to world pose (back-compat). */
	private effContract(deviceId: string): ExternalContract {
		return this.contracts.get(deviceId) ?? { signal: "pose", frame: "world" };
	}

	/**
	 * Feed externally-supplied item states into the world. Called every frame
	 * in `"external"` mode and for external devices in `"hybrid"` mode. The sim
	 * diffs the feed against the previous frame to produce moved/spawned/removed
	 * deltas — it never reinterprets or predicts the data.
	 */
	ingestExternalFrame(frames: ExternalDeviceFrame[]): void {
		for (const frame of frames) {
			const map = new Map<number, ExternalItemState>();
			for (const st of frame.items) map.set(st.itemId, st);
			this.external.set(frame.deviceId, map);
			this.dirtyDevices.add(frame.deviceId);
		}
	}

	/** Effective data source for a device given the global mode + overrides. */
	private effMode(deviceId: string): "sim" | "external" {
		if (this.worldMode === "sim") return "sim";
		if (this.worldMode === "external") return "external";
		return this.deviceSources.get(deviceId) ?? "sim";
	}

	// ---------------------------------------------------------------------------
	// Public control API (what a UI / PLC layer would call).
	// ---------------------------------------------------------------------------

	getDeviceIds(): string[] {
		return [...this.devices.keys()];
	}

	setRunning(deviceId: string, running: boolean): void {
		const rt = this.requireDevice(deviceId);
		if (rt.kind === "sink" || rt.kind === "buffer") return;
		rt.running = running;
		this.dirtyDevices.add(deviceId);
	}

	/** Scales every transport's base speed. */
	setGlobalSpeed(multiplier: number): void {
		const m = Math.max(0, multiplier);
		this.globalSpeed = m;
		for (const rt of this.devices.values()) {
			if (rt.kind === "transport") this.dirtyDevices.add(rt.def.id);
		}
	}

	/** Scales every source's spawn frequency. */
	setSourceRate(multiplier: number): void {
		this.sourceRate = Math.max(0, multiplier);
	}

	/**
	 * Export the current run as a plain-JSON episode: seed + event log +
	 * closing stats. Together with the layout (device defs) this is a
	 * complete training-data record: re-running the same defs with the same
	 * seed reproduces every event bit-for-bit.
	 */
	exportEpisode(): SimEpisode {
		return {
			seed: this.currentSeed,
			duration: this.time,
			events: [...this.events],
			stats: this.getStats(),
		};
	}

	getRecentEvents(count: number): SimEvent[] {
		return this.events.slice(-count).reverse();
	}

	/**
	 * Latest published state for one device, or `undefined` before it has
	 * ever changed. Renderer plugins poll this inside `useFrame` instead of
	 * subscribing, so swapping a plugin never re-renders React.
	 */
	getDeviceState(deviceId: string): DeviceStateDelta | undefined {
		return this.liveStates.get(deviceId);
	}

	getStats(): SimStats {
		const throughput: Record<string, number> = {};
		const stored: Record<string, number> = {};
		const verdicts: Record<string, Record<string, number>> = {};
		for (const rt of this.devices.values()) {
			if (rt.kind === "sink") throughput[rt.def.id] = rt.consumed;
			else if (rt.kind === "buffer") stored[rt.def.id] = rt.stored.length;
			else if (rt.kind === "inspector") verdicts[rt.def.id] = { ...rt.tally };
		}
		return {
			activeItems: this.items.size,
			totalSpawned: this.totalSpawned,
			totalConsumed: this.totalConsumed,
			blocked: this.blockedCount,
			throughput,
			stored,
			verdicts,
		};
	}

	/** Read-only item snapshot for debug tooling. */
	snapshot(): SimItemSnapshot[] {
		return [...this.items.values()].map((item) => ({
			id: item.id,
			typeId: item.typeId,
			colorIndex: item.colorIndex,
			deviceId: item.deviceId,
			distance: item.distance,
			attrs: item.attrs,
		}));
	}

	// ---------------------------------------------------------------------------
	// Simulation step. Returns the frame delta for renderers.
	// ---------------------------------------------------------------------------

	tick(deltaSeconds: number): FrameDelta {
		const dt = Math.min(Math.max(deltaSeconds, 0), 0.25);
		const spawned: ItemSpawnDelta[] = [];
		const removed: number[] = [];
		const restyled: ItemRestyleDelta[] = [];

		if (dt > 0) {
			this.time += dt;
			if (this.worldMode === "external") {
				// Pure replay of the external feed — no internal kinematics.
				this.runExternal(spawned, removed, restyled);
			} else {
				this.runSim(dt, spawned, removed, restyled);
				if (this.worldMode === "hybrid") {
					this.runExternal(spawned, removed, restyled);
				}
			}
		}

		return {
			time: this.time,
			spawned,
			moved: this.collectMoved(),
			removed,
			restyled,
			deviceStates: this.collectDeviceStates(),
			stats: this.getStats(),
		};
	}

	/** Internal kinematics for every device whose effective mode is "sim". */
	private runSim(
		dt: number,
		spawned: ItemSpawnDelta[],
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		this.tickSources(dt, spawned);
		this.tickTransports(dt, removed, restyled);
		this.tickTransferLike(dt, removed, restyled);
		this.tickBuffers(dt, removed);
	}

	/**
	 * Diff the external feed into frame deltas. Mirrors each fed item into
	 * `this.items` with `held = true` so `collectMoved` can read its position.
	 *
	 * Branches on the device's external contract (§14):
	 * - `pose`     — world (or device-local→world) pose; resolved in collectMoved.
	 * - `progress` — `distance = progress × path.length`; sampled in collectMoved.
	 * - `entry`    — sim drives `distance` via its own speed×dt from `tEnter`.
	 * - `span`     — `distance` linearly interpolated over `[tEnter, tExit]`.
	 * Path-driven signals (progress/entry/span) REQUIRE the device to declare a
	 * `path`; items reaching the path end are handed off to the next device.
	 */
	private runExternal(
		spawned: ItemSpawnDelta[],
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		// Items handed off during this pass — skip them if the feed re-reports.
		const handedOff = new Set<number>();

		for (const [deviceId, map] of this.external) {
			const contract = this.effContract(deviceId);
			const rt = this.devices.get(deviceId);
			const L = rt && rt.kind === "transport" ? rt.path.length : 0;

			for (const st of map.values()) {
				if (handedOff.has(st.itemId)) continue;

				let item = this.items.get(st.itemId);
				if (!item) {
					item = {
						id: st.itemId,
						typeId: st.typeId,
						colorIndex: st.colorIndex,
						deviceId,
						distance: 0,
						attrs: { ...(st.attrs ?? {}) },
						needsWrite: true,
						blockedNotified: false,
						held: true,
					};
					this.items.set(st.itemId, item);
					spawned.push({
						itemId: st.itemId,
						typeId: st.typeId,
						colorIndex: st.colorIndex,
					});
				} else {
					item.held = true;
					item.deviceId = deviceId;
					if (item.colorIndex !== st.colorIndex) {
						item.colorIndex = st.colorIndex;
						restyled.push({ itemId: st.itemId, colorIndex: st.colorIndex });
					}
					item.attrs = { ...(st.attrs ?? {}) };
					item.needsWrite = true;
				}

				// Pose signals are resolved in collectMoved; nothing to advance here.
				if (contract.signal === "pose") continue;

				// Path-driven signals need a transport path to be meaningful.
				if (!rt || rt.kind !== "transport" || L <= 0) continue;

				const sig: ExternalSignal | undefined = st.signal;
				let distance = item.distance;
				if (sig && sig.kind === "progress") {
					distance = clamp(sig.progress, 0, 1) * L;
				} else if (sig && sig.kind === "entry") {
					const speed = rt.baseSpeed * this.globalSpeed;
					distance = Math.max(0, (this.time - sig.tEnter) * speed);
				} else if (sig && sig.kind === "span") {
					const dur = sig.tExit - sig.tEnter;
					const u = dur > 0 ? clamp((this.time - sig.tEnter) / dur, 0, 1) : 1;
					distance = u * L;
				} else {
					// Path-driven contract but the feed gave no usable signal: leave as-is.
					continue;
				}

				item.distance = Math.min(distance, L);
				item.needsWrite = true;

				if (item.distance >= L - 1e-6) {
					map.delete(st.itemId);
					this.handOffHeld(item, rt, removed, restyled);
					handedOff.add(st.itemId);
				}
			}
		}

		// Drop held items that disappeared from the feed this frame.
		const seen = new Set<number>();
		for (const m of this.external.values()) {
			for (const st of m.values()) seen.add(st.itemId);
		}
		for (const [id, item] of [...this.items]) {
			if (!item.held) continue;
			if (!seen.has(id)) {
				removed.push(id);
				this.items.delete(id);
			}
		}
	}

	/**
	 * Hand a path-driven held item off when it reaches the end of its path.
	 * Falls back to `externalHandoff` for unmodelled downstream devices, or
	 * adopts the item into the sim engine when the next device is sim-driven
	 * (this is the `external → sim` hand-back — see §14.7).
	 */
	private handOffHeld(
		item: InternalItem,
		from: TransportRT,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		const next = this.devices.get(from.def.next);
		if (!next) {
			this.externalHandoff(item, pathEnd(from.path), from.def.id, from.def.next);
			return;
		}
		const entry = offsetBetween(
			next.kind === "junction" || next.kind === "inspector" ? next.def.position : ZERO_OFFSET,
			pathEnd(from.path),
		);
		const accepted = this.acceptItem(next, item, from.def.id, entry, removed, restyled);
		if (accepted && this.effMode(next.def.id) !== "external") {
			item.held = false; // adopted into the sim engine
		}
	}

	/** Local frame (origin + yaw) a device uses to map device-local → world. */
	private deviceFrame(rt: DeviceRT): { origin: SimPoint; yaw: number } {
		if (rt.kind === "transport") {
			const start = pathStart(rt.path);
			const pts = rt.path.points;
			const nxt = pts[1] ?? start;
			const yaw = Math.atan2(nxt.x - start.x, nxt.z - start.z);
			return { origin: start, yaw };
		}
		if (rt.kind === "junction" || rt.kind === "inspector" || rt.kind === "buffer") {
			return { origin: rt.def.position, yaw: 0 };
		}
		return { origin: { x: 0, y: 0, z: 0 }, yaw: 0 };
	}

	/** Map a device-local pose into world coordinates. */
	private localToWorld(
		origin: SimPoint,
		yaw: number,
		lx: number,
		ly: number,
		lz: number,
		lheading: number,
	): { x: number; y: number; z: number; heading: number } {
		const fwdX = Math.sin(yaw);
		const fwdZ = Math.cos(yaw);
		const rgtX = Math.cos(yaw);
		const rgtZ = -Math.sin(yaw);
		return {
			x: origin.x + rgtX * lx + fwdX * lz,
			y: origin.y + ly,
			z: origin.z + rgtZ * lx + fwdZ * lz,
			heading: yaw + lheading,
		};
	}

	// ---------------------------------------------------------------------------
	// Internals.
	// ---------------------------------------------------------------------------

	private validateTopology(): void {
		// A referenced device may be a real sim device OR an external-only
		// device (fed from outside, not present in `this.devices`). Only a
		// duplicate id is fatal.
		for (const rt of this.devices.values()) {
			if (rt.kind === "source") {
				const out = this.devices.get(rt.def.output);
				if (out && out.kind !== "transport") {
					throw new Error(
						`FactorySim: source "${rt.def.id}" must output to a transport (got "${rt.def.output}")`,
					);
				}
			} else if (rt.kind === "transport") {
				if (
					this.devices.has(rt.def.next) &&
					this.devices.get(rt.def.next)?.kind === "source"
				) {
					throw new Error(
						`FactorySim: transport "${rt.def.id}" references a source as next device`,
					);
				}
			} else if (rt.kind === "inspector") {
				if (!rt.def.routes[rt.def.defaultVerdict]) {
					throw new Error(
						`FactorySim: inspector "${rt.def.id}" has no route for its default verdict "${rt.def.defaultVerdict}"`,
					);
				}
			}
		}
	}

	private requireDevice(deviceId: string): DeviceRT {
		const rt = this.devices.get(deviceId);
		if (!rt) {
			throw new Error(`FactorySim: unknown device "${deviceId}"`);
		}
		return rt;
	}

	private pushEvent(event: Omit<SimEvent, "seq" | "time">): void {
		this.events.push({ seq: this.eventSeq++, time: this.time, ...event });
		if (this.events.length > this.eventLogSize) {
			this.events.splice(0, this.events.length - this.eventLogSize);
		}
	}

	private tryEnterTransport(item: InternalItem, transport: TransportRT): boolean {
		if (!transport.running) return false;
		const gap = transport.def.minGap ?? this.defaultMinGap;
		const first = transport.items[0];
		if (first && first.distance < gap) return false;
		item.deviceId = transport.def.id;
		item.distance = 0;
		item.needsWrite = true;
		item.blockedNotified = false;
		transport.items.unshift(item);
		return true;
	}

	private tickSources(dt: number, spawned: ItemSpawnDelta[]): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "source" || !rt.running) continue;
			rt.timer += dt;
			const interval = Math.max(rt.def.interval / Math.max(this.sourceRate, 0.01), 0.05);
			while (rt.timer >= interval) {
				rt.timer -= interval;
				this.spawnFromSource(rt, spawned);
			}
		}
	}

	private spawnFromSource(source: SourceRT, spawned: ItemSpawnDelta[]): void {
		const out = this.devices.get(source.def.output);
		if (!out || out.kind !== "transport") return;
		const type = pickItemType(source.def.itemTypes, this.rng);
		if (!type) return;

		const item: InternalItem = {
			id: this.nextItemId++,
			typeId: type.typeId,
			colorIndex: type.colorIndex,
			deviceId: out.def.id,
			distance: 0,
			attrs: { ...(type.attrs ?? {}) },
			needsWrite: true,
			blockedNotified: false,
		};
		if (!this.tryEnterTransport(item, out)) {
			this.blockedCount++;
			this.pushEvent({
				type: "item:blocked",
				deviceId: source.def.id,
				itemId: item.id,
				detail: `source ${source.def.id} blocked at ${out.def.id}`,
			});
			return;
		}
		this.items.set(item.id, item);
		this.totalSpawned++;
		spawned.push({
			itemId: item.id,
			typeId: item.typeId,
			colorIndex: item.colorIndex,
		});
		this.pushEvent({
			type: "item:spawned",
			deviceId: source.def.id,
			itemId: item.id,
			detail: `type=${item.typeId} → ${out.def.id}`,
		});
	}

	private tickTransports(
		dt: number,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "transport") continue;
			if (this.effMode(rt.def.id) !== "sim") continue; // external: fed, not simulated
			const speed = rt.running ? rt.baseSpeed * this.globalSpeed : 0;
			if (speed <= 0) continue;

			const gap = rt.def.minGap ?? this.defaultMinGap;
			const step = speed * dt;
			const pathLen = rt.path.length;

			// Iterate from the item closest to the path end backwards, so an
			// item blocked at a hand-off naturally queues its followers.
			for (let i = rt.items.length - 1; i >= 0; i--) {
				const item = rt.items[i];
				if (!item) continue;
				const ahead = rt.items[i + 1];
				const limit = ahead ? ahead.distance - gap : pathLen;
				const prev = item.distance;
				const next = Math.max(prev, Math.min(prev + step, limit));
				item.distance = next;

				if (next > prev + 1e-9) {
					item.needsWrite = true;
					item.blockedNotified = false;
				}

				const isLast = i === rt.items.length - 1;
				if (isLast && !ahead && next >= pathLen - 1e-6) {
					const handedOff = this.handOffFromTransport(rt, item, removed, restyled);
					if (!handedOff && !item.blockedNotified) {
						item.blockedNotified = true;
						this.blockedCount++;
						this.pushEvent({
							type: "item:blocked",
							deviceId: rt.def.id,
							itemId: item.id,
						});
					}
				}
			}
		}
	}

	/**
	 * One hand-off entry point for every target kind.
	 *
	 * Used both by transports reaching the end of their path and by
	 * junctions/inspectors releasing their occupant, so a new device kind
	 * only has to be taught how to ACCEPT an item — never who might hand it
	 * one. Returns false when the target refuses, which leaves the sender
	 * holding the item and produces backpressure.
	 */
	private acceptItem(
		target: DeviceRT,
		item: InternalItem,
		fromId: string,
		entry: JunctionOffset,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): boolean {
		// Crossing into an external-authoritative device: the item keeps its id
		// but its motion is now driven by the feed. The renderer never notices.
		if (this.effMode(target.def.id) === "external") {
			return this.externalAdopt(item, target, fromId);
		}

		if (target.kind === "transport") {
			if (!this.tryEnterTransport(item, target)) return false;
			this.logTransfer(fromId, target.def.id, item);
			return true;
		}

		if (target.kind === "junction" || target.kind === "inspector") {
			if (target.occupant || !target.running) return false;
			target.occupant = item;
			// The item enters at the deck edge facing the infeed, then rolls
			// to the centre during the dwell phase.
			target.entry = entry;
			target.exit = ZERO_OFFSET;
			target.targetId = null;
			target.phase = "dwell";
			target.phaseT = 0;
			target.lift = 0;
			if (target.kind === "inspector") target.verdict = null;
			item.deviceId = target.def.id;
			item.distance = 0;
			item.needsWrite = true;
			this.dirtyDevices.add(target.def.id);
			this.logTransfer(fromId, target.def.id, item);
			return true;
		}

		if (target.kind === "buffer") {
			const capacity = bufferCapacity(target.def);
			if (target.stored.length >= capacity) {
				if (target.def.onFull !== "consume") return false;
				// Over-capacity with "consume": the item leaves the system but
				// the overflow is still recorded rather than silently dropped.
				this.removeItem(item, removed);
				this.pushEvent({
					type: "item:consumed",
					deviceId: target.def.id,
					itemId: item.id,
					detail: `overflow @ ${target.def.id}`,
					payload: { reason: "buffer-full" },
				});
				this.logTransfer(fromId, target.def.id, item);
				return true;
			}

			target.stored.push(item);
			item.deviceId = target.def.id;
			item.distance = 0;
			item.needsWrite = true;
			this.dirtyDevices.add(target.def.id);
			this.pushEvent({
				type: "buffer:stored",
				deviceId: target.def.id,
				itemId: item.id,
				detail: `${item.typeId} → slot ${target.stored.length - 1}/${capacity}`,
				payload: {
					slot: target.stored.length - 1,
					count: target.stored.length,
					capacity,
				},
			});
			this.logTransfer(fromId, target.def.id, item);

			if (target.stored.length >= capacity && !target.fullNotified) {
				target.fullNotified = true;
				this.pushEvent({
					type: "buffer:full",
					deviceId: target.def.id,
					detail: `${target.def.id} full (${capacity})`,
					payload: { count: capacity, capacity },
				});
			}
			return true;
		}

		if (target.kind === "sink") {
			this.removeItem(item, removed);
			target.consumed++;
			this.totalConsumed++;
			this.pushEvent({
				type: "item:consumed",
				deviceId: target.def.id,
				itemId: item.id,
				detail: `${item.typeId} @ ${target.def.id}`,
				payload: { quality: (item.attrs.quality as SimAttrValue) ?? "unknown" },
			});
			this.logTransfer(fromId, target.def.id, item);
			return true;
		}

		return false;
	}

	private logTransfer(fromId: string, toId: string, item: InternalItem): void {
		this.pushEvent({
			type: "item:transferred",
			deviceId: fromId,
			itemId: item.id,
			detail: `${fromId} → ${toId}`,
		});
	}

	private removeItem(item: InternalItem, removed: number[]): void {
		this.items.delete(item.id);
		removed.push(item.id);
	}

	private handOffFromTransport(
		from: TransportRT,
		item: InternalItem,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): boolean {
		const next = this.devices.get(from.def.next);
		// External-only device (not modelled as a sim device): hand the item's
		// authority to the feed and stop simulating it.
		if (!next) {
			return this.externalHandoff(item, pathEnd(from.path), from.def.id, from.def.next);
		}

		const entry = offsetBetween(
			next.kind === "junction" || next.kind === "inspector"
				? next.def.position
				: { x: 0, y: 0, z: 0 },
			pathEnd(from.path),
		);
		const accepted = this.acceptItem(next, item, from.def.id, entry, removed, restyled);
		if (accepted) from.items.pop();
		return accepted;
	}

	/** Hand an item to a device that exists in the topology but is externally fed. */
	private externalAdopt(item: InternalItem, target: DeviceRT, fromId: string): boolean {
		this.injectExternal(item, this.deviceRefPoint(target), target.def.id);
		this.logTransfer(fromId, target.def.id, item);
		return true;
	}

	/** A stable world point for a device, used when handing an item to it. */
	private deviceRefPoint(target: DeviceRT): SimPointLike {
		if (target.kind === "transport") return pathStart(target.path);
		if (target.kind === "junction" || target.kind === "inspector" || target.kind === "buffer") {
			return target.def.position;
		}
		return { x: 0, y: 0, z: 0 }; // sink / source: no geometry
	}

	/** Hand an item to a device that is not modelled at all (pure external feed). */
	private externalHandoff(
		item: InternalItem,
		pos: SimPointLike,
		fromId: string,
		targetId: string,
	): boolean {
		this.injectExternal(item, pos, targetId);
		this.pushEvent({
			type: "item:transferred",
			deviceId: fromId,
			itemId: item.id,
			detail: `${fromId} → ${targetId} (external)`,
		});
		return true;
	}

	private injectExternal(item: InternalItem, pos: SimPointLike, targetId: string): void {
		item.deviceId = targetId;
		item.held = true;
		item.needsWrite = true;
		item.distance = 0;
		const st: ExternalItemState = {
			itemId: item.id,
			typeId: item.typeId,
			colorIndex: item.colorIndex,
			x: pos.x,
			y: pos.y,
			z: pos.z,
			heading: 0,
			attrs: item.attrs,
		};
		let map = this.external.get(targetId);
		if (!map) {
			map = new Map();
			this.external.set(targetId, map);
		}
		map.set(item.id, st);
		this.dirtyDevices.add(targetId);
	}

	private tickTransferLike(
		dt: number,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "junction" && rt.kind !== "inspector") continue;
			if (this.effMode(rt.def.id) !== "sim") continue; // external: fed, not simulated

			// Alternating routing state machine (sorter diverter).
			if (rt.kind === "junction" && rt.def.alternate) {
				const outfeeds = junctionOutfeeds(rt.def);
				const interval = Math.max(rt.def.alternate.interval, 0.1);
				const idx = outfeeds.length > 0 ? Math.floor(this.time / interval) % outfeeds.length : 0;
				if (idx !== rt.routeIndex) {
					rt.routeIndex = idx;
					this.dirtyDevices.add(rt.def.id);
					this.pushEvent({
						type: "device:state",
						deviceId: rt.def.id,
						detail: `route → ${outfeeds[idx] ?? "?"}`,
					});
				}
			}

			if (!rt.running || !rt.occupant) continue;
			const item = rt.occupant;
			const timing = liftTiming(rt.def.lift);
			rt.phaseT += dt;

			switch (rt.phase) {
				case "dwell": {
					item.needsWrite = true;
					if (rt.phaseT < Math.max(rt.def.dwell, 0)) break;

					// Inspectors stamp a verdict onto the item at dwell-end.
					if (rt.kind === "inspector") {
						const verdict = this.evalInspectorVerdict(rt.def, item);
						item.attrs[rt.def.writesAttr] = verdict;
						rt.verdict = verdict;
						rt.tally[verdict] = (rt.tally[verdict] ?? 0) + 1;
						const colorIndex = rt.def.verdictColors?.[verdict];
						if (colorIndex !== undefined && colorIndex !== item.colorIndex) {
							item.colorIndex = colorIndex;
							restyled.push({ itemId: item.id, colorIndex });
						}
						this.pushEvent({
							type: "item:inspected",
							deviceId: rt.def.id,
							itemId: item.id,
							detail: `${item.typeId} → ${verdict}`,
							payload: {
							verdict,
							attr: rt.def.writesAttr,
							...(colorIndex !== undefined ? { colorIndex } : {}),
						},
						});
					}

					const { targetId, lift } = this.resolveCycleTarget(rt);
					const target = targetId ? this.devices.get(targetId) : undefined;
					if (!target) break; // keep the occupant waiting

					rt.targetId = targetId;
					rt.exit =
						target.kind === "transport"
							? offsetBetween(rt.def.position, pathStart(target.path))
							: ZERO_OFFSET;

					if (lift && rt.def.lift) {
						rt.phase = "lifting";
						rt.phaseT = 0;
						this.pushEvent({
							type: "device:state",
							deviceId: rt.def.id,
							detail: `lift up → ${targetId}`,
						});
					} else {
						this.releaseTransferLike(rt, removed, restyled);
					}
					break;
				}

				case "lifting": {
					rt.lift = Math.min(1, rt.phaseT / timing.up);
					item.needsWrite = true;
					if (rt.phaseT >= timing.up) {
						rt.lift = 1;
						rt.phase = "transfer";
						rt.phaseT = 0;
						this.pushEvent({
							type: "device:state",
							deviceId: rt.def.id,
							detail: "transfer out",
						});
					}
					break;
				}

				case "transfer": {
					item.needsWrite = true;
					if (rt.phaseT >= timing.transfer) {
						rt.phase = "lowering";
						rt.phaseT = 0;
					}
					break;
				}

				case "lowering": {
					rt.lift = Math.max(0, 1 - rt.phaseT / timing.down);
					item.needsWrite = true;
					if (rt.phaseT >= timing.down) {
						rt.lift = 0;
						this.releaseTransferLike(rt, removed, restyled);
					}
					break;
				}

				case "idle":
					break;
			}

			// Publish lift/phase every frame while a cycle is running.
			if (rt.occupant) this.dirtyDevices.add(rt.def.id);
		}
	}

	/** Evaluate an inspector's verdict for the current occupant. */
	private evalInspectorVerdict(def: InspectorDef, item: InternalItem): string {
		if (def.rules) {
			for (const rule of def.rules) {
				if (item.attrs[rule.attr] === rule.equals) return rule.verdict;
			}
		}
		if (def.random && this.rng() < def.random.rate) return def.random.verdict;
		return def.defaultVerdict;
	}

	/** Decide the downstream device for a dwelled item (junction or inspector). */
	private resolveCycleTarget(rt: TransferLikeRT): {
		targetId: string | null;
		lift: boolean;
	} {
		if (rt.kind === "inspector") {
			const verdict = rt.verdict ?? rt.def.defaultVerdict;
			const targetId = rt.def.routes[verdict] ?? null;
			return { targetId, lift: !!rt.def.lift };
		}

		// junction: route by attribute (default "typeId"), fall back to alternate.
		const key = rt.def.routeBy ?? "typeId";
		const raw =
			key === "typeId"
				? rt.occupant?.typeId
				: rt.occupant
					? rt.occupant.attrs[key]
					: undefined;
		const value = raw === undefined ? undefined : String(raw);
		const routes = rt.def.routes ?? {};
		let targetId: string | null = value !== undefined ? (routes[value] ?? null) : null;
		if (!targetId && rt.def.alternate) {
			targetId =
				rt.def.alternate.devices[rt.routeIndex] ??
				rt.def.alternate.devices[0] ??
				null;
		}
		const lift = !!rt.def.lift && this.needsLift(rt, targetId ?? "");
		return { targetId, lift };
	}

	/** True when the chosen outfeed needs the lift-and-transfer cycle. */
	private needsLift(rt: JunctionRT, targetId: string): boolean {
		const cfg = rt.def.lift;
		if (!cfg) return false;
		if (cfg.divertRoutes) return cfg.divertRoutes.includes(targetId);
		return true;
	}

	/** Hands the occupant to its target device; blocks while the target is full. */
	private releaseTransferLike(
		rt: TransferLikeRT,
		removed: number[],
		restyled: ItemRestyleDelta[],
	): void {
		const item = rt.occupant;
		if (!item) return;
		const { targetId } = this.resolveCycleTarget(rt);
		if (!targetId) return;

		const target = this.devices.get(targetId);
		if (!target) {
			// External-only device: hand authority to the feed.
			this.externalHandoff(item, rt.def.position, rt.def.id, targetId);
		} else {
			const entry =
				target.kind === "junction" || target.kind === "inspector"
					? offsetBetween(target.def.position, rt.def.position)
					: ZERO_OFFSET;
			if (!this.acceptItem(target, item, rt.def.id, entry, removed, restyled)) {
				return; // target refused — keep occupant, retry next frame
			}
		}

		rt.occupant = null;
		rt.phase = "idle";
		rt.phaseT = 0;
		rt.lift = 0;
		rt.targetId = null;
		rt.exit = ZERO_OFFSET;
		if (rt.kind === "inspector") rt.verdict = null;
		this.dirtyDevices.add(rt.def.id);
	}

	/**
	 * Position of an item on a junction/inspector deck, in world coordinates.
	 *
	 * dwell    – rolls from the infeed edge to the deck centre
	 * lifting  – sits at the centre while the cassette rises
	 * transfer – driven out sideways along the exit offset
	 * lowering – held at the exit point while the cassette retracts
	 */
	private cycleItemOffset(rt: TransferLikeRT): JunctionOffset {
		const timing = liftTiming(rt.def.lift);
		const liftY = timing.height * rt.lift;

		if (rt.phase === "dwell") {
			const t = Math.min(1, rt.phaseT / Math.max(rt.def.dwell, 1e-6));
			const e = rt.entry;
			return { x: e.x * (1 - t), y: e.y * (1 - t), z: e.z * (1 - t), heading: e.heading };
		}

		if (rt.phase === "transfer") {
			const t = Math.min(1, rt.phaseT / timing.transfer);
			const x = rt.exit;
			return { x: x.x * t, y: x.y * t + liftY, z: x.z * t, heading: x.heading };
		}

		if (rt.phase === "lowering") {
			const x = rt.exit;
			return { x: x.x, y: x.y + liftY, z: x.z, heading: x.heading };
		}

		// lifting (and idle): parked at the deck centre, rising.
		return { x: 0, y: liftY, z: 0, heading: rt.entry.heading };
	}

	private tickBuffers(dt: number, removed: number[]): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "buffer") continue;
			if (this.effMode(rt.def.id) !== "sim") continue; // external: fed, not simulated
			if (rt.stored.length === 0) {
				rt.timer = 0;
				continue;
			}
			rt.timer += dt;
			if (rt.def.drainAfter && rt.def.drainAfter > 0 && rt.timer >= rt.def.drainAfter) {
				const n = rt.stored.length;
				for (const it of rt.stored) this.removeItem(it, removed);
				rt.stored = [];
				rt.timer = 0;
				rt.drainedCount += n;
				rt.fullNotified = false;
				this.dirtyDevices.add(rt.def.id);
				this.pushEvent({
					type: "buffer:drained",
					deviceId: rt.def.id,
					detail: `drained ${n}`,
					payload: { count: n },
				});
			}
		}
	}

	private collectMoved(): ItemMoveDelta[] {
		const moved: ItemMoveDelta[] = [];
		for (const item of this.items.values()) {
			if (!item.needsWrite) continue;
			item.needsWrite = false;

			// Externally-authoritative items resolve from the contract.
			if (item.held) {
				const contract = this.effContract(item.deviceId);
				if (contract.signal === "pose") {
					// Pose: read the feed (optionally transform device-local → world).
					const st = this.external.get(item.deviceId)?.get(item.id);
					if (st) {
						// Prefer coordinates carried by the pose signal; fall back to the flat fields.
						let lx = st.x ?? 0;
						let ly = st.y ?? 0;
						let lz = st.z ?? 0;
						let lh = st.heading ?? 0;
						if (st.signal && st.signal.kind === "pose") {
							lx = st.signal.x;
							ly = st.signal.y;
							lz = st.signal.z;
							lh = st.signal.heading;
						}
						const frame =
							st.signal && st.signal.kind === "pose" ? st.signal.frame : contract.frame ?? "world";
						if (frame === "local") {
							const rt = this.devices.get(item.deviceId);
							if (rt) {
								const f = this.deviceFrame(rt);
								const w = this.localToWorld(f.origin, f.yaw, lx, ly, lz, lh);
								moved.push({ itemId: item.id, x: w.x, y: w.y, z: w.z, heading: w.heading });
								continue;
							}
						}
						moved.push({ itemId: item.id, x: lx, y: ly, z: lz, heading: lh });
					}
					continue;
				}

				// Path-driven (progress / entry / span): sample the transport path.
				const rt = this.devices.get(item.deviceId);
				if (rt && rt.kind === "transport") {
					const sample = sampleSimPath(rt.path, item.distance);
					moved.push({
						itemId: item.id,
						x: sample.position.x,
						y: sample.position.y,
						z: sample.position.z,
						heading: sample.heading,
					});
				} else {
					const st = this.external.get(item.deviceId)?.get(item.id);
					if (st) moved.push({ itemId: item.id, x: st.x ?? 0, y: st.y ?? 0, z: st.z ?? 0, heading: st.heading ?? 0 });
				}
				continue;
			}

			const rt = this.devices.get(item.deviceId);
			if (!rt) continue;

			if (rt.kind === "transport") {
				const sample = sampleSimPath(rt.path, item.distance);
				moved.push({
					itemId: item.id,
					x: sample.position.x,
					y: sample.position.y,
					z: sample.position.z,
					heading: sample.heading,
				});
			} else if (rt.kind === "junction" || rt.kind === "inspector") {
				const off = this.cycleItemOffset(rt);
				moved.push({
					itemId: item.id,
					x: rt.def.position.x + off.x,
					y: rt.def.position.y + off.y,
					z: rt.def.position.z + off.z,
					heading: off.heading,
				});
			} else if (rt.kind === "buffer") {
				const idx = rt.stored.indexOf(item);
				if (idx >= 0) {
					const p = bufferSlotPosition(rt.def, idx);
					moved.push({ itemId: item.id, x: p.x, y: p.y, z: p.z, heading: 0 });
				}
			}
		}
		return moved;
	}

	private collectDeviceStates(): DeviceStateDelta[] {
		const out: DeviceStateDelta[] = [];
		for (const id of this.dirtyDevices) {
			const rt = this.devices.get(id);
			if (!rt) continue;
			let delta: DeviceStateDelta;
			if (rt.kind === "transport") {
				delta = {
					deviceId: id,
					running: rt.running,
					speed: rt.baseSpeed * this.globalSpeed,
				};
			} else if (rt.kind === "junction") {
				delta = {
					deviceId: id,
					running: rt.running,
					speed: 0,
					routeIndex: rt.routeIndex,
					lift: rt.lift,
					phase: rt.phase,
					occupied: rt.occupant !== null,
				};
			} else if (rt.kind === "inspector") {
				delta = {
					deviceId: id,
					running: rt.running,
					speed: 0,
					lift: rt.lift,
					phase: rt.phase,
					occupied: rt.occupant !== null,
					lastVerdict: rt.verdict ?? undefined,
				};
			} else if (rt.kind === "buffer") {
				const capacity = bufferCapacity(rt.def);
				delta = {
					deviceId: id,
					running: true,
					speed: 0,
					count: rt.stored.length,
					capacity,
					fill: capacity > 0 ? rt.stored.length / capacity : 0,
				};
			} else if (rt.kind === "source") {
				delta = { deviceId: id, running: rt.running, speed: 0 };
			} else {
				delta = { deviceId: id, running: true, speed: 0 };
			}
			this.liveStates.set(id, delta);
			out.push(delta);
		}
		this.dirtyDevices.clear();

		// External-only devices (fed, not modelled as sim devices): emit a
		// minimal "running" state so renderers can show a device badge.
		for (const deviceId of this.external.keys()) {
			if (this.devices.has(deviceId)) continue;
			const d: DeviceStateDelta = { deviceId, running: true, speed: 0 };
			this.liveStates.set(deviceId, d);
			out.push(d);
		}
		return out;
	}
}
