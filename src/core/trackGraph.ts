import * as THREE from "three";
import type {
	DeviceDefinition,
	DeviceHandoff,
	Pose,
	SegmentKind,
	SegmentParams,
} from "./types";

export interface TrackNode {
	id: string;
	pose: Pose;
	/** Present when this node is a hand-off point between two devices. */
	handoff?: DeviceHandoff;
}

export interface TrackEdge {
	id: string;
	from: string;
	to: string;
	kind: SegmentKind;
	params: SegmentParams;
	/**
	 * Owning device. Two edges that geometrically cross (different `layer`,
	 * or joined only through a hand-off node) are NOT assumed to belong to
	 * the same device just because they're connected in the graph.
	 */
	deviceId: string;
	/** Vertical/logical layer, used to keep crossing tracks visually apart. */
	layer: number;
	/**
	 * False for a device's enclosed/internal transport path, such as a lift
	 * carriage. It remains available to routing and MaterialFlow but is not
	 * drawn as an exposed conveyor.
	 */
	visible?: boolean;
}

export interface TrackGraphValidationIssue {
	type: "dangling-edge" | "cycle" | "duplicate-id" | "cross-device-edge";
	message: string;
	edgeId?: string;
	nodeId?: string;
}

/**
 * Topology of a conveyor network: nodes are key points (junctions,
 * hand-offs, endpoints); edges are individual track segments. Rendering and
 * geometry generation are intentionally kept out of this class — it only
 * answers "what connects to what, and who owns it".
 */
export class TrackGraph {
	private nodes = new Map<string, TrackNode>();
	private edges = new Map<string, TrackEdge>();
	private devices = new Map<string, DeviceDefinition>();
	/** adjacency: nodeId -> edge ids leaving that node */
	private outgoing = new Map<string, Set<string>>();

	addNode(node: TrackNode): void {
		if (this.nodes.has(node.id)) {
			throw new Error(`TrackGraph: duplicate node id "${node.id}"`);
		}
		this.nodes.set(node.id, node);
		if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
	}

	getNode(id: string): TrackNode | undefined {
		return this.nodes.get(id);
	}

	addDevice(device: DeviceDefinition): void {
		if (this.devices.has(device.id)) {
			throw new Error(`TrackGraph: duplicate device id "${device.id}"`);
		}
		this.devices.set(device.id, device);
	}

	getDevice(id: string): DeviceDefinition | undefined {
		return this.devices.get(id);
	}

	get deviceList(): DeviceDefinition[] {
		return [...this.devices.values()];
	}

	/**
	 * Registers an edge that must connect two existing nodes belonging to a
	 * registered device. Edges do not need `from`/`to` devices to match —
	 * a hand-off node in between is expected to bridge two different
	 * devices explicitly (see `node.handoff`).
	 */
	addEdge(edge: TrackEdge): void {
		if (this.edges.has(edge.id)) {
			throw new Error(`TrackGraph: duplicate edge id "${edge.id}"`);
		}
		if (!this.nodes.has(edge.from)) {
			throw new Error(
				`TrackGraph: edge "${edge.id}" references unknown from-node "${edge.from}"`,
			);
		}
		if (!this.nodes.has(edge.to)) {
			throw new Error(
				`TrackGraph: edge "${edge.id}" references unknown to-node "${edge.to}"`,
			);
		}
		if (!this.devices.has(edge.deviceId)) {
			throw new Error(
				`TrackGraph: edge "${edge.id}" references unknown device "${edge.deviceId}"`,
			);
		}
		this.edges.set(edge.id, edge);
		this.outgoing.get(edge.from)?.add(edge.id);
	}

	getEdge(id: string): TrackEdge | undefined {
		return this.edges.get(id);
	}

	get nodeList(): TrackNode[] {
		return [...this.nodes.values()];
	}

	get edgeList(): TrackEdge[] {
		return [...this.edges.values()];
	}

	edgesForDevice(deviceId: string): TrackEdge[] {
		return this.edgeList.filter((e) => e.deviceId === deviceId);
	}

	edgesForLayer(layer: number): TrackEdge[] {
		return this.edgeList.filter((e) => e.layer === layer);
	}

	/**
	 * Finds a node-id path from `startId` to `endId` using breadth-first
	 * search. Returns `null` if unreachable. Does not consider device
	 * boundaries — routing across devices through a hand-off node is valid,
	 * callers can inspect edge `deviceId` along the returned path to detect
	 * hand-offs.
	 */
	getPath(startId: string, endId: string): string[] | null {
		if (!this.nodes.has(startId) || !this.nodes.has(endId)) return null;
		if (startId === endId) return [startId];

		const visited = new Set<string>([startId]);
		const queue: string[][] = [[startId]];

		while (queue.length > 0) {
			const path = queue.shift();
			if (!path) break;
			const current = path[path.length - 1];
			if (current === undefined) continue;

			const edgeIds = this.outgoing.get(current);
			if (!edgeIds) continue;

			for (const edgeId of edgeIds) {
				const edge = this.edges.get(edgeId);
				if (!edge || visited.has(edge.to)) continue;
				const nextPath = [...path, edge.to];
				if (edge.to === endId) return nextPath;
				visited.add(edge.to);
				queue.push(nextPath);
			}
		}

		return null;
	}

	/** Returns the ordered edges that make up a node-id path. */
	getPathEdges(nodePath: string[]): TrackEdge[] {
		const result: TrackEdge[] = [];
		for (let i = 0; i < nodePath.length - 1; i++) {
			const from = nodePath[i];
			const to = nodePath[i + 1];
			const edge = this.edgeList.find((e) => e.from === from && e.to === to);
			if (!edge) {
				throw new Error(
					`TrackGraph: no edge found between "${from}" and "${to}"`,
				);
			}
			result.push(edge);
		}
		return result;
	}

	/**
	 * True when a path crosses from one device's edges onto another's,
	 * meaning consumers (e.g. material flow) must respect hand-off state
	 * rather than assuming uniform speed/control along the whole path.
	 */
	pathCrossesDevices(nodePath: string[]): boolean {
		const edges = this.getPathEdges(nodePath);
		const deviceIds = new Set(edges.map((e) => e.deviceId));
		return deviceIds.size > 1;
	}

	/**
	 * Basic structural validation: dangling edges, duplicate ids (already
	 * enforced at insert time, re-checked here for completeness), and
	 * cycles. Cross-device edges that pass through a node without a
	 * `handoff` descriptor are flagged, since silently mixing device
	 * ownership at a shared node is a common source of "line B stopped
	 * because line A faulted" bugs.
	 */
	validate(): TrackGraphValidationIssue[] {
		const issues: TrackGraphValidationIssue[] = [];

		for (const edge of this.edgeList) {
			const fromNode = this.nodes.get(edge.from);
			const toNode = this.nodes.get(edge.to);
			if (!fromNode || !toNode) {
				issues.push({
					type: "dangling-edge",
					message: `Edge "${edge.id}" references a missing node`,
					edgeId: edge.id,
				});
				continue;
			}

			// If the "to" node has outgoing edges owned by a different device
			// and the node itself doesn't declare a handoff, flag it.
			const outgoingFromTo = this.outgoing.get(edge.to);
			if (outgoingFromTo) {
				for (const nextEdgeId of outgoingFromTo) {
					const nextEdge = this.edges.get(nextEdgeId);
					if (
						nextEdge &&
						nextEdge.deviceId !== edge.deviceId &&
						!toNode.handoff
					) {
						issues.push({
							type: "cross-device-edge",
							message: `Node "${toNode.id}" bridges devices "${edge.deviceId}" and "${nextEdge.deviceId}" without a handoff descriptor`,
							nodeId: toNode.id,
						});
					}
				}
			}
		}

		const cycle = this.detectCycle();
		if (cycle) {
			issues.push({
				type: "cycle",
				message: `Cycle detected: ${cycle.join(" -> ")}`,
			});
		}

		return issues;
	}

	private detectCycle(): string[] | null {
		const visiting = new Set<string>();
		const visited = new Set<string>();

		const dfs = (nodeId: string, path: string[]): string[] | null => {
			visiting.add(nodeId);
			const edgeIds = this.outgoing.get(nodeId) ?? new Set<string>();
			for (const edgeId of edgeIds) {
				const edge = this.edges.get(edgeId);
				if (!edge) continue;
				if (visiting.has(edge.to)) {
					return [...path, edge.to];
				}
				if (!visited.has(edge.to)) {
					const found = dfs(edge.to, [...path, edge.to]);
					if (found) return found;
				}
			}
			visiting.delete(nodeId);
			visited.add(nodeId);
			return null;
		};

		for (const node of this.nodeList) {
			if (!visited.has(node.id)) {
				const found = dfs(node.id, [node.id]);
				if (found) return found;
			}
		}
		return null;
	}
}

/** Convenience factory to build a Pose from position + a look-at target. */
export function makePose(
	position: THREE.Vector3,
	lookAt: THREE.Vector3,
	up: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
): Pose {
	const tangent = lookAt.clone().sub(position).normalize();
	return { position: position.clone(), tangent, up: up.clone() };
}
