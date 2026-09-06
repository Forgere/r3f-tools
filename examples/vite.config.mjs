import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { modelSourcePlugin } from "../scripts/modelSourcePlugin.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

export default defineConfig({
	plugins: [
		react(),
		// 给 <Selectable /> 与 <DeviceRendererHost /> 自动注入 mountedAt
		//（相对仓库根的 file:line），让 CodePathPanel 直接显示挂载点。
		modelSourcePlugin({ root: repoRoot }),
	],
	root: resolve(__dirname),
	server: {
		port: 3000,
		open: true,
	},
	resolve: {
		alias: {
			"r3f-tools": resolve(__dirname, "../src/index.ts"),
		},
	},
	build: {
		outDir: "dist",
		rollupOptions: {
			input: resolve(__dirname, "index.html"),
		},
	},
});
