import { forwardRef, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
	InstancedMeshPool,
	type InstancedMeshPoolRef,
} from "./InstanceMeshPool";

export interface ConveyorBeltProps {
	curvePath: THREE.Vector3[];
	rollerSpacing: number;
	frameWidth: number;
	frameHeight: number;
	frameDepth?: number;
	rollerRadius?: number;
	rollerLength?: number;
	frameMaterial?: THREE.Material;
	rollerMaterial?: THREE.Material;
	pathMaterial?: THREE.Material;
	rollerColor?: THREE.Color;
	segments?: number;
	showPath?: boolean;
}

export interface ConveyorBeltRef {
	getFrameLength: () => number;
	getRollerCount: () => number;
	updateAnimation?: (time: number) => void;
}

export const ConveyorBelt = forwardRef<ConveyorBeltRef, ConveyorBeltProps>(
	function ConveyorBelt(
		{
			curvePath,
			rollerSpacing,
			frameWidth,
			frameHeight,
			frameDepth = 0.1,
			rollerRadius = 0.05,
			rollerLength = frameWidth,
			frameMaterial,
			rollerMaterial,
			pathMaterial,
			rollerColor = new THREE.Color(0x666666),
			segments = 32,
			showPath = false,
		}: ConveyorBeltProps,
		ref,
	) {
		const instancedMeshRef = useRef<InstancedMeshPoolRef>(null);

		// 优化的曲线缓存机制
		const curve = useMemo(() => {
			return new THREE.CatmullRomCurve3(curvePath, false, "chordal");
		}, [curvePath]);

		// 计算滚筒位置和方向
		const { totalLength, rollerPositions } = useMemo(() => {
			const totalLength = curve.getLength();
			const rollerCount = Math.floor(totalLength / rollerSpacing) + 1;
			const positions: Array<{
				position: THREE.Vector3;
				tangent: THREE.Vector3;
				quaternion: THREE.Quaternion;
				matrix: THREE.Matrix4;
			}> = [];

			for (let i = 0; i < rollerCount; i++) {
				const t = i / (rollerCount - 1);
				const position = curve.getPointAt(t);
				const tangent = curve.getTangentAt(t);

				// 计算滚筒的四元数旋转 - 滚筒轴在水平方向与路径切线垂直
				const up = new THREE.Vector3(0, 1, 0);
				const rollerAxis = new THREE.Vector3()
					.crossVectors(up, tangent)
					.normalize();
				const quaternion = new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(0, 1, 0), // 滚筒默认轴向（Y轴，垂直）
					rollerAxis, // 滚筒轴垂直于切线且水平
				);

				// 创建变换矩阵
				const matrix = new THREE.Matrix4();
				matrix.makeRotationFromQuaternion(quaternion);
				matrix.setPosition(position);

				positions.push({
					position: position.clone(),
					tangent: tangent.clone(),
					quaternion: quaternion.clone(),
					matrix: matrix.clone(),
				});
			}

			return {
				totalLength,
				rollerPositions: positions,
			};
		}, [curve, rollerSpacing]);

		// 创建滚筒几何体和材质
		const rollerGeometry = useMemo(() => {
			return new THREE.CylinderGeometry(
				rollerRadius,
				rollerRadius,
				rollerLength,
				segments,
			);
		}, [rollerRadius, rollerLength, segments]);

		const defaultRollerMaterial = useMemo(() => {
			return new THREE.MeshStandardMaterial({ color: rollerColor });
		}, [rollerColor]);

		// 创建框架几何体 - 使用ExtrudeGeometry沿左右偏移曲线生成
		const { frameGeometries } = useMemo(() => {
			// 创建正方形横截面形状
			const squareShape = new THREE.Shape();
			const halfDepth = frameDepth / 2;
			squareShape.moveTo(-halfDepth, -frameHeight / 2);
			squareShape.lineTo(halfDepth, -frameHeight / 2);
			squareShape.lineTo(halfDepth, frameHeight / 2);
			squareShape.lineTo(-halfDepth, frameHeight / 2);
			squareShape.closePath();

			// 使用与showPath相同的逻辑生成左右偏移曲线
			const leftCurvePoints: THREE.Vector3[] = [];
			const rightCurvePoints: THREE.Vector3[] = [];

			const pathSegments = segments * 2;

			for (let i = 0; i <= pathSegments; i++) {
				const t = i / pathSegments;
				const position = curve.getPointAt(t);
				const tangent = curve.getTangentAt(t);

				// 计算垂直于切线的横向方向（与showPath完全相同）
				const right = new THREE.Vector3()
					.crossVectors(tangent, new THREE.Vector3(0, 1, 0))
					.normalize();

				// 创建路径宽度的左右顶点（与showPath完全相同）
				const halfWidth = frameWidth / 2;
				const leftPoint = position
					.clone()
					.add(right.clone().multiplyScalar(-halfWidth));
				const rightPoint = position
					.clone()
					.add(right.clone().multiplyScalar(halfWidth));

				leftCurvePoints.push(leftPoint);
				rightCurvePoints.push(rightPoint);
			}

			// 创建左右两条曲线
			const leftCurve = new THREE.CatmullRomCurve3(
				leftCurvePoints,
				false,
				"chordal",
			);
			const rightCurve = new THREE.CatmullRomCurve3(
				rightCurvePoints,
				false,
				"chordal",
			);

			// 使用ExtrudeGeometry沿曲线挤出
			const extrudeSettings = {
				steps: pathSegments,
				bevelEnabled: false,
				extrudePath: leftCurve,
			};

			const leftFrameGeometry = new THREE.ExtrudeGeometry(
				squareShape,
				extrudeSettings,
			);

			const rightExtrudeSettings = {
				...extrudeSettings,
				extrudePath: rightCurve,
			};
			const rightFrameGeometry = new THREE.ExtrudeGeometry(
				squareShape,
				rightExtrudeSettings,
			);

			return {
				frameGeometries: [leftFrameGeometry, rightFrameGeometry],
			};
		}, [curve, frameWidth, frameHeight, frameDepth, segments]);

		const defaultFrameMaterial = useMemo(() => {
			return new THREE.MeshStandardMaterial({
				color: 0x222222,
				roughness: 0.6,
				metalness: 0.3,
			});
		}, []);

		// 创建路径可视化曲面
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

		const defaultPathMaterial = useMemo(() => {
			return new THREE.MeshStandardMaterial({
				color: 0x333333,
				roughness: 0.8,
				metalness: 0.1,
				transparent: true,
				opacity: 0.6,
				side: THREE.DoubleSide,
			});
		}, []);

		// 设置滚筒位置
		useEffect(() => {
			if (instancedMeshRef.current) {
				const matrices = rollerPositions.map(({ matrix }) => matrix);
				instancedMeshRef.current.setMatrices(matrices);
				instancedMeshRef.current.setInstanceCount(rollerPositions.length);
				instancedMeshRef.current.updateMatrices();
			}
		}, [rollerPositions]);

		// 暴露API
		useEffect(() => {
			if (ref && typeof ref === "object") {
				ref.current = {
					getFrameLength: () => totalLength,
					getRollerCount: () => rollerPositions.length,
				};
			}
		}, [ref, totalLength, rollerPositions.length]);

		return (
			<group>
				{/* 滚筒 */}
				<InstancedMeshPool
					ref={instancedMeshRef}
					geometry={rollerGeometry}
					material={rollerMaterial || defaultRollerMaterial}
					maxInstances={rollerPositions.length}
					batchSize={1000}
					enableColors={false}
					frustumCulled={true}
				/>

				{/* 框架 - 使用ExtrudeGeometry沿曲线生成 */}
				{frameGeometries.map((geometry, index) => (
					<mesh
						key={`beam-${index}-${rollerPositions.length}`}
						geometry={geometry}
						material={frameMaterial || defaultFrameMaterial}
					/>
				))}

				{/* 路径可视化曲面 */}
				{showPath && pathGeometry && (
					<mesh
						geometry={pathGeometry}
						material={pathMaterial || defaultPathMaterial}
					/>
				)}
			</group>
		);
	},
);
