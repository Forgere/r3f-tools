import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
	cylinderGeometry,
	roundedBoxGeometry,
	sphereGeometry,
} from "./geometry";
import type { DeviceRendererProps } from "./types";

/**
 * Reject rack (不合格货架) — a grid of slots where failed items pile up.
 *
 * The cargo boxes themselves are rendered by the shared `SimCargoLayer` at
 * the exact slot positions the simulation computes (`bufferSlotPosition`), so
 * this component only draws the shelving frame. It reads `fill` (0…1) to
 * flash a near-full warning lamp; the simulation decides back-pressure and
 * drain behaviour.
 */
function num(
	config: Readonly<Record<string, unknown>> | undefined,
	key: string,
	fallback: number,
): number {
	const value = config?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function CuteRejectRack({
	layout,
	theme,
	config,
	readState,
}: DeviceRendererProps) {
	const columns = Math.max(1, Math.floor(num(config, "columns", 4)));
	const rows = Math.max(1, Math.floor(num(config, "rows", 3)));
	const layers = Math.max(1, Math.floor(num(config, "layers", 2)));
	const spacing = num(config, "spacing", 0.32);
	const layerH = num(config, "layerH", 0.2);

	const width = columns * spacing;
	const depth = rows * spacing;
	const height = layers * layerH + 0.12;

	const materials = useMemo(() => {
		const make = (color: string, roughness: number, metalness: number) =>
			new THREE.MeshStandardMaterial({ color, roughness, metalness });
		return {
			frame: make(theme.frame, theme.roughness, theme.metalness * 0.6),
			accent: make(theme.accent, theme.roughness * 0.9, theme.metalness),
			metal: make(theme.metal, 0.35, 0.55),
			warn: new THREE.MeshStandardMaterial({
				color: "#E7695D",
				emissive: "#E7695D",
				emissiveIntensity: 0.4,
				roughness: 0.3,
			}),
		};
	}, [theme, columns, rows, layers, spacing, layerH]);

	const warnRef = useRef<THREE.MeshStandardMaterial>(null);

	useFrame((_, rawDelta) => {
		const state = readState();
		const delta = Math.min(rawDelta, 0.1);
		const near = state.fill > 0.8;
		const full = state.fill >= 0.999;
		const intensity = full
			? 0.6 + Math.abs(Math.sin(performance.now() * 0.008)) * 1.4
			: near
				? 0.6 + state.fill * 0.6
				: 0.25;
		if (warnRef.current) warnRef.current.emissiveIntensity += (intensity - warnRef.current.emissiveIntensity) * Math.min(1, delta * 8);
	});

	const cr = theme.cornerRadius;
	const postR = 0.045;
	// Frame anchored so the slot grid (which starts at layout.position) sits
	// centred on the rack footprint.
	const baseX = -width / 2;
	const baseZ = -depth / 2;

	return (
		<group position={layout.position}>
			{/* Base pallet */}
			<mesh
				geometry={roundedBoxGeometry(width + 0.22, 0.1, depth + 0.22, Math.min(cr, 0.03))}
				position={[0, -0.05, 0]}
				material={materials.frame}
				receiveShadow
				castShadow
			/>

			{/* Corner posts */}
			{(() => {
				const postPositions: [number, number][] = [
					[baseX, baseZ],
					[baseX, baseZ + depth],
					[baseX + width, baseZ],
					[baseX + width, baseZ + depth],
				];
				return postPositions.map(([x, z], i) => (
					<mesh
						key={`post-${i.toString()}`}
						geometry={cylinderGeometry(postR, postR, height, 10)}
						position={[x, height / 2 - 0.05, z]}
						material={materials.metal}
						castShadow
					/>
				));
			})()}

			{/* Shelf planes at every layer */}
			{Array.from({ length: layers + 1 }, (_, layer) => (
				<mesh
					key={`shelf-${layer.toString()}`}
					geometry={roundedBoxGeometry(width, 0.04, depth, 0.01)}
					position={[0, layer * layerH - 0.02, 0]}
					material={materials.frame}
					receiveShadow
				/>
			))}

			{/* Front-edge divider rails for each slot row */}
			{Array.from({ length: rows }, (_, r) => (
				<mesh
					key={`rail-${r.toString()}`}
					geometry={roundedBoxGeometry(width, 0.05, 0.03, 0.01)}
					position={[0, layerH * 0.5, baseZ + (r + 0.5) * spacing]}
					material={materials.accent}
				/>
			))}

			{/* Near-full / full warning beacon */}
			<mesh
				geometry={cylinderGeometry(0.03, 0.03, 0.16, 8)}
				position={[baseX + width + 0.06, height + 0.02, baseZ]}
				material={materials.metal}
			/>
			<mesh
				geometry={sphereGeometry(0.06, 12)}
				position={[baseX + width + 0.06, height + 0.12, baseZ]}
				material={materials.warn}
			>
				<meshStandardMaterial
					ref={warnRef}
					color={materials.warn.color}
					emissive={materials.warn.emissive}
					emissiveIntensity={0.4}
					roughness={0.3}
				/>
			</mesh>
		</group>
	);
}
