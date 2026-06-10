import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Electron-vite splits the build into three roots: main (node), preload (node),
// renderer (browser). The renderer is a normal Vite + React app.
export default defineConfig({
  main: {
    // bundle @fal-ai/client into main (it's ESM) so the CJS main can use it
    plugins: [externalizeDepsPlugin({ exclude: ['@fal-ai/client'] })],
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    },
    plugins: [react()]
  }
})
