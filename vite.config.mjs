import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react()],
	build: {
		lib: {
			entry: resolve(__dirname, "src/index.ts"),
			name: "R3FTools",
			formats: ["es", "cjs"],
			fileName: (format) => `index.${format === "es" ? "esm" : format}.js`,
		},
		rollupOptions: {
			external: ["react", "react-dom", "three", "@react-three/fiber"],
			output: {
				globals: {
					react: "React",
					"react-dom": "ReactDOM",
					three: "THREE",
					"@react-three/fiber": "ReactThreeFiber",
				},
			},
		},
		sourcemap: true,
		minify: false,
	},
});
