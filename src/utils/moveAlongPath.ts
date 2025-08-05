import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import type { Object3D } from "three";
import { CatmullRomCurve3, Vector3 } from "three";

gsap.registerPlugin(MotionPathPlugin);

export interface PathPosition {
	x?: number;
	y?: number;
	z?: number;
}

export interface MoveAlongPathConfig {
	positions: PathPosition[];
	duration: number;
	ease?: string;
	delay?: number;
	onComplete?: () => void;
	onUpdate?: (progress: number) => void;
	autoRotate?: boolean;
	tension?: number;
}

export function moveAlongPath(
	object3D: Object3D,
	config: MoveAlongPathConfig,
): Promise<void> {
	return new Promise((resolve) => {
		const { positions, duration, ease = "power2.inOut", delay = 0, onComplete, onUpdate, autoRotate = false, tension = 0.5 } = config;

		if (positions.length < 2) {
			console.warn("moveAlongPath requires at least 2 positions");
			resolve();
			return;
		}

		// Convert positions to Vector3 array, filling in missing coordinates with current object position
		const points = positions.map((pos) => {
			return new Vector3(
				pos.x !== undefined ? pos.x : object3D.position.x,
				pos.y !== undefined ? pos.y : object3D.position.y,
				pos.z !== undefined ? pos.z : object3D.position.z,
			);
		});

		// Create a smooth curve path using CatmullRomCurve3
		const curve = new CatmullRomCurve3(points, false, "catmullrom", tension);

		// Create a proxy object to animate the path progress
		const proxy = { progress: 0 };

		let previousPosition = object3D.position.clone();

		gsap.to(proxy, {
			progress: 1,
			duration,
			ease,
			delay,
			onUpdate: () => {
				// Get position along the curve
				const point = curve.getPointAt(proxy.progress);
				object3D.position.copy(point);

				// Auto-rotate based on movement direction
				if (autoRotate && proxy.progress > 0) {
					const direction = point.sub(previousPosition).normalize();
					if (direction.length() > 0.001) {
						// Calculate rotation based on direction
						const yaw = Math.atan2(direction.x, direction.z);
						const pitch = Math.asin(-direction.y);
						
						object3D.rotation.y = yaw;
						object3D.rotation.x = pitch;
					}
					previousPosition = point.clone();
				}

				onUpdate?.(proxy.progress);
			},
			onComplete: () => {
				onComplete?.();
				resolve();
			},
		});
	});
}

export class PathAnimator {
	private object3D: Object3D;
	private currentTween: gsap.core.Tween | null = null;
	public isDestroyed = false;

	constructor(object3D: Object3D) {
		this.object3D = object3D;
	}

	moveAlongPath(config: MoveAlongPathConfig): Promise<void> {
		if (this.isDestroyed) return Promise.resolve();

		// Kill any existing animation
		this.kill();

		return new Promise((resolve) => {
			const { positions, duration, ease = "power2.inOut", delay = 0, onComplete, onUpdate, autoRotate = false, tension = 0.5 } = config;

			if (positions.length < 2) {
				console.warn("moveAlongPath requires at least 2 positions");
				resolve();
				return;
			}

			// Convert positions to Vector3 array
			const points = positions.map((pos) => {
				return new Vector3(
					pos.x !== undefined ? pos.x : this.object3D.position.x,
					pos.y !== undefined ? pos.y : this.object3D.position.y,
					pos.z !== undefined ? pos.z : this.object3D.position.z,
				);
			});

			// Create curve path
			const curve = new CatmullRomCurve3(points, false, "catmullrom", tension);

			// Animation proxy
			const proxy = { progress: 0 };
			let previousPosition = this.object3D.position.clone();

			this.currentTween = gsap.to(proxy, {
				progress: 1,
				duration,
				ease,
				delay,
				onUpdate: () => {
					if (this.isDestroyed) return;

					// Update position along curve
					const point = curve.getPointAt(proxy.progress);
					this.object3D.position.copy(point);

					// Auto-rotate logic
					if (autoRotate && proxy.progress > 0) {
						const direction = point.sub(previousPosition).normalize();
						if (direction.length() > 0.001) {
							const yaw = Math.atan2(direction.x, direction.z);
							const pitch = Math.asin(-direction.y);
							
							this.object3D.rotation.y = yaw;
							this.object3D.rotation.x = pitch;
						}
						previousPosition = point.clone();
					}

					onUpdate?.(proxy.progress);
				},
				onComplete: () => {
					this.currentTween = null;
					onComplete?.();
					resolve();
				},
			});
		});
	}

	kill(): void {
		if (this.currentTween) {
			this.currentTween.kill();
			this.currentTween = null;
		}
	}

	pause(): void {
		if (this.currentTween && !this.isDestroyed) {
			this.currentTween.pause();
		}
	}

	resume(): void {
		if (this.currentTween && !this.isDestroyed) {
			this.currentTween.resume();
		}
	}

	isPlaying(): boolean {
		return !this.isDestroyed && this.currentTween ? this.currentTween.isActive() : false;
	}

	destroy(): void {
		this.isDestroyed = true;
		this.kill();
	}
}

export function createPathAnimator(object3D: Object3D): PathAnimator {
	return new PathAnimator(object3D);
}