import { useMemo } from "react";
import * as THREE from "three";

export interface CrossTransferTableProps {
	position?: THREE.Vector3Tuple;
	width?: number;
	depth?: number;
	frameMaterial?: THREE.Material;
	tableMaterial?: THREE.Material;
}

/**
 * Default same-level cross-transfer device. External conveyors terminate at
 * its ports; its internal graph edges model a straight-through route and a
 * diverted route without exposing overlapping conveyor geometry.
 */
export function CrossTransferTable({
	position = [0, 0, 0],
	width = 1.6,
	depth = 1.6,
	frameMaterial,
	tableMaterial,
}: CrossTransferTableProps) {
	const defaultFrameMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x292f34,
				roughness: 0.55,
				metalness: 0.45,
			}),
		[],
	);
	const defaultTableMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0xe26a3d,
				roughness: 0.4,
				metalness: 0.3,
			}),
		[],
	);
	const frame = frameMaterial ?? defaultFrameMaterial;
	const table = tableMaterial ?? defaultTableMaterial;
	const corners: [number, number, number][] = [
		[-width / 2, 0.36, -depth / 2],
		[width / 2, 0.36, -depth / 2],
		[-width / 2, 0.36, depth / 2],
		[width / 2, 0.36, depth / 2],
	];

	return (
		<group position={position}>
			<mesh position={[0, 0.09, 0]} material={frame}>
				<boxGeometry args={[width + 0.2, 0.18, depth + 0.2]} />
			</mesh>
			<mesh position={[0, 0.2, 0]} material={table}>
				<boxGeometry args={[width, 0.12, depth]} />
			</mesh>
			<mesh position={[0, 0.28, 0]} material={frame}>
				<boxGeometry args={[width * 0.72, 0.06, depth * 0.72]} />
			</mesh>
			{corners.map((corner) => (
				<mesh key={corner.join("-")} position={corner} material={frame}>
					<boxGeometry args={[0.12, 0.55, 0.12]} />
				</mesh>
			))}
		</group>
	);
}
