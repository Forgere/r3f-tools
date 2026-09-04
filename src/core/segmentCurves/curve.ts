import * as THREE from "three";
import type { SegmentContext, SegmentGeometryResult } from "../types";

/**
 * A smooth curved segment between two poses. Uses a cubic Bezier with
 * tangent-derived control handles so the curve enters/exits matching the
 * `start.tangent`/`end.tangent` directions — this is what lets adjacent
 * segments join without a visible kink.
 */
export function generateCurve(ctx: SegmentContext): SegmentGeometryResult {
	const { start, end, params } = ctx;

	const distance = start.position.distanceTo(end.position);
	const handleLength = (params.radius ?? distance / 2) || distance / 2 || 1;

	const control1 = start.position
		.clone()
		.add(start.tangent.clone().normalize().multiplyScalar(handleLength));
	const control2 = end.position
		.clone()
		.sub(end.tangent.clone().normalize().multiplyScalar(handleLength));

	const curve = new THREE.CubicBezierCurve3(
		start.position.clone(),
		control1,
		control2,
		end.position.clone(),
	);

	return { curve, length: curve.getLength() };
}
