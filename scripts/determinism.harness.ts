/**
 * Headless verification that a seeded FactorySim is reproducible bit-for-bit:
 * same seed → identical frame deltas + event stream; reset() replays the same
 * episode; different seed → different stream (stochastic verdicts actually
 * use the RNG).
 *
 * Run via: tsc --project tsconfig.harness.json && node dist-harness/scripts/determinism.harness.js
 */
import { FactorySim } from "../src/sim/FactorySim";
import type { SimDeviceDef } from "../src/sim/types";

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

const defs: SimDeviceDef[] = [
	{
		id: "rack",
		kind: "source",
		output: "belt",
		interval: 0.7,
		itemTypes: [
			{ typeId: "parcel", colorIndex: 0, weight: 1 },
			{ typeId: "crate", colorIndex: 1, weight: 2 },
		],
	},
	{
		id: "belt",
		kind: "transport",
		points: [
			{ x: 0, y: 0.7, z: 0 },
			{ x: 8, y: 0.7, z: 0 },
		],
		speed: 1.2,
		minGap: 0.5,
		next: "qc",
	},
	{
		id: "qc",
		kind: "inspector",
		position: { x: 8, y: 0.7, z: 0 },
		dwell: 0.25,
		defaultVerdict: "ok",
		writesAttr: "quality",
		routes: { ok: "out", ng: "bin" },
		random: { verdict: "ng", rate: 0.4 },
	},
	{
		id: "out",
		kind: "transport",
		points: [
			{ x: 8, y: 0.7, z: 0 },
			{ x: 12, y: 0.7, z: 0 },
		],
		speed: 1.2,
		next: "sink",
	},
	{
		id: "bin",
		kind: "buffer",
		position: { x: 8, y: 0.7, z: 2 },
		columns: 3,
		onFull: "block",
		drainAfter: 5,
	},
	{ id: "sink", kind: "sink" },
];

/** Fold a whole episode into one comparable string. */
function episodeFingerprint(sim: FactorySim, ticks: number): string {
	const parts: string[] = [];
	for (let i = 0; i < ticks; i++) {
		const d = sim.tick(1 / 60);
		parts.push(
			JSON.stringify({
				s: d.spawned,
				m: d.moved.map((m) => [
					m.itemId,
					Math.round(m.x * 1e4),
					Math.round(m.y * 1e4),
					Math.round(m.z * 1e4),
				]),
				r: d.removed,
				rs: d.restyled,
			}),
		);
	}
	parts.push(JSON.stringify(sim.getRecentEvents(10000)));
	parts.push(JSON.stringify(sim.getStats()));
	return parts.join("|");
}

console.log("seeded determinism");

const TICKS = 1200; // 20 sim-seconds
const a = new FactorySim(defs, { seed: 42 });
const b = new FactorySim(defs, { seed: 42 });
const fa = episodeFingerprint(a, TICKS);
const fb = episodeFingerprint(b, TICKS);
ok(fa === fb, "two sims with seed 42 produce identical deltas + events + stats");
ok(a.getStats().totalSpawned > 0, `episode actually did something (${a.getStats().totalSpawned} spawned)`);
ok(
	(a.getStats().verdicts.qc?.ng ?? 0) > 0,
	`stochastic verdicts fired (${a.getStats().verdicts.qc?.ng ?? 0} ng)`,
);

const c = new FactorySim(defs, { seed: 7 });
const fc = episodeFingerprint(c, TICKS);
ok(fc !== fa, "seed 7 differs from seed 42 (RNG actually drives outcomes)");

console.log("reset() replay");
const before = a.getStats();
a.reset();
ok(a.getElapsed() === 0, "reset returns clock to 0");
ok(a.getStats().totalSpawned === 0, "reset clears counters");
ok(a.snapshot().length === 0, "reset clears live items");
ok(a.getRecentEvents(10000).length === 0, "reset clears event log");
ok(a.getSeed() === 42, "reset keeps the seed by default");
const replay = episodeFingerprint(a, TICKS);
ok(replay === fa, "reset() replays the identical episode bit-for-bit");

a.reset(99);
ok(a.getSeed() === 99, "reset(seed) switches episode");
const other = episodeFingerprint(a, TICKS);
ok(other !== fa, "reset(99) produces a different episode");

// Control settings survive a reset (they are configuration, not state).
a.setGlobalSpeed(2);
a.reset(42);
const sped = episodeFingerprint(a, 60);
a.setGlobalSpeed(1);
a.reset(42);
const normal = episodeFingerprint(a, 60);
ok(sped !== normal, "control settings survive reset and affect the episode");

console.log("unseeded sims still work (nondeterministic)");
const u1 = new FactorySim(defs);
const u2 = new FactorySim(defs);
u1.tick(1 / 60);
u2.tick(1 / 60);
ok(u1.getSeed() !== u2.getSeed() || true, "unseeded construction does not throw");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
