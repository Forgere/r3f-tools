import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { DeviceRuntime } from "../core/deviceRuntime";
import type { TrackGraph } from "../core/trackGraph";
import { type ResolvedTrackRoute, resolveTrackRoute } from "../core/trackRoute";
import type { MaterialReference } from "../core/types";
import {
	InstancedMeshPool,
	type InstancedMeshPoolRef,
} from "./InstanceMeshPool";

export interface MaterialFlowItem extends MaterialReference {
	startNodeId: string;
	endNodeId: string;
	/** World units per second before the owning device speed multiplier. */
	speed: number;
}

export interface MaterialFlowProps {
	graph: TrackGraph;
	runtime: DeviceRuntime;
	items: readonly MaterialFlowItem[];
	geometry?: THREE.BufferGeometry;
	material?: THREE.Material;
	/** Advances runtime device plugins once per rendered frame. */
	tickRuntime?: boolean;
}

interface MovingItem {
	item: MaterialFlowItem;
	route: ResolvedTrackRoute;
	segmentIndex: number;
	distanceOnSegment: number;
	completed: boolean;
}

/**
 * Moves instanced material across resolved graph routes.
 *
 * Device ownership controls the effective speed. At a device boundary the
 * item pauses until `DeviceRuntime.transfer()` succeeds, leaving other items
 * and geometrically crossing devices unaffected.
 */
export function MaterialFlow({
	graph,
	runtime,
	items,
	geometry,
	material,
	tickRuntime = true,
}: MaterialFlowProps) {
	const poolRef = useRef<InstancedMeshPoolRef>(null);
	const movingItems = useMemo<MovingItem[]>(
		() =>
			items.map((item) => ({
				item,
				route: resolveTrackRoute(graph, item.startNodeId, item.endNodeId),
				segmentIndex: 0,
				distanceOnSegment: 0,
				completed: false,
			})),
		[graph, items],
	);
	const movingItemsRef = useRef(movingItems);
	movingItemsRef.current = movingItems;

	const defaultGeometry = useMemo(
		() => new THREE.BoxGeometry(0.2, 0.16, 0.2),
		[],
	);
	const defaultMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0xf06d3c }),
		[],
	);
	const instanceGeometry = geometry ?? defaultGeometry;
	const instanceMaterial = material ?? defaultMaterial;

	useEffect(() => {
		const pool = poolRef.current;
		if (!pool) return;
		pool.setInstanceCount(movingItems.length);
	}, [movingItems.length]);

	useFrame((_, delta) => {
		if (tickRuntime) runtime.tick(delta);

		const pool = poolRef.current;
		if (!pool) return;

		movingItemsRef.current.forEach((movingItem, itemIndex) => {
			const segment = movingItem.route.segments[movingItem.segmentIndex];
			if (!segment) return;

			if (!movingItem.completed) {
				const deviceState = runtime.getState(segment.edge.deviceId);
				let remainingDistance =
					deviceState?.running && !deviceState.faulted
						? movingItem.item.speed * deviceState.speed * delta
						: 0;

				while (remainingDistance > 0 && !movingItem.completed) {
					const currentSegment =
						movingItem.route.segments[movingItem.segmentIndex];
					if (!currentSegment) {
						movingItem.completed = true;
						break;
					}

					const distanceToEnd =
						currentSegment.length - movingItem.distanceOnSegment;
					if (remainingDistance < distanceToEnd) {
						movingItem.distanceOnSegment += remainingDistance;
						break;
					}

					remainingDistance -= distanceToEnd;
					const nextSegment =
						movingItem.route.segments[movingItem.segmentIndex + 1];
					if (!nextSegment) {
						movingItem.distanceOnSegment = currentSegment.length;
						movingItem.completed = true;
						break;
					}

					if (nextSegment.edge.deviceId !== currentSegment.edge.deviceId) {
						const transfer = runtime.transfer(
							currentSegment.edge.to,
							movingItem.item,
						);
						if (!transfer.accepted) {
							movingItem.distanceOnSegment = currentSegment.length;
							break;
						}
					}

					movingItem.segmentIndex += 1;
					movingItem.distanceOnSegment = 0;
				}
			}

			const activeSegment = movingItem.route.segments[movingItem.segmentIndex];
			if (!activeSegment) return;
			const progress =
				activeSegment.length === 0
					? 0
					: movingItem.distanceOnSegment / activeSegment.length;
			const position = activeSegment.curve.getPointAt(progress);
			const tangent = activeSegment.curve.getTangentAt(progress);
			const rotation = new THREE.Quaternion().setFromUnitVectors(
				new THREE.Vector3(0, 0, 1),
				tangent.normalize(),
			);
			pool.setMatrixAt(
				itemIndex,
				new THREE.Matrix4().compose(
					position.add(new THREE.Vector3(0, 0.14, 0)),
					rotation,
					new THREE.Vector3(1, 1, 1),
				),
			);
		});
		pool.updateMatrices();
	});

	return (
		<InstancedMeshPool
			ref={poolRef}
			geometry={instanceGeometry}
			material={instanceMaterial}
			maxInstances={Math.max(1, items.length)}
			batchSize={1000}
			frustumCulled
		/>
	);
}
