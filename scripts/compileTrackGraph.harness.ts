/**
 * Headless verification of the TrackGraph → FactoryLayout compiler (§16.3):
 * a design-time graph (devices, nodes, hand-offs, segment kinds) compiles to
 * a runnable layout, and the end-to-end path works — items spawned into the
 * compiled world cross a device hand-off and reach the sink.
 *
 * Run via: tsc --project tsconfig.harness.json && node dist-harness/scripts/compileTrackGraph.harness.js
 */
import * as THREE from "three";
import { compileTrackGraph } from "../src/core/compileTrackGraph";
import { makePose, TrackGraph } from "../src/core/trackGraph";
import { createSimFromLayout } from "../src/sim/layout";
import type { TransportDef } from "../src/sim/types";

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string): void {
	if (cond) {
		passed++;
		console.log("  ok   - " + msg);
	} else {
		failed++;
		console.log("  FAIL - " + msg);
	}
}
function v(x: number, y: number, z: number): THREE.Vector3 {
	return new THREE.Vector3(x, y, z);
}

console.log("happy path: source → infeed ⇢ trunk → sink (with a curve segment)");
{
	const graph = new TrackGraph();
	graph.addDevice({
		id: "rack",
		kind: "rack",
		config: {
			simKind: "source",
			output: "infeed",
			interval: 0.5,
			itemTypes: [{ typeId: "parcel", colorIndex: 0 }],
		},
	});
	graph.addDevice({ id: "infeed", kind: "roller-conveyor", config: { speed: 2 } });
	graph.addDevice({ id: "trunk", kind: "roller-conveyor", config: { speed: 1.5 } });
	graph.addDevice({ id: "pack", kind: "sink" });

	graph.addNode({ id: "n0", pose: makePose(v(0, 0.7, 0), v(1, 0.7, 0)) });
	graph.addNode({ id: "n1", pose: makePose(v(4, 0.7, 0), v(4, 0.7, 1)) });
	graph.addNode({
		id: "handoff",
		pose: makePose(v(4, 0.7, 4), v(5, 0.7, 4)),
		handoff: { fromDeviceId: "infeed", toDeviceId: "trunk" },
	});
	graph.addNode({
		id: "n3",
		pose: makePose(v(8, 0.7, 4), v(9, 0.7, 4)),
		handoff: { fromDeviceId: "trunk", toDeviceId: "pack" },
	});

	// infeed: straight + 90° curve, then hands off to trunk at "handoff".
	graph.addEdge({ id: "e0", from: "n0", to: "n1", kind: "straight", params: {}, deviceId: "infeed", layer: 0 });
	graph.addEdge({
		id: "e1",
		from: "n1",
		to: "handoff",
		kind: "curve",
		params: { radius: 2 },
		deviceId: "infeed",
		layer: 0,
	});
	graph.addEdge({ id: "e2", from: "handoff", to: "n3", kind: "straight", params: {}, deviceId: "trunk", layer: 0 });

	const { layout, issues, layoutIssues } = compileTrackGraph(graph, { name: "compiled-demo" });
	ok(issues.filter((i) => i.severity === "error").length === 0, "no compile errors");
	ok(layoutIssues.filter((i) => i.severity === "error").length === 0, "layout schema validates clean");
	ok(layout.name === "compiled-demo", "layout carries the name");

	const infeed = layout.devices.find((d) => d.id === "infeed") as TransportDef;
	const trunk = layout.devices.find((d) => d.id === "trunk") as TransportDef;
	ok(infeed?.kind === "transport" && infeed.next === "trunk", "infeed.next wired through the hand-off");
	ok(trunk?.kind === "transport" && trunk.next === "pack", "trunk.next → pack sink");
	ok(infeed.cornerRadius === 0, "compiled transport pins cornerRadius 0 (geometry pre-resolved)");
	ok(infeed.points.length > 10, `curve segment sampled into many points (${infeed.points.length})`);
	ok(
		infeed.points.some((p) => p.z > 0.5 && p.x > 3.5),
		"sampled points actually follow the curve (not just endpoints)",
	);
	ok(layout.devices.some((d) => d.id === "rack" && d.kind === "source"), "edgeless config source compiled");
	ok(layout.devices.some((d) => d.id === "pack" && d.kind === "sink"), "kind-based sink compiled");

	// End-to-end: the compiled layout runs and material crosses the hand-off.
	const sim = createSimFromLayout(layout, { seed: 7 });
	for (let i = 0; i < 1200; i++) sim.tick(1 / 60);
	const stats = sim.getStats();
	ok((stats.throughput.pack ?? 0) > 0, `items reached the compiled sink (${stats.throughput.pack})`);
	ok(
		sim.getRecentEvents(10000).some((e) => e.type === "item:transferred"),
		"item:transferred events recorded across the hand-off",
	);
}

console.log("dead-end chain synthesizes a sink");
{
	const graph = new TrackGraph();
	graph.addDevice({ id: "loose", kind: "roller-conveyor" });
	graph.addNode({ id: "a", pose: makePose(v(0, 0, 0), v(1, 0, 0)) });
	graph.addNode({ id: "b", pose: makePose(v(3, 0, 0), v(4, 0, 0)) });
	graph.addEdge({ id: "e", from: "a", to: "b", kind: "straight", params: {}, deviceId: "loose", layer: 0 });

	const { layout, issues } = compileTrackGraph(graph);
	ok(
		issues.some((i) => i.code === "dead-end" && i.severity === "warning"),
		"dead-end reported as warning",
	);
	ok(
		layout.devices.some((d) => d.id === "loose__end" && d.kind === "sink"),
		"synthesized loose__end sink keeps the world closed",
	);
	const strict = compileTrackGraph(graph, { onDeadEnd: "error" });
	ok(
		strict.issues.some((i) => i.code === "dead-end" && i.severity === "error"),
		'onDeadEnd: "error" escalates the issue',
	);
}

console.log("branching device is rejected with a structured issue");
{
	const graph = new TrackGraph();
	graph.addDevice({ id: "fork", kind: "roller-conveyor" });
	graph.addNode({ id: "a", pose: makePose(v(0, 0, 0), v(1, 0, 0)) });
	graph.addNode({ id: "b", pose: makePose(v(2, 0, 0), v(3, 0, 0)) });
	graph.addNode({ id: "c", pose: makePose(v(2, 0, 2), v(3, 0, 2)) });
	graph.addEdge({ id: "e0", from: "a", to: "b", kind: "straight", params: {}, deviceId: "fork", layer: 0 });
	graph.addEdge({ id: "e1", from: "a", to: "c", kind: "straight", params: {}, deviceId: "fork", layer: 0 });

	const { layout, issues } = compileTrackGraph(graph);
	ok(
		issues.some((i) => i.code === "branching-device" && i.deviceId === "fork"),
		"branching device produces a branching-device error",
	);
	ok(
		!layout.devices.some((d) => d.id === "fork"),
		"branching device is not emitted into the layout",
	);
}

console.log("mid-path hand-off warns");
{
	const graph = new TrackGraph();
	graph.addDevice({ id: "side", kind: "roller-conveyor" });
	graph.addDevice({ id: "main", kind: "roller-conveyor" });
	graph.addNode({ id: "s0", pose: makePose(v(0, 0, 5), v(1, 0, 5)) });
	graph.addNode({
		id: "mid",
		pose: makePose(v(5, 0, 0), v(6, 0, 0)),
		handoff: { fromDeviceId: "side", toDeviceId: "main" },
	});
	graph.addNode({ id: "m0", pose: makePose(v(0, 0, 0), v(1, 0, 0)) });
	graph.addNode({ id: "m1", pose: makePose(v(10, 0, 0), v(11, 0, 0)) });
	graph.addEdge({ id: "se", from: "s0", to: "mid", kind: "straight", params: {}, deviceId: "side", layer: 0 });
	graph.addEdge({ id: "me0", from: "m0", to: "mid", kind: "straight", params: {}, deviceId: "main", layer: 0 });
	graph.addEdge({ id: "me1", from: "mid", to: "m1", kind: "straight", params: {}, deviceId: "main", layer: 0 });

	const { issues } = compileTrackGraph(graph);
	ok(
		issues.some((i) => i.code === "mid-path-handoff" && i.deviceId === "side"),
		"merging into the middle of the receiver warns (items appear at path start)",
	);
}

console.log("edgeless junction from config");
{
	const graph = new TrackGraph();
	graph.addDevice({ id: "belt", kind: "roller-conveyor" });
	graph.addDevice({
		id: "divert",
		kind: "transfer-table",
		config: {
			simKind: "junction",
			position: [4, 0.7, 0],
			dwell: 0.3,
			routes: { parcel: "lane-a", crate: "lane-b" },
		},
	});
	graph.addNode({ id: "a", pose: makePose(v(0, 0.7, 0), v(1, 0.7, 0)) });
	graph.addNode({
		id: "b",
		pose: makePose(v(4, 0.7, 0), v(5, 0.7, 0)),
		handoff: { fromDeviceId: "belt", toDeviceId: "divert" },
	});
	graph.addEdge({ id: "e", from: "a", to: "b", kind: "straight", params: {}, deviceId: "belt", layer: 0 });

	const { layout, issues } = compileTrackGraph(graph);
	const divert = layout.devices.find((d) => d.id === "divert");
	ok(divert?.kind === "junction", "edgeless junction compiled from config.simKind");
	ok(
		(issues ?? []).filter((i) => i.severity === "error").length === 0,
		"junction compile produced no errors",
	);
	// routes reference lane-a/lane-b which exist nowhere → warnings, not errors.
	const { layoutIssues } = compileTrackGraph(graph);
	ok(
		layoutIssues.filter((i) => i.severity === "error").length === 0 &&
			layoutIssues.some((i) => i.code === "unknown-ref"),
		"dangling route targets stay warnings (external-only devices remain valid)",
	);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
