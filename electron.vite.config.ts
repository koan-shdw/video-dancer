import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Electron-vite splits the build into three roots: main (node), preload (node),
// renderer (browser). The renderer is a normal Vite + React app.
export default defineConfig({
  main: {
    // bundle @fal-ai/client into main (it's ESM) so the CJS main can use it
    plugins: [externalizeDepsPlugin({ exclude: ['@fal-ai/client'] })],
    build: { outDir: 'out/main' },
    // bake the read-only update token (CI secret VD_UPDATE_TOKEN) into the main bundle at build time
    // so the app can read its PRIVATE update feed — kept out of source entirely; empty in dev/local.
    define: { 'process.env.VD_UPDATE_TOKEN': JSON.stringify(process.env.VD_UPDATE_TOKEN || '') }
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
