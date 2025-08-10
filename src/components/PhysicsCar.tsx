import { useFrame } from "@react-three/fiber";
import { type RapierRigidBody, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

interface PhysicsCarProps {
	position?: [number, number, number];
	mass?: number;
}

export function PhysicsCar({
	position = [0, 3, 0],
	mass = 1,
}: PhysicsCarProps) {
	const rigidBodyRef = useRef<RapierRigidBody>(null);
	const carRef = useRef<THREE.Group>(null);

	// Keyboard state
	const [keys, setKeys] = useState({
		w: false,
		a: false,
		s: false,
		d: false,
	});

	// Handle keyboard input
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if (key in keys) {
				setKeys((prev) => ({ ...prev, [key]: true }));
			}
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			const key = event.key.toLowerCase();
			if (key in keys) {
				setKeys((prev) => ({ ...prev, [key]: false }));
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
		};
	}, [keys]);

	// Create car materials
	const carMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x2c3e50,
				roughness: 0.4,
				metalness: 0.6,
			}),
		[],
	);

	const wheelMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x34495e,
				roughness: 0.6,
				metalness: 0.4,
			}),
		[],
	);

	// Apply forces based on keyboard input
	useFrame(() => {
		if (!rigidBodyRef.current) return;

		// Get current linear velocity
		const linvel = rigidBodyRef.current.linvel();

		// Calculate driving force based on key presses
		const force = new THREE.Vector3(0, 0, 0);
		const maxForce = 1;

		if (keys.w) force.z -= maxForce; // Forward
		if (keys.s) force.z += maxForce; // Backward
		if (keys.a) force.x -= maxForce; // Left
		if (keys.d) force.x += maxForce; // Right

		// Apply driving force
		if (force.length() > 0) {
			rigidBodyRef.current.addForce(force, true);
		}

		// Apply braking/friction when no keys are pressed
		if (!keys.w && !keys.s && !keys.a && !keys.d) {
			const brakeForce = 0.95; // Friction coefficient
			rigidBodyRef.current.setLinvel({
				x: linvel.x * brakeForce,
				y: linvel.y,
				z: linvel.z * brakeForce,
			});
		}

		// Limit maximum speed
		const maxSpeed = 10;
		const currentSpeed = Math.sqrt(linvel.x * linvel.x + linvel.z * linvel.z);
		if (currentSpeed > maxSpeed) {
			const ratio = maxSpeed / currentSpeed;
			rigidBodyRef.current.setLinvel({
				x: linvel.x * ratio,
				y: linvel.y,
				z: linvel.z * ratio,
			});
		}
	});

	return (
		<RigidBody
			ref={rigidBodyRef}
			position={position}
			colliders="ball" // Use cuboid for simple collision detection
			restitution={0.1} // Small bounce for better physics interaction
			friction={0.8} // Good friction for grip
			mass={mass}
			linearDamping={0.3} // Reduced damping for better control
			angularDamping={0.8} // Keep angular damping for stability
			enabledRotations={[false, false, false]} // Lock rotations to keep car upright
		>
			<group ref={carRef}>
				{/* Main car body */}
				<mesh position={[0, 0.25, 0]} material={carMaterial}>
					<boxGeometry args={[1.2, 0.3, 0.8]} />
				</mesh>

				{/* Car top */}
				<mesh position={[0, 0.5, 0]} material={carMaterial}>
					<boxGeometry args={[0.8, 0.2, 0.6]} />
				</mesh>

				{/* Wheels */}
				{[-0.5, 0.5].map((x) =>
					[-0.3, 0.3].map((z) => (
						<group key={`wheel-${x}-${z}`} position={[x, 0, z]}>
							<mesh rotation={[Math.PI / 2, 0, 0]} material={wheelMaterial}>
								<cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
							</mesh>
						</group>
					)),
				)}
			</group>
		</RigidBody>
	);
}
