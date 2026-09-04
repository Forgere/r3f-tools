import type * as THREE from "three";
import { generateSegmentGeometry } from "./segmentCurves";
import type { TrackEdge, TrackGraph } from "./trackGraph";
import type { SegmentContext } from "./types";

export interface ResolvedTrackSegment {
	edge: TrackEdge;
	curve: THREE.Curve<THREE.Vector3>;
	length: number;
}

export interface ResolvedTrackRoute {
	nodeIds: string[];
	segments: ResolvedTrackSegment[];
	length: number;
}

/**
 * Resolves a graph route into sampleable segment curves. It verifies that
 * every device change occurs at a matching, explicitly declared hand-off;
 * spatial intersections are never treated as a transfer.
 */
export function resolveTrackRoute(
	graph: TrackGraph,
	startNodeId: string,
	endNodeId: string,
): ResolvedTrackRoute {
	const nodeIds = graph.getPath(startNodeId, endNodeId);
	if (!nodeIds) {
		throw new Error(
			`Track route: no path from "${startNodeId}" to "${endNodeId}"`,
		);
	}

	const edges = graph.getPathEdges(nodeIds);
	const segments = edges.map((edge) => {
		const start = graph.getNode(edge.from);
		const end = graph.getNode(edge.to);
		if (!start || !end) {
			throw new Error(`Track route: edge "${edge.id}" has a missing node`);
		}
		const context: SegmentContext = {
			kind: edge.kind,
			start: start.pose,
			end: end.pose,
			params: edge.params,
		};
		const geometry = generateSegmentGeometry(context);
		return { edge, curve: geometry.curve, length: geometry.length };
	});

	for (let index = 0; index < segments.length - 1; index++) {
		const current = segments[index];
		const next = segments[index + 1];
		if (!current || !next || current.edge.deviceId === next.edge.deviceId) {
			continue;
		}
		const handoff = graph.getNode(current.edge.to)?.handoff;
		if (
			!handoff ||
			handoff.fromDeviceId !== current.edge.deviceId ||
			handoff.toDeviceId !== next.edge.deviceId
		) {
			throw new Error(
				`Track route: device transition "${current.edge.deviceId}" -> "${next.edge.deviceId}" at "${current.edge.to}" requires a matching handoff`,
			);
		}
	}

	return {
		nodeIds,
		segments,
		length: segments.reduce((sum, segment) => sum + segment.length, 0),
	};
}
