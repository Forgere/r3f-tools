/**
 * 选中系统 —— 场景里每个可见模型都能被点选，并携带"渲染它的代码位置"。
 *
 * 接线：
 *   1. <Canvas onPointerMissed={clear}>  （点空白处取消选中；Provider 内已处理 ESC）
 *   2. 设备外层包 <Selectable meta={{ id, kind, label, codePath }}>…</Selectable>
 *   3. 物料用 InstancedMeshPool 的 onClick(event, index)，配合 useInstanceIdLookup 反查 itemId
 *   4. 场景根放 <SelectionOutline getItemPose={…} />
 */

import { useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { SELECTION_KEY, type SelectionMeta } from "./modelSource";

export interface Selection extends SelectionMeta {
  /** 选中的对象（设备 group）。实例化物料没有独立 Object3D，为 undefined。 */
  object?: THREE.Object3D;
  /** 实例化物料的 sim id（点中物料时填写）。 */
  itemId?: number;
  /** 场景挂载点，由 Vite 插件注入；与 meta.codePath（组件定义处）配合展示。 */
  mountedAt?: string;
}

interface SelectionContextValue {
  selected: Selection | null;
  select: (s: Selection | null) => void;
  clear: () => void;
  /** hover 走 ref：悬停是高频事件，不能触发 React 重渲染。 */
  hoverRef: MutableRefObject<Selection | null>;
  setHover: (s: Selection | null) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection 必须在 <SelectionProvider> 内使用");
  return ctx;
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Selection | null>(null);
  const hoverRef = useRef<Selection | null>(null);

  const select = useCallback((s: Selection | null) => setSelected(s), []);
  const clear = useCallback(() => setSelected(null), []);

  const setHover = useCallback((s: Selection | null) => {
    hoverRef.current = s;
    if (typeof document !== "undefined") {
      document.body.style.cursor = s ? "pointer" : "auto";
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") clear();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clear]);

  const value = useMemo<SelectionContextValue>(
    () => ({ selected, select, clear, hoverRef, setHover }),
    [selected, select, clear, setHover],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

// ---------------------------------------------------------------------------
// 设备：包一层即可选中
// ---------------------------------------------------------------------------

export interface SelectableProps {
  /** 身份 + 代码路径。codePath 形如 `src/devices/LiftTransferUnit.tsx:42`。 */
  meta: SelectionMeta;
  children: ReactNode;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** 关掉选中（如纯装饰件）。 */
  enabled?: boolean;
  /**
   * 场景里的挂载位置（Vite 插件自动注入；手写也可）。
   * 选中后会和 `meta.codePath` 一起给到面板。
   */
  mountedAt?: string;
}

/** 拖拽阈值：超过 5px 视为旋转视角，不选中的。 */
const DRAG_TOLERANCE = 5;

export function Selectable({
	meta,
	children,
	position,
	rotation,
	enabled = true,
	mountedAt,
}: SelectableProps) {
  const { select, setHover } = useSelection();
  const ref = useRef<THREE.Group>(null);
  const downAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const group = ref.current;
    if (!group) return;
    // 挂在 group 上：点中内部任意零件时，靠 findSelectionMeta 向上回溯命中。
    group.userData[SELECTION_KEY] = meta;
    return () => {
      delete group.userData[SELECTION_KEY];
    };
  }, [meta]);

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    downAt.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };

  const onPointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const start = downAt.current;
    downAt.current = null;
    if (!start) return;
    const dx = e.nativeEvent.clientX - start.x;
    const dy = e.nativeEvent.clientY - start.y;
if (Math.hypot(dx, dy) > DRAG_TOLERANCE) return; // 在拖视角，不是点击
		select({ ...meta, mountedAt: mountedAt ?? meta.mountedAt, object: ref.current ?? undefined });
	};

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover({ ...meta, object: ref.current ?? undefined });
  };

  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover(null);
  };

  return (
    <group
      ref={ref}
      position={position}
      rotation={rotation}
      onPointerDown={enabled ? onPointerDown : undefined}
      onPointerUp={enabled ? onPointerUp : undefined}
      onPointerOver={enabled ? onPointerOver : undefined}
      onPointerOut={enabled ? onPointerOut : undefined}
    >
      {children}
    </group>
  );
}

// ---------------------------------------------------------------------------
// 物料：实例化网格的槽位 → itemId 反查
// ---------------------------------------------------------------------------

export interface InstanceLookup {
  bind: (slot: number, itemId: number) => void;
  release: (slot: number) => void;
  itemAt: (slot: number) => number | undefined;
}

/**
 * 物料是实例化渲染的，点击只能拿到 instance index。
 * 在 delta 处理里维护 slot ↔ itemId 映射，点击时反查。
 */
export function useInstanceLookup(): InstanceLookup {
  const slotToItem = useRef(new Map<number, number>());
  return useMemo<InstanceLookup>(
    () => ({
      bind: (slot, itemId) => {
        slotToItem.current.set(slot, itemId);
      },
      release: (slot) => {
        slotToItem.current.delete(slot);
      },
      itemAt: (slot) => slotToItem.current.get(slot),
    }),
    [],
  );
}

// ---------------------------------------------------------------------------
// 高亮框
// ---------------------------------------------------------------------------

export interface ItemPose {
  x: number;
  y: number;
  z: number;
  heading?: number;
}

export interface SelectionOutlineProps {
  /** 实例化物料的位姿查询（选中物料时据此画框）。 */
  getItemPose?: (itemId: number) => ItemPose | null;
  selectedColor?: string;
  hoverColor?: string;
  padding?: number;
}

/** 挂在场景根（父级为单位变换），逐帧跟随选中对象。 */
export function SelectionOutline({
  getItemPose,
  selectedColor = "#F4A261",
  hoverColor = "#9FD8F0",
  padding = 0.06,
}: SelectionOutlineProps) {
  const { selected, hoverRef } = useSelection();
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    [],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const box = useMemo(() => new THREE.Box3(), []);
  const center = useMemo(() => new THREE.Vector3(), []);
  const size = useMemo(() => new THREE.Vector3(), []);

  useFrame((state) => {
    const seg = ref.current;
    if (!seg) return;

    const target = selected ?? hoverRef.current;
    const material = seg.material as THREE.LineBasicMaterial;

    if (!target) {
      seg.visible = false;
      return;
    }

    let found = false;
    if (target.object) {
      box.setFromObject(target.object, true);
      if (!box.isEmpty()) {
        box.getCenter(center);
        box.getSize(size);
        found = true;
      }
    } else if (target.itemId !== undefined && getItemPose) {
      const pose = getItemPose(target.itemId);
      if (pose) {
        center.set(pose.x, pose.y, pose.z);
        size.set(0.22, 0.18, 0.22);
        found = true;
      }
    }

    seg.visible = found;
    if (!found) return;

    seg.position.copy(center);
    seg.scale.set(size.x + padding, size.y + padding, size.z + padding);
    material.color.set(selected ? selectedColor : hoverColor);
    material.opacity = selected
      ? 0.65 + 0.35 * Math.sin(state.clock.elapsedTime * 4)
      : 0.4;
  });

  return (
    <lineSegments ref={ref} geometry={geometry} renderOrder={999} frustumCulled={false}>
      <lineBasicMaterial transparent depthTest={false} />
    </lineSegments>
  );
}
