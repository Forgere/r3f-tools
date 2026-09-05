/**
 * Headless verification of episode recording: exportEpisode() yields a
 * JSON-safe record whose seed reproduces the exact same event stream, and
 * whose structured payloads answer analytics questions (reject rate,
 * throughput) without parsing free-text details.
 *
 * Run via: tsc --project tsconfig.harness.json && node dist-harness/scripts/episodeRecording.harness.js
 */
import { FactorySim } from "../src/sim/FactorySim";
import type { SimDeviceDef, SimEpisode } from "../src/sim/types";

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
		interval: 0.6,
		itemTypes: [{ typeId: "parcel", colorIndex: 0 }],
	},
	{
		id: "belt",
		kind: "transport",
		points: [
			{ x: 0, y: 0.7, z: 0 },
			{ x: 8, y: 0.7, z: 0 },
		],
		speed: 1.5,
		next: "qc",
	},
	{
		id: "qc",
		kind: "inspector",
		position: { x: 8, y: 0.7, z: 0 },
		dwell: 0.2,
		defaultVerdict: "ok",
		writesAttr: "quality",
		routes: { ok: "out", ng: "bin" },
		random: { verdict: "ng", rate: 0.3 },
	},
	{
		id: "out",
		kind: "transport",
		points: [
			{ x: 8, y: 0.7, z: 0 },
			{ x: 12, y: 0.7, z: 0 },
		],
		speed: 1.5,
		next: "sink",
	},
	{
		id: "bin",
		kind: "buffer",
		position: { x: 8, y: 0.7, z: 2 },
		columns: 2,
		onFull: "block",
	},
	{ id: "sink", kind: "sink" },
];

console.log("episode recording");

const sim = new FactorySim(defs, { seed: 2026, eventLogSize: 100000 });
const TICKS = 1800; // 30 sim-seconds
for (let i = 0; i < TICKS; i++) sim.tick(1 / 60);
const episode = sim.exportEpisode();

ok(episode.seed === 2026, "episode carries its seed");
ok(Math.abs(episode.duration - TICKS / 60) < 1e-6, `episode duration recorded (${episode.duration.toFixed(2)}s)`);
ok(episode.events.length > 0, `events recorded (${episode.events.length})`);

// JSON round-trip must be lossless — this is what lands on disk / wire.
const roundTripped = JSON.parse(JSON.stringify(episode)) as SimEpisode;
ok(
	JSON.stringify(roundTripped) === JSON.stringify(episode),
	"episode survives a JSON round-trip losslessly",
);

// Replay from the seed: identical event stream.
const replay = new FactorySim(defs, { seed: 2026, eventLogSize: 100000 });
for (let i = 0; i < TICKS; i++) replay.tick(1 / 60);
const replayEpisode = replay.exportEpisode();
ok(
	JSON.stringify(replayEpisode.events) === JSON.stringify(episode.events),
	"replay from seed reproduces the exact event stream",
);

// Analytics straight from structured payloads — no string parsing.
const ngFromEvents = episode.events.filter(
	(e) => e.type === "item:inspected" && e.payload?.verdict === "ng",
).length;
const ngFromStats = episode.stats.verdicts.qc?.ng ?? 0;
ok(ngFromEvents > 0, `structured payload query found rejects (${ngFromEvents})`);
ok(
	ngFromEvents === ngFromStats,
	`payload-derived reject count matches stats (${ngFromEvents} === ${ngFromStats})`,
);

const consumedEvents = episode.events.filter(
	(e) => e.type === "item:consumed" && e.deviceId === "sink",
).length;
ok(
	consumedEvents === (episode.stats.throughput.sink ?? 0),
	`event-derived throughput matches stats (${consumedEvents})`,
);

// Event ordering is monotonic in both seq and time — required for replay
// tooling that zips events back onto a timeline.
let monotonic = true;
for (let i = 1; i < episode.events.length; i++) {
	const prev = episode.events[i - 1];
	const cur = episode.events[i];
	if (!prev || !cur || cur.seq <= prev.seq || cur.time < prev.time - 1e-9) {
		monotonic = false;
		break;
	}
}
ok(monotonic, "event log is monotonic in seq and time");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
