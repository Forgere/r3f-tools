import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { roundedBoxGeometry } from "./geometry";
import type { DeviceRendererProps } from "./types";

/**
 * Over-under pass / small bridge (跨线桥 / 下穿通道).
 *
 * A non-sim decorative device used to visually "replace" a conveyor overlap
 * where two belts would otherwise clip through each other. The arch spans over
 * the lower belt with enough clearance for cargo to pass underneath.
 */
const DECK_THICKNESS = 0.12;
const CLEARANCE = 0.55;

export function CuteOverUnderPass({
	layout,
	theme,
}: DeviceRendererProps) {
	const length = layout.length;
	const width = layout.width;
	const cr = theme.cornerRadius;

	const materials = useMemo(() => {
		const make = (color: string, roughness: number, metalness: number) =>
			new THREE.MeshStandardMaterial({ color, roughness, metalness });
		return {
			frame: make(theme.frame, theme.roughness, theme.metalness),
			accent: make(theme.accent, theme.roughness * 0.9, theme.metalness),
		};
	}, [theme]);

	useEffect(() => {
		return () => {
			for (const material of Object.values(materials)) material.dispose();
		};
	}, [materials]);

	const postX = width / 2 - 0.04;
	const postZ = length / 2 - 0.04;

	return (
		<group position={layout.position} rotation={[0, layout.yaw, 0]}>
			{/* Bridge deck */}
			<mesh
				geometry={roundedBoxGeometry(
					length,
					DECK_THICKNESS,
					width,
					Math.min(cr, 0.03),
				)}
				position={[0, CLEARANCE + DECK_THICKNESS / 2, 0]}
				material={materials.frame}
				castShadow
				receiveShadow
			/>

			{/* Accent stripes on the deck */}
			<mesh
				geometry={roundedBoxGeometry(length * 0.75, 0.02, width * 0.7, Math.min(cr, 0.02))}
				position={[0, CLEARANCE + DECK_THICKNESS + 0.01, 0]}
				material={materials.accent}
			/>

			{/* Corner posts / pillars */}
			{[-1, 1].map((xSide) =>
				[-1, 1].map((zSide) => (
					<mesh
						key={`post-${xSide.toString()}-${zSide.toString()}`}
						geometry={roundedBoxGeometry(
							0.14,
							CLEARANCE + DECK_THICKNESS,
							0.14,
							Math.min(cr, 0.02),
						)}
						position={[xSide * postX, (CLEARANCE + DECK_THICKNESS) / 2, zSide * postZ]}
						material={materials.frame}
						castShadow
					/>
				)),
			)}

			{/* Safety rail along the deck edges */}
			{[-1, 1].map((side) => (
				<mesh
					key={`rail-${side.toString()}`}
					geometry={roundedBoxGeometry(length, 0.06, 0.04, Math.min(cr, 0.015))}
					position={[0, CLEARANCE + DECK_THICKNESS + 0.04, side * (width / 2 - 0.04)]}
					material={materials.accent}
					castShadow
				/>
			))}
		</group>
	);
}
