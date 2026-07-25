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
      rollupOptions: {
        /*
         * O externalizeDepsPlugin so externaliza o que esta em `dependencies`, e
         * o @remotion/bundler e devDependency de proposito: ele arrasta webpack,
         * babel e o @remotion/studio, que nunca rodam no app empacotado.
         *
         * Sem esta linha o Vite tenta empacotar o webpack e o build quebra. O
         * import dele em render.ts e dinamico e so acontece em dev, quando o
         * bundle pre-gerado ainda nao existe.
         */
        external: ['@remotion/bundler'],
      },
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
