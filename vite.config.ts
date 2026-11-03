import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { outDir: 'dist', assetsInlineLimit: 100000000, cssCodeSplit: false, chunkSizeWarningLimit: 5000 },
  test: { globals: true, environment: 'node' },
} as any)
