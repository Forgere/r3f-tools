import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useControls } from "leva";
import { useEffect, useRef } from "react";
import type { Mesh } from "three";
import { type AnimationPoint, createAnimator } from "../src/utils/gsapAnimator";

/**
 * Mock 动画数据
 */
const mockFetchAnimationPoints = async (): Promise<AnimationPoint[]> => {
	await new Promise((resolve) => setTimeout(resolve, 100));
	const points: AnimationPoint[] = [];
	const numPoints = Math.floor(Math.random() * 3) + 1;
	for (let i = 0; i < numPoints; i++) {
		points.push({
			x: (Math.random() - 0.5) * 10,
			y: (Math.random() - 0.5) * 6,
			z: (Math.random() - 0.5) * 10,
			rotationX: Math.random() * Math.PI * 2,
			rotationY: Math.random() * Math.PI * 2,
			rotationZ: Math.random() * Math.PI * 2,
			duration: Math.random() * 2 + 0.5,
		});
	}
	return points;
};

/**
 * 动态 Cube 组件
 */
function ContinuousAnimatedCube({
	offset = [0, 0, 0],
}: {
	offset?: [number, number, number];
}) {
	const meshRef = useRef<Mesh>(null);
	const animatorRef = useRef<ReturnType<typeof createAnimator> | null>(null);

	useEffect(() => {
		if (meshRef.current) {
			animatorRef.current = createAnimator(meshRef.current);
			animatorRef.current.startContinuousAnimation(
				mockFetchAnimationPoints,
				1500,
			);
		}

		return () => {
			animatorRef.current?.destroy();
		};
	}, []);

	return (
		<mesh ref={meshRef} position={offset}>
			<boxGeometry args={[1, 1, 1]} />
			<meshStandardMaterial color="orange" />
		</mesh>
	);
}

/**
 * 渲染多个动态 Cube
 */
function MultipleCubes({ count }: { count: number }) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<ContinuousAnimatedCube
					key={`cube${i + 1}`}
					offset={[i * 2 - count, 0, 0]}
				/>
			))}
		</>
	);
}

/**
 * Sphere 动画
 */
function PreDefinedSequenceSphere() {
	const meshRef = useRef<Mesh>(null);

	useEffect(() => {
		if (meshRef.current) {
			const animator = createAnimator(meshRef.current);
			const run = async () => {
				await animator.animateSequence([
					{
						position: { x: 5, y: 2, z: 0 },
						rotation: { y: Math.PI / 4 },
						duration: 1.5,
					},
					{
						position: { x: 3, y: -1, z: 4 },
						rotation: { x: Math.PI / 2, y: Math.PI / 2 },
						duration: 2,
					},
					{
						position: { x: -2, y: 1, z: 2 },
						rotation: { x: Math.PI, y: Math.PI },
						duration: 1.8,
					},
					{
						position: { x: -4, y: -2, z: -3 },
						rotation: { x: Math.PI * 1.5, y: Math.PI * 1.5 },
						duration: 2.2,
					},
					{
						position: { x: 0, y: 0, z: 0 },
						rotation: { x: 0, y: 0, z: 0 },
						duration: 2,
					},
				]);
				animator.destroy();
			};
			run();
			return () => animator.destroy();
		}
	}, []);

	return (
		<mesh ref={meshRef} position={[0, 0, 0]}>
			<sphereGeometry args={[0.5, 32, 32]} />
			<meshStandardMaterial color="cyan" />
		</mesh>
	);
}

/**
 * Torus 动画
 */
function ManualControlTorus() {
	const meshRef = useRef<Mesh>(null);
	const animatorRef = useRef<ReturnType<typeof createAnimator> | null>(null);

	useEffect(() => {
		if (meshRef.current) {
			animatorRef.current = createAnimator(meshRef.current);
			animatorRef.current.addAnimationPoints([
				{ x: -6, y: 0, z: 0, duration: 2 },
				{ x: -6, y: 3, z: 3, rotationY: Math.PI, duration: 1.5 },
				{ x: 6, y: 3, z: 3, rotationX: Math.PI, duration: 2.5 },
				{ x: 6, y: -3, z: -3, rotationZ: Math.PI, duration: 1.8 },
				{
					x: 0,
					y: 0,
					z: 0,
					rotationX: 0,
					rotationY: 0,
					rotationZ: 0,
					duration: 2,
				},
			]);

			const interval = setInterval(() => {
				if (animatorRef.current) {
					const newPoint: AnimationPoint = {
						x: (Math.random() - 0.5) * 8,
						y: (Math.random() - 0.5) * 6,
						z: (Math.random() - 0.5) * 8,
						rotationY: Math.random() * Math.PI * 2,
						duration: Math.random() * 10 + 1,
					};
					animatorRef.current.addAnimationPoint(newPoint);
				}
			}, 3000);

			return () => {
				clearInterval(interval);
				animatorRef.current?.destroy();
			};
		}
	}, []);

	return (
		<mesh ref={meshRef}>
			<torusGeometry args={[0.6, 0.2, 16, 100]} />
			<meshStandardMaterial color="magenta" />
		</mesh>
	);
}

/**
 * 总场景组件
 */
export default function GSAPAnimationExample() {
	const { cubeCount } = useControls("Controls", {
		cubeCount: { value: 3, min: 1, max: 1000, step: 1 },
	});

	return (
		<div style={{ width: "100vw", height: "100vh" }}>
			<Canvas camera={{ position: [12, 8, 12] }}>
				<ambientLight intensity={0.5} />
				<directionalLight position={[10, 10, 5]} intensity={1} />

				<MultipleCubes count={cubeCount} />
				<PreDefinedSequenceSphere />
				<ManualControlTorus />

				<OrbitControls enablePan enableZoom enableRotate />
			</Canvas>

			<div
				style={{
					position: "absolute",
					top: 20,
					left: 20,
					color: "white",
					background: "rgba(0,0,0,0.7)",
					padding: "15px",
					borderRadius: "8px",
					maxWidth: "350px",
				}}
			>
				<h3>GSAP Continuous Animation Example</h3>
				<div style={{ fontSize: "14px", lineHeight: "1.4" }}>
					<p>
						<strong style={{ color: "orange" }}>Orange Cubes:</strong> Dynamic
						number of cubes (leva)
					</p>
					<p>
						<strong style={{ color: "cyan" }}>Cyan Sphere:</strong> Predefined
						animation sequence
					</p>
					<p>
						<strong style={{ color: "magenta" }}>Magenta Torus:</strong> Manual
						+ periodic animation points
					</p>
				</div>
			</div>
		</div>
	);
}
