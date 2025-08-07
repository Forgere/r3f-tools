export type { InstancedMeshPoolProps } from "./components/InstanceMeshPool";
export {
	InstancedMeshPool,
	type InstancedMeshPoolRef,
} from "./components/InstanceMeshPool";

export type { ConveyorBeltProps } from "./components/ConveyorBelt";
export {
	ConveyorBelt,
	type ConveyorBeltRef,
} from "./components/ConveyorBelt";

export { type AnimationPoint, createAnimator } from "./utils/gsapAnimator";
export {
	createPathAnimator,
	type MoveAlongPathConfig,
	moveAlongPath,
	PathAnimator,
	type PathPosition,
} from "./utils/moveAlongPath";
