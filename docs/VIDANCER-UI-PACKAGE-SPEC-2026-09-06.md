# R0 · `@koan/vidancer-ui` — the renderer becomes ONE package. SPEC 2026-09-06

Why: shdw.work (SPEC in `C:\Claude\shdw-work\SPEC.md`, decision 9) mounts Video Dancer's real
panels, live, on the site. No recordings. Today the panels live inside this repo's renderer and
talk to Electron through `window.vidancer` at 199 call sites. One copy, two readers: the app
and the site. So the renderer moves out and becomes a package both mount.

Status: BUILT 2026-09-06 (owner GO). Typecheck + build clean; dev boot on a real project (7 clips, 22 images), 0 renderer errors, filmstrips streamed. NOT field-run by the owner yet. Amendment §2.1: the bridge handoff lives in `src/renderer/src/bridge.ts`, imported FIRST by main.tsx — a module-scope read in the package threw before the handoff when it sat in main.tsx's body.

---

## 0. What moves, what stays

| today (vi-dancer) | after R0 | note |
|---|---|---|
| `src/renderer/src/**` (App, panels, store, lib, ui, fx, panelBus, media, Thumbnail, prompt, preview, emitYaml, styles.css, assets) | `C:\Claude\koan-shared\vidancer-ui\src\**` | the whole renderer. 17k lines of panels, 1.8k store, libs, fx chain, workers. |
| `src/shared/**` (types, models, audioModels, localModels, compile, emitScore, audioEnv, audioSource, imageModels, providerLimits) | `koan-shared\vidancer-ui\src\shared\**` | main AND renderer import these (28 + 40 sites). Main imports them from the package after R0. |
| `src/renderer/src/main.tsx` | stays, becomes 20 lines | the Electron shell: hands `window.vidancer` to the package, mounts `<App/>` |
| `src/renderer/index.html`, `src/renderer/public/ort` | stay | app-level: CSP, ORT wasm staging |
| `src/renderer/src/env.d.ts` (`VidancerApi`, the 216-member preload type) | `vidancer-ui/src/api.ts` | becomes THE bridge interface. Preload implements it. The site's sim implements it. |
| `src/main/**`, `src/preload/**` | stay | untouched except import paths for `shared/*` |
| `electron.vite.config.ts`, `tsconfig.json` | edited | externalize-exclude the package, dedupe react, include the package in typecheck |

Nothing is rewritten. Files move, imports re-point, one accessor replaces one global.

---

## 1. The package

```
koan-shared/
  src/                 @koan/shared, unchanged (grammar, LoRA shelf, Dropdown, bridge)
  vidancer-ui/         @koan/vidancer-ui  (NEW, sibling package, same repo)
    package.json       name @koan/vidancer-ui, type module, no build step, exports:
                         "."          ./src/index.ts        (App, Workspace, panels, store, boot)
                         "./shared/*" ./src/shared/*.ts      (main-process imports)
                         "./api"      ./src/api.ts           (VidancerApi, the bridge type)
                         "./styles.css"
    src/
      api.ts           VidancerApi (moved from env.d.ts) + setVidancerApi / vd()
      media.ts         mediaUrl/thumbUrl read a base set by the bridge (see 2.2)
      index.ts         public surface
      App.tsx · store.ts · panelBus.ts · prompt.tsx · Thumbnail.tsx · emitYaml.ts · styles.css
      panels/ · lib/ · ui/ · fx/ · preview/ · assets/ · shared/
```

Peer deps: react, react-dom, zustand, dockview, lucide-react, onnxruntime-web, @koan/shared.
The consumer installs them (vi-dancer already does; the site will).

---

## 2. The bridge (the only real change)

### 2.1 `window.vidancer` → `vd()`
- `api.ts` exports `interface VidancerApi` (verbatim from env.d.ts, all 216 members) and:
  ```ts
  let api: VidancerApi | null = null
  export function setVidancerApi(a: VidancerApi): void { api = a }
  export function vd(): VidancerApi { if (!api) throw new Error('setVidancerApi() before first render'); return api }
  ```
- Every `window.vidancer.x(...)` (199 sites, 117 in store.ts) becomes `vd().x(...)`. Optional-chained sites (`window.vidancer?.logRenderer?.(...)` in main.tsx) stay in the shell.
- The `declare global { interface Window { vidancer: VidancerApi } }` moves to vi-dancer's `main.tsx` side (`src/renderer/src/env.d.ts` keeps ONLY that global, importing the type from the package).
- Same shape as `@koan/shared`'s `setKoanBridge` (SPEC there): one handoff at startup, typecheck catches a missing member.

### 2.2 `media://` → a base
- `mediaUrl(file, rev)` = `mediaBase() + encodeURIComponent(file) + query`. Default base `media://x/` so Electron behaviour is byte-identical. `setMediaBase(fn)` lets the site map a project-relative file to `https://films.shdw.work/projects/<id>/…`.
- `crossOrigin='anonymous'` stays (R2 serves CORS `*`, same as `media://`).

### 2.3 File drops
- `File.path` reads stay behind `dropPath()` from `@koan/shared` (already the law there). Library.tsx:369 is the one direct `.path` read; it moves to `dropPath`.

### 2.4 Workers and ORT
- `new Worker(new URL('./passWorker.ts', import.meta.url), { type: 'module' })` resolves inside the package under Vite. Unchanged.
- ORT wasm base `new URL('ort/', document.baseURI)`: the consumer stages `/ort/` (vi-dancer's `ortAssets()` plugin stays; the site gets the same plugin).

### 2.5 dockview
- `App.tsx` keeps the dockview shell. New export `Workspace` = `App` mounted with a given saved layout and no modals (welcome, what's-new, tour off), for the site's S2. Same component, two entries. WorkspacesModal's saved-layout JSON is the input.

---

## 3. vi-dancer after R0

`src/renderer/src/main.tsx`:
```ts
import ReactDOM from 'react-dom/client'
import { setKoanBridge, type KoanBridgeApi } from '@koan/shared'
import { setVidancerApi, App, MirrorView, openModelsCard, confirmDialog } from '@koan/vidancer-ui'
import '@koan/vidancer-ui/styles.css'
import '@koan/shared/koan.css'
setVidancerApi(window.vidancer)
setKoanBridge({ api: window.vidancer as unknown as KoanBridgeApi, openModels: openModelsCard, confirm: confirmDialog })
// drag/drop no-ops + crash-log forwarders as today
ReactDOM.createRoot(...).render(location.hash === '#mirror' ? <MirrorView/> : <App/>)
```
- `package.json`: add `"@koan/vidancer-ui": "file:../koan-shared/vidancer-ui"`.
- `electron.vite.config.ts`: main `externalizeDepsPlugin({ exclude: ['@fal-ai/client', '@koan/shared', '@koan/vidancer-ui'] })`; renderer keeps `dedupe: ['react','react-dom']` and adds `zustand`, `dockview`.
- `tsconfig.json`: `include` adds `../koan-shared/vidancer-ui/src`; `paths` unchanged.
- main/preload: `from '../shared/x'` → `from '@koan/vidancer-ui/shared/x'` (28 sites).
- `src/shared/` and `src/renderer/src/` (bar main.tsx, env.d.ts, index.html, public) deleted from this repo. One copy.
- Release: `release.yml` already `npm ci`s a file-linked package (koan-shared's lockfile commit, 1b92a64). The new package rides the same path; `vidancer-ui/package-lock.json` committed.

---

## 4. The site after R0 (for the record, built in shdw-work R1+)

- `@koan/vidancer-sim`: a browser `VidancerApi`. Project JSON + media on R2 + scripted responders (queue progress ticks, Co-Director replies from a script, Civitai list from a static JSON, Bridge accounts from a fixture). Members the tour never touches return honest empties and log once.
- Scenes drive the real store: `useStore.getState().addBeat(...)` etc. That is how beats type themselves. Nothing fakes a panel.
- S2 mounts `Workspace` with the owner's saved layout. Live dockview, live panels, live film in the Program Monitor.

---

## 5. Order of work (one session, his app closed)

1. `koan-shared/vidancer-ui/` package skeleton: package.json, tsconfig, README line in koan-shared SPEC.
2. Move: `git mv`-equivalent copy of `src/renderer/src/**` (minus main.tsx, env.d.ts) and `src/shared/**` into the package. Delete from vi-dancer.
3. `api.ts`: VidancerApi + setVidancerApi/vd. Codemod the 199 sites (`window.vidancer.` → `vd().` with the import added; sites using `window.vidancer?.` reviewed by hand). Library.tsx `.path` → `dropPath`.
4. `media.ts` base. `Workspace` export. `index.ts` surface.
5. vi-dancer shell: main.tsx, env.d.ts, package.json, vite config, tsconfig, main/preload import paths.
6. `npm install` (link), `npm run typecheck`, `npm run build`. Both clean.
7. Launch dev app once from my side, open a project, confirm: panels render, a media:// thumbnail streams, fx chain boots, no console errors. Close it.
8. `koan-shared/scripts/drift.mjs` unaffected (no twins created). Bible 12 log line. koan-shared SPEC line. shdw-work SPEC R0 row → done.
9. Owner field-runs. His run is the gate. Nothing is "done" before it.

Not in R0: the sim bridge, the site, any UI change, any panel change. R0 changes zero pixels.

---

## 6. Risks, named

- **Relative `../../shared` imports** across 40 renderer sites re-point to `./shared` or `../shared` inside the package. Mechanical, typecheck catches every miss.
- **HMR / dev app restarts**: core edits restart the dev app (memory law). His app closed for the whole session.
- **Single-instance lock**: his running app bounces mine. Closed first.
- **Stale `node_modules/.vite`** after a dependency shape change once served a broken ORT (memory corpse). Delete `.vite` before the first dev boot.
- **electron-builder packing** a second file-linked package: koan-shared already proved the path (lockfile commit). If the packed app fails to resolve `@koan/vidancer-ui/shared/*` in main, the fallback is main bundling it (externalize-exclude already does that).
- **git history**: the files' history stays in vi-dancer's log under the old paths. koan-shared's log starts at the move commit. Acceptable, and the same thing happened for the LoRA shelf.

---

## 7. Done when

- vi-dancer typechecks and builds with zero renderer source in its repo bar the shell.
- The dev app runs a real project exactly as before: panels, media streaming, fx, queue, Bridge, Models card.
- `@koan/vidancer-ui` exports `App`, `Workspace`, `MirrorView`, `useStore`, `panelBus` openers, `setVidancerApi`, `setMediaBase`, `VidancerApi`.
- Owner field-run passes.
