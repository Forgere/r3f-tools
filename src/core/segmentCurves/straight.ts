import * as THREE from "three";
import type { SegmentContext, SegmentGeometryResult } from "../types";

/** A simple straight-line segment between the context's start and end poses. */
export function generateStraight(ctx: SegmentContext): SegmentGeometryResult {
	const { start, end } = ctx;
	const curve = new THREE.LineCurve3(start.position, end.position);
	return { curve, length: curve.getLength() };
}
