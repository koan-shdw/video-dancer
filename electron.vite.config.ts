import { resolve } from 'path'
import { cpSync, mkdirSync, readdirSync, rmSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

function sourceRevisions() {
  const info = (dir: string) => {
    const git = (...args: string[]): string => execFileSync('git', ['-c', `safe.directory=${dir.replaceAll('\\', '/')}`, '-C', dir, ...args], { encoding: 'utf8' }).trim()
    try { return { revision: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain') } }
    catch { return { revision: 'unknown', dirty: true } }
  }
  return {
    name: 'source-revisions',
    generateBundle(this: { emitFile(asset: { type: 'asset'; fileName: string; source: string }): void }) {
      this.emitFile({ type: 'asset', fileName: 'build-info.json', source: JSON.stringify({
        application: info(__dirname), shared: info(resolve(__dirname, '../koan-shared')),
        pinnedSharedRevision: readFileSync(resolve(__dirname, 'koan-shared.ref'), 'utf8').trim()
      }, null, 2) })
    }
  }
}

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

// The four draft MOODS (moods.ts, list 30) are seeded only when he runs from source, but their text
// was still in every installer's bundle: a release build gets them empty (audit 2026-10-09 H18).
// scripts/check-package.cjs refuses an installer that still carries one.
function draftMoodsOut(): { name: string; apply: (c: unknown, env: { command: string; mode: string }) => boolean; enforce: 'pre'; load(id: string): string | undefined } {
  return {
    name: 'draft-moods-out',
    apply: (_c, env) => env.command === 'build' && env.mode === 'production', // the dev app he runs keeps them
    enforce: 'pre',
    load(id) {
      if (/\/moods\/(90s-dark-fantasy-cgi|retro-ova|shdw|koan)\.vmd\?raw$/.test(id.replace(/\\/g, '/'))) return 'export default ""'
      return undefined
    }
  }
}

// Electron-vite splits the build into three roots: main (node), preload (node),
// renderer (browser). The renderer is a normal Vite + React app.
export default defineConfig({
  main: {
    // bundle @fal-ai/client into main (it's ESM) so the CJS main can use it
    plugins: [externalizeDepsPlugin({ exclude: ['@fal-ai/client', '@koan/shared', '@koan/vidancer-ui'] }), sourceRevisions(), draftMoodsOut()],
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
    // run from source (his only Video Dancer since 2026-10-10), the dev server served only this
    // folder: the fx passWorker in koan-shared is loaded by URL, not imported, so it got a 403 and
    // every Effects depth / matte pass died "before it loaded" (2026-10-12)
    server: { fs: { allow: [__dirname, resolve(__dirname, '../koan-shared')] } },
    build: {
      outDir: 'out/renderer',
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') }
    },
    plugins: [react(), ortAssets()]
  }
})
