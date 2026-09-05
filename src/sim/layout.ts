import type {
	BufferDef,
	InspectorDef,
	JunctionDef,
	SimAttrValue,
	SimDeviceDef,
	SimPoint,
	SourceDef,
	TransportDef,
} from "./types";

/**
 * Serializable factory layout — the machine-readable form of a factory.
 *
 * `SimDeviceDef` is already pure data (plain points, primitive attrs), so a
 * whole factory can live in a JSON file. That is what lets tooling — an
 * editor, a code generator, or an AI agent — read a production line,
 * validate a modification against constraints, and write it back without
 * touching TypeScript source.
 *
 * ```json
 * {
 *   "version": 1,
 *   "name": "demo-line",
 *   "options": { "worldMode": "hybrid", "deviceSources": { "line-3": "external" } },
 *   "devices": [
 *     { "id": "rack", "kind": "source", "output": "belt-1", "interval": 2,
 *       "itemTypes": [{ "typeId": "parcel", "colorIndex": 0 }] },
 *     { "id": "belt-1", "kind": "transport", "speed": 0.8,
 *       "points": [{ "x": 0, "y": 0.7, "z": 0 }, { "x": 4, "y": 0.7, "z": 0 }],
 *       "next": "pack" },
 *     { "id": "pack", "kind": "sink" }
 *   ]
 * }
 * ```
 */
export interface FactoryLayout {
	/** Schema version. Currently always 1; bump on breaking changes. */
	version?: number;
	/** Human-readable factory name. */
	name?: string;
	/** Startup options mirroring `FactorySimOptions` (all optional). */
	options?: {
		worldMode?: "sim" | "external" | "hybrid";
		deviceSources?: Record<string, "sim" | "external">;
		defaultMinGap?: number;
		eventLogSize?: number;
	};
	devices: SimDeviceDef[];
}

export type LayoutIssueSeverity = "error" | "warning";

export interface LayoutIssue {
	severity: LayoutIssueSeverity;
	/** Device id the issue belongs to, when applicable. */
	deviceId?: string;
	/** Machine-readable code, so tools can react without parsing messages. */
	code:
		| "not-an-object"
		| "missing-field"
		| "invalid-field"
		| "duplicate-id"
		| "unknown-kind"
		| "unknown-ref"
		| "ref-kind-mismatch";
	message: string;
}

const KINDS = new Set([
	"source",
	"transport",
	"junction",
	"inspector",
	"buffer",
	"sink",
]);

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v);
}

function isAttrValue(v: unknown): v is SimAttrValue {
	return typeof v === "string" || isFiniteNumber(v) || typeof v === "boolean";
}

function checkPoint(
	v: unknown,
	field: string,
	deviceId: string,
	issues: LayoutIssue[],
): v is SimPoint {
	if (
		!isObject(v) ||
		!isFiniteNumber(v.x) ||
		!isFiniteNumber(v.y) ||
		!isFiniteNumber(v.z)
	) {
		issues.push({
			severity: "error",
			deviceId,
			code: "invalid-field",
			message: `"${field}" must be a point {x,y,z} of finite numbers`,
		});
		return false;
	}
	return true;
}

function checkAttrs(
	v: unknown,
	field: string,
	deviceId: string,
	issues: LayoutIssue[],
): void {
	if (v === undefined) return;
	if (!isObject(v)) {
		issues.push({
			severity: "error",
			deviceId,
			code: "invalid-field",
			message: `"${field}" must be a record of attribute values`,
		});
		return;
	}
	for (const [key, value] of Object.entries(v)) {
		if (!isAttrValue(value)) {
			issues.push({
				severity: "error",
				deviceId,
				code: "invalid-field",
				message: `"${field}.${key}" must be string, finite number, or boolean (structured-clone friendly)`,
			});
		}
	}
}

function checkIdRef(
	v: unknown,
	field: string,
	deviceId: string,
	issues: LayoutIssue[],
): v is string {
	if (typeof v !== "string" || v.length === 0) {
		issues.push({
			severity: "error",
			deviceId,
			code: "missing-field",
			message: `"${field}" must be a non-empty device id string`,
		});
		return false;
	}
	return true;
}

function checkLift(
	v: unknown,
	deviceId: string,
	issues: LayoutIssue[],
): void {
	if (v === undefined) return;
	if (!isObject(v)) {
		issues.push({
			severity: "error",
			deviceId,
			code: "invalid-field",
			message: '"lift" must be an object',
		});
		return;
	}
	for (const key of ["height", "upTime", "transferTime", "downTime"] as const) {
		const t = v[key];
		if (t !== undefined && (!isFiniteNumber(t) || t <= 0)) {
			issues.push({
				severity: "error",
				deviceId,
				code: "invalid-field",
				message: `"lift.${key}" must be a positive finite number`,
			});
		}
	}
	if (v.divertRoutes !== undefined) {
		if (
			!Array.isArray(v.divertRoutes) ||
			v.divertRoutes.some((r) => typeof r !== "string")
		) {
			issues.push({
				severity: "error",
				deviceId,
				code: "invalid-field",
				message: '"lift.divertRoutes" must be an array of device id strings',
			});
		}
	}
}

function checkSource(
	d: SourceDef,
	ids: Set<string>,
	issues: LayoutIssue[],
): void {
	checkIdRef(d.output, "output", d.id, issues);
	if (!isFiniteNumber(d.interval) || d.interval <= 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"interval" must be a positive finite number',
		});
	}
	if (!Array.isArray(d.itemTypes) || d.itemTypes.length === 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "missing-field",
			message: '"itemTypes" must be a non-empty array',
		});
		return;
	}
	for (const [i, t] of d.itemTypes.entries()) {
		if (!isObject(t) || typeof t.typeId !== "string" || t.typeId.length === 0) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: `"itemTypes[${i}]" needs a non-empty "typeId" string`,
			});
			continue;
		}
		if (!Number.isInteger(t.colorIndex) || t.colorIndex < 0) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: `"itemTypes[${i}].colorIndex" must be a non-negative integer (palette index)`,
			});
		}
		if (t.weight !== undefined && (!isFiniteNumber(t.weight) || t.weight < 0)) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: `"itemTypes[${i}].weight" must be a non-negative number`,
			});
		}
		checkAttrs(t.attrs, `itemTypes[${i}].attrs`, d.id, issues);
	}
	// Sources must feed a transport; an external-only target is impossible
	// (the sim spawns the item, so the receiver is always sim-side).
	const out = d.output as string;
	if (ids.has(out)) {
		// kind check happens in the cross-reference pass below
	}
}

function checkTransport(
	d: TransportDef,
	issues: LayoutIssue[],
): void {
	if (!Array.isArray(d.points) || d.points.length < 2) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"points" must be an array of at least 2 points',
		});
	} else {
		for (const [i, p] of d.points.entries()) {
			checkPoint(p, `points[${i}]`, d.id, issues);
		}
	}
	if (!isFiniteNumber(d.speed) || d.speed <= 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"speed" must be a positive finite number (metres/second)',
		});
	}
	checkIdRef(d.next, "next", d.id, issues);
	if (d.minGap !== undefined && (!isFiniteNumber(d.minGap) || d.minGap < 0)) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"minGap" must be a non-negative number',
		});
	}
	if (
		d.cornerRadius !== undefined &&
		(!isFiniteNumber(d.cornerRadius) || d.cornerRadius < 0)
	) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"cornerRadius" must be a non-negative number',
		});
	}
}

function checkRoutes(
	routes: unknown,
	field: string,
	deviceId: string,
	issues: LayoutIssue[],
	opts: { required?: boolean } = {},
): void {
	if (routes === undefined) {
		if (opts.required) {
			issues.push({
				severity: "error",
				deviceId,
				code: "missing-field",
				message: `"${field}" is required`,
			});
		}
		return;
	}
	if (!isObject(routes) || Object.keys(routes).length === 0) {
		issues.push({
			severity: "error",
			deviceId,
			code: "invalid-field",
			message: `"${field}" must be a non-empty record of key → device id`,
		});
		return;
	}
	for (const [key, target] of Object.entries(routes)) {
		if (typeof target !== "string" || target.length === 0) {
			issues.push({
				severity: "error",
				deviceId,
				code: "invalid-field",
				message: `"${field}.${key}" must be a non-empty device id string`,
			});
		}
	}
}

function checkJunction(d: JunctionDef, issues: LayoutIssue[]): void {
	checkPoint(d.position, "position", d.id, issues);
	if (!isFiniteNumber(d.dwell) || d.dwell < 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"dwell" must be a non-negative finite number',
		});
	}
	checkRoutes(d.routes, "routes", d.id, issues);
	if (!d.routes && !d.alternate) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "missing-field",
			message: 'junction needs "routes" and/or "alternate" to pick a downstream device',
		});
	}
	if (d.alternate !== undefined) {
		const alt = d.alternate;
		if (
			!isObject(alt) ||
			!Array.isArray(alt.devices) ||
			alt.devices.length === 0 ||
			alt.devices.some((x) => typeof x !== "string" || x.length === 0)
		) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"alternate.devices" must be a non-empty array of device ids',
			});
		}
		if (!isFiniteNumber(alt?.interval) || alt.interval <= 0) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"alternate.interval" must be a positive finite number',
			});
		}
	}
	if (d.routeBy !== undefined && typeof d.routeBy !== "string") {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"routeBy" must be an attribute name string',
		});
	}
	checkLift(d.lift, d.id, issues);
}

function checkInspector(d: InspectorDef, issues: LayoutIssue[]): void {
	checkPoint(d.position, "position", d.id, issues);
	if (!isFiniteNumber(d.dwell) || d.dwell < 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"dwell" must be a non-negative finite number',
		});
	}
	if (typeof d.defaultVerdict !== "string" || d.defaultVerdict.length === 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "missing-field",
			message: '"defaultVerdict" must be a non-empty string',
		});
	}
	if (typeof d.writesAttr !== "string" || d.writesAttr.length === 0) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "missing-field",
			message: '"writesAttr" must be a non-empty attribute name',
		});
	}
	checkRoutes(d.routes, "routes", d.id, issues, { required: true });
	// Mirrors FactorySim.validateTopology: the default verdict must be routable.
	if (
		isObject(d.routes) &&
		typeof d.defaultVerdict === "string" &&
		!(d.defaultVerdict in d.routes)
	) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: `"routes" has no entry for the default verdict "${d.defaultVerdict}"`,
		});
	}
	if (d.random !== undefined) {
		const r = d.random;
		if (typeof r?.verdict !== "string" || !isFiniteNumber(r?.rate)) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"random" needs { verdict: string, rate: number }',
			});
		} else if (r.rate < 0 || r.rate > 1) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"random.rate" must be within [0, 1]',
			});
		}
	}
	if (d.rules !== undefined) {
		if (!Array.isArray(d.rules)) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"rules" must be an array',
			});
		} else {
			for (const [i, rule] of d.rules.entries()) {
				if (
					!isObject(rule) ||
					typeof rule.attr !== "string" ||
					!isAttrValue(rule.equals) ||
					typeof rule.verdict !== "string"
				) {
					issues.push({
						severity: "error",
						deviceId: d.id,
						code: "invalid-field",
						message: `"rules[${i}]" needs { attr: string, equals: primitive, verdict: string }`,
					});
				}
			}
		}
	}
	checkLift(d.lift, d.id, issues);
}

function checkBuffer(d: BufferDef, issues: LayoutIssue[]): void {
	checkPoint(d.position, "position", d.id, issues);
	if (!Number.isInteger(d.columns) || d.columns < 1) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"columns" must be a positive integer',
		});
	}
	for (const key of ["rows", "layers"] as const) {
		const v = d[key];
		if (v !== undefined && (!Number.isInteger(v) || v < 1)) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: `"${key}" must be a positive integer`,
			});
		}
	}
	if (d.spacing !== undefined) {
		if (
			!Array.isArray(d.spacing) ||
			d.spacing.length !== 3 ||
			d.spacing.some((s) => !isFiniteNumber(s) || s <= 0)
		) {
			issues.push({
				severity: "error",
				deviceId: d.id,
				code: "invalid-field",
				message: '"spacing" must be [x,y,z] of positive numbers',
			});
		}
	}
	if (d.onFull !== "block" && d.onFull !== "consume") {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"onFull" must be "block" or "consume"',
		});
	}
	if (
		d.drainAfter !== undefined &&
		(!isFiniteNumber(d.drainAfter) || d.drainAfter < 0)
	) {
		issues.push({
			severity: "error",
			deviceId: d.id,
			code: "invalid-field",
			message: '"drainAfter" must be a non-negative number (0 = never)',
		});
	}
}

/**
 * Validate unknown data as a factory layout. Returns every issue found —
 * never throws — so tooling (and AI agents) can show or fix all problems in
 * one pass.
 *
 * References to devices that are NOT in the layout are **warnings**, not
 * errors: a layout may intentionally reference external-only devices that are
 * fed by an outside data source and never simulated (see DataMode).
 */
export function validateFactoryLayout(data: unknown): LayoutIssue[] {
	const issues: LayoutIssue[] = [];

	if (!isObject(data)) {
		return [
			{
				severity: "error",
				code: "not-an-object",
				message: "layout must be a JSON object",
			},
		];
	}
	if (data.version !== undefined && data.version !== 1) {
		issues.push({
			severity: "error",
			code: "invalid-field",
			message: `"version" must be 1 (got ${String(data.version)})`,
		});
	}
	if (data.name !== undefined && typeof data.name !== "string") {
		issues.push({
			severity: "error",
			code: "invalid-field",
			message: '"name" must be a string',
		});
	}
	if (data.options !== undefined) {
		if (!isObject(data.options)) {
			issues.push({
				severity: "error",
				code: "invalid-field",
				message: '"options" must be an object',
			});
		} else {
			const o = data.options;
			if (
				o.worldMode !== undefined &&
				o.worldMode !== "sim" &&
				o.worldMode !== "external" &&
				o.worldMode !== "hybrid"
			) {
				issues.push({
					severity: "error",
					code: "invalid-field",
					message: '"options.worldMode" must be "sim" | "external" | "hybrid"',
				});
			}
			if (o.deviceSources !== undefined) {
				if (!isObject(o.deviceSources)) {
					issues.push({
						severity: "error",
						code: "invalid-field",
						message: '"options.deviceSources" must be a record of device id → "sim" | "external"',
					});
				} else {
					for (const [id, src] of Object.entries(o.deviceSources)) {
						if (src !== "sim" && src !== "external") {
							issues.push({
								severity: "error",
								deviceId: id,
								code: "invalid-field",
								message: `"options.deviceSources.${id}" must be "sim" or "external"`,
							});
						}
					}
				}
			}
		}
	}

	if (!Array.isArray(data.devices) || data.devices.length === 0) {
		issues.push({
			severity: "error",
			code: "missing-field",
			message: '"devices" must be a non-empty array',
		});
		return issues;
	}

	// Per-device structural pass.
	const ids = new Set<string>();
	const devices = data.devices as Record<string, unknown>[];
	for (const [i, raw] of devices.entries()) {
		if (!isObject(raw)) {
			issues.push({
				severity: "error",
				code: "not-an-object",
				message: `devices[${i}] must be an object`,
			});
			continue;
		}
		const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined;
		if (!id) {
			issues.push({
				severity: "error",
				code: "missing-field",
				message: `devices[${i}] needs a non-empty "id" string`,
			});
		} else if (ids.has(id)) {
			issues.push({
				severity: "error",
				deviceId: id,
				code: "duplicate-id",
				message: `duplicate device id "${id}"`,
			});
		} else {
			ids.add(id);
		}

		const kind = raw.kind;
		if (typeof kind !== "string" || !KINDS.has(kind)) {
			issues.push({
				severity: "error",
				deviceId: id,
				code: "unknown-kind",
				message: `unknown device kind "${String(kind)}" (expected one of: ${[...KINDS].join(", ")})`,
			});
			continue;
		}
		const d = raw as unknown as SimDeviceDef & { id: string };
		switch (kind) {
			case "source":
				checkSource(d as SourceDef, ids, issues);
				break;
			case "transport":
				checkTransport(d as TransportDef, issues);
				break;
			case "junction":
				checkJunction(d as JunctionDef, issues);
				break;
			case "inspector":
				checkInspector(d as InspectorDef, issues);
				break;
			case "buffer":
				checkBuffer(d as BufferDef, issues);
				break;
			case "sink":
				break;
		}
	}

	// Cross-reference pass: every referenced id should exist or be flagged as
	// an (intentional) external-only device. Also enforce kind compatibility
	// the sim itself relies on (source → transport, transport !→ source).
	const byId = new Map<string, SimDeviceDef>();
	for (const d of data.devices as SimDeviceDef[]) {
		if (typeof d.id === "string") byId.set(d.id, d);
	}
	const refCheck = (
		fromId: string,
		field: string,
		target: unknown,
		forbiddenKind?: string,
	): void => {
		if (typeof target !== "string" || target.length === 0) return;
		const t = byId.get(target);
		if (!t) {
			issues.push({
				severity: "warning",
				deviceId: fromId,
				code: "unknown-ref",
				message: `"${field}" references "${target}" which is not in this layout — only valid if "${target}" is an external-only device fed via ingestExternalFrame`,
			});
			return;
		}
		if (forbiddenKind && t.kind === forbiddenKind) {
			issues.push({
				severity: "error",
				deviceId: fromId,
				code: "ref-kind-mismatch",
				message: `"${field}" must not reference a ${forbiddenKind} ("${target}")`,
			});
		}
	};
	for (const d of data.devices as SimDeviceDef[]) {
		if (!d || typeof d.id !== "string") continue;
		switch (d.kind) {
			case "source": {
				refCheck(d.id, "output", d.output);
				const out = byId.get(d.output);
				if (out && out.kind !== "transport") {
					issues.push({
						severity: "error",
						deviceId: d.id,
						code: "ref-kind-mismatch",
						message: `source "output" must reference a transport (got "${d.output}" of kind "${out.kind}")`,
					});
				}
				break;
			}
			case "transport":
				refCheck(d.id, "next", d.next, "source");
				break;
			case "junction":
				if (d.routes) {
					for (const [k, target] of Object.entries(d.routes)) {
						refCheck(d.id, `routes.${k}`, target, "source");
					}
				}
				if (d.alternate) {
					for (const target of d.alternate.devices) {
						refCheck(d.id, "alternate.devices", target, "source");
					}
				}
				if (d.lift?.divertRoutes) {
					const routeTargets = new Set([
						...Object.values(d.routes ?? {}),
						...(d.alternate?.devices ?? []),
					]);
					for (const r of d.lift.divertRoutes) {
						if (!routeTargets.has(r)) {
							issues.push({
								severity: "warning",
								deviceId: d.id,
								code: "unknown-ref",
								message: `"lift.divertRoutes" lists "${r}" which is not one of this junction's route targets`,
							});
						}
					}
				}
				break;
			case "inspector":
				for (const [verdict, target] of Object.entries(d.routes)) {
					refCheck(d.id, `routes.${verdict}`, target, "source");
				}
				if (d.lift?.divertRoutes) {
					for (const r of d.lift.divertRoutes) {
						if (!Object.values(d.routes).includes(r)) {
							issues.push({
								severity: "warning",
								deviceId: d.id,
								code: "unknown-ref",
								message: `"lift.divertRoutes" lists "${r}" which is not one of this inspector's route targets`,
							});
						}
					}
				}
				break;
		}
	}

	return issues;
}

/** True when validation produced no errors (warnings are acceptable). */
export function isFactoryLayout(data: unknown): data is FactoryLayout {
	return !validateFactoryLayout(data).some((i) => i.severity === "error");
}

/**
 * Validate and narrow unknown data to a `FactoryLayout`. Throws an Error
 * listing every error-level issue; warnings are attached to the error's
 * message for visibility but never block parsing.
 */
export function parseFactoryLayout(data: unknown): FactoryLayout {
	const issues = validateFactoryLayout(data);
	const errors = issues.filter((i) => i.severity === "error");
	if (errors.length > 0) {
		const lines = issues.map(
			(i) =>
				`  [${i.severity}]${i.deviceId ? ` ${i.deviceId}:` : ""} ${i.message}`,
		);
		throw new Error(
			`Invalid factory layout (${errors.length} error${errors.length === 1 ? "" : "s"}):\n${lines.join("\n")}`,
		);
	}
	return data as FactoryLayout;
}
