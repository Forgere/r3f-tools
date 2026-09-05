/**
 * Headless verification of the 4-case external-data contract (§14).
 * Run via: tsc --project tsconfig.harness.json && node dist-harness/scripts/externalSignals.harness.js
 *
 * Covers: pose(world) / pose(local→world transform) / progress / entry / span,
 * plus the external→sim hand-back (item reaching path end is consumed downstream).
 */
import { FactorySim } from "../src/sim/FactorySim";
import type {
	ExternalDeviceFrame,
	ExternalItemState,
	SimDeviceDef,
	SinkDef,
	TransportDef,
} from "../src/sim/types";

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
function near(a: number, b: number, eps = 1e-3): boolean {
	return Math.abs(a - b) <= eps;
}

function buildWorld(): SimDeviceDef[] {
	const line: TransportDef = {
		id: "line",
		kind: "transport",
		points: [
			{ x: 0, y: 0, z: 0 },
			{ x: 10, y: 0, z: 0 },
		],
		speed: 1,
		next: "out",
	};
	const out: TransportDef = {
		id: "out",
		kind: "transport",
		points: [
			{ x: 10, y: 0, z: 0 },
			{ x: 12, y: 0, z: 0 },
		],
		speed: 1,
		next: "sink",
	};
	const sink: SinkDef = { id: "sink", kind: "sink" };
	return [line, out, sink];
}

function poseSt(id: number, x: number, y: number, z: number, h: number, frame?: "world" | "local"): ExternalItemState {
	const st: ExternalItemState = { itemId: id, typeId: "t", colorIndex: 0, x, y, z, heading: h };
	if (frame) st.signal = { kind: "pose", frame, x, y, z, heading: h };
	return st;
}
function progressSt(id: number, p: number): ExternalItemState {
	return { itemId: id, typeId: "t", colorIndex: 0, x: 0, y: 0, z: 0, heading: 0, signal: { kind: "progress", progress: p } };
}
function entrySt(id: number, t: number): ExternalItemState {
	return { itemId: id, typeId: "t", colorIndex: 0, x: 0, y: 0, z: 0, heading: 0, signal: { kind: "entry", tEnter: t } };
}
function spanSt(id: number, t0: number, t1: number): ExternalItemState {
	return { itemId: id, typeId: "t", colorIndex: 0, x: 0, y: 0, z: 0, heading: 0, signal: { kind: "span", tEnter: t0, tExit: t1 } };
}

function poseOf(last: ReturnType<FactorySim["tick"]>, id: number) {
	return last.moved.find((m) => m.itemId === id);
}

// ---- Test 1: pose (world) — default contract, no explicit setDeviceDataSource ----
{
	console.log("Test 1: pose world (default contract)");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	const frame: ExternalDeviceFrame = { deviceId: "line", items: [poseSt(1, 5, 0, 0, 0)] };
	sim.ingestExternalFrame([frame]);
	const last = sim.tick(1);
	const p = poseOf(last, 1);
	ok(!!p, "item spawned + moved");
	ok(!!p && near(p.x, 5) && near(p.y, 0) && near(p.z, 0), "world pose x=5,y=0,z=0");
	ok(!!p && near(p.heading, 0), "heading=0");
}

// ---- Test 2: pose (device-local → world transform) ----
{
	console.log("Test 2: pose device-local → world transform");
	// line path runs +x, so device yaw = atan2(10,0) = PI/2.
	// local(2,0,3) → world = origin + right*2 + forward*3, right=(0,0,-1), forward=(1,0,0) ⇒ (3,0,-2).
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.setDeviceDataSource("line", "external", { signal: "pose", frame: "local" });
	const frame: ExternalDeviceFrame = { deviceId: "line", items: [poseSt(1, 2, 0, 3, 0, "local")] };
	sim.ingestExternalFrame([frame]);
	const last = sim.tick(1);
	const p = poseOf(last, 1);
	ok(!!p && near(p.x, 3) && near(p.y, 0) && near(p.z, -2), "local(2,0,3) → world(3,0,-2)");
	ok(!!p && near(p.heading, Math.PI / 2), "world heading = PI/2");
}

// ---- Test 3: progress 0.5 → distance = 5 along +x path ----
{
	console.log("Test 3: progress 0.5");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.setDeviceDataSource("line", "external", { signal: "progress" });
	const frame: ExternalDeviceFrame = { deviceId: "line", items: [progressSt(1, 0.5)] };
	for (let i = 0; i < 2; i++) sim.ingestExternalFrame([frame]);
	const last = sim.tick(1);
	const p = poseOf(last, 1);
	ok(!!p && near(p.x, 5) && near(p.y, 0) && near(p.z, 0), "progress 0.5 → x=5");
	ok(!!p && near(p.heading, Math.PI / 2), "heading follows path tangent (PI/2)");
}

// ---- Test 4: entry — sim drives distance via speed×dt from tEnter ----
// NOTE: tick() clamps dt to 0.25s for stability, so time = ticks × 0.25.
{
	console.log("Test 4: entry (speed×dt)");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.setDeviceDataSource("line", "external", { signal: "entry" });
	const frame: ExternalDeviceFrame = { deviceId: "line", items: [entrySt(1, 0)] };
	for (let i = 0; i < 16; i++) {
		sim.ingestExternalFrame([frame]); // feed each tick (item still on device)
		sim.tick(1);
	}
	const last = sim.tick(1); // time = 17 × 0.25 = 4.25 → x ≈ 4.25
	const p = poseOf(last, 1);
	ok(!!p && near(p.x, 4.25), `entry tEnter=0, speed=1, time=4.25 → x=4.25 (got ${p ? p.x.toFixed(3) : "none"})`);
}

// ---- Test 5: span — linear interp over [tEnter,tExit] ----
{
	console.log("Test 5: span [0,4]");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.setDeviceDataSource("line", "external", { signal: "span" });
	const frame: ExternalDeviceFrame = { deviceId: "line", items: [spanSt(1, 0, 4)] };
	for (let i = 0; i < 12; i++) {
		sim.ingestExternalFrame([frame]);
		sim.tick(1);
	}
	const last = sim.tick(1); // time = 13 × 0.25 = 3.25 → u = 3.25/4 = 0.8125 → x = 8.125
	const p = poseOf(last, 1);
	ok(!!p && near(p.x, 8.125), `span u=0.8125 → x=8.125 (got ${p ? p.x.toFixed(3) : "none"})`);
}

// ---- Test 6: external→sim hand-back (item reaches path end → consumed downstream) ----
{
	console.log("Test 6: progress=1 → hand off → consumed by sim sink");
	const sim = new FactorySim(buildWorld(), { worldMode: "hybrid" });
	sim.setDeviceDataSource("line", "external", { signal: "progress" });
	// Feed once at progress=1 (realistic: external stops reporting after exit).
	sim.ingestExternalFrame([{ deviceId: "line", items: [progressSt(1, 1)] }]);
	for (let i = 0; i < 15; i++) sim.tick(1); // tick1 hands off to sim "out"; rest traverse + consume
	ok(sim.totalConsumed >= 1, `item handed to sim and consumed (totalConsumed=${sim.totalConsumed})`);
}

// ---- Test 7/8: pose via SIGNAL field only (no flat x/y/z) — the example's path ----
function poseSignalOnlySt(
	id: number,
	frame: "world" | "local",
	x: number,
	y: number,
	z: number,
	h: number,
): ExternalItemState {
	// Intentionally omits the flat x/y/z/heading fields.
	return { itemId: id, typeId: "t", colorIndex: 0, signal: { kind: "pose", frame, x, y, z, heading: h } };
}
{
	console.log("Test 7: pose world via signal only (no flat coords)");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.ingestExternalFrame([{ deviceId: "line", items: [poseSignalOnlySt(1, "world", 5, 0, 0, 0)] }]);
	const p = poseOf(sim.tick(1), 1);
	ok(!!p && near(p.x, 5) && near(p.y, 0) && near(p.z, 0), "world pose x=5 from signal");
}
{
	console.log("Test 8: pose local via signal only (no flat coords)");
	const sim = new FactorySim(buildWorld(), { worldMode: "external" });
	sim.setDeviceDataSource("line", "external", { signal: "pose", frame: "local" });
	sim.ingestExternalFrame([{ deviceId: "line", items: [poseSignalOnlySt(1, "local", 2, 0, 3, 0)] }]);
	const p = poseOf(sim.tick(1), 1);
	ok(!!p && near(p.x, 3) && near(p.y, 0) && near(p.z, -2), "local(2,0,3) → world(3,0,-2) from signal");
}

console.log("");
console.log(`external-signals harness: ${passed} passed, ${failed} failed`);
if (failed > 0) throw new Error(`${failed} assertion(s) failed`);
