import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
	cylinderGeometry,
	roundedBoxGeometry,
	sphereGeometry,
} from "./geometry";
import type { DeviceRendererProps } from "./types";

/**
 * Inspection station (检查站台) — a fixed inspection platen with a scanning
 * gantry on top. Unlike a conveyor, the platen does NOT roll: items are
 * carried across by the simulation but the deck itself is a solid table with a
 * recessed scan zone, so it reads as a station that *inspects* rather than a
 * belt that *transports*. The belt segment it occupies is clipped at the
 * station edges (see the example's JUNCTIONS list) so cargo rolls in/out on the
 * neighbouring belts and the station just holds/inspects it.
 *
 * The renderer is pure: every signal comes from the simulation through
 * `readState()`. `routeIndex` is 0 for "pass / straight through" and 1 for
 * "fail / divert to the reject rack"; `lastVerdict` ("ok" / "ng") drives the
 * pass/fail lamp, and `occupied` lowers the scanner head while an item is under
 * the beam.
 */
const DECK_TOP = 0.0;
const POST_HEIGHT = 0.9;
const BEAM_Y = DECK_TOP + POST_HEIGHT;
const SCAN_SPEED = 2.2;
const DECK_THICKNESS = 0.12;
const PLATEN_INSET = 0.04;
const POST_X = 0.55;

function num(
	config: Readonly<Record<string, unknown>> | undefined,
	key: string,
	fallback: number,
): number {
	const value = config?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function CuteInspectionStation({
	layout,
	theme,
	config,
	readState,
}: DeviceRendererProps) {
	const length = layout.length;
	const width = layout.width;
	const floorY = layout.floorY ?? 0;
	const detail = theme.detail !== false;
	const beamGap = num(config, "beamGap", 0.1);
	// beamGap is reserved for future lamp spacing; declared to keep the config
	// contract stable with the rest of the device renderers.
	void beamGap;

	const materials = useMemo(() => {
		const make = (color: string, roughness: number, metalness: number) =>
			new THREE.MeshStandardMaterial({ color, roughness, metalness });
		return {
			frame: make(theme.frame, theme.roughness, theme.metalness),
			accent: make(theme.accent, theme.roughness * 0.9, theme.metalness),
			metal: make(theme.metal, 0.3, 0.6),
			// Solid platen top — a fixed table, not a rolling bed.
			platen: make(theme.frame, theme.roughness * 0.8, theme.metalness),
			// Recessed scan zone that glows while an item is inspected.
			window: new THREE.MeshStandardMaterial({
				color: "#2C313D",
				roughness: 0.5,
				metalness: 0.2,
				emissive: new THREE.Color(theme.accent),
				emissiveIntensity: 0.06,
			}),
			pass: new THREE.MeshStandardMaterial({
				color: "#7BD88F",
				emissive: "#7BD88F",
				emissiveIntensity: 0.5,
				roughness: 0.3,
			}),
			fail: new THREE.MeshStandardMaterial({
				color: "#E7695D",
				emissive: "#E7695D",
				emissiveIntensity: 0.5,
				roughness: 0.3,
			}),
			beam: new THREE.MeshStandardMaterial({
				color: "#FFE08A",
				emissive: "#FFE08A",
				emissiveIntensity: 1.1,
				transparent: true,
				opacity: 0.45,
				roughness: 0.2,
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

	const scannerRef = useRef<THREE.Group>(null);
	const beamRef = useRef<THREE.Mesh>(null);
	const beamGroupRef = useRef<THREE.Group>(null);
	const scan = useRef(0);
	// Last verdict that triggered a lamp flash, so the flash decays.
	const flash = useRef(0);

	useFrame((_, rawDelta) => {
		const state = readState();
		const delta = Math.min(rawDelta, 0.1);

		// Scanner head descends while an item is on the platen. Heights are
		// absolute relative to the station origin (deck surface) to keep the
		// gantry clear of cargo sitting on the deck.
		const targetY = state.occupied ? 0.5 : 0.66;
		if (scannerRef.current) {
			const cur = scannerRef.current.position.y;
			scannerRef.current.position.y = cur + (targetY - cur) * Math.min(1, delta * 8);
		}

		// Scan beam sweeps along X while scanning.
		const scanning = state.occupied && (state.phase === "dwell" || state.phase === "idle");
		if (scanning) {
			scan.current += SCAN_SPEED * delta;
			if (beamGroupRef.current) {
				const x = Math.sin(scan.current) * (width * 0.4);
				beamGroupRef.current.position.x = x;
				beamGroupRef.current.visible = true;
			}
		} else if (beamGroupRef.current) {
			beamGroupRef.current.visible = false;
		}

		// Verdict flash: bright pulse on the lamp + scan zone for ~0.5 s.
		if (state.lastVerdict) flash.current = 1;
		flash.current = Math.max(0, flash.current - delta * 1.6);
		const verdict = state.lastVerdict;
		const okMat = materials.pass;
		const failMat = materials.fail;
		if (verdict === "ng") {
			failMat.emissiveIntensity = 0.5 + flash.current * 1.4;
			okMat.emissiveIntensity = 0.3;
		} else if (verdict === "ok") {
			okMat.emissiveIntensity = 0.5 + flash.current * 1.4;
			failMat.emissiveIntensity = 0.3;
		} else {
			okMat.emissiveIntensity = 0.35;
			failMat.emissiveIntensity = 0.35;
		}
		materials.sensor.emissiveIntensity = state.occupied ? 1.2 : 0.25;
		// Scan zone glows softly while an item is present under the beam.
		materials.window.emissiveIntensity = state.occupied ? 0.18 + flash.current * 0.5 : 0.06;
	});

	const cr = theme.cornerRadius;
	const floorLocal = floorY - layout.position[1];

	return (
		<group position={layout.position} rotation={[0, layout.yaw, 0]}>
			{/* Solid inspection platen — replaces the clipped belt segment. */}
			<mesh
				geometry={roundedBoxGeometry(
					length - PLATEN_INSET,
					DECK_THICKNESS,
					width - PLATEN_INSET,
					Math.min(cr, 0.03),
				)}
				position={[0, DECK_TOP - DECK_THICKNESS / 2, 0]}
				material={materials.platen}
				castShadow
				receiveShadow
			/>

			{/* Recessed scan zone in the middle of the platen (no rollers). */}
			<mesh
				geometry={roundedBoxGeometry(
					width - 0.3,
					0.02,
					length - 0.34,
					Math.min(cr, 0.02),
				)}
				position={[0, DECK_TOP + 0.005, 0]}
				material={materials.window}
				receiveShadow
			/>

			{/* Static side guides (fixed, non-rotating) keep items on the platen. */}
			{[-1, 1].map((side) => (
				<mesh
					key={`rail-${side.toString()}`}
					geometry={roundedBoxGeometry(length - 0.06, 0.08, 0.07, Math.min(cr, 0.02))}
					position={[0, DECK_TOP + 0.04, side * (width / 2 - 0.035)]}
					material={materials.metal}
					castShadow
				/>
			))}

			{/* Inlaid flow chevrons on the platen — static direction hint. */}
			{[-1, 0, 1].map((i) => (
				<mesh
					key={`chevron-${i.toString()}`}
					geometry={roundedBoxGeometry(0.06, 0.015, 0.18, 0.01)}
					position={[i * (length * 0.28), DECK_TOP + 0.02, 0]}
					rotation={[0, 0, Math.PI / 2]}
					material={materials.accent}
				/>
			))}

			{/* Gantry posts on both sides of the belt */}
			{[-1, 1].map((side) => (
				<mesh
					key={`post-${side.toString()}`}
					geometry={cylinderGeometry(0.06, 0.06, POST_HEIGHT, 14)}
					position={[0, DECK_TOP + POST_HEIGHT / 2, side * POST_X]}
					material={materials.frame}
					castShadow
				/>
			))}
			{/* Top beam */}
			<mesh
				geometry={roundedBoxGeometry(0.16, 0.16, width + 0.18, Math.min(cr, 0.04))}
				position={[0, BEAM_Y, 0]}
				material={materials.frame}
				castShadow
			/>

			{/* Scanner head: rides under the beam, descends onto items */}
			<group ref={scannerRef} position={[0, DECK_TOP + 0.5, 0]}>
				<mesh
					geometry={roundedBoxGeometry(0.34, 0.2, width * 0.8, Math.min(cr, 0.04))}
					position={[0, 0, 0]}
					material={materials.accent}
					castShadow
				/>
				{/* barcode-style scan window on the underside */}
				<mesh
					geometry={roundedBoxGeometry(0.26, 0.02, width * 0.6, 0.01)}
					position={[0, -0.11, 0]}
					material={materials.sensor}
				/>
				{/* Sweeping scan line */}
				<group ref={beamGroupRef} position={[0, -0.12, 0]} visible={false}>
					<mesh ref={beamRef} geometry={sphereGeometry(0.05, 10)} material={materials.beam} />
					<mesh
						geometry={cylinderGeometry(0.012, 0.012, width * 0.7, 8)}
						rotation={[Math.PI / 2, 0, 0]}
						material={materials.beam}
					/>
				</group>
			</group>

			{/* Pass / fail lamps on the beam */}
			<mesh
				geometry={sphereGeometry(0.06, 12)}
				position={[0.12, BEAM_Y + 0.14, -POST_X]}
				material={materials.pass}
			/>
			<mesh
				geometry={sphereGeometry(0.06, 12)}
				position={[0.12, BEAM_Y + 0.14, POST_X]}
				material={materials.fail}
			/>

			{/* Route labels as little arrows: straight (ok) and divert (ng) */}
			<mesh
				geometry={roundedBoxGeometry(0.05, 0.05, 0.4, 0.01)}
				position={[width / 2 + 0.18, DECK_TOP + 0.06, 0]}
				material={materials.pass}
			/>
			<mesh
				geometry={roundedBoxGeometry(0.05, 0.05, 0.4, 0.01)}
				position={[0, DECK_TOP + 0.06, width / 2 + 0.18]}
				material={materials.fail}
			/>

			{detail ? (
				<>
					{/* Photo-eyes at the infeed */}
					{[-1, 1].map((side) => (
						<mesh
							key={`eye-${side.toString()}`}
							geometry={sphereGeometry(0.022, 8)}
							position={[-width / 2 + 0.1, DECK_TOP + 0.04, side * (width / 2 - 0.05)]}
							material={materials.sensor}
						/>
					))}
					{/* Control box at the base */}
					<mesh
						geometry={roundedBoxGeometry(0.22, 0.28, 0.12, Math.min(cr, 0.03))}
						position={[0, floorLocal + Math.max(-floorLocal + 0.14, 0.14), -POST_X - 0.12]}
						material={materials.frame}
						castShadow
					/>
				</>
			) : null}
		</group>
	);
}
