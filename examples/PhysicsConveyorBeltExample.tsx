import {
	AdaptiveDpr,
	AdaptiveEvents,
	OrbitControls,
	Stats,
	TransformControls,
} from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { button, useControls } from "leva";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three-stdlib";
import { PhysicsCart } from "../src/components/PhysicsCart";
import { PhysicsConveyorBelt } from "../src/components/PhysicsConveyorBelt";

// Helper function to create a default path
const createDefaultPath = (): THREE.Vector3[] => [
	new THREE.Vector3(-4, 2, 0),
	new THREE.Vector3(-1, 0, 0),
	new THREE.Vector3(1, 0, 0),
	new THREE.Vector3(4, 0, 0),
];

// Component for an editable point in the 3D scene
const EditPoint: React.FC<{
	point: THREE.Vector3;
	index: number;
	isSelected: boolean;
	onSelect: (index: number) => void;
}> = ({ point, index, isSelected, onSelect }) => {
	const meshRef = useRef<THREE.Mesh>(null);

	useEffect(() => {
		if (meshRef.current) {
			meshRef.current.position.copy(point);
		}
	}, [point]);

	const handlePointerDown = (e: any) => {
		e.stopPropagation();
		onSelect(index);
	};

	return (
		<mesh
			ref={meshRef}
			onPointerDown={handlePointerDown}
			position={point}
		>
			<sphereGeometry args={[0.1, 16, 16]} />
			<meshStandardMaterial
				color={isSelected ? 0xff0000 : 0x00ff00}
				emissive={isSelected ? 0x440000 : 0x004400}
				emissiveIntensity={0.5}
			/>
		</mesh>
	);
};

function save(blob, filename) {
	const link = document.createElement("a");
	link.href = URL.createObjectURL(blob);
	link.download = filename;
	link.click();
}

function saveArrayBuffer(buffer, filename) {
	save(new Blob([buffer], { type: "application/octet-stream" }), filename);
}

// Main scene component
function PhysicsConveyorBeltScene() {
	const [points, setPoints] = useState<THREE.Vector3[]>(createDefaultPath());
	const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(
		null,
	);
	const groupRef = useRef<THREE.Group>(null);
	const transformControlRef = useRef<any>(null);
	const transformTargetRef = useRef<THREE.Object3D>(new THREE.Object3D());
	const { scene } = useThree();

	// Load points from localStorage on mount
	useEffect(() => {
		const savedPoints = localStorage.getItem("physicsConveyorBeltPoints");
		if (savedPoints) {
			try {
				const parsed = JSON.parse(savedPoints);
				// Convert array of objects back to Vector3 instances
				const loadedPoints = parsed.map(
					(point: any) => new THREE.Vector3(point.x, point.y, point.z),
				);
				setPoints(loadedPoints);
			} catch (e) {
				console.error("Failed to parse saved points", e);
			}
		}
	}, []);

	const saveTolocal = useCallback((data) => {
		// Convert Vector3 objects to plain objects for serialization
		const serializablePoints = data.map((vector) => ({
			x: vector.x,
			y: vector.y,
			z: vector.z,
		}));
		localStorage.setItem(
			"physicsConveyorBeltPoints",
			JSON.stringify(serializablePoints),
		);
	}, []);

	useEffect(() => {
		saveTolocal(points);
	}, [points, saveTolocal]);

	// Keep a reference to OrbitControls so we can disable it during transformation
	const orbitControlsRef = useRef<any>(null);

	// Update the position of the transform target when the selected point changes
	useEffect(() => {
		if (selectedPointIndex !== null && points[selectedPointIndex]) {
			transformTargetRef.current.position.copy(points[selectedPointIndex]);
			// Ensure transform controls are attached to the target
			if (transformControlRef.current) {
				transformControlRef.current.attach(transformTargetRef.current);
			}
		}
	}, [selectedPointIndex, points]);

	// Helper function to generate a new point as the midpoint between existing points
	const generateNewPoint = useCallback(
		(index: number, after: boolean) => {
			// For the first point
			if (index === 0) {
				if (!after) {
					const firstPoint = points[0].clone();
					const secondPoint = points[1].clone();
					const newPoint = firstPoint.multiplyScalar(2).sub(secondPoint);
					return newPoint;
				}
			}

			// For the last point
			if (index === points.length) {
				const firstPoint = points[points.length - 1].clone();
				const secondPoint = points[points.length - 2].clone();
				const newPoint = firstPoint.multiplyScalar(2).sub(secondPoint);
				return newPoint;
			}

			// Midpoint between index-1 and index
			const prevPoint = points[index - 1].clone();
			const currentPoint = points[index].clone();
			return prevPoint.clone().add(currentPoint).multiplyScalar(0.5);
		},
		[points],
	);

	// Leva controls
	const {
		rollerSpacing,
		frameWidth,
		frameHeight,
		frameDepth,
		rollerRadius,
		segments,
		showWireframe,
		showPath,
		cartMass,
		cartSpeed,
	} = useControls(
		{
			rollerSpacing: { value: 0.8, min: 0.2, max: 2.0, step: 0.1 },
			frameWidth: { value: 2.0, min: 0.5, max: 5.0, step: 0.1 },
			frameHeight: { value: 0.5, min: 0.1, max: 1.2, step: 0.1 },
			frameDepth: { value: 0.3, min: 0.05, max: 0.8, step: 0.05 },
			rollerRadius: { value: 0.08, min: 0.02, max: 0.2, step: 0.01 },
			segments: { value: 16, min: 8, max: 100, step: 1 },
			showWireframe: false,
			showPath: false,
			cartMass: { value: 1, min: 0.1, max: 10, step: 0.1 },
			cartSpeed: { value: 0.5, min: 0, max: 2, step: 0.1 },
			resetPath: button(() => {
				console.log("Reset path clicked");
				setPoints(createDefaultPath());
				setSelectedPointIndex(null);
			}),
			addPointAfter: button(() => {
				if (selectedPointIndex === null) return;
				const newPoint = generateNewPoint(selectedPointIndex + 1, true);
				const newPoints = [...points];
				newPoints.splice(selectedPointIndex + 1, 0, newPoint);
				setPoints(newPoints);
				setSelectedPointIndex((prev) => (prev !== null ? prev + 1 : prev));
			}),
			addPointBefore: button(() => {
				if (selectedPointIndex === null) return;
				const newPoint = generateNewPoint(selectedPointIndex, false);
				const newPoints = [...points];
				newPoints.splice(selectedPointIndex, 0, newPoint);
				setPoints(newPoints);
			}),
			deleteSelectedPoint: button(() => {
				if (selectedPointIndex === null) return;
				const newPoints = points.filter((_, i) => i !== selectedPointIndex);
				setPoints(newPoints);
				if (newPoints.length === 0) {
					setSelectedPointIndex(null);
				} else if (selectedPointIndex >= newPoints.length) {
					setSelectedPointIndex(newPoints.length - 1);
				}
			}),
			downloadPathPoints: button(() => {
				const serializablePoints = points.map((vector) => ({
					x: vector.x,
					y: vector.y,
					z: vector.z,
				}));
				const dataStr = JSON.stringify(serializablePoints, null, 2);
				const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
				const exportFileDefaultName = `physics-conveyor-path-points.json`;
				const linkElement = document.createElement("a");
				linkElement.setAttribute("href", dataUri);
				linkElement.setAttribute("download", exportFileDefaultName);
				linkElement.click();
			}),
			downloadSceneAsGLB: button(() => {
				const exporter = new GLTFExporter();
				if (scene) {
					exporter.parse(
						scene,
						(result) => {
							saveArrayBuffer(result, "physics-conveyor.glb");
						},
						(error) => {
							console.error("Error exporting scene:", error);
						},
						{ binary: true },
					);
				}
			}),
		},
		[points, selectedPointIndex, generateNewPoint],
	);

	// Handle point selection
	const handleSelectPoint = useCallback((index: number) => {
		setTimeout(() => {
			setSelectedPointIndex(index);
		}, 200);
	}, []);

	// Handle object change from TransformControls
	const handleObjectChange = useCallback(() => {
		if (selectedPointIndex !== null) {
			const newPosition = transformTargetRef.current.position.clone();
			setPoints((prev) =>
				prev.map((point, i) =>
					i === selectedPointIndex ? newPosition : point,
				),
			);
		}
	}, [selectedPointIndex]);

	// Create materials
	const frameMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x282828,
				roughness: 0.6,
				metalness: 0.4,
				wireframe: showWireframe,
			}),
		[showWireframe],
	);

	const rollerMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x777777,
				roughness: 0.4,
				metalness: 0.6,
				wireframe: showWireframe,
			}),
		[showWireframe],
	);

	return (
		<group ref={groupRef}>
			{/* Environment lights */}
			<ambientLight intensity={0.3} />
			<pointLight position={[8, 8, 8]} intensity={1.2} />
			<pointLight position={[-8, -8, -8]} intensity={0.4} />
			<directionalLight position={[-5, 10, -5]} intensity={0.8} />

			{/* Ground grid */}
			<gridHelper
				args={[100, 100, 0x444444, 0x222222]}
				position={[0, -0.01, 0]}
			/>

			{/* Physics world */}
			<Physics gravity={[0, -9.81, 0]}>
				<PhysicsConveyorBelt
					curvePath={points}
					rollerSpacing={rollerSpacing}
					frameWidth={frameWidth}
					frameHeight={frameHeight}
					frameDepth={frameDepth}
					rollerRadius={rollerRadius}
					rollerLength={frameWidth + 0.2}
					frameMaterial={frameMaterial}
					rollerMaterial={rollerMaterial}
					segments={segments}
					showPath={showPath}
				/>

				<PhysicsCart
					curvePath={points}
					mass={cartMass}
					speed={cartSpeed}
					initialPosition={0}
				/>
			</Physics>

			{/* Editable Points */}
			{points.map((point, index) => (
				<EditPoint
					key={`edit-point-${index.toString()}`}
					point={point}
					index={index}
					isSelected={selectedPointIndex === index}
					onSelect={handleSelectPoint}
				/>
			))}

			{/* Transform Controls Target - always exists but only visible when selected */}
			<primitive object={transformTargetRef.current} visible={false} />

			{/* Transform Controls for selected point */}
			{selectedPointIndex !== null && (
				<TransformControls
					key={`transform-${selectedPointIndex}`}
					ref={transformControlRef}
					object={transformTargetRef.current}
					mode="translate"
					space="world"
					onObjectChange={handleObjectChange}
					onPointerDown={(e) => {
						e.stopPropagation();
					}}
					onPointerMissed={() => {
						setSelectedPointIndex(null);
					}}
				/>
			)}

			<OrbitControls
				ref={orbitControlsRef}
				enablePan
				enableZoom
				enableRotate={selectedPointIndex === null}
			/>
		</group>
	);
}

// Main example component
export function PhysicsConveyorBeltExample() {
	return (
		<div style={{ width: "100vw", height: "100vh", background: "#111" }}>
			<style>{`
				.stats-fps { position: fixed !important; top: 10px !important; left: 10px !important; }
				.stats-ms { position: fixed !important; top: 10px !important; left: 100px !important; }
				.stats-memory { position: fixed !important; top: 10px !important; left: 190px !important; }
				body { margin: 0; overflow: hidden; }
			`}</style>

			{/* Instructions panel */}
			<div
				style={{
					position: "absolute",
					top: "10px",
					right: "10px",
					color: "white",
					background: "rgba(0,0,0,0.8)",
					padding: "15px",
					borderRadius: "8px",
					fontSize: "12px",
					maxWidth: "300px",
					zIndex: 100,
				}}
			>
				<h3 style={{ margin: "0 0 10px 0" }}>Physics Conveyor Belt</h3>
				<p style={{ margin: "5px 0" }}>• Green spheres are editable points</p>
				<p style={{ margin: "5px 0" }}>• Click on a point to select it</p>
				<p style={{ margin: "5px 0" }}>
					• Use the transform gizmo to move points
				</p>
				<p style={{ margin: "5px 0" }}>
					• Use the control panel to add/delete points
				</p>
				<p style={{ margin: "5px 0" }}>• Red sphere indicates selected point</p>
				<p style={{ margin: "5px 0" }}>• Physics cart moves along the track</p>
				<p style={{ margin: "5px 0" }}>• Adjust cart mass and speed in controls</p>
				<p style={{ margin: "5px 0" }}>• Save/Load paths with localStorage</p>
			</div>

			<Canvas
				camera={{ position: [8, 6, 8], fov: 60 }}
				gl={{ antialias: true }}
			>
				<AdaptiveDpr pixelated />
				<AdaptiveEvents />
				<Stats showPanel={0} className="stats-fps" />
				<Stats showPanel={1} className="stats-ms" />
				<Stats showPanel={2} className="stats-memory" />
				<PhysicsConveyorBeltScene />
			</Canvas>
		</div>
	);
}
