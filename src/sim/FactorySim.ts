import { buildSimPath, sampleSimPath, type SimPath } from "./pathMath";
import type {
	DeviceStateDelta,
	FrameDelta,
	ItemMoveDelta,
	ItemSpawnDelta,
	JunctionDef,
	JunctionLiftConfig,
	JunctionPhase,
	SimDeviceDef,
	SimEvent,
	SimItemSnapshot,
	SimItemType,
	SimStats,
	SinkDef,
	SourceDef,
	TransportDef,
} from "./types";

/**
 * Data-driven factory simulation.
 *
 * The world is a device graph (sources → transports → junctions → sinks).
 * Every frame `tick(delta)` advances the world and returns a `FrameDelta`
 * containing ONLY what changed: spawned items, moved items, removed items
 * and device-state changes. Renderers apply the delta and never run logic —
 * this is what makes large-scale factory rendering feasible (the sim itself
 * can move to a Worker without touching any rendering code).
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
	/** Set when the renderer must (re)write this item's transform. */
	needsWrite: boolean;
	/** Anti-spam flag so a blocked item logs only once per blocking episode. */
	blockedNotified: boolean;
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

/** Where an item sits relative to the junction centre, per cycle phase. */
interface JunctionOffset {
	x: number;
	y: number;
	z: number;
	heading: number;
}

interface JunctionRT {
	kind: "junction";
	def: JunctionDef;
	occupant: InternalItem | null;
	remaining: number;
	routeIndex: number;
	running: boolean;
	/** Lift-and-transfer cycle (顶升移栽). */
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

type DeviceRT = TransportRT | JunctionRT | SourceRT | SinkRT;

export interface FactorySimOptions {
	/** Ring-buffer size for the event log. Default 250. */
	eventLogSize?: number;
	/** Default min item spacing on transports. Default 0.45. */
	defaultMinGap?: number;
}

const ZERO_OFFSET: JunctionOffset = { x: 0, y: 0, z: 0, heading: 0 };

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

interface SimPointLike {
	x: number;
	y: number;
	z: number;
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

/**
 * Ordered list of a junction's outfeeds. Index order matches the
 * `routeIndex` the device publishes, so a renderer can map a route index to
 * a physical outlet without knowing the routing rule.
 */
function junctionOutfeeds(def: JunctionDef): string[] {
	if (def.alternate) return def.alternate.devices;
	if (def.routes) return [...new Set(Object.values(def.routes))];
	return [];
}

function pickItemType(types: SimItemType[]): SimItemType | undefined {
	if (types.length === 0) return undefined;
	let total = 0;
	for (const t of types) total += t.weight ?? 1;
	let r = Math.random() * total;
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
	private globalSpeed = 1;
	private sourceRate = 1;

	totalSpawned = 0;
	totalConsumed = 0;
	blockedCount = 0;
	time = 0;

	constructor(defs: SimDeviceDef[], options: FactorySimOptions = {}) {
		this.eventLogSize = options.eventLogSize ?? 250;
		this.defaultMinGap = options.defaultMinGap ?? 0.45;

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
				case "sink":
					this.devices.set(def.id, { kind: "sink", def, consumed: 0 });
					break;
			}
		}

		this.validateTopology();
	}

	// ---------------------------------------------------------------------------
	// Public control API (what a UI / PLC layer would call).
	// ---------------------------------------------------------------------------

	getDeviceIds(): string[] {
		return [...this.devices.keys()];
	}

	setRunning(deviceId: string, running: boolean): void {
		const rt = this.requireDevice(deviceId);
		if (rt.kind === "sink") return;
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
		for (const rt of this.devices.values()) {
			if (rt.kind === "sink") throughput[rt.def.id] = rt.consumed;
		}
		return {
			activeItems: this.items.size,
			totalSpawned: this.totalSpawned,
			totalConsumed: this.totalConsumed,
			blocked: this.blockedCount,
			throughput,
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
		}));
	}

	// ---------------------------------------------------------------------------
	// Simulation step. Returns the frame delta for renderers.
	// ---------------------------------------------------------------------------

	tick(deltaSeconds: number): FrameDelta {
		const dt = Math.min(Math.max(deltaSeconds, 0), 0.25);
		const spawned: ItemSpawnDelta[] = [];
		const removed: number[] = [];

		if (dt > 0) {
			this.time += dt;
			this.tickSources(dt, spawned);
			this.tickTransports(dt, removed);
			this.tickJunctions(dt, removed);
		}

		return {
			time: this.time,
			spawned,
			moved: this.collectMoved(),
			removed,
			deviceStates: this.collectDeviceStates(),
			stats: this.getStats(),
		};
	}

	// ---------------------------------------------------------------------------
	// Internals.
	// ---------------------------------------------------------------------------

	private validateTopology(): void {
		for (const rt of this.devices.values()) {
			if (rt.kind === "source") {
				const out = this.devices.get(rt.def.output);
				if (!out || out.kind !== "transport") {
					throw new Error(
						`FactorySim: source "${rt.def.id}" must output to a transport (got "${rt.def.output}")`,
					);
				}
			} else if (rt.kind === "transport") {
				if (!this.devices.has(rt.def.next)) {
					throw new Error(
						`FactorySim: transport "${rt.def.id}" references unknown next device "${rt.def.next}"`,
					);
				}
			} else if (rt.kind === "junction") {
				const targets = [
					...Object.values(rt.def.routes ?? {}),
					...(rt.def.alternate?.devices ?? []),
				];
				for (const targetId of targets) {
					const target = this.devices.get(targetId);
					if (!target || (target.kind !== "transport" && target.kind !== "sink")) {
						throw new Error(
							`FactorySim: junction "${rt.def.id}" routes to invalid device "${targetId}"`,
						);
					}
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

	private tryEnterTransport(
		item: InternalItem,
		transport: TransportRT,
	): boolean {
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
			const interval = Math.max(
				rt.def.interval / Math.max(this.sourceRate, 0.01),
				0.05,
			);
			while (rt.timer >= interval) {
				rt.timer -= interval;
				this.spawnFromSource(rt, spawned);
			}
		}
	}

	private spawnFromSource(source: SourceRT, spawned: ItemSpawnDelta[]): void {
		const out = this.devices.get(source.def.output);
		if (!out || out.kind !== "transport") return;
		const type = pickItemType(source.def.itemTypes);
		if (!type) return;

		const item: InternalItem = {
			id: this.nextItemId++,
			typeId: type.typeId,
			colorIndex: type.colorIndex,
			deviceId: out.def.id,
			distance: 0,
			needsWrite: true,
			blockedNotified: false,
		};
		if (!this.tryEnterTransport(item, out)) {
			this.blockedCount++;
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

	private tickTransports(dt: number, removed: number[]): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "transport") continue;
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
					const handedOff = this.handOffFromTransport(rt, item, removed);
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

	private handOffFromTransport(
		from: TransportRT,
		item: InternalItem,
		removed: number[],
	): boolean {
		const next = this.devices.get(from.def.next);
		if (!next) return false;

		if (next.kind === "transport") {
			if (!this.tryEnterTransport(item, next)) return false;
			from.items.pop();
			this.pushEvent({
				type: "item:transferred",
				deviceId: from.def.id,
				itemId: item.id,
				detail: `${from.def.id} → ${next.def.id}`,
			});
			return true;
		}

		if (next.kind === "junction") {
			if (next.occupant || !next.running) return false;
			from.items.pop();
			next.occupant = item;
			next.remaining = next.def.dwell;
			// The item enters at the deck edge facing the infeed, then rolls
			// to the centre during the dwell phase.
			next.entry = offsetBetween(next.def.position, pathEnd(from.path));
			next.exit = ZERO_OFFSET;
			next.targetId = null;
			next.phase = "dwell";
			next.phaseT = 0;
			next.lift = 0;
			item.deviceId = next.def.id;
			item.distance = 0;
			item.needsWrite = true;
			this.dirtyDevices.add(next.def.id);
			this.pushEvent({
				type: "item:transferred",
				deviceId: from.def.id,
				itemId: item.id,
				detail: `${from.def.id} → ${next.def.id}`,
			});
			return true;
		}

		if (next.kind === "sink") {
			from.items.pop();
			this.items.delete(item.id);
			next.consumed++;
			this.totalConsumed++;
			removed.push(item.id);
			this.pushEvent({
				type: "item:consumed",
				deviceId: next.def.id,
				itemId: item.id,
				detail: `${item.typeId} @ ${next.def.id}`,
			});
			return true;
		}

		return false;
	}

	private tickJunctions(dt: number, removed: number[]): void {
		for (const rt of this.devices.values()) {
			if (rt.kind !== "junction") continue;

			// Alternating routing state machine (e.g. a sorter diverter).
			const outfeeds = junctionOutfeeds(rt.def);
			if (rt.def.alternate) {
				const interval = Math.max(rt.def.alternate.interval, 0.1);
				const idx =
					outfeeds.length > 0
						? Math.floor(this.time / interval) % outfeeds.length
						: 0;
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

					// Route decided the moment the load reaches the deck centre.
					const targetId =
						rt.def.routes?.[item.typeId] ??
						outfeeds[rt.routeIndex] ??
						outfeeds[0];
					const target = targetId ? this.devices.get(targetId) : undefined;
					if (!target) break; // keep the occupant waiting

					const idx = targetId ? outfeeds.indexOf(targetId) : -1;
					if (idx >= 0 && idx !== rt.routeIndex) {
						rt.routeIndex = idx;
						this.pushEvent({
							type: "device:state",
							deviceId: rt.def.id,
							detail: `route → ${targetId}`,
						});
					}
					rt.targetId = targetId ?? null;
					rt.exit =
						target.kind === "transport"
							? offsetBetween(rt.def.position, pathStart(target.path))
							: ZERO_OFFSET;

					if (rt.def.lift && this.needsLift(rt, targetId ?? "")) {
						rt.phase = "lifting";
						rt.phaseT = 0;
						this.pushEvent({
							type: "device:state",
							deviceId: rt.def.id,
							detail: `lift up → ${targetId}`,
						});
					} else {
						this.releaseJunction(rt, removed);
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
						this.releaseJunction(rt, removed);
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

	/** True when the chosen outfeed needs the lift-and-transfer cycle. */
	private needsLift(rt: JunctionRT, targetId: string): boolean {
		const cfg = rt.def.lift;
		if (!cfg) return false;
		if (cfg.divertRoutes) return cfg.divertRoutes.includes(targetId);
		return true;
	}

	/** Hands the occupant to its target device; blocks while the target is full. */
	private releaseJunction(rt: JunctionRT, removed: number[]): void {
		const item = rt.occupant;
		if (!item) return;
		const targetId = rt.targetId;
		const target = targetId ? this.devices.get(targetId) : undefined;
		if (!target) return;

		if (target.kind === "transport") {
			if (!this.tryEnterTransport(item, target)) return;
			rt.occupant = null;
			rt.phase = "idle";
			rt.phaseT = 0;
			rt.lift = 0;
			rt.targetId = null;
			rt.exit = ZERO_OFFSET;
			this.dirtyDevices.add(rt.def.id);
			this.pushEvent({
				type: "item:transferred",
				deviceId: rt.def.id,
				itemId: item.id,
				detail: `${rt.def.id} → ${target.def.id}`,
			});
			return;
		}

		if (target.kind === "sink") {
			rt.occupant = null;
			rt.phase = "idle";
			rt.phaseT = 0;
			rt.lift = 0;
			rt.targetId = null;
			rt.exit = ZERO_OFFSET;
			this.dirtyDevices.add(rt.def.id);
			this.items.delete(item.id);
			target.consumed++;
			this.totalConsumed++;
			removed.push(item.id);
			this.pushEvent({
				type: "item:consumed",
				deviceId: target.def.id,
				itemId: item.id,
				detail: `${item.typeId} @ ${target.def.id}`,
			});
		}
	}

	/**
	 * Position of an item on a junction deck, in world coordinates.
	 *
	 * dwell    – rolls from the infeed edge to the deck centre
	 * lifting  – sits at the centre while the cassette rises
	 * transfer – driven out sideways along the exit offset
	 * lowering – held at the exit point while the cassette retracts
	 */
	private junctionItemOffset(rt: JunctionRT): JunctionOffset {
		const timing = liftTiming(rt.def.lift);
		const liftY = timing.height * rt.lift;

		if (rt.phase === "dwell") {
			const t = Math.min(1, rt.phaseT / Math.max(rt.def.dwell, 1e-6));
			const e = rt.entry;
			return {
				x: e.x * (1 - t),
				y: e.y * (1 - t),
				z: e.z * (1 - t),
				heading: e.heading,
			};
		}

		if (rt.phase === "transfer") {
			const t = Math.min(1, rt.phaseT / timing.transfer);
			const x = rt.exit;
			return {
				x: x.x * t,
				y: x.y * t + liftY,
				z: x.z * t,
				heading: x.heading,
			};
		}

		if (rt.phase === "lowering") {
			const x = rt.exit;
			return { x: x.x, y: x.y + liftY, z: x.z, heading: x.heading };
		}

		// lifting (and idle): parked at the deck centre, rising.
		return { x: 0, y: liftY, z: 0, heading: rt.entry.heading };
	}

	private collectMoved(): ItemMoveDelta[] {
		const moved: ItemMoveDelta[] = [];
		for (const item of this.items.values()) {
			if (!item.needsWrite) continue;
			item.needsWrite = false;
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
			} else if (rt.kind === "junction") {
				const off = this.junctionItemOffset(rt);
				moved.push({
					itemId: item.id,
					x: rt.def.position.x + off.x,
					y: rt.def.position.y + off.y,
					z: rt.def.position.z + off.z,
					heading: off.heading,
				});
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
			} else if (rt.kind === "source") {
				delta = { deviceId: id, running: rt.running, speed: 0 };
			} else {
				delta = { deviceId: id, running: true, speed: 0 };
			}
			this.liveStates.set(id, delta);
			out.push(delta);
		}
		this.dirtyDevices.clear();
		return out;
	}
}
