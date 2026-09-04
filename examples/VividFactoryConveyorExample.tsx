import { OrbitControls, RoundedBox, Stats } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { button, useControls } from "leva";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
	BUILTIN_DEVICE_PLUGINS,
	ConveyorBelt,
	cuteLiftTransferPlugin,
	type DeviceLayout,
	DeviceRendererHost,
	DeviceRendererRegistry,
	FactorySim,
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
// Scene layout: 5 pastel conveyor lines arranged like the reference factory.
// Coordinates are in world units; Y is up.
// -----------------------------------------------------------------------------
interface BeltPath {
	id: string;
	color: THREE.Color;
	points: THREE.Vector3[];
	frameWidth?: number;
}

// Belt surface height above the floor; blue-line packaging bed sits higher.
const BELT_HEIGHT = 0.7;
const BELT_WIDTH = 1.1;

/**
 * Transfer decks are the SAME width as the line they are spliced into, so the
 * conveyor clips stop exactly at the deck edge and the load rolls straight
 * over the rollers.
 */
const JUNCTION_HALF = BELT_WIDTH / 2;
/** Metres the cassette lifts a load clear of the rollers. */
const LIFT_HEIGHT = 0.13;

function createBeltPaths(): BeltPath[] {
	const h = BELT_HEIGHT;
	const bedH = BELT_HEIGHT + 0.6;
	// Factory-style orthogonal layout: belts run dead straight along X/Z and
	// only turn at 90° corners. Merge point H and sorter S both sit on z = 0.
	return [
		{
			// green-line: infeed — runs south along x=-6, 90° turn east into H
			id: "green-line",
			color: COLOR_MINT,
			points: [
				new THREE.Vector3(-6, h, -4),
				new THREE.Vector3(-6, h, 0),
				new THREE.Vector3(-1.2, h, 0),
			],
		},
		{
			// purple-line: main trunk — dead straight from H to sorter S
			id: "purple-line",
			color: COLOR_LAVENDER,
			points: [
				new THREE.Vector3(-1.2, h, 0),
				new THREE.Vector3(8, h, 0),
			],
		},
		{
			// blue-line: packaging — 90° turn north, inclined riser, 90° turn east
			id: "blue-line",
			color: COLOR_SKY,
			points: [
				new THREE.Vector3(-1.2, h, 0),
				new THREE.Vector3(-1.2, h, 2.2),
				new THREE.Vector3(-1.2, bedH, 3.6),
				new THREE.Vector3(2.5, bedH, 3.6),
			],
		},
		{
			// peach-line: north sort branch — leaves sorter perpendicular (heading -z)
			id: "peach-line",
			color: COLOR_PEACH,
			points: [
				new THREE.Vector3(8, h, 0),
				new THREE.Vector3(8, h, -3.5),
			],
		},
		{
			// yellow-line: south sort branch — leaves sorter perpendicular (heading +z)
			id: "yellow-line",
			color: COLOR_BUTTER,
			points: [
				new THREE.Vector3(8, h, 0),
				new THREE.Vector3(8, h, 3.5),
			],
		},
	];
}

const MERGE_CENTER = new THREE.Vector3(-1.2, BELT_HEIGHT, 0);
const MERGE_GAP = JUNCTION_HALF;

// Second junction: the sorter/diverter point where the main trunk splits
// into the peach (north) and yellow (south) outfeed branches.
const SORTER_CENTER = new THREE.Vector3(8, BELT_HEIGHT, 0);
const SORTER_GAP = JUNCTION_HALF;

const JUNCTIONS = [
	{ center: MERGE_CENTER, gap: MERGE_GAP },
	{ center: SORTER_CENTER, gap: SORTER_GAP },
];

/**
 * Lift-cycle timings shared by both decks. `dwell` is the roll-on time, then
 * the cassette rises, drives the load out sideways and retracts.
 */
const LIFT_CYCLE = {
	dwell: 0.4,
	upTime: 0.18,
	transferTime: 0.34,
	downTime: 0.18,
} as const;

/**
 * Which outfeeds each deck has, in the SAME order as the simulation's route
 * list — that ordering is what lets a renderer map `routeIndex` to a
 * physical outlet without knowing the routing rule.
 */
const TRANSFER_SPECS = [
	{
		id: "junction-H",
		center: MERGE_CENTER,
		routes: ["purple-line", "blue-line"],
	},
	{
		id: "junction-S",
		center: SORTER_CENTER,
		routes: ["peach-line", "yellow-line"],
	},
] as const;

function clipPathForJunction(
	path: BeltPath,
	center: THREE.Vector3,
	gap: number,
): THREE.Vector3[] {
	const pts = path.points;
	const clipped = pts.map((p) => p.clone());
	if (pts.length < 2) return clipped;

	// Starting at the junction
	if (pts[0].distanceTo(center) < 0.3) {
		const dir = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
		clipped[0] = center.clone().add(dir.multiplyScalar(gap));
	}

	// Ending at the junction
	const last = pts.length - 1;
	if (pts[last].distanceTo(center) < 0.3) {
		const dir = new THREE.Vector3().subVectors(pts[last - 1], pts[last]).normalize();
		clipped[last] = center.clone().add(dir.multiplyScalar(gap));
	}

	return clipped;
}

interface JunctionPorts {
	/** Direction the infeed belt leaves the deck, i.e. backwards along the flow. */
	infeed: THREE.Vector3 | null;
	/** Outbound direction per belt id. */
	outfeeds: Map<string, THREE.Vector3>;
}

/**
 * Derives a junction's ports straight from the belt geometry: a path that
 * ends at the centre is an infeed, a path that starts there is an outfeed.
 * No hand-authored angles, so the layout cannot drift from the belts.
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

/**
 * Builds the renderer layout for a lift-and-transfer deck.
 *
 * `yaw` aligns local +X with the deck's main flow (the roller drive
 * direction). Each outfeed is then converted into the deck's local frame:
 * a zero Z-component means "straight through, rollers do the work", a
 * non-zero one means the cassette must lift and drive the load out sideways.
 */
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
		// World → deck local (inverse of the group's Y rotation).
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

// -----------------------------------------------------------------------------
// Right-angle belt geometry: straight runs with small filleted 90° corners
// (like real factory corner-transfer conveyors). The fillet is densified so
// downstream CatmullRom curves stay perfectly straight between corners.
// -----------------------------------------------------------------------------
const CORNER_FILLET = 0.45;

function filletPolyline(
	points: THREE.Vector3[],
	radius = CORNER_FILLET,
	arcSegments = 5,
): THREE.Vector3[] {
	if (points.length < 3) return points;

	const out: THREE.Vector3[] = [points[0].clone()];
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1];
		const cur = points[i];
		const next = points[i + 1];
		const dIn = cur.distanceTo(prev);
		const dOut = cur.distanceTo(next);
		// Clamp so adjacent fillets never overlap a shared straight segment.
		const r = Math.min(radius, dIn * 0.45, dOut * 0.45);
		const dirIn = cur.clone().sub(prev).normalize();
		const dirOut = next.clone().sub(cur).normalize();
		const a = cur.clone().sub(dirIn.multiplyScalar(r));
		const b = cur.clone().add(dirOut.multiplyScalar(r));

		if (r > 1e-4) {
			const arc = new THREE.QuadraticBezierCurve3(a, cur.clone(), b);
			for (let s = 0; s <= arcSegments; s++) {
				out.push(arc.getPoint(s / arcSegments));
			}
		} else {
			out.push(a, b);
		}
	}
	out.push(points[points.length - 1].clone());
	return out;
}

function beltCurve(points: THREE.Vector3[]): THREE.CatmullRomCurve3 {
	return new THREE.CatmullRomCurve3(filletPolyline(points), false, "chordal");
}

// -----------------------------------------------------------------------------
// DATA-DRIVEN LAYER: the factory as a device graph, not as visuals.
//
// rack-a (source)  → green-line ──→ junction-H ──┬─→ purple-line → junction-S ─┬─→ peach-line  → sink-north
//                                                  │                             └─→ yellow-line → sink-south
//                                                  └─→ blue-line → sink-packaging
//
// junction-H routes by item type (parcel → trunk, crate → packaging);
// junction-S alternates its diverter state every few seconds. Everything is
// recorded as events inside the sim; the renderer only sees FrameDelta.
// -----------------------------------------------------------------------------
const CARGO_COLORS = PALETTE.cargoColors.map((c) => new THREE.Color(c));

function buildFactorySim(beltPaths: BeltPath[], lift: number): FactorySim {
	const toSim = (ps: THREE.Vector3[]): SimPoint[] =>
		ps.map((p) => ({ x: p.x, y: p.y + lift, z: p.z }));

	// Sim paths match the rendered belts: clipped at junction gaps so items
	// hand off exactly at the transfer-table edges.
	const clippedPoints = (id: string): THREE.Vector3[] => {
		const path = beltPaths.find((p) => p.id === id);
		if (!path) throw new Error(`buildFactorySim: unknown belt "${id}"`);
		return JUNCTIONS.reduce(
			(pts, junction) =>
				clipPathForJunction({ ...path, points: pts }, junction.center, junction.gap),
			path.points,
		);
	};

	const junctionPoint = (p: THREE.Vector3): SimPoint => ({
		x: p.x,
		y: p.y + lift,
		z: p.z,
	});

	const defs: SimDeviceDef[] = [
		{
			id: "rack-a",
			kind: "source",
			output: "green-line",
			interval: 1.2,
			itemTypes: [
				{ typeId: "parcel", colorIndex: 0, weight: 1 },
				{ typeId: "parcel", colorIndex: 1, weight: 1 },
				{ typeId: "parcel", colorIndex: 2, weight: 1 },
				{ typeId: "parcel", colorIndex: 3, weight: 1 },
				{ typeId: "crate", colorIndex: 4, weight: 1.2 },
			],
		},
		{
			id: "green-line",
			kind: "transport",
			points: toSim(clippedPoints("green-line")),
			speed: 0.8,
			minGap: 0.55,
			next: "junction-H",
		},
		{
			id: "junction-H",
			kind: "junction",
			position: junctionPoint(MERGE_CENTER),
			...LIFT_CYCLE,
			// Parcels roll straight over the rollers; crates get lifted out
			// sideways onto the packaging line.
			routes: { parcel: "purple-line", crate: "blue-line" },
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
			speed: 0.8,
			minGap: 0.55,
			next: "junction-S",
		},
		{
			id: "junction-S",
			kind: "junction",
			position: junctionPoint(SORTER_CENTER),
			dwell: LIFT_CYCLE.dwell,
			alternate: { devices: ["peach-line", "yellow-line"], interval: 3 },
			// Both branches leave perpendicular, so every load is lifted; the
			// transfer shafts simply reverse to go north or south.
			lift: {
				height: LIFT_HEIGHT,
				upTime: LIFT_CYCLE.upTime,
				transferTime: LIFT_CYCLE.transferTime,
				downTime: LIFT_CYCLE.downTime,
			},
		},
		{
			id: "blue-line",
			kind: "transport",
			points: toSim(clippedPoints("blue-line")),
			speed: 0.7,
			minGap: 0.55,
			next: "sink-packaging",
		},
		{
			id: "peach-line",
			kind: "transport",
			points: toSim(clippedPoints("peach-line")),
			speed: 0.8,
			minGap: 0.55,
			next: "sink-north",
		},
		{
			id: "yellow-line",
			kind: "transport",
			points: toSim(clippedPoints("yellow-line")),
			speed: 0.8,
			minGap: 0.55,
			next: "sink-south",
		},
		{ id: "sink-packaging", kind: "sink" },
		{ id: "sink-north", kind: "sink" },
		{ id: "sink-south", kind: "sink" },
	];

	return new FactorySim(defs);
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
			{/* Four rounded posts */}
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

			{/* Shelves */}
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

			{/* Decorative boxes on shelves */}
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

			{/* Tiny status light */}
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
// Conveyor model optimization: support legs under every belt. Sampled along
// each curve, skipping junction zones; incline segments get taller legs.
// Rendered with InstancedMeshPool for performance.
// -----------------------------------------------------------------------------
interface LegInstance {
	x: number;
	z: number;
	height: number;
}

function computeLegs(
	paths: BeltPath[],
	junctions: { center: THREE.Vector3; gap: number }[],
	spacing = 1.35,
): LegInstance[] {
	const legs: LegInstance[] = [];
	for (const path of paths) {
		const curve = beltCurve(path.points);
		const length = curve.getLength();
		const count = Math.max(2, Math.floor(length / spacing));
		for (let i = 0; i <= count; i++) {
			const t = i / count;
			const p = curve.getPointAt(t);

			// Skip samples that fall inside a junction device footprint.
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

	// Legs are static: write matrices once.
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
			{/* motor body */}
			<RoundedBox args={[0.34, 0.3, 0.5]} radius={0.05} castShadow>
				<meshStandardMaterial
					color={PALETTE.cream}
					roughness={0.5}
					metalness={0.05}
				/>
			</RoundedBox>
			{/* colored accent stripe */}
			<RoundedBox args={[0.36, 0.08, 0.52]} radius={0.03} position={[0, 0.06, 0]}>
				<meshStandardMaterial color={PALETTE.lavender} roughness={0.5} />
			</RoundedBox>
			{/* drive shaft + cooling fan on the far side */}
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
// SIM-DRIVEN CARGO LAYER.
//
// The renderer owns ZERO logic: every frame it calls sim.tick(delta) and
// applies the returned FrameDelta to an InstancedMeshPool.
// - spawned → allocate a render slot + write its color (once)
// - moved   → rewrite only that slot's matrix
// - removed → park the slot (zero scale) and recycle it
// When nothing moves (paused belts, blocked queues) no matrix is touched.
// -----------------------------------------------------------------------------
const MAX_RENDER_ITEMS = 300;

function SimCargoLayer({
	sim,
	frameHeight,
	onTelemetry,
}: {
	sim: FactorySim;
	frameHeight: number;
	onTelemetry?: (stats: SimStats, events: SimEvent[]) => void;
}) {
	const poolRef = useRef<InstancedMeshPoolRef>(null);
	const slotOf = useRef(new Map<number, number>());
	const freeSlots = useRef<number[]>([]);
	const initialized = useRef(false);
	const telemetryTimer = useRef(0);

	const lift = frameHeight / 2 + 0.07 + 0.02;

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

	useFrame((_, delta) => {
		const pool = poolRef.current;
		if (!pool) return;

		// One-time slot table init: park every slot with zero scale.
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

		const d = sim.tick(Math.min(delta, 0.25));

		// -- spawned: allocate slots + colors --------------------------------
		let colorsDirty = false;
		for (const s of d.spawned) {
			const slot = freeSlots.current.pop();
			if (slot === undefined) continue; // render pool exhausted
			slotOf.current.set(s.itemId, slot);
			const color = CARGO_COLORS[s.colorIndex % CARGO_COLORS.length];
			if (color) pool.setColorAt(slot, color);
			colorsDirty = true;
		}

		// -- moved: rewrite only changed matrices ----------------------------
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

		// -- removed: park + recycle slots -----------------------------------
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

		// -- telemetry to the DOM HUD, throttled to ~4 Hz --------------------
		telemetryTimer.current += delta;
		if (telemetryTimer.current > 0.25) {
			telemetryTimer.current = 0;
			onTelemetry?.(d.stats, sim.getRecentEvents(8));
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
}: {
	beltPaths: BeltPath[];
	sim: FactorySim;
	globalSpeed: number;
	showPaths: boolean;
	visibleLines: Record<string, boolean>;
	onTelemetry?: (stats: SimStats, events: SimEvent[]) => void;
	rendererRegistry: DeviceRendererRegistry;
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

	// Animate arrow uniforms.
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
				// Fillet after clipping so the belt mesh follows straight runs with
				// rounded 90° corners instead of a smoothed spline.
				clippedPoints: filletPolyline(
					JUNCTIONS.reduce(
						(pts, junction) =>
							clipPathForJunction(
								{ ...path, points: pts },
								junction.center,
								junction.gap,
							),
						path.points,
					),
				),
			})),
		[beltPaths],
	);

	// Transfer decks are pure DATA: the layout is derived from the belts and
	// the renderers come from the plugin registry, so swapping a plugin swaps
	// the machine without touching the topology.
	const transferDevices = useMemo(
		() =>
			TRANSFER_SPECS.map((spec) => ({
				id: spec.id,
				layout: buildTransferLayout(beltPaths, spec.center, spec.routes),
			})),
		[beltPaths],
	);

	// Motor units at the start of each visible belt line.
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

	// Support legs for every visible belt line.
	const legs = useMemo(
		() =>
			computeLegs(
				beltRenderData.filter((path) => visibleLines[path.id]),
				JUNCTIONS,
			),
		[beltRenderData, visibleLines],
	);

	return (
		<>
			<ambientLight intensity={0.55} color={PALETTE.warmLight} />
			<directionalLight
				position={[8, 12, 6]}
				intensity={1.1}
				color={PALETTE.warmLight}
				castShadow
				shadow-mapSize={[2048, 2048]}
				shadow-camera-left={-15}
				shadow-camera-right={15}
				shadow-camera-top={15}
				shadow-camera-bottom={-15}
				shadow-camera-near={0.1}
				shadow-camera-far={40}
			/>
			<pointLight position={[-5, 4, -5]} intensity={0.6} color="#FFE4C4" />

			{/* Floor */}
			<RoundedBox args={[28, 0.2, 18]} radius={0.05} position={[2.5, -0.15, 0]}>
				<meshStandardMaterial color={PALETTE.floor} roughness={0.85} />
			</RoundedBox>

			{/* Grid just for orientation */}
			<gridHelper
				args={[28, 28, 0x4f6267, 0x3a4a4f]}
				position={[2.5, -0.04, 0]}
			/>

			{/* Racks */}
			<CuteRack position={[-7, 0, -3]} />
			<CuteRack position={[-7, 0, 1]} />

			{/* Conveyor belts */}
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

			{/* Support legs under the belts */}
			<SupportLegs legs={legs} material={frameMaterial} />

			{/* Drive motors at line starts */}
			{motorData.map((motor) => (
				<CuteMotor
					key={`motor-${motor.id}`}
					position={motor.position}
					heading={motor.heading}
					globalSpeed={globalSpeed}
				/>
			))}

			{/* Transfer decks: resolved through the plugin registry, so the
			    machine model can be swapped at runtime. */}
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

			{/* Sim-driven cargo: renderer only applies FrameDelta */}
			<SimCargoLayer sim={sim} frameHeight={0.28} onTelemetry={onTelemetry} />

			{/* Optional path debug lines */}
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
				minDistance={3}
				maxDistance={28}
				target={[2.5, BELT_HEIGHT, 0]}
			/>
			<Stats />
		</>
	);
}

// -----------------------------------------------------------------------------
// Camera presets helper.
// -----------------------------------------------------------------------------
function useCameraPreset(
	preset: "overview" | "infeed" | "sorter" | "outfeed" | "packaging",
) {
	const target = useMemo(() => {
		switch (preset) {
			case "infeed":
				return {
					position: [-8.5, 3.2, 3.5] as [number, number, number],
					target: [-5, BELT_HEIGHT, -0.8] as [number, number, number],
				};
			case "sorter":
				return {
					position: [10, 4, 6] as [number, number, number],
					target: [8, BELT_HEIGHT, 0] as [number, number, number],
				};
			case "outfeed":
				return {
					position: [11.5, 3, 6.5] as [number, number, number],
					target: [8, BELT_HEIGHT, 2.5] as [number, number, number],
				};
			case "packaging":
				return {
					position: [-1, 5, 7.5] as [number, number, number],
					target: [0.7, BELT_HEIGHT + 0.6, 3.6] as [number, number, number],
				};
			case "overview":
			default:
				return {
					position: [8, 11, 14] as [number, number, number],
					target: [2.5, BELT_HEIGHT, 0] as [number, number, number],
				};
		}
	}, [preset]);
	return target;
}

// -----------------------------------------------------------------------------
// Example wrapper with UI controls.
// -----------------------------------------------------------------------------
export function VividFactoryConveyorExample() {
	const [paused, setPaused] = useState(false);
	const [cameraPreset, setCameraPreset] = useState<
		"overview" | "infeed" | "sorter" | "outfeed" | "packaging"
	>("overview");
	const [telemetry, setTelemetry] = useState<{
		stats: SimStats;
		events: SimEvent[];
	}>({
		stats: {
			activeItems: 0,
			totalSpawned: 0,
			totalConsumed: 0,
			blocked: 0,
			throughput: {},
		},
		events: [],
	});

	// The factory lives as DATA: one sim instance built from the layout.
	const beltPaths = useMemo(createBeltPaths, []);
	const sim = useMemo(() => buildFactorySim(beltPaths, 0.28 / 2 + 0.09), [
		beltPaths,
	]);
	// Device renderer plugins live in a registry; registering a plugin with
	// the same kind replaces it everywhere, which is what the picker below
	// exercises at runtime.
	const rendererRegistry = useMemo(() => {
		const registry = new DeviceRendererRegistry();
		registry.register(cuteLiftTransferPlugin);
		return registry;
	}, []);

	const {
		globalSpeed,
		spawnRate,
		showPaths,
		greenLine,
		purpleLine,
		blueLine,
		peachLine,
		yellowLine,
		transferPlugin,
	} = useControls({
		transferPlugin: {
			value: cuteLiftTransferPlugin.label,
			options: BUILTIN_DEVICE_PLUGINS.map((plugin) => plugin.label),
			label: "分流转接台插件",
		},
		globalSpeed: { value: 1, min: 0, max: 2.5, step: 0.1, label: "Speed" },
		spawnRate: {
			value: 1,
			min: 0.2,
			max: 4,
			step: 0.1,
			label: "Spawn rate",
		},
		showPaths: { value: false, label: "Debug paths" },
		greenLine: { value: true, label: "🟢 Infeed" },
		purpleLine: { value: true, label: "🟣 Main trunk" },
		blueLine: { value: true, label: "🔵 Packaging" },
		peachLine: { value: true, label: "🍑 Sort north" },
		yellowLine: { value: true, label: "🟡 Outfeed" },
		"⏸ Pause": button(() => setPaused((p) => !p)),
		"👀 Overview": button(() => setCameraPreset("overview")),
		"📥 Infeed": button(() => setCameraPreset("infeed")),
		"🤖 Sorter": button(() => setCameraPreset("sorter")),
		"📦 Packaging": button(() => setCameraPreset("packaging")),
		"🚚 Outfeed": button(() => setCameraPreset("outfeed")),
	});

	// Hot-swap: re-registering the selected preset under the same kind swaps
	// the component inside every DeviceRendererHost. The simulation keeps
	// ticking — nothing about the topology or the routing data changes.
	useEffect(() => {
		const preset = BUILTIN_DEVICE_PLUGINS.find(
			(plugin) => plugin.label === transferPlugin,
		);
		if (preset) rendererRegistry.register(preset);
	}, [rendererRegistry, transferPlugin]);

	// UI controls map straight onto sim control API — no rendering knowledge.
	useEffect(() => {
		sim.setGlobalSpeed(globalSpeed);
	}, [sim, globalSpeed]);

	useEffect(() => {
		sim.setSourceRate(spawnRate);
	}, [sim, spawnRate]);

	useEffect(() => {
		for (const id of sim.getDeviceIds()) {
			sim.setRunning(id, !paused);
		}
	}, [sim, paused]);

	const handleTelemetry = useCallback(
		(stats: SimStats, events: SimEvent[]) => setTelemetry({ stats, events }),
		[],
	);

	const cam = useCameraPreset(cameraPreset);

	const visibleLines = useMemo(
		() => ({
			"green-line": greenLine,
			"purple-line": purpleLine,
			"blue-line": blueLine,
			"peach-line": peachLine,
			"yellow-line": yellowLine,
		}),
		[greenLine, purpleLine, blueLine, peachLine, yellowLine],
	);

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
					top: 20,
					left: 20,
					zIndex: 10,
					padding: "18px 22px",
					borderRadius: 18,
					background: "rgba(255, 253, 245, 0.92)",
					boxShadow: "0 10px 28px rgba(58, 74, 79, 0.12)",
					fontFamily: "system-ui, sans-serif",
					color: "#3A4A4F",
					backdropFilter: "blur(4px)",
				}}
			>
				<h1 style={{ margin: 0, fontSize: 20 }}>Pastel Factory 🏭</h1>
				<p style={{ margin: "6px 0 0", fontSize: 13, opacity: 0.8 }}>
					Cute toy-style conveyor network built with r3f-tools.
				</p>
				<div
					style={{
						marginTop: 10,
						display: "flex",
						gap: 8,
						fontSize: 12,
						flexWrap: "wrap",
					}}
				>
					<span
						style={{
							padding: "4px 8px",
							borderRadius: 8,
							background: PALETTE.mint,
						}}
					>
						Infeed
					</span>
					<span
						style={{
							padding: "4px 8px",
							borderRadius: 8,
							background: PALETTE.lavender,
						}}
					>
						Trunk
					</span>
					<span
						style={{
							padding: "4px 8px",
							borderRadius: 8,
							background: PALETTE.sky,
						}}
					>
						Packaging
					</span>
					<span
						style={{
							padding: "4px 8px",
							borderRadius: 8,
							background: PALETTE.peach,
						}}
					>
						Sort
					</span>
					<span
						style={{
							padding: "4px 8px",
							borderRadius: 8,
							background: PALETTE.butter,
						}}
					>
						Outfeed
					</span>
				</div>
			</div>

			{/* Telemetry HUD: reads only recorded sim data */}
			<div
				style={{
					position: "absolute",
					top: 20,
					right: 20,
					zIndex: 10,
					width: 300,
					padding: "14px 16px",
					borderRadius: 18,
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
					active {telemetry.stats.activeItems} · spawned{" "}
					{telemetry.stats.totalSpawned} · consumed{" "}
					{telemetry.stats.totalConsumed} · blocked {telemetry.stats.blocked}
				</div>
				<div style={{ marginTop: 4, opacity: 0.85 }}>
					{Object.entries(telemetry.stats.throughput)
						.map(([sink, n]) => `${sink.replace("sink-", "")}: ${n}`)
						.join(" · ")}
				</div>
				<div style={{ marginTop: 4, opacity: 0.6 }}>
					plugin · {transferPlugin}
				</div>
				<div
					style={{
						marginTop: 8,
						paddingTop: 8,
						borderTop: "1px solid rgba(58, 74, 79, 0.15)",
						lineHeight: 1.6,
						opacity: 0.75,
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
				/>
			</Canvas>
		</div>
	);
}
