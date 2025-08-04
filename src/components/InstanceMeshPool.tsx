import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import * as THREE from "three";

const FarDistance = 10000;

export interface InstancedMeshPoolRef {
	getMatrixAt: (index: number, matrix: THREE.Matrix4) => THREE.Matrix4;
	setMatrixAt: (index: number, matrix: THREE.Matrix4) => void;
	getColorAt: (index: number, color: THREE.Color) => THREE.Color;
	setColorAt: (index: number, color: THREE.Color) => void;
	setMatrices: (matrices: THREE.Matrix4[], startIndex?: number) => void;
	setColors: (colors: THREE.Color[], startIndex?: number) => void;
	setInstanceCount: (count: number) => void;
	updateMatrices: () => void;
	updateColors: () => void;
	computeBoundingBox: () => void;
}

export type InstancedMeshPoolProps = {
	geometry: THREE.BufferGeometry;
	material: THREE.Material;
	batchSize?: number;
	maxInstances?: number;
	enableColors?: boolean;
	frustumCulled?: boolean;
	onClick?: (e: ThreeEvent<THREE.Event>, index: number) => void;
	onPointerOver?: (e: ThreeEvent<THREE.Event>, index: number) => void;
	onPointerOut?: (e: ThreeEvent<THREE.Event>, index: number) => void;
};

export const InstancedMeshPool = forwardRef<
	InstancedMeshPoolRef,
	InstancedMeshPoolProps
>(function InstancedMeshPool(
	{
		geometry,
		material,
		batchSize = 1000,
		maxInstances = 1000,
		enableColors = false,
		frustumCulled = false,
		onClick,
		onPointerOver,
		onPointerOut,
	}: InstancedMeshPoolProps,
	ref,
) {
	const meshGroups = useRef<THREE.InstancedMesh[]>([]);
	const batchSizeRef = useRef(batchSize);

	// 内部缓存状态 - 跟踪需要更新的批次
	const currentInstanceCount = useRef(0);
	const dirtyMatrixBatches = useRef<Set<number>>(new Set());
	const dirtyColorBatches = useRef<Set<number>>(new Set());

	// 检查是否需要计算边界框
	const shouldComputeBounds = useCallback(() => {
		return !!(onClick || onPointerOver || onPointerOut || frustumCulled);
	}, [onClick, onPointerOver, onPointerOut, frustumCulled]);

	// 封装的计算函数，处理dirty batches并清除
	const processUpdatesAndClearDirtyBatches = useCallback(() => {
		const needsBoundsUpdate = shouldComputeBounds();

		// 处理dirty的矩阵批次
		if (dirtyMatrixBatches.current.size > 0) {
			dirtyMatrixBatches.current.forEach((batchIndex) => {
				const mesh = meshGroups.current[batchIndex];
				if (mesh) {
					mesh.instanceMatrix.needsUpdate = true;

					// 只有在需要时才计算边界框
					if (needsBoundsUpdate) {
						mesh.boundingBox = null;
						mesh.boundingSphere = null;
						mesh.computeBoundingBox();
						mesh.computeBoundingSphere();
					}
				}
			});
			dirtyMatrixBatches.current.clear();
		}

		// 处理dirty的颜色批次
		if (dirtyColorBatches.current.size > 0) {
			dirtyColorBatches.current.forEach((batchIndex) => {
				const mesh = meshGroups.current[batchIndex];
				if (mesh?.instanceColor) {
					mesh.instanceColor.needsUpdate = true;
				}
			});
			dirtyColorBatches.current.clear();
		}
	}, [shouldComputeBounds]);

	useImperativeHandle(
		ref,
		() => ({
			getMatrixAt: (index: number, matrix: THREE.Matrix4) => {
				const groupIndex = Math.floor(index / batchSizeRef.current);
				const instanceIndex = index % batchSizeRef.current;
				const mesh = meshGroups.current[groupIndex];
				if (mesh) {
					mesh.getMatrixAt(instanceIndex, matrix);
				}
				return matrix
			},
			setMatrixAt: (index: number, matrix: THREE.Matrix4) => {
				const groupIndex = Math.floor(index / batchSizeRef.current);
				const instanceIndex = index % batchSizeRef.current;
				const mesh = meshGroups.current[groupIndex];
				if (mesh) {
					mesh.setMatrixAt(instanceIndex, matrix);
					dirtyMatrixBatches.current.add(groupIndex);
				}
			},
			getColorAt: (index: number, color: THREE.Color) => {
				const groupIndex = Math.floor(index / batchSizeRef.current);
				const instanceIndex = index % batchSizeRef.current;
				const mesh = meshGroups.current[groupIndex];
				if (mesh?.instanceColor) {
					mesh.getColorAt(instanceIndex, color);
				}
				return color
			},
			setColorAt: (index: number, color: THREE.Color) => {
				const groupIndex = Math.floor(index / batchSizeRef.current);
				const instanceIndex = index % batchSizeRef.current;
				const mesh = meshGroups.current[groupIndex];
				if (mesh?.instanceColor) {
					mesh.setColorAt(instanceIndex, color);
					dirtyColorBatches.current.add(groupIndex);
				}
			},
			setMatrices: (matrices: THREE.Matrix4[], startIndex = 0) => {
				const affectedBatches = new Set<number>();

				matrices.forEach((matrix, i) => {
					const index = startIndex + i;
					const groupIndex = Math.floor(index / batchSizeRef.current);
					const instanceIndex = index % batchSizeRef.current;
					const mesh = meshGroups.current[groupIndex];
					if (mesh) {
						mesh.setMatrixAt(instanceIndex, matrix);
						affectedBatches.add(groupIndex);
					}
				});

				// 标记受影响的批次为dirty
				affectedBatches.forEach((batchIndex) => {
					dirtyMatrixBatches.current.add(batchIndex);
				});
			},
			setColors: (colors: THREE.Color[], startIndex = 0) => {
				const affectedBatches = new Set<number>();

				colors.forEach((color, i) => {
					const index = startIndex + i;
					const groupIndex = Math.floor(index / batchSizeRef.current);
					const instanceIndex = index % batchSizeRef.current;
					const mesh = meshGroups.current[groupIndex];
					if (mesh?.instanceColor) {
						mesh.setColorAt(instanceIndex, color);
						affectedBatches.add(groupIndex);
					}
				});

				// 标记受影响的批次为dirty
				affectedBatches.forEach((batchIndex) => {
					dirtyColorBatches.current.add(batchIndex);
				});
			},
			setInstanceCount: (count: number) => {
				currentInstanceCount.current = count;
				let offset = 0;
				for (let g = 0; g < meshGroups.current.length; g++) {
					const group = meshGroups.current[g];
					if (group) {
						const groupCount = Math.min(count - offset, batchSizeRef.current);
						group.count = Math.max(0, groupCount);
						offset += batchSizeRef.current;
					}
				}
			},
			updateMatrices: () => {
				processUpdatesAndClearDirtyBatches();
			},
			updateColors: () => {
				processUpdatesAndClearDirtyBatches();
			},
			computeBoundingBox: () => {
				meshGroups.current.forEach((mesh) => {
					mesh.boundingBox = null;
					mesh.boundingSphere = null;
					mesh.computeBoundingBox();
					mesh.computeBoundingSphere();
				});
			},
		}),
		[processUpdatesAndClearDirtyBatches],
	);

	// 更新 batchSizeRef
	batchSizeRef.current = batchSize;

	const neededGroups = Math.ceil(maxInstances / batchSize);

	// 确保 meshGroups 数组有足够的 InstancedMesh 实例
	while (meshGroups.current.length < neededGroups) {
		const mesh = new THREE.InstancedMesh(geometry, material, batchSize);
		mesh.frustumCulled = frustumCulled;

		// 关键修复：禁用自动边界框计算，因为我们会手动更新
		mesh.boundingBox = null;
		mesh.boundingSphere = null;

		// 初始化所有实例的矩阵到远距离位置
		const tempMatrix = new THREE.Matrix4();
		for (let i = 0; i < batchSize; i++) {
			tempMatrix.makeTranslation(0, FarDistance + i, 0);
			mesh.setMatrixAt(i, tempMatrix);
		}
		mesh.instanceMatrix.needsUpdate = true;

		if (enableColors) {
			const colorArray = new Float32Array(batchSize * 3);
			mesh.instanceColor = new THREE.InstancedBufferAttribute(colorArray, 3);
		}

		mesh.count = 0;
		meshGroups.current.push(mesh);
	}

	// 清理多余组
	while (meshGroups.current.length > neededGroups) {
		const toRemove = meshGroups.current.pop();
		toRemove?.parent?.remove(toRemove);
	}

	// 缓存事件处理函数避免重新创建
	const handleClick = useCallback(
		(offset: number) => {
			return (e: ThreeEvent<THREE.Event>) => {
				if (e.instanceId !== undefined && onClick) {
					const index = offset + e.instanceId;
					onClick(e, index);
				}
			};
		},
		[onClick],
	);

	const handlePointerOver = useCallback(
		(offset: number) => {
			return (e: ThreeEvent<THREE.Event>) => {
				if (e.instanceId !== undefined && onPointerOver) {
					const index = offset + e.instanceId;
					onPointerOver(e, index);
				}
			};
		},
		[onPointerOver],
	);

	const handlePointerOut = useCallback(
		(offset: number) => {
			return (e: ThreeEvent<THREE.Event>) => {
				if (e.instanceId !== undefined && onPointerOut) {
					const index = offset + e.instanceId;
					onPointerOut(e, index);
				}
			};
		},
		[onPointerOut],
	);

	// 使用useFrame自动处理dirty batches，避免大数据量时卡死
	useFrame(() => {
		processUpdatesAndClearDirtyBatches();
	});

	return (
		<>
			{meshGroups.current.map((mesh, groupIndex) => {
				const offset = groupIndex * batchSize;
				return (
					// biome-ignore lint/a11y/noStaticElementInteractions: <keep it>
					<primitive
						key={mesh.uuid}
						object={mesh}
						onClick={handleClick(offset)}
						onPointerOver={handlePointerOver(offset)}
						onPointerOut={handlePointerOut(offset)}
					/>
				);
			})}
		</>
	);
});
