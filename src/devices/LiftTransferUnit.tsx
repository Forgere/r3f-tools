import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
	InstancedMeshPool,
	type InstancedMeshPoolRef,
} from "../components/InstanceMeshPool";
import {
	cylinderGeometry,
	roundedBoxGeometry,
	sphereGeometry,
} from "./geometry";
import type { DeviceRendererProps } from "./types";

/**
 * Lift-and-transfer deck (顶升移栽机 / 分流转接台).
 *
 * How the real machine works, and what this model reproduces:
 *  - the deck is the same width as the line it is spliced into;
 *  - a bank of rollers with axes across the flow keeps pushing material
 *    straight through, exactly like the conveyor on either side;
 *  - tucked in the gaps between those rollers sits a cassette of small
 *    transverse drive shafts (小传动轴) with wheels on them, retracted just
 *    below the roller line;
 *  - when a load has to leave sideways the cassette rises a few centimetres,
 *    lifting the load clear of the rollers, the shafts spin up and drive it
 *    out perpendicular, then the cassette retracts and the next load rolls
 *    straight over the top.
 *
 * Every moving value (cassette height, spin, lamp) is read from the
 * simulation through `readState()` — this component owns no logic.
 */

/** Roller top = load surface, flush with the conveyor frame top. */
const DECK_TOP = 0.14;
const ROLLER_RADIUS = 0.055;
const ROLLER_Y = DECK_TOP - ROLLER_RADIUS;
const ROLLER_COUNT = 8;
const WHEEL_RADIUS = 0.042;
const WHEEL_THICKNESS = 0.03;
/** Three wheels per shaft: two outer, one centre. */
const WHEELS_PER_SHAFT = 3;
const SHAFT_RADIUS = 0.013;
/** Retracted shaft sits just under the roller line. */
const SHAFT_Y = ROLLER_Y - 0.008;
const SHAFT_COUNT = ROLLER_COUNT - 1;
const DEFAULT_LIFT_HEIGHT = 0.13;
const PLATE_HEIGHT = 0.28;
const PLATE_THICKNESS = 0.11;
/** Clear opening cut in a side plate so loads can leave sideways. */
const OPENING = 0.7;
/** Idle roller surface speed, m/s. */
const ROLLER_SPEED = 1.3;
/** Transfer wheel surface speed while diverting, m/s. */
const TRANSFER_SPEED = 1.6;

interface Instance {
	x: number;
	y: number;
	z: number;
}

function numberAt(
	config: Readonly<Record<string, unknown>> | undefined,
	key: string,
	fallback: number,
): number {
	const value = config?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function LiftTransferUnit({
	layout,
	theme,
	config,
	readState,
}: DeviceRendererProps) {
	const length = layout.length;
	const width = layout.width;
	const liftHeight = numberAt(config, "liftHeight", DEFAULT_LIFT_HEIGHT);
	const floorY = layout.floorY ?? 0;
	const routeSigns = layout.routeSigns ?? [];
	const detail = theme.detail !== false;

	// --- geometry layout ----------------------------------------------------
	const deck = useMemo(() => {
		const halfL = length / 2;
		const rollerSpan = Math.max(length - 0.06, 0.1);
		const step = rollerSpan / (ROLLER_COUNT - 1);
		const rollers: Instance[] = [];
		for (let i = 0; i < ROLLER_COUNT; i++) {
			rollers.push({ x: -rollerSpan / 2 + step * i, y: ROLLER_Y, z: 0 });
		}
		const shafts: Instance[] = [];
		for (let i = 0; i < SHAFT_COUNT; i++) {
			shafts.push({ x: -rollerSpan / 2 + step * (i + 0.5), y: SHAFT_Y, z: 0 });
		}
		const wheelZ = [-width * 0.27, 0, width * 0.27];
		const wheels: Instance[] = [];
		for (const shaft of shafts) {
			for (const z of wheelZ) wheels.push({ x: shaft.x, y: SHAFT_Y, z });
		}

		// Structural rails live outside the roller envelope so the cassette
		// can rise past the rollers without intersecting them.
		const rollerHalfLength = (width - 0.28) / 2;
		const railZ = Math.min(width / 2 - 0.09, rollerHalfLength + 0.06);

		const openedNeg = routeSigns.some((s) => s < -0.5);
		const openedPos = routeSigns.some((s) => s > 0.5);
		const segmentLength = (length - OPENING) / 2;
		const segmentOffset = OPENING / 2 + segmentLength / 2;
		const plates: { x: number; z: number; length: number }[] = [];
		for (const side of [-1, 1] as const) {
			const opened = side < 0 ? openedNeg : openedPos;
			if (opened && segmentLength > 0.02) {
				plates.push({ x: -segmentOffset, z: (side * width) / 2, length: segmentLength });
				plates.push({ x: segmentOffset, z: (side * width) / 2, length: segmentLength });
			} else {
				plates.push({ x: 0, z: (side * width) / 2, length });
			}
		}

		const cylinderX = length / 2 - 0.22;
		const cylinders: Instance[] = [];
		for (const z of [-railZ, railZ]) {
			cylinders.push({ x: -cylinderX, y: 0, z });
			cylinders.push({ x: cylinderX, y: 0, z });
		}

		return {
			halfL,
			rollers,
			shafts,
			wheels,
			wheelZ,
			railZ,
			rollerHalfLength,
			plates,
			cylinders,
			cylinderX,
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [length, width, routeSigns.join(",")]);

	// --- static vertical offsets -------------------------------------------
	const deckY = layout.position[1];
	const geom = useMemo(() => {
		const floorLocal = floorY - deckY;
		const panY = -0.215;
		const panHeight = 0.07;
		const bodyBase = panY + panHeight / 2; // top of the pan
		const bodyHeight = 0.1;
		const bodyTop = bodyBase + bodyHeight;
		const railY = SHAFT_Y - 0.075;
		const railBottom = railY - 0.02;
		const rodRest = Math.max(railBottom - bodyTop, 0.02);
		return {
			floorLocal,
			panY,
			panHeight,
			bodyBase,
			bodyHeight,
			bodyTop,
			railY,
			rodRest,
			pedestalTop: panY - panHeight / 2,
		};
	}, [floorY, deckY]);

	// --- materials ----------------------------------------------------------
	const materials = useMemo(() => {
		const make = (color: string, roughness: number, metalness: number) =>
			new THREE.MeshStandardMaterial({ color, roughness, metalness });
		return {
			frame: make(theme.frame, theme.roughness, theme.metalness),
			accent: make(theme.accent, theme.roughness * 0.9, theme.metalness),
			roller: make(theme.roller, 0.4, 0.2),
			metal: make(theme.metal, 0.35, 0.55),
			deck: make(theme.deck, theme.roughness, theme.metalness * 0.5),
			lamp: new THREE.MeshStandardMaterial({
				color: theme.lightIdle,
				emissive: theme.lightIdle,
				emissiveIntensity: 0.6,
				roughness: 0.3,
			}),
			sensor: new THREE.MeshStandardMaterial({
				color: "#E7695D",
				emissive: "#E7695D",
				emissiveIntensity: 0.8,
				roughness: 0.3,
			}),
		};
	}, [theme]);

	useEffect(() => {
		return () => {
			for (const material of Object.values(materials)) material.dispose();
		};
	}, [materials]);

	// --- pools & refs -------------------------------------------------------
	const rollerPool = useRef<InstancedMeshPoolRef>(null);
	const shaftPool = useRef<InstancedMeshPoolRef>(null);
	const wheelPool = useRef<InstancedMeshPoolRef>(null);
	const cassetteRef = useRef<THREE.Group>(null);
	const rodRefs = useRef<(THREE.Mesh | null)[]>([]);
	const spin = useRef({ roller: 0, wheel: 0 });

	const rollerGeometry = useMemo(
		() =>
			cylinderGeometry(
				ROLLER_RADIUS,
				ROLLER_RADIUS,
				width - 0.28,
				16,
			),
		[width],
	);
	const shaftGeometry = useMemo(
		() => cylinderGeometry(SHAFT_RADIUS, SHAFT_RADIUS, width - 0.24, 10),
		[width],
	);
	const wheelGeometry = useMemo(
		() =>
			cylinderGeometry(
				WHEEL_RADIUS,
				WHEEL_RADIUS,
				WHEEL_THICKNESS,
				14,
			),
		[],
	);
	const rodGeometry = useMemo(() => cylinderGeometry(0.026, 0.026, 1, 10), []);

	// Shafts never move relative to the cassette: write once.
	useEffect(() => {
		const pool = shaftPool.current;
		if (!pool) return;
		const dummy = new THREE.Object3D();
		pool.setInstanceCount(deck.shafts.length);
		deck.shafts.forEach((shaft, i) => {
			dummy.position.set(shaft.x, shaft.y, shaft.z);
			// Cylinder axis (Y) → X, so the shaft lies across the transfer
			// direction and its wheels drive along Z.
			dummy.rotation.set(0, 0, Math.PI / 2);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			pool.setMatrixAt(i, dummy.matrix);
		});
		pool.updateMatrices();
	}, [deck.shafts]);

	useEffect(() => {
		rollerPool.current?.setInstanceCount(deck.rollers.length);
		wheelPool.current?.setInstanceCount(deck.wheels.length);
	}, [deck.rollers.length, deck.wheels.length]);

	const dummy = useMemo(() => new THREE.Object3D(), []);

	useFrame((_, rawDelta) => {
		const state = readState();
		const delta = Math.min(rawDelta, 0.1);
		const running = state.running;
		const lift = state.lift;

		// Roller bank: always running, pushes the load along +X.
		const rollers = rollerPool.current;
		if (rollers) {
			if (running) {
				// Negative spin about Z moves the roller surface towards +X.
				spin.current.roller -= (ROLLER_SPEED / ROLLER_RADIUS) * delta;
			}
			for (let i = 0; i < deck.rollers.length; i++) {
				const roller = deck.rollers[i];
				if (!roller) continue;
				dummy.position.set(roller.x, roller.y, roller.z);
				// Spin about the cylinder's own Y first, then lay it along Z.
				dummy.rotation.set(Math.PI / 2, spin.current.roller, 0);
				dummy.scale.setScalar(1);
				dummy.updateMatrix();
				rollers.setMatrixAt(i, dummy.matrix);
			}
			rollers.updateMatrices();
		}

		// Transfer wheels: only turn while the cassette is up and diverting.
		const wheels = wheelPool.current;
		if (wheels) {
			const sign = routeSigns[state.routeIndex] ?? 0;
			const diverting =
				running && Math.abs(sign) > 0.5 && state.phase === "transfer";
			if (diverting) {
				spin.current.wheel +=
					(Math.sign(sign) * TRANSFER_SPEED * delta) / WHEEL_RADIUS;
			}
			for (let i = 0; i < deck.wheels.length; i++) {
				const wheel = deck.wheels[i];
				if (!wheel) continue;
				dummy.position.set(wheel.x, wheel.y, wheel.z);
				// Align the axis to X first (Rz), then spin about X (Rx).
				dummy.rotation.set(spin.current.wheel, 0, Math.PI / 2);
				dummy.scale.setScalar(1);
				dummy.updateMatrix();
				wheels.setMatrixAt(i, dummy.matrix);
			}
			wheels.updateMatrices();
		}

		// Cassette rise + telescoping rods.
		const rise = lift * liftHeight;
		if (cassetteRef.current) cassetteRef.current.position.y = rise;
		for (const rod of rodRefs.current) {
			if (!rod) continue;
			const h = geom.rodRest + rise;
			rod.scale.set(1, h, 1);
			rod.position.y = geom.bodyTop + h / 2;
		}

		// Status lamp: idle / cycling.
		const cycling = state.phase !== "idle" && state.phase !== "dwell";
		materials.lamp.color.set(cycling ? theme.lightActive : theme.lightIdle);
		materials.lamp.emissive.set(
			cycling ? theme.lightActive : theme.lightIdle,
		);
		materials.lamp.emissiveIntensity = cycling
			? 0.6 + Math.abs(Math.sin(performance.now() * 0.006)) * 0.9
			: 0.45;
		materials.sensor.emissiveIntensity = state.occupied ? 1.2 : 0.25;
	});

	const cr = theme.cornerRadius;
	const pedestalHeight = Math.max(geom.pedestalTop - geom.floorLocal, 0.05);

	return (
		<group position={layout.position} rotation={[0, layout.yaw, 0]}>
			{/* ---- fixed frame ------------------------------------------------ */}
			<mesh
				geometry={roundedBoxGeometry(
					length - 0.2,
					geom.panHeight,
					width - 0.16,
					cr,
				)}
				position={[0, geom.panY, 0]}
				material={materials.deck}
				castShadow
				receiveShadow
			/>

			{deck.plates.map((plate, i) => (
				<mesh
					key={`plate-${i.toString()}`}
					geometry={roundedBoxGeometry(
						plate.length,
						PLATE_HEIGHT,
						PLATE_THICKNESS,
						Math.min(cr, 0.04),
					)}
					position={[plate.x, 0, plate.z]}
					material={materials.frame}
					castShadow
					receiveShadow
				/>
			))}

			{/* ---- pedestal down to the floor -------------------------------- */}
			<mesh
				geometry={cylinderGeometry(0.14, 0.19, pedestalHeight, 18)}
				position={[0, geom.floorLocal + pedestalHeight / 2, 0]}
				material={materials.frame}
				castShadow
			/>
			<mesh
				geometry={cylinderGeometry(0.3, 0.3, 0.05, 22)}
				position={[0, geom.floorLocal + 0.025, 0]}
				material={materials.frame}
				receiveShadow
			/>

			{/* ---- lift cylinder bodies + telescoping rods ------------------- */}
			{deck.cylinders.map((cylinder, i) => (
				<group key={`cyl-${i.toString()}`}>
					<mesh
						geometry={cylinderGeometry(
							0.055,
							0.055,
							geom.bodyHeight,
							14,
						)}
						position={[cylinder.x, geom.bodyBase + geom.bodyHeight / 2, cylinder.z]}
						material={materials.metal}
						castShadow
					/>
					<mesh
						ref={(node) => {
							rodRefs.current[i] = node;
						}}
						geometry={rodGeometry}
						position={[cylinder.x, geom.bodyTop, cylinder.z]}
						material={materials.metal}
					/>
				</group>
			))}

			{/* ---- main roller bank (moves material straight through) --------- */}
			<InstancedMeshPool
				ref={rollerPool}
				geometry={rollerGeometry}
				material={materials.roller}
				maxInstances={deck.rollers.length}
				batchSize={64}
				frustumCulled
			/>

			{/* ---- lifting cassette: shafts + wheels + rails ------------------ */}
			<group ref={cassetteRef}>
				<InstancedMeshPool
					ref={shaftPool}
					geometry={shaftGeometry}
					material={materials.metal}
					maxInstances={deck.shafts.length}
					batchSize={64}
					frustumCulled
				/>
				<InstancedMeshPool
					ref={wheelPool}
					geometry={wheelGeometry}
					material={materials.accent}
					maxInstances={deck.wheels.length}
					batchSize={64}
					frustumCulled
				/>

				{/* longitudinal rails, outside the roller envelope */}
				{[-1, 1].map((side) => (
					<mesh
						key={`rail-${side.toString()}`}
						geometry={roundedBoxGeometry(
							length - 0.2,
							0.04,
							0.05,
							Math.min(cr, 0.02),
						)}
						position={[0, geom.railY, side * deck.railZ]}
						material={materials.accent}
						castShadow
					/>
				))}

				{/* short posts rising through the roller gaps to the shafts */}
				{deck.shafts.map((shaft, i) => (
					<mesh
						key={`post-${i.toString()}`}
						geometry={roundedBoxGeometry(0.05, SHAFT_Y - geom.railY, 0.05, 0.015)}
						position={[
							shaft.x,
							(geom.railY + SHAFT_Y) / 2,
							0,
						]}
						material={materials.accent}
					/>
				))}
			</group>

			{/* ---- transfer drive motor (fixed, belt-drives the cassette) ----- */}
			<mesh
				geometry={roundedBoxGeometry(0.26, 0.16, 0.2, Math.min(cr, 0.04))}
				position={[length / 2 - 0.18, geom.panY - 0.12, 0]}
				material={materials.accent}
				castShadow
			/>

			{detail ? (
				<>
					{/* status lamp post on the side plate */}
					<mesh
						geometry={cylinderGeometry(0.022, 0.022, 0.18, 8)}
						position={[length / 2 - 0.12, 0.14 + 0.09, -width / 2]}
						material={materials.metal}
					/>
					<mesh
						geometry={sphereGeometry(0.05, 12)}
						position={[length / 2 - 0.12, 0.14 + 0.21, -width / 2]}
						material={materials.lamp}
					/>

					{/* through-beam photo eyes at the infeed */}
					{[-1, 1].map((side) => (
						<group
							key={`eye-${side.toString()}`}
							position={[-length / 2 + 0.12, 0, (side * width) / 2]}
						>
							<mesh
								geometry={roundedBoxGeometry(0.08, 0.12, 0.06, 0.015)}
								position={[0, PLATE_HEIGHT / 2 + 0.06, 0]}
								material={materials.frame}
							/>
							<mesh
								geometry={sphereGeometry(0.022, 8)}
								position={[0, PLATE_HEIGHT / 2 + 0.06, -side * 0.04]}
								material={materials.sensor}
							/>
						</group>
					))}

					{/* control box on the pedestal */}
					<mesh
						geometry={roundedBoxGeometry(0.34, 0.36, 0.14, Math.min(cr, 0.04))}
						position={[0, geom.floorLocal + pedestalHeight * 0.62, -0.27]}
						material={materials.frame}
						castShadow
					/>
					<mesh
						geometry={roundedBoxGeometry(0.22, 0.12, 0.02, 0.01)}
						position={[0, geom.floorLocal + pedestalHeight * 0.62 + 0.06, -0.35]}
						material={materials.sensor}
					/>
				</>
			) : null}
		</group>
	);
}
