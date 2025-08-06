import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useRef } from "react";
import type { Mesh } from "three";
import {
	createPathAnimator,
	moveAlongPath,
	type PathAnimator,
} from "../src/utils/moveAlongPath";

/**
 * Simple cube following a predefined path
 */
function SimplePathCube({
	debug,
	debugColor,
}: {
	debug: boolean;
	debugColor: string;
}) {
	const meshRef = useRef<Mesh>(null);
	const { scene } = useThree();

	useEffect(() => {
		if (meshRef.current) {
			// Define a simple circular path
			const pathPositions = [
				{ x: 0, y: 0, z: 0 },
				{ x: 3, y: 2, z: 3 },
				{ x: 0, y: 4, z: 6 },
				{ x: -3, y: 2, z: 3 },
				{ x: 0, y: 0, z: 0 },
			];

			moveAlongPath(meshRef.current, {
				positions: pathPositions,
				duration: 8,
				ease: "power2.inOut",
				autoRotate: true,
				debug,
				debugColor,
				debugScene: scene,
				onComplete: () => {
					console.log("Simple path animation completed!");
				},
				onUpdate: (_progress) => {
					// Optional: log progress
				},
			});
		}
	}, [debug, debugColor, scene]);

	return (
		<mesh ref={meshRef}>
			<boxGeometry args={[0.8, 0.8, 0.8]} />
			<meshStandardMaterial color="#ff6b6b" />
		</mesh>
	);
}

/**
 * Sphere with complex 3D path using PathAnimator class
 */
function ComplexPathSphere({
	debug,
	debugColor,
}: {
	debug: boolean;
	debugColor: string;
}) {
	const meshRef = useRef<Mesh>(null);
	const animatorRef = useRef<PathAnimator | null>(null);
	const { scene } = useThree();

	useEffect(() => {
		if (meshRef.current) {
			animatorRef.current = createPathAnimator(meshRef.current);

			const runAnimation = async () => {
				// Create a complex 3D spiral path
				const positions = [
					{ x: 0, y: 0, z: 0 },
					{ x: 2, y: 1, z: 2 },
					{ x: 4, y: 3, z: 0 },
					{ x: 2, y: 5, z: -2 },
					{ x: 0, y: 4, z: -4 },
					{ x: -2, y: 2, z: -2 },
					{ x: -4, y: 0, z: 0 },
					{ x: -2, y: -2, z: 2 },
					{ x: 0, y: 0, z: 4 },
					{ x: 2, y: 2, z: 2 },
					{ x: 0, y: 0, z: 0 },
				];

				await animatorRef.current?.moveAlongPath({
					positions,
					duration: 12,
					ease: "sine.inOut",
					autoRotate: true,
					tension: 0.3, // Smoother curve
					debug,
					debugColor,
					debugScene: scene,
					onComplete: () => {
						console.log("Complex path animation completed!");
					},
				});
			};

			runAnimation();

			return () => {
				animatorRef.current?.destroy();
			};
		}
	}, [debug, debugColor, scene]);

	return (
		<mesh ref={meshRef}>
			<sphereGeometry args={[0.5, 32, 32]} />
			<meshStandardMaterial color="#4ecdc4" />
		</mesh>
	);
}

/**
 * Torus with interactive path animation
 */
function InteractivePathTorus({
	debug,
	debugColor,
}: {
	debug: boolean;
	debugColor: string;
}) {
	const meshRef = useRef<Mesh>(null);
	const animatorRef = useRef<PathAnimator | null>(null);
	const { scene } = useThree();

	useEffect(() => {
		if (meshRef.current) {
			animatorRef.current = createPathAnimator(meshRef.current);

			const animateToRandomPosition = async () => {
				// Generate random path points
				const positions = [
					{
						x: meshRef.current?.position.x,
						y: meshRef.current?.position.y,
						z: meshRef.current?.position.z,
					},
					{
						x: (Math.random() - 0.5) * 8,
						y: (Math.random() - 0.5) * 6,
						z: (Math.random() - 0.5) * 8,
					},
					{
						x: (Math.random() - 0.5) * 8,
						y: (Math.random() - 0.5) * 6,
						z: (Math.random() - 0.5) * 8,
					},
					{
						x: (Math.random() - 0.5) * 8,
						y: (Math.random() - 0.5) * 6,
						z: (Math.random() - 0.5) * 8,
					},
				];

				await animatorRef.current?.moveAlongPath({
					positions,
					duration: 6,
					ease: "back.inOut(1.7)",
					autoRotate: true,
					tension: 0.4,
					debug,
					debugColor,
					debugScene: scene,
					onComplete: () => {
						// Loop animation
						setTimeout(animateToRandomPosition, 1000);
					},
				});
			};

			// Start animation
			animateToRandomPosition();

			return () => {
				animatorRef.current?.destroy();
			};
		}
	}, [debug, debugColor, scene]);

	return (
		<mesh ref={meshRef} position={[3, 3, 3]}>
			<torusGeometry args={[0.6, 0.2, 16, 100]} />
			<meshStandardMaterial color="#ffe66d" />
		</mesh>
	);
}

/**
 * Multiple cubes with synchronized path animations
 */
function SynchronizedCubes({
	debug,
	debugColor,
}: {
	debug: boolean;
	debugColor: string;
}) {
	const positions = [
		[-2, 0, -2],
		[2, 0, -2],
		[2, 0, 2],
		[-2, 0, 2],
	];

	return (
		<>
			{positions.map((pos, index) => (
				<SinglePathCube
					key={`${index.toString()} + single`}
					initialPosition={pos as [number, number, number]}
					delay={index * 0.5}
					debug={debug}
					debugColor={debugColor}
				/>
			))}
		</>
	);
}

function SinglePathCube({
	initialPosition,
	delay,
	debug,
	debugColor,
}: {
	initialPosition: [number, number, number];
	delay: number;
	debug: boolean;
	debugColor: string;
}) {
	const meshRef = useRef<Mesh>(null);
	const { scene } = useThree();

	useEffect(() => {
		if (meshRef.current) {
			// Different paths for each cube
			const pathPositions = [
				{ x: initialPosition[0], y: initialPosition[1], z: initialPosition[2] },
				{
					x: initialPosition[0] + 1,
					y: initialPosition[1] + 2,
					z: initialPosition[2] + 1,
				},
				{
					x: initialPosition[0],
					y: initialPosition[1] + 3,
					z: initialPosition[2] + 2,
				},
				{
					x: initialPosition[0] - 1,
					y: initialPosition[1] + 2,
					z: initialPosition[2] + 1,
				},
				{ x: initialPosition[0], y: initialPosition[1], z: initialPosition[2] },
			];

			moveAlongPath(meshRef.current, {
				positions: pathPositions,
				duration: 5,
				ease: "power2.inOut",
				delay,
				autoRotate: false,
				debug,
				debugColor,
				debugScene: scene,
				onComplete: () => {
					console.log(`Cube at ${initialPosition} completed path`);
				},
			});
		}
	}, [initialPosition, delay, debug, debugColor, scene]);

	return (
		<mesh ref={meshRef} position={initialPosition}>
			<boxGeometry args={[0.5, 0.5, 0.5]} />
			<meshStandardMaterial color="#a8e6cf" />
		</mesh>
	);
}

/**
 * Main example component
 */
export default function PathAnimationExample() {
	const {
		showSimple,
		showComplex,
		showInteractive,
		showSynchronized,
		debugMode,
		debugColor,
	} = useControls("Path Animations", {
		showSimple: true,
		showComplex: true,
		showInteractive: true,
		showSynchronized: true,
		debugMode: { value: true, label: "Show Debug Paths" },
		debugColor: { value: "#ff0000", label: "Debug Color" },
	});

	return (
		<div style={{ width: "100vw", height: "100vh" }}>
			<Canvas camera={{ position: [10, 8, 10], fov: 60 }}>
				<ambientLight intensity={0.4} />
				<directionalLight position={[10, 10, 5]} intensity={1} />
				<pointLight position={[-10, -10, -5]} intensity={0.5} />

				{showSimple && (
					<SimplePathCube debug={debugMode} debugColor={debugColor} />
				)}
				{showComplex && (
					<ComplexPathSphere debug={debugMode} debugColor={debugColor} />
				)}
				{showInteractive && (
					<InteractivePathTorus debug={debugMode} debugColor={debugColor} />
				)}
				{showSynchronized && (
					<SynchronizedCubes debug={debugMode} debugColor={debugColor} />
				)}

				<gridHelper args={[20, 20]} position={[0, -2, 0]} />
				<OrbitControls enablePan enableZoom enableRotate />
			</Canvas>

			<div
				style={{
					position: "absolute",
					top: 20,
					left: 20,
					color: "white",
					background: "rgba(0,0,0,0.8)",
					padding: "15px",
					borderRadius: "8px",
					maxWidth: "400px",
					fontSize: "14px",
					lineHeight: "1.4",
				}}
			>
				<h3>Path Animation Examples</h3>
				<p>
					Demonstrates the <code>moveAlongPath</code> utility with various path
					animations:
				</p>

				<div style={{ marginTop: "10px" }}>
					<p>
						<strong style={{ color: "#ff6b6b" }}>Red Cube:</strong> Simple
						circular path
					</p>
					<p>
						<strong style={{ color: "#4ecdc4" }}>Cyan Sphere:</strong> Complex
						3D spiral path
					</p>
					<p>
						<strong style={{ color: "#ffe66d" }}>Yellow Torus:</strong>{" "}
						Interactive random path
					</p>
					<p>
						<strong style={{ color: "#a8e6cf" }}>Green Cubes:</strong>{" "}
						Synchronized path animations
					</p>
				</div>

				<div style={{ marginTop: "10px", fontSize: "12px", opacity: 0.8 }}>
					<p>• Use the controls panel to toggle different animations</p>
					<p>• Objects auto-rotate to follow path direction</p>
					<p>• Use mouse to orbit camera and explore the scene</p>
					<p>• Enable "Show Debug Paths" to visualize curve paths</p>
				</div>
			</div>
		</div>
	);
}
