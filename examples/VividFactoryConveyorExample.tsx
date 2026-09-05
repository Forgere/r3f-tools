import { OrbitControls, RoundedBox, Stats, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { button, useControls } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
	BUILTIN_DEVICE_PLUGINS,
	BUFFER_KIND,
	ConveyorBelt,
	cuteLiftTransferPlugin,
	type DeviceLayout,
	DeviceRendererHost,
	DeviceRendererRegistry,
	ExternalContract,
	type ExternalItemState,
	FactorySim,
	INSPECTOR_KIND,
	INSPECTION_PLUGINS,
	InstancedMeshPool,
	type InstancedMeshPoolRef,
	type SimDeviceDef,
	type SimEvent,
	type SimPoint,
	type SimStats,
	TRANSFER_KIND,
} from "../src";

// -----------------------------------------------------------------------------
// Palette & styling inspired by the MICRODUCK reference image:
// rounded shapes, soft shadows, pastel plastics, warm light.
// -----------------------------------------------------------------------------
const PALETTE = {
	mint: "#8BD3C7",
	lavender: "#C4B5E0",
	peach: "#F4A261",
	sky: "#9FD8F0",
	butter: "#F7E3A4",
	cream: "#F5F2EB",
	frame: "#E8E4DC",
	floor: "#3A4A4F",
	warmLight: "#FFF4E6",
	cargoColors: ["#FFB7B2", "#B5EAD7", "#C7CEEA", "#FFDAC1", "#FDFD96"],
} as const;

const COLOR_MINT = new THREE.Color(PALETTE.mint);
const COLOR_LAVENDER = new THREE.Color(PALETTE.lavender);
const COLOR_PEACH = new THREE.Color(PALETTE.peach);
const COLOR_SKY = new THREE.Color(PALETTE.sky);
const COLOR_BUTTER = new THREE.Color(PALETTE.butter);
// Demo conveyors (inclined + spiral) get their own distinct tints.
const COLOR_CORAL = new THREE.Color("#FF8C69");
const COLOR_SLATE = new THREE.Color("#8E9BAE");

// -----------------------------------------------------------------------------
// Custom belt shader with arrow animation. Mirrors the built-in ConveyorBelt
// shader so we can tint each line independently.
// -----------------------------------------------------------------------------
function createBeltMaterial(color: THREE.Color): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms: {
			time: { value: 0 },
			color: { value: color },
			arrowSpacing: { value: 1.2 },
			arrowSpeed: { value: 0.5 },
			arrowLength: { value: 0.35 },
		},
		vertexShader: `
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			uniform float time;
			uniform vec3 color;
			uniform float arrowSpacing;
			uniform float arrowSpeed;
			uniform float arrowLength;
			varying vec2 vUv;

			void main() {
				float speed = time * arrowSpeed;
				float pos = mod(vUv.y - speed, arrowSpacing);
				float arrow = smoothstep(0.0, arrowLength, pos);
				arrow *= smoothstep(arrowLength, 0.0, pos - arrowLength);
				vec3 finalColor = mix(color * 0.25, color, arrow);
				gl_FragColor = vec4(finalColor, 0.85);
			}
		`,
		transparent: true,
		side: THREE.DoubleSide,
	});
}

// -----------------------------------------------------------------------------
// Scene layout. Coordinates are world units; Y is up.
// Two zones: the SIMULATED factory (upper, z >= -3) and the EXTERNAL
// digital-twin lanes (lower, z <= -7) — each fed by a different signal kind.
// -----------------------------------------------------------------------------
interface BeltPath {
	id: string;
	color: THREE.Color;
	points: THREE.Vector3[];
	frameWidth?: number;
	/** Already a smooth curve (e.g. an arc): skip the sharp-corner fillet. */
	smooth?: boolean;
	/** Skip support legs (e.g. a spiral whose tube a vertical post would pierce). */
	noLegs?: boolean;
}

const BELT_HEIGHT = 0.7;
const BELT_WIDTH = 1.1;
// The packaging (blue) branch is a GROUND-LEVEL line (same height as every
// other belt) that taps OFF the dedicated junction-P on the infeed-B (teal)
// line via a lift-transfer (顶升移栽): crates divert to packaging, parcels keep
// rolling to junction-H. infeed-B and packaging only share the junction-P centre.

/**
 * Transfer decks are the SAME width as the line they are spliced into, so the
 * conveyor clips stop exactly at the deck edge and the load rolls straight
 * over the rollers.
 */
const JUNCTION_HALF = BELT_WIDTH / 2;
/** Metres the cassette lifts a load clear of the rollers. */
const LIFT_HEIGHT = 0.13;

// --- Junction / station centres (shared by topology + renderers) ------------
const MERGE_CENTER = new THREE.Vector3(-6, BELT_HEIGHT, 0); // junction-H
const SORTER_CENTER = new THREE.Vector3(6, BELT_HEIGHT, 0); // junction-S
// Dedicated junction on the infeed-B (teal) line where the packaging branch
// taps off via a lift-transfer (顶升移栽). Same height as every other belt.
const JUNCTION_P_CENTER = new THREE.Vector3(-6, BELT_HEIGHT, 5); // junction-P
const INSPECTOR_CENTER = new THREE.Vector3(0, BELT_HEIGHT, 0); // inspector-1
const INSPECTOR2_CENTER = new THREE.Vector3(12, BELT_HEIGHT, 3); // inspector-2
const REJECT_RACK_CENTER = new THREE.Vector3(0, BELT_HEIGHT, 3); // reject-rack-1
const REJECT_RACK2_CENTER = new THREE.Vector3(12, BELT_HEIGHT, 6); // reject-rack-2

const REJECT_COLUMNS = 4;
const REJECT_ROWS = 3;
const REJECT_LAYERS = 1;
const REJECT_SPACING = 0.32;

// Stations that interrupt the belt: junctions + inspectors. The inspection
// station now renders its own conveyor deck, so the belt must stop at its edges
// to avoid clipping through the gantry posts.
const JUNCTIONS = [
	{ center: MERGE_CENTER, gap: JUNCTION_HALF },
	{ center: SORTER_CENTER, gap: JUNCTION_HALF },
	{ center: JUNCTION_P_CENTER, gap: JUNCTION_HALF },
	{ center: INSPECTOR_CENTER, gap: JUNCTION_HALF },
	{ center: INSPECTOR2_CENTER, gap: JUNCTION_HALF },
];

/**
 * Lift-cycle timings shared by both decks.
 */
const LIFT_CYCLE = {
	dwell: 0.4,
	upTime: 0.18,
	transferTime: 0.34,
	downTime: 0.18,
} as const;

const TRANSFER_SPECS = [
	{
		id: "junction-P",
		center: JUNCTION_P_CENTER,
		routes: ["teal-out", "blue-line"],
	},
	{
		id: "junction-H",
		center: MERGE_CENTER,
		routes: ["purple-line"],
	},
	{
		id: "junction-S",
		center: SORTER_CENTER,
		routes: ["peach-line", "yellow-line"],
	},
] as const;

// -----------------------------------------------------------------------------
// External digital-twin lanes — one per signal kind (§14). Each is a straight
// belt fed entirely by an external frame; in "sim" mode it stays empty (no
// data), demonstrating the three-mode "some devices have no data" case.
// -----------------------------------------------------------------------------
type ExtKind = "entry" | "span" | "pose" | "progress";

interface ExtLaneConfig {
	id: string;
	sinkId: string;
	z: number;
	color: THREE.Color;
	label: string;
	defaultKind: ExtKind;
	defaultFrame: "world" | "local";
	cargoColorIndex: number;
	speed: number;
}

const EXT_LANES: ExtLaneConfig[] = [
	{
		id: "ext-pose",
		sinkId: "ext-sink-pose",
		z: -8,
		color: COLOR_SKY,
		label: "Pose 自有坐标",
		defaultKind: "pose",
		defaultFrame: "local",
		cargoColorIndex: 2,
		speed: 2.2,
	},
	{
		id: "ext-progress",
		sinkId: "ext-sink-progress",
		z: -11,
		color: COLOR_PEACH,
		label: "Progress 百分比",
		defaultKind: "progress",
		defaultFrame: "world",
		cargoColorIndex: 3,
		speed: 2.2,
	},
	{
		id: "ext-entry",
		sinkId: "ext-sink-entry",
		z: -14,
		color: COLOR_BUTTER,
		label: "Entry 入口信号",
		defaultKind: "entry",
		defaultFrame: "world",
		cargoColorIndex: 0,
		speed: 2.2,
	},
	{
		id: "ext-span",
		sinkId: "ext-sink-span",
		z: -17,
		color: COLOR_LAVENDER,
		label: "Span 入口+出口",
		defaultKind: "span",
		defaultFrame: "world",
		cargoColorIndex: 1,
		speed: 2.2,
	},
];

const EXT_LANE_X0 = -8;
const EXT_LANE_X1 = 8;

// Precomputed geometry per external lane (curve + arc length + item-id block)
// so the synthetic feeder can advance items without duplicating path math.
const EXT_LANE_GEOM: Record<string, { curve: THREE.CatmullRomCurve3; length: number; ids: number[] }> = {};
for (let i = 0; i < EXT_LANES.length; i++) {
	const lane = EXT_LANES[i];
	if (!lane) continue;
	const curve = new THREE.CatmullRomCurve3([
		new THREE.Vector3(EXT_LANE_X0, BELT_HEIGHT, lane.z),
		new THREE.Vector3(EXT_LANE_X1, BELT_HEIGHT, lane.z),
	]);
	const ids = [9001 + i * 20, 9002 + i * 20, 9003 + i * 20, 9004 + i * 20];
	EXT_LANE_GEOM[lane.id] = { curve, length: curve.getLength(), ids };
}

/**
 * Dense helix centreline for a spiral (screw) conveyor: starts at the floor,
 * climbs `turns` revolutions to `yEnd`. Returned dense so the CatmullRom that
 * renders it stays faithful (no overshoot between sparse control points).
 */
function helixPoints(
	cx: number,
	cz: number,
	yStart: number,
	yEnd: number,
	radius: number,
	turns: number,
	segments = 72,
): THREE.Vector3[] {
	const pts: THREE.Vector3[] = [];
	for (let i = 0; i <= segments; i++) {
		const u = i / segments;
		const ang = u * turns * Math.PI * 2;
		const y = yStart + (yEnd - yStart) * u;
		pts.push(
			new THREE.Vector3(cx + radius * Math.cos(ang), y, cz + radius * Math.sin(ang)),
		);
	}
	return pts;
}

function createBeltPaths(): BeltPath[] {
	const h = BELT_HEIGHT;
	// Order matters: teal-out is listed BEFORE green-line so that, for
	// junction-H (which has two infeeds), the LAST infeed is green-line → the
	// deck's forward (roller) axis points along +z toward the trunk.
	const main: BeltPath[] = [
		{
			// teal-in: infeed B west approach — rack-b → junction-P
			id: "teal-in",
			color: COLOR_SKY,
			points: [
				new THREE.Vector3(-16, h, 5),
				new THREE.Vector3(-6, h, 5),
			],
		},
		{
			// teal-out: infeed B south leg — junction-P → junction-H merge
			id: "teal-out",
			color: COLOR_SKY,
			points: [
				new THREE.Vector3(-6, h, 5),
				new THREE.Vector3(-6, h, 0),
			],
		},
		{
			// green-line: infeed A — runs east, turns north into junction-H
			id: "green-line",
			color: COLOR_MINT,
			points: [
				new THREE.Vector3(-16, h, -3),
				new THREE.Vector3(-6, h, -3),
				new THREE.Vector3(-6, h, 0),
			],
		},
		{
			// purple-line: trunk from junction-H to inspector-1
			id: "purple-line",
			color: COLOR_LAVENDER,
			points: [new THREE.Vector3(-6, h, 0), new THREE.Vector3(0, h, 0)],
		},
		{
			// blue-line: packaging branch — GROUND-LEVEL (same height as every
			// other belt). It taps OFF the dedicated junction-P on the infeed-B
			// (teal) line via a lift-transfer (顶升移栽) and runs straight east
			// along the open northern corridor to the packaging sink. A single
			// straight leg (no corner at all) keeps it perfectly straight; the
			// junction clip leaves the small gap where the lift deck sits.
			id: "blue-line",
			color: COLOR_SKY,
			points: [
				new THREE.Vector3(-6, h, 5),
				new THREE.Vector3(7, h, 5),
			],
		},
		{
			// trunk-A: inspector-1 → junction-S
			id: "trunk-A",
			color: COLOR_LAVENDER,
			points: [new THREE.Vector3(0, h, 0), new THREE.Vector3(6, h, 0)],
		},
		{
			// reject-line-1: inspector-1 diverts NG north to reject-rack-1
			id: "reject-line-1",
			color: COLOR_PEACH,
			points: [new THREE.Vector3(0, h, 0), new THREE.Vector3(0, h, 3)],
		},
		{
			// peach-line: sorter north branch → sink-north
			id: "peach-line",
			color: COLOR_PEACH,
			points: [
				new THREE.Vector3(6, h, 0),
				new THREE.Vector3(6, h, -3),
				new THREE.Vector3(12, h, -3),
			],
		},
		{
			// yellow-line: sorter east branch → inspector-2
			id: "yellow-line",
			color: COLOR_BUTTER,
			points: [
				new THREE.Vector3(6, h, 0),
				new THREE.Vector3(6, h, 3),
				new THREE.Vector3(12, h, 3),
			],
		},
		{
			// yellow-line-2: inspector-2 OK → sink-south
			id: "yellow-line-2",
			color: COLOR_BUTTER,
			points: [new THREE.Vector3(12, h, 3), new THREE.Vector3(16, h, 3)],
		},
		{
			// reject-line-2: inspector-2 diverts NG north to reject-rack-2
			id: "reject-line-2",
			color: COLOR_PEACH,
			points: [new THREE.Vector3(12, h, 3), new THREE.Vector3(12, h, 6)],
		},

		// ---- Demo: cross-level inclined (ramp) conveyor ----------------------
		// Straight 3D diagonal from ground up to an elevated level — items climb
		// across levels. Support legs follow the slope at varying heights.
		{
			id: "incline-line",
			color: COLOR_CORAL,
			points: [
				new THREE.Vector3(-19, h, -9),
				new THREE.Vector3(-12, 2.8, -9),
			],
		},

		// ---- Demo: spiral (helix) conveyor ----------------------------------
		// A screw conveyor: dense helix points, marked `smooth` so the fillet is
		// skipped (the points are already a curve). `noLegs` — a vertical post at
		// each sample would pierce the tube, so the helix stands on a central
		// column instead (rendered separately).
		{
			id: "spiral-line",
			color: COLOR_SLATE,
			smooth: true,
			noLegs: true,
			points: helixPoints(14, -9, h, 3.6, 2.6, 2.5, 80),
		},
	];

	const external: BeltPath[] = EXT_LANES.map((lane) => ({
		id: lane.id,
		color: lane.color,
		points: [
			new THREE.Vector3(EXT_LANE_X0, h, lane.z),
			new THREE.Vector3(EXT_LANE_X1, h, lane.z),
		],
	}));

	return [...main, ...external];
}

// -----------------------------------------------------------------------------
// Geometry helpers: clip belts at junction gaps, derive deck ports, fillet.
// -----------------------------------------------------------------------------
function clipPathForJunction(
	path: BeltPath,
	center: THREE.Vector3,
	gap: number,
): THREE.Vector3[] {
	const pts = path.points;
	const clipped = pts.map((p) => p.clone());
	const first = pts[0];
	const second = pts[1];
	if (!first || !second) return clipped;

	if (first.distanceTo(center) < 0.3) {
		const dir = new THREE.Vector3().subVectors(second, first).normalize();
		// Preserve the belt's own Y so elevated (overhead) belts keep their
		// height instead of being snapped back down to the junction's floor.
		clipped[0] = new THREE.Vector3(center.x, first.y, center.z).add(
			dir.multiplyScalar(gap),
		);
	}

	const last = pts.length - 1;
	const lastPoint = pts[last];
	const beforeLast = pts[last - 1];
	if (lastPoint && beforeLast && lastPoint.distanceTo(center) < 0.3) {
		const dir = new THREE.Vector3()
			.subVectors(beforeLast, lastPoint)
			.normalize();
		clipped[last] = new THREE.Vector3(center.x, lastPoint.y, center.z).add(
			dir.multiplyScalar(gap),
		);
	}

	return clipped;
}

interface JunctionPorts {
	infeed: THREE.Vector3 | null;
	outfeeds: Map<string, THREE.Vector3>;
}

/**
 * Derives a junction's ports straight from the belt geometry: a path that
 * ends at the centre is an infeed, a path that starts there is an outfeed.
 */
function getJunctionPorts(
	paths: BeltPath[],
	center: THREE.Vector3,
): JunctionPorts {
	const EPS = 0.3;
	let infeed: THREE.Vector3 | null = null;
	const outfeeds = new Map<string, THREE.Vector3>();

	for (const path of paths) {
		const n = path.points.length;
		const first = path.points[0];
		const second = path.points[1];
		const last = path.points[n - 1];
		const beforeLast = path.points[n - 2];

		if (first && second && first.distanceTo(center) < EPS) {
			outfeeds.set(
				path.id,
				new THREE.Vector3().subVectors(second, first).normalize(),
			);
		} else if (last && last.distanceTo(center) < EPS && beforeLast) {
			infeed = new THREE.Vector3().subVectors(beforeLast, last).normalize();
		}
	}
	return { infeed, outfeeds };
}

function buildTransferLayout(
	paths: BeltPath[],
	center: THREE.Vector3,
	routes: readonly string[],
): DeviceLayout {
	const { infeed, outfeeds } = getJunctionPorts(paths, center);
	const flow = infeed ? infeed.clone().negate() : new THREE.Vector3(1, 0, 0);
	const yaw = Math.atan2(-flow.z, flow.x);
	const cos = Math.cos(yaw);
	const sin = Math.sin(yaw);

	const routeSigns = routes.map((id) => {
		const dir = outfeeds.get(id);
		if (!dir) return 0;
		const localZ = dir.x * sin + dir.z * cos;
		if (Math.abs(localZ) < 0.5) return 0;
		return localZ > 0 ? 1 : -1;
	});

	return {
		position: [center.x, center.y, center.z],
		yaw,
		length: BELT_WIDTH,
		width: BELT_WIDTH,
		floorY: -0.05,
		routeSigns,
	};
}

// A constant-width belt of half-width W/2 only avoids self-intersection on its
// inner edge when the centreline's turn radius R > W/2. BELT_WIDTH is 1.1, so
// the inner edge needs R > 0.55. We keep the corner radius well above that and
// (see filletPolyline) round corners with a *circular* arc whose inner-edge
// radius is exactly R - W/2 — a quadratic Bézier would tighten to ~0.707·R and
// still cross itself at these widths.
const CORNER_FILLET = 1.4;
const CORNER_ARC_SEGMENTS = 8;

function filletPolyline(
	points: THREE.Vector3[],
	radius = CORNER_FILLET,
	arcSegments = CORNER_ARC_SEGMENTS,
): THREE.Vector3[] {
	const start = points[0];
	const end = points[points.length - 1];
	if (points.length < 3 || !start || !end) return points.map((p) => p.clone());

	const out: THREE.Vector3[] = [start.clone()];
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1];
		const cur = points[i];
		const next = points[i + 1];
		if (!prev || !cur || !next) continue;
		const dIn = cur.distanceTo(prev);
		const dOut = cur.distanceTo(next);
		// Never consume more than ~half of either adjacent straight segment, so
		// short legs keep a fillet that still fits between their corners.
		const r = Math.min(radius, dIn * 0.49, dOut * 0.49);
		if (r <= 1e-3) {
			out.push(cur.clone());
			continue;
		}
		const y = cur.y;
		const dirIn = cur.clone().sub(prev).normalize();
		const dirOut = next.clone().sub(cur).normalize();
		const a = cur.clone().sub(dirIn.clone().multiplyScalar(r));
		const b = cur.clone().add(dirOut.clone().multiplyScalar(r));

		// Turn direction from the 2D (x,z) cross product.
		const cross = dirIn.x * dirOut.z - dirIn.z * dirOut.x;
		if (Math.abs(cross) < 1e-6) {
			out.push(a, b);
			continue;
		}
		const sign = cross > 0 ? 1 : -1;
		// Inward normal (toward the centre of the turn).
		const nIn = new THREE.Vector3(-dirIn.z, 0, dirIn.x).multiplyScalar(sign);
		const center = a.clone().add(nIn.clone().multiplyScalar(r));

		const aAng = Math.atan2(a.z - center.z, a.x - center.x);
		let dAng = Math.atan2(b.z - center.z, b.x - center.x) - aAng;
		// Take the interior (minor) arc in the turn direction.
		while (dAng <= -Math.PI) dAng += 2 * Math.PI;
		while (dAng > Math.PI) dAng -= 2 * Math.PI;
		if (sign > 0 && dAng < 0) dAng += 2 * Math.PI;
		if (sign < 0 && dAng > 0) dAng -= 2 * Math.PI;

		for (let s = 1; s < arcSegments; s++) {
			const ang = aAng + (dAng * s) / arcSegments;
			out.push(
				new THREE.Vector3(
					center.x + r * Math.cos(ang),
					y,
					center.z + r * Math.sin(ang),
				),
			);
		}
		out.push(b);
	}
	out.push(end.clone());
	return out;
}

/**
 * Subdivides every segment of a polyline so the straight legs contain many
 * collinear control points. A CatmullRom curve through collinear points is
 * exactly straight, so this is what keeps the long straight belt runs from
 * bowing inward between their sparse corner anchors.
 */
function densifyPolyline(
	points: THREE.Vector3[],
	spacing = 0.3,
): THREE.Vector3[] {
	if (points.length < 2) return points.map((p) => p.clone());
	const out: THREE.Vector3[] = [points[0]!.clone()];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1];
		const b = points[i];
		if (!a || !b) continue;
		const d = a.distanceTo(b);
		const n = Math.floor(d / spacing);
		for (let s = 1; s <= n; s++) {
			out.push(a.clone().lerp(b, s / (n + 1)));
		}
		out.push(b.clone());
	}
	return out;
}

/**
 * Finalize a belt centreline for rendering / simulation:
 *  - sharp-corner paths get a circular-arc fillet (see filletPolyline);
 *  - smooth (pre-curved) paths pass through untouched;
 *  - every path is then densified so straight legs stay perfectly straight.
 */
function preparePoints(
	points: THREE.Vector3[],
	smooth?: boolean,
): THREE.Vector3[] {
	const base = smooth ? points.map((p) => p.clone()) : filletPolyline(points);
	return densifyPolyline(base, 0.3);
}

function beltCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
	// Callers already pass finalized (filleted + densified) points.
	return new THREE.CatmullRomCurve3(points, false, "chordal");
}

// -----------------------------------------------------------------------------
// DATA-DRIVEN LAYER: the factory as a device graph, not as visuals.
//
//   rack-a ───────────────→ junction-H ─┬─→ purple-line → inspector-1 ─┬─ok→ trunk-A → junction-S ─┬─→ peach-line → sink-north
//   rack-b ─→ junction-P ─┤              │                              │                          └─→ yellow-line → inspector-2 ─┬─ok→ yellow-line-2 → sink-south
//           (teal)        ├─→ teal-out ─┘                              └─ng→ reject-line-1 → reject-rack-1                      └─ng→ reject-line-2 → reject-rack-2
//                         └─→ blue-line (lift) → sink-packaging
//   all belts same height; blue taps off a dedicated junction-P on the infeed-B line
//
// Plus 4 external digital-twin lanes (ext-pose / ext-progress / ext-entry /
// ext-span) each demonstrating one of the four external signal contracts (§14).
// -----------------------------------------------------------------------------
const CARGO_COLORS = PALETTE.cargoColors.map((c) => new THREE.Color(c));

function buildFactorySim(beltPaths: BeltPath[], lift: number): FactorySim {
	const toSim = (ps: THREE.Vector3[]): SimPoint[] =>
		ps.map((p) => ({ x: p.x, y: p.y + lift, z: p.z }));

	const clippedPoints = (id: string): THREE.Vector3[] => {
		const path = beltPaths.find((p) => p.id === id);
		if (!path) throw new Error(`buildFactorySim: unknown belt "${id}"`);
		const clipped = JUNCTIONS.reduce(
			(pts, junction) =>
				clipPathForJunction({ ...path, points: pts }, junction.center, junction.gap),
			path.points,
		);
		// Fillet sharp corners (or pass smooth arcs through) + densify so the
		// straight legs of the centreline stay perfectly straight in the sim.
		return preparePoints(clipped, path.smooth);
	};

	const junctionPoint = (p: THREE.Vector3): SimPoint => ({
		x: p.x,
		y: p.y + lift,
		z: p.z,
	});

	const extTransport = (lane: ExtLaneConfig): SimDeviceDef => ({
		id: lane.id,
		kind: "transport",
		points: toSim(clippedPoints(lane.id)),
		speed: lane.speed,
		minGap: 0.6,
		next: lane.sinkId,
	});

	const defs: SimDeviceDef[] = [
		// ---- Infeeds -------------------------------------------------------
		{
			id: "rack-a",
			kind: "source",
			output: "green-line",
			interval: 1.4,
			itemTypes: [
				{ typeId: "parcel", colorIndex: 0, weight: 1 },
				{ typeId: "parcel", colorIndex: 1, weight: 1 },
				{ typeId: "parcel", colorIndex: 2, weight: 1 },
				{ typeId: "crate", colorIndex: 4, weight: 1.2 },
			],
		},
		{
			id: "rack-b",
			kind: "source",
			output: "teal-in",
			interval: 1.8,
			itemTypes: [
				{ typeId: "parcel", colorIndex: 3, weight: 1 },
				{ typeId: "crate", colorIndex: 4, weight: 1.2 },
			],
		},
		{
			id: "green-line",
			kind: "transport",
			points: toSim(clippedPoints("green-line")),
			speed: 0.9,
			minGap: 0.55,
			next: "junction-H",
		},
		{
			id: "teal-in",
			kind: "transport",
			points: toSim(clippedPoints("teal-in")),
			speed: 0.9,
			minGap: 0.55,
			next: "junction-P",
		},
		{
			id: "teal-out",
			kind: "transport",
			points: toSim(clippedPoints("teal-out")),
			speed: 0.9,
			minGap: 0.55,
			next: "junction-H",
		},

		// ---- junction-P: dedicated divert on the infeed-B (teal) line ------
		// Crates lift-transfer to packaging (blue-line); parcels continue on
		// teal-out toward the junction-H merge. This is the 顶升移栽 tap-off.
		{
			id: "junction-P",
			kind: "junction",
			position: junctionPoint(JUNCTION_P_CENTER),
			...LIFT_CYCLE,
			routes: { parcel: "teal-out", crate: "blue-line" },
			lift: {
				height: LIFT_HEIGHT,
				divertRoutes: ["blue-line"],
				upTime: LIFT_CYCLE.upTime,
				transferTime: LIFT_CYCLE.transferTime,
				downTime: LIFT_CYCLE.downTime,
			},
		},
		{
			id: "purple-line",
			kind: "transport",
			points: toSim(clippedPoints("purple-line")),
			speed: 0.9,
			minGap: 0.55,
			next: "inspector-1",
		},
		{
			id: "blue-line",
			kind: "transport",
			points: toSim(clippedPoints("blue-line")),
			speed: 0.8,
			minGap: 0.55,
			next: "sink-packaging",
		},

		// ---- junction-H: pure merge of teal-out + green-line → trunk ------
		{
			id: "junction-H",
			kind: "junction",
			position: junctionPoint(MERGE_CENTER),
			dwell: LIFT_CYCLE.dwell,
			routes: { parcel: "purple-line", crate: "purple-line" },
		},

		// ---- inspector-1 + reject-rack-1 -----------------------------------
		{
			id: "inspector-1",
			kind: "inspector",
			position: junctionPoint(INSPECTOR_CENTER),
			dwell: 0.35,
			defaultVerdict: "ok",
			writesAttr: "quality",
			routes: { ok: "trunk-A", ng: "reject-line-1" },
			random: { verdict: "ng", rate: 0.35 },
			verdictColors: { ok: 0, ng: 3 },
			lift: {
				height: LIFT_HEIGHT,
				divertRoutes: ["reject-line-1"],
				upTime: LIFT_CYCLE.upTime,
				transferTime: LIFT_CYCLE.transferTime,
				downTime: LIFT_CYCLE.downTime,
			},
		},
		{
			id: "trunk-A",
			kind: "transport",
			points: toSim(clippedPoints("trunk-A")),
			speed: 0.9,
			minGap: 0.55,
			next: "junction-S",
		},
		{
			id: "reject-line-1",
			kind: "transport",
			points: toSim(clippedPoints("reject-line-1")),
			speed: 0.7,
			minGap: 0.55,
			next: "reject-rack-1",
		},
		{
			id: "reject-rack-1",
			kind: "buffer",
			position: junctionPoint(REJECT_RACK_CENTER),
			columns: REJECT_COLUMNS,
			rows: REJECT_ROWS,
			layers: REJECT_LAYERS,
			spacing: [REJECT_SPACING, 0.2, REJECT_SPACING],
			onFull: "block",
			drainAfter: 12,
		},

		// ---- junction-S: alternate diverter --------------------------------
		{
			id: "junction-S",
			kind: "junction",
			position: junctionPoint(SORTER_CENTER),
			dwell: LIFT_CYCLE.dwell,
			alternate: { devices: ["peach-line", "yellow-line"], interval: 3 },
			lift: {
				height: LIFT_HEIGHT,
				upTime: LIFT_CYCLE.upTime,
				transferTime: LIFT_CYCLE.transferTime,
				downTime: LIFT_CYCLE.downTime,
			},
		},
		{
			id: "peach-line",
			kind: "transport",
			points: toSim(clippedPoints("peach-line")),
			speed: 0.9,
			minGap: 0.55,
			next: "sink-north",
		},
		{
			id: "yellow-line",
			kind: "transport",
			points: toSim(clippedPoints("yellow-line")),
			speed: 0.9,
			minGap: 0.55,
			next: "inspector-2",
		},

		// ---- inspector-2 + reject-rack-2 -----------------------------------
		{
			id: "inspector-2",
			kind: "inspector",
			position: junctionPoint(INSPECTOR2_CENTER),
			dwell: 0.35,
			defaultVerdict: "ok",
			writesAttr: "quality",
			routes: { ok: "yellow-line-2", ng: "reject-line-2" },
			random: { verdict: "ng", rate: 0.3 },
			verdictColors: { ok: 0, ng: 3 },
			lift: {
				height: LIFT_HEIGHT,
				divertRoutes: ["reject-line-2"],
				upTime: LIFT_CYCLE.upTime,
				transferTime: LIFT_CYCLE.transferTime,
				downTime: LIFT_CYCLE.downTime,
			},
		},
		{
			id: "yellow-line-2",
			kind: "transport",
			points: toSim(clippedPoints("yellow-line-2")),
			speed: 0.9,
			minGap: 0.55,
			next: "sink-south",
		},
		{
			id: "reject-line-2",
			kind: "transport",
			points: toSim(clippedPoints("reject-line-2")),
			speed: 0.7,
			minGap: 0.55,
			next: "reject-rack-2",
		},
		{
			id: "reject-rack-2",
			kind: "buffer",
			position: junctionPoint(REJECT_RACK2_CENTER),
			columns: REJECT_COLUMNS,
			rows: REJECT_ROWS,
			layers: REJECT_LAYERS,
			spacing: [REJECT_SPACING, 0.2, REJECT_SPACING],
			onFull: "block",
			drainAfter: 10,
		},

		// ---- sinks ---------------------------------------------------------
		{ id: "sink-packaging", kind: "sink" },
		{ id: "sink-north", kind: "sink" },
		{ id: "sink-south", kind: "sink" },

		// ---- demo: inclined (cross-level) + spiral conveyors ----------------
		{
			id: "rack-incline",
			kind: "source",
			output: "incline-line",
			interval: 2.0,
			itemTypes: [
				{ typeId: "parcel", colorIndex: 0, weight: 1 },
				{ typeId: "crate", colorIndex: 4, weight: 1.2 },
			],
		},
		{
			id: "incline-line",
			kind: "transport",
			points: toSim(clippedPoints("incline-line")),
			speed: 0.8,
			minGap: 0.55,
			next: "sink-incline",
		},
		{ id: "sink-incline", kind: "sink" },
		{
			id: "rack-spiral",
			kind: "source",
			output: "spiral-line",
			interval: 2.2,
			itemTypes: [
				{ typeId: "parcel", colorIndex: 1, weight: 1 },
				{ typeId: "crate", colorIndex: 4, weight: 1.2 },
			],
		},
		{
			id: "spiral-line",
			kind: "transport",
			points: toSim(clippedPoints("spiral-line")),
			speed: 0.7,
			minGap: 0.55,
			next: "sink-spiral",
		},
		{ id: "sink-spiral", kind: "sink" },

		// ---- external digital-twin lanes -----------------------------------
		...EXT_LANES.map(extTransport),
		...EXT_LANES.map((lane) => ({ id: lane.sinkId, kind: "sink" } as SimDeviceDef)),
	];

	const sim = new FactorySim(defs);
	// Mark every external lane as externally fed by default; the worldMode
	// control flips the whole sim between sim / hybrid / external, and the
	// per-lane leva dropdowns set each lane's signal contract.
	for (const lane of EXT_LANES) {
		sim.setDeviceDataSource(lane.id, "external", {
			signal: lane.defaultKind,
			frame: lane.defaultFrame,
		});
	}
	return sim;
}

// -----------------------------------------------------------------------------
// Cute racks with rounded shelves and little boxes.
// -----------------------------------------------------------------------------
function CuteRack({ position }: { position: [number, number, number] }) {
	const width = 2.4;
	const depth = 1.6;
	const height = 2.8;
	const shelfCount = 4;
	const frameColor = PALETTE.frame;
	const boxColors = PALETTE.cargoColors;

	return (
		<group position={position}>
			{(
				[
					[-width / 2, -depth / 2],
					[width / 2, -depth / 2],
					[-width / 2, depth / 2],
					[width / 2, depth / 2],
				] as [number, number][]
			).map(([x, z], i) => (
				<RoundedBox
					key={`post-${i.toString()}`}
					args={[0.12, height, 0.12]}
					radius={0.03}
					position={[x, height / 2, z]}
				>
					<meshStandardMaterial color={frameColor} roughness={0.7} />
				</RoundedBox>
			))}

			{Array.from({ length: shelfCount }, (_, i) => {
				const y = 0.4 + i * (height / shelfCount);
				return (
					<RoundedBox
						key={`shelf-${i.toString()}`}
						args={[width + 0.05, 0.08, depth + 0.05]}
						radius={0.03}
						position={[0, y, 0]}
					>
						<meshStandardMaterial color={frameColor} roughness={0.6} />
					</RoundedBox>
				);
			})}

			{Array.from({ length: 12 }, (_, i) => {
				const shelf = Math.floor(i / 3) % shelfCount;
				const col = i % 3;
				const y = 0.4 + shelf * (height / shelfCount) + 0.18;
				const x = -width / 2 + 0.45 + col * 0.7;
				const z = -depth / 2 + 0.4 + (i % 2) * 0.7;
				return (
					<RoundedBox
						key={`box-${i.toString()}`}
						args={[0.32, 0.28, 0.32]}
						radius={0.04}
						position={[x, y, z]}
					>
						<meshStandardMaterial
							color={boxColors[i % boxColors.length]}
							roughness={0.5}
							metalness={0.05}
						/>
					</RoundedBox>
				);
			})}

			<mesh position={[width / 2 + 0.1, height - 0.2, depth / 2 - 0.1]}>
				<sphereGeometry args={[0.06, 8, 8]} />
				<meshStandardMaterial
					color={PALETTE.mint}
					emissive={PALETTE.mint}
					emissiveIntensity={0.6}
				/>
			</mesh>
		</group>
	);
}

// -----------------------------------------------------------------------------
// Support legs under every belt (static, written once).
// -----------------------------------------------------------------------------
interface LegInstance {
	x: number;
	z: number;
	height: number;
}

function computeLegs(
	paths: Array<BeltPath & { clippedPoints: THREE.Vector3[] }>,
	junctions: { center: THREE.Vector3; gap: number }[],
	spacing = 1.35,
): LegInstance[] {
	const legs: LegInstance[] = [];
	for (const path of paths) {
		if (path.noLegs) continue;
		// Legs must follow the SAME finalized (clipped + prepared) centreline
		// the belt is rendered from, otherwise they drift off the new path.
		const curve = beltCurve(path.clippedPoints);
		const length = curve.getLength();
		const count = Math.max(2, Math.floor(length / spacing));
		for (let i = 0; i <= count; i++) {
			const t = i / count;
			const p = curve.getPointAt(t);

			let nearJunction = false;
			for (const junction of junctions) {
				const dx = p.x - junction.center.x;
				const dz = p.z - junction.center.z;
				if (Math.hypot(dx, dz) < junction.gap + 0.25) {
					nearJunction = true;
					break;
				}
			}
			if (nearJunction) continue;

			const topY = p.y - 0.06;
			if (topY <= 0.08) continue;
			legs.push({ x: p.x, z: p.z, height: topY });
		}
	}
	return legs;
}

function SupportLegs({
	legs,
	material,
}: {
	legs: LegInstance[];
	material: THREE.Material;
}) {
	const postPoolRef = useRef<InstancedMeshPoolRef>(null);
	const footPoolRef = useRef<InstancedMeshPoolRef>(null);

	const postGeometry = useMemo(
		() => new THREE.CylinderGeometry(0.05, 0.05, 1, 10),
		[],
	);
	const footGeometry = useMemo(
		() => new THREE.CylinderGeometry(0.07, 0.12, 0.06, 12),
		[],
	);

	useEffect(() => {
		const posts = postPoolRef.current;
		const feet = footPoolRef.current;
		if (!posts || !feet) return;

		posts.setInstanceCount(legs.length);
		feet.setInstanceCount(legs.length);

		const dummy = new THREE.Object3D();
		legs.forEach((leg, i) => {
			dummy.position.set(leg.x, leg.height / 2, leg.z);
			dummy.scale.set(1, leg.height, 1);
			dummy.rotation.set(0, 0, 0);
			dummy.updateMatrix();
			posts.setMatrixAt(i, dummy.matrix);

			dummy.position.set(leg.x, -0.02, leg.z);
			dummy.scale.set(1, 1, 1);
			dummy.updateMatrix();
			feet.setMatrixAt(i, dummy.matrix);
		});
		posts.updateMatrices();
		feet.updateMatrices();
	}, [legs]);

	const max = Math.max(1, legs.length);

	return (
		<>
			<InstancedMeshPool
				ref={postPoolRef}
				geometry={postGeometry}
				material={material}
				maxInstances={max}
			/>
			<InstancedMeshPool
				ref={footPoolRef}
				geometry={footGeometry}
				material={material}
				maxInstances={max}
			/>
		</>
	);
}

// -----------------------------------------------------------------------------
// Drive motor unit placed at the start of each belt line.
// -----------------------------------------------------------------------------
function CuteMotor({
	position,
	heading,
	globalSpeed,
}: {
	position: THREE.Vector3;
	heading: THREE.Vector3;
	globalSpeed: number;
}) {
	const fanRef = useRef<THREE.Group>(null);

	useFrame((_, delta) => {
		if (fanRef.current) {
			fanRef.current.rotation.x += delta * globalSpeed * 10;
		}
	});

	const angle = Math.atan2(heading.x, heading.z);

	return (
		<group position={position} rotation={[0, angle, 0]}>
			<RoundedBox args={[0.34, 0.3, 0.5]} radius={0.05} castShadow>
				<meshStandardMaterial
					color={PALETTE.cream}
					roughness={0.5}
					metalness={0.05}
				/>
			</RoundedBox>
			<RoundedBox args={[0.36, 0.08, 0.52]} radius={0.03} position={[0, 0.06, 0]}>
				<meshStandardMaterial color={PALETTE.lavender} roughness={0.5} />
			</RoundedBox>
			<group ref={fanRef} position={[0, 0, -0.34]}>
				<mesh rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.05, 0.05, 0.16, 10]} />
					<meshStandardMaterial color={0xaaaaaa} roughness={0.4} metalness={0.3} />
				</mesh>
				{[0, 1, 2, 3].map((i) => (
					<RoundedBox
						key={`fan-blade-${i.toString()}`}
						args={[0.02, 0.2, 0.07]}
						radius={0.01}
						position={[0, 0, -0.05]}
						rotation={[0, 0, (i * Math.PI) / 2]}
					>
						<meshStandardMaterial color={PALETTE.sky} roughness={0.5} />
					</RoundedBox>
				))}
			</group>
		</group>
	);
}

// -----------------------------------------------------------------------------
// Floating label (drei Text) for lanes / stations.
// -----------------------------------------------------------------------------
function Label({
	position,
	text,
	color = "#3A4A4F",
	size = 0.5,
}: {
	position: [number, number, number];
	text: string;
	color?: string;
	size?: number;
}) {
	return (
		<Text
			position={position}
			fontSize={size}
			color={color}
			anchorX="center"
			anchorY="middle"
			outlineWidth={0.02}
			outlineColor="#ffffff"
		>
			{text}
		</Text>
	);
}

// -----------------------------------------------------------------------------
// SIM-DRIVEN CARGO LAYER: applies FrameDelta to an InstancedMeshPool.
// -----------------------------------------------------------------------------
const MAX_RENDER_ITEMS = 600;

interface LaneTelemetry {
	stats: SimStats;
	events: SimEvent[];
	laneCounts: Record<string, number>;
}

function SimCargoLayer({
	sim,
	frameHeight,
	onTelemetry,
	externalFeeder,
}: {
	sim: FactorySim;
	frameHeight: number;
	onTelemetry?: (t: LaneTelemetry) => void;
	externalFeeder?: (elapsed: number, delta: number) => void;
}) {
	const poolRef = useRef<InstancedMeshPoolRef>(null);
	const slotOf = useRef(new Map<number, number>());
	const freeSlots = useRef<number[]>([]);
	const initialized = useRef(false);
	const telemetryTimer = useRef(0);

	const lift = frameHeight / 2 + 0.07 + 0.02;
	void lift;

	const geometry = useMemo(() => new THREE.BoxGeometry(0.18, 0.14, 0.18), []);
	const material = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0xffffff,
				roughness: 0.55,
				metalness: 0.05,
			}),
		[],
	);

	useFrame((state, delta) => {
		const pool = poolRef.current;
		if (!pool) return;

		if (!initialized.current) {
			initialized.current = true;
			pool.setInstanceCount(MAX_RENDER_ITEMS);
			const parked = new THREE.Object3D();
			parked.position.set(0, -100, 0);
			parked.scale.setScalar(0);
			parked.updateMatrix();
			for (let i = 0; i < MAX_RENDER_ITEMS; i++) {
				pool.setMatrixAt(i, parked.matrix);
				freeSlots.current.push(i);
			}
			pool.updateMatrices();
		}

		externalFeeder?.(state.clock.elapsedTime, delta);

		const d = sim.tick(Math.min(delta, 0.25));

		let colorsDirty = false;
		for (const s of d.spawned) {
			const slot = freeSlots.current.pop();
			if (slot === undefined) continue;
			slotOf.current.set(s.itemId, slot);
			const color = CARGO_COLORS[s.colorIndex % CARGO_COLORS.length];
			if (color) pool.setColorAt(slot, color);
			colorsDirty = true;
		}

		const dummy = new THREE.Object3D();
		let matricesDirty = false;
		for (const m of d.moved) {
			const slot = slotOf.current.get(m.itemId);
			if (slot === undefined) continue;
			dummy.position.set(m.x, m.y, m.z);
			dummy.rotation.set(0, m.heading, 0);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			pool.setMatrixAt(slot, dummy.matrix);
			matricesDirty = true;
		}

		for (const id of d.removed) {
			const slot = slotOf.current.get(id);
			if (slot === undefined) continue;
			dummy.position.set(0, -100, 0);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.setScalar(0);
			dummy.updateMatrix();
			pool.setMatrixAt(slot, dummy.matrix);
			slotOf.current.delete(id);
			freeSlots.current.push(slot);
			matricesDirty = true;
		}

		if (colorsDirty) pool.updateColors();
		if (matricesDirty) pool.updateMatrices();

		telemetryTimer.current += delta;
		if (telemetryTimer.current > 0.25) {
			telemetryTimer.current = 0;
			const snap = sim.snapshot();
			const laneCounts: Record<string, number> = {};
			for (const it of snap) {
				laneCounts[it.deviceId] = (laneCounts[it.deviceId] ?? 0) + 1;
			}
			onTelemetry?.({ stats: d.stats, events: sim.getRecentEvents(8), laneCounts });
		}
	});

	return (
		<InstancedMeshPool
			ref={poolRef}
			geometry={geometry}
			material={material}
			maxInstances={MAX_RENDER_ITEMS}
			batchSize={1000}
			enableColors
			frustumCulled
		/>
	);
}

// -----------------------------------------------------------------------------
// Smoothly interpolate the camera to the active preset.
// -----------------------------------------------------------------------------
function CameraController({
	targetPosition,
	targetLookAt,
}: {
	targetPosition: THREE.Vector3;
	targetLookAt: THREE.Vector3;
}) {
	const { camera, controls } = useThree();
	const positionRef = useRef(targetPosition);
	const targetRef = useRef(targetLookAt);

	positionRef.current = targetPosition;
	targetRef.current = targetLookAt;

	useFrame(() => {
		camera.position.lerp(positionRef.current, 0.05);
		if (controls) {
			(controls as any).target.lerp(targetRef.current, 0.05);
			(controls as any).update();
		}
	});

	return null;
}

// -----------------------------------------------------------------------------
// Synthetic external feed for one lane, implementing a given signal kind.
// Uses the sim clock (sim.getElapsed) so entry/span/progress share its time
// base — wall-clock deltas would drift during frame hitches (dt clamped).
// -----------------------------------------------------------------------------
function feedLane(
	lane: {
		curve: THREE.CatmullRomCurve3;
		length: number;
		speed: number;
		ids: number[];
		cargoColorIndex: number;
	},
	kind: ExtKind,
	frame: "world" | "local",
	t: number,
): ExternalItemState[] {
	const { curve, length, speed, ids, cargoColorIndex } = lane;
	const travel = length / speed; // seconds to traverse the lane
	const gap = travel * 0.62; // spawn cadence
	const horizon = travel + 0.05;
	const items: ExternalItemState[] = [];

	const kStart = Math.floor((t - horizon) / gap);
	const kEnd = Math.floor(t / gap) + 1;
	for (let k = kStart; k <= kEnd; k++) {
		const E = k * gap;
		const elapsed = t - E;
		if (elapsed < 0 || elapsed > horizon) continue;
		const id = ids[k % ids.length] ?? 9000;
		const u = Math.min(1, Math.max(0, elapsed / travel));
		const typeId = "twin";

		if (kind === "pose") {
			if (u >= 1) continue;
			if (frame === "local") {
				// Device-local: x lateral, z forward along the lane.
				items.push({
					itemId: id,
					typeId,
					colorIndex: cargoColorIndex,
					signal: { kind: "pose", frame: "local", x: 0, y: 0, z: u * length, heading: 0 },
				});
			} else {
				const p = curve.getPointAt(u);
				const tan = curve.getTangentAt(u).normalize();
				items.push({
					itemId: id,
					typeId,
					colorIndex: cargoColorIndex,
					signal: {
						kind: "pose",
						frame: "world",
						x: p.x,
						y: p.y,
						z: p.z,
						heading: Math.atan2(tan.x, tan.z),
					},
				});
			}
		} else if (kind === "progress") {
			items.push({
				itemId: id,
				typeId,
				colorIndex: cargoColorIndex,
				signal: { kind: "progress", progress: u >= 1 ? 1 : u },
			});
		} else if (kind === "entry") {
			if (u >= 1) continue;
			items.push({ itemId: id, typeId, colorIndex: cargoColorIndex, signal: { kind: "entry", tEnter: E } });
		} else {
			// span
			if (u >= 1) continue;
			items.push({
				itemId: id,
				typeId,
				colorIndex: cargoColorIndex,
				signal: { kind: "span", tEnter: E, tExit: E + travel },
			});
		}
	}
	return items;
}

// -----------------------------------------------------------------------------
// Main 3D scene.
// -----------------------------------------------------------------------------
function VividFactoryScene({
	beltPaths,
	sim,
	globalSpeed,
	showPaths,
	visibleLines,
	onTelemetry,
	rendererRegistry,
	externalFeeder,
}: {
	beltPaths: BeltPath[];
	sim: FactorySim;
	globalSpeed: number;
	showPaths: boolean;
	visibleLines: Record<string, boolean>;
	onTelemetry?: (t: LaneTelemetry) => void;
	rendererRegistry: DeviceRendererRegistry;
	externalFeeder?: (elapsed: number, delta: number) => void;
}) {
	const frameMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: PALETTE.frame,
				roughness: 0.65,
				metalness: 0.05,
			}),
		[],
	);

	const rollerMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0xcccccc,
				roughness: 0.45,
				metalness: 0.15,
			}),
		[],
	);

	const beltMaterials = useMemo(
		() => beltPaths.map((path) => createBeltMaterial(path.color)),
		[beltPaths],
	);

	useFrame((state) => {
		for (const mat of beltMaterials) {
			mat.uniforms.time!.value = state.clock.elapsedTime;
			mat.uniforms.arrowSpeed!.value = 0.5 * globalSpeed;
		}
	});

	const beltRenderData = useMemo(
		() =>
			beltPaths.map((path) => ({
				...path,
					clippedPoints: preparePoints(
						JUNCTIONS.reduce(
							(pts, junction) =>
								clipPathForJunction(
									{ ...path, points: pts },
									junction.center,
									junction.gap,
								),
							path.points,
						),
						path.smooth,
					),
			})),
		[beltPaths],
	);

	const transferDevices = useMemo(
		() =>
			TRANSFER_SPECS.map((spec) => ({
				id: spec.id,
				layout: buildTransferLayout(beltPaths, spec.center, spec.routes),
			})),
		[beltPaths],
	);

	const inspectionDevices = useMemo(
		() => [
			{
				id: "inspector-1",
				layout: {
					position: [INSPECTOR_CENTER.x, INSPECTOR_CENTER.y, INSPECTOR_CENTER.z] as [
						number,
						number,
						number,
					],
					yaw: 0,
					length: BELT_WIDTH,
					width: BELT_WIDTH,
					floorY: -0.05,
				} satisfies DeviceLayout,
			},
			{
				id: "inspector-2",
				layout: {
					position: [INSPECTOR2_CENTER.x, INSPECTOR2_CENTER.y, INSPECTOR2_CENTER.z] as [
						number,
						number,
						number,
					],
					yaw: 0,
					length: BELT_WIDTH,
					width: BELT_WIDTH,
					floorY: -0.05,
				} satisfies DeviceLayout,
			},
		],
		[],
	);

	const bufferDevices = useMemo(
		() => [
			{
				id: "reject-rack-1",
				layout: {
					position: [REJECT_RACK_CENTER.x, REJECT_RACK_CENTER.y, REJECT_RACK_CENTER.z] as [
						number,
						number,
						number,
					],
					yaw: 0,
					length: REJECT_COLUMNS * REJECT_SPACING,
					width: REJECT_ROWS * REJECT_SPACING,
					floorY: -0.05,
				} satisfies DeviceLayout,
				config: {
					columns: REJECT_COLUMNS,
					rows: REJECT_ROWS,
					layers: REJECT_LAYERS,
					spacing: REJECT_SPACING,
				},
			},
			{
				id: "reject-rack-2",
				layout: {
					position: [
						REJECT_RACK2_CENTER.x,
						REJECT_RACK2_CENTER.y,
						REJECT_RACK2_CENTER.z,
					] as [number, number, number],
					yaw: 0,
					length: REJECT_COLUMNS * REJECT_SPACING,
					width: REJECT_ROWS * REJECT_SPACING,
					floorY: -0.05,
				} satisfies DeviceLayout,
				config: {
					columns: REJECT_COLUMNS,
					rows: REJECT_ROWS,
					layers: REJECT_LAYERS,
					spacing: REJECT_SPACING,
				},
			},
		],
		[],
	);

	// (No crossover devices: the green-line bend is now a clean filleted arc,
	// so there is no overlap needing a bridge stand-in.)

	const motorData = useMemo(
		() =>
			beltRenderData
				.filter((path) => visibleLines[path.id])
				.map((path) => {
					const curve = beltCurve(path.clippedPoints);
					const start = curve.getPointAt(0);
					const tangent = curve.getTangentAt(0).normalize();
					const side = new THREE.Vector3()
						.crossVectors(new THREE.Vector3(0, 1, 0), tangent)
						.normalize();
					const position = start.clone().add(side.multiplyScalar(0.55));
					return { id: path.id, position, heading: tangent };
				}),
		[beltRenderData, visibleLines],
	);

	const legs = useMemo(
		() =>
			computeLegs(
				beltRenderData.filter((path) => visibleLines[path.id]),
				JUNCTIONS,
			),
		[beltRenderData, visibleLines],
	);

	const extLaneData = useMemo(
		() =>
			EXT_LANES.map((lane, i) => {
				const path = beltPaths.find((p) => p.id === lane.id);
				if (!path) throw new Error(`missing belt ${lane.id}`);
				const curve = beltCurve(path.points);
				return {
					...lane,
					curve,
					length: curve.getLength(),
					ids: [9101 + i * 100, 9102 + i * 100, 9103 + i * 100],
				};
			}),
		[beltPaths],
	);

	return (
		<>
			<ambientLight intensity={0.55} color={PALETTE.warmLight} />
			<directionalLight
				position={[8, 14, 6]}
				intensity={1.1}
				color={PALETTE.warmLight}
				castShadow
				shadow-mapSize={[2048, 2048]}
				shadow-camera-left={-26}
				shadow-camera-right={26}
				shadow-camera-top={26}
				shadow-camera-bottom={-26}
				shadow-camera-near={0.1}
				shadow-camera-far={60}
			/>
			<pointLight position={[-5, 4, -5]} intensity={0.6} color="#FFE4C4" />

			<RoundedBox args={[48, 0.2, 40]} radius={0.05} position={[0, -0.15, 0]}>
				<meshStandardMaterial color={PALETTE.floor} roughness={0.85} />
			</RoundedBox>
			<gridHelper args={[48, 48, 0x4f6267, 0x3a4a4f]} position={[0, -0.04, 0]} />

			<CuteRack position={[-17, 0, -3]} />
			<CuteRack position={[-17, 0, 5]} />
			<CuteRack position={[18, 0, 3]} />

			{/* Demo conveyors: source racks + spiral's central support column */}
			<CuteRack position={[-20, 0, -9]} />
			<CuteRack position={[18, 0, -9]} />
			<mesh position={[14, 1.8, -9]}>
				<cylinderGeometry args={[0.18, 0.18, 3.6, 16]} />
				<meshStandardMaterial color={"#9aa7b5"} roughness={0.6} metalness={0.3} />
			</mesh>

			{beltRenderData.map((path, index) =>
				visibleLines[path.id] ? (
					<ConveyorBelt
						key={path.id}
						curvePath={path.clippedPoints}
						rollerSpacing={0.22}
						frameWidth={path.frameWidth ?? 1.1}
						frameHeight={0.28}
						frameDepth={0.12}
						rollerRadius={0.055}
						rollerLength={(path.frameWidth ?? 1.1) + 0.15}
						frameMaterial={frameMaterial}
						rollerMaterial={rollerMaterial}
						pathMaterial={beltMaterials[index]}
						segments={24}
						showPath
						arrowSpeed={0.5 * globalSpeed}
					/>
				) : null,
			)}

			<SupportLegs legs={legs} material={frameMaterial} />

			{motorData.map((motor) => (
				<CuteMotor
					key={`motor-${motor.id}`}
					position={motor.position}
					heading={motor.heading}
					globalSpeed={globalSpeed}
				/>
			))}

			{transferDevices.map((device) => (
				<DeviceRendererHost
					key={device.id}
					registry={rendererRegistry}
					source={sim}
					deviceId={device.id}
					kind={TRANSFER_KIND}
					layout={device.layout}
					config={{ liftHeight: LIFT_HEIGHT }}
				/>
			))}

			{inspectionDevices.map((device) => (
				<DeviceRendererHost
					key={device.id}
					registry={rendererRegistry}
					source={sim}
					deviceId={device.id}
					kind={INSPECTOR_KIND}
					layout={device.layout}
				/>
			))}

			{bufferDevices.map((device) => (
				<DeviceRendererHost
					key={device.id}
					registry={rendererRegistry}
					source={sim}
					deviceId={device.id}
					kind={BUFFER_KIND}
					layout={device.layout}
					config={device.config}
				/>
			))}


			{/* Station name tags */}
			<Label position={[-15, 3.4, -9]} text="Ramp ⛰" size={0.42} color="#FF8C69" />
			<Label position={[14, 4.2, -9]} text="Spiral 🌀" size={0.42} color="#8E9BAE" />
			<Label position={[-6, 2.4, 0]} text="junction-H" size={0.42} color="#C4B5E0" />
			<Label position={[6, 2.4, 0]} text="junction-S" size={0.42} color="#C4B5E0" />
			<Label position={[0, 2.0, 0]} text="Inspector-1" size={0.4} color="#F4A261" />
			<Label position={[12, 2.0, 3]} text="Inspector-2" size={0.4} color="#F4A261" />

			{/* External lane tags + glowing start markers */}
			{extLaneData.map((lane) => (
				<group key={`tag-${lane.id}`}>
					<Label
						position={[EXT_LANE_X0 - 1.4, 1.4, lane.z]}
						text={lane.label}
						color={lane.color.getStyle()}
						size={0.42}
					/>
					<mesh position={[EXT_LANE_X0, BELT_HEIGHT + 0.35, lane.z]}>
						<sphereGeometry args={[0.12, 12, 12]} />
						<meshStandardMaterial
							color={lane.color.getStyle()}
							emissive={lane.color.getStyle()}
							emissiveIntensity={0.8}
						/>
					</mesh>
				</group>
			))}

			<SimCargoLayer
				sim={sim}
				frameHeight={0.28}
				onTelemetry={onTelemetry}
				externalFeeder={externalFeeder}
			/>

			{showPaths &&
				beltPaths.map((path) => {
					const curve = beltCurve(path.points);
					const points = curve.getPoints(64);
					return (
						<line key={`debug-${path.id}`}>
							<bufferGeometry
								attach="geometry"
								onUpdate={(geo) => geo.setFromPoints(points)}
							/>
							<lineBasicMaterial color={path.color} linewidth={2} />
						</line>
					);
				})}

			<OrbitControls
				enablePan
				enableZoom
				enableRotate
				minDistance={4}
				maxDistance={48}
				target={[2, BELT_HEIGHT, -4]}
			/>
			<Stats />
		</>
	);
}

// -----------------------------------------------------------------------------
// Camera presets.
// -----------------------------------------------------------------------------
type CameraPreset =
	| "overview"
	| "infeed"
	| "inspection"
	| "sorter"
	| "packaging"
	| "external"
	| "outfeed"
	| "ramp"
	| "spiral";

function useCameraPreset(preset: CameraPreset) {
	const target = useMemo(() => {
		switch (preset) {
			case "infeed":
				return {
					position: [-18, 6, 9] as [number, number, number],
					target: [-11, BELT_HEIGHT, 1] as [number, number, number],
				};
			case "inspection":
				return {
					position: [3, 6, 9] as [number, number, number],
					target: [0, BELT_HEIGHT, 1.5] as [number, number, number],
				};
			case "sorter":
				return {
					position: [13, 6, 9] as [number, number, number],
					target: [6, BELT_HEIGHT, 0] as [number, number, number],
				};
			case "packaging":
				return {
					position: [-6, 9, 15] as [number, number, number],
					target: [1, BELT_HEIGHT, 5] as [number, number, number],
				};
			case "external":
				return {
					position: [0, 15, 8] as [number, number, number],
					target: [0, BELT_HEIGHT, -12] as [number, number, number],
				};
			case "outfeed":
				return {
					position: [18, 6, 10] as [number, number, number],
					target: [13, BELT_HEIGHT, 1] as [number, number, number],
				};
			case "ramp":
				return {
					position: [-15, 7, 2] as [number, number, number],
					target: [-15, 1.4, -9] as [number, number, number],
				};
			case "spiral":
				return {
					position: [14, 9, -1] as [number, number, number],
					target: [14, 1.4, -9] as [number, number, number],
				};
			case "overview":
			default:
				return {
					position: [4, 22, 28] as [number, number, number],
					target: [0, BELT_HEIGHT, -4] as [number, number, number],
				};
		}
	}, [preset]);
	return target;
}

// -----------------------------------------------------------------------------
// Example wrapper with UI controls.
// -----------------------------------------------------------------------------
const MAIN_LINE_LABELS: Record<string, string> = {
	"green-line": "🟢 Infeed A",
	"teal-in": "🔵 Infeed B→P",
	"teal-out": "🔵 Infeed B→H",
	"purple-line": "🟣 Trunk",
	"blue-line": "📦 Packaging",
	"trunk-A": "🟣 Trunk-A",
	"reject-line-1": "🍑 Reject-1",
	"peach-line": "🍑 Sort N",
	"yellow-line": "🟡 Sort-2",
	"yellow-line-2": "🟡 Outfeed",
	"reject-line-2": "🍑 Reject-2",
	"incline-line": "⛰ Ramp",
	"spiral-line": "🌀 Spiral",
};

export function VividFactoryConveyorExample() {
	const [paused, setPaused] = useState(false);
	const [cameraPreset, setCameraPreset] = useState<CameraPreset>("overview");
	const [telemetry, setTelemetry] = useState<LaneTelemetry>({
		stats: {
			activeItems: 0,
			totalSpawned: 0,
			totalConsumed: 0,
			blocked: 0,
			throughput: {},
			stored: {},
			verdicts: {},
		},
		events: [],
		laneCounts: {},
	});

	const beltPaths = useMemo(createBeltPaths, []);
	const sim = useMemo(() => buildFactorySim(beltPaths, 0.28 / 2 + 0.09), [beltPaths]);

	const rendererRegistry = useMemo(() => {
		const registry = new DeviceRendererRegistry();
		registry.register(cuteLiftTransferPlugin);
		for (const plugin of INSPECTION_PLUGINS) registry.register(plugin);
		return registry;
	}, []);

	// Latest worldMode + per-lane contract, readable from the per-frame feeder.
	const worldModeRef = useRef<"sim" | "external" | "hybrid">("hybrid");
	const extKindRef = useRef<Record<string, { kind: ExtKind; frame: "world" | "local" }>>({});
	for (const lane of EXT_LANES) {
		if (!extKindRef.current[lane.id]) {
			extKindRef.current[lane.id] = { kind: lane.defaultKind, frame: lane.defaultFrame };
		}
	}

	// ---- leva: run controls ----
	const { globalSpeed, spawnRate, showPaths, transferPlugin, worldMode } = useControls("运行 Run", {
		transferPlugin: {
			value: cuteLiftTransferPlugin.label,
			options: BUILTIN_DEVICE_PLUGINS.map((plugin) => plugin.label),
			label: "分流转接台插件",
		},
		worldMode: {
			value: "hybrid",
			options: {
				"模拟 sim": "sim",
				"混合 hybrid": "hybrid",
				"仅外部数据 external": "external",
			},
			label: "数据模式",
		},
		globalSpeed: { value: 1, min: 0, max: 2.5, step: 0.1, label: "Speed" },
		spawnRate: { value: 1, min: 0.2, max: 4, step: 0.1, label: "Spawn rate" },
		showPaths: { value: false, label: "Debug paths" },
		"⏸ 暂停/继续": button(() => setPaused((p) => !p)),
	});

	// ---- leva: external lane signal-kind dropdowns ----
	const extSchema: Record<string, unknown> = {};
	for (const lane of EXT_LANES) {
		extSchema[lane.id] = {
			value: lane.defaultKind,
			options: {
				"自有坐标 pose": "pose",
				"百分比 progress": "progress",
				"入口 entry": "entry",
				"入口+出口 span": "span",
			},
			label: lane.label,
		};
		extSchema[`${lane.id}-frame`] = {
			value: lane.defaultFrame,
			options: { "世界 world": "world", "设备 local": "local" },
			label: `${lane.label} 坐标`,
		};
	}
	const ext = useControls("外部数字孪生车道 (4 种信号)", extSchema) as Record<string, string>;

	// ---- leva: visibility ----
	const visSchema: Record<string, { value: boolean; label: string }> = {};
	for (const [id, label] of Object.entries(MAIN_LINE_LABELS)) {
		visSchema[id] = { value: true, label };
	}
	for (const lane of EXT_LANES) {
		visSchema[lane.id] = { value: true, label: `🛰 ${lane.label}` };
	}
	const vis = useControls("可视 Visibility", visSchema) as Record<string, boolean>;

	// ---- leva: camera presets ----
	useControls("相机 Camera", {
		"👀 总览": button(() => setCameraPreset("overview")),
		"📥 入料": button(() => setCameraPreset("infeed")),
		"🔍 质检": button(() => setCameraPreset("inspection")),
		"🤖 分拣": button(() => setCameraPreset("sorter")),
		"📦 包装": button(() => setCameraPreset("packaging")),
		"🛰 外部车道": button(() => setCameraPreset("external")),
		"🚚 出料": button(() => setCameraPreset("outfeed")),
		"⛰ 斜坡": button(() => setCameraPreset("ramp")),
		"🌀 螺旋": button(() => setCameraPreset("spiral")),
	});

	// Hot-swap transfer plugin.
	useEffect(() => {
		const preset = BUILTIN_DEVICE_PLUGINS.find((plugin) => plugin.label === transferPlugin);
		if (preset) rendererRegistry.register(preset);
	}, [rendererRegistry, transferPlugin]);

	// World mode → flip every external lane's data source.
	useEffect(() => {
		worldModeRef.current = worldMode as "sim" | "external" | "hybrid";
		sim.setWorldMode(worldMode as "sim" | "external" | "hybrid");
		const src = worldMode === "sim" ? "sim" : "external";
		for (const lane of EXT_LANES) {
			const kf = extKindRef.current[lane.id] ?? { kind: lane.defaultKind, frame: lane.defaultFrame };
			sim.setDeviceDataSource(lane.id, src, {
				signal: kf.kind,
				frame: kf.frame,
			});
		}
	}, [sim, worldMode]);

	// Per-lane contract change → update ref + re-apply contract.
	useEffect(() => {
		for (const lane of EXT_LANES) {
			const kind = (ext[lane.id] as ExtKind) ?? lane.defaultKind;
			const frame = (ext[`${lane.id}-frame`] as "world" | "local") ?? lane.defaultFrame;
			extKindRef.current[lane.id] = { kind, frame };
			if (worldModeRef.current !== "sim") {
				const contract: ExternalContract = { signal: kind, frame };
				sim.setDeviceDataSource(lane.id, "external", contract);
			}
		}
	}, [ext, sim]);

	/**
	 * Synthetic external feed for the 4 digital-twin lanes. Each lane emits the
	 * signal kind selected in its leva dropdown, demonstrating the four
	 * external-data contracts (§14). Pure "sim" mode skips feeding so the
	 * lanes stay empty (the "no data" case).
	 */
	const externalFeeder = useMemo(() => {
		return (_elapsed: number, _delta: number): void => {
			if (worldModeRef.current === "sim") return;
			const t = sim.getElapsed();
			for (const lane of EXT_LANES) {
				const cfg = extKindRef.current[lane.id] ?? { kind: lane.defaultKind, frame: lane.defaultFrame };
				const geom = EXT_LANE_GEOM[lane.id];
				if (!geom) continue;
				const items = feedLane(
					{ curve: geom.curve, length: geom.length, speed: lane.speed, ids: geom.ids, cargoColorIndex: lane.cargoColorIndex },
					cfg.kind,
					cfg.frame,
					t,
				);
				if (items.length) sim.ingestExternalFrame([{ deviceId: lane.id, items }]);
			}
		};
	}, [sim]);

	useEffect(() => {
		sim.setGlobalSpeed(globalSpeed);
	}, [sim, globalSpeed]);

	useEffect(() => {
		sim.setSourceRate(spawnRate);
	}, [sim, spawnRate]);

	useEffect(() => {
		for (const id of sim.getDeviceIds()) sim.setRunning(id, !paused);
	}, [sim, paused]);

	const handleTelemetry = useCallback(
		(t: LaneTelemetry) => setTelemetry(t),
		[],
	);

	const cam = useCameraPreset(cameraPreset);
	const visibleLines = vis;

	const modeNote =
		worldMode === "external"
			? "仅外部数据：模拟线无数据已熄灭，只有外部车道在动"
			: worldMode === "hybrid"
				? "混合：模拟主线 + 外部数字孪生车道并行"
				: "模拟：外部车道无数据（空线）";

	return (
		<div
			style={{
				width: "100vw",
				height: "100vh",
				background: PALETTE.cream,
				position: "relative",
			}}
		>
			{/* Title card */}
			<div
				style={{
					position: "absolute",
					top: 16,
					left: 16,
					zIndex: 10,
					padding: "14px 18px",
					borderRadius: 16,
					background: "rgba(255, 253, 245, 0.92)",
					boxShadow: "0 10px 28px rgba(58, 74, 79, 0.12)",
					fontFamily: "system-ui, sans-serif",
					color: "#3A4A4F",
					backdropFilter: "blur(4px)",
					maxWidth: 280,
				}}
			>
				<h1 style={{ margin: 0, fontSize: 18 }}>Pastel Factory 🏭</h1>
				<p style={{ margin: "6px 0 0", fontSize: 12, opacity: 0.8, lineHeight: 1.5 }}>
					数据驱动的输送线世界模型：2 入料 · 2 分拣 · 2 质检+不合格货架 · 4 外部数字孪生车道。
				</p>
				<div style={{ marginTop: 8, fontSize: 11, opacity: 0.75, lineHeight: 1.5 }}>
					🛰 外部车道信号：<br />
					pose=自有坐标 / progress=百分比 / entry=入口 / span=入口+出口
				</div>
			</div>

			{/* Telemetry HUD */}
			<div
				style={{
					position: "absolute",
					top: 16,
					right: 16,
					zIndex: 10,
					width: 320,
					padding: "14px 16px",
					borderRadius: 16,
					background: "rgba(255, 253, 245, 0.92)",
					boxShadow: "0 10px 28px rgba(58, 74, 79, 0.12)",
					fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
					fontSize: 11,
					color: "#3A4A4F",
					backdropFilter: "blur(4px)",
				}}
			>
				<div
					style={{
						fontFamily: "system-ui, sans-serif",
						fontWeight: 700,
						fontSize: 13,
						marginBottom: 8,
					}}
				>
					📊 Sim Telemetry
				</div>
				<div>
					active {telemetry.stats.activeItems} · spawned {telemetry.stats.totalSpawned} ·
					consumed {telemetry.stats.totalConsumed} · blocked {telemetry.stats.blocked}
				</div>
				<div style={{ marginTop: 4, opacity: 0.85 }}>
					{Object.entries(telemetry.stats.throughput)
						.map(([sink, n]) => `${sink.replace("sink-", "")}: ${n}`)
						.join(" · ")}
				</div>
				<div style={{ marginTop: 4, opacity: 0.85 }}>
					{Object.entries(telemetry.stats.verdicts)
						.map(([insp, v]) => {
							const tally = v as { ok?: number; ng?: number };
							return `${insp.replace("inspector-", "Q")}: ✓${tally.ok ?? 0} ✗${tally.ng ?? 0}`;
						})
						.join(" · ")}
				</div>
				<div style={{ marginTop: 4, opacity: 0.85 }}>
					{Object.entries(telemetry.stats.stored)
						.map(([rack, n]) => {
							const cap = (rack === "reject-rack-1" || rack === "reject-rack-2")
								? REJECT_COLUMNS * REJECT_ROWS * REJECT_LAYERS
								: 1;
							return `🟠${rack.replace("reject-rack-", "R")}: ${n}/${cap}`;
						})
						.join(" · ")}
				</div>

				{/* External lane live panel */}
				<div
					style={{
						marginTop: 8,
						paddingTop: 8,
						borderTop: "1px solid rgba(58, 74, 79, 0.15)",
					}}
				>
					<div style={{ fontFamily: "system-ui, sans-serif", fontWeight: 700, marginBottom: 4 }}>
						🛰 外部数字孪生车道
					</div>
					{EXT_LANES.map((lane) => {
						const count = telemetry.laneCounts[lane.id] ?? 0;
						const kind = (ext[lane.id] as ExtKind) ?? lane.defaultKind;
						return (
							<div
								key={lane.id}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									marginTop: 3,
								}}
							>
								<span style={{ color: lane.color.getStyle() }}>{lane.label}</span>
								<span style={{ opacity: 0.85 }}>
									{kind} · <b style={{ color: count > 0 ? "#2E7D32" : "#999" }}>{count}</b>
								</span>
							</div>
						);
					})}
				</div>

				<div style={{ marginTop: 6, opacity: 0.6, fontSize: 10 }}>mode · {worldMode} — {modeNote}</div>

				<div
					style={{
						marginTop: 8,
						paddingTop: 8,
						borderTop: "1px solid rgba(58, 74, 79, 0.15)",
						lineHeight: 1.6,
						opacity: 0.75,
						maxHeight: 120,
						overflow: "hidden",
					}}
				>
					{telemetry.events.length === 0
						? "waiting for events…"
						: telemetry.events.map((e) => (
								<div key={e.seq}>
									[{e.time.toFixed(1)}s] {e.type} #{e.itemId ?? "–"}
									{e.detail ? ` ${e.detail}` : ""}
								</div>
							))}
				</div>
			</div>

			<Canvas camera={{ position: cam.position, fov: 50 }} shadows gl={{ antialias: true }}>
				<CameraController
					targetPosition={new THREE.Vector3(...cam.position)}
					targetLookAt={new THREE.Vector3(...cam.target)}
				/>
				<VividFactoryScene
					beltPaths={beltPaths}
					sim={sim}
					globalSpeed={globalSpeed}
					showPaths={showPaths}
					visibleLines={visibleLines}
					onTelemetry={handleTelemetry}
					rendererRegistry={rendererRegistry}
					externalFeeder={externalFeeder}
				/>
			</Canvas>
		</div>
	);
}
