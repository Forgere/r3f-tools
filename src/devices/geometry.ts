import * as THREE from "three";
import { RoundedBoxGeometry } from "three-stdlib";

/**
 * Cached geometry factory for device plugins.
 *
 * Devices repeat the same handful of shapes, so every geometry is memoised by
 * its parameters: a hundred transfer tables share one set of buffers.
 */
const cache = new Map<string, THREE.BufferGeometry>();

function memo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
	const existing = cache.get(key);
	if (existing) return existing as T;
	const geometry = make();
	cache.set(key, geometry);
	return geometry;
}

export function roundedBoxGeometry(
	width: number,
	height: number,
	depth: number,
	radius = 0.03,
	segments = 2,
): THREE.BufferGeometry {
	const limit = Math.min(width, height, depth) / 2 - 1e-3;
	const r = Math.max(0.001, Math.min(radius, Math.max(limit, 0.001)));
	const key = `rb|${width}|${height}|${depth}|${r.toFixed(4)}|${segments}`;
	return memo(
		key,
		() => new RoundedBoxGeometry(width, height, depth, segments, r),
	);
}

export function cylinderGeometry(
	radiusTop: number,
	radiusBottom: number,
	height: number,
	segments = 16,
): THREE.BufferGeometry {
	const key = `cy|${radiusTop}|${radiusBottom}|${height}|${segments}`;
	return memo(
		key,
		() => new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
	);
}

export function sphereGeometry(radius: number, segments = 12): THREE.BufferGeometry {
	const key = `sp|${radius}|${segments}`;
	return memo(key, () => new THREE.SphereGeometry(radius, segments, segments));
}
