import { validateFactoryLayout } from "../sim/layout";
import type {
	FactoryLayout,
	LayoutIssue,
} from "../sim/layout";
import type {
	BufferDef,
	InspectorDef,
	JunctionDef,
	SimDeviceDef,
	SimPoint,
	SinkDef,
	SourceDef,
	TransportDef,
} from "../sim/types";
import { generateSegmentGeometry } from "./segmentCurves";
import type { SegmentPluginRegistry } from "./segmentPluginRegistry";
import type { TrackEdge, TrackGraph, TrackNode } from "./trackGraph";
import type {
	DeviceDefinition,
	SegmentGeometryResult,
} from "./types";

/**
 * Design-time → runtime bridge (see factory-conveyor-plan.md §16.3).
 *
 * `TrackGraph` answers "what connects to what and who owns it" with poses and
 * segment geometry; `FactorySim` runs a linear-path device world. This
 * compiler turns the former into the latter:
 *
 * - A device that owns edges compiles to a `transport`: its edges are chained
 *   node-to-node, each segment's geometry generator resolves the curve, and
 *   the curve is sampled into the transport's `points`. Sampling happens here
 *   (not in the sim), so compiled transports pin `cornerRadius: 0` — the
 *   geometry is already final.
 * - A chain that ends at a `handoff` node wires `next` to the receiving
 *   device. A chain that ends open synthesizes a `sink` (`<deviceId>__end`),
 *   so a compiled world is always closed and loadable.
 * - A device that owns NO edges maps through `config.simKind`
 *   (`"source" | "junction" | "inspector" | "buffer" | "sink"`) with the
 *   remaining fields read from its `config` bag — that bag is where
 *   editor-side, plugin-specific settings already live.
 *
 * Deliberate limits (each surfaces a structured issue, never silent output):
 * - transports are linear: a device whose edges branch or form disjoint
 *   strands cannot compile (split the branch into its own device + hand-off);
 * - the sim can only merge material at the START of a receiving device's
 *   path — a hand-off into the middle of a receiver's chain compiles but is
 *   flagged, because items will appear at the receiver's path start.
 */
export type CompileIssueCode =
	| "branching-device"
	| "disjoint-device"
	| "cycle-in-device"
	| "mid-path-handoff"
	| "dead-end"
	| "skipped-device"
	| "invalid-config";

export interface CompileIssue {
	severity: "error" | "warning";
	code: CompileIssueCode;
	deviceId?: string;
	nodeId?: string;
	message: string;
}

export interface CompileTrackGraphOptions {
	/** Custom segment geometry; falls back to the built-in generators. */
	segmentPlugins?: SegmentPluginRegistry;
	/**
	 * World-space spacing between sampled path points. Default 0.3. An edge's
	 * `params.resolution` overrides this with an explicit sample count.
	 */
	sampleSpacing?: number;
	/** What an open chain end becomes. Default `"sink"` (synthesize + warn). */
	onDeadEnd?: "sink" | "error";
	/** Extra sim devices merged verbatim (sources, inspectors, buffers…). */
	extraDevices?: SimDeviceDef[];
	/** Layout metadata. */
	name?: string;
}

export interface CompileTrackGraphResult {
	layout: FactoryLayout;
	issues: CompileIssue[];
	/** Schema validation of the produced layout (dangling external refs warn). */
	layoutIssues: LayoutIssue[];
}

const DEFAULT_SAMPLE_SPACING = 0.3;

function toSimPoint(p: { x: number; y: number; z: number }): SimPoint {
	return { x: p.x, y: p.y, z: p.z };
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readPoint(v: unknown): SimPoint | undefined {
	if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number")) {
		return { x: v[0] as number, y: v[1] as number, z: v[2] as number };
	}
	if (
		isObject(v) &&
		typeof v.x === "number" &&
		typeof v.y === "number" &&
		typeof v.z === "number"
	) {
		return { x: v.x, y: v.y, z: v.z };
	}
	return undefined;
}

/** Chain a device's edges node-to-node; returns null (+ issues) when the device is not a single linear strand. */
function chainDeviceEdges(
	device: DeviceDefinition,
	edges: TrackEdge[],
	graph: TrackGraph,
	issues: CompileIssue[],
): { ordered: TrackEdge[]; startNode: TrackNode; endNode: TrackNode } | null {
	const fromMap = new Map<string, TrackEdge[]>();
	const toSet = new Set<string>();
	for (const e of edges) {
		const list = fromMap.get(e.from) ?? [];
		list.push(e);
		fromMap.set(e.from, list);
		toSet.add(e.to);
	}
	for (const [nodeId, list] of fromMap) {
		if (list.length > 1) {
			issues.push({
				severity: "error",
				code: "branching-device",
				deviceId: device.id,
				nodeId,
				message: `device "${device.id}" branches at node "${nodeId}" (${list.length} outgoing edges); sim transports are linear — split the branch into its own device connected by a hand-off node`,
			});
			return null;
		}
	}
	const starts = edges.map((e) => e.from).filter((n) => !toSet.has(n));
	if (starts.length !== 1) {
		issues.push({
			severity: "error",
			code: "disjoint-device",
			deviceId: device.id,
			message: `device "${device.id}" has ${starts.length} disconnected strands; a transport needs exactly one — split strands into separate devices`,
		});
		return null;
	}

	const ordered: TrackEdge[] = [];
	const visited = new Set<string>();
	let cursor = starts[0] as string;
	for (;;) {
		if (visited.has(cursor)) {
			issues.push({
				severity: "error",
				code: "cycle-in-device",
				deviceId: device.id,
				nodeId: cursor,
				message: `device "${device.id}" loops back through node "${cursor}"; a transport path cannot cycle`,
			});
			return null;
		}
		visited.add(cursor);
		const next = fromMap.get(cursor)?.[0];
		if (!next) break;
		ordered.push(next);
		cursor = next.to;
	}
	if (ordered.length !== edges.length) {
		issues.push({
			severity: "error",
			code: "disjoint-device",
			deviceId: device.id,
			message: `device "${device.id}": ${edges.length - ordered.length} edge(s) are unreachable from the chain start`,
		});
		return null;
	}
	const startNode = graph.getNode(starts[0] as string);
	const endNode = graph.getNode(cursor);
	if (!startNode || !endNode) return null;
	return { ordered, startNode, endNode };
}

function sampleEdge(
	deviceId: string,
	edge: TrackEdge,
	graph: TrackGraph,
	options: CompileTrackGraphOptions,
	issues: CompileIssue[],
): SimPoint[] | null {
	const from = graph.getNode(edge.from);
	const to = graph.getNode(edge.to);
	if (!from || !to) return null;
	const ctx = {
		kind: edge.kind,
		start: from.pose,
		end: to.pose,
		params: edge.params,
	};
	let result: SegmentGeometryResult;
	try {
		result =
			options.segmentPlugins?.generate(deviceId, ctx) ??
			generateSegmentGeometry(ctx);
	} catch (error) {
		issues.push({
			severity: "error",
			code: "invalid-config",
			deviceId,
			nodeId: edge.id,
			message: `segment "${edge.id}" (${edge.kind}) failed to generate: ${error instanceof Error ? error.message : String(error)}`,
		});
		return null;
	}
	const resolution = edge.params.resolution;
	const count =
		typeof resolution === "number" && Number.isInteger(resolution) && resolution >= 2
			? resolution
			: Math.max(
					2,
					Math.ceil(result.length / (options.sampleSpacing ?? DEFAULT_SAMPLE_SPACING)) + 1,
				);
	const points: SimPoint[] = [];
	for (let i = 0; i < count; i++) {
		points.push(toSimPoint(result.curve.getPointAt(i / (count - 1))));
	}
	return points;
}

function compileTransport(
	device: DeviceDefinition,
	edges: TrackEdge[],
	graph: TrackGraph,
	options: CompileTrackGraphOptions,
	issues: CompileIssue[],
	devices: SimDeviceDef[],
): void {
	const chain = chainDeviceEdges(device, edges, graph, issues);
	if (!chain) return;

	const points: SimPoint[] = [];
	for (const [i, edge] of chain.ordered.entries()) {
		const sampled = sampleEdge(device.id, edge, graph, options, issues);
		if (!sampled) return;
		// Drop the duplicated joint point between consecutive segments.
		points.push(...(i === 0 ? sampled : sampled.slice(1)));
	}
	if (points.length < 2) {
		issues.push({
			severity: "error",
			code: "invalid-config",
			deviceId: device.id,
			message: `device "${device.id}" produced fewer than 2 path points`,
		});
		return;
	}

	// Resolve the downstream device from the chain end's hand-off.
	let next: string | undefined;
	const handoff = chain.endNode.handoff;
	if (handoff) {
		if (handoff.fromDeviceId !== device.id) {
			issues.push({
				severity: "warning",
				code: "mid-path-handoff",
				deviceId: device.id,
				nodeId: chain.endNode.id,
				message: `hand-off at node "${chain.endNode.id}" is from "${handoff.fromDeviceId}", not "${device.id}" — check who owns this chain end`,
			});
		}
		next = handoff.toDeviceId;
		// The sim can only hand material to the START of the receiver's path.
		const receiverEdges = graph.edgesForDevice(handoff.toDeviceId);
		if (receiverEdges.length > 0) {
			const receiverToSet = new Set(receiverEdges.map((e) => e.to));
			const receiverStarts = receiverEdges
				.map((e) => e.from)
				.filter((n) => !receiverToSet.has(n));
			if (!receiverStarts.includes(chain.endNode.id)) {
				issues.push({
					severity: "warning",
					code: "mid-path-handoff",
					deviceId: device.id,
					nodeId: chain.endNode.id,
					message: `hand-off into "${handoff.toDeviceId}" happens mid-path; the sim places incoming items at that device's path start — start the receiver's edges at node "${chain.endNode.id}" or accept the visual jump`,
				});
			}
		}
	} else {
		next = `${device.id}__end`;
		devices.push({ id: next, kind: "sink" } satisfies SinkDef);
		issues.push({
			severity: options.onDeadEnd === "error" ? "error" : "warning",
			code: "dead-end",
			deviceId: device.id,
			nodeId: chain.endNode.id,
			message: `device "${device.id}" ends open at node "${chain.endNode.id}"; synthesized sink "${next}"`,
		});
	}

	const config = isObject(device.config) ? device.config : {};
	const rawSpeed = config.speed;
	const speed =
		typeof rawSpeed === "number" && Number.isFinite(rawSpeed) && rawSpeed > 0
			? rawSpeed
			: 1;
	if (rawSpeed !== undefined && speed === 1 && rawSpeed !== 1) {
		issues.push({
			severity: "warning",
			code: "invalid-config",
			deviceId: device.id,
			message: `config.speed must be a positive finite number (metres/second); got ${String(rawSpeed)}, defaulting to 1`,
		});
	}
	const rawGap = config.minGap;

	const transport: TransportDef = {
		id: device.id,
		kind: "transport",
		points,
		speed,
		// Geometry is already fully resolved by the segment generators —
		// re-filleting in the sim would double-round the corners.
		cornerRadius: 0,
		next,
	};
	if (typeof rawGap === "number" && Number.isFinite(rawGap) && rawGap >= 0) {
		transport.minGap = rawGap;
	}
	devices.push(transport);
}

function compileEdgelessDevice(
	device: DeviceDefinition,
	issues: CompileIssue[],
	devices: SimDeviceDef[],
): void {
	const config = isObject(device.config) ? device.config : {};
	const simKind =
		typeof config.simKind === "string"
			? config.simKind
			: device.kind === "sink"
				? "sink"
				: undefined;

	switch (simKind) {
		case "sink":
			devices.push({ id: device.id, kind: "sink" } satisfies SinkDef);
			return;
		case "source": {
			const def = {
				id: device.id,
				kind: "source",
				output: config.output,
				interval: config.interval,
				itemTypes: config.itemTypes,
			} as SourceDef;
			devices.push(def);
			return;
		}
		case "junction": {
			const position = readPoint(config.position);
			if (!position) {
				issues.push({
					severity: "error",
					code: "invalid-config",
					deviceId: device.id,
					message: `junction "${device.id}" needs config.position ({x,y,z} or [x,y,z]) — edgeless devices carry no graph geometry`,
				});
				return;
			}
			devices.push({
				id: device.id,
				kind: "junction",
				position,
				dwell: typeof config.dwell === "number" ? config.dwell : 0.4,
				...(isObject(config.routes) ? { routes: config.routes } : {}),
				...(isObject(config.alternate)
					? { alternate: config.alternate as JunctionDef["alternate"] }
					: {}),
				...(typeof config.routeBy === "string" ? { routeBy: config.routeBy } : {}),
			} as JunctionDef);
			return;
		}
		case "inspector": {
			const position = readPoint(config.position);
			if (!position) {
				issues.push({
					severity: "error",
					code: "invalid-config",
					deviceId: device.id,
					message: `inspector "${device.id}" needs config.position`,
				});
				return;
			}
			devices.push({
				id: device.id,
				kind: "inspector",
				position,
				dwell: typeof config.dwell === "number" ? config.dwell : 0.3,
				defaultVerdict: config.defaultVerdict,
				writesAttr: config.writesAttr,
				routes: config.routes,
				...(isObject(config.random)
					? { random: config.random as InspectorDef["random"] }
					: {}),
				...(Array.isArray(config.rules)
					? { rules: config.rules as InspectorDef["rules"] }
					: {}),
			} as InspectorDef);
			return;
		}
		case "buffer": {
			const position = readPoint(config.position);
			if (!position) {
				issues.push({
					severity: "error",
					code: "invalid-config",
					deviceId: device.id,
					message: `buffer "${device.id}" needs config.position`,
				});
				return;
			}
			devices.push({
				id: device.id,
				kind: "buffer",
				position,
				columns: config.columns,
				...(typeof config.rows === "number" ? { rows: config.rows } : {}),
				...(typeof config.layers === "number" ? { layers: config.layers } : {}),
				...(Array.isArray(config.spacing)
					? { spacing: config.spacing as BufferDef["spacing"] }
					: {}),
				onFull: config.onFull === "consume" ? "consume" : "block",
				...(typeof config.drainAfter === "number"
					? { drainAfter: config.drainAfter }
					: {}),
			} as BufferDef);
			return;
		}
		default:
			issues.push({
				severity: "warning",
				code: "skipped-device",
				deviceId: device.id,
				message: `device "${device.id}" owns no edges and declares no config.simKind — skipped (it will not exist in the running sim)`,
			});
	}
}

/**
 * Compile a `TrackGraph` into a `FactoryLayout`. Compile problems and schema
 * validation are reported separately: `issues` describes what the compiler
 * had to decide or reject, `layoutIssues` is the layout schema's own verdict
 * on the result (so an external-only reference still warns, not errors).
 */
export function compileTrackGraph(
	graph: TrackGraph,
	options: CompileTrackGraphOptions = {},
): CompileTrackGraphResult {
	const issues: CompileIssue[] = [];
	const devices: SimDeviceDef[] = [];

	for (const device of graph.deviceList) {
		const edges = graph.edgesForDevice(device.id);
		if (edges.length > 0) {
			compileTransport(device, edges, graph, options, issues, devices);
		} else {
			compileEdgelessDevice(device, issues, devices);
		}
	}
	if (options.extraDevices) devices.push(...options.extraDevices);

	const layout: FactoryLayout = {
		version: 1,
		...(options.name ? { name: options.name } : {}),
		devices,
	};
	return { layout, issues, layoutIssues: validateFactoryLayout(layout) };
}
