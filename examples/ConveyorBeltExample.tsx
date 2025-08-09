import {
	AdaptiveDpr,
	AdaptiveEvents,
	OrbitControls,
	Stats,
} from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { button, useControls } from "leva";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
	ConveyorBelt,
	type ConveyorBeltRef,
} from "../src/components/ConveyorBelt";

interface ConveyorData {
	id: string;
	curvePath: THREE.Vector3[];
	position: THREE.Vector3;
	rotation: THREE.Euler;
	pathType: string;
}

function ConveyorBeltScene({
	conveyors,
	setConveyors,
	conveyorCount,
	setConveyorCount,
}: {
	conveyors: ConveyorData[];
	setConveyors: React.Dispatch<React.SetStateAction<ConveyorData[]>>;
	conveyorCount: number;
	setConveyorCount: React.Dispatch<React.SetStateAction<number>>;
}) {
	const conveyorRef = useRef<ConveyorBeltRef>(null);
	const groupRef = useRef<THREE.Group>(null);

	// Leva controls
	const {
		rollerSpacing,
		frameWidth,
		frameHeight,
		frameDepth,
		rollerRadius,
		segments,
		pathType,
		animationSpeed,
		showWireframe,
		showPath,
	} = useControls({
		rollerSpacing: { value: 0.8, min: 0.2, max: 2.0, step: 0.1 },
		frameWidth: { value: 2.0, min: 0.5, max: 5.0, step: 0.1 },
		frameHeight: { value: 0.5, min: 0.1, max: 1.2, step: 0.1 },
		frameDepth: { value: 0.3, min: 0.05, max: 0.8, step: 0.05 },
		rollerRadius: { value: 0.08, min: 0.02, max: 0.2, step: 0.01 },
		segments: { value: 16, min: 8, max: 32, step: 1 },
		pathType: {
			value: "S-curve",
			options: ["straight", "L-shape", "S-curve", "spiral", "figure-8"],
		},
		animationSpeed: { value: 0.5, min: 0, max: 2, step: 0.1 },
		showWireframe: false,
		showPath: false,
		conveyorCount: {
			value: conveyorCount,
			min: 1,
			max: 1000,
			step: 1,
			onChange: (value) => setConveyorCount(value),
		},
		resetAnimation: button(() => {
			if (groupRef.current) {
				groupRef.current.rotation.set(0, 0, 0);
			}
		}),
	});

	// 生成不同类型的路径
	const generateCurvePath = useCallback((pathType: string): THREE.Vector3[] => {
		switch (pathType) {
			case "straight":
				return [
					new THREE.Vector3(-4, 0, 0),
					new THREE.Vector3(-1, 0, 0),
					new THREE.Vector3(1, 0, 0),
					new THREE.Vector3(4, 0, 0),
				];

			case "L-shape":
				return [
					new THREE.Vector3(-3, 0, -3),
					new THREE.Vector3(-1, 0, -3),
					new THREE.Vector3(0, 0, -2),
					new THREE.Vector3(0, 0, 0),
					new THREE.Vector3(0, 0, 2),
					new THREE.Vector3(0, 0, 3),
				];

			case "S-curve":
				return [
					new THREE.Vector3(-8, 0, -4),
					new THREE.Vector3(-6, 0, -4),
					new THREE.Vector3(-4, 0, -3),
					new THREE.Vector3(-2, 0, -1),
					new THREE.Vector3(0, 0, 1),
					new THREE.Vector3(2, 0, 3),
					new THREE.Vector3(4, 0, 4),
					new THREE.Vector3(6, 0, 4),
					new THREE.Vector3(8, 0, 3),
					new THREE.Vector3(10, 0, 1),
					new THREE.Vector3(12, 0, -1),
					new THREE.Vector3(14, 0, -3),
					new THREE.Vector3(16, 0, -4),
					new THREE.Vector3(20, 4, -4),
					new THREE.Vector3(24, 8, -4),
					new THREE.Vector3(32, 8, -4),
				];

			case "spiral": {
				const spiralPoints: THREE.Vector3[] = [];
				for (let i = 0; i < 20; i++) {
					const t = i / 19;
					const angle = t * Math.PI * 4;
					const radius = 1 + t * 2;
					spiralPoints.push(
						new THREE.Vector3(
							Math.cos(angle) * radius,
							t * 2,
							Math.sin(angle) * radius,
						),
					);
				}
				return spiralPoints;
			}

			case "figure-8": {
				const figure8Points: THREE.Vector3[] = [];
				for (let i = 0; i < 16; i++) {
					const t = (i / 15) * Math.PI * 2;
					figure8Points.push(
						new THREE.Vector3(Math.sin(t) * 3, 0, Math.sin(t * 2) * 2),
					);
				}
				return figure8Points;
			}

			default:
				return [new THREE.Vector3(-2, 0, 0), new THREE.Vector3(2, 0, 0)];
		}
	}, []);

	// 生成螺旋式布局位置，防止重叠
	const generateSpiralPosition = useCallback((index: number) => {
		const spiralSpacing = 10; // 每圈间距
		const itemsPerRing = 8; // 每圈放置的输送线数量

		const ring = Math.floor(index / itemsPerRing);
		const indexInRing = index % itemsPerRing;

		const radius = ring * spiralSpacing + 15; // 从半径15开始
		const angleStep = (Math.PI * 2) / itemsPerRing;
		const angle = indexInRing * angleStep + ring * 0.5; // 每圈稍微偏移避免对齐

		return new THREE.Vector3(
			Math.cos(angle) * radius,
			0,
			Math.sin(angle) * radius,
		);
	}, []);

	// 根据数量生成所有输送线
	const generateAllConveyors = useCallback(
		(count: number) => {
			const pathTypes = [
				"straight",
				"L-shape",
				"S-curve",
				"spiral",
				"figure-8",
			];
			const newConveyors: ConveyorData[] = [];

			for (let i = 0; i < count - 1; i++) {
				// -1 因为有主输送线
				const randomPathType =
					pathTypes[Math.floor(Math.random() * pathTypes.length)];
				const position = generateSpiralPosition(i);
				const rotation = new THREE.Euler(0, Math.random() * Math.PI * 2, 0);

				newConveyors.push({
					id: `conveyor-${i}`,
					curvePath: generateCurvePath(randomPathType),
					position,
					rotation,
					pathType: randomPathType,
				});
			}

			return newConveyors;
		},
		[generateSpiralPosition, generateCurvePath],
	);

	// 当conveyorCount变化时更新输送线数量
	useEffect(() => {
		const newConveyors = generateAllConveyors(conveyorCount);
		setConveyors(newConveyors);
	}, [conveyorCount, generateAllConveyors, setConveyors]);

	// 获取当前选择的路径
	const curvePath = useMemo(
		() => generateCurvePath(pathType),
		[pathType, generateCurvePath],
	);

	// 动画旋转
	useFrame((_, delta) => {
		if (groupRef.current && animationSpeed > 0) {
			groupRef.current.rotation.y += delta * animationSpeed * 0.5;
		}
	});

	// 创建材质
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

	const pathMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x1a4a8a,
				roughness: 0.7,
				metalness: 0.2,
				transparent: true,
				opacity: 0.8,
				wireframe: showWireframe,
			}),
		[showWireframe],
	);

	return (
		<group ref={groupRef}>
			{/* 环境光 */}
			<ambientLight intensity={0.3} />
			<pointLight position={[8, 8, 8]} intensity={1.2} />
			<directionalLight position={[-5, 10, -5]} intensity={0.8} />

			{/* 主输送线组件 */}
			<ConveyorBelt
				ref={conveyorRef}
				curvePath={curvePath}
				rollerSpacing={rollerSpacing}
				frameWidth={frameWidth}
				frameHeight={frameHeight}
				frameDepth={frameDepth}
				rollerRadius={rollerRadius}
				rollerLength={frameWidth + 0.2}
				frameMaterial={frameMaterial}
				rollerMaterial={rollerMaterial}
				pathMaterial={pathMaterial}
				segments={segments}
				showPath={showPath}
			/>

			{/* 随机生成的输送线 */}
			{conveyors.map((conveyor) => (
				<group
					key={conveyor.id}
					position={conveyor.position}
					rotation={conveyor.rotation}
				>
					<ConveyorBelt
						curvePath={conveyor.curvePath}
						rollerSpacing={rollerSpacing}
						frameWidth={frameWidth}
						frameHeight={frameHeight}
						frameDepth={frameDepth}
						rollerRadius={rollerRadius}
						rollerLength={frameWidth + 0.2}
						frameMaterial={frameMaterial}
						rollerMaterial={rollerMaterial}
						pathMaterial={pathMaterial}
						segments={segments}
						showPath={showPath}
					/>
				</group>
			))}

			{/* 显示主路径点（辅助可视化） */}
			{curvePath.map((point, index) => (
				<mesh key={`main-${index.toString()}`} position={point}>
					<sphereGeometry args={[0.05, 8, 8]} />
					<meshBasicMaterial color={0xff4444} />
				</mesh>
			))}

			{/* 地板网格 */}
			<gridHelper
				args={[2000, 200, 0x444444, 0x222222]}
				position={[0, -1, 0]}
			/>

			<OrbitControls enablePan enableZoom enableRotate />
		</group>
	);
}

export function ConveyorBeltExample() {
	const [conveyors, setConveyors] = useState<ConveyorData[]>([]);
	const [conveyorCount, setConveyorCount] = useState(1);

	return (
		<div style={{ width: "100vw", height: "100vh", background: "#111" }}>
			<style>{`
				.stats-fps { position: fixed !important; top: 10px !important; left: 10px !important; }
				.stats-ms { position: fixed !important; top: 10px !important; left: 100px !important; }
				.stats-memory { position: fixed !important; top: 10px !important; left: 190px !important; }
				body { margin: 0; overflow: hidden; }
			`}</style>

			{/* 说明面板 - 显示实时信息 */}
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
				<h3 style={{ margin: "0 0 10px 0" }}>ConveyorBelt Performance Test</h3>
				<p style={{ margin: "5px 0" }}>• 红色球体显示主路径控制点</p>
				<p style={{ margin: "5px 0" }}>• 使用滑块调整输送线数量 (1-100,000)</p>
				<p style={{ margin: "5px 0" }}>• 螺旋式布局防止重叠</p>
				<p style={{ margin: "5px 0" }}>
					• 当前输送线数量: <strong>{conveyorCount}</strong>
				</p>
				<p style={{ margin: "5px 0" }}>• 滚筒使用InstancedMesh优化渲染</p>
				<p style={{ margin: "5px 0" }}>• 框架使用ExtrudeGeometry沿曲线生成</p>
				<p style={{ margin: "5px 0" }}>• 使用右侧面板调整参数</p>
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
				<ConveyorBeltScene
					conveyors={conveyors}
					setConveyors={setConveyors}
					conveyorCount={conveyorCount}
					setConveyorCount={setConveyorCount}
				/>
			</Canvas>
		</div>
	);
}
