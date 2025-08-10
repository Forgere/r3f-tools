import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ConveyorBelt, type ConveyorBeltRef } from "./ConveyorBelt";

interface PhysicsConveyorBeltProps {
	curvePath: THREE.Vector3[];
	rollerSpacing?: number;
	frameWidth?: number;
	frameHeight?: number;
	frameDepth?: number;
	rollerRadius?: number;
	rollerLength?: number;
	segments?: number;
	showPath?: boolean;
	frameMaterial?: THREE.Material;
	rollerMaterial?: THREE.Material;
	pathMaterial?: THREE.Material;
}

export function PhysicsConveyorBelt({
	curvePath,
	rollerSpacing = 0.8,
	frameWidth = 2.0,
	frameHeight = 0.5,
	frameDepth = 0.3,
	rollerRadius = 0.08,
	rollerLength = 2.2,
	segments = 16,
	showPath = false,
	frameMaterial,
	rollerMaterial,
	pathMaterial,
}: PhysicsConveyorBeltProps) {
	const conveyorRef = useRef<ConveyorBeltRef>(null);

	// Create multiple cuboid colliders along the path
	const colliders = useMemo(() => {
		if (curvePath.length < 2) return [];

		const colliders = [];

		// Create colliders along the path
		for (let i = 0; i < curvePath.length - 1; i++) {
			const startPoint = curvePath[i] || new THREE.Vector3();
			const endPoint = curvePath[i + 1] || new THREE.Vector3();

			// Calculate midpoint
			const midPoint = new THREE.Vector3()
				.addVectors(startPoint, endPoint)
				.multiplyScalar(0.5);

			// Calculate distance and direction
			const distance = startPoint.distanceTo(endPoint);
			const direction = new THREE.Vector3()
				.subVectors(endPoint, startPoint)
				.normalize();

			// Calculate rotation to align with direction
			const target = new THREE.Vector3().copy(direction);
			const up = new THREE.Vector3(0, 1, 0);
			const matrix = new THREE.Matrix4().lookAt(
				new THREE.Vector3(0, 0, 1),
				target,
				up,
			);
			const rotation = new THREE.Euler().setFromRotationMatrix(matrix);

			colliders.push({
				position: [midPoint.x, midPoint.y + 0.1, midPoint.z],
				rotation: [rotation.x, rotation.y, rotation.z],
				size: [frameWidth / 2, 0.1, distance / 2],
			});
		}

		return colliders;
	}, [curvePath, frameWidth]);

	const defaultPathMaterial = useMemo(() => {
		// 创建自定义着色器材质实现绿色箭头动画
		const material = new THREE.ShaderMaterial({
			uniforms: {
				time: { value: 0 },
				color: { value: new THREE.Color(0x00ff00) }, // 绿色
				arrowSpacing: { value: 1.0 }, // 箭头间距
				arrowSpeed: { value: 0.5 }, // 箭头速度
				arrowLength: { value: 0.3 }, // 箭头长度
			},
			vertexShader: `
          varying vec2 vUv;
          
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
			fragmentShader: `
          uniform float time;
          uniform vec3 color;
          uniform float arrowSpacing;
          uniform float arrowSpeed;
          uniform float arrowLength;
          varying vec2 vUv;
          
          void main() {
            // 创建沿着V方向(曲线方向)移动的箭头图案
            float speed = time * arrowSpeed;
            float pos = mod(vUv.y - speed, arrowSpacing);
            
            // 创建箭头形状 - 一个渐变的三角形
            float arrow = smoothstep(0.0, arrowLength, pos);
            arrow *= smoothstep(arrowLength, 1.0, pos - arrowLength);
            
            // 基础颜色和箭头颜色混合
            vec3 finalColor = mix(color * 0.2, color, arrow);
            
            gl_FragColor = vec4(finalColor, 0.7);
          }
        `,
			transparent: true,
			side: THREE.DoubleSide,
		});

		return material as THREE.ShaderMaterial & {
			uniforms: {
				time: {
					value: number;
				};
				arrowSpacing: {
					value: number;
				};
				arrowSpeed: {
					value: number;
				};
				arrowLength: {
					value: number;
				};
			};
		};
	}, []);

	// 优化的曲线缓存机制
	const curve = useMemo(() => {
		return new THREE.CatmullRomCurve3(curvePath, false, "chordal");
	}, [curvePath]);

	const pathGeometry = useMemo(() => {
		if (!showPath) return null;

		const vertices: number[] = [];
		const indices: number[] = [];
		const normals: number[] = [];
		const uvs: number[] = [];

		const pathSegments = segments * 2;

		for (let i = 0; i <= pathSegments; i++) {
			const t = i / pathSegments;
			const position = curve.getPointAt(t);
			const tangent = curve.getTangentAt(t);

			// 计算垂直于切线的横向方向
			const right = new THREE.Vector3()
				.crossVectors(tangent, new THREE.Vector3(0, 1, 0))
				.normalize();

			// 创建路径宽度的左右顶点
			const halfWidth = frameWidth / 2;
			const leftPoint = position
				.clone()
				.add(right.clone().multiplyScalar(-halfWidth));
			const rightPoint = position
				.clone()
				.add(right.clone().multiplyScalar(halfWidth));

			// 添加顶点
			vertices.push(leftPoint.x, leftPoint.y, leftPoint.z);
			vertices.push(rightPoint.x, rightPoint.y, rightPoint.z);

			// 计算向上的法线
			const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
			normals.push(up.x, up.y, up.z);
			normals.push(up.x, up.y, up.z);

			// UV坐标
			const u = t;
			uvs.push(0, u);
			uvs.push(1, u);

			// 创建面（除了最后一个点）
			if (i < pathSegments) {
				const baseIndex = i * 2;
				const nextBaseIndex = baseIndex + 2;

				// 两个三角形组成一个四边形
				indices.push(baseIndex, baseIndex + 1, nextBaseIndex);
				indices.push(baseIndex + 1, nextBaseIndex + 1, nextBaseIndex);
			}
		}

		const geometry = new THREE.BufferGeometry();
		geometry.setIndex(indices);
		geometry.setAttribute(
			"position",
			new THREE.Float32BufferAttribute(vertices, 3),
		);
		geometry.setAttribute(
			"normal",
			new THREE.Float32BufferAttribute(normals, 3),
		);
		geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
		geometry.computeVertexNormals();

		return geometry;
	}, [curve, frameWidth, segments, showPath]);

	return (
		<group>
			{/* Use ConveyorBelt for visual model */}
			<ConveyorBelt
				ref={conveyorRef}
				curvePath={curvePath}
				rollerSpacing={rollerSpacing}
				frameWidth={frameWidth}
				frameHeight={frameHeight}
				frameDepth={frameDepth}
				rollerRadius={rollerRadius}
				rollerLength={rollerLength}
				segments={segments}
				showPath={showPath}
				frameMaterial={frameMaterial}
				rollerMaterial={rollerMaterial}
				pathMaterial={pathMaterial}
			/>

			{/* Path as rigid body for physics collision using multiple cuboid colliders */}
			{/* 路径可视化曲面 */}
			{showPath && pathGeometry && (
				<RigidBody type="fixed" colliders="trimesh">
					<mesh
						geometry={pathGeometry}
						material={pathMaterial ?? defaultPathMaterial}
					/>
				</RigidBody>
			)}
		</group>
	);
}
