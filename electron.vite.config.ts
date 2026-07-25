import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve(__dirname, 'shared')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      lib: { entry: resolve(__dirname, 'electron/main.ts') },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } },
    build: {
      lib: { entry: resolve(__dirname, 'electron/preload.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': shared,
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      rollupOptions: { input: resolve(__dirname, 'src/index.html') },
    },
  },
})
