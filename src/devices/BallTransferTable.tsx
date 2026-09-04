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
 * Ball-transfer table (万向球台) — the "dumb" alternative to a lift-and-
 * transfer deck.
 *
 * A grid of ball casters lets a load be pushed in any direction, so routing
 * needs an external pusher arm instead of a lifting cassette. It exists here
 * mostly as a plugin-replacement demo: registering it under the
 * `"lift-transfer"` kind swaps the machine entirely while the simulation,
 * the layout and the routing data stay untouched.
 */
const DECK_TOP = 0.14;
const GRID = 4;
const BALL_RADIUS = 0.05;

export function BallTransferTable({
	layout,
	theme,
	readState,
}: DeviceRendererProps) {
	const length = layout.length;
	const width = layout.width;
	const floorY = layout.floorY ?? 0;
	const armRef = useRef<THREE.Group>(null);
	const ballPool = useRef<InstancedMeshPoolRef>(null);
	const targetAngle = useRef(0);

	const balls = useMemo(() => {
		const out: { x: number; z: number }[] = [];
		const stepX = (length - 0.3) / (GRID - 1);
		const stepZ = (width - 0.3) / (GRID - 1);
		for (let i = 0; i < GRID; i++) {
			for (let j = 0; j < GRID; j++) {
				out.push({
					x: -(length - 0.3) / 2 + stepX * i,
					z: -(width - 0.3) / 2 + stepZ * j,
				});
			}
		}
		return out;
	}, [length, width]);

	const materials = useMemo(() => {
		const make = (color: string, roughness: number, metalness: number) =>
			new THREE.MeshStandardMaterial({ color, roughness, metalness });
		return {
			frame: make(theme.frame, theme.roughness, theme.metalness),
			accent: make(theme.accent, theme.roughness * 0.9, theme.metalness),
			metal: make(theme.metal, 0.3, 0.6),
			lamp: new THREE.MeshStandardMaterial({
				color: theme.lightIdle,
				emissive: theme.lightIdle,
				emissiveIntensity: 0.6,
				roughness: 0.3,
			}),
		};
	}, [theme]);

	useEffect(() => {
		return () => {
			for (const material of Object.values(materials)) material.dispose();
		};
	}, [materials]);

	const ballGeometry = useMemo(() => sphereGeometry(BALL_RADIUS, 12), []);
	const socketGeometry = useMemo(
		() => cylinderGeometry(BALL_RADIUS + 0.012, BALL_RADIUS + 0.02, 0.035, 12),
		[],
	);

	useEffect(() => {
		const pool = ballPool.current;
		if (!pool) return;
		const dummy = new THREE.Object3D();
		pool.setInstanceCount(balls.length);
		balls.forEach((ball, i) => {
			dummy.position.set(ball.x, DECK_TOP + 0.005, ball.z);
			dummy.rotation.set(0, 0, 0);
			dummy.scale.setScalar(1);
			dummy.updateMatrix();
			pool.setMatrixAt(i, dummy.matrix);
		});
		pool.updateMatrices();
	}, [balls]);

	// Pusher arm swings to whichever route the simulation selected.
	useFrame((_, delta) => {
		const state = readState();
		const sign = (layout.routeSigns ?? [])[state.routeIndex] ?? 0;
		targetAngle.current =
			Math.abs(sign) < 0.5 ? 0 : sign > 0 ? Math.PI / 2 : -Math.PI / 2;
		if (armRef.current) {
			const current = armRef.current.rotation.y;
			let diff = targetAngle.current - current;
			diff = Math.atan2(Math.sin(diff), Math.cos(diff));
			armRef.current.rotation.y = current + diff * Math.min(1, delta * 6);
		}
		materials.lamp.emissiveIntensity = state.occupied ? 1.1 : 0.4;
	});

	const floorLocal = floorY - layout.position[1];
	const pedestalHeight = Math.max(-0.24 - floorLocal, 0.05);
	const cr = theme.cornerRadius;

	return (
		<group position={layout.position} rotation={[0, layout.yaw, 0]}>
			<mesh
				geometry={roundedBoxGeometry(length, 0.1, width, cr)}
				position={[0, DECK_TOP - 0.05, 0]}
				material={materials.frame}
				castShadow
				receiveShadow
			/>
			<mesh
				geometry={cylinderGeometry(0.14, 0.19, pedestalHeight, 18)}
				position={[0, floorLocal + pedestalHeight / 2, 0]}
				material={materials.frame}
				castShadow
			/>
			<mesh
				geometry={cylinderGeometry(0.3, 0.3, 0.05, 22)}
				position={[0, floorLocal + 0.025, 0]}
				material={materials.frame}
				receiveShadow
			/>

			<InstancedMeshPool
				ref={ballPool}
				geometry={ballGeometry}
				material={materials.metal}
				maxInstances={balls.length}
				batchSize={64}
				frustumCulled
			/>
			{balls.map((ball, i) => (
				<mesh
					key={`socket-${i.toString()}`}
					geometry={socketGeometry}
					position={[ball.x, DECK_TOP - 0.01, ball.z]}
					material={materials.frame}
				/>
			))}

			{/* pusher arm */}
			<group ref={armRef}>
				<mesh
					geometry={cylinderGeometry(0.07, 0.07, 0.1, 12)}
					position={[0, DECK_TOP + 0.05, 0]}
					material={materials.accent}
				/>
				<mesh
					geometry={roundedBoxGeometry(0.1, 0.08, 0.72, 0.03)}
					position={[0, DECK_TOP + 0.06, 0.4]}
					material={materials.accent}
					castShadow
				/>
			</group>

			<mesh
				geometry={sphereGeometry(0.05, 12)}
				position={[length / 2 - 0.12, DECK_TOP + 0.2, -width / 2]}
				material={materials.lamp}
			/>
		</group>
	);
}
