import { useMemo } from "react";
import * as THREE from "three";

export interface VerticalLiftProps {
	position?: THREE.Vector3Tuple;
	/** Height of the vertical transfer path. */
	height?: number;
	width?: number;
	depth?: number;
	frameMaterial?: THREE.Material;
	carriageMaterial?: THREE.Material;
}

/**
 * Default transfer-device model for replacing an otherwise empty crossing
 * region. The device owns the vertical route internally; exposed conveyors
 * terminate at its lower/upper ports instead of intersecting through it.
 */
export function VerticalLift({
	position = [0, 0, 0],
	height = 1.2,
	width = 1.2,
	depth = 1.2,
	frameMaterial,
	carriageMaterial,
}: VerticalLiftProps) {
	const defaultFrameMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x2b3136,
				roughness: 0.55,
				metalness: 0.45,
			}),
		[],
	);
	const defaultCarriageMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0xe26a3d,
				roughness: 0.45,
				metalness: 0.25,
			}),
		[],
	);
	const railMaterial = frameMaterial ?? defaultFrameMaterial;
	const platformMaterial = carriageMaterial ?? defaultCarriageMaterial;
	const halfWidth = width / 2;
	const halfDepth = depth / 2;
	const corners: [number, number, number][] = [
		[-halfWidth, 0, -halfDepth],
		[halfWidth, 0, -halfDepth],
		[-halfWidth, 0, halfDepth],
		[halfWidth, 0, halfDepth],
	];

	return (
		<group position={position}>
			{corners.map((corner) => (
				<mesh
					key={corner.join("-")}
					position={[corner[0], height / 2, corner[2]]}
					material={railMaterial}
				>
					<boxGeometry args={[0.1, height, 0.1]} />
				</mesh>
			))}
			<mesh position={[0, 0.06, 0]} material={railMaterial}>
				<boxGeometry args={[width + 0.28, 0.12, depth + 0.28]} />
			</mesh>
			<mesh position={[0, height, 0]} material={railMaterial}>
				<boxGeometry args={[width + 0.28, 0.12, depth + 0.28]} />
			</mesh>
			<mesh position={[0, height / 2, 0]} material={platformMaterial}>
				<boxGeometry args={[width, 0.16, depth]} />
			</mesh>
			<mesh position={[0, height / 2 - 0.13, 0]} material={railMaterial}>
				<boxGeometry args={[width * 0.62, 0.12, depth * 0.62]} />
			</mesh>
		</group>
	);
}
