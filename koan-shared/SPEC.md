# KOAN-SHARED — the one-copy package. SPEC 2026-08-31

Status: Phase 0 + 1 + 2 BUILT 2026-08-31 (user GO). The whole LoRA shelf is ONE COPY:
main engine (loraShelf.ts + registerLorasIpc), renderer (LoraShelf.tsx + LoraPicker.tsx),
types, tokens, Section, ContextMenu, Ic, koan.css. Both apps bridge in (setKoanBridge in
main.tsx; configureLoraShelf in main index) — vi-dancer's clip panel now mounts the shared
LoraPicker (Q3 taken as recommended). Both apps typecheck AND full-build clean; shared code
proven inside both built main and renderer bundles. NOT yet field-run.
Phase 0 findings: ContextMenu — vi-dancer superset (title/disabled greyed rows) is canonical,
sprite gains those powers free; tokens — vi superset canonical. OPEN QUESTIONS for the user:
(1) confirm dialogs — vi carries a 3-dialog kit (text/confirm/alert), sprite only confirm;
move the whole kit shared, or leave per-app? (2) chips (.sd-chip) exist in sprite only —
share as .koan-chip family, or leave? (3) Phase 2 picker: share LoraPicker into vi-dancer's
clip panel (recommended), or keep per-app?
Scope: **vi-dancer + sprite-dancer. The user decides every inclusion — apps and cargo.**
Law (user, 2026-08-31): best solution now, never "later". One copy, two readers — drift
dies because there is nothing to drift.

## What it is

A package at `C:\Claude\koan-shared`, file-linked into each app. Shared infrastructure
and design grammar live here ONCE; apps import instead of carrying copies. A change here
reaches every app on its next build. A new app plugs in with one dependency line and one
bridge handoff at startup.

## Repo layout

```
koan-shared/
  package.json          name "@koan/shared" — plain TS source, no build step
  SPEC.md               this file
  src/
    types.ts            LoraSidecar / LoraRow / LoraCatalogItem (+ future shared types)
    main/
      loraShelf.ts      the shelf engine (browse/install/scan/import/thumb/tag/delete)
      lorasIpc.ts       registerLorasIpc(ipcMain, deps) — the 9 loras:* handlers
    renderer/
      bridge.ts         setKoanBridge / getKoanBridge — the per-app noun firewall
      tokens.ts         spacing / radius / font
      Section.tsx       collapsible section (parent owns the open-set)
      ContextMenu.tsx   menu + flyout
      confirm.tsx       confirmDialog
      LoraShelf.tsx     the shelf panel (model tabs → one search → repo tabs, drop zone)
      LoraPicker.tsx    the pick-and-weight surface (＋ LORA · sliders · trigger chips)
    styles/
      koan.css          the shared grammar: .btn faces, chips, hbtn compact, case law
  scripts/
    drift.mjs           diffs the still-per-app twins, nouns normalized; shouts on drift
```

## The bridge (per-app nouns, killed once)

Shared renderer code never says `window.vidancer` or `window.spritedancer`. At renderer
startup each app calls once:

```ts
setKoanBridge({
  api: window.vidancer,            // or window.spritedancer — the preload surface
  openModels: () => …,             // fronts that app's Models card/panel
  pathForFile: (f) => …,           // sprite: webUtils path; vi-dancer: legacy File.path
})
```

`KoanBridge.api` is a typed interface of exactly what shared code uses (the loras* calls,
getSettings/setSettings, openExternal, the onLoras* subscriptions). An app missing a
member fails at typecheck, not in the field.

Main-process twin: `configureLoraShelf({ downloadFile, sha256Of, lorasDir, enginePython })`
— each app wires its own transport (vi-dancer modelStore, sprite ltxStore) and paths.
The shelf engine itself is one file.

## Consumption wiring (the part that breaks silently if skipped)

- Each app's `package.json`: `"@koan/shared": "file:../koan-shared"` (sprite:
  `file:../../koan-shared` from `app/`). `npm install` re-links.
- electron-vite externalizes node_modules in the MAIN build — `@koan/shared` must be
  excluded so its TS gets bundled: `externalizeDepsPlugin({ exclude: ['@koan/shared'] })`
  in both apps' electron.vite.config.ts (main + preload sections). Renderer (vite)
  compiles TS deps as-is.
- `koan.css` imported by each renderer entry AFTER the app css cannot-override rule is
  the reverse: app styles.css keeps ONLY app-specific rules; the shared subset moves out.

## Phases

**Phase 0 — reconcile.** The twins have drifted since their ports (proven today: button
faces, spacing). `drift.mjs` first: diff every pair named below, nouns normalized. Every
difference is either (a) reconciled to the newest user-approved behavior before the move,
or (b) listed to the user as a QUESTION. No silent winner.

**Phase 1 — grammar + primitives.** tokens.ts, koan.css (.btn amber-filled CAPS add-button
law "＋ LORA"/"+ TIMELINE" family, ghost/secondary, hbtn compact, chips), Section,
ContextMenu, confirm. Apps delete their copies, imports flip (mechanical, many files,
zero behavior change). Typecheck + build both.

**Phase 2 — the LoRA shelf.** types, loraShelf.ts + lorasIpc.ts (main), LoraShelf.tsx +
LoraPicker.tsx (renderer) move in; apps' copies die. DECISION for the user: vi-dancer's
clip-panel picker is an inline block today, sprite's is the LoraPicker component — share
the component (vi-dancer swaps its inline block for it; identical behavior, one copy) or
keep per-app. Recommendation: share.

**Further cargo — the user names it.** Candidates exist (model store transport, downloader
card, runtime manager); nothing moves without his word.

## Per-app migration map (phase 1+2)

vi-dancer: `src/renderer/src/ui/{Section,ContextMenu,tokens}.tsx|ts`, `prompt.tsx`
(confirmDialog part), `main/loraShelf.ts`, loras IPC block in `main/index.ts`,
`panels/LoraShelf.tsx`, RenderPanel picker block → imports from `@koan/shared`;
`styles.css` sheds the shared subset.
sprite-dancer: `app/src/renderer/src/ui/{Section,ContextMenu,confirm,tokens,LoraPicker}`,
`main/loraShelf.ts`, loras IPC block, `panels/LoraShelf.tsx` → same.
Preload surfaces stay per-app (they are the nouns).

## Drift checker (for whatever stays per-app)

`node koan-shared/scripts/drift.mjs` — reads a PAIRS table (path-left, path-right,
noun-map), normalizes (vidancer↔spritedancer, vd-↔sd-), diffs, prints per-pair verdict.
Runs at session start on shared-subsystem work and inside PUSH IT. Exit 1 on drift.

## Rules of the road

- The user decides inclusions. Apps and cargo, every time.
- A shared change is not done until both apps typecheck AND the bible ch. 12 log carries it.
- Bible ch. 12 reference-copy pointers update on each move: moved piece → "reference:
  koan-shared".
- Grammar lives in koan.css as code; prose in the bible explains, never overrides.

## Verification per phase

Typecheck + build both apps; the user field-runs. No "works" claims without a run.
