import { useFrame } from "@react-three/fiber";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";
import type { DeviceStateDelta } from "../sim/types";
import type { DeviceRendererRegistry } from "./registry";
import type {
	DeviceLayout,
	DeviceRendererProps,
	DeviceStateSource,
	DeviceTheme,
	DeviceVisualState,
} from "./types";

const IDLE_STATE: DeviceVisualState = {
	running: true,
	speed: 1,
	routeIndex: 0,
	lift: 0,
	phase: "idle",
	occupied: false,
};

export function normalizeDeviceState(
	delta: DeviceStateDelta | undefined,
): DeviceVisualState {
	if (!delta) return IDLE_STATE;
	return {
		running: delta.running,
		speed: delta.speed,
		routeIndex: delta.routeIndex ?? 0,
		lift: delta.lift ?? 0,
		phase: delta.phase ?? "idle",
		occupied: delta.occupied ?? false,
	};
}

interface DeviceBinding {
	source: DeviceStateSource | undefined;
	deviceId: string;
}

const DeviceBindingContext = createContext<DeviceBinding | null>(null);

/**
 * Returns a stable `() => DeviceVisualState` bound to the current device.
 *
 * Plugins call it inside their own `useFrame`, so they always read the
 * freshest simulation state regardless of which plugin runs first. No
 * subscription, no React re-render — critical for scenes with hundreds of
 * devices.
 */
export function useDeviceStateReader(): () => DeviceVisualState {
	const binding = useContext(DeviceBindingContext);
	// Cached object: reused every frame so readers can hold onto it.
	const cache = useRef<DeviceVisualState>(IDLE_STATE);
	return useCallback(() => {
		if (!binding?.source) return IDLE_STATE;
		const delta = binding.source.getDeviceState(binding.deviceId);
		cache.current = normalizeDeviceState(delta);
		return cache.current;
	}, [binding]);
}

/**
 * Convenience wrapper: runs `apply(state, delta)` every frame with the
 * device's live state. Return value is ignored; mutate refs directly.
 */
export function useDeviceFrame(
	apply: (state: DeviceVisualState, delta: number) => void,
): void {
	const readState = useDeviceStateReader();
	const applyRef = useRef(apply);
	applyRef.current = apply;
	useFrame((_, delta) => {
		applyRef.current(readState(), delta);
	});
}

export interface DeviceRendererHostProps {
	registry: DeviceRendererRegistry;
	/** Any object exposing `getDeviceState`, typically a `FactorySim`. */
	source?: DeviceStateSource;
	deviceId: string;
	/** Device kind used to look the plugin up. */
	kind: string;
	layout: DeviceLayout;
	label?: string;
	config?: Readonly<Record<string, unknown>>;
	/** Theme override; falls back to the plugin's own default. */
	theme?: Partial<DeviceTheme>;
	/** Rendered when no plugin is registered for `kind`. */
	fallback?: ReactNode;
}

/**
 * Resolves a device kind to a plugin and renders it.
 *
 * Hot-swap flow: `registry.register({ kind: "lift-transfer", ... })` with a
 * different component — every host bound to that kind re-resolves on the next
 * React commit while the simulation keeps ticking.
 */
export function DeviceRendererHost({
	registry,
	source,
	deviceId,
	kind,
	layout,
	label,
	config,
	theme,
	fallback = null,
}: DeviceRendererHostProps) {
	useSyncExternalStore(registry.subscribe, registry.getRevision, registry.getRevision);
	const plugin = registry.resolve(kind);

	const binding = useMemo<DeviceBinding>(
		() => ({ source, deviceId }),
		[source, deviceId],
	);

	const readState = useCallback(() => {
		if (!source) return IDLE_STATE;
		return normalizeDeviceState(source.getDeviceState(deviceId));
	}, [source, deviceId]);

	if (!plugin) return <>{fallback}</>;

	const Component = plugin.Component;
	const resolvedTheme: DeviceTheme = {
		...(plugin.defaultTheme ?? DEFAULT_THEME),
		...theme,
	};

	const props: DeviceRendererProps = {
		deviceId,
		label: label ?? plugin.label,
		layout,
		config,
		theme: resolvedTheme,
		readState,
	};

	return (
		<DeviceBindingContext.Provider value={binding}>
			<Component {...props} />
		</DeviceBindingContext.Provider>
	);
}

/** Neutral grey fallback so a plugin without a theme still renders. */
export const DEFAULT_THEME: DeviceTheme = {
	frame: "#E8E4DC",
	accent: "#C4B5E0",
	roller: "#D8D8D8",
	metal: "#B9BEC4",
	deck: "#F5F2EB",
	lightIdle: "#8BD3C7",
	lightActive: "#F4A261",
	cornerRadius: 0.03,
	roughness: 0.55,
	metalness: 0.15,
	detail: true,
};
