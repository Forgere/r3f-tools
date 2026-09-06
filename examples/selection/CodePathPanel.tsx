/**
 * 选中信息面板 —— 回答三个问题：
 *   1. 我点中的是什么（id / kind / 实时状态）
 *   2. 它由哪段代码渲染（file:line，可一键跳编辑器）
 *   3. 它在数据层长什么样（layout 里的 def）
 *
 * 放在 Canvas 外（普通 HTML 覆盖层），与 leva 面板同层。
 */

import { useEffect, useState } from "react";
import {
  editorUrl,
  editorUrlForKind,
  resolveModelSource,
} from "./modelSource";
import { useSelection } from "./SelectionProvider";

export interface CodePathPanelProps {
  /** 实时状态读取（如 `sim.getDeviceState(id)`），4Hz 轮询，不进 useFrame。 */
  getDeviceState?: (deviceId: string) => Record<string, unknown> | undefined;
  /** 数据层定义读取（如 `layout.devices.find(d => d.id === id)`）。 */
  getLayoutDef?: (deviceId: string) => unknown;
  onClose?: () => void;
  /** 显示编辑器跳转按钮（默认 true）。 */
  showEditorLink?: boolean;
  position?: "left" | "right";
  /** 距顶部距离，避免和场景里既有的卡片（标题 / HUD）叠在一起。 */
  top?: number;
}

const CARD: React.CSSProperties = {
  position: "fixed",
  top: 16,
  width: 300,
  padding: 14,
  borderRadius: 16,
  background: "rgba(255, 253, 245, 0.94)",
  boxShadow: "0 10px 28px rgba(58, 74, 79, 0.16)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 11,
  color: "#3A4A4F",
  backdropFilter: "blur(6px)",
  zIndex: 50,
  lineHeight: 1.6,
};

const LABEL: React.CSSProperties = {
  fontFamily: "system-ui, sans-serif",
  fontWeight: 700,
  fontSize: 12,
  marginTop: 10,
  marginBottom: 4,
  opacity: 0.85,
};

function parseFileLine(value: string): { file: string; line: number } {
  const idx = value.lastIndexOf(":");
  if (idx <= 0) return { file: value, line: 1 };
  const line = Number.parseInt(value.slice(idx + 1), 10);
  return Number.isNaN(line)
    ? { file: value, line: 1 }
    : { file: value.slice(0, idx), line };
}

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "✓" : "✗";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (value === undefined || value === null) return "–";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function CodeLink({ value, show }: { value: string; show: boolean }) {
  const { file, line } = parseFileLine(value);
  const href = show ? editorUrl(file, line) : undefined;
  const copy = () => {
    void navigator.clipboard?.writeText(value);
  };
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <code style={{ flex: 1, wordBreak: "break-all" }}>{value}</code>
      {href ? (
        <a href={href} style={{ color: "#2E7D32", textDecoration: "none" }}>
          打开
        </a>
      ) : null}
      <button type="button" onClick={copy} style={miniButton}>
        复制
      </button>
    </div>
  );
}

const miniButton: React.CSSProperties = {
  border: "1px solid rgba(58,74,79,0.2)",
  background: "transparent",
  borderRadius: 6,
  padding: "1px 6px",
  cursor: "pointer",
  fontSize: 10,
  color: "#3A4A4F",
};

export function CodePathPanel({
  getDeviceState,
  getLayoutDef,
  onClose,
  showEditorLink = true,
  position = "right",
  top = 16,
}: CodePathPanelProps) {
  const { selected, clear } = useSelection();
  const [, setTick] = useState(0);

  // 4Hz 轮询实时状态：面板是 HTML，不需要、也不能每帧重渲染。
  useEffect(() => {
    if (!selected || !getDeviceState) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 250);
    return () => window.clearInterval(id);
  }, [selected, getDeviceState]);

  if (!selected) return null;

  const source = resolveModelSource(selected.kind);
  const live = getDeviceState?.(selected.id);
  const def = getLayoutDef?.(selected.id);
  const componentLink = showEditorLink ? editorUrlForKind(selected.kind) : undefined;

  const close = () => (onClose ? onClose() : clear());

  return (
    <div style={{ ...CARD, [position]: 16, top }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontFamily: "system-ui, sans-serif", fontSize: 13 }}>
          {selected.label ?? selected.id}
        </b>
        <button type="button" onClick={close} style={miniButton}>
          ✕
        </button>
      </div>
      <div style={{ opacity: 0.7 }}>
        id <b>{selected.id}</b> · kind <b>{selected.kind}</b>
        {selected.itemId !== undefined ? ` · item #${selected.itemId}` : ""}
      </div>

      {live ? (
        <>
          <div style={LABEL}>实时状态</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
            {Object.entries(live).map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ opacity: 0.65 }}>{k}</span>
                <b>{formatValue(v)}</b>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div style={LABEL}>渲染代码路径</div>
      {source ? (
        <>
          <CodeLink value={`${source.file}:${source.line ?? 1}`} show={showEditorLink} />
          <div style={{ opacity: 0.65 }}>
            组件 <b>{source.component}</b>
            {componentLink ? " · " : ""}
          </div>
          {source.registeredAt ? (
            <>
              <div style={{ opacity: 0.65, marginTop: 4 }}>注册点</div>
              <CodeLink value={source.registeredAt} show={showEditorLink} />
            </>
          ) : null}
          {source.mountedAt ? (
            <>
              <div style={{ opacity: 0.65, marginTop: 4 }}>场景挂载点</div>
              <CodeLink value={source.mountedAt} show={showEditorLink} />
            </>
          ) : null}
          {source.notes ? (
            <div style={{ opacity: 0.6, marginTop: 6 }}>{source.notes}</div>
          ) : null}
        </>
      ) : (
        <div style={{ opacity: 0.7 }}>
          未登记来源。在注册该 kind 的地方补一行：
          <pre
            style={{
              marginTop: 6,
              padding: 8,
              borderRadius: 8,
              background: "rgba(58,74,79,0.06)",
              whiteSpace: "pre-wrap",
            }}
          >
{`registerModelSource({
  kind: "${selected.kind}",
  component: "YourComponent",
  file: "src/devices/YourComponent.tsx",
  line: 42,
})`}
          </pre>
        </div>
      )}

      {def ? (
        <>
          <div style={LABEL}>数据定义（layout.devices）</div>
          <details>
            <summary style={{ cursor: "pointer", opacity: 0.7 }}>展开 JSON</summary>
            <pre
              style={{
                marginTop: 6,
                padding: 8,
                borderRadius: 8,
                background: "rgba(58,74,79,0.06)",
                maxHeight: 180,
                overflow: "auto",
              }}
            >
              {JSON.stringify(def, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
    </div>
  );
}
