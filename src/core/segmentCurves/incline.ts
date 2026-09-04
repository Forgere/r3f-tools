import * as THREE from "three";
import type { SegmentContext, SegmentGeometryResult } from "../types";

/**
 * A straight incline/decline segment: travels horizontally toward `end`
 * while rising or falling by `params.height` (defaults to the actual
 * height difference between `start` and `end` positions).
 */
export function generateIncline(ctx: SegmentContext): SegmentGeometryResult {
	const { start, end, params } = ctx;

	const height = params.height ?? end.position.y - start.position.y;
	const endPosition = end.position.clone();
	endPosition.y = start.position.y + height;

	const curve = new THREE.LineCurve3(start.position.clone(), endPosition);
	return { curve, length: curve.getLength() };
}
