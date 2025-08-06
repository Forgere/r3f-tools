import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import type { Object3D, Scene } from "three";
import {
	CatmullRomCurve3,
	Vector3,
	BufferGeometry,
	Line,
	LineBasicMaterial,
	Quaternion,
} from "three";

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
	debug?: boolean;
	debugColor?: string;
	debugScene?: Scene;
}

export function moveAlongPath(
	object3D: Object3D,
	config: MoveAlongPathConfig,
): Promise<void> {
	return new Promise((resolve) => {
		const {
			positions,
			duration,
			ease = "power2.inOut",
			delay = 0,
			onComplete,
			onUpdate,
			autoRotate = false,
			tension = 0.5,
			debug = false,
			debugColor = "#ff0000",
			debugScene,
		} = config;

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

		// Debug visualization
		let debugLine: Line | null = null;
		if (debug && debugScene) {
			const curvePoints = curve.getPoints(100);
			const geometry = new BufferGeometry().setFromPoints(curvePoints);
			const material = new LineBasicMaterial({ color: debugColor });
			debugLine = new Line(geometry, material);
			debugScene.add(debugLine);
			console.log(
				"Debug: Curve path created with",
				curvePoints.length,
				"points",
			);
		}

		// Create a proxy object to animate the path progress
		const proxy = { progress: 0 };

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
					const tangent = curve.getTangentAt(proxy.progress);

					// Ensure rotation only on XZ plane (ignore Y axis direction)
					tangent.y = 0;
					tangent.normalize();

					// Use horizontal tangent to calculate rotation
					const quaternion = new Quaternion().setFromUnitVectors(
						new Vector3(0, 0, 1), // Initial direction
						tangent,
					);

					object3D.quaternion.copy(quaternion);
				}

				onUpdate?.(proxy.progress);
			},
			onComplete: () => {
				// Clean up debug line
				if (debugLine && debugScene) {
					debugScene.remove(debugLine);
					debugLine.geometry.dispose();
					(debugLine.material as LineBasicMaterial).dispose();
				}
				onComplete?.();
				resolve();
			},
		});
	});
}

export class PathAnimator {
	private object3D: Object3D;
	private currentTween: gsap.core.Tween | null = null;
	private debugLine: Line | null = null;
	public isDestroyed = false;

	constructor(object3D: Object3D) {
		this.object3D = object3D;
	}

	moveAlongPath(config: MoveAlongPathConfig): Promise<void> {
		if (this.isDestroyed) return Promise.resolve();

		// Kill any existing animation
		this.kill();

		return new Promise((resolve) => {
			const {
				positions,
				duration,
				ease = "power2.inOut",
				delay = 0,
				onComplete,
				onUpdate,
				autoRotate = false,
				tension = 0.5,
				debug = false,
				debugColor = "#ff0000",
				debugScene,
			} = config;

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

			// Debug visualization
			if (debug && debugScene) {
				const curvePoints = curve.getPoints(100);
				const geometry = new BufferGeometry().setFromPoints(curvePoints);
				const material = new LineBasicMaterial({ color: debugColor });
				this.debugLine = new Line(geometry, material);
				debugScene.add(this.debugLine);
				console.log(
					"Debug: Curve path created with",
					curvePoints.length,
					"points",
				);
			}

			// Animation proxy
			const proxy = { progress: 0 };

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
						const tangent = curve.getTangentAt(proxy.progress);

						// Ensure rotation only on XZ plane (ignore Y axis direction)
						tangent.y = 0;
						tangent.normalize();

						// Use horizontal tangent to calculate rotation
						const quaternion = new Quaternion().setFromUnitVectors(
							new Vector3(0, 0, 1), // Initial direction
							tangent,
						);

						this.object3D.quaternion.copy(quaternion);
					}

					onUpdate?.(proxy.progress);
				},
				onComplete: () => {
					this.currentTween = null;
					// Clean up debug line
					if (this.debugLine && debugScene) {
						debugScene.remove(this.debugLine);
						this.debugLine.geometry.dispose();
						(this.debugLine.material as LineBasicMaterial).dispose();
						this.debugLine = null;
					}
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
		// Clean up debug line if exists
		if (this.debugLine) {
			const scene = this.debugLine.parent;
			if (scene) {
				scene.remove(this.debugLine);
			}
			this.debugLine.geometry.dispose();
			(this.debugLine.material as LineBasicMaterial).dispose();
			this.debugLine = null;
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
		return !this.isDestroyed && this.currentTween
			? this.currentTween.isActive()
			: false;
	}

	destroy(): void {
		this.isDestroyed = true;
		this.kill();
	}
}

export function createPathAnimator(object3D: Object3D): PathAnimator {
	return new PathAnimator(object3D);
}
