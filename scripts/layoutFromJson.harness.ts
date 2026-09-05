/**
 * Headless verification that a JSON-parsed FactoryLayout produces a sim that
 * behaves identically to one built from hand-written defs, and that the
 * validator catches the mistakes an editor/AI would make.
 *
 * Run via: tsc --project tsconfig.harness.json && node dist-harness/scripts/layoutFromJson.harness.js
 */
import { FactorySim } from "../src/sim/FactorySim";
import {
	createSimFromLayout,
	isFactoryLayout,
	parseFactoryLayout,
	validateFactoryLayout,
} from "../src/sim/layout";
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
		interval: 1,
		itemTypes: [
			{ typeId: "parcel", colorIndex: 0, weight: 1, attrs: { batch: "A" } },
			{ typeId: "crate", colorIndex: 1, weight: 1 },
		],
	},
	{
		id: "belt",
		kind: "transport",
		points: [
			{ x: 0, y: 0.7, z: 0 },
			{ x: 6, y: 0.7, z: 0 },
		],
		speed: 1,
		minGap: 0.5,
		next: "qc",
	},
	{
		id: "qc",
		kind: "inspector",
		position: { x: 6, y: 0.7, z: 0 },
		dwell: 0.2,
		defaultVerdict: "ok",
		writesAttr: "quality",
		routes: { ok: "out", ng: "reject" },
		random: { verdict: "ng", rate: 0.5 },
		verdictColors: { ok: 0, ng: 3 },
	},
	{
		id: "out",
		kind: "transport",
		points: [
			{ x: 6, y: 0.7, z: 0 },
			{ x: 10, y: 0.7, z: 0 },
		],
		speed: 1,
		next: "sink",
	},
	{
		id: "reject",
		kind: "buffer",
		position: { x: 6, y: 0.7, z: 2 },
		columns: 2,
		rows: 2,
		onFull: "block",
	},
	{ id: "sink", kind: "sink" },
];

const layoutJson = JSON.parse(
	JSON.stringify({ version: 1, name: "json-line", devices: defs }),
) as unknown;

console.log("layout → sim equivalence");

// Run both sims with the same dt sequence. NOTE: Math.random makes the two
// runs diverge on verdict rolls until the seeded-RNG step lands; so compare
// structure and cumulative invariants, not per-tick verdict identity.
const a = new FactorySim(defs);
const b = createSimFromLayout(layoutJson);

const statsA: number[] = [];
const statsB: number[] = [];
for (let i = 0; i < 600; i++) {
	const da = a.tick(1 / 60);
	const db = b.tick(1 / 60);
	statsA.push(da.stats.totalSpawned);
	statsB.push(db.stats.totalSpawned);
}

const finalA = a.getStats();
const finalB = b.getStats();
ok(finalA.totalSpawned === finalB.totalSpawned, `same total spawned (${finalA.totalSpawned} === ${finalB.totalSpawned})`);
// activeItems counts the live item registry, which includes items parked in
// buffers — so conservation is consumed + active === spawned.
ok(
	finalA.totalConsumed + finalA.activeItems === finalA.totalSpawned,
	"hand-written sim conserves items (consumed + active === spawned)",
);
ok(
	finalB.totalConsumed + finalB.activeItems === finalB.totalSpawned,
	"JSON-built sim conserves items (consumed + active === spawned)",
);
ok(finalB.totalSpawned > 0, `JSON sim actually spawned items (${finalB.totalSpawned})`);

console.log("layout options plumbing");
const withOpts = createSimFromLayout({
	version: 1,
	options: { worldMode: "hybrid", deviceSources: { belt: "external" } },
	devices: defs,
});
ok(withOpts.getWorldMode() === "hybrid", "layout options set worldMode");
ok(
	withOpts.getDeviceDataSource("belt") === "external",
	"layout options set per-device data source",
);
const overridden = createSimFromLayout(
	{ version: 1, options: { worldMode: "external" }, devices: defs },
	{ worldMode: "sim" },
);
ok(overridden.getWorldMode() === "sim", "explicit options override layout options");

console.log("validator behaviour");
ok(isFactoryLayout(layoutJson), "round-tripped layout validates clean");
ok(validateFactoryLayout(layoutJson).length === 0, "clean layout → zero issues");

const badRef = JSON.parse(
	JSON.stringify({
		devices: defs.map((d) =>
			d.id === "out" ? { ...d, next: "does-not-exist" } : d,
		),
	}),
) as unknown;
const refIssues = validateFactoryLayout(badRef);
ok(
	refIssues.some((i) => i.severity === "warning" && i.code === "unknown-ref"),
	"dangling reference → warning (external-only devices stay valid)",
);
ok(isFactoryLayout(badRef), "dangling reference does not block parsing");

const dup = JSON.parse(
	JSON.stringify({ devices: [...defs, { id: "sink", kind: "sink" }] }),
) as unknown;
ok(!isFactoryLayout(dup), "duplicate id → invalid");
try {
	parseFactoryLayout(dup);
	ok(false, "parseFactoryLayout should throw on duplicates");
} catch (e) {
	ok(
		e instanceof Error && e.message.includes("duplicate device id"),
		"parseFactoryLayout throws with readable issue list",
	);
}

const badInspector = JSON.parse(
	JSON.stringify({
		devices: defs.map((d) =>
			d.id === "qc" ? { ...d, routes: { ng: "reject" } } : d,
		),
	}),
) as unknown;
ok(
	!isFactoryLayout(badInspector),
	"inspector missing route for defaultVerdict → invalid (mirrors sim topology check)",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
