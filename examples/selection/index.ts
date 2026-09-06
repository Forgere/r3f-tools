/**
 * 三维场景选中 + 代码定位套件（示例侧重导出）。
 *
 * 任何 R3F 场景只要 import 这一行，所有能力就接入：
 *   import { SelectionProvider, Selectable, SelectionOutline, CodePathPanel } from "./selection";
 *   import "./selection/modelSources"; // 副作用：登记 kind → file:line
 *
 * 设计要点：
 *   - Provider 必须在 Canvas 之内（useSelection 才能读到），但 CodePathPanel
 *     通常放在 Canvas 之外 —— R3F v9 的 Canvas 自带 context bridge，二者兼容。
 *   - mountedAt 由 Vite 插件 `scripts/modelSourcePlugin.mjs` 自动注入到
 *     <Selectable /> 与 <DeviceRendererHost /> 上，无需手工维护。
 */
export {
	SelectionProvider,
	SelectionOutline,
	Selectable,
	useSelection,
	useInstanceLookup,
} from "./SelectionProvider";
export type { InstanceLookup, ItemPose, Selection } from "./SelectionProvider";
export type { SelectionMeta } from "./modelSource";
export { CodePathPanel } from "./CodePathPanel";
export {
	codePathOf,
	configureModelSource,
	formatCodePath,
	listModelSources,
	registerModelSource,
	registerModelSources,
	resolveModelSource,
} from "./modelSource";
export type { ModelSource, ModelSourceConfig, EditorKind } from "./modelSource";