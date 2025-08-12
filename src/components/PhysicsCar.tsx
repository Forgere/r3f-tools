import { RigidBody, useRevoluteJoint } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

interface PhysicsCarProps {
	position?: [number, number, number];
	mass?: number;
}

export function PhysicsCar({
	position = [0, 3, 0],
	mass = 1000,
}: PhysicsCarProps) {
	const carBodyRef = useRef<any>(null);
	const frontLeftWheelRef = useRef<any>(null);
	const frontRightWheelRef = useRef<any>(null);
	const rearLeftWheelRef = useRef<any>(null);
	const rearRightWheelRef = useRef<any>(null);
	const carRef = useRef<THREE.Group>(null);

	// Car physics properties
	const carProperties = useMemo(
		() => ({
			maxEngineForce: 3000,
			maxBrakeForce: 5000,
			maxSteeringAngle: Math.PI / 4, // 45 degrees
			steeringSpeed: 3.0,
			wheelBase: 1.0,
			trackWidth: 1.0,
			friction: 1.0, // Increased friction
			rollingFriction: 0.3, // Increased rolling friction
			maxSpeed: 30,
			downForce: 300, // Additional downward force for better grip
		}),
		[],
	);

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

	// Create revolute joints for wheels - allowing rotation around the wheel's axis
	// Front left wheel joint (rotating around X axis)
	useRevoluteJoint(carBodyRef, frontLeftWheelRef, [
		[-0.5, 0, 0.3], // anchor on car body
		[0, 0, 0], // anchor on wheel
		[0, 0, 1], // rotation axis (X axis for wheel rotation)
	]);

	// Front right wheel joint (rotating around X axis)
	useRevoluteJoint(carBodyRef, frontRightWheelRef, [
		[0.5, 0, 0.3], // anchor on car body
		[0, 0, 0], // anchor on wheel
		[0, 0, 1], // rotation axis (X axis for wheel rotation)
	]);

	// Rear left wheel joint (rotating around X axis)
	useRevoluteJoint(carBodyRef, rearLeftWheelRef, [
		[-0.5, 0, -0.3], // anchor on car body
		[0, 0, 0], // anchor on wheel
		[0, 0, 1], // rotation axis (X axis for wheel rotation)
	]);

	// Rear right wheel joint (rotating around X axis)
	useRevoluteJoint(carBodyRef, rearRightWheelRef, [
		[0.5, 0, -0.3], // anchor on car body
		[0, 0, 0], // anchor on wheel
		[0, 0, 1], // rotation axis (X axis for wheel rotation)
	]);

	return (
		<group position={position} ref={carRef}>
			{/* Main car body */}
			<RigidBody
				ref={carBodyRef}
				colliders="cuboid"
				restitution={0.01} // Reduced bounciness
				friction={carProperties.friction}
				mass={mass * 0.6} // 60% of total mass
				linearDamping={0.15} // Slightly increased damping
				angularDamping={0.95}
				enabledRotations={[false, false, false]} // Lock rotations to keep car upright
			>
				<mesh position={[0, 0.25, 0]} material={carMaterial}>
					<boxGeometry args={[1.2, 0.3, 0.8]} />
				</mesh>

				{/* Car top */}
				<mesh position={[0, 0.5, 0]} material={carMaterial}>
					<boxGeometry args={[0.8, 0.2, 0.6]} />
				</mesh>
			</RigidBody>

			{/* Wheels with independent physics bodies */}
			{/* Front left wheel */}
			<RigidBody
				ref={frontLeftWheelRef}
				position={[-0.5, 0, 0.3]}
				colliders="ball"
				restitution={0.01}
				friction={carProperties.friction}
				mass={mass } // 10% of total mass
				enabledRotations={[false, false, true]} // Only allow rotation around X axis
			>
				<mesh
					rotation={[Math.PI / 2, 0, 0]}
					material={wheelMaterial}
					name="front-left-wheel"
				>
					<cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
				</mesh>
			</RigidBody>

			{/* Front right wheel */}
			<RigidBody
				ref={frontRightWheelRef}
				position={[0.5, 0, 0.3]}
				colliders="ball"
				restitution={0.01}
				friction={carProperties.friction}
				mass={mass} // 10% of total mass
				enabledRotations={[false, false, true]} // Only allow rotation around X axis
			>
				<mesh
					rotation={[Math.PI / 2, 0, 0]}
					material={wheelMaterial}
					name="front-right-wheel"
				>
					<cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
				</mesh>
			</RigidBody>

			{/* Rear left wheel */}
			<RigidBody
				ref={rearLeftWheelRef}
				position={[-0.5, 0, -0.3]}
				colliders="ball"
				restitution={0.01}
				friction={carProperties.friction}
				mass={mass} // 10% of total mass
				enabledRotations={[false, false, true]} // Only allow rotation around X axis
			>
				<mesh
					rotation={[Math.PI / 2, 0, 0]}
					material={wheelMaterial}
					name="rear-left-wheel"
				>
					<cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
				</mesh>
			</RigidBody>

			{/* Rear right wheel */}
			<RigidBody
				ref={rearRightWheelRef}
				position={[0.5, 0, -0.3]}
				colliders="ball"
				restitution={0.01}
				friction={carProperties.friction}
				mass={mass} // 10% of total mass
				enabledRotations={[false, false, true]} // Only allow rotation around X axis
			>
				<mesh
					rotation={[Math.PI / 2, 0, 0]}
					material={wheelMaterial}
					name="rear-right-wheel"
				>
					<cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
				</mesh>
			</RigidBody>
		</group>
	);
}
