import type { SimPoint } from "./types";

/**
 * Arc-length parameterised polyline with factory-style filleted corners.
 * Pure math, no three.js — mirrors the visual `filletPolyline` used by the
 * conveyor rendering so simulated item positions match the belt geometry.
 */
export interface SimPath {
	readonly points: readonly SimPoint[];
	/** cumulative[i] = arc length from points[0] to points[i]. */
	readonly cumulative: readonly number[];
	readonly length: number;
}

export interface SimPathSample {
	position: SimPoint;
	/** Yaw angle in radians from the local path tangent. */
	heading: number;
}

function distanceBetween(a: SimPoint, b: SimPoint): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const dz = b.z - a.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function quadraticBezier(
	a: SimPoint,
	control: SimPoint,
	b: SimPoint,
	t: number,
): SimPoint {
	const u = 1 - t;
	const w0 = u * u;
	const w1 = 2 * u * t;
	const w2 = t * t;
	return {
		x: w0 * a.x + w1 * control.x + w2 * b.x,
		y: w0 * a.y + w1 * control.y + w2 * b.y,
		z: w0 * a.z + w1 * control.z + w2 * b.z,
	};
}

/**
 * Replaces each interior corner with a small quadratic-bezier fillet and
 * densifies it, so straight runs stay perfectly straight and corners are
 * smooth (like real corner-transfer conveyors).
 */
export function filletSimPolyline(
	points: SimPoint[],
	radius = 0.45,
	arcSegments = 6,
): SimPoint[] {
	if (points.length < 3) return points.map((p) => ({ ...p }));

	const firstPoint = points[0];
	if (!firstPoint) return [];
	const out: SimPoint[] = [{ ...firstPoint }];
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1];
		const cur = points[i];
		const next = points[i + 1];
		if (!prev || !cur || !next) continue;

		const dIn = distanceBetween(prev, cur);
		const dOut = distanceBetween(cur, next);
		// Clamp so adjacent fillets never overlap a shared straight segment.
		const r = Math.min(radius, dIn * 0.45, dOut * 0.45);

		const inLen = Math.max(dIn, 1e-9);
		const outLen = Math.max(dOut, 1e-9);
		const a: SimPoint = {
			x: cur.x - ((cur.x - prev.x) / inLen) * r,
			y: cur.y - ((cur.y - prev.y) / inLen) * r,
			z: cur.z - ((cur.z - prev.z) / inLen) * r,
		};
		const b: SimPoint = {
			x: cur.x + ((next.x - cur.x) / outLen) * r,
			y: cur.y + ((next.y - cur.y) / outLen) * r,
			z: cur.z + ((next.z - cur.z) / outLen) * r,
		};

		if (r > 1e-4) {
			for (let s = 0; s <= arcSegments; s++) {
				out.push(quadraticBezier(a, cur, b, s / arcSegments));
			}
		} else {
			out.push(a, b);
		}
	}
	const last = points[points.length - 1];
	if (last) out.push({ ...last });
	return out;
}

/** Builds an arc-length table once; sampling afterwards is O(log n). */
export function buildSimPath(
	points: SimPoint[],
	cornerRadius = 0.45,
	arcSegments = 6,
): SimPath {
	const dense =
		cornerRadius > 0
			? filletSimPolyline(points, cornerRadius, arcSegments)
			: points.map((p) => ({ ...p }));

	const cumulative: number[] = [0];
	let acc = 0;
	for (let i = 1; i < dense.length; i++) {
		const prev = dense[i - 1];
		const cur = dense[i];
		const step = prev && cur ? distanceBetween(prev, cur) : 0;
		acc += step;
		cumulative.push(acc);
	}
	return {
		points: dense,
		cumulative,
		length: acc,
	};
}

/** Samples position + heading at an arc-length distance along the path. */
export function sampleSimPath(path: SimPath, distance: number): SimPathSample {
	const { points, cumulative, length } = path;
	const lastIdx = cumulative.length - 1;
	if (lastIdx < 1 || !points[0] || !points[1]) {
		const p = points[0] ?? { x: 0, y: 0, z: 0 };
		return { position: { ...p }, heading: 0 };
	}

	const d = Math.min(Math.max(distance, 0), length);

	// Binary search for the segment containing d.
	let lo = 0;
	let hi = lastIdx;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if ((cumulative[mid] ?? 0) < d) lo = mid + 1;
		else hi = mid;
	}
	const i = Math.max(1, lo);
	const segStart = cumulative[i - 1] ?? 0;
	const segEnd = cumulative[i] ?? segStart;
	const segLen = segEnd - segStart;
	const t = segLen > 1e-9 ? (d - segStart) / segLen : 0;

	const a = points[i - 1];
	const b = points[i];
	if (!a || !b) {
		const p = points[0];
		return { position: p ? { ...p } : { x: 0, y: 0, z: 0 }, heading: 0 };
	}

	return {
		position: {
			x: a.x + (b.x - a.x) * t,
			y: a.y + (b.y - a.y) * t,
			z: a.z + (b.z - a.z) * t,
		},
		heading: Math.atan2(b.x - a.x, b.z - a.z),
	};
}
