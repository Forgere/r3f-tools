/**
 * 模型来源登记表 —— "这个模型由哪段代码渲染"的唯一真相源。
 *
 * 用法（两步）：
 *   1. 启动时 `configureModelSource({ projectRoot: "/abs/path/to/repo", editor: "vscode" })`
 *   2. 在注册设备渲染插件的同一处 `registerModelSources([...])`
 *
 * 三个层级，缺一层就不完整：
 *   - file:line        组件定义处（`src/devices/LiftTransferUnit.tsx:42`）
 *   - registeredAt    该 kind 注册进 DeviceRendererRegistry 的位置（`src/devices/plugins.ts:56`）
 *   - mountedAt       场景里挂载这台设备的 JSX 位置（`examples/VividFactoryConveyorExample.tsx:1620`）
 */

export interface ModelSource {
  /** 设备 kind，与 DeviceRendererRegistry 的 key、layout 里的 kind 一致。 */
  kind: string;
  /** 渲染组件名。 */
  component: string;
  /** 组件定义文件（相对仓库根，不带前导斜杠）。 */
  file: string;
  /** 组件定义行号。 */
  line?: number;
  /** 注册进渲染注册表的位置（file:line 字符串）。 */
  registeredAt?: string;
  /** 场景里挂载该设备的位置（file:line 字符串，可由 Vite 插件自动注入）。 */
  mountedAt?: string;
  /** 建模思路 / 约束说明，写给人看。 */
  notes?: string;
  /** 面板默认标题（kind 在 layout 里没显式标签时使用）。 */
  label?: string;
}

/** 挂在 Object3D.userData 上的身份信息，是"点谁选中谁"的基础。 */
export interface SelectionMeta {
  /** 稳定 id：设备用 deviceId，物料用 `item:<id>`。 */
  id: string;
  /** 设备 kind，或 `item` / `lane` 等自定义类别。 */
  kind: string;
  /** 面板标题用的可读名。 */
  label?: string;
  /** 渲染它的代码位置，形如 `src/devices/Xxx.tsx:42`。 */
  codePath?: string;
  /** 场景挂载位置（Vite 插件注入），可选，区别于组件定义处。 */
  mountedAt?: string;
  /** 额外展示的数据（如 sim def、attrs）。 */
  data?: Record<string, unknown>;
}

export type EditorKind = "vscode" | "cursor" | "none";

export interface ModelSourceConfig {
  /** 仓库根的绝对路径，用于拼 `vscode://file/<abs>`。 */
  projectRoot?: string;
  editor?: EditorKind;
}

let config: ModelSourceConfig = { editor: "vscode", projectRoot: "" };
const sources = new Map<string, ModelSource>();

export function configureModelSource(next: Partial<ModelSourceConfig>): void {
  config = { ...config, ...next };
}

export function registerModelSource(source: ModelSource): void {
  sources.set(source.kind, source);
}

export function registerModelSources(list: ModelSource[]): void {
  for (const s of list) registerModelSource(s);
}

export function listModelSources(): ModelSource[] {
  return [...sources.values()];
}

export function resolveModelSource(kind: string): ModelSource | undefined {
  return sources.get(kind);
}

export function formatCodePath(s: { file: string; line?: number }): string {
  return s.line ? `${s.file}:${s.line}` : s.file;
}

/** 直接拿到某个 kind 的 `file:line`；未登记返回 undefined。 */
export function codePathOf(kind: string): string | undefined {
  const s = sources.get(kind);
  return s ? formatCodePath(s) : undefined;
}

/** 生成编辑器跳转链接（`vscode://file/...` / `cursor://file/...`）。 */
export function editorUrl(file: string, line = 1): string | undefined {
  if (config.editor === "none") return undefined;
  const root = config.projectRoot ? config.projectRoot.replace(/\/+$/, "") : "";
  const rel = file.replace(/^\/+/, "");
  const abs = root ? `${root}/${rel}` : `/${rel}`;
  const scheme = config.editor === "cursor" ? "cursor" : "vscode";
  return `${scheme}://file/${abs}:${line}:1`;
}

/** 一键拿到某 kind 的编辑器链接，未登记返回 undefined。 */
export function editorUrlForKind(kind: string): string | undefined {
  const s = sources.get(kind);
  return s ? editorUrl(s.file, s.line ?? 1) : undefined;
}

// ---------------------------------------------------------------------------
// 场景图侧：身份挂载与回溯
// ---------------------------------------------------------------------------

export const SELECTION_KEY = "__selection";

/** 把身份写进一个 Object3D（含所有子节点）。 */
export function tagObject(object: { userData: Record<string, unknown> }, meta: SelectionMeta): void {
  object.userData[SELECTION_KEY] = meta;
}

/**
 * 从被点中的 mesh 向上回溯，找到最近的带身份的祖先。
 * 这样点中设备内部的任意一个零件（滚筒、螺丝、灯罩）都算选中该设备。
 */
export function findSelectionMeta(object: { userData: Record<string, unknown>; parent: unknown } | null): SelectionMeta | undefined {
  let current: any = object;
  while (current) {
    const meta = current.userData?.[SELECTION_KEY] as SelectionMeta | undefined;
    if (meta) return meta;
    current = current.parent ?? null;
  }
  return undefined;
}
