import type { ComponentType } from "react";
import type { DeviceStateDelta, JunctionPhase } from "../sim/types";

/**
 * Everything a device renderer plugin is allowed to know about the
 * simulation. Deliberately tiny so the same plugin can be driven by a live
 * `FactorySim`, a Web Worker mirror, or a recorded replay.
 */
export interface DeviceStateSource {
	getDeviceState(deviceId: string): DeviceStateDelta | undefined;
}

/**
 * Where a device sits and how big it is, in world space.
 *
 * `length` runs along the main flow (the direction the rollers drive),
 * `width` runs across it and equals the conveyor's belt width — a
 * lift-and-transfer deck is the same width as the line it is spliced into.
 */
export interface DeviceLayout {
	/** World position of the deck centre, at belt path height. */
	position: [number, number, number];
	/** Deck yaw in radians. 0 means the main flow runs along +X. */
	yaw: number;
	/** Footprint along the main flow direction (X when `yaw` is 0). */
	length: number;
	/** Footprint across the flow (Z when `yaw` is 0) — the transfer axis. */
	width: number;
	/** World Y of the factory floor, used to size the pedestal. */
	floorY?: number;
	/**
	 * Signed transfer-axis component for each outfeed, in the same order as
	 * the simulation's route list: `0` = straight through (rollers only),
	 * `-1` / `+1` = divert to the negative / positive side.
	 */
	routeSigns?: number[];
}

/** Normalised, always-populated view of a device's live state. */
export interface DeviceVisualState {
	running: boolean;
	speed: number;
	routeIndex: number;
	/** Lift cassette extension, 0 (retracted) … 1 (fully raised). */
	lift: number;
	phase: JunctionPhase;
	occupied: boolean;
}

export interface DeviceRendererProps {
	deviceId: string;
	label?: string;
	layout: DeviceLayout;
	/** Plugin-specific configuration carried by the device definition. */
	config?: Readonly<Record<string, unknown>>;
	theme: DeviceTheme;
	/**
	 * Stable reader — call it inside `useFrame` to get the freshest state.
	 * Never triggers a React render, which is what lets a device animate at
	 * 60 fps inside a scene that only re-renders on control changes.
	 */
	readState: () => DeviceVisualState;
}

/** Visual identity of a device family; swapping theme = swapping look. */
export interface DeviceTheme {
	/** Structural parts: side plates, pedestal, brackets. */
	frame: string;
	/** Cassette, wheels and anything that moves. */
	accent: string;
	/** Main rollers that carry the load straight through. */
	roller: string;
	/** Lift shafts and cylinders. */
	metal: string;
	/** Deck pan / base plate. */
	deck: string;
	/** Status lamp when idle. */
	lightIdle: string;
	/** Status lamp while a lift cycle is running. */
	lightActive: string;
	/** Edge rounding in world units — big = toy-like, ~0 = industrial. */
	cornerRadius: number;
	roughness: number;
	metalness: number;
	/** Adds the little photo-eye post and control box. */
	detail?: boolean;
}

/**
 * A swappable renderer for one class of factory equipment.
 *
 * Registering a plugin with an existing `kind` replaces it — that is the
 * whole point: the scene keeps running while a different vendor's model of
 * the same machine is dropped in.
 */
export interface DeviceRendererPlugin {
	/** Device kind this plugin renders, e.g. `"lift-transfer"`. */
	kind: string;
	/** Human readable name, for tooling and UI pickers. */
	label: string;
	description?: string;
	/** Theme applied when the host does not supply one. */
	defaultTheme?: DeviceTheme;
	Component: ComponentType<DeviceRendererProps>;
}
