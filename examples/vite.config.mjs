import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: {
    port: 3000,
    open: true
  },
  resolve: {
    alias: {
      'r3f-tools': resolve(__dirname, '../src/index.ts')
    }
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: resolve(__dirname, 'index.html')
    }
  }
})