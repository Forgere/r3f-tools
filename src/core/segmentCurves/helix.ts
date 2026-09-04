import * as THREE from "three";
import type { SegmentContext, SegmentGeometryResult } from "../types";

/**
 * A helical (spiral) curve, parameterized by radius, number of turns, and
 * total height gained. Implements the `THREE.Curve` interface directly
 * (three.js has no built-in helix curve) so it can be dropped into any
 * pipeline that already consumes `THREE.Curve` — e.g. `ConveyorBelt`'s
 * `curvePath` sampling.
 *
 * The curve is built around its own local origin/axis. `generateHelix`
 * translates that curve to the graph's start node and applies a distributed
 * endpoint correction so a graph edge always terminates precisely at its
 * declared end node.
 */
export class HelixCurve extends THREE.Curve<THREE.Vector3> {
	constructor(
		private radius: number,
		private turns: number,
		private height: number,
		private direction: 1 | -1 = 1,
	) {
		super();
	}

	getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
		const angle = this.direction * t * this.turns * Math.PI * 2;
		const x = Math.cos(angle) * this.radius;
		const z = Math.sin(angle) * this.radius;
		const y = t * this.height;
		return optionalTarget.set(x, y, z);
	}
}

/**
 * Builds a helix segment and rigidly transforms it so it starts at
 * `start.position`/`start.tangent` and rises `params.height` over
 * `params.turns` revolutions of `params.radius`.
 */
export function generateHelix(ctx: SegmentContext): SegmentGeometryResult {
	const { start, end, params } = ctx;
	const radius = params.radius ?? 1;
	const turns = params.turns ?? 1;
	const height = params.height ?? end.position.y - start.position.y;
	const direction = params.direction ?? 1;

	const localCurve = new HelixCurve(radius, turns, height, direction);

	// The local curve starts at (radius, 0, 0). Rotate it about its vertical
	// axis to match the start tangent's horizontal projection; vertical
	// translation then preserves its rise rather than rotating it away from Y.
	const localStart = localCurve.getPoint(0);
	const localNext = localCurve.getPoint(0.001);
	const localTangent = localNext.clone().sub(localStart);
	localTangent.y = 0;
	localTangent.normalize();
	const startTangent = start.tangent.clone();
	startTangent.y = 0;
	if (startTangent.lengthSq() === 0) startTangent.set(0, 0, 1);
	startTangent.normalize();
	const angle =
		Math.atan2(startTangent.z, startTangent.x) -
		Math.atan2(localTangent.z, localTangent.x);
	const orientation = new THREE.Quaternion().setFromAxisAngle(
		new THREE.Vector3(0, 1, 0),
		angle,
	);

	const resolution = params.resolution ?? Math.max(32, Math.round(turns * 32));
	const localEnd = localCurve.getPoint(1);
	const expectedEnd = start.position
		.clone()
		.add(localEnd.sub(localStart).applyQuaternion(orientation));
	const endpointCorrection = end.position.clone().sub(expectedEnd);
	const points: THREE.Vector3[] = [];
	for (let i = 0; i <= resolution; i++) {
		const t = i / resolution;
		const localPoint = localCurve.getPoint(t);
		const offset = localPoint.clone().sub(localStart);
		offset.applyQuaternion(orientation);
		const point = start.position.clone().add(offset);

		// Graph nodes are the source of truth. This also supports uncommon
		// layouts where the exit is horizontally offset from the entrance.
		point.addScaledVector(endpointCorrection, t);
		points.push(point);
	}

	const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom");
	return { curve, length: curve.getLength() };
}
