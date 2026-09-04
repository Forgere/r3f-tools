import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { generateSegmentGeometry } from "../core/segmentCurves";
import type { SegmentPluginRegistry } from "../core/segmentPluginRegistry";
import type { TrackEdge, TrackGraph } from "../core/trackGraph";
import type { SegmentContext } from "../core/types";
import {
	InstancedMeshPool,
	type InstancedMeshPoolRef,
} from "./InstanceMeshPool";

export interface TrackRendererProps {
	/** Network topology and device ownership to render. */
	graph: TrackGraph;
	/** Limits rendering to the supplied device IDs without altering topology. */
	visibleDeviceIds?: readonly string[];
	/** Limits rendering to the supplied vertical/logical layers. */
	visibleLayers?: readonly number[];
	rollerSpacing?: number;
	frameWidth?: number;
	frameHeight?: number;
	frameDepth?: number;
	rollerRadius?: number;
	rollerLength?: number;
	rollerSegments?: number;
	rollerMaterial?: THREE.Material;
	frameMaterial?: THREE.Material;
	pathMaterial?: THREE.Material;
	/** Renders the editable ConveyorBelt-style side frames by default. */
	showFrames?: boolean;
	/** Renders roller instances. Defaults to true. */
	showRollers?: boolean;
	/** Renders path lines for all visible segments. */
	showPath?: boolean;
	/** @deprecated Use `showPath` for consistency with ConveyorBelt. */
	showPaths?: boolean;
	/**
	 * Custom segment geometry. A plugin failure falls back only the affected
	 * device to a straight segment, leaving crossing devices unaffected.
	 */
	segmentPlugins?: SegmentPluginRegistry;
}

interface RenderedEdge {
	edge: TrackEdge;
	curve: THREE.Curve<THREE.Vector3>;
	points: THREE.Vector3[];
}

/**
 * Renders all visible graph edges through one roller instance pool.
 *
 * The module intentionally batches by shared geometry/material, rather than
 * by device: device identity remains available in the graph for control and
 * plugin isolation, while rendering stays efficient for a factory layout
 * with many small segments.
 */
export function TrackRenderer({
	graph,
	visibleDeviceIds,
	visibleLayers,
	rollerSpacing = 0.15,
	frameWidth = 0.6,
	frameHeight = 0.18,
	frameDepth = 0.08,
	rollerRadius = 0.05,
	rollerLength = frameWidth,
	rollerSegments = 16,
	rollerMaterial,
	frameMaterial,
	pathMaterial,
	showFrames = true,
	showRollers = true,
	showPath,
	showPaths = false,
	segmentPlugins,
}: TrackRendererProps) {
	const instancedMeshRef = useRef<InstancedMeshPoolRef>(null);
	const shouldShowPath = showPath ?? showPaths;

	const renderedEdges = useMemo<RenderedEdge[]>(() => {
		const deviceFilter = visibleDeviceIds
			? new Set(visibleDeviceIds)
			: undefined;
		const layerFilter = visibleLayers ? new Set(visibleLayers) : undefined;

		return graph.edgeList.flatMap((edge) => {
			if (
				edge.visible === false ||
				(deviceFilter && !deviceFilter.has(edge.deviceId)) ||
				(layerFilter && !layerFilter.has(edge.layer))
			) {
				return [];
			}

			const start = graph.getNode(edge.from);
			const end = graph.getNode(edge.to);
			if (!start || !end) return [];

			const context: SegmentContext = {
				kind: edge.kind,
				start: start.pose,
				end: end.pose,
				params: edge.params,
			};
			const { curve } =
				segmentPlugins?.generate(edge.deviceId, context) ??
				generateSegmentGeometry(context);
			const resolution = edge.params.resolution ?? 64;
			return [{ edge, curve, points: curve.getPoints(resolution) }];
		});
	}, [graph, segmentPlugins, visibleDeviceIds, visibleLayers]);

	const rollerMatrices = useMemo(() => {
		const matrices: THREE.Matrix4[] = [];
		const up = new THREE.Vector3(0, 1, 0);
		const localAxis = new THREE.Vector3(0, 1, 0);

		for (const { curve } of renderedEdges) {
			const length = curve.getLength();
			const count = Math.max(1, Math.floor(length / rollerSpacing) + 1);

			for (let index = 0; index < count; index++) {
				const t = count === 1 ? 0 : index / (count - 1);
				const position = curve.getPointAt(t);
				const tangent = curve.getTangentAt(t);
				const axis = new THREE.Vector3().crossVectors(up, tangent);

				// A vertical tangent has no stable horizontal roller axis.
				// Preserve a deterministic fallback rather than emitting NaNs.
				if (axis.lengthSq() === 0) axis.set(1, 0, 0);
				axis.normalize();

				const rotation = new THREE.Quaternion().setFromUnitVectors(
					localAxis,
					axis,
				);
				matrices.push(new THREE.Matrix4().compose(position, rotation, up));
			}
		}
		return matrices;
	}, [renderedEdges, rollerSpacing]);

	const geometry = useMemo(
		() =>
			new THREE.CylinderGeometry(
				rollerRadius,
				rollerRadius,
				rollerLength,
				rollerSegments,
			),
		[rollerRadius, rollerLength, rollerSegments],
	);
	const frameGeometries = useMemo(() => {
		if (!showFrames) return [];

		const halfDepth = frameDepth / 2;
		const profile = new THREE.Shape()
			.moveTo(-halfDepth, -frameHeight / 2)
			.lineTo(halfDepth, -frameHeight / 2)
			.lineTo(halfDepth, frameHeight / 2)
			.lineTo(-halfDepth, frameHeight / 2)
			.closePath();
		const up = new THREE.Vector3(0, 1, 0);
		const halfWidth = frameWidth / 2;

		return renderedEdges.flatMap(({ edge, curve }) => {
			const resolution = edge.params.resolution ?? 64;
			const leftPoints: THREE.Vector3[] = [];
			const rightPoints: THREE.Vector3[] = [];

			for (let index = 0; index <= resolution; index++) {
				const t = index / resolution;
				const position = curve.getPointAt(t);
				const tangent = curve.getTangentAt(t);
				const right = new THREE.Vector3().crossVectors(tangent, up);
				if (right.lengthSq() === 0) right.set(1, 0, 0);
				right.normalize();
				leftPoints.push(position.clone().addScaledVector(right, -halfWidth));
				rightPoints.push(position.clone().addScaledVector(right, halfWidth));
			}

			const createFrame = (points: THREE.Vector3[]) =>
				new THREE.ExtrudeGeometry(profile, {
					steps: resolution,
					bevelEnabled: false,
					extrudePath: new THREE.CatmullRomCurve3(points, false, "chordal"),
				});

			return [
				{ id: `${edge.id}-frame-left`, geometry: createFrame(leftPoints) },
				{
					id: `${edge.id}-frame-right`,
					geometry: createFrame(rightPoints),
				},
			];
		});
	}, [frameDepth, frameHeight, frameWidth, renderedEdges, showFrames]);
	const defaultRollerMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x666666,
				roughness: 0.55,
				metalness: 0.35,
			}),
		[],
	);
	const defaultFrameMaterial = useMemo(
		() =>
			new THREE.MeshStandardMaterial({
				color: 0x222222,
				roughness: 0.6,
				metalness: 0.3,
			}),
		[],
	);
	const defaultPathMaterial = useMemo(
		() => new THREE.LineBasicMaterial({ color: 0x58a6a6 }),
		[],
	);

	useEffect(() => {
		if (!showRollers) return;
		const pool = instancedMeshRef.current;
		if (!pool) return;
		pool.setMatrices(rollerMatrices);
		pool.setInstanceCount(rollerMatrices.length);
		pool.updateMatrices();
	}, [rollerMatrices, showRollers]);

	return (
		<group>
			{showRollers && (
				<InstancedMeshPool
					ref={instancedMeshRef}
					geometry={geometry}
					material={rollerMaterial ?? defaultRollerMaterial}
					maxInstances={Math.max(1, rollerMatrices.length)}
					batchSize={1000}
					frustumCulled
				/>
			)}
			{frameGeometries.map(({ id, geometry: frameGeometry }) => (
				<mesh
					key={id}
					geometry={frameGeometry}
					material={frameMaterial ?? defaultFrameMaterial}
				/>
			))}
			{shouldShowPath &&
				renderedEdges.map(({ edge, points }) => (
					<line key={edge.id}>
						<bufferGeometry
							attach="geometry"
							onUpdate={(bufferGeometry) => {
								bufferGeometry.setFromPoints(points);
							}}
						/>
						<primitive
							object={pathMaterial ?? defaultPathMaterial}
							attach="material"
						/>
					</line>
				))}
		</group>
	);
}
