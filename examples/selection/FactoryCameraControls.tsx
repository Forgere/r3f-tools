/**
 * camera-controls 适配器 —— 取代 drei 的 <OrbitControls/>。
 *
 * 用法：
 *   const api = useRef<FactoryCameraControlsApi>(null);
 *   ...
 *   <FactoryCameraControls
 *     ref={api}
 *     minDistance={4} maxDistance={48}
 *   />
 *   ...
 *   useEffect(() => {
 *     api.current?.flyTo(
 *       { position: [4, 22, 28], target: [0, BELT_HEIGHT, -4] },
 *       { duration: 0.8 },
 *     );
 *   }, [cameraPreset]);
 *
 * 为什么不用 drei 的 <CameraControls/>：
 *   - 我们的预设切换需要外部 ref 触发 flyTo；
 *   - 同步 initialPosition（Canvas 的 camera prop）与 controls 内部 target；
 *   - r3f-tools 不依赖 drei 也能工作（drei 已经装着，纯粹风格选择）。
 *
 * camera-controls API：https://yomotsu.github.io/camera-controls/
 */
import { useFrame, useThree } from "@react-three/fiber";
import CameraControls from "camera-controls";
import {
	forwardRef,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
} from "react";
import * as THREE from "three";

let installed = false;
function ensureInstalled(THREE_: typeof THREE) {
	if (installed) return;
	CameraControls.install({ THREE: THREE_ });
	installed = true;
}

export interface FlyToTarget {
	position: [number, number, number];
	target: [number, number, number];
}

export interface FlyToOptions {
	/** 过渡时长（秒）。 */
	duration?: number;
}

export interface FactoryCameraControlsApi {
	/** 平滑切换到 position + target，可指定过渡时长。 */
	flyTo(target: FlyToTarget, options?: FlyToOptions): Promise<void>;
	/** 立即对准，不带过渡。 */
	setLookAt(target: FlyToTarget): void;
	/** 直接拿到原生 camera-controls 实例（高级用法，比如阻挡区检测）。 */
	raw(): CameraControls | null;
}

export interface FactoryCameraControlsProps {
	minDistance?: number;
	maxDistance?: number;
	/** 阻尼时间，越大越"懒"。默认 0.1（比 OrbitControls 默认稍粘）。 */
	dampingFactor?: number;
	/** 滚轮缩放速率，默认 1。 */
	zoomSpeed?: number;
	/** 平移速率，默认 1。 */
	panSpeed?: number;
	/** 旋转速率，默认 1。 */
	rotateSpeed?: number;
	/** 鼠标按钮映射：默认左=旋转 / 右=平移 / 中=缩放。 */
	mouseButtons?: CameraControls["mouseButtons"];
	/** 触摸手势映射。 */
	touches?: CameraControls["touches"];
	/** 第一帧后是否禁用操控（预设动画期间禁止抢镜头）。默认 false。 */
}

export const FactoryCameraControls = forwardRef<
	FactoryCameraControlsApi,
	FactoryCameraControlsProps
>(function FactoryCameraControls(props, ref) {
	const {
		minDistance = 4,
		maxDistance = 48,
		dampingFactor,
		zoomSpeed,
		panSpeed,
		rotateSpeed,
		mouseButtons,
		touches,
	} = props;

	const { camera, gl, invalidate } = useThree();
	const controlsRef = useRef<CameraControls | null>(null);

	ensureInstalled(THREE);

	useEffect(() => {
		const controls = new CameraControls(camera, gl.domElement);
		controlsRef.current = controls;
		controls.minDistance = minDistance;
		controls.maxDistance = maxDistance;
		if (dampingFactor !== undefined) controls.dampingFactor = dampingFactor;
		if (zoomSpeed !== undefined) controls.zoomSpeed = zoomSpeed;
		if (panSpeed !== undefined) controls.panSpeed = panSpeed;
		if (rotateSpeed !== undefined) controls.rotateSpeed = rotateSpeed;
		if (mouseButtons) controls.mouseButtons = mouseButtons;
		if (touches) controls.touches = touches;
		controls.saveState();
		return () => {
			controls.dispose();
			controlsRef.current = null;
		};
	}, [camera, gl, minDistance, maxDistance, dampingFactor, zoomSpeed, panSpeed, rotateSpeed, mouseButtons, touches]);

	useFrame((_, dt) => {
		controlsRef.current?.update(dt);
	}, -1);

	const api = useMemo<FactoryCameraControlsApi>(
		() => ({
			flyTo: (t, opts = {}) => {
				const c = controlsRef.current;
				if (!c) return Promise.resolve();
				return c.setLookAt(
					t.position[0],
					t.position[1],
					t.position[2],
					t.target[0],
					t.target[1],
					t.target[2],
					true,
				).then(() => undefined)
					.finally(() => invalidate());
			},
			setLookAt: (t) => {
				const c = controlsRef.current;
				if (!c) return;
				c.setLookAt(
					t.position[0],
					t.position[1],
					t.position[2],
					t.target[0],
					t.target[1],
					t.target[2],
					false,
				);
				invalidate();
			},
			raw: () => controlsRef.current,
		}),
		[invalidate],
	);

	useImperativeHandle(ref, () => api, [api]);

	return null;
});

export default FactoryCameraControls;