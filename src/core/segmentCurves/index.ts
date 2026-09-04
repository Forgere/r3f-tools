import type {
	SegmentContext,
	SegmentGeometryGenerator,
	SegmentGeometryResult,
	SegmentKind,
} from "../types";
import { generateCurve } from "./curve";
import { generateHelix } from "./helix";
import { generateIncline } from "./incline";
import { generateStraight } from "./straight";

const generators: Record<string, SegmentGeometryGenerator> = {
	straight: generateStraight,
	curve: generateCurve,
	helix: generateHelix,
	incline: generateIncline,
};

/** Registers or overrides the geometry generator used for a given `kind`. */
export function registerSegmentGeometry(
	kind: SegmentKind,
	generator: SegmentGeometryGenerator,
): void {
	generators[kind] = generator;
}

/**
 * Dispatches to the geometry generator registered for `ctx.kind`, falling
 * back to `straight` for unknown kinds so a typo or missing plugin never
 * breaks rendering entirely.
 */
export function generateSegmentGeometry(
	ctx: SegmentContext,
): SegmentGeometryResult {
	const generator = generators[ctx.kind] ?? generators.straight;
	if (!generator) {
		throw new Error("SegmentGeometry: no fallback generator registered");
	}
	return generator(ctx);
}

export { generateStraight, generateCurve, generateHelix, generateIncline };
