import { OrbitControls, Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import {
	CrossTransferTable,
	DevicePluginRegistry,
	DeviceRuntime,
	MaterialFlow,
	makePose,
	SegmentPluginRegistry,
	TrackGraph,
	TrackRenderer,
} from "../src";

function createFactoryGraph(): TrackGraph {
	const graph = new TrackGraph();
	graph.addDevice({
		id: "infeed",
		kind: "roller-conveyor",
		name: "Infeed conveyor",
	});
	graph.addDevice({
		id: "outfeed",
		kind: "roller-conveyor",
		name: "Direct outfeed conveyor",
	});
	graph.addDevice({
		id: "cross-transfer",
		kind: "cross-transfer-table",
		name: "Cross transfer table",
	});
	graph.addDevice({
		id: "sorter",
		kind: "sorter",
		name: "Diverted sorter conveyor",
	});
	graph.addDevice({
		id: "spiral-lift",
		kind: "spiral-lift",
		name: "Spiral lift",
	});

	graph.addNode({
		id: "infeed-start",
		pose: makePose(new THREE.Vector3(-6, 0, 0), new THREE.Vector3(-5, 0, 0)),
	});
	graph.addNode({
		id: "cross-west-port",
		pose: makePose(new THREE.Vector3(-0.8, 0, 0), new THREE.Vector3(0, 0, 0)),
		handoff: { fromDeviceId: "infeed", toDeviceId: "cross-transfer" },
	});
	graph.addNode({
		id: "cross-east-port",
		pose: makePose(new THREE.Vector3(0.8, 0, 0), new THREE.Vector3(1.8, 0, 0)),
		handoff: { fromDeviceId: "cross-transfer", toDeviceId: "outfeed" },
	});
	graph.addNode({
		id: "cross-north-port",
		pose: makePose(new THREE.Vector3(0, 0, 0.8), new THREE.Vector3(0, 0, 1.8)),
		handoff: { fromDeviceId: "cross-transfer", toDeviceId: "sorter" },
	});
	graph.addNode({
		id: "outfeed-exit",
		pose: makePose(new THREE.Vector3(6, 0, 0), new THREE.Vector3(7, 0, 0)),
	});
	graph.addNode({
		id: "sorter-exit",
		pose: makePose(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 6)),
	});
	graph.addNode({
		id: "helix-start",
		pose: makePose(new THREE.Vector3(-3, 0, -4), new THREE.Vector3(-2, 0, -4)),
	});
	graph.addNode({
		id: "helix-end",
		pose: makePose(new THREE.Vector3(-3, 3, -4), new THREE.Vector3(-2, 3, -4)),
	});

	graph.addEdge({
		id: "infeed-run",
		from: "infeed-start",
		to: "cross-west-port",
		kind: "faulty-roller-extension",
		params: {},
		deviceId: "infeed",
		layer: 0,
	});
	graph.addEdge({
		id: "cross-through-internal",
		from: "cross-west-port",
		to: "cross-east-port",
		kind: "straight",
		params: {},
		deviceId: "cross-transfer",
		layer: 0,
		visible: false,
	});
	graph.addEdge({
		id: "cross-divert-internal",
		from: "cross-west-port",
		to: "cross-north-port",
		kind: "curve",
		params: { radius: 0.5 },
		deviceId: "cross-transfer",
		layer: 0,
		visible: false,
	});
	graph.addEdge({
		id: "outfeed-run",
		from: "cross-east-port",
		to: "outfeed-exit",
		kind: "straight",
		params: {},
		deviceId: "outfeed",
		layer: 0,
	});
	graph.addEdge({
		id: "sorter-run",
		from: "cross-north-port",
		to: "sorter-exit",
		kind: "straight",
		params: {},
		deviceId: "sorter",
		layer: 0,
	});
	graph.addEdge({
		id: "spiral",
		from: "helix-start",
		to: "helix-end",
		kind: "helix",
		params: { radius: 1.4, turns: 2, height: 3 },
		deviceId: "spiral-lift",
		layer: 0,
	});
	return graph;
}

function FactoryScene({
	visibleDeviceIds,
	onInfeedPluginDegraded,
	showPath,
	showRollers,
}: {
	visibleDeviceIds: string[];
	onInfeedPluginDegraded: () => void;
	showPath: boolean;
	showRollers: boolean;
}) {
	const graph = useMemo(createFactoryGraph, []);
	const devicePlugins = useMemo(() => new DevicePluginRegistry(), []);
	const runtime = useMemo(
		() => new DeviceRuntime(graph, devicePlugins),
		[devicePlugins, graph],
	);
	const throughItems = useMemo(
		() =>
			Array.from({ length: 5 }, (_, index) => ({
				id: `through-carton-${index}`,
				type: "direct-carton",
				startNodeId: "infeed-start",
				endNodeId: "outfeed-exit",
				speed: 0.72 + index * 0.025,
			})),
		[],
	);
	const divertedItems = useMemo(
		() =>
			Array.from({ length: 3 }, (_, index) => ({
				id: `diverted-carton-${index}`,
				type: "diverted-carton",
				startNodeId: "infeed-start",
				endNodeId: "sorter-exit",
				speed: 0.64 + index * 0.025,
			})),
		[],
	);
	const throughMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0x2e9ccb }),
		[],
	);
	const divertedMaterial = useMemo(
		() => new THREE.MeshStandardMaterial({ color: 0xf06d3c }),
		[],
	);
	const segmentPlugins = useMemo(() => {
		const registry = new SegmentPluginRegistry({
			onPluginDegraded: ({ deviceId, error }) => {
				console.warn(`Segment plugin degraded for device "${deviceId}"`, error);
			},
		});
		registry.register({
			kind: "faulty-roller-extension",
			generateGeometry: () => {
				throw new Error("Intentional demo plugin failure");
			},
		});
		return registry;
	}, []);

	useEffect(() => {
		if (segmentPlugins.isDegraded("infeed")) onInfeedPluginDegraded();
	}, [onInfeedPluginDegraded, segmentPlugins]);

	return (
		<>
			<ambientLight intensity={0.5} />
			<directionalLight position={[5, 8, 5]} intensity={1.2} />
			<TrackRenderer
				graph={graph}
				visibleDeviceIds={visibleDeviceIds}
				segmentPlugins={segmentPlugins}
				rollerSpacing={0.18}
				frameWidth={0.7}
				frameHeight={0.2}
				frameDepth={0.1}
				showPath={showPath}
				showRollers={showRollers}
			/>
			<MaterialFlow
				graph={graph}
				runtime={runtime}
				items={throughItems}
				material={throughMaterial}
				tickRuntime={false}
			/>
			<MaterialFlow
				graph={graph}
				runtime={runtime}
				items={divertedItems}
				material={divertedMaterial}
				tickRuntime={false}
			/>
			{visibleDeviceIds.includes("cross-transfer") && (
				<CrossTransferTable position={[0, 0, 0]} />
			)}
			<gridHelper args={[18, 18, 0x45616d, 0x27343b]} position={[0, -0.1, 0]} />
			<OrbitControls />
			<Stats />
		</>
	);
}

export function FactoryLayoutExample() {
	const deviceIds = [
		"infeed",
		"cross-transfer",
		"outfeed",
		"sorter",
		"spiral-lift",
	];
	const [visibleDeviceIds, setVisibleDeviceIds] = useState(deviceIds);
	const [infeedPluginDegraded, setInfeedPluginDegraded] = useState(false);
	const [showPath, setShowPath] = useState(true);
	const [showRollers, setShowRollers] = useState(true);
	const markInfeedPluginDegraded = useCallback(() => {
		setInfeedPluginDegraded(true);
	}, []);

	const toggleDevice = (deviceId: string) => {
		setVisibleDeviceIds((current) =>
			current.includes(deviceId)
				? current.filter((id) => id !== deviceId)
				: [...current, deviceId],
		);
	};

	return (
		<div style={{ width: "100vw", height: "100vh", background: "#e7e3d7" }}>
			<div
				style={{
					position: "absolute",
					zIndex: 1,
					top: 24,
					right: 24,
					width: 260,
					padding: 18,
					borderRadius: 16,
					background: "#fffdf5",
					boxShadow: "0 8px 24px rgba(43, 47, 41, 0.18)",
					fontFamily: "system-ui, sans-serif",
				}}
			>
				<strong>Factory Route Builder</strong>
				<p style={{ fontSize: 13 }}>
					同一水平面十字交叉：中央转运台填补交叉区。货物可直通 east outfeed，
					或由转运台换路到 north
					sorter；蓝色货箱直通、橙色货箱换路。两条内部路线都由显式 handoff
					和设备状态控制。
				</p>
				<p
					style={{
						borderRadius: 8,
						background: infeedPluginDegraded ? "#f7ded4" : "#e4f0e5",
						padding: 8,
						fontSize: 12,
					}}
				>
					进料设备扩展：
					{infeedPluginDegraded
						? "已降级为基础直线段（故意异常的演示插件）"
						: "加载中"}
				</p>
				<label style={{ display: "block", margin: "8px 0", fontSize: 13 }}>
					<input
						type="checkbox"
						checked={showPath}
						onChange={(event) => setShowPath(event.target.checked)}
					/>{" "}
					show path
				</label>
				<label style={{ display: "block", margin: "8px 0", fontSize: 13 }}>
					<input
						type="checkbox"
						checked={showRollers}
						onChange={(event) => setShowRollers(event.target.checked)}
					/>{" "}
					show rollers
				</label>
				{deviceIds.map((deviceId) => (
					<label
						key={deviceId}
						style={{ display: "block", margin: "8px 0", fontSize: 13 }}
					>
						<input
							type="checkbox"
							checked={visibleDeviceIds.includes(deviceId)}
							onChange={() => toggleDevice(deviceId)}
						/>{" "}
						{deviceId}
					</label>
				))}
			</div>
			<Canvas camera={{ position: [9, 7, 10], fov: 50 }}>
				<FactoryScene
					visibleDeviceIds={visibleDeviceIds}
					onInfeedPluginDegraded={markInfeedPluginDegraded}
					showPath={showPath}
					showRollers={showRollers}
				/>
			</Canvas>
		</div>
	);
}
