import { resolve } from 'path'
import { cpSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// onnxruntime-web loads its wasm backends by URL at runtime — stage them into the renderer's
// public dir so the worker's wasmPaths base resolves in dev AND in the packaged app.
// dst is CLEARED first: staging into the source tree let 40MB of stale asyncify/jspi builds
// from an earlier ort version sit there for months and ship in every build.
function ortAssets(): { name: string; buildStart(): void } {
  return {
    name: 'ort-assets',
    buildStart() {
      try {
        const src = resolve(__dirname, 'node_modules/onnxruntime-web/dist')
        const dst = resolve(__dirname, 'src/renderer/public/ort')
        rmSync(dst, { recursive: true, force: true })
        mkdirSync(dst, { recursive: true })
        // BOTH pairs, jsep included: ort's default bundle loads the jsep build as its runtime
        // binary EVEN for plain-wasm inference (trimming it as "parked WebGPU weight" killed
        // every AI pass with "no available backend found" — 2026-08-09 lesson)
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
    plugins: [externalizeDepsPlugin({ exclude: ['@fal-ai/client', '@koan/shared', '@koan/vidancer-ui'] })],
    build: { outDir: 'out/main' }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
      dedupe: ['react', 'react-dom', 'zustand', 'dockview'] // @koan/shared + @koan/vidancer-ui are symlinked TS packages — force ONE copy of each
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
