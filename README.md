# Video Dancer (vi-dancer)

AI video-generation timeline editor. Storyboard with generated images, flesh them
into generated videos, arrange on a Premiere-style timeline. Standalone desktop
app (local-first), with Claude writing & policing the prompts.

> **Status:** Phase 0 scaffold — Electron + React + Dockview skeleton + a
> WebGPU/WebCodecs preview spike. No generation pipeline yet.

## Stack

- **Electron** (desktop shell — bundled Chromium = guaranteed WebGPU + WebCodecs)
- **React + TypeScript** (UI), **electron-vite** (build/dev)
- **Dockview** (Premiere-style dockable / floatable panels)
- **WebGPU** canvas (preview & export compositor) + **WebCodecs** (decode/scrub)
- native **ffmpeg** for export *(later phase)*

## Run

```bash
npm install
npm run dev
```

`npm run dev` opens the app. The **Monitor** panel runs the Phase-0 spike:
- it should show an animated color (WebGPU device + render loop working)
- the status line reports `WebGPU: ✓ …` and `WebCodecs: ✓ available`
- click **load test video** and pick any `.mp4` → it decodes to a WebGPU texture
  and draws on the canvas (proves video → GPU)

If WebGPU shows ✗, that's the thing to fix before building further.

## Scripts

| script | does |
|---|---|
| `npm run dev` | launch the app in dev (hot reload) |
| `npm run build` | build main + preload + renderer to `out/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dist:win` | build + package a Windows installer (electron-builder) |

## Layout (Phase 0)

```
src/
  main/index.ts          Electron main (window)
  preload/index.ts       contextBridge (minimal for now)
  renderer/
    index.html
    src/
      main.tsx           React entry
      App.tsx            Dockview layout (Library · Bin · Monitor · Inspector · Timeline)
      panels/panels.tsx  stub panels
      preview/WebGpuVideoSpike.tsx   the WebGPU + WebCodecs proof
      styles.css         dark theme
```
