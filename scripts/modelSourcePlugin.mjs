/**
 * Vite 插件：自动给三维场景补上"渲染代码位置"，免去手工维护登记表。
 *
 * 做两件事：
 *   1. 设备组件文件（默认 `src/devices/**`）里每个导出的组件，末尾追加
 *      `Component.__source = { file, line }`，运行时可被 `import.meta.glob` 收集。
 *   2. 场景文件里 `<Selectable ...>` / `<DeviceRendererHost ...>` 若没有
 *      `mountedAt`，自动注入 `mountedAt={"相对路径:行号"}`，面板即可显示挂载点。
 *
 * 用法（vite.config.ts）：
 *   import { modelSourcePlugin } from "./build/modelSourcePlugin.mjs";
 *   export default defineConfig({ plugins: [react(), modelSourcePlugin({ projectRoot: __dirname })] });
 */

// 默认只给"组件文件"追加 __source：src/{components,devices}/**。
// 不覆盖全 src/，避免给无关业务模块（如 src/sim/types.ts）注入运行时副作用。
const DEFAULT_INCLUDE = /src[\\/](?:components|devices)[\\/].*\.[jt]sx?$/;
const DEFAULT_TAGS = ["Selectable", "DeviceRendererHost"];

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function relativePath(id, root) {
  let rel = toPosix(id);
  if (root) {
    const r = toPosix(root);
    if (rel.startsWith(r)) rel = rel.slice(r.length);
  }
  return rel.replace(/^\/+/, "");
}

function lineAt(code, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (code[i] === "\n") line++;
  return line;
}

/** 找到 `<Tag` 之后开标签的结束位置（跳过字符串与 {} 表达式里的 `>`）。 */
function scanTagEnd(code, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === quote && code[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return i;
  }
  return -1;
}

function componentDeclarations(code) {
  const found = [];
  // 函数声明：export function Foo(){} 或 export default function Foo(){}
  const fnRe = /export\s+(?:default\s+)?function\s+([A-Z][A-Za-z0-9]*)/g;
  let m;
  while ((m = fnRe.exec(code)) !== null) {
    const name = m[1];
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue; // ALL_CAPS 常量
    found.push({ name, line: lineAt(code, m.index) });
  }
  // 常量形式：export const Foo = forwardRef(...)/memo(...)/(...)=>/function
  // 不接受 `Foo = "literal"` `Foo = {…}` `Foo = 123` 等纯值。
  const constRe = /export\s+const\s+([A-Z][A-Za-z0-9]*)\s*=\s*([\s\S]*?)(?=\nexport|\n\/\/|\n\/\*|\n\s*$)/g;
  while ((m = constRe.exec(code)) !== null) {
    const name = m[1];
    if (/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    const rhs = m[2].trimStart();
    if (!/^(forwardRef|memo|function|\(|[A-Z]\w*\s*=>|\([^)]*\)\s*=>)/.test(rhs)) continue;
    found.push({ name, line: lineAt(code, m.index) });
  }
  return found;
}

/**
 * 旧版导出（保留 API 兼容），现在内部即上面那个合并扫描。
 * @deprecated use {@link componentDeclarations}
 */
function findExportedArrowOrWrappedComponents(code) {
  return componentDeclarations(code);
}

export function modelSourcePlugin(options = {}) {
  const {
    include = DEFAULT_INCLUDE,
    tags = DEFAULT_TAGS,
    root,
    debug = false,
  } = options;

  return {
    name: "factory-scene:model-source",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("node_modules")) return null;
      if (!/\.[jt]sx?$/.test(id)) return null;

      const rel = relativePath(id, root);
      let out = code;

      // 1) 组件定义处：追加 __source
      if (include.test(toPosix(id))) {
        const decls = componentDeclarations(out);
        if (decls.length > 0) {
          const stmts = decls
            .map((d) => `\n${d.name}.__source = { file: ${JSON.stringify(rel)}, line: ${d.line} };`)
            .join("");
          out += `\n/* injected by model-source-plugin */${stmts}\n`;
          if (debug) console.log(`[model-source] ${rel}: ${decls.map((d) => d.name).join(", ")}`);
        }
      }

      // 2) 挂载处：注入 mountedAt
      if (/\.[jt]sx$/.test(id)) {
        const edits = [];
        for (const tag of tags) {
          let from = 0;
          while (true) {
            const at = out.indexOf(`<${tag}`, from);
            if (at === -1) break;
            const openEnd = scanTagEnd(out, at);
            if (openEnd === -1) break;
            const text = out.slice(at, openEnd);
            if (!text.includes("mountedAt")) {
              const isSelfClose = out[openEnd - 1] === "/";
              const insertAt = isSelfClose ? openEnd - 1 : openEnd;
              edits.push({ insertAt, text: ` mountedAt={"${rel}:${lineAt(out, at)}"}` });
            }
            from = openEnd + 1;
          }
        }
        // 从后往前插，避免索引失效
        edits.sort((a, b) => b.insertAt - a.insertAt);
        for (const e of edits) {
          out = out.slice(0, e.insertAt) + e.text + out.slice(e.insertAt);
        }
        if (debug && edits.length > 0) {
          console.log(`[model-source] ${rel}: ${edits.length} 个挂载点`);
        }
      }

      return out === code ? null : { code: out, map: null };
    },
  };
}

export default modelSourcePlugin;
