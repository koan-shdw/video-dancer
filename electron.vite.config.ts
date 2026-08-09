import { resolve } from 'path'
import { cpSync, mkdirSync, readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// onnxruntime-web loads its wasm backends by URL at runtime — stage them into the renderer's
// public dir so `ort.env.wasm.wasmPaths = './ort/'` resolves in dev AND in the packaged app
function ortAssets(): { name: string; buildStart(): void } {
  return {
    name: 'ort-assets',
    buildStart() {
      try {
        const src = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
        const dst = resolve(__dirname, 'src/renderer/public/ort')
        mkdirSync(dst, { recursive: true })
        for (const f of readdirSync(src)) if (/^ort-wasm-simd-threaded\.(jsep\.)?(wasm|mjs)$/.test(f)) cpSync(resolve(src, f), resolve(dst, f))
      } catch {
        /* dep not installed yet — the next boot stages it */
      }
    }
  }
}

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
    // the fx passWorker is a module worker — the default iife worker format can't be emitted
    // from a code-splitting build (Electron's Chromium runs ES module workers fine)
    worker: { format: 'es' },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    },
    plugins: [react(), ortAssets()]
  }
})
