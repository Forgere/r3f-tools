import type { DeviceRendererPlugin } from "./types";

export interface DeviceRendererRegistryOptions {
	/** Called whenever a plugin is registered or removed. */
	onChange?: (registry: DeviceRendererRegistry) => void;
}

/**
 * Registry of device renderer plugins, keyed by device kind.
 *
 * The registry is observable: hosts subscribe via `useSyncExternalStore`, so
 * `register()` with an existing kind hot-swaps the component everywhere it is
 * used without remounting the scene or touching the simulation.
 */
export class DeviceRendererRegistry {
	private readonly plugins = new Map<string, DeviceRendererPlugin>();
	private readonly listeners = new Set<() => void>();
	private revision = 0;

	constructor(private readonly options: DeviceRendererRegistryOptions = {}) {}

	/** Registers a plugin, replacing any previous one with the same kind. */
	register(plugin: DeviceRendererPlugin): void {
		this.plugins.set(plugin.kind, plugin);
		this.emit();
	}

	unregister(kind: string): boolean {
		const removed = this.plugins.delete(kind);
		if (removed) this.emit();
		return removed;
	}

	resolve(kind: string): DeviceRendererPlugin | undefined {
		return this.plugins.get(kind);
	}

	/** Throws when no plugin is registered — use in code that must render. */
	require(kind: string): DeviceRendererPlugin {
		const plugin = this.plugins.get(kind);
		if (!plugin) {
			throw new Error(`DeviceRendererRegistry: no plugin for kind "${kind}"`);
		}
		return plugin;
	}

	list(): DeviceRendererPlugin[] {
		return [...this.plugins.values()];
	}

	kinds(): string[] {
		return [...this.plugins.keys()];
	}

	clear(): void {
		if (this.plugins.size === 0) return;
		this.plugins.clear();
		this.emit();
	}

	/** Stable subscribe/getSnapshot pair for `useSyncExternalStore`. */
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getRevision = (): number => this.revision;

	private emit(): void {
		this.revision++;
		for (const listener of this.listeners) listener();
		this.options.onChange?.(this);
	}
}
